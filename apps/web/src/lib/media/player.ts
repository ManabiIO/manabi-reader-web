/** @license BSD-3-Clause — Manabi media integration. */
import { formatMediaTime } from './time.js';
import { type Track, type Playback, type ContentKey, type CaptionStyle, DEFAULT_STYLE, validatePlayback, validateStyle } from './contracts.js';
import { CueTimeline, chooseLayout } from './captions.js';
import { type ByteSource } from './sources.js';
import { MediaStore } from './store.js';
import { DeviceCheckpoints, type DeviceKey, type DevicePlayback } from './device-checkpoint.js';
import { type Scope } from './contracts.js';
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; return e; };
const button = (text: string, action: () => void) => { const b = element('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };
export interface PlayerOptions {
    scope: Scope;
    key?: ContentKey;
    source: ByteSource;
    store: MediaStore;
    onError(message: string): void;
    onGenerate(): void;
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
    private primary = element('select');
    private secondary = element('select');
    private generate: HTMLButtonElement;
    private theaterButton = button('Theater mode', () => this.toggleTheater());
    private exportButton = button('Export subtitles', () => {
        const track = this.exportTrack();
        if (track) this.options.onExport(track);
    });
    private fullscreenButton = button('Full screen', () => void this.fullscreen());
    private follow = element('input');
    private previous = button('Earlier captions', () => this.page(-1));
    private next = button('Later captions', () => this.page(1));
    private primaryDelay = element('input');
    private secondaryDelay = element('input');
    private tracks: Track[] = [];
    private timelines = new Map<string, CueTimeline>();
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
        this.video.setAttribute('controlslist', 'nofullscreen noremoteplayback');
        this.video.setAttribute('aria-label', options.source.name);
        this.overlay.className = 'caption-overlay';
        this.overlay.hidden = true;
        this.pane.className = 'transcript-pane';
        this.pane.setAttribute('aria-label', 'Transcript');
        this.transcript.className = 'transcript-rows';
        this.toolbar.className = 'video-toolbar';
        this.primary.setAttribute('aria-label', 'Primary captions');
        this.secondary.setAttribute('aria-label', 'Secondary captions');
        this.generate = button('Generate transcript', options.onGenerate);
        this.toolbar.append(this.generate, button('Add subtitles', options.onImport), this.theaterButton, this.fullscreenButton, this.exportButton);
        const picks = element('div');
        picks.className = 'caption-controls';
        picks.append(this.label('Captions', this.primary), this.label('Translation / second track', this.secondary));
        this.primary.addEventListener('change', () => { this.selectionTouched = true; if (this.secondary.value === this.primary.value)
            this.secondary.value = ''; this.trackChanged(); });
        this.secondary.addEventListener('change', () => { this.selectionTouched = true; if (this.primary.value === this.secondary.value)
            this.primary.value = ''; this.trackChanged(); });
        for (const [input, secondary] of [[this.primaryDelay, false], [this.secondaryDelay, true]] as const) {
            input.type = 'number';
            input.min = '-3600';
            input.max = '3600';
            input.step = '.1';
            input.value = '0';
            input.addEventListener('change', () => { const id = secondary ? this.secondary.value : this.primary.value, n = Number(input.value); if (id && Number.isFinite(n) && Math.abs(n) <= 3600) {
                this.selectionTouched = true;
                this.delays[id] = n;
                this.activeSignature = '';
                this.transcriptSignature = '';
                this.render();
                this.scheduleSave(true);
            }
            else
                input.value = String(this.delays[id] ?? 0); });
        }
        const settings = element('details'), summary = element('summary', 'Caption settings');
        settings.append(summary);
        const setting = (name: string, values: readonly (string | number)[], selected: string, change: (v: string) => void) => { const select = element('select'); for (const v of values) {
            const o = element('option', String(v));
            o.value = String(v);
            select.append(o);
        } select.value = selected; select.addEventListener('change', () => change(select.value)); settings.append(this.label(name, select)); };
        setting('Text size', [.75, 1, 1.25, 1.5], '1', v => this.setStyle({ ...this.style, size: Number(v) as CaptionStyle['size'] }));
        setting('Text color', ['white', 'yellow'], 'white', v => this.setStyle({ ...this.style, color: v as CaptionStyle['color'] }));
        setting('Background opacity', [0, .5, .8], '0.5', v => this.setStyle({ ...this.style, background: Number(v) as CaptionStyle['background'] }));
        setting('Text edge', ['shadow', 'outline', 'none'], 'shadow', v => this.setStyle({ ...this.style, edge: v as CaptionStyle['edge'] }));
        settings.append(this.label('Primary offset (seconds)', this.primaryDelay), this.label('Second-track offset (seconds)', this.secondaryDelay), element('p', 'Positive offsets delay captions. The two tracks retain their own timing.'));
        const header = element('div');
        header.className = 'transcript-header';
        this.follow.type = 'checkbox';
        this.follow.checked = true;
        header.append(this.label('Follow playback', this.follow), this.previous, this.next);
        this.pane.append(header, this.transcript);
        this.stage.append(this.video, this.overlay);
        const viewing = element('div');
        viewing.className = 'video-viewing';
        viewing.append(this.stage, this.pane);
        this.root.append(this.toolbar, picks, settings, viewing);
        this.follow.addEventListener('change', () => { this.activeSignature = ''; this.transcriptSignature = ''; this.render(); });
        this.transcript.addEventListener('wheel', () => { this.follow.checked = false; }, { passive: true });
        this.transcript.addEventListener('touchmove', () => { this.follow.checked = false; }, { passive: true });
        const resource = options.source.playback();
        this.release = resource.release;
        this.video.src = resource.url;
        const signal = this.alive.signal;
        this.video.addEventListener('loadedmetadata', () => void this.loaded(), { signal });
        this.video.addEventListener('play', () => { this.touched = true; this.loop(); }, { signal });
        this.video.addEventListener('pause', () => { cancelAnimationFrame(this.frame); this.render(); this.scheduleSave(true); }, { signal });
        this.video.addEventListener('seeking', () => { if (this.restoringSeek === undefined || Math.abs(this.video.currentTime - this.restoringSeek) > .01) this.touched = true; }, { signal });
        this.video.addEventListener('seeked', () => { this.restoringSeek = undefined; this.render(); this.scheduleSave(true); }, { signal });
        this.video.addEventListener('ratechange', () => { if (this.restoringRate !== this.video.playbackRate) this.touched = true; this.restoringRate = undefined; this.scheduleSave(true); }, { signal });
        this.video.addEventListener('timeupdate', () => { this.render(); this.scheduleSave(false); }, { signal });
        this.video.addEventListener('ended', () => { this.touched = true; this.scheduleSave(true, true); }, { signal });
        this.video.addEventListener('error', () => options.onError('This browser cannot play this container or codec. The original file was not changed.'), { signal });
        window.addEventListener('resize', () => this.resize(), { signal });
        document.addEventListener('fullscreenchange', () => {
            this.fullscreenButton.textContent = document.fullscreenElement === this.root ? 'Exit full screen' : 'Full screen';
            this.resize();
        }, { signal });
        window.addEventListener('pagehide', () => this.scheduleSave(true), { signal });
        document.addEventListener('visibilitychange', () => { if (document.hidden)
            this.scheduleSave(true); }, { signal });
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.root);
        this.setTracks([]);
        void options.store.local<CaptionStyle>(options.scope, 'settings', 'captions').then(s => { if (s && !this.closed && !this.styleTouched) {
            this.style = validateStyle(s);
            this.applyStyle();
            for (const select of settings.querySelectorAll('select')) {
                const text = select.parentElement?.firstChild?.textContent;
                if (text === 'Text size')
                    select.value = String(s.size);
                if (text === 'Text color')
                    select.value = s.color;
                if (text === 'Background opacity')
                    select.value = String(s.background);
                if (text === 'Text edge')
                    select.value = s.edge;
            }
        } }).catch(e => this.error(e));
    }
    private label(name: string, control: HTMLElement) { const label = element('label'); if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', name); label.append(document.createTextNode(name), control); return label; }
    private error(e: unknown) { if (!this.closed)
        this.options.onError(e instanceof Error ? e.message : String(e)); }
    private async loaded() { if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) {
        this.error(new Error('Unknown video duration'));
        return;
    } this.ready = true; this.resize(); this.applyDeviceState(); await this.restore(); }
    async bindDeviceCheckpoint(key: DeviceKey) {
        if (this.closed || this.device) return;
        const device = this.device = new DeviceCheckpoints(this.options.store, this.options.scope, key);
        try {
            this.deviceState = await device.load();
            if (this.closed || this.device !== device) return;
            this.deviceLoaded = true;
            this.applyDeviceState();
            if (this.touched) this.scheduleSave(true);
        } catch (e) { this.error(e); }
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
    async bindIdentity(key: ContentKey) { if (this.closed)
        return; this.key = key; await this.restore(); }
    private restore(): Promise<void> {
        if (!this.key || !this.ready || this.closed || this.restored) return Promise.resolve();
        if (!this.restoring) this.restoring = this.restoreOnce().finally(() => { this.restoring = undefined; });
        return this.restoring;
    }
    private async restoreOnce() {
        const key = this.key;
        if (!key || !this.ready || this.closed || this.restored)
            return;
        try {
            const r = await this.options.store.get(this.options.scope, 'video_resume', key);
            if (this.closed || this.key !== key)
                return;
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
            else if (this.deviceState && (!this.position || this.deviceState.updatedAt > this.position.updatedAt))
                this.scheduleSave(true, this.deviceState.finished, true);
        }
        catch (e) {
            this.writes = false;
            this.error(e);
        }
    }
    setTracks(tracks: Track[]) {
        if (this.closed)
            return;
        const selected = [this.primary.value, this.secondary.value];
        this.tracks = tracks;
        this.timelines = new Map(tracks.map(t => [t.id, new CueTimeline(t.cues)]));
        for (const [index, picker] of [this.primary, this.secondary].entries()) {
            picker.replaceChildren();
            const off = element('option', 'Off');
            off.value = '';
            picker.append(off);
            for (const track of tracks) {
                const o = element('option', track.label + (track.forced ? ' · Forced' : ''));
                o.value = track.id;
                picker.append(o);
            }
            const stored = index === 0 ? this.position?.primary : this.position?.secondary;
            const desired = this.selectionTouched ? selected[index] : (this.position ? (stored ?? '') : selected[index]);
            if (desired && !tracks.some(t => t.id === desired)) {
                const waiting = element('option', 'Saved track · not available yet');
                waiting.value = desired;
                waiting.disabled = true;
                picker.append(waiting);
            }
            picker.value = desired;
        }
        if (!this.selectionTouched && !this.position && !this.primary.value && !this.secondary.value && tracks.length)
            this.primary.value = (tracks.find(t => !t.forced) ?? tracks[0]).id;
        const usable = tracks.some(t => t.complete && !t.forced && t.kind === 'transcription');
        this.generate.textContent = usable ? 'Generate another transcript' : 'Generate transcript';
        this.activeSignature = '';
        this.transcriptSignature = '';
        this.offsetControls();
        this.render();
    }
    private exportTrack(): Track | undefined {
        return this.tracks.find(t => t.id === this.primary.value) ??
            this.tracks.find(t => t.id === this.secondary.value);
    }
    private offsetControls() { this.exportButton.disabled = !this.exportTrack(); this.primaryDelay.value = String(this.delays[this.primary.value] ?? 0); this.secondaryDelay.value = String(this.delays[this.secondary.value] ?? 0); this.primaryDelay.disabled = !this.primary.value; this.secondaryDelay.disabled = !this.secondary.value; }
    private trackChanged() { this.pageIndex = 0; this.offsetControls(); this.activeSignature = ''; this.transcriptSignature = ''; this.render(); this.scheduleSave(true); }
    private setStyle(style: CaptionStyle) { this.styleTouched = true; this.style = validateStyle(style); this.applyStyle(); void this.options.store.putLocal(this.options.scope, 'settings', 'captions', this.style).catch(e => this.error(e)); }
    private applyStyle() { this.overlay.style.setProperty('--caption-scale', String(this.style.size)); this.overlay.style.setProperty('--caption-color', this.style.color); this.overlay.style.setProperty('--caption-background', `rgb(0 0 0 / ${this.style.background})`); this.overlay.dataset.edge = this.style.edge; }
    private render() {
        if (this.closed)
            return;
        const t = this.video.currentTime, first = this.timelines.get(this.primary.value), second = this.timelines.get(this.secondary.value), a = first?.active(t, this.delays[this.primary.value] ?? 0) ?? [], b = second?.active(t, this.delays[this.secondary.value] ?? 0) ?? [];
        const signature = JSON.stringify([this.primary.value, this.secondary.value, a.map(c => c.id), b.map(c => c.id)]);
        if (signature !== this.activeSignature) {
            this.activeSignature = signature;
            this.overlay.replaceChildren();
            for (const [cues, secondary] of [[a, false], [b, true]] as const) {
                if (!cues.length)
                    continue;
                const line = element('div', cues.map(c => c.text).join('\n'));
                line.className = secondary ? 'caption-line translation' : 'caption-line';
                this.overlay.append(line);
            }
            this.renderTranscript(first ?? second, first ? second : undefined, first ? a : b);
        }
    }
    private renderTranscript(timeline: CueTimeline | undefined, translation: CueTimeline | undefined, active: readonly {
        id: string;
    }[]) {
        if (!timeline) {
            this.transcriptSignature = '';
            this.previous.disabled = this.next.disabled = true;
            this.transcript.replaceChildren(element('p', 'No transcript selected. Add a subtitle file, or generate a private, on-device transcript.'));
            return;
        }
        this.pageIndex = Math.max(0, Math.min(this.pageIndex, Math.ceil(timeline.cues.length / 60) - 1));
        const index = active.length ? timeline.cues.findIndex(c => c.id === active[0].id) : -1;
        if (this.follow.checked && index >= 0)
            this.pageIndex = Math.floor(index / 60);
        const signature = `${this.primary.value}:${this.secondary.value}:${this.pageIndex}:${this.delays[this.primary.value] ?? 0}:${this.delays[this.secondary.value] ?? 0}`;
        if (signature !== this.transcriptSignature) {
            this.transcriptSignature = signature;
            this.transcript.replaceChildren();
            const offset = this.delays[this.primary.value || this.secondary.value] ?? 0;
            for (const cue of timeline.cues.slice(this.pageIndex * 60, this.pageIndex * 60 + 60)) {
                const row = button('', () => { this.video.currentTime = Math.max(0, cue.start + offset); void this.video.play().catch(e => this.error(e)); });
                row.className = 'transcript-cue';
                row.dataset.cue = cue.id;
                const time = element('time', formatMediaTime(cue.start + offset));
                row.append(time, element('span', cue.text));
                const translated = translation?.overlaps(cue.start + offset, cue.end + offset, this.delays[this.secondary.value] ?? 0) ?? [];
                if (translated.length) {
                    const line = element('span', translated.map(c => c.text).join('\n'));
                    line.className = 'transcript-translation';
                    row.append(line);
                }
                this.transcript.append(row);
            }
        }
        this.previous.disabled = this.pageIndex === 0;
        this.next.disabled = (this.pageIndex + 1) * 60 >= timeline.cues.length;
        const ids = new Set(active.map(c => c.id));
        let current: HTMLElement | undefined;
        for (const row of this.transcript.querySelectorAll<HTMLElement>('[data-cue]')) {
            const selected = ids.has(row.dataset.cue!);
            row.classList.toggle('active', selected);
            if (selected) {
                row.setAttribute('aria-current', 'true');
                current ??= row;
            }
            else
                row.removeAttribute('aria-current');
        }
        if (this.follow.checked && current) {
            const rect = current.getBoundingClientRect(), pane = this.transcript.getBoundingClientRect();
            if (rect.top < pane.top || rect.bottom > pane.bottom)
                this.transcript.scrollTop += rect.top - pane.top - this.transcript.clientHeight / 3;
        }
    }
    private page(direction: number) { this.follow.checked = false; this.pageIndex = Math.max(0, this.pageIndex + direction); this.activeSignature = ''; this.render(); }
    private loop() { cancelAnimationFrame(this.frame); if (this.closed || this.video.paused)
        return; this.render(); this.frame = requestAnimationFrame(() => this.loop()); }
    private resize() { const viewing = this.stage.parentElement!, width = viewing.clientWidth, height = Math.max(360, window.innerHeight - viewing.getBoundingClientRect().top - 24), ratio = (this.video.videoWidth || 16) / (this.video.videoHeight || 9); this.layout = chooseLayout(width, height, ratio, this.layout); viewing.dataset.layout = this.layout; viewing.style.setProperty('--view-height', `${height}px`); const fitWidth = Math.min(this.stage.clientWidth, this.stage.clientHeight * ratio), fitHeight = fitWidth / ratio; this.overlay.style.maxWidth = `${fitWidth * .92}px`; this.overlay.style.bottom = `${Math.max(56, (this.stage.clientHeight - fitHeight) / 2 + 18)}px`; }
    private toggleTheater() { this.theater = !this.theater; this.root.classList.toggle('theater', this.theater); this.overlay.hidden = !this.theater; this.pane.hidden = this.theater; this.theaterButton.textContent = this.theater ? 'Exit theater' : 'Theater mode'; this.resize(); }
    private async fullscreen() { try {
        if (!this.root.requestFullscreen)
            throw new Error('Full screen is unavailable in this browser. Theater mode still works.');
        if (!this.theater)
            this.toggleTheater();
        if (document.fullscreenElement === this.root)
            await document.exitFullscreen();
        else
            await this.root.requestFullscreen();
    }
    catch (e) {
        this.error(e);
    } }
    private scheduleSave(force: boolean, finished = this.position?.finished ?? this.deviceState?.finished ?? false, promoteDevice = false) {
        if ((!this.touched && !this.selectionTouched && !promoteDevice) || !this.ready || this.closed || !Number.isFinite(this.video.duration) || this.video.duration <= 0)
            return;
        if (!force && Date.now() - this.lastSave < 5000) return;
        this.lastSave = Date.now();
        if (this.device && (this.touched || this.selectionTouched)) {
            const snapshot: DevicePlayback = { version: 1, position: Math.max(0, Math.min(this.video.currentTime, this.video.duration)),
                duration: this.video.duration, rate: this.video.playbackRate, finished, updatedAt: Date.now() };
            this.deviceState = snapshot;
            void this.device.save(snapshot).catch(e => this.error(e));
        }
        if (!this.key || !this.restored || !this.writes) return;
        const key = this.key, payload: Playback = { version: 1, mediaKey: key, position: Math.max(0, Math.min(this.video.currentTime, this.video.duration)), duration: this.video.duration, rate: this.video.playbackRate, finished, updatedAt: Date.now(), primary: this.primary.value || null, secondary: this.secondary.value || null, delays: { ...this.delays } };
        this.position = payload;
        this.saving = this.saving.then(async () => { if (!this.writes)
            return; try {
            const r = await this.options.store.edit(this.options.scope, 'video_resume', key, key, payload as unknown as Record<string, unknown>, this.version);
            this.version = r.localVersion;
        }
        catch (e) {
            this.writes = false;
            this.error(e);
        } });
    }
    async dispose() { if (this.closed)
        return; this.scheduleSave(true); this.closed = true; this.alive.abort(); this.observer.disconnect(); cancelAnimationFrame(this.frame); this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.release(); await this.saving; await this.device?.close(); this.root.remove(); }
}
