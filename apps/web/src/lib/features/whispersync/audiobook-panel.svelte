<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { asset } from '$app/paths';
  import * as Sheet from '$lib/components/ui/sheet';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import type { BookmarkManager } from '$lib/components/book-reader/types';
  import {
    CueTimeline,
    MAX_SUBTITLE_BYTES,
    cueAudioBounds,
    parseSubtitles,
    type Cue
  } from './subtitles';
  import { LocalAudioPlayer, audioIdentity, type PlaybackState } from './player';
  import { AudiobookSessionStore, sessionKey, type AudiobookSession } from './persistence';
  import { AudiobookSessionCoordinator } from './session';
  import { BookSource, ReaderNavigator } from './reader-source';
  import { ReaderNavigationSession, navigateBookmark } from './navigation';
  import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';
  import {
    buildSourceBookIndex,
    matchCues,
    ReaderHighlight,
    type BookIndex,
    type CueMatch
  } from './matcher';
  import { toTimeString } from './upstream';
  import PitchStrip from './pitch/pitch-strip.svelte';
  import { createPitchController } from './pitch/browser';
  import type { PitchController } from './pitch/controller';
  import { initialPitchState } from './pitch/model';

  export let open = false;
  export let bookId: number;
  export let bookTitle: string;
  export let htmlContent: string;
  export let layoutKey: string | number;
  export let bookmarkManager: BookmarkManager | undefined;
  export let onFollow: () => void;
  export let returnFocus: () => void;
  export let selectionHint: Range | undefined = undefined;

  let mounted = false;
  let alive = false;
  let ready = false;
  let audioHost: HTMLDivElement;
  let audioBarOpenButton: HTMLButtonElement | undefined;
  let player: LocalAudioPlayer;
  let pitch: PitchController;
  let pitchState = initialPitchState();
  let session: AudiobookSessionCoordinator;
  let highlight: ReaderHighlight;
  let navigator: ReaderNavigator;
  let source: BookSource | undefined;
  let liveObserver: MutationObserver;
  let navigation: ReaderNavigationSession;
  let snapshot: PlaybackState = { time: 0, duration: 0, ready: false, paused: true, rate: 1 };
  let subtitleSource = '';
  let subtitleName = '';
  let cues: readonly Cue[] = [];
  let timeline = new CueTimeline([]);
  let current = -1;
  let delay = 0;
  let follow = false;
  let approximate = false;
  let subtitleLoading = false;
  let subtitleGeneration = 0;
  let error = '';
  let storageError = '';
  let matchError = '';
  let matching = false;
  let matchProgress = 0;
  let matchController: AbortController | undefined;
  let index: BookIndex | undefined;
  let matches: (CueMatch | undefined)[] = [];
  let matchedCount = 0;
  let approximateCount = 0;
  let highlightSupported = true;
  let lastCue = -1;
  let lastHtml = htmlContent;
  let lastLayout = layoutKey;
  let lastOpen = open;
  let hasMatched = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSave = 0;
  let saveGeneration = 0;
  let clearing = false;
  let confirmClear = false;
  let transcriptPage = 0;
  let previousTranscriptPage: HTMLButtonElement | undefined;
  let nextTranscriptPage: HTMLButtonElement | undefined;
  const pageSize = 30;
  const key = sessionKey(bookId, bookTitle);

  $: pageCount = Math.max(1, Math.ceil(cues.length / pageSize));
  $: visibleCues = cues.slice(transcriptPage * pageSize, (transcriptPage + 1) * pageSize);
  $: activeCue = current >= 0 ? cues[current] : undefined;
  $: if (mounted) contentChanged(htmlContent, layoutKey);
  $: if (mounted) panelVisibilityChanged(open);
  $: if (mounted) pitch.setVisible(open && cues.length > 0 && !document.hidden);

  onMount(() => {
    alive = true;
    pitch = createPitchController((state) => {
      if (alive) pitchState = state;
    });
    highlight = new ReaderHighlight(window);
    highlightSupported = highlight.supported;
    session = new AudiobookSessionCoordinator(new AudiobookSessionStore(), key);
    navigator = new ReaderNavigator({
      document,
      root: () => document.querySelector<HTMLElement>('.book-content') ?? undefined,
      selectSection: (id) => nextChapter$.next(id),
      navigate: navigateToRange
    });
    navigation = new ReaderNavigationSession(navigator, {
      highlight: (range) => {
        highlight.set(range);
        matchError = '';
      },
      error: (message) => {
        matchError = message;
      }
    });
    liveObserver = new MutationObserver(() => {
      highlight.clear();
      lastCue = -1;
      updateCurrent(false);
    });
    observeLiveBook();
    player = new LocalAudioPlayer(
      {
        createAudio: () => document.createElement('audio'),
        createURL: (file) => URL.createObjectURL(file),
        revokeURL: (url) => URL.revokeObjectURL(url),
        attach: (audio) => {
          pitch.setAudio(audio);
          // The local player owns its media element; Svelte does not render children here.
          // eslint-disable-next-line svelte/no-dom-manipulating
          if (audio) audioHost.replaceChildren(audio);
          // eslint-disable-next-line svelte/no-dom-manipulating
          else audioHost.replaceChildren();
        },
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (id) => cancelAnimationFrame(id)
      },
      (state) => {
        if (!alive) return;
        if (snapshot.paused && !state.paused) lastCue = -1;
        snapshot = state;
        if (state.paused) navigation.cancelAutomatic();
        updateCurrent();
        if (ready && !clearing) scheduleSave(state.paused);
      }
    );
    mounted = true;
    void restore();
    const flush = () => {
      if (ready && !clearing) void save();
    };
    const visibility = () => {
      pitch.setVisible(open && cues.length > 0 && !document.hidden);
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      // Capture the last position before disposal. A queued IDB transaction is
      // best-effort on page termination; periodic checkpoints are also written.
      if (ready && !clearing) void save();
      alive = false;
      mounted = false;
      subtitleGeneration += 1;
      matchController?.abort();
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
      highlight.clear();
      liveObserver.disconnect();
      navigation.dispose();
      navigator.dispose();
      source?.dispose();
      index?.dispose();
      player.dispose();
      pitch.dispose();
      void session.close();
    };
  });

  async function restore() {
    try {
      const data = await session.restore();
      if (!alive) return;
      if (data) {
        const restoredCues = data.subtitleSource ? parseSubtitles(data.subtitleSource) : [];
        subtitleSource = data.subtitleSource;
        subtitleName = data.subtitleName;
        timeline = new CueTimeline(restoredCues);
        cues = timeline.cues;
        delay = data.delay;
        follow = data.follow;
        approximate = data.approximate;
        player.setRate(data.rate);
      }
    } catch {
      if (alive)
        storageError =
          'Saved audiobook data could not be loaded. Playback works in memory, but saving is disabled to protect the existing record. Reopen the book to retry, or use “Remove saved audiobook data” to reset it.';
    } finally {
      if (alive) ready = true;
    }
  }

  function sessionSnapshot(): AudiobookSession {
    // Reopening just the panel must not erase the previous file's resume point.
    return session.capture({ subtitleName, subtitleSource, delay, follow, approximate }, snapshot);
  }
  async function save() {
    if (!ready || clearing) return;
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    let data: AudiobookSession;
    try {
      data = sessionSnapshot();
    } catch {
      if (alive)
        storageError =
          'Audiobook settings could not be saved. Check the selected file and timing values.';
      return;
    }
    const generation = saveGeneration;
    lastSave = Date.now();
    try {
      await session.persist(data);
      if (alive && generation === saveGeneration && !clearing) storageError = '';
    } catch (cause) {
      if (alive && generation === saveGeneration && !clearing)
        storageError =
          cause instanceof Error
            ? cause.message
            : 'Audiobook changes could not be saved locally. Playback remains available.';
    }
  }
  function scheduleSave(immediate = false) {
    if (!ready || clearing) return;
    if (immediate || Date.now() - lastSave >= 5000) {
      void save();
      return;
    }
    if (saveTimer === undefined)
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void save();
      }, 5000);
  }

  async function closeAudio() {
    if (snapshot.file && snapshot.ready) {
      try {
        sessionSnapshot();
      } catch {
        /* Keep the previous valid checkpoint. */
      }
      void save();
    }
    navigation.cancel();
    player.clear();
    await tick();
    returnFocus();
  }
  async function pauseFromBar() {
    player?.pause();
    await tick();
    audioBarOpenButton?.focus({ preventScroll: true });
  }

  function selectAudio(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !ready || clearing || !alive) return;
    error = '';
    if (!file.size) {
      error = 'Choose a non-empty audio file.';
      return;
    }
    // Capture the live position before releasing the previous media element.
    try {
      sessionSnapshot();
    } catch {
      /* Retain the last valid checkpoint. */
    }
    const resume = session.snapshot;
    navigation.cancel();
    player.load(
      file,
      resume.audio
        ? { identity: audioIdentity(resume.audio), position: resume.position }
        : undefined
    );
  }

  async function selectSubtitles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !ready || clearing || !alive) return;
    const generation = ++subtitleGeneration;
    subtitleLoading = true;
    error = '';
    try {
      if (file.size > MAX_SUBTITLE_BYTES) throw new Error('Subtitle file exceeds the 5 MiB limit');
      const source = await file.text();
      if (!alive || generation !== subtitleGeneration) return;
      const parsed = parseSubtitles(source);
      // Commit only after successful validation, retaining the old captions on error.
      invalidateMatches();
      player.setLoop();
      subtitleSource = source;
      subtitleName = file.name;
      timeline = new CueTimeline(parsed);
      cues = timeline.cues;
      transcriptPage = 0;
      lastCue = -1;
      updateCurrent();
      scheduleSave(true);
    } catch (cause) {
      if (alive && generation === subtitleGeneration)
        error = cause instanceof Error ? cause.message : 'The subtitle file could not be read.';
    } finally {
      if (alive && generation === subtitleGeneration) subtitleLoading = false;
    }
  }

  function cancelMatch() {
    matchController?.abort();
    matchController = undefined;
    matching = false;
  }
  async function matchBook() {
    if (!alive || !ready || clearing || !cues.length) return;
    cancelMatch();
    const controller = new AbortController();
    matchController = controller;
    matching = true;
    hasMatched = false;
    matchProgress = 0;
    matchError = '';
    highlight.clear();
    index?.dispose();
    source?.dispose();
    source = undefined;
    navigation.cancel();
    index = undefined;
    matches = [];
    matchedCount = 0;
    approximateCount = 0;
    lastCue = -1;
    const currentCues = cues;
    let built: BookIndex | undefined;
    try {
      await tick();
      if (!alive || controller.signal.aborted) return;
      built = await buildSourceBookIndex(htmlContent, document, controller.signal);
      if (!built.text) throw new Error('No readable book text was found for matching.');
      const prepared = new BookSource(built);
      const root = document.querySelector<HTMLElement>('.book-content');
      const start =
        selectionHint && root ? prepared.selectionOffset(selectionHint, root) : undefined;
      if (selectionHint && start === undefined)
        throw new Error(
          'The selected starting text has changed or is no longer visible. Clear the starting selection or select it again in the book.'
        );
      const result = await matchCues(built.text, currentCues, {
        signal: controller.signal,
        start,
        approximate,
        onProgress: (processed, total) => {
          if (alive && matchController === controller)
            matchProgress = Math.round((processed * 100) / total);
        }
      });
      if (!alive || controller.signal.aborted || matchController !== controller || !built.valid())
        return;
      index = built;
      source = prepared;
      observeLiveBook();
      matches = result;
      matchedCount = result.filter(Boolean).length;
      approximateCount = result.filter((match) => match?.approximate).length;
      hasMatched = true;
      lastCue = -1;
      updateCurrent();
    } catch (cause) {
      if (alive && matchController === controller && !controller.signal.aborted) {
        matchError = cause instanceof Error ? cause.message : 'Matching failed.';
      }
    } finally {
      if (built && built !== index) built.dispose();
      if (alive && matchController === controller) {
        matching = false;
        matchController = undefined;
      }
    }
  }

  function invalidateMatches(message = '') {
    cancelMatch();
    highlight.clear();
    index?.dispose();
    source?.dispose();
    source = undefined;
    navigation.cancel();
    index = undefined;
    matches = [];
    matchedCount = 0;
    approximateCount = 0;
    lastCue = -1;
    hasMatched = false;
    matchError = message;
  }
  function contentChanged(html: string, layout: string | number) {
    if (html === lastHtml && layout === lastLayout) return;
    const changed = html !== lastHtml;
    lastHtml = html;
    lastLayout = layout;
    if (changed)
      invalidateMatches(
        hasMatched || matching
          ? 'Book text changed. Select “Match book” to refresh its locations.'
          : ''
      );
    // Source locations survive section virtualization and layout changes; live
    // ranges are discarded and resolved only against the new rendered content.
    highlight.clear();
    navigation.cancel();
    void tick().then(() => {
      if (!alive) return;
      observeLiveBook();
      lastCue = -1;
      updateCurrent(false);
    });
  }
  function panelVisibilityChanged(value: boolean) {
    if (value === lastOpen) return;
    lastOpen = value;
    if (value) navigation.cancel();
    lastCue = -1;
    updateCurrent();
  }
  function changeApproximate(event: Event) {
    approximate = (event.currentTarget as HTMLInputElement).checked;
    invalidateMatches('Matching options changed. Select “Match book” to apply them.');
    scheduleSave(true);
  }

  function observeLiveBook() {
    liveObserver.disconnect();
    const root = document.querySelector('.book-content');
    if (root)
      liveObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['id', 'aria-busy', 'hidden', 'aria-hidden']
      });
  }
  function updateCurrent(navigate = true) {
    current = snapshot.file && snapshot.ready ? timeline.at(snapshot.time, delay) : -1;
    pitch?.setSpeechActive(current >= 0, snapshot.time);
    navigation?.cueChanged(current);
    if (current === lastCue) return;
    lastCue = current;
    const match = matches[current];
    const location = match && source?.location(match);
    const root = document.querySelector<HTMLElement>('.book-content');
    highlight?.set(location && root ? source?.resolve(location, root) : undefined);
    if (location && navigate && follow && !snapshot.paused && !open)
      void showLocation(current, true);
  }
  function navigateToRange(range: Range): boolean {
    if (!bookmarkManager || !alive || open) return false;
    onFollow();
    return navigateBookmark(bookmarkManager, bookId, range);
  }
  async function showLocation(cueIndex: number, automatic = false) {
    const book = source;
    const location = book && matches[cueIndex] && book.location(matches[cueIndex]!);
    if (!book || !location || !alive || open) return;
    onFollow();
    await navigation.show(book, location, automatic);
  }
  async function showInBook(cueIndex: number) {
    open = false;
    await tick();
    if (alive) await showLocation(cueIndex);
  }
  function selectCue(cueIndex: number, play = false) {
    const cue = cues[cueIndex];
    if (!cue || !snapshot.ready || clearing) return;
    const bounds = cueAudioBounds(cue, delay, snapshot.duration);
    if (!bounds) {
      error =
        'This subtitle falls outside the selected audio file. Check the file and subtitle delay.';
      return;
    }
    player.setLoop();
    player.seek(bounds.start);
    if (play) void player.play();
  }
  function moveCue(direction: -1 | 1) {
    selectCue(timeline.adjacent(snapshot.time, direction, delay));
  }
  async function pageTranscript(delta: -1 | 1) {
    transcriptPage = Math.min(pageCount - 1, Math.max(0, transcriptPage + delta));
    await tick();
    if (delta > 0 && nextTranscriptPage?.disabled)
      previousTranscriptPage?.focus({ preventScroll: true });
    else if (delta < 0 && previousTranscriptPage?.disabled)
      nextTranscriptPage?.focus({ preventScroll: true });
  }
  function toggleLoop() {
    if (snapshot.loop) player.setLoop();
    else if (activeCue) {
      const bounds = cueAudioBounds(activeCue, delay, snapshot.duration);
      if (bounds) {
        player.setLoop(bounds.start, bounds.end);
        void player.play();
      }
    }
  }
  function changeDelay(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const number = input.valueAsNumber;
    if (!Number.isFinite(number) || number < -3600 || number > 3600) {
      input.value = String(delay);
      return;
    }
    delay = number;
    player.setLoop();
    lastCue = -1;
    updateCurrent();
    scheduleSave(true);
  }
  function changeFollow(event: Event) {
    follow = (event.currentTarget as HTMLInputElement).checked;
    if (!follow) navigation.cancel();
    lastCue = -1;
    updateCurrent();
    scheduleSave(true);
  }
  async function removeSaved() {
    confirmClear = false;
    clearing = true;
    saveGeneration += 1;
    subtitleGeneration += 1;
    subtitleLoading = false;
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    cancelMatch();
    highlight.clear();
    player.clear();
    index?.dispose();
    source?.dispose();
    source = undefined;
    navigation.cancel();
    index = undefined;
    matches = [];
    hasMatched = false;
    matchedCount = 0;
    approximateCount = 0;
    subtitleSource = '';
    subtitleName = '';
    cues = [];
    timeline = new CueTimeline([]);
    delay = 0;
    follow = false;
    approximate = false;
    lastCue = -1;
    current = -1;
    error = '';
    matchError = '';
    try {
      await session.remove();
      if (alive) storageError = '';
    } catch {
      if (alive)
        storageError =
          'Saved audiobook data could not be removed. Saving remains disabled to protect the existing record. Close other tabs and try removing it again.';
    } finally {
      if (alive) {
        player.setRate(1);
        clearing = false;
      }
    }
  }
