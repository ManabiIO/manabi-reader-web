/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  type Cue,
  type Track,
  type Playback,
  type ContentKey,
  type CaptionStyle,
  DEFAULT_STYLE,
  validatePlayback,
  validateStyle,
  isUUID
} from './contracts.js';
import { dialogueText } from './dialogue.js';
import { element, button, iconButton, TranscriptMenu } from './player-controls.js';
import { trackLanguage, languageName, translationCandidate } from './track-selection.js';
import { studySpans, seekSpan, LinePause, type StudySpan } from './study.js';
import { type CueTimeline, chooseLayout } from './captions.js';
import { formatMediaTime } from './time.js';
import type { TranscriptionDraft } from './transcription-draft.js';
import { jobContentKey, type Job } from './jobs.js';
import {
  sparseBounds,
  sparsePlaybackSnapshot,
  type SparsePlaybackSnapshot,
  SPARSE_CORE_SECONDS,
  SPARSE_CONTEXT_SECONDS
} from './sparse-transcription.js';
import { cueDigest } from './captions.js';
import { temporaryTrackReplacements } from './authored-track.js';
import { TrackCatalog } from './track-catalog.js';
import { type ByteSource } from './sources.js';
import { MediaStore } from './store.js';
import { DeviceCheckpoints, type DeviceKey, type DevicePlayback } from './device-checkpoint.js';
import { type Scope } from './contracts.js';
export interface PlayerOptions {
  scope: Scope;
  key?: ContentKey;
  source: ByteSource;
  store: MediaStore;
  onError(message: string): void;
  onGenerate(): void | Promise<string | void>;
  onPosition?(seconds: number): void;
  onAppearance?(trigger: HTMLElement): void;
  preferredLanguages?: readonly string[];
  onImport(): void;
  onExport(track: Track): void;
}
/** Framework-neutral controller mounted by the Svelte route. All caption text uses textContent. */
export class VideoPlayer {
  readonly root = element('section');
  readonly video = element('video');
  private stage = element('div');
  private overlay = element('div');
  private pane = element('section');
  private transcript = element('div');
  private toolbar = element('div');
  private studyBar = element('div');
  private cuePrevious = button('Previous line', () => this.seekLine(-1));
  private cueReplay = button('Replay line', () => this.seekLine(0));
  private cueNext = button('Next line', () => this.seekLine(1));
  private autoPause = element('input');
  private linePause = new LinePause();
  private studyTimeline?: CueTimeline;
  private studyDelay = 0;
  private studyTrack = '';
  private progressNote = element('p');
  private provisional = element('div');
  private publishedTracks: Track[] = [];
  private temporaryTracks: Track[] = [];
  private activeJob?: Job;
  private sparsePlayback?: SparsePlaybackSnapshot;
  private draftDigests = new Map<string, string>();
  private waitingForOriginLock?: string;
  private firstWindowJob?: string;
  private firstWindowStartedAt?: number;
  private firstWindowClock?: ReturnType<typeof setInterval>;
  private followGeneratedCaptions = false;
  private waitForCaptions = false;
  private resumeAfterBuffer = false;
  private bufferStatus = element('p');
  private bypassButton = button('Play without captions', () => this.bypassCaptions());
  private waitButton = button('Wait for captions', () => this.waitForBuffer());
  private drafts: TranscriptionDraft[] = [];
  private preview?: { id: string; cues: Cue[] };
  private retiredPreviews = new Set<string>();
  private draftSelectionRestored = false;
  // Recognition provenance survives a temporarily missing job or caption page.
  private localDraftIds = new Set<string>();
  private publishedIds = new Set<string>();
  private draftSaving: Promise<void> = Promise.resolve();
  private draftSavingActive = false;
  private pendingDraftSave?: { key: ContentKey; id: string | null };
  private spans: StudySpan[] = [];
  private menu = new TranscriptMenu();
  private setup = element('div');
  private setupTracks = element('select');
  private setupNote = element('p');
  private setupStatus = element('p');
  private generationBusy = false;
  private selectionIntent = 0;
  private pendingGenerated?: string;
  // Only retained while an explicit Generate admission is awaiting its job ID.
  private generationOutcomes?: Map<string, 'paused' | 'failed'>;
  private generationAvailable = false;
  private generationUnavailableReason?: string;
  private discovery: 'loading' | 'complete' | 'limited' = 'loading';
  private translationAutomatic = false;
  private transcriptOpen = true;
  private viewTouched = false;
  private scrollUpdate = false;
  private renderedStart = -1;
  private renderedEnd = -1;
  private readonly windowSize = 180;
  private cueIndexes = new Map<string, number>();
  private translationToggle = button('Hide translation', () => {
    this.translationVisible = !this.translationVisible;
    this.saveView();
    this.activeSignature = '';
    this.transcriptSignature = '';
    this.render();
    this.menu.close();
  });
  private translationVisible = true;
  private primary = element('select');
  private secondary = element('select');
  private generate: HTMLButtonElement;
  private theaterButton = iconButton('Theater mode', 'theater', () => this.toggleTheater());
  private transcriptButton = iconButton('Show transcript', 'transcript', () =>
    this.setTranscriptOpen(true)
  );
  private exportButton = button('Download subtitles', () => {
    if (this.closed) return;
    try {
      const track = this.exportTrack();
      if (track) this.options.onExport(track);
    } catch (error) {
      this.error(error);
    } finally {
      this.menu.close();
    }
  });
  private follow = element('input');
  private primaryDelay = element('input');
  private secondaryDelay = element('input');
  private tracks: Track[] = [];
  private catalog = new TrackCatalog();
  private style: CaptionStyle = { ...DEFAULT_STYLE };
  private closed = false;
  private ready = false;
  private restored = false;
  private restoring?: Promise<void>;
  private device?: DeviceCheckpoints;
  private deviceState?: DevicePlayback;
  private deviceRestored = false;
  private deviceLoaded = false;
  private restoringSeek?: number;
  private restoringRate?: number;
  private styleTouched = false;
  private writes = true;
  private touched = false;
  private selectionTouched = false;
  private key?: ContentKey;
  /** Can be a device-only job key while portable playback has no content identity. */
  private generationKey?: ContentKey;
  private version: string | null = null;
  private saving: Promise<void> = Promise.resolve();
  private savingActive = false;
  private pendingSave?: Playback;
  private closing?: Promise<void>;
  private position: Playback | undefined;
  private delays: Record<string, number> = {};
  private lastSave = 0;
  private activeSignature = '';
  private transcriptSignature = '';
  private theater = false;
  private layout: 'side' | 'below' = 'below';
  private pageIndex = 0;
  private frame = 0;
  private observer: ResizeObserver;
  private release: () => void;
  private alive = new AbortController();
  constructor(private options: PlayerOptions) {
    this.key = options.key;
    this.generationKey = options.key;
    this.root.className = 'manabi-video-player';
    this.root.setAttribute('aria-label', 'Video player');
    this.stage.className = 'video-stage';
    this.video.controls = true;
    this.video.playsInline = true;
    this.video.preload = 'metadata';
    this.video.disablePictureInPicture = true;
    this.video.setAttribute('controlslist', 'noremoteplayback');
    this.video.setAttribute('aria-label', options.source.name);
    this.overlay.className = 'caption-overlay';
    this.overlay.hidden = true;
    this.pane.className = 'transcript-pane';
    this.pane.setAttribute('aria-label', 'Transcript');
    this.transcript.className = 'transcript-rows';
    this.toolbar.className = 'video-toolbar';
    this.primary.setAttribute('aria-label', 'Transcript track');
    this.secondary.setAttribute('aria-label', 'Translation track');
    this.generate = button('Generate transcript', () => void this.requestGenerate());
    this.generate.className = 'media-primary-action';
    const heading = element('header');
    heading.className = 'video-player-heading';
    heading.append(element('h2', options.source.name));
    this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'Video display');
    this.theaterButton.setAttribute('aria-pressed', 'false');
    this.transcriptButton.hidden = true;
    this.toolbar.append(this.transcriptButton, this.theaterButton);
    this.studyBar.className = 'video-study-controls';
    const navigation = element('div');
    navigation.className = 'cue-navigation';
    navigation.setAttribute('role', 'group');
    navigation.setAttribute('aria-label', 'Practice a line');
    for (const [control, shortcut, label] of [
      [this.cuePrevious, 'A', 'Previous'],
      [this.cueReplay, 'S', 'Replay'],
      [this.cueNext, 'D', 'Next']
    ] as const) {
      control.setAttribute('aria-label', control.textContent!);
      control.title = `${control.textContent} (${shortcut})`;
      control.textContent = label;
      control.setAttribute('aria-keyshortcuts', shortcut);
    }
    navigation.append(this.cuePrevious, this.cueReplay, this.cueNext);
    this.studyBar.append(navigation, this.toolbar);
    this.primary.addEventListener('change', () => this.chooseTranscript(this.primary.value));
    this.secondary.addEventListener('change', () => {
      this.selectionIntent++;
      this.pendingGenerated = undefined;
      this.selectionTouched = true;
      this.translationAutomatic = false;
      if (this.secondary.value === this.primary.value) this.secondary.value = '';
      this.trackChanged();
    });
    this.autoPause.type = 'checkbox';
    this.autoPause.addEventListener('change', () => {
      this.linePause.reset();
      this.saveView();
      this.render();
    });
    this.follow.type = 'checkbox';
    this.follow.checked = true;
    this.follow.addEventListener('change', () => {
      this.saveView();
      this.activeSignature = '';
      this.transcriptSignature = '';
      this.render();
    });
    const header = element('div');
    header.className = 'transcript-header';
    header.append(element('h3', 'Transcript'), this.menu.trigger);
    this.menu.panel.append(
      this.label('Transcript', this.primary),
      this.label('Translation', this.secondary),
      this.translationToggle,
      this.label('Follow playback', this.follow),
      this.label('Pause after each line', this.autoPause)
    );
    const appearance = button('Themes & Settings', () => {
      this.menu.close();
      this.options.onAppearance?.(this.menu.trigger);
    });
    appearance.hidden = !options.onAppearance;
    this.menu.panel.append(
      appearance,
      button('Add subtitles', () => {
        this.menu.close();
        options.onImport();
      }),
      this.exportButton
    );
    for (const [input, secondary] of [
      [this.primaryDelay, false],
      [this.secondaryDelay, true]
    ] as const) {
      input.type = 'number';
      input.min = '-3600';
      input.max = '3600';
      input.step = '.1';
      input.value = '0';
      input.addEventListener('change', () => {
        const id = secondary ? this.secondary.value : this.primary.value,
          n = Number(input.value);
        if (id && input.value.trim() && Number.isFinite(n) && Math.abs(n) <= 3600) {
          this.selectionTouched = true;
          this.delays[id] = n;
          this.linePause.reset();
          this.activeSignature = '';
          this.transcriptSignature = '';
          this.render();
          this.scheduleSave(true);
        } else input.value = String(this.delays[id] ?? 0);
      });
    }
    const settings = element('details');
    settings.className = 'video-caption-settings';
    settings.append(element('summary', 'Video caption style & timing'));
    const setting = (
      name: string,
      values: readonly (string | number)[],
      selected: string,
      change: (v: string) => void
    ) => {
      const select = element('select');
      for (const v of values) {
        const o = element('option', String(v));
        o.value = String(v);
        select.append(o);
      }
      select.value = selected;
      select.addEventListener('change', () => change(select.value));
      settings.append(this.label(name, select));
    };
    // These affect the video overlay only. Transcript typography comes from the ebook settings.
    setting('Video text size', [0.75, 1, 1.25, 1.5], '1', (v) =>
      this.setStyle({ ...this.style, size: Number(v) as CaptionStyle['size'] })
    );
    setting('Video text color', ['white', 'yellow'], 'white', (v) =>
      this.setStyle({ ...this.style, color: v as CaptionStyle['color'] })
    );
    setting('Video background opacity', [0, 0.5, 0.8], '0.5', (v) =>
      this.setStyle({ ...this.style, background: Number(v) as CaptionStyle['background'] })
    );
    setting('Video text edge', ['shadow', 'outline', 'none'], 'shadow', (v) =>
      this.setStyle({ ...this.style, edge: v as CaptionStyle['edge'] })
    );
    settings.append(
      this.label('Primary offset (seconds)', this.primaryDelay),
      this.label('Second-track offset (seconds)', this.secondaryDelay)
    );
    this.menu.panel.append(
      settings,
      button('Close transcript', () => {
        this.menu.close(false);
        this.setTranscriptOpen(false);
      })
    );
    this.setup.className = 'transcript-setup';
    this.setupTracks.setAttribute('aria-label', 'Choose existing subtitles');
    this.setupTracks.addEventListener('change', () => {
      if (this.setupTracks.value) this.chooseTranscript(this.setupTracks.value);
    });
    this.setupStatus.setAttribute('role', 'status');
    this.setupStatus.className = 'transcript-setup-status';
    const add = button('Add subtitle file', options.onImport);
    add.className = 'media-text-action';
    this.setup.append(
      element('h4', 'Choose your transcript'),
      this.setupNote,
      this.label('Existing subtitles', this.setupTracks),
      this.generate,
      add,
      this.setupStatus
    );
    this.progressNote.className = 'transcription-progress-note';
    this.progressNote.setAttribute('role', 'status');
    this.progressNote.hidden = true;
    this.provisional.className = 'transcription-provisional';
    this.provisional.setAttribute('aria-label', 'Provisional transcript');
    this.provisional.hidden = true;
    this.bufferStatus.setAttribute('role', 'status');
    this.bufferStatus.hidden = true;
    this.bypassButton.hidden = true;
    this.waitButton.hidden = true;
    this.pane.append(
      header,
      this.setup,
      this.progressNote,
      this.bufferStatus,
      this.bypassButton,
      this.waitButton,
      this.transcript,
      this.provisional,
      this.menu.panel
    );
    this.stage.append(this.video, this.overlay);
    const videoColumn = element('div');
    videoColumn.className = 'video-column';
    videoColumn.append(this.stage, this.studyBar);
    const viewing = element('div');
    viewing.className = 'video-viewing';
    viewing.append(videoColumn, this.pane);
    this.root.append(heading, viewing);
    this.root.tabIndex = 0;
    const manualScroll = () => {
      if (this.follow.checked) {
        this.follow.checked = false;
        this.saveView();
      }
    };
    this.transcript.addEventListener('wheel', manualScroll, { passive: true });
    this.transcript.addEventListener('touchmove', manualScroll, { passive: true });
    this.transcript.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Tab'].includes(event.key))
        manualScroll();
    });
    this.transcript.addEventListener('scroll', () => this.scrollTranscript(), { passive: true });
    this.transcript.tabIndex = 0;
    this.transcript.setAttribute('aria-label', 'Transcript lines');
    const resource = options.source.playback();
    this.release = resource.release;
    this.video.src = resource.url;
    const signal = this.alive.signal;
    this.video.addEventListener('loadedmetadata', () => void this.loaded(), { signal });
    this.video.addEventListener(
      'play',
      () => {
        // play is queued: a later caption wait/pause can win before dispatch.
        // That obsolete event is not a fresh native-control bypass request.
        if (this.video.paused) return;
        // Native video controls also let the viewer bypass a caption wait.
        if (this.waitForCaptions) {
          this.followGeneratedCaptions = false;
          this.waitForCaptions = false;
          this.resumeAfterBuffer = false;
          this.updateBuffering();
        } else this.updateBuffering();
        if (this.video.paused) return;
        this.linePause.reset();
        this.touched = true;
        this.loop();
      },
      { signal }
    );
    this.video.addEventListener(
      'pause',
      () => {
        cancelAnimationFrame(this.frame);
        this.render();
        this.scheduleSave(true);
      },
      { signal }
    );
    this.video.addEventListener(
      'seeking',
      () => {
        options.onPosition?.(this.video.currentTime);
        this.linePause.reset();
        if (
          this.restoringSeek === undefined ||
          Math.abs(this.video.currentTime - this.restoringSeek) > 0.01
        )
          this.touched = true;
      },
      { signal }
    );
    this.video.addEventListener(
      'seeked',
      () => {
        this.restoringSeek = undefined;
        this.render();
        this.updateBuffering();
        this.scheduleSave(true);
      },
      { signal }
    );
    this.video.addEventListener(
      'ratechange',
      () => {
        if (this.restoringRate !== this.video.playbackRate) this.touched = true;
        this.restoringRate = undefined;
        this.scheduleSave(true);
      },
      { signal }
    );
    this.video.addEventListener(
      'timeupdate',
      () => {
        options.onPosition?.(this.video.currentTime);
        this.updateBuffering();
        this.render();
        this.scheduleSave(false);
      },
      { signal }
    );
    this.video.addEventListener(
      'ended',
      () => {
        this.touched = true;
        this.scheduleSave(true, true);
      },
      { signal }
    );
    this.video.addEventListener(
      'error',
      () =>
        options.onError(
          'This browser cannot play this container or codec. The original file was not changed.'
        ),
      { signal }
    );
    window.addEventListener('resize', () => this.resize(), { signal });
    this.root.addEventListener(
      'keydown',
      (event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.repeat ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        const target = event.target as Element | null;
        if (
          target?.closest(
            'input, select, textarea, button, summary, a, video, [contenteditable], [role=button]'
          )
        )
          return;
        const key = event.key.toLowerCase();
        if (key === 'a' || key === 's' || key === 'd') {
          const direction = key === 'a' ? -1 : key === 'd' ? 1 : 0;
          if (!seekSpan(this.spans, this.video.currentTime, direction)) return;
          event.preventDefault();
          this.seekLine(direction);
        } else if (key === ' ' && this.ready) {
          event.preventDefault();
          if (this.video.paused) void this.video.play().catch((e) => this.error(e));
          else this.video.pause();
        }
      },
      { signal }
    );
    document.addEventListener('fullscreenchange', () => this.resize(), { signal });
    window.addEventListener('pagehide', () => this.scheduleSave(true), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.scheduleSave(true);
      },
      { signal }
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.root);
    this.setTracks([]);
    void options.store
      .local<CaptionStyle>(options.scope, 'settings', 'captions')
      .then((s) => {
        if (s && !this.closed && !this.styleTouched) {
          this.style = validateStyle(s);
          this.applyStyle();
          for (const select of settings.querySelectorAll('select')) {
            const text = select.parentElement?.firstChild?.textContent;
            if (text === 'Video text size') select.value = String(s.size);
            if (text === 'Video text color') select.value = s.color;
            if (text === 'Video background opacity') select.value = String(s.background);
            if (text === 'Video text edge') select.value = s.edge;
          }
        }
      })
      .catch((e) => this.error(e));
    void options.store
      .local<Record<string, unknown>>(options.scope, 'settings', 'transcript-view')
      .then((view) => {
        if (!view || this.closed || this.viewTouched) return;
        if (typeof view.follow === 'boolean') this.follow.checked = view.follow;
        if (typeof view.pause === 'boolean') this.autoPause.checked = view.pause;
        if (typeof view.open === 'boolean') this.transcriptOpen = view.open;
        if (typeof view.translation === 'boolean') this.translationVisible = view.translation;
        this.applyViewingMode();
        this.activeSignature = '';
        this.transcriptSignature = '';
        this.render();
      })
      .catch((error) => this.error(error));
  }
  /** Workspace calls these only for the current file lifetime. */
  setDiscovery(state: 'loading' | 'complete' | 'limited') {
    if (this.closed) return;
    this.discovery = state;
    if (this.chooseTranslation()) {
      this.offsetControls();
      this.activeSignature = '';
      this.transcriptSignature = '';
      this.render();
      this.scheduleSave(true);
    }
    this.updateSetup();
  }
  setGenerationAvailable(available: boolean, reason?: string) {
    if (this.closed) return;
    this.generationAvailable = available;
    this.generationUnavailableReason = available ? undefined : reason;
    this.updateSetup();
  }
  generationStatus(id: string, state: string, reason?: Job['pauseReason']) {
    if (this.closed) return;
    if (state === 'waiting-for-tab') this.waitingForOriginLock = id;
    else if (this.waitingForOriginLock === id) this.waitingForOriginLock = undefined;
    if (state === 'paused' || state === 'failed' || state === 'complete') {
      this.retiredPreviews.add(id);
      if (this.preview?.id === id) this.preview = undefined;
    } else this.retiredPreviews.delete(id);
    this.updateProgressiveView();
    this.updateBuffering();
    if ((state === 'paused' && reason !== 'identity') || state === 'failed')
      this.generationOutcomes?.set(id, state);
    else this.generationOutcomes?.delete(id);
    if (id !== this.pendingGenerated) return;
    if ((state === 'paused' && reason !== 'identity') || state === 'failed') {
      this.pendingGenerated = undefined;
      this.setupStatus.textContent =
        state === 'paused'
          ? 'Transcription paused. You can resume it in the queue.'
          : 'Transcription failed. Your existing subtitles are unchanged.';
      this.updateSetup();
    }
  }
  reflow() {
    if (!this.closed) {
      this.transcriptSignature = '';
      this.activeSignature = '';
      this.resize();
      this.render();
    }
  }
  private updateSetup() {
    if (this.closed) return;
    const choosing = !this.primary.value && !this.secondary.value;
    // Main transcript selection owns setup. Preserve an existing secondary-only
    // selection, but do not offer translation as a way to bypass first-use setup.
    this.secondary.disabled = choosing;
    this.setup.hidden = !choosing;
    this.transcript.hidden = choosing;
    this.generate.disabled =
      !this.generationAvailable || !!this.pendingGenerated || this.generationBusy;
    this.generate.textContent =
      this.pendingGenerated || this.generationBusy
        ? 'Generating transcript…'
        : 'Generate transcript';
    this.updateProgressiveView();
    this.setupNote.textContent =
      this.generationUnavailableReason ??
      (this.discovery === 'loading'
        ? 'Looking for subtitles. Choose one below, or generate a transcript when the video is ready.'
        : this.discovery === 'limited'
          ? 'Some embedded subtitles could not be read. Choose an available track, add a subtitle file, or generate a transcript.'
          : this.tracks.length
            ? 'Select the language you want to follow. Translation can be added afterwards.'
            : 'Add subtitles you already have, or generate a transcript privately on this device.');
  }
  private async requestGenerate() {
    if (this.closed || this.generate.disabled || this.primary.value || this.secondary.value) return;
    // Generate is a new selection intent even before it has produced a cue.
    // Fence a pending saved-draft read before awaiting the job admission.
    const intent = ++this.selectionIntent;
    const outcomes = new Map<string, 'paused' | 'failed'>();
    this.generationOutcomes = outcomes;
    this.generationBusy = true;
    this.updateSetup();
    try {
      const id = await this.options.onGenerate();
      if (this.closed) return;
      if (typeof id === 'string' && intent === this.selectionIntent) {
        this.pendingGenerated = id;
        if (this.activeJob?.id === id && this.activeJob.sparse) this.waitForBuffer();
        const outcome = outcomes.get(id);
        if (outcome) this.generationStatus(id, outcome);
        this.applyTracks();
      }
    } catch (error) {
      this.error(error);
    } finally {
      this.generationOutcomes = undefined;
      this.generationBusy = false;
      this.updateSetup();
    }
  }
  private chooseTranscript(id: string) {
    if (this.closed) return;
    this.selectionTouched = true;
    this.selectionIntent++;
    this.pendingGenerated = undefined;
    this.primary.value = id;
    this.secondary.value = '';
    this.translationAutomatic = !!id;
    this.chooseTranslation();
    this.trackChanged();
    this.updateSetup();
    if (id) this.transcript.focus({ preventScroll: true });
  }
  private chooseTranslation(): boolean {
    // Sidecars, embedded tracks and replicated pages arrive independently. An
    // automatic choice must not privilege arrival order over the complete set.
    // Manual selection/Off and restored choices never enter this path.
    if (!this.translationAutomatic || this.discovery === 'loading') return false;
    const primary = this.tracks.find((track) => track.id === this.primary.value);
    const chosen = primary
      ? translationCandidate(
          primary,
          this.tracks,
          this.options.preferredLanguages ?? navigator.languages ?? [navigator.language]
        )
      : undefined;
    const next = chosen?.id ?? '';
    if (this.secondary.value === next) return false;
    // A later competing track makes the suggestion ambiguous; a unique exact
    // locale match can supersede a provisional family match. Neither is a new
    // user intent, so the next discovery pass may reconsider it as well.
    this.secondary.value = next;
    return true;
  }
  private saveView() {
    if (this.closed) return;
    this.viewTouched = true;
    void this.options.store
      .putLocal(this.options.scope, 'settings', 'transcript-view', {
        follow: this.follow.checked,
        pause: this.autoPause.checked,
        open: this.transcriptOpen,
        translation: this.translationVisible
      })
      .catch((error) => this.error(error));
  }
  private setTranscriptOpen(open: boolean) {
    if (this.closed) return;
    this.transcriptOpen = open;
    this.saveView();
    this.applyViewingMode();
    this.activeSignature = '';
    this.transcriptSignature = '';
    this.render();
    if (open) this.menu.trigger.focus({ preventScroll: true });
    else this.transcriptButton.focus({ preventScroll: true });
  }
  private applyViewingMode() {
    this.root.classList.toggle('transcript-closed', !this.transcriptOpen);
    this.root.classList.toggle('theater', this.theater);
    this.pane.hidden = !this.transcriptOpen;
    this.transcriptButton.hidden = this.transcriptOpen;
    this.theaterButton.setAttribute('aria-pressed', String(this.theater));
    this.theaterButton.title = this.theater ? 'Exit theater mode' : 'Theater mode';
    this.overlay.hidden = this.transcriptOpen && !this.theater;
    if (!this.transcriptOpen) this.menu.close(false);
    this.resize();
  }
  private label(name: string, control: HTMLElement) {
    const label = element('label');
    if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', name);
    label.append(document.createTextNode(name), control);
    return label;
  }
  private error(e: unknown) {
    if (!this.closed) this.options.onError(e instanceof Error ? e.message : String(e));
  }
  private async loaded() {
    if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) {
      this.error(new Error('Unknown video duration'));
      return;
    }
    this.ready = true;
    this.resize();
    this.applyDeviceState();
    await this.restore();
    await this.restoreDraftSelection();
  }
  async bindDeviceCheckpoint(key: DeviceKey) {
    if (this.closed || this.device) return;
    const device = (this.device = new DeviceCheckpoints(
      this.options.store,
      this.options.scope,
      key
    ));
    try {
      this.deviceState = await device.load();
      if (this.closed || this.device !== device) return;
      this.deviceLoaded = true;
      this.applyDeviceState();
      if (this.touched) this.scheduleSave(true);
    } catch (e) {
      this.error(e);
    }
  }
  private applyDeviceState() {
    if (!this.ready || this.closed || this.deviceRestored || !this.deviceLoaded) return;
    if (this.deviceState && !this.touched && !this.restored) {
      this.restoringSeek = Math.min(this.deviceState.position, this.video.duration);
      this.video.currentTime = this.restoringSeek;
      this.restoringRate = this.deviceState.rate;
      this.video.playbackRate = this.deviceState.rate;
    }
    // A missing state is a successful initial read, but not until a device key is bound.
    if (this.device) this.deviceRestored = true;
  }
  async bindIdentity(key: ContentKey) {
    if (this.closed) return;
    this.key = key;
    this.generationKey = key;
    await this.restore();
    await this.restoreDraftSelection();
  }
  bindProvisionalGeneration(key: ContentKey) {
    if (this.closed || this.key) return;
    this.generationKey = key;
  }
  private restore(): Promise<void> {
    if (!this.key || !this.ready || this.closed || this.restored) return Promise.resolve();
    if (!this.restoring)
      this.restoring = this.restoreOnce().finally(() => {
        this.restoring = undefined;
      });
    return this.restoring;
  }
  private async restoreOnce() {
    const key = this.key;
    if (!key || !this.ready || this.closed || this.restored) return;
    try {
      const r = await this.options.store.get(this.options.scope, 'video_resume', key);
      if (this.closed || this.key !== key) return;
      this.version = r?.localVersion ?? null;
      if (r?.payload) {
        const state = validatePlayback(r.payload);
        this.position = state;
        if (!this.selectionTouched) this.delays = state.delays;
        if (!this.touched && (!this.deviceState || state.updatedAt >= this.deviceState.updatedAt)) {
          this.restoringSeek = Math.min(state.position, this.video.duration);
          this.video.currentTime = this.restoringSeek;
          this.restoringRate = state.rate;
          this.video.playbackRate = this.restoringRate;
        }
        if (!this.selectionTouched) {
          // A feed may deliver the resume record before its caption pages.
          // Keep the saved selection visible instead of assigning a missing option.
          this.applyTracks();
        }
      }
      this.restored = true;
      this.offsetControls();
      this.activeSignature = '';
      this.render();
      if (this.touched || this.selectionTouched) this.scheduleSave(true);
      else if (
        this.deviceState &&
        (!this.position || this.deviceState.updatedAt > this.position.updatedAt)
      )
        this.scheduleSave(true, this.deviceState.finished, true);
    } catch (e) {
      this.writes = false;
      this.error(e);
    }
  }
  setTracks(tracks: Track[]) {
    if (this.closed) return;
    const wasDraft =
      this.localDraftIds.has(this.primary.value) && !this.publishedIds.has(this.primary.value);
    const replacements = temporaryTrackReplacements(this.temporaryTracks, tracks, this.key);
    let remapped = false;
    for (const picker of [this.primary, this.secondary]) {
      const replacement = replacements.get(picker.value);
      if (replacement && replacement !== picker.value) {
        const waiting = element('option');
        waiting.value = replacement;
        picker.append(waiting);
        picker.value = replacement;
        remapped = true;
      }
    }
    for (const [temporary, published] of replacements) {
      if (temporary === published) continue;
      if (Object.hasOwn(this.delays, temporary)) {
        this.delays[published] = this.delays[temporary];
        delete this.delays[temporary];
      }
    }
    this.temporaryTracks = this.temporaryTracks.filter((track) => !replacements.has(track.id));
    this.publishedTracks = [...tracks, ...this.temporaryTracks];
    for (const track of tracks) if (track.complete) this.publishedIds.add(track.id);
    this.applyTracks();
    if (remapped) this.scheduleSave(true);
    if (wasDraft && tracks.some((t) => t.id === this.primary.value && t.complete)) {
      this.saveDraftSelection();
      this.scheduleSave(true);
    }
    this.updateBuffering();
  }
  /** In-memory authored captions are usable while full content identity is verified. */
  setTemporaryTracks(tracks: Track[]) {
    if (this.closed) return;
    const oldIds = new Set(this.temporaryTracks.map((track) => track.id));
    const published = this.publishedTracks.filter((track) => !oldIds.has(track.id));
    this.temporaryTracks = tracks;
    // A later discovery result may repeat an earlier temporary item whose saved
    // version is already visible. Do not resurrect its old UUID/duplicate row.
    this.setTracks(published);
  }
  generationProgress(job: Job, stage?: string) {
    if (this.closed || this.generationKey !== jobContentKey(job)) return;
    this.activeJob = job;
    // Notifications, not object identity, define this snapshot's lifetime. Custom
    // engines/workspaces may update the same Job object before notifying again.
    this.sparsePlayback = job.sparse ? sparsePlaybackSnapshot(job.sparse, job.duration) : undefined;
    if (this.firstWindowJob !== job.id) {
      clearInterval(this.firstWindowClock);
      this.firstWindowClock = undefined;
      this.firstWindowJob = job.id;
      this.firstWindowStartedAt = undefined;
    }
    if (
      job.sparse &&
      !job.sparse.windows.some(Boolean) &&
      job.status === 'running' &&
      (stage === 'decoding' || stage === 'transcribing')
    ) {
      this.firstWindowStartedAt ??= Date.now();
      this.firstWindowClock ??= setInterval(() => this.updateBuffering(), 1000);
    } else if (!job.sparse || job.status !== 'running' || job.sparse.windows.some(Boolean)) {
      clearInterval(this.firstWindowClock);
      this.firstWindowClock = undefined;
      this.firstWindowStartedAt = undefined;
    }
    this.updateBuffering();
  }
  private waitForBuffer() {
    this.followGeneratedCaptions = true;
    this.waitForCaptions = true;
    this.resumeAfterBuffer = !this.video.paused;
    this.video.pause();
    this.updateBuffering();
  }
  private bypassCaptions() {
    this.followGeneratedCaptions = false;
    this.waitForCaptions = false;
    this.resumeAfterBuffer = false;
    this.updateBuffering();
    void this.video.play().catch((error) => this.error(error));
  }
  private pauseAtCaptionGap() {
    if (!this.followGeneratedCaptions || this.waitForCaptions || this.video.paused) return;
    this.waitForCaptions = true;
    this.resumeAfterBuffer = true;
    this.video.pause();
    this.bypassButton.hidden = false;
    this.waitButton.hidden = true;
  }
  private updateBuffering() {
    const job = this.activeJob;
    const state = job?.sparse;
    const published =
      !!job && this.publishedTracks.some((track) => track.id === job.id && track.complete);
    // Stored completed jobs deliberately omit sparse windows. The summary and
    // caption pages refresh independently; only this job's visible complete track
    // releases a caption wait, never the absence of its compacted window state.
    const finalizing = job?.version === 3 && job.status === 'complete' && !published;
    const active = (!!state && !published) || finalizing;
    if (published) {
      clearInterval(this.firstWindowClock);
      this.firstWindowClock = undefined;
      this.firstWindowStartedAt = undefined;
    }
    this.bufferStatus.hidden = !active;
    this.bypassButton.hidden = !active || !this.waitForCaptions;
    this.waitButton.hidden =
      !active || this.waitForCaptions || job.status === 'paused' || job.status === 'failed';
    if (finalizing && !state) {
      this.bufferStatus.textContent = 'Finalizing captions. You can play without captions.';
      return;
    }
    if (!active || !state) {
      if (this.waitForCaptions) {
        this.waitForCaptions = false;
        if (this.resumeAfterBuffer) {
          this.resumeAfterBuffer = false;
          void this.video.play().catch((error) => this.error(error));
        }
      }
      return;
    }
    const position = Math.min(job.duration, this.video.currentTime || 0);
    const playback = this.sparsePlayback!;
    const lead = playback.lead(position);
    // Leave two halo widths of lead so playback started near zero can use the
    // first safe window without requiring a second inference at its edge.
    const needed = Math.min(
      SPARSE_CORE_SECONDS - 2 * SPARSE_CONTEXT_SECONDS,
      job.duration - position
    );
    const nearGap = lead < needed && lead <= SPARSE_CONTEXT_SECONDS;
    if (job.status === 'complete') {
      if (nearGap) this.pauseAtCaptionGap();
      this.bufferStatus.textContent = 'Finalizing captions. You can play without captions.';
      return;
    }
    if (job.status === 'paused' || job.status === 'failed') {
      if (nearGap) this.pauseAtCaptionGap();
      this.bufferStatus.textContent =
        job.pauseReason === 'identity' && !job.verifiedMediaKey
          ? 'Captions are waiting for full video verification. You can play without captions.'
          : job.status === 'paused'
            ? 'Transcription paused. Resume it in the queue or play without captions.'
            : 'Transcription failed. You can play without captions.';
      return;
    }
    if (this.waitingForOriginLock === job.id) {
      if (nearGap) this.pauseAtCaptionGap();
      this.bufferStatus.textContent =
        'Waiting for transcription in another tab or workspace. Close a stuck tab to release its model, or play without captions.';
      return;
    }
    const { count, totalMs, inputSeconds, coreSeconds } = playback;
    const missingWindows = playback.missingWindows(position, needed);
    // A queue progress callback can precede the saved draft page. Do not start
    // playback until the accepted captions from this checkpoint are visible.
    const awaitingDraft =
      this.waitForCaptions && this.draftDigests.get(job.id) !== playback.cueDigest;
    const missing = lead < needed || awaitingDraft;
    if (nearGap) this.pauseAtCaptionGap();
    const repairing = lead < needed && !missingWindows.length;
    const workSeconds =
      missingWindows.reduce((sum, index) => {
        const bounds = sparseBounds(index, job.duration);
        return sum + bounds.end - bounds.start;
      }, 0) + (repairing ? Math.min(job.duration, 2 * SPARSE_CORE_SECONDS + 4) : 0);
    const eta =
      missing && totalMs > 0 && inputSeconds > 0
        ? `about ${formatMediaTime(Math.ceil((workSeconds * totalMs) / inputSeconds / 1000))}`
        : missing
          ? `estimating after the first window${this.firstWindowStartedAt ? ` (${formatMediaTime((Date.now() - this.firstWindowStartedAt) / 1000)} elapsed on this device)` : ''}`
          : 'ready';
    const speed =
      count && totalMs > coreSeconds * 1000
        ? ' Recognition is slower than playback; captions may need to buffer again.'
        : '';
    this.bufferStatus.textContent = `Caption lead: ${formatMediaTime(lead)}. ${
      awaitingDraft && lead >= needed
        ? 'Loading accepted captions.'
        : missing
          ? `Estimated wait for ${formatMediaTime(needed)} of coverage: ${eta}.${repairing ? ' Reconciling a caption boundary.' : ''}`
          : 'Ready to play with captions.'
    }${speed}`;
    if (this.waitForCaptions && !missing) {
      this.waitForCaptions = false;
      this.bypassButton.hidden = true;
      this.waitButton.hidden = false;
      if (this.resumeAfterBuffer) {
        this.resumeAfterBuffer = false;
        void this.video.play().catch((error) => this.error(error));
      }
    }
  }
  setDrafts(drafts: TranscriptionDraft[]) {
    if (this.closed) return;
    this.drafts = drafts
      .filter((draft) => draft.track.mediaKey === this.generationKey)
      .map((draft) => {
        const previous = this.drafts.find((old) => old.track.id === draft.track.id);
        return draft.state === 'complete' &&
          !draft.track.cues.length &&
          previous &&
          !this.publishedTracks.some((track) => track.id === draft.track.id && track.complete)
          ? { ...previous, state: draft.state }
          : draft;
      });
    this.draftDigests = new Map(
      this.drafts.map((draft) => [draft.track.id, cueDigest(draft.track.cues)])
    );
    for (const draft of this.drafts) {
      this.localDraftIds.add(draft.track.id);
      if (['paused', 'failed', 'complete'].includes(draft.state)) {
        this.retiredPreviews.add(draft.track.id);
        if (this.preview?.id === draft.track.id) this.preview = undefined;
      }
    }
    this.applyTracks();
    this.updateBuffering();
  }
  generationPreview(id: string, cues?: Cue[]) {
    if (this.closed) return;
    if (cues?.length) {
      if (this.retiredPreviews.has(id) || this.publishedIds.has(id)) return;
      this.preview = { id, cues: cues.slice(-8) };
    } else if (this.preview?.id === id) this.preview = undefined;
    this.updateProgressiveView();
  }
  private updateProgressiveView() {
    const id = this.primary.value || this.pendingGenerated;
    const draft = this.drafts.find((d) => d.track.id === id);
    const complete = this.publishedTracks.some((t) => t.id === id && t.complete);
    this.progressNote.hidden = !draft || complete;
    if (draft && !complete) {
      const lines = draft.track.cues.length
        ? draft.provisional
          ? 'Draft lines are available below; some may change after boundary repair.'
          : 'Accepted lines are available below.'
        : 'No accepted lines are ready yet.';
      this.progressNote.textContent = `${draft.state === 'complete' ? 'Finalizing transcript' : draft.state === 'failed' ? (draft.restartRequired ? 'Transcription needs a different window policy' : 'Transcription needs a retry') : draft.state === 'paused' ? 'Transcription paused' : 'Generating transcript'} · ${formatMediaTime(draft.coverage)} of ${formatMediaTime(draft.duration)} processed. ${lines} This track is not complete.`;
    }
    const cues = complete
      ? []
      : this.preview && this.preview.id === id
        ? this.preview.cues
        : (draft?.pending ?? []);
    this.provisional.hidden = !cues.length;
    this.provisional.replaceChildren();
    if (cues.length) {
      this.provisional.append(element('p', 'Provisional — these lines may change'));
      for (const cue of cues.slice(-8)) {
        const text = element('p', cue.text);
        text.dir = 'auto';
        text.lang = draft?.track.language ?? '';
        this.provisional.append(text);
      }
    }
  }
  private applyTracks() {
    const published = new Set(this.publishedTracks.map((track) => track.id));
    const tracks = [
      ...this.publishedTracks,
      ...this.drafts
        .filter((draft) => !published.has(draft.track.id) && draft.track.cues.length > 0)
        .map((draft) => draft.track)
    ];
    const selected = [this.primary.value, this.secondary.value];
    const changed = this.catalog.replace(tracks);
    this.tracks = tracks;
    const desired =
      this.selectionTouched || !this.position
        ? selected
        : [this.position.primary ?? '', this.position.secondary ?? ''];
    if (!changed && !this.pendingGenerated && desired.every((id, i) => id === selected[i])) {
      this.updateSetup();
      return;
    }
    for (const [index, picker] of [this.primary, this.secondary].entries()) {
      picker.replaceChildren();
      const off = element('option', index === 0 ? 'Choose transcript…' : 'Off');
      off.value = '';
      picker.append(off);
      // Accepted draft captions are useful as the main transcript, but an incomplete
      // local draft is not a translation track. Automatic translation already requires
      // complete candidates; make the manual picker honor the same boundary.
      const choices = index === 0 ? tracks : tracks.filter((track) => track.complete);
      for (const track of choices) {
        const o = element(
          'option',
          `${languageName(trackLanguage(track))} · ${track.label}${track.forced ? ' · Forced' : ''}`
        );
        o.value = track.id;
        picker.append(o);
      }
      const stored = index === 0 ? this.position?.primary : this.position?.secondary;
      const desired = this.selectionTouched
        ? selected[index]
        : this.position
          ? (stored ?? '')
          : selected[index];
      let selectedValue = desired;
      if (desired && !choices.some((t) => t.id === desired)) {
        if (!tracks.some((t) => t.id === desired)) {
          const waiting = element('option', 'Saved track · not available yet');
          waiting.value = desired;
          waiting.disabled = true;
          picker.append(waiting);
        } else selectedValue = ''; // Present locally, but incomplete and ineligible here.
      }
      picker.value = selectedValue;
    }
    this.setupTracks.replaceChildren();
    const placeholder = element(
      'option',
      this.tracks.length ? 'Select subtitles…' : 'No subtitles found yet'
    );
    placeholder.value = '';
    this.setupTracks.append(placeholder);
    for (const track of this.tracks.filter(
      (track) => track.complete || this.drafts.some((d) => d.track.id === track.id)
    )) {
      const option = element(
        'option',
        `${languageName(trackLanguage(track))} · ${track.label}${track.forced ? ' · Forced' : ''}`
      );
      option.value = track.id;
      this.setupTracks.append(option);
    }
    this.setupTracks.disabled = !tracks.some(
      (track) => track.complete || this.drafts.some((d) => d.track.id === track.id)
    );
    if (
      this.pendingGenerated &&
      tracks.some(
        (track) => track.id === this.pendingGenerated && (track.complete || track.cues.length > 0)
      )
    ) {
      const id = this.pendingGenerated;
      this.pendingGenerated = undefined;
      if (!this.primary.value && !this.secondary.value) this.chooseTranscript(id);
    }
    const previousTranslation = this.secondary.value;
    this.chooseTranslation();
    if (this.secondary.value !== previousTranslation) this.scheduleSave(true);
    this.updateSetup();
    this.activeSignature = '';
    this.transcriptSignature = '';
    this.offsetControls();
    this.render();
  }
  private exportTrack(): Track | undefined {
    const selected =
      this.tracks.find((t) => t.id === this.primary.value) ??
      this.tracks.find((t) => t.id === this.secondary.value);
    return selected?.complete ? selected : undefined;
  }
  private offsetControls() {
    this.exportButton.disabled = !this.exportTrack();
    this.primaryDelay.value = String(this.delays[this.primary.value] ?? 0);
    this.secondaryDelay.value = String(this.delays[this.secondary.value] ?? 0);
    this.primaryDelay.disabled = !this.primary.value;
    this.secondaryDelay.disabled = !this.secondary.value;
  }
  private trackChanged() {
    if (this.followGeneratedCaptions && this.primary.value !== this.activeJob?.id) {
      const resume = this.waitForCaptions && this.resumeAfterBuffer;
      this.followGeneratedCaptions = false;
      this.waitForCaptions = false;
      this.resumeAfterBuffer = false;
      this.updateBuffering();
      if (resume) void this.video.play().catch((error) => this.error(error));
    }
    this.updateSetup();
    // render() resets listening state only when its actual timeline/delay changes.
    this.pageIndex = 0;
    this.offsetControls();
    this.activeSignature = '';
    this.transcriptSignature = '';
    this.render();
    this.saveDraftSelection();
    this.scheduleSave(true);
  }
  private setStyle(style: CaptionStyle) {
    if (this.closed) return;
    this.styleTouched = true;
    this.style = validateStyle(style);
    this.applyStyle();
    void this.options.store
      .putLocal(this.options.scope, 'settings', 'captions', this.style)
      .catch((e) => this.error(e));
  }
  private applyStyle() {
    this.overlay.style.setProperty('--caption-scale', String(this.style.size));
    this.overlay.style.setProperty('--caption-color', this.style.color);
    this.overlay.style.setProperty('--caption-background', `rgb(0 0 0 / ${this.style.background})`);
    this.overlay.dataset.edge = this.style.edge;
  }
  private seekLine(direction: -1 | 0 | 1) {
    if (this.closed) return;
    const span = seekSpan(this.spans, this.video.currentTime, direction);
    if (!span || !this.ready || span.start >= this.video.duration) return;
    this.linePause.reset();
    if (!this.follow.checked) {
      this.follow.checked = true;
      this.saveView();
    }
    this.touched = true;
    this.video.currentTime = Math.max(0, span.start);
    void this.video.play().catch((e) => this.error(e));
  }
  private render() {
    if (this.closed) return;
    const t = this.video.currentTime,
      first = this.catalog.timeline(this.primary.value),
      second = this.catalog.timeline(this.secondary.value);
    // A saved primary selection may be waiting for pages. In that case the
    // available second track owns navigation and uses its OWN delay.
    const timeline = first ?? second;
    const trackId = first ? this.primary.value : this.secondary.value;
    const delay = this.delays[trackId] ?? 0;
    if (timeline !== this.studyTimeline || delay !== this.studyDelay) {
      const old = this.studyTimeline?.cues;
      const appendOnly =
        this.studyTrack === trackId &&
        delay === this.studyDelay &&
        old &&
        timeline &&
        old.length <= timeline.cues.length &&
        old.every((cue, index) => {
          const next = timeline.cues[index];
          return (
            cue.id === next.id &&
            cue.start === next.start &&
            cue.end === next.end &&
            cue.text === next.text &&
            cue.speaker === next.speaker
          );
        });
      this.studyTrack = trackId;
      this.studyTimeline = timeline;
      this.cueIndexes = new Map(timeline?.cues.map((cue, index) => [cue.id, index]) ?? []);
      this.renderedStart = this.renderedEnd = -1;
      this.studyDelay = delay;
      this.spans = studySpans(timeline?.cues ?? [], delay);
      if (!appendOnly) this.linePause.reset();
    }
    if (
      this.autoPause.checked &&
      !this.video.seeking &&
      this.linePause.sample(t, !this.video.paused, this.spans)
    )
      this.video.pause();
    const held = this.video.paused ? this.linePause.held?.cues : undefined;
    const a = first?.active(t, this.delays[this.primary.value] ?? 0) ?? [];
    const b = second?.active(t, this.delays[this.secondary.value] ?? 0) ?? [];
    const active = held ?? (first ? a : b);
    for (const [control, direction] of [
      [this.cuePrevious, -1],
      [this.cueReplay, 0],
      [this.cueNext, 1]
    ] as const) {
      const span = seekSpan(this.spans, t, direction);
      control.disabled = !this.ready || !span || span.start >= this.video.duration;
    }
    this.autoPause.disabled = !this.spans.length;
    this.translationToggle.disabled = !first || !second;
    this.translationToggle.textContent = this.translationVisible
      ? 'Hide translation'
      : 'Show translation';
    const signature = JSON.stringify([
      this.primary.value,
      this.secondary.value,
      a.map((c) => c.id),
      b.map((c) => c.id),
      held?.map((c) => c.id),
      this.translationVisible
    ]);
    if (signature !== this.activeSignature) {
      this.activeSignature = signature;
      this.overlay.replaceChildren();
      // After auto-pause, retain the line just heard, without seeking back
      // into its audio or changing the archived cue timing.
      const shownA = held && first ? held : a;
      const shownB =
        held && !first
          ? held
          : held && second
            ? second.overlaps(
                this.linePause.held!.start,
                this.linePause.held!.end,
                this.delays[this.secondary.value] ?? 0
              )
            : b;
      for (const [cues, secondary] of [
        [shownA, false],
        [shownB, true]
      ] as const) {
        if (!cues.length || (secondary && first && !this.translationVisible)) continue;
        const line = element('div', dialogueText(cues));
        line.className = secondary ? 'caption-line translation' : 'caption-line';
        line.dir = 'auto';
        const track = this.tracks.find(
          (track) => track.id === (secondary ? this.secondary.value : this.primary.value)
        );
        if (track) line.lang = trackLanguage(track);
        this.overlay.append(line);
      }
      this.renderTranscript(timeline, first ? second : undefined, active, trackId);
    }
  }
  private renderTranscript(
    timeline: CueTimeline | undefined,
    translation: CueTimeline | undefined,
    active: readonly Pick<Cue, 'id'>[],
    trackId: string
  ) {
    if (!timeline || !this.transcriptOpen) {
      this.updateSetup();
      if (!timeline && this.setup.hidden)
        this.transcript.replaceChildren(element('p', 'Waiting for the selected subtitles…'));
      return;
    }
    const lastPage = Math.max(0, Math.ceil((timeline.cues.length - this.windowSize) / 60));
    this.pageIndex = Math.max(0, Math.min(this.pageIndex, lastPage));
    const index = active.length ? (this.cueIndexes.get(active[0].id) ?? -1) : -1;
    if (
      this.follow.checked &&
      index >= 0 &&
      (index < this.pageIndex * 60 || index >= this.pageIndex * 60 + this.windowSize)
    )
      this.pageIndex = Math.min(lastPage, Math.max(0, Math.floor(index / 60) - 1));
    const offset = this.delays[trackId] ?? 0;
    const signature = `${trackId}:${this.secondary.value}:${this.pageIndex}:${offset}:${this.delays[this.secondary.value] ?? 0}:${this.translationVisible}`;
    if (signature !== this.transcriptSignature) {
      this.transcriptSignature = signature;
      const top = this.transcript.getBoundingClientRect().top;
      const anchor = [...this.transcript.querySelectorAll<HTMLElement>('[data-cue]')].find(
        (row) => row.getBoundingClientRect().bottom >= top
      );
      const anchorId = anchor?.dataset.cue,
        anchorTop = anchor?.getBoundingClientRect().top;
      const focusId =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>('[data-cue]')?.dataset.cue
          : undefined;
      this.transcript.replaceChildren();
      const track = this.tracks.find((track) => track.id === trackId);
      this.renderedStart = this.pageIndex * 60;
      this.renderedEnd = Math.min(timeline.cues.length, this.renderedStart + this.windowSize);
      for (const cue of timeline.cues.slice(this.renderedStart, this.renderedEnd)) {
        const row = button('', () => {
          // Selecting/copying text or using the dictionary must not unexpectedly seek.
          const selected = window.getSelection();
          if (
            selected &&
            !selected.isCollapsed &&
            selected.anchorNode &&
            row.contains(selected.anchorNode)
          )
            return;
          if (!this.ready || cue.start + offset >= this.video.duration) return;
          this.linePause.reset();
          this.touched = true;
          this.video.currentTime = Math.max(0, cue.start + offset);
          void this.video.play().catch((e) => this.error(e));
        });
        row.className = 'transcript-cue';
        row.dataset.cue = cue.id;
        const text = element('span', cue.text);
        text.className = 'transcript-text';
        text.dir = 'auto';
        if (track) text.lang = trackLanguage(track);
        row.append(text);
        const translated = this.translationVisible
          ? (translation?.overlaps(
              cue.start + offset,
              cue.end + offset,
              this.delays[this.secondary.value] ?? 0
            ) ?? [])
          : [];
        if (translated.length) {
          const line = element('span', dialogueText(translated));
          line.className = 'transcript-translation';
          line.dir = 'auto';
          const secondaryTrack = this.tracks.find((track) => track.id === this.secondary.value);
          if (secondaryTrack) line.lang = trackLanguage(secondaryTrack);
          row.append(line);
        }
        this.transcript.append(row);
      }
      if (!timeline.cues.length)
        this.transcript.append(element('p', 'No spoken lines in this transcript.'));
      if (!this.follow.checked && anchorId && anchorTop !== undefined) {
        const replacement = [...this.transcript.querySelectorAll<HTMLElement>('[data-cue]')].find(
          (row) => row.dataset.cue === anchorId
        );
        if (replacement)
          this.transcript.scrollTop += replacement.getBoundingClientRect().top - anchorTop;
      }
      if (focusId)
        [...this.transcript.querySelectorAll<HTMLElement>('[data-cue]')]
          .find((row) => row.dataset.cue === focusId)
          ?.focus({ preventScroll: true });
    }
    const ids = new Set(active.map((cue) => cue.id));
    let current: HTMLElement | undefined;
    for (const row of this.transcript.querySelectorAll<HTMLElement>('[data-cue]')) {
      const selected = ids.has(row.dataset.cue!);
      row.classList.toggle('active', selected);
      if (selected) {
        row.setAttribute('aria-current', 'true');
        current ??= row;
      } else row.removeAttribute('aria-current');
    }
    if (this.follow.checked && current) {
      const rect = current.getBoundingClientRect(),
        pane = this.transcript.getBoundingClientRect();
      if (rect.top < pane.top + 24 || rect.bottom > pane.bottom - 24)
        this.transcript.scrollTop += rect.top - pane.top - this.transcript.clientHeight / 3;
    }
  }
  private scrollTranscript() {
    if (this.closed || this.follow.checked || this.scrollUpdate || !this.studyTimeline) return;
    const node = this.transcript,
      count = this.studyTimeline.cues.length;
    const direction =
      node.scrollTop <= 8 && this.renderedStart > 0
        ? -1
        : node.scrollHeight - node.clientHeight - node.scrollTop <= 24 && this.renderedEnd < count
          ? 1
          : 0;
    if (!direction) return;
    this.scrollUpdate = true;
    this.pageIndex = Math.max(0, this.pageIndex + direction);
    this.transcriptSignature = '';
    this.activeSignature = '';
    this.render();
    requestAnimationFrame(() => {
      this.scrollUpdate = false;
    });
  }
  private loop() {
    cancelAnimationFrame(this.frame);
    if (this.closed || this.video.paused) return;
    this.render();
    this.frame = requestAnimationFrame(() => this.loop());
  }
  private resize() {
    const viewing = this.root.querySelector<HTMLElement>('.video-viewing');
    if (!viewing) return;
    const width = viewing.clientWidth;
    const height = Math.max(
      400,
      window.innerHeight - Math.max(0, viewing.getBoundingClientRect().top) - 36
    );
    const ratio = (this.video.videoWidth || 16) / (this.video.videoHeight || 9);
    this.layout = this.theater ? 'below' : chooseLayout(width, height, ratio, this.layout);
    viewing.dataset.layout = this.layout;
    viewing.style.setProperty('--view-height', `${height}px`);
    const fitWidth = Math.min(this.stage.clientWidth, this.stage.clientHeight * ratio),
      fitHeight = fitWidth / ratio;
    this.overlay.style.maxWidth = `${fitWidth * 0.92}px`;
    this.overlay.style.bottom = `${Math.max(56, (this.stage.clientHeight - fitHeight) / 2 + 18)}px`;
  }
  private toggleTheater() {
    if (this.closed) return;
    this.theater = !this.theater;
    this.applyViewingMode();
  }
  private portableSelection(id: string): string | null {
    if (!id) return null;
    if (this.temporaryTracks.some((track) => track.id === id)) return null;
    return this.localDraftIds.has(id) && !this.publishedIds.has(id) ? null : id;
  }
  private saveDraftSelection() {
    if (!this.key || this.closed) return;
    const id = this.primary.value;
    this.pendingDraftSave = {
      key: this.key,
      id: this.localDraftIds.has(id) && !this.publishedIds.has(id) ? id : null
    };
    if (this.draftSavingActive) return;
    this.draftSavingActive = true;
    const first = this.pendingDraftSave;
    this.pendingDraftSave = undefined;
    // One active write plus the newest pending intent. Close owns the whole drain.
    this.draftSaving = Promise.resolve().then(async () => {
      let next: typeof first | undefined = first;
      let failure: { error: unknown } | undefined;
      try {
        while (next) {
          try {
            await this.options.store.putLocal(
              this.options.scope,
              'settings',
              `transcript-draft/${next.key}`,
              next.id
            );
            failure = undefined;
          } catch (error) {
            failure = { error };
            this.error(error);
          }
          next = this.pendingDraftSave;
          this.pendingDraftSave = undefined;
        }
        if (failure) throw failure.error;
      } finally {
        this.draftSavingActive = false;
      }
    });
    // Observe immediately but preserve failure for the Close caller.
    void this.draftSaving.catch(() => {});
  }
  private async restoreDraftSelection() {
    if (!this.key || !this.ready || this.closed || this.draftSelectionRestored) return;
    this.draftSelectionRestored = true;
    const key = this.key,
      intent = this.selectionIntent;
    try {
      const id = await this.options.store.local<unknown>(
        this.options.scope,
        'settings',
        `transcript-draft/${key}`
      );
      if (
        this.closed ||
        this.key !== key ||
        intent !== this.selectionIntent ||
        this.selectionTouched
      )
        return;
      // Local intent may override an older portable choice. Treat a missing job as a waiting
      // selection, not permission to select a different track or start recognition automatically.
      if (isUUID(id)) {
        this.localDraftIds.add(id);
        this.selectionTouched = true;
        this.pendingGenerated = id;
        this.primary.value = '';
        this.secondary.value = '';
        this.applyTracks();
      }
    } catch (error) {
      this.error(error);
    }
  }
  private scheduleSave(
    force: boolean,
    finished = this.position?.finished ?? this.deviceState?.finished ?? false,
    promoteDevice = false
  ) {
    if (
      (!this.touched && !this.selectionTouched && !promoteDevice) ||
      !this.ready ||
      this.closed ||
      !Number.isFinite(this.video.duration) ||
      this.video.duration <= 0
    )
      return;
    if (!force && Date.now() - this.lastSave < 5000) return;
    this.lastSave = Date.now();
    if (this.device && (this.touched || this.selectionTouched)) {
      const snapshot: DevicePlayback = {
        version: 1,
        position: Math.max(0, Math.min(this.video.currentTime, this.video.duration)),
        duration: this.video.duration,
        rate: this.video.playbackRate,
        finished,
        updatedAt: Date.now()
      };
      this.deviceState = snapshot;
      void this.device.save(snapshot).catch((e) => this.error(e));
    }
    if (!this.key || !this.restored || !this.writes) return;
    const key = this.key,
      payload: Playback = {
        version: 1,
        mediaKey: key,
        position: Math.max(0, Math.min(this.video.currentTime, this.video.duration)),
        duration: this.video.duration,
        rate: this.video.playbackRate,
        finished,
        updatedAt: Date.now(),
        primary: this.portableSelection(this.primary.value),
        secondary: this.portableSelection(this.secondary.value),
        delays: Object.fromEntries(
          Object.entries(this.delays).filter(([id]) => this.portableSelection(id))
        )
      };
    this.position = payload;
    this.pendingSave = payload;
    if (this.savingActive) return;
    this.savingActive = true;
    const first = this.pendingSave;
    this.pendingSave = undefined;
    this.saving = Promise.resolve().then(async () => {
      let next: Playback | undefined = first;
      try {
        while (next && this.writes) {
          const saved = await this.options.store.edit(
            this.options.scope,
            'video_resume',
            key,
            key,
            next as unknown as Record<string, unknown>,
            this.version
          );
          this.version = saved.localVersion;
          next = this.pendingSave;
          this.pendingSave = undefined;
        }
      } catch (error) {
        this.writes = false;
        this.error(error);
      } finally {
        // Release ownership in the same continuation as the last pending read.
        // A separate promise-finally could strand a newly submitted snapshot.
        this.pendingSave = undefined;
        this.savingActive = false;
      }
    });
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.scheduleSave(true);
    this.closed = true;
    clearInterval(this.firstWindowClock);
    this.generationOutcomes = undefined;
    this.sparsePlayback = undefined;
    this.draftDigests.clear();
    this.alive.abort();
    this.menu.dispose();
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.release();
    this.root.remove();
    // All callers wait for the same final portable and device-only checkpoints.
    this.closing = Promise.allSettled([this.saving, this.device?.close(), this.draftSaving]).then(
      (results) => {
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : []
        );
        if (failures.length === 1) throw failures[0];
        if (failures.length)
          throw new AggregateError(failures, 'Player checkpoints failed to close');
      }
    );
    return this.closing;
  }
}
