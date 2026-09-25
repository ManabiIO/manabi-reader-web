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
  validateStyle
} from './contracts.js';
import { dialogueText } from './dialogue.js';
import { element, button, iconButton, TranscriptMenu } from './player-controls.js';
import { trackLanguage, languageName, translationCandidate } from './track-selection.js';
import { studySpans, seekSpan, LinePause, type StudySpan } from './study.js';
import { type CueTimeline, chooseLayout } from './captions.js';
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
  private spans: StudySpan[] = [];
  private menu = new TranscriptMenu();
  private setup = element('div');
  private setupTracks = element('select');
  private setupNote = element('p');
  private setupStatus = element('p');
  private generationBusy = false;
  private selectionIntent = 0;
  private pendingGenerated?: string;
  private generationAvailable = false;
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
  private version: string | null = null;
  private saving: Promise<void> = Promise.resolve();
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
    this.pane.append(header, this.setup, this.transcript, this.menu.panel);
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
  setGenerationAvailable(available: boolean) {
    if (this.closed) return;
    this.generationAvailable = available;
    this.updateSetup();
  }
  generationStatus(id: string, state: string) {
    if (this.closed || id !== this.pendingGenerated) return;
    if (['paused', 'failed'].includes(state)) {
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
    this.setupNote.textContent =
      this.discovery === 'loading'
        ? 'Looking for subtitles. Choose one below, or generate a transcript when the video is ready.'
        : this.discovery === 'limited'
          ? 'Some embedded subtitles could not be read. Choose an available track, add a subtitle file, or generate a transcript.'
          : this.tracks.length
            ? 'Select the language you want to follow. Translation can be added afterwards.'
            : 'Add subtitles you already have, or generate a transcript privately on this device.';
  }
  private async requestGenerate() {
    if (this.closed || this.generate.disabled || this.primary.value || this.secondary.value) return;
    const intent = this.selectionIntent;
    this.generationBusy = true;
    this.updateSetup();
    try {
      const id = await this.options.onGenerate();
      if (this.closed) return;
      if (typeof id === 'string' && intent === this.selectionIntent) {
        this.pendingGenerated = id;
        this.setTracks(this.tracks);
      }
    } catch (error) {
      this.error(error);
    } finally {
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
    await this.restore();
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
          this.video.playbackRate = state.rate;
        }
        if (!this.selectionTouched) {
          // A feed may deliver the resume record before its caption pages.
          // Keep the saved selection visible instead of assigning a missing option.
          this.setTracks(this.tracks);
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
      for (const track of tracks) {
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
      if (desired && !tracks.some((t) => t.id === desired)) {
        const waiting = element('option', 'Saved track · not available yet');
        waiting.value = desired;
        waiting.disabled = true;
        picker.append(waiting);
      }
      picker.value = desired;
    }
    this.setupTracks.replaceChildren();
    const placeholder = element(
      'option',
      this.tracks.length ? 'Select subtitles…' : 'No subtitles found yet'
    );
    placeholder.value = '';
    this.setupTracks.append(placeholder);
    for (const track of this.tracks.filter((track) => track.complete)) {
      const option = element(
        'option',
        `${languageName(trackLanguage(track))} · ${track.label}${track.forced ? ' · Forced' : ''}`
      );
      option.value = track.id;
      this.setupTracks.append(option);
    }
    this.setupTracks.disabled = !tracks.some((track) => track.complete);
    if (
      this.pendingGenerated &&
      tracks.some((track) => track.id === this.pendingGenerated && track.complete)
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
    return (
      this.tracks.find((t) => t.id === this.primary.value) ??
      this.tracks.find((t) => t.id === this.secondary.value)
    );
  }
  private offsetControls() {
    this.exportButton.disabled = !this.exportTrack();
    this.primaryDelay.value = String(this.delays[this.primary.value] ?? 0);
    this.secondaryDelay.value = String(this.delays[this.secondary.value] ?? 0);
    this.primaryDelay.disabled = !this.primary.value;
    this.secondaryDelay.disabled = !this.secondary.value;
  }
  private trackChanged() {
    this.updateSetup();
    // render() resets listening state only when its actual timeline/delay changes.
    this.pageIndex = 0;
    this.offsetControls();
    this.activeSignature = '';
    this.transcriptSignature = '';
    this.render();
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
      this.studyTimeline = timeline;
      this.cueIndexes = new Map(timeline?.cues.map((cue, index) => [cue.id, index]) ?? []);
      this.renderedStart = this.renderedEnd = -1;
      this.studyDelay = delay;
      this.spans = studySpans(timeline?.cues ?? [], delay);
      this.linePause.reset();
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
        primary: this.primary.value || null,
        secondary: this.secondary.value || null,
        delays: { ...this.delays }
      };
    this.position = payload;
    this.saving = this.saving.then(async () => {
      if (!this.writes) return;
      try {
        const r = await this.options.store.edit(
          this.options.scope,
          'video_resume',
          key,
          key,
          payload as unknown as Record<string, unknown>,
          this.version
        );
        this.version = r.localVersion;
      } catch (e) {
        this.writes = false;
        this.error(e);
      }
    });
  }
  async dispose() {
    if (this.closed) return;
    this.scheduleSave(true);
    this.closed = true;
    this.alive.abort();
    this.menu.dispose();
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.release();
    await this.saving;
    await this.device?.close();
    this.root.remove();
  }
}