</script>

<!-- This host remains mounted when the Sheet closes. No audio copy or upload. -->
<div
  class="audio-bar"
  class:inactive={!snapshot.file && !storageError && !matchError}
  data-ui-overlay="audiobook-controls"
>
  <div class="audio-heading">
    <button
      bind:this={audioBarOpenButton}
      type="button"
      on:click={() => {
        open = true;
      }}>Audiobook</button
    >
    <span class="audio-title" title={snapshot.file?.name}>{snapshot.file?.name}</span>
    {#if snapshot.file}
      <button type="button" on:click={() => void pauseFromBar()} disabled={snapshot.paused}
        >Pause</button
      >
      <button type="button" on:click={() => void closeAudio()} aria-label="Close audio playback"
        >×</button
      >
    {/if}
  </div>
  <div bind:this={audioHost}></div>
  {#if activeCue}<p class="now-playing">{activeCue.text}</p>{/if}
  {#if !open && (storageError || matchError)}
    <p class="audio-notice" role="status">
      {storageError
        ? 'Audiobook changes are not being saved.'
        : 'Audiobook following needs attention.'}
      <button
        type="button"
        on:click={() => {
          open = true;
        }}>View details</button
      >
    </p>
  {/if}
  {#if snapshot.error}<p role="alert">{snapshot.error}</p>{/if}
</div>

<Sheet.Root bind:open>
  <Sheet.Content
    side="bottom"
    showCloseButton={false}
    class="audiobook-sheet max-h-[85dvh] overflow-hidden p-0 [writing-mode:horizontal-tb]"
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      returnFocus();
    }}
  >
    <div class="audiobook-header">
      <Sheet.Title>Audiobook</Sheet.Title>
      <CloseButton aria-label="Close audiobook" onclick={() => (open = false)} />
    </div>
    <div class="audiobook-scroll">
      <Sheet.Description
        >Listen alongside {bookTitle} using local audio and timed subtitles. Files are not uploaded.
        Following resumes after this panel closes.</Sheet.Description
      >
      <div class="panel" data-ui-overlay="audiobook-panel">
        {#if !ready}<p role="status">Loading saved audiobook settings…</p>{/if}
        <div class="file-fields">
          <label
            >Audio file
            <input
              type="file"
              accept="audio/*,.mp3,.m4a,.m4b,.ogg,.wav,.flac"
              disabled={!ready || clearing}
              on:change={selectAudio}
            />
          </label>
          <label
            >Subtitles (.srt or .vtt; .txt also accepted)
            <input
              type="file"
              accept=".srt,.vtt,.txt,text/vtt,application/x-subrip,text/plain"
              disabled={!ready || clearing}
              on:change={selectSubtitles}
            />
          </label>
        </div>
        <p class="hint">
          Select the same audio file again after reopening the book to resume. Audio is not stored;
          subtitles, settings, and position are saved only in this browser. Codec support depends on
          your browser.
        </p>
        {#if subtitleLoading}<p role="status">Reading subtitles…</p>{/if}
        {#if subtitleName}<p>{subtitleName} · {cues.length.toLocaleString()} cues</p>{/if}
        {#if error}<p role="alert">{error}</p>{/if}
        {#if storageError}<p role="status">{storageError}</p>{/if}
        {#if snapshot.error}<p role="alert">{snapshot.error}</p>{/if}
        {#if snapshot.file}
          <div class="actions">
            <button
              type="button"
              disabled={!snapshot.ready}
              on:click={() => (snapshot.paused ? void player.play() : player.pause())}
              >{snapshot.paused ? 'Play' : 'Pause'}</button
            >
            <button
              type="button"
              disabled={!snapshot.ready}
              on:click={() => player.seek(snapshot.time - 10)}>−10 seconds</button
            >
            <button
              type="button"
              disabled={!snapshot.ready}
              on:click={() => player.seek(snapshot.time + 10)}>+10 seconds</button
            >
            <label
              >Speed
              <input
                type="number"
                min="0.5"
                max="3"
                step="0.05"
                value={snapshot.rate}
                on:change={(event) => player.setRate(event.currentTarget.valueAsNumber)}
              />×
            </label>
            <span>{toTimeString(snapshot.time)} / {toTimeString(snapshot.duration)}</span>
          </div>
        {/if}
        {#if cues.length}
          <div class="actions">
            <button type="button" disabled={!snapshot.ready} on:click={() => moveCue(-1)}
              >Previous cue</button
            >
            <button
              type="button"
              disabled={!snapshot.ready || !activeCue}
              on:click={() => selectCue(current, true)}>Replay cue</button
            >
            <button type="button" disabled={!snapshot.ready} on:click={() => moveCue(1)}
              >Next cue</button
            >
            <button
              type="button"
              disabled={!snapshot.ready || (!activeCue && !snapshot.loop)}
              aria-pressed={!!snapshot.loop}
              on:click={toggleLoop}>{snapshot.loop ? 'Stop looping' : 'Loop cue'}</button
            >
          </div>
          <label
            >Subtitle delay (seconds)
            <input
              type="number"
              min="-3600"
              max="3600"
              step="0.1"
              value={delay}
              on:change={changeDelay}
            />
          </label>
          <p class="hint">
            Positive delay means the spoken audio comes later than the subtitle timestamp.
          </p>
          <div class="matching">
            <label
              ><input type="checkbox" checked={follow} on:change={changeFollow} /> Follow matched text
              while playing</label
            >
            <label
              ><input
                type="checkbox"
                checked={approximate}
                disabled={matching}
                on:change={changeApproximate}
              /> Allow approximate matches (review highlighted text)</label
            >
            <div class="actions">
              <button type="button" disabled={matching || subtitleLoading} on:click={matchBook}
                >Match book</button
              >
              {#if matching}<button type="button" on:click={cancelMatch}>Cancel</button><span
                  role="status">{matchProgress}% processed</span
                >{/if}
              {#if hasMatched}<span role="status"
                  >{matchedCount} / {cues.length} matched{approximateCount
                    ? ` (${approximateCount} approximate)`
                    : ''}</span
                >{/if}
            </div>
            <p class="hint">
              {selectionHint
                ? 'Matching starts at the selected book text.'
                : 'Matching starts at the beginning of the book.'}
              {#if selectionHint}<button
                  type="button"
                  disabled={matching}
                  on:click={() => {
                    selectionHint = undefined;
                    invalidateMatches('Starting point changed. Select “Match book” to apply it.');
                  }}>Clear starting selection</button
                >{/if}
            </p>
            <p class="hint">
              Matching does not edit the book. For a chapter-only recording, select its starting
              text in the book first. Unmatched cues still play. Matches span the whole book,
              including chapters not currently displayed. Chapters are opened using the reader’s
              normal navigation.
            </p>
            {#if !highlightSupported}<p>
                Inline highlighting is unavailable in this browser. Transcript playback and
                matched-text navigation still work.
              </p>{/if}
            {#if matchError}<p role="status">{matchError}</p>{/if}
          </div>
          <section aria-label="Audiobook transcript">
            <PitchStrip
              state={pitchState}
              available={snapshot.ready}
              onToggle={() => pitch.setEnabled(!pitchState.enabled)}
              onRetry={() => pitch.retry()}
            />
            <div class="actions">
              <h3>Transcript</h3>
              <button
                type="button"
                disabled={current < 0}
                on:click={() => {
                  transcriptPage = Math.floor(current / pageSize);
                }}>Show current cue</button
              >
              <button
                bind:this={previousTranscriptPage}
                type="button"
                disabled={transcriptPage === 0}
                on:click={() => void pageTranscript(-1)}>Previous 30</button
              >
              <span role="status" aria-live="polite">Page {transcriptPage + 1} / {pageCount}</span>
              <button
                bind:this={nextTranscriptPage}
                type="button"
                disabled={transcriptPage + 1 >= pageCount}
                on:click={() => void pageTranscript(1)}>Next 30</button
              >
            </div>
            <ol start={transcriptPage * pageSize + 1}>
              {#each visibleCues as cue, offset (cue.id)}
                {@const cueIndex = transcriptPage * pageSize + offset}
                <li class:active={cueIndex === current}>
                  <button
                    type="button"
                    disabled={!snapshot.ready || !cueAudioBounds(cue, delay, snapshot.duration)}
                    aria-current={cueIndex === current ? 'true' : undefined}
                    on:click={() => selectCue(cueIndex, true)}
                  >
                    <time>{toTimeString(cue.start + delay)}</time>
                    {cue.text}
                  </button>
                  {#if matches[cueIndex]}<button
                      type="button"
                      class="locate"
                      on:click={() => showInBook(cueIndex)}
                      aria-label={`Show cue ${cueIndex + 1} in book`}
                      >{matches[cueIndex]!.approximate
                        ? 'Approximate location'
                        : 'Show in book'}</button
                    >{/if}
                </li>
              {/each}
            </ol>
          </section>
        {/if}
        <div class="actions">
          <button
            type="button"
            disabled={!ready || clearing}
            on:click={() => {
              confirmClear = true;
            }}>Remove saved audiobook data</button
          >
          {#if confirmClear}<span>Remove captions and resume position for this book?</span><button
              type="button"
              disabled={clearing}
              on:click={removeSaved}>Remove</button
            ><button
              type="button"
              on:click={() => {
                confirmClear = false;
              }}>Cancel</button
            >{/if}
        </div>
        <p class="credits">
          Adapted from <a
            href="https://github.com/4890A/ttu-whispersync"
            target="_blank"
            rel="noopener noreferrer">4890A/ttu-whispersync</a
          >, originally by
          <a
            href="https://github.com/Renji-XD/ttu-whispersync"
            target="_blank"
            rel="noopener noreferrer">Renji-XD</a
          >.
          <a href={asset('/licenses/ttu-whispersync.txt')} target="_blank" rel="noopener noreferrer"
            >MIT license</a
          >. This built-in player does not require their userscript or Anki.
        </p>
      </div>
    </div>
  </Sheet.Content>
</Sheet.Root>

<style>
  .audio-bar {
    position: fixed;
    z-index: 20;
    inset-inline: 0.75rem;
    bottom: calc(2.25rem + env(safe-area-inset-bottom));
    max-width: 42rem;
    margin-inline: auto;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--background);
    color: var(--foreground);
    box-shadow: 0 2px 12px #0003;
    writing-mode: horizontal-tb;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .inactive {
    display: none;
  }
  .audio-heading,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .audio-heading {
    flex-wrap: nowrap;
  }
  .audio-notice {
    margin-top: 0.25rem;
  }
  .audio-title {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .now-playing {
    margin: 0.25rem 0 0;
    max-height: 4.5em;
    overflow-y: auto;
    white-space: pre-wrap;
  }
  .audiobook-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    align-items: start;
    gap: 16px;
    flex-shrink: 0;
    padding: 16px;
    border-block-end: 1px solid var(--border);
  }
  .audiobook-scroll {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
    padding-block-end: max(16px, env(safe-area-inset-bottom));
  }
  .panel {
    display: grid;
    gap: 1rem;
    max-width: 60rem;
    margin-inline: auto;
    font-size: 0.9375rem;
    line-height: 1.6;
  }
  .file-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .file-fields label {
    flex: 1;
    min-width: min(100%, 16rem);
  }
  .file-fields input {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
  }
  .hint,
  .credits {
    font-size: 0.8125rem;
    opacity: 0.85;
  }
  .matching {
    display: grid;
    gap: 0.75rem;
  }
  button,
  input[type='number'] {
    border: 1px solid currentColor;
    border-radius: 0.5rem;
    padding: 0.55rem 0.7rem;
    min-height: 44px;
    background: transparent;
    color: inherit;
  }
  .matching > label {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 0.55rem;
    cursor: pointer;
  }
  input[type='checkbox'] {
    width: 20px;
    height: 20px;
    margin: 0;
    flex: 0 0 20px;
  }
  .file-fields input[type='file'] {
    min-height: 44px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
  button[aria-pressed='true'],
  li.active {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  ol {
    display: grid;
    gap: 0.75rem;
    padding-inline-start: 2rem;
    margin-top: 0.75rem;
  }
  li > button:first-child {
    width: 100%;
    text-align: start;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  time {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .locate {
    font-size: 0.8rem;
    margin-top: 0.3rem;
  }
  a {
    text-decoration: underline;
  }
  :global(::highlight(manabi-whispersync)) {
    background-color: #f5cb5c88;
    color: inherit;
  }
</style>
