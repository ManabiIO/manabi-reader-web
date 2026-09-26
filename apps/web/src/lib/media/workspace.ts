/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { abortable, inAbortScope } from './abort.js';
import { downloadSubtitles } from './subtitle-download.js';
import { formatMediaTime } from './time.js';
import { trackLanguage } from './track-selection.js';
import { audioLanguage, chooseTranscriptionAudio, type AudioChoice } from './audio-selection.js';
import { validateJob } from './jobs.js';
import { deviceKey } from './device-checkpoint.js';
import {
  type Scope,
  type ContentKey,
  type Track,
  type VideoInfo,
  type Playback,
  language
} from './contracts.js';
import { MediaStore } from './store.js';
import { type ByteSource, localSource, supportedVideo, identify } from './sources.js';
import { type Bunny, MediaPipeline } from './pipeline.js';
import { VideoPlayer } from './player.js';
import { matchSidecar, parseSubtitles, cueDigest } from './captions.js';
import { discoverEmbedded } from './embedded.js';
import { missingTranscriptDecision } from './discovery-policy.js';
import { cloudInfoPath, type CloudLocator } from './cloud-locator.js';
import { cloudRequest } from './cloud-listing.js';
import { cloudSource, type CloudManifest } from './sources.js';
import { TranscriptionQueue, type Job, type Engine } from './queue.js';
import { MossClient } from './moss-client.js';
import { syncMedia, type SyncTransport, type SyncStatus } from './sync.js';
import { removeModel } from './model-cache.js';
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
const action = (text: string, fn: () => void) => {
  const b = make('button', text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
};
interface Alias {
  key: ContentKey;
  name: string;
  handle?: FileSystemFileHandle;
  cloud?: CloudLocator;
}
export interface WorkspaceConnection {
  transport: SyncTransport;
  chooseConnected: (
    open: (source: ByteSource, subtitles?: File[]) => Promise<void>,
    signal?: AbortSignal
  ) => Promise<void>;
}
export interface WorkspaceOptions {
  scope: Scope;
  booksURL: string;
  runtimeBase: string;
  onAppearance?: (trigger: HTMLElement) => void;
  store?: MediaStore;
  engine?: Engine;
  loadBunny: () => Promise<Bunny>;
  transport?: SyncTransport;
  /** Actual connected-source browser supplied by the Svelte host. */
  chooseConnected?: (
    open: (source: ByteSource, subtitles?: File[]) => Promise<void>,
    signal?: AbortSignal
  ) => Promise<void>;
}
export class VideoWorkspace {
  readonly store: MediaStore;
  private root = make('main');
  private shelf = make('div');
  private viewing = make('div');
  private status = make('p');
  private progress = make('progress');
  private jobs = make('section');
  private syncPanel = make('section');
  private selected = new Set<ContentKey>();
  private sources = new Map<ContentKey, ByteSource>();
  private current?: {
    key: ContentKey;
    source: ByteSource;
  };
  private player?: VideoPlayer;
  private queue: TranscriptionQueue;
  private stopStore: () => void;
  private openAbort?: AbortController;
  private lifetime = new AbortController();
  private cloudAbort = new AbortController();
  private generation = 0;
  private openIntent = 0;
  private syncChoiceMade = false;
  private audioChoices: AudioChoice[] = [];
  private closed = false;
  private closing?: Promise<void>;
  private refreshing = 0;
  private jobsRead?: Promise<void>;
  private jobsDirty = false;
  private tracksRead?: Promise<void>;
  private tracksDirty = false;
  private search = make('input');
  private sort = make('select');
  private filter = make('select');
  private lang = make('input');
  private audio = make('select');
  private syncEnabled = make('input');
  private syncInFlight = false;
  private syncEpoch = 0;
  private cloudButton = action('Open cloud video', () => {
    const choose = this.options.chooseConnected;
    if (choose)
      void choose(async (source, subs) => {
        if (!this.closed && this.options.chooseConnected === choose)
          await this.openSource(source, subs);
      }, this.cloudAbort.signal).catch((e) => this.error(e));
  });
  private syncAbort = new AbortController();
  private syncTimer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  constructor(
    host: HTMLElement,
    private options: WorkspaceOptions
  ) {
    this.store = options.store ?? new MediaStore();
    this.root.className = 'manabi-media';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.progress.hidden = true;
    this.progress.max = 1;
    const nav = make('nav');
    nav.className = 'media-sections';
    nav.setAttribute('aria-label', 'Library sections');
    const books = make('a', 'Books');
    books.href = options.booksURL;
    const videos = make('span', 'Videos');
    videos.setAttribute('aria-current', 'page');
    nav.append(books, videos);
    const header = make('header');
    header.append(make('h1', 'Videos'));
    const tools = make('div');
    tools.className = 'media-actions';
    const fileInput = make('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'video/*,.mp4,.m4v,.mov,.mkv,.webm,.ogv,.srt,.vtt';
    fileInput.hidden = true;
    fileInput.dataset.testid = 'media-files';
    fileInput.addEventListener('change', () => {
      const files = [...(fileInput.files ?? [])];
      fileInput.value = '';
      void this.addFiles(files).catch((e) => this.error(e));
    });
    tools.append(
      action('Add videos', () => fileInput.click()),
      action('Open local folder', () => void this.folder().catch((e) => this.error(e)))
    );
    this.cloudButton.hidden = !options.chooseConnected;
    tools.append(this.cloudButton);
    this.search.type = 'search';
    this.search.placeholder = 'Search videos';
    this.search.setAttribute('aria-label', 'Search videos');
    this.search.addEventListener('input', () => {
      this.selected.clear();
      void this.refresh();
    });
    for (const [value, label] of [
      ['recent', 'Recently watched'],
      ['title', 'Title']
    ]) {
      const o = make('option', label);
      o.value = value;
      this.sort.append(o);
    }
    this.sort.setAttribute('aria-label', 'Sort videos');
    this.sort.addEventListener('change', () => void this.refresh());
    this.filter.setAttribute('aria-label', 'Filter videos');
    for (const [value, label] of [
      ['all', 'All videos'],
      ['continue', 'Continue watching'],
      ['finished', 'Finished'],
      ['unwatched', 'Not watched']
    ]) {
      const option = make('option', label);
      option.value = value;
      this.filter.append(option);
    }
    this.filter.addEventListener('change', () => {
      this.selected.clear();
      void this.refresh();
    });
    tools.append(this.search, this.sort, this.filter);
    this.lang.value = 'und';
    this.lang.setAttribute('aria-label', 'Caption language');
    this.lang.maxLength = 64;
    this.lang.addEventListener('change', () => {
      try {
        this.audio.value = String(
          chooseTranscriptionAudio(this.audioChoices, this.lang.value)?.id ?? ''
        );
      } catch (e) {
        this.error(e);
      }
    });
    this.audio.setAttribute('aria-label', 'Audio track for transcription');
    const settings = make('details');
    settings.append(make('summary', 'Transcription and sync'));
    const labels = make('div');
    labels.className = 'caption-controls';
    labels.append(
      this.label('Language override (und = automatic)', this.lang),
      this.label('Audio track for transcription', this.audio)
    );
    this.syncEnabled.type = 'checkbox';
    this.syncEnabled.disabled = !options.transport;
    this.syncEnabled.addEventListener('change', () => {
      this.syncChoiceMade = true;
      if (!this.syncEnabled.checked) this.stopSync();
      void this.store
        .putLocal(options.scope, 'settings', 'sync', this.syncEnabled.checked)
        .then(() => this.scheduleSync())
        .catch((e) => this.error(e));
    });
    labels.append(
      this.label(
        options.transport
          ? 'Sync video progress and subtitles with Manabi'
          : 'Sign in to sync; everything remains local otherwise',
        this.syncEnabled
      )
    );
    settings.append(
      labels,
      make(
        'p',
        'Transcription runs only after your request. The first request downloads a verified 648 MB model. Audio and video are not uploaded for transcription. Language tags do not force MOSS to translate or decode in a chosen language.'
      ),
      action(
        'Remove cached transcription model',
        () =>
          void removeModel()
            .then(() => this.notice('Cached model removed. Your transcripts were kept.'))
            .catch((e) => this.error(e))
      ),
      this.syncPanel
    );
    const batch = make('div');
    batch.className = 'media-actions';
    batch.append(
      action('Select visible videos', () => {
        for (const check of this.shelf.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
          check.checked = true;
          this.selected.add(check.value as ContentKey);
        }
        this.notice(`${this.selected.size} videos selected`);
      }),
      action('Clear selection', () => {
        this.selected.clear();
        void this.refresh();
      }),
      action('Generate missing transcripts', () => void this.bulk().catch((e) => this.error(e)))
    );
    this.shelf.className = 'video-shelf';
    this.shelf.setAttribute('aria-label', 'Video library');
    this.jobs.setAttribute('aria-label', 'Transcription jobs');
    this.root.append(
      nav,
      header,
      tools,
      fileInput,
      this.status,
      this.progress,
      settings,
      batch,
      this.shelf,
      this.viewing,
      this.jobs
    );
    host.append(this.root);
    const engine = options.engine ?? new MossClient(options.runtimeBase);
    this.queue = new TranscriptionQueue(
      this.store,
      options.scope,
      engine,
      async (job, start, end, signal) => {
        return inAbortScope([signal, this.lifetime.signal], async (operation) => {
          const source = await this.resolveSource(job.mediaKey, operation);
          const bunny = await abortable(operation, () => options.loadBunny());
          operation.throwIfAborted();
          const pipeline = new MediaPipeline(bunny, source, operation);
          try {
            return await pipeline.decode(Number(job.audioTrack), start, end, operation);
          } finally {
            pipeline.dispose();
          }
        });
      },
      (p) => {
        if (this.closed) return;
        this.progress.hidden = false;
        this.progress.max = Math.max(1, p.total);
        this.progress.value = p.loaded;
        this.notice(
          `${p.stage === 'downloading' ? 'Downloading speech model' : p.stage === 'loading' || p.stage === 'checking' ? 'Preparing speech model' : p.stage === 'verifying' ? 'Verifying speech model' : p.stage === 'complete' ? 'Transcript ready' : p.stage === 'paused' ? 'Transcription paused' : p.stage === 'failed' ? 'Transcription failed' : 'Generating transcript'}${p.total > 0 ? ` · ${Math.min(100, Math.round((p.loaded / p.total) * 100))}%` : ''}`
        );
        this.player?.generationStatus(p.job.id, p.stage);
        if (['complete', 'paused', 'failed'].includes(p.stage)) {
          this.progress.hidden = true;
          void this.refreshTracks().catch((e) => this.error(e));
        } /* Durable job changes notify the store. Download byte progress must not
         * reload every saved job and its potentially large cue checkpoint. */
      },
      (e) => this.error(e)
    );
    this.stopStore = this.store.subscribe((captionsChanged) => {
      if (this.closed) return;
      void this.refresh();
      void this.refreshJobs().catch((e) => this.error(e));
      if (captionsChanged) void this.refreshTracks().catch((e) => this.error(e));
      this.scheduleSync();
    });
    void this.store
      .local<boolean>(options.scope, 'settings', 'sync')
      .then((value) => {
        if (!this.closed && !this.syncChoiceMade) {
          this.syncEnabled.checked = value === true;
          this.scheduleSync();
        }
      })
      .catch((e) => this.error(e));
    void this.queue
      .recover()
      .then(() => this.refreshJobs())
      .catch((e) => this.error(e));
    void this.refresh();
    this.poll = setInterval(() => this.scheduleSync(), 30000);
  }
  private label(text: string, control: HTMLElement) {
    const label = make('label');
    label.append(document.createTextNode(text), control);
    return label;
  }
  private notice(text: string) {
    if (!this.closed) this.status.textContent = text;
  }
  private error(error: unknown) {
    if (this.closed) return;
    this.progress.hidden = true;
    this.notice(error instanceof Error ? error.message : String(error));
  }
  async addFiles(files: File[]) {
    const videos = files.filter((f) => supportedVideo(f.name)),
      subs = files.filter((f) => /\.(srt|vtt)$/i.test(f.name));
    if (!videos.length) {
      if (this.current && subs.length) {
        for (const file of subs) await this.importSubtitle(file);
        return;
      }
      throw new Error('Select a video file, or open a video before adding subtitles.');
    }
    for (let i = 0; i < videos.length; i++) {
      if (this.closed) return;
      try {
        if (i === 0) await this.openSource(localSource(videos[i]), subs);
        else await this.register(localSource(videos[i]), subs);
      } catch (e) {
        this.error(e);
      }
    }
  }
  private async register(source: ByteSource, subs: File[], handle?: FileSystemFileHandle) {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    this.notice(`Adding ${source.name}…`);
    const key = await identify(source, signal);
    if (this.closed) return;
    this.sources.set(key, source);
    await this.store.putLocal(this.options.scope, 'aliases', key, {
      key,
      name: source.name,
      ...(handle ? { handle } : {}),
      ...(source.cloud ? { cloud: source.cloud } : {})
    } satisfies Alias);
    if (!(await this.store.get(this.options.scope, 'video_info', key)))
      await this.store.edit(this.options.scope, 'video_info', key, key, {
        version: 1,
        title: source.name,
        duration: 0,
        width: 0,
        height: 0,
        addedAt: Date.now()
      });
    for (const sub of subs)
      if (matchSidecar(source.name, sub.name)) await this.saveSubtitle(key, source.name, sub);
    await this.refresh();
  }
  async openSource(
    source: ByteSource,
    subs: File[] = [],
    expected?: ContentKey,
    handle?: FileSystemFileHandle
  ) {
    ++this.openIntent;
    const generation = ++this.generation;
    this.openAbort?.abort();
    const controller = (this.openAbort = new AbortController()),
      signal = controller.signal;
    await this.player?.dispose();
    if (this.closed || generation !== this.generation) return;
    this.current = undefined;
    this.audioChoices = [];
    this.audio.replaceChildren();
    this.audio.disabled = true;
    const active = () => !this.closed && generation === this.generation && !signal.aborted;
    const guard = () => {
      if (!active()) throw new DOMException('Video opening was replaced', 'AbortError');
    };
    const player = (this.player = new VideoPlayer({
      scope: this.options.scope,
      source,
      store: this.store,
      onError: (m) => {
        if (active()) this.notice(m);
      },
      onGenerate: async () => {
        if (active()) return await this.generate();
        return undefined;
      },
      onAppearance: this.options.onAppearance,
      onImport: () => {
        if (active()) this.pickSubtitle();
      },
      onExport: (t) => this.export(source.name, t)
    }));
    this.viewing.replaceChildren(player.root);
    this.notice('Preparing portable progress identity. Playback is already available.');
    this.progress.hidden = false;
    this.progress.max = source.size;
    try {
      try {
        const sampled = await deviceKey(source, signal);
        guard();
        await player.bindDeviceCheckpoint(sampled);
        guard();
      } catch {
        guard();
        this.notice('Device resume is unavailable; playback remains available.');
      }
      const key = await identify(source, signal, (n) => {
        if (active()) this.progress.value = n;
      });
      guard();
      if (expected && key !== expected)
        throw new Error('The selected file is not the saved video. Its old progress was kept.');
      this.current = { key, source };
      this.sources.set(key, source);
      await this.store.putLocal(this.options.scope, 'aliases', key, {
        key,
        name: source.name,
        ...(handle ? { handle } : {}),
        ...(source.cloud ? { cloud: source.cloud } : {})
      } satisfies Alias);
      guard();
      const existing = await this.store.get(this.options.scope, 'video_info', key);
      guard();
      if (!existing) {
        const v = player.video;
        await this.store.edit(
          this.options.scope,
          'video_info',
          key,
          key,
          {
            version: 1,
            title: source.name,
            duration: Number.isFinite(v.duration) ? v.duration : 0,
            width: v.videoWidth || 0,
            height: v.videoHeight || 0,
            addedAt: Date.now()
          },
          null
        );
        guard();
      }
      await player.bindIdentity(key);
      guard();
      for (const sub of subs) {
        guard();
        if (matchSidecar(source.name, sub.name)) await this.saveSubtitle(key, source.name, sub);
      }
      guard();
      await this.refreshTracks();
      guard();
      this.progress.hidden = true;
      this.notice(
        'Choose Generate transcript when you need captions. Nothing is generated automatically.'
      );
      void this.discover(source, key, signal, generation);
      void this.loadAudio(source, signal, generation);
      await this.refresh();
    } catch (e) {
      if (active()) this.error(e);
    }
  }
  private async discover(
    source: ByteSource,
    key: ContentKey,
    signal: AbortSignal,
    generation: number
  ) {
    try {
      const result = await discoverEmbedded(source, signal);
      signal.throwIfAborted();
      if (this.closed || generation !== this.generation) return;
      await this.saveEmbedded(key, result.tracks, signal);
      if (this.closed || generation !== this.generation || signal.aborted) return;
      await this.refreshTracks();
      if (generation === this.generation)
        this.player?.setDiscovery(result.state === 'complete' ? 'complete' : 'limited');
      if (generation === this.generation && result.warnings.length)
        this.notice(result.warnings.join(' '));
    } catch (e) {
      if (!signal.aborted && generation === this.generation) {
        this.player?.setDiscovery('limited');
        this.error(e);
      }
    }
  }
  private async saveEmbedded(
    key: ContentKey,
    tracks: Awaited<ReturnType<typeof discoverEmbedded>>['tracks'],
    signal: AbortSignal
  ) {
    const existing = await this.store.tracks(this.options.scope, key);
    for (const t of tracks) {
      signal.throwIfAborted();
      if (this.closed) return;
      if (
        existing.some(
          (old) =>
            old.origin === 'embedded' &&
            old.language === t.language &&
            old.forced === t.forced &&
            cueDigest(old.cues) === cueDigest(t.cues)
        )
      )
        continue;
      const track: Track = {
        ...t,
        version: 1,
        id: crypto.randomUUID(),
        mediaKey: key,
        origin: 'embedded',
        kind: 'transcription',
        complete: true,
        createdAt: Date.now()
      };
      await this.store.saveTrack(this.options.scope, track);
      existing.push(track);
    }
  }
  private async loadAudio(source: ByteSource, signal: AbortSignal, generation: number) {
    let pipeline: MediaPipeline | undefined;
    try {
      pipeline = new MediaPipeline(await this.options.loadBunny(), source, signal);
      const raw = await pipeline.describeAudioTracks();
      signal.throwIfAborted();
      const descriptions: AudioChoice[] = raw.map((t) => ({
        ...t,
        language: audioLanguage(t.language)
      }));
      if (this.closed || signal.aborted || generation !== this.generation) return;
      this.audioChoices = descriptions;
      this.audio.replaceChildren();
      const placeholder = make('option', 'Choose an audio track');
      placeholder.value = '';
      this.audio.append(placeholder);
      for (const t of descriptions) {
        const role = t.commentary
          ? ' · Commentary'
          : t.visuallyImpaired
            ? ' · Audio description'
            : t.original
              ? ' · Original'
              : t.primary
                ? ' · Primary'
                : '';
        const option = make(
          'option',
          `${t.language} · ${t.name || `Audio ${t.id}`}${role}${t.decodable ? '' : ' (unsupported codec)'}`
        );
        option.value = String(t.id);
        option.disabled = !t.decodable;
        this.audio.append(option);
      }
      this.audio.disabled = !descriptions.some((t) => t.decodable);
      this.audio.value = String(chooseTranscriptionAudio(descriptions, this.lang.value)?.id ?? '');
      this.player?.setGenerationAvailable(descriptions.some((t) => t.decodable));
      if (!descriptions.length) this.notice('This video has no audio track to transcribe.');
    } catch (e) {
      if (!signal.aborted && generation === this.generation)
        this.notice(
          'Audio inspection is unavailable: ' + (e instanceof Error ? e.message : String(e))
        );
    } finally {
      pipeline?.dispose();
    }
  }
  async importSubtitle(file: File) {
    if (!this.current) throw new Error('Wait for the video identity before importing captions');
    await this.saveSubtitle(this.current.key, this.current.source.name, file);
    await this.refreshTracks();
  }
  private async saveSubtitle(key: ContentKey, name: string, file: File) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Subtitles must be at most 5 MiB');
    const found = matchSidecar(name, file.name),
      cues = parseSubtitles(await file.text()),
      lang = trackLanguage({ language: found?.language ?? 'und', cues });
    const existing = await this.store.tracks(this.options.scope, key);
    const kind = 'transcription'; // Role is the viewer's selection, not a language-based guess.
    const forced = found?.forced ?? false,
      digest = cueDigest(cues);
    // The timing/text alone do not identify a track's role. A forced or
    // generated copy must not swallow the user's authored full sidecar.
    if (
      existing.some(
        (t) =>
          t.origin === 'sidecar' &&
          t.language === lang &&
          t.kind === kind &&
          t.forced === forced &&
          cueDigest(t.cues) === digest
      )
    )
      return;
    await this.store.saveTrack(this.options.scope, {
      version: 1,
      id: crypto.randomUUID(),
      mediaKey: key,
      label: `${lang} · ${file.name}`,
      language: lang,
      kind,
      origin: 'sidecar',
      complete: true,
      forced,
      createdAt: Date.now(),
      cues
    });
  }
  private pickSubtitle() {
    const current = this.current,
      generation = this.generation;
    if (!current) {
      this.notice('Wait for the video identity before importing captions.');
      return;
    }
    const input = make('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.srt,.vtt';
    input.addEventListener('change', () => {
      void (async () => {
        for (const file of input.files ?? []) {
          if (this.closed || generation !== this.generation || this.current !== current) return;
          await this.saveSubtitle(current.key, current.source.name, file);
        }
        if (this.current === current) await this.refreshTracks();
      })().catch((e) => {
        if (generation === this.generation) this.error(e);
      });
    });
    input.click();
  }
  private export(name: string, track: Track) {
    downloadSubtitles(name, track);
  }
  refreshDisplay() {
    this.player?.reflow();
  }
  async generate() {
    const current = this.current,
      lang = language(this.lang.value);
    if (!current) throw new Error('The video is still preparing. Playback remains available.');
    const selected = this.audioChoices.find(
      (t) => String(t.id) === this.audio.value && t.decodable
    );
    if (!selected) {
      const panel = this.audio.closest('details');
      if (panel) panel.open = true;
      this.audio.focus();
      this.audio.scrollIntoView({ block: 'nearest' });
      throw new Error('Choose which audio track to transcribe, then press Generate transcript.');
    }
    if (
      lang !== 'und' &&
      selected.language !== 'und' &&
      selected.language.split('-')[0] !== lang.split('-')[0]
    )
      throw new Error(
        `The selected audio is ${selected.language}. Change the caption language or select a matching audio track.`
      );
    const duration = this.player?.video.duration;
    if (!duration || !Number.isFinite(duration)) throw new Error('Video duration is unavailable');
    const job = await this.queue.enqueue(
      current.key,
      lang === 'und' ? selected.language : lang,
      String(selected.id),
      duration
    );
    await this.refreshJobs();
    return job.id;
  }
  private async bulk() {
    const lang = language(this.lang.value),
      selection = [...this.selected],
      skipped: string[] = [];
    for (const key of selection) {
      this.lifetime.signal.throwIfAborted();
      let tracks = await this.store.tracks(this.options.scope, key);
      if (missingTranscriptDecision(tracks, lang, 'complete') === 'present') continue;
      const source = await this.resolveSource(key);
      // An unopened folder import may already contain captions. Inspect first;
      // selection must not silently turn "unknown" into "missing".
      const discovered = await discoverEmbedded(source, this.lifetime.signal);
      await this.saveEmbedded(key, discovered.tracks, this.lifetime.signal);
      tracks = await this.store.tracks(this.options.scope, key);
      const decision = missingTranscriptDecision(tracks, lang, discovered.state);
      if (decision === 'present') continue;
      if (decision === 'inspect-manually') {
        skipped.push(source.name);
        continue;
      }
      const pipeline = new MediaPipeline(
        await this.options.loadBunny(),
        source,
        this.lifetime.signal
      );
      try {
        const raw = await pipeline.describeAudioTracks(),
          meta = await pipeline.metadata();
        if (!raw.length) throw new Error(`${source.name} has no audio`);
        const descriptions: AudioChoice[] = raw.map((t) => ({
          ...t,
          language: audioLanguage(t.language)
        }));
        const selected = chooseTranscriptionAudio(descriptions, lang);
        if (!selected) {
          skipped.push(source.name);
          continue;
        }
        this.lifetime.signal.throwIfAborted();
        await this.queue.enqueue(
          key,
          lang === 'und' ? selected.language : lang,
          String(selected.id),
          meta.duration
        );
      } finally {
        pipeline.dispose();
      }
    }
    if (skipped.length)
      this.notice(
        `Skipped ${skipped.length} video(s) whose captions or target-language audio track need inspection. Open each skipped video and choose its audio track and Generate explicitly.`
      );
    await this.refreshTracks();
  }
  private async resolveSource(
    key: ContentKey,
    signal: AbortSignal = this.lifetime.signal
  ): Promise<ByteSource> {
    signal.throwIfAborted();
    const available = this.sources.get(key);
    if (available && (!available.isCurrent || available.isCurrent())) return available;
    const alias = await abortable(signal, () =>
      this.store.local<Alias>(this.options.scope, 'aliases', key)
    );
    signal.throwIfAborted();
    let source: ByteSource | undefined;
    if (alias?.handle) source = localSource(await abortable(signal, () => alias.handle!.getFile()));
    else if (alias?.cloud && this.options.transport) {
      const transport = this.options.transport;
      const manifest = await cloudRequest<CloudManifest>(
        transport,
        cloudInfoPath(alias.cloud),
        signal
      );
      source = cloudSource(manifest, transport.userId, transport.isCurrent);
    }
    if (!source)
      throw new Error(
        'Reopen this video to reconnect its local file, or sign in to reconnect its cloud folder.'
      );
    // A saved locator grants no authority and is not content identity. The server
    // rechecks the selected root; byte verification must match before attaching data.
    if ((await abortable(signal, () => identify(source!, signal))) !== key)
      throw new Error(
        'A video file changed. Reopen it before generating captions. Its previous progress was kept.'
      );
    signal.throwIfAborted();
    this.sources.set(key, source);
    return source;
  }
  private async reopen(key: ContentKey) {
    const intent = ++this.openIntent;
    const source = await this.resolveSource(key);
    if (this.closed || intent !== this.openIntent) return;
    const alias = await this.store.local<Alias>(this.options.scope, 'aliases', key);
    if (this.closed || intent !== this.openIntent) return;
    await this.openSource(source, [], key, alias?.handle);
  }
  private refreshTracks(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.tracksDirty = true;
    if (!this.tracksRead)
      this.tracksRead = (async () => {
        try {
          do {
            try {
              await this.drainTrackRefresh();
            } catch (e) {
              if (this.closed || !this.tracksDirty) throw e;
            }
            // A notification can arrive after the drain's final await but
            // before this continuation. Consume it before clearing ownership.
          } while (!this.closed && this.tracksDirty);
        } finally {
          this.tracksRead = undefined;
        }
      })();
    return this.tracksRead;
  }
  private async drainTrackRefresh() {
    while (!this.closed && this.tracksDirty) {
      this.tracksDirty = false;
      const current = this.current,
        player = this.player;
      if (!current || !player) continue;
      let tracks: Track[];
      try {
        tracks = await this.store.tracks(this.options.scope, current.key);
      } catch (e) {
        // A failing old read must not abort a newer requested refresh.
        if (this.closed || current !== this.current || player !== this.player || this.tracksDirty)
          continue;
        throw e;
      }
      if (this.closed || current !== this.current || player !== this.player || this.tracksDirty)
        continue;
      player.setTracks(tracks);
    }
  }
  private async refresh() {
    const generation = ++this.refreshing;
    try {
      const [metadata, positions] = await Promise.all([
        this.store.records(this.options.scope, 'video_info'),
        this.store.records(this.options.scope, 'video_resume')
      ]);
      if (this.closed || generation !== this.refreshing) return;
      const resume = new Map(
          positions.filter((r) => r.payload).map((r) => [r.id, r.payload as unknown as Playback])
        ),
        items = metadata
          .filter((r) => r.payload)
          .map((r) => ({
            key: r.mediaKey,
            info: r.payload as unknown as VideoInfo,
            localVersion: r.localVersion
          }))
          .filter(({ info }) =>
            info.title.toLocaleLowerCase().includes(this.search.value.toLocaleLowerCase())
          )
          .filter(({ key }) => {
            const p = resume.get(key);
            return (
              this.filter.value === 'all' ||
              (this.filter.value === 'finished'
                ? p?.finished
                : this.filter.value === 'continue'
                  ? p && !p.finished && p.position > 0
                  : !p || (!p.finished && p.position === 0))
            );
          });
      items.sort((a, b) =>
        this.sort.value === 'title'
          ? a.info.title.localeCompare(b.info.title)
          : (resume.get(b.key)?.updatedAt ?? b.info.addedAt) -
            (resume.get(a.key)?.updatedAt ?? a.info.addedAt)
      );
      this.selected = new Set([...this.selected].filter((k) => items.some((i) => i.key === k)));
      const focused =
        document.activeElement instanceof HTMLElement && this.shelf.contains(document.activeElement)
          ? document.activeElement
          : undefined;
      const focusedKey = focused?.closest<HTMLElement>('[data-media-key]')?.dataset.mediaKey;
      const focusedCommand = focused?.dataset.command;
      const openedMenus = new Set(
        [...this.shelf.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
          (e) => e.closest<HTMLElement>('[data-media-key]')?.dataset.mediaKey
        )
      );
      this.shelf.replaceChildren();
      if (!items.length)
        this.shelf.append(
          make(
            'p',
            this.search.value || this.filter.value !== 'all'
              ? 'No videos match this view.'
              : 'Add your videos to build a private, caption-ready library.'
          )
        );
      for (const { key, info, localVersion } of items) {
        const card = make('article');
        card.className = 'video-card';
        card.dataset.mediaKey = key;
        const checkbox = make('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.command = 'select';
        checkbox.value = key;
        checkbox.checked = this.selected.has(key);
        checkbox.setAttribute('aria-label', `Select ${info.title}`);
        checkbox.addEventListener('change', () =>
          checkbox.checked ? this.selected.add(key) : this.selected.delete(key)
        );
        const title = action(info.title, () => void this.reopen(key).catch((e) => this.error(e)));
        title.className = 'video-card-title';
        title.dataset.command = 'title';
        const p = resume.get(key);
        card.append(
          checkbox,
          title,
          make(
            'p',
            p
              ? `${formatMediaTime(p.position)} / ${formatMediaTime(p.duration)}${p.finished ? ' · Finished' : ''}`
              : 'Not watched'
          )
        );
        const menu = make('details');
        menu.className = 'video-menu';
        menu.append(
          make('summary', 'Actions'),
          action('Open video', () => void this.reopen(key).catch((e) => this.error(e))),
          action('Generate missing transcript', () => {
            this.selected = new Set([key]);
            void this.bulk().catch((e) => this.error(e));
          }),
          action('Rename title', () => {
            const title = window.prompt('Video display title', info.title);
            if (title?.trim())
              void this.store
                .edit(
                  this.options.scope,
                  'video_info',
                  key,
                  key,
                  { ...info, title: title.trim() },
                  localVersion
                )
                .catch((e) => this.error(e));
          })
        );
        card.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          menu.open = true;
          menu.querySelector('button')?.focus();
        });
        menu.open = openedMenus.has(key);
        menu.querySelector('summary')!.dataset.command = 'actions';
        [...menu.querySelectorAll('button')].forEach((button, i) => {
          button.dataset.command = `action-${i}`;
        });
        card.append(menu);
        this.shelf.append(card);
        if (focusedKey === key && focusedCommand) {
          [...card.querySelectorAll<HTMLElement>('[data-command]')]
            .find((e) => e.dataset.command === focusedCommand)
            ?.focus({ preventScroll: true });
        }
      }
    } catch (e) {
      this.error(e);
    }
  }
  private refreshJobs(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.jobsDirty = true;
    if (!this.jobsRead)
      this.jobsRead = (async () => {
        try {
          do {
            try {
              await this.drainJobRefresh();
            } catch (e) {
              if (this.closed || !this.jobsDirty) throw e;
            }
            // A notification can arrive after the drain's final await but
            // before this continuation. Consume it before clearing ownership.
          } while (!this.closed && this.jobsDirty);
        } finally {
          this.jobsRead = undefined;
        }
      })();
    return this.jobsRead;
  }
  private async drainJobRefresh() {
    while (!this.closed && this.jobsDirty) {
      this.jobsDirty = false;
      const jobs = (await this.store.listLocal<unknown>(this.options.scope, 'jobs')).map(
        validateJob
      );
      if (this.closed) return;
      // A newer notification arrived while reading: don't flash an older state.
      if (this.jobsDirty) continue;
      this.renderJobs(jobs);
    }
  }
  private renderJobs(jobs: Job[]) {
    this.jobs.replaceChildren();
    if (jobs.length) this.jobs.append(make('h2', 'Transcription queue'));
    for (const job of jobs.slice().sort((a, b) => b.createdAt - a.createdAt)) {
      const row = make('div');
      row.className = 'job-row';
      row.append(
        make('span', `${job.language} · ${job.status}${job.error ? ` — ${job.error}` : ''}`)
      );
      if (['running', 'queued'].includes(job.status))
        row.append(
          action('Cancel', () => void this.queue.cancel(job.id).catch((e) => this.error(e)))
        );
      if (['paused', 'failed', 'queued'].includes(job.status))
        row.append(
          action(job.status === 'queued' ? 'Run here' : 'Resume', () =>
            void this.queue.resume(job.id).catch((e) => this.error(e))
          )
        );
      this.jobs.append(row);
    }
  }
  private scheduleSync() {
    if (!this.options.transport || !this.syncEnabled.checked || this.closed || this.syncInFlight)
      return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.doSync(), 1000);
  }
  private stopSync() {
    ++this.syncEpoch;
    this.syncAbort.abort();
    this.syncAbort = new AbortController();
    this.syncInFlight = false;
    clearTimeout(this.syncTimer);
  }
  setConnection(connection: WorkspaceConnection | undefined) {
    this.cloudAbort.abort();
    this.cloudAbort = new AbortController();
    this.stopSync();
    this.options.transport = connection?.transport;
    this.options.chooseConnected = connection?.chooseConnected;
    this.cloudButton.hidden = !connection;
    this.syncEnabled.disabled = !connection;
    this.scheduleSync();
  }
  private async doSync() {
    const transport = this.options.transport;
    if (this.closed || !transport || !this.syncEnabled.checked || this.syncInFlight) return;
    const epoch = this.syncEpoch,
      signal = this.syncAbort.signal;
    let succeeded = false;
    this.syncInFlight = true;
    try {
      await syncMedia(this.store, transport, signal, (status) => {
        if (epoch === this.syncEpoch) this.showSync(status);
      });
      succeeded = true;
      if (epoch === this.syncEpoch) await this.refreshTracks();
    } catch (error) {
      if (!signal.aborted && epoch === this.syncEpoch) this.error(error);
    } finally {
      if (epoch === this.syncEpoch) {
        this.syncInFlight = false;
        // Changes made while their predecessor was uploading need a new pass.
        // Read after clearing the flag so a later edit can schedule itself too.
        // Failed requests keep their pending mutation but use the normal poll cadence,
        // not a tight one-second retry loop against an unavailable account API.
        if (succeeded && !this.closed && this.syncEnabled.checked && !signal.aborted) {
          try {
            const remaining = await this.store.records(this.options.scope);
            if (
              epoch === this.syncEpoch &&
              remaining.some((r) => !r.conflict && (r.dirty || r.pending))
            )
              this.scheduleSync();
          } catch (e) {
            if (epoch === this.syncEpoch && !this.closed) this.error(e);
          }
        }
      }
    }
  }
  private showSync(status: SyncStatus) {
    if (this.closed) return;
    this.syncPanel.replaceChildren(make('p', status.message));
    for (const r of status.conflicts) {
      const row = make('div');
      row.append(make('span', `${r.kind}: ${r.id.slice(0, 20)}…`));
      for (const choice of ['local', 'remote'] as const)
        row.append(
          action(
            choice === 'local' ? 'Keep this device' : 'Use synced copy',
            () =>
              void this.store
                .resolve(this.options.scope, r.kind, r.id, choice)
                .then(() => this.scheduleSync())
                .catch((e) => this.error(e))
          )
        );
      this.syncPanel.append(row);
    }
  }
  private async folder() {
    const picker = (
      window as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker)
      throw new Error(
        'Folder access is unavailable here. Add videos and their subtitle files together instead.'
      );
    const root = await picker();
    const dirs: {
      handle: FileSystemDirectoryHandle;
      depth: number;
    }[] = [{ handle: root, depth: 0 }];
    let total = 0;
    while (dirs.length) {
      this.lifetime.signal.throwIfAborted();
      const { handle, depth } = dirs.shift()!;
      if (depth > 24) throw new Error('Folder nesting exceeds 24 levels');
      const files: {
        file: File;
        handle: FileSystemFileHandle;
      }[] = [];
      for await (const item of (
        handle as FileSystemDirectoryHandle & {
          values(): AsyncIterable<FileSystemHandle>;
        }
      ).values()) {
        this.lifetime.signal.throwIfAborted();
        if (++total > 10000) throw new Error('Folder exceeds 10,000 entries');
        if (item.kind === 'directory' && !item.name.startsWith('.'))
          dirs.push({ handle: item as FileSystemDirectoryHandle, depth: depth + 1 });
        if (item.kind === 'file' && (supportedVideo(item.name) || /\.(srt|vtt)$/i.test(item.name)))
          files.push({
            file: await (item as FileSystemFileHandle).getFile(),
            handle: item as FileSystemFileHandle
          });
      }
      const subs = files.filter((f) => /\.(srt|vtt)$/i.test(f.file.name)).map((f) => f.file);
      for (const { file, handle } of files.filter((f) => supportedVideo(f.file.name)))
        await this.register(localSource(file), subs, handle);
    }
    this.notice('Folder scanned. Nothing was transcribed or written beside your videos.');
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.generation++;
    this.lifetime.abort();
    this.cloudAbort.abort();
    this.openAbort?.abort();
    this.syncAbort.abort();
    clearTimeout(this.syncTimer);
    clearInterval(this.poll);
    this.stopStore();
    // Hide the outgoing account and stop sound before waiting for a large model
    // or slow storage. Neither drain is allowed to skip the other on failure.
    this.root.remove();
    this.player?.video.pause();
    const queue = Promise.resolve().then(() => this.queue.dispose());
    const player = Promise.resolve().then(() => this.player?.dispose());
    this.closing = Promise.allSettled([queue, player]).then(async (results) => {
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (!this.options.store) {
        try {
          await this.store.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Video workspace shutdown failed');
    });
    return this.closing;
  }
}
