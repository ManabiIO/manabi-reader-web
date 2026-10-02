/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookmarkManager } from '$lib/components/book-reader/types';
import {
  CueTimeline,
  MAX_SUBTITLE_BYTES,
  cueAudioBounds,
  parseSubtitles,
  type Cue
} from '../lib/features/whispersync/subtitles';
import {
  LocalAudioPlayer,
  audioIdentity,
  type PlaybackState
} from '../lib/features/whispersync/player';
import {
  AudiobookSessionStore,
  sessionKey,
  type AudiobookSession
} from '../lib/features/whispersync/persistence';
import { AudiobookSessionCoordinator } from '../lib/features/whispersync/session';
import { BookSource, ReaderNavigator } from '../lib/features/whispersync/reader-source';
import { ReaderNavigationSession, navigateBookmark } from '../lib/features/whispersync/navigation';
import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';
import {
  buildSourceBookIndex,
  matchCues,
  ReaderHighlight,
  type BookIndex,
  type CueMatch
} from '../lib/features/whispersync/matcher';
import { createPitchController } from '../lib/features/whispersync/pitch/browser';
import type { PitchController } from '../lib/features/whispersync/pitch/controller';
import { initialPitchState } from '../lib/features/whispersync/pitch/model';
import { ReaderController, readerTick } from './controller';
export interface AudioPanelProps {
  open?: boolean;
  bookId: number;
  bookTitle: string;
  htmlContent: string;
  layoutKey: string | number;
  bookmarkManager: BookmarkManager | undefined;
  onFollow: () => void;
  returnFocus: () => void;
  selectionHint?: Range | undefined;
}

export function createAudioPanel(
  props: AudioPanelProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let pageCount: number;
  let visibleCues: readonly Cue[];
  let activeCue: Cue | undefined;

  let open = props.open !== undefined ? props.open : false;
  let bookId: number = props.bookId;
  let bookTitle: string = props.bookTitle;
  let htmlContent: string = props.htmlContent;
  let layoutKey: string | number = props.layoutKey;
  let bookmarkManager: BookmarkManager | undefined = props.bookmarkManager;
  let onFollow: () => void = props.onFollow;
  let returnFocus: () => void = props.returnFocus;
  let selectionHint: Range | undefined =
    props.selectionHint !== undefined ? props.selectionHint : undefined;
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
  __readerController.effect(
    () => [cues, pageSize],
    () => {
      __readerController.changed((pageCount = Math.max(1, Math.ceil(cues.length / pageSize))));
    }
  );
  __readerController.effect(
    () => [cues, transcriptPage, pageSize],
    () => {
      __readerController.changed(
        (visibleCues = cues.slice(transcriptPage * pageSize, (transcriptPage + 1) * pageSize))
      );
    }
  );
  __readerController.effect(
    () => [current, cues],
    () => {
      __readerController.changed((activeCue = current >= 0 ? cues[current] : undefined));
    }
  );
  __readerController.effect(
    () => [mounted, htmlContent, layoutKey],
    () => {
      if (mounted) contentChanged(htmlContent, layoutKey);
    }
  );
  __readerController.effect(
    () => [mounted, open],
    () => {
      if (mounted) panelVisibilityChanged(open);
    }
  );
  __readerController.effect(
    () => [mounted, pitch, open, cues],
    () => {
      if (mounted) pitch.setVisible(open && cues.length > 0 && !document.hidden);
    }
  );
  __readerController.onMount(() => {
    __readerController.changed((alive = true));
    __readerController.changed(
      (pitch = createPitchController((state) => {
        if (alive) __readerController.changed((pitchState = state));
      }))
    );
    __readerController.changed((highlight = new ReaderHighlight(window)));
    __readerController.changed((highlightSupported = highlight.supported));
    __readerController.changed(
      (session = new AudiobookSessionCoordinator(new AudiobookSessionStore(), key))
    );
    __readerController.changed(
      (navigator = new ReaderNavigator({
        document,
        root: () => document.querySelector<HTMLElement>('.book-content') ?? undefined,
        selectSection: (id) => nextChapter$.next(id),
        navigate: navigateToRange
      }))
    );
    __readerController.changed(
      (navigation = new ReaderNavigationSession(navigator, {
        highlight: (range) => {
          highlight.set(range);
          __readerController.changed((matchError = ''));
        },
        error: (message) => {
          __readerController.changed((matchError = message));
        }
      }))
    );
    __readerController.changed(
      (liveObserver = new MutationObserver(() => {
        highlight.clear();
        __readerController.changed((lastCue = -1));
        updateCurrent(false);
      }))
    );
    observeLiveBook();
    __readerController.changed(
      (player = new LocalAudioPlayer(
        {
          createAudio: () => document.createElement('audio'),
          createURL: (file) => URL.createObjectURL(file),
          revokeURL: (url) => URL.revokeObjectURL(url),
          attach: (audio) => {
            pitch.setAudio(audio);
            // The local player owns its media element; React does not render children here.
            if (audio) audioHost.replaceChildren(audio);
            else audioHost.replaceChildren();
          },
          requestFrame: (callback) => requestAnimationFrame(callback),
          cancelFrame: (id) => cancelAnimationFrame(id)
        },
        (state) => {
          if (!alive) return;
          if (snapshot.paused && !state.paused) __readerController.changed((lastCue = -1));
          __readerController.changed((snapshot = state));
          if (state.paused) navigation.cancelAutomatic();
          updateCurrent();
          if (ready && !clearing) scheduleSave(state.paused);
        }
      ))
    );
    __readerController.changed((mounted = true));
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
      __readerController.changed((alive = false));
      __readerController.changed((mounted = false));
      __readerController.changed((subtitleGeneration += 1));
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
        __readerController.changed((subtitleSource = data.subtitleSource));
        __readerController.changed((subtitleName = data.subtitleName));
        __readerController.changed((timeline = new CueTimeline(restoredCues)));
        __readerController.changed((cues = timeline.cues));
        __readerController.changed((delay = data.delay));
        __readerController.changed((follow = data.follow));
        __readerController.changed((approximate = data.approximate));
        player.setRate(data.rate);
      }
    } catch {
      if (alive)
        __readerController.changed(
          (storageError =
            'Saved audiobook data could not be loaded. Playback works in memory, but saving is disabled to protect the existing record. Reopen the book to retry, or use “Remove saved audiobook data” to reset it.')
        );
    } finally {
      if (alive) __readerController.changed((ready = true));
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
      __readerController.changed((saveTimer = undefined));
    }
    let data: AudiobookSession;
    try {
      data = sessionSnapshot();
    } catch {
      if (alive)
        __readerController.changed(
          (storageError =
            'Audiobook settings could not be saved. Check the selected file and timing values.')
        );
      return;
    }
    const generation = saveGeneration;
    __readerController.changed((lastSave = Date.now()));
    try {
      await session.persist(data);
      if (alive && generation === saveGeneration && !clearing)
        __readerController.changed((storageError = ''));
    } catch (cause) {
      if (alive && generation === saveGeneration && !clearing)
        __readerController.changed(
          (storageError =
            cause instanceof Error
              ? cause.message
              : 'Audiobook changes could not be saved locally. Playback remains available.')
        );
    }
  }
  function scheduleSave(immediate = false) {
    if (!ready || clearing) return;
    if (immediate || Date.now() - lastSave >= 5000) {
      void save();
      return;
    }
    if (saveTimer === undefined)
      __readerController.changed(
        (saveTimer = setTimeout(() => {
          __readerController.changed((saveTimer = undefined));
          void save();
        }, 5000))
      );
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
    await readerTick();
    returnFocus();
  }
  async function pauseFromBar() {
    player?.pause();
    await readerTick();
    audioBarOpenButton?.focus({ preventScroll: true });
  }
  function selectAudio(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !ready || clearing || !alive) return;
    __readerController.changed((error = ''));
    if (!file.size) {
      __readerController.changed((error = 'Choose a non-empty audio file.'));
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
    const generation = __readerController.changed(++subtitleGeneration);
    __readerController.changed((subtitleLoading = true));
    __readerController.changed((error = ''));
    try {
      if (file.size > MAX_SUBTITLE_BYTES) throw new Error('Subtitle file exceeds the 5 MiB limit');
      const source = await file.text();
      if (!alive || generation !== subtitleGeneration) return;
      const parsed = parseSubtitles(source);
      // Commit only after successful validation, retaining the old captions on error.
      invalidateMatches();
      player.setLoop();
      __readerController.changed((subtitleSource = source));
      __readerController.changed((subtitleName = file.name));
      __readerController.changed((timeline = new CueTimeline(parsed)));
      __readerController.changed((cues = timeline.cues));
      __readerController.changed((transcriptPage = 0));
      __readerController.changed((lastCue = -1));
      updateCurrent();
      scheduleSave(true);
    } catch (cause) {
      if (alive && generation === subtitleGeneration)
        __readerController.changed(
          (error = cause instanceof Error ? cause.message : 'The subtitle file could not be read.')
        );
    } finally {
      if (alive && generation === subtitleGeneration)
        __readerController.changed((subtitleLoading = false));
    }
  }
  function cancelMatch() {
    matchController?.abort();
    __readerController.changed((matchController = undefined));
    __readerController.changed((matching = false));
  }
  async function matchBook() {
    if (!alive || !ready || clearing || !cues.length) return;
    cancelMatch();
    const controller = new AbortController();
    __readerController.changed((matchController = controller));
    __readerController.changed((matching = true));
    __readerController.changed((hasMatched = false));
    __readerController.changed((matchProgress = 0));
    __readerController.changed((matchError = ''));
    highlight.clear();
    index?.dispose();
    source?.dispose();
    __readerController.changed((source = undefined));
    navigation.cancel();
    __readerController.changed((index = undefined));
    __readerController.changed((matches = []));
    __readerController.changed((matchedCount = 0));
    __readerController.changed((approximateCount = 0));
    __readerController.changed((lastCue = -1));
    const currentCues = cues;
    let built: BookIndex | undefined;
    try {
      await readerTick();
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
            __readerController.changed((matchProgress = Math.round((processed * 100) / total)));
        }
      });
      if (!alive || controller.signal.aborted || matchController !== controller || !built.valid())
        return;
      __readerController.changed((index = built));
      __readerController.changed((source = prepared));
      observeLiveBook();
      __readerController.changed((matches = result));
      __readerController.changed((matchedCount = result.filter(Boolean).length));
      __readerController.changed(
        (approximateCount = result.filter((match) => match?.approximate).length)
      );
      __readerController.changed((hasMatched = true));
      __readerController.changed((lastCue = -1));
      updateCurrent();
    } catch (cause) {
      if (alive && matchController === controller && !controller.signal.aborted) {
        __readerController.changed(
          (matchError = cause instanceof Error ? cause.message : 'Matching failed.')
        );
      }
    } finally {
      if (built && built !== index) built.dispose();
      if (alive && matchController === controller) {
        __readerController.changed((matching = false));
        __readerController.changed((matchController = undefined));
      }
    }
  }
  function invalidateMatches(message = '') {
    cancelMatch();
    highlight.clear();
    index?.dispose();
    source?.dispose();
    __readerController.changed((source = undefined));
    navigation.cancel();
    __readerController.changed((index = undefined));
    __readerController.changed((matches = []));
    __readerController.changed((matchedCount = 0));
    __readerController.changed((approximateCount = 0));
    __readerController.changed((lastCue = -1));
    __readerController.changed((hasMatched = false));
    __readerController.changed((matchError = message));
  }
  function contentChanged(html: string, layout: string | number) {
    if (html === lastHtml && layout === lastLayout) return;
    const changed = html !== lastHtml;
    __readerController.changed((lastHtml = html));
    __readerController.changed((lastLayout = layout));
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
    void readerTick().then(() => {
      if (!alive) return;
      observeLiveBook();
      __readerController.changed((lastCue = -1));
      updateCurrent(false);
    });
  }
  function panelVisibilityChanged(value: boolean) {
    if (value === lastOpen) return;
    __readerController.changed((lastOpen = value));
    if (value) navigation.cancel();
    __readerController.changed((lastCue = -1));
    updateCurrent();
  }
  function changeApproximate(event: Event) {
    __readerController.changed((approximate = (event.currentTarget as HTMLInputElement).checked));
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
    __readerController.changed(
      (current = snapshot.file && snapshot.ready ? timeline.at(snapshot.time, delay) : -1)
    );
    navigation?.cueChanged(current);
    if (current === lastCue) return;
    __readerController.changed((lastCue = current));
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
    __readerController.changed((open = false));
    await readerTick();
    if (alive) await showLocation(cueIndex);
  }
  function selectCue(cueIndex: number, play = false) {
    const cue = cues[cueIndex];
    if (!cue || !snapshot.ready || clearing) return;
    const bounds = cueAudioBounds(cue, delay, snapshot.duration);
    if (!bounds) {
      __readerController.changed(
        (error =
          'This subtitle falls outside the selected audio file. Check the file and subtitle delay.')
      );
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
    __readerController.changed(
      (transcriptPage = Math.min(pageCount - 1, Math.max(0, transcriptPage + delta)))
    );
    await readerTick();
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
    __readerController.changed((delay = number));
    player.setLoop();
    __readerController.changed((lastCue = -1));
    updateCurrent();
    scheduleSave(true);
  }
  function changeFollow(event: Event) {
    __readerController.changed((follow = (event.currentTarget as HTMLInputElement).checked));
    if (!follow) navigation.cancel();
    __readerController.changed((lastCue = -1));
    updateCurrent();
    scheduleSave(true);
  }
  async function removeSaved() {
    __readerController.changed((confirmClear = false));
    __readerController.changed((clearing = true));
    __readerController.changed((saveGeneration += 1));
    __readerController.changed((subtitleGeneration += 1));
    __readerController.changed((subtitleLoading = false));
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      __readerController.changed((saveTimer = undefined));
    }
    cancelMatch();
    highlight.clear();
    player.clear();
    index?.dispose();
    source?.dispose();
    __readerController.changed((source = undefined));
    navigation.cancel();
    __readerController.changed((index = undefined));
    __readerController.changed((matches = []));
    __readerController.changed((hasMatched = false));
    __readerController.changed((matchedCount = 0));
    __readerController.changed((approximateCount = 0));
    __readerController.changed((subtitleSource = ''));
    __readerController.changed((subtitleName = ''));
    __readerController.changed((cues = []));
    __readerController.changed((timeline = new CueTimeline([])));
    __readerController.changed((delay = 0));
    __readerController.changed((follow = false));
    __readerController.changed((approximate = false));
    __readerController.changed((lastCue = -1));
    __readerController.changed((current = -1));
    __readerController.changed((error = ''));
    __readerController.changed((matchError = ''));
    try {
      await session.remove();
      if (alive) __readerController.changed((storageError = ''));
    } catch {
      if (alive)
        __readerController.changed(
          (storageError =
            'Saved audiobook data could not be removed. Saving remains disabled to protect the existing record. Close other tabs and try removing it again.')
        );
    } finally {
      if (alive) {
        player.setRate(1);
        __readerController.changed((clearing = false));
      }
    }
  }

  const api = {
    controller: __readerController,
    restore,
    sessionSnapshot,
    save,
    scheduleSave,
    closeAudio,
    pauseFromBar,
    selectAudio,
    selectSubtitles,
    cancelMatch,
    matchBook,
    invalidateMatches,
    contentChanged,
    panelVisibilityChanged,
    changeApproximate,
    observeLiveBook,
    updateCurrent,
    navigateToRange,
    showLocation,
    showInBook,
    selectCue,
    moveCue,
    pageTranscript,
    toggleLoop,
    changeDelay,
    changeFollow,
    removeSaved,
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
      __readerController.invalidate();
    },
    get bookId() {
      return bookId;
    },
    set bookId(nextValue: typeof bookId) {
      if (Object.is(bookId, nextValue)) return;
      bookId = nextValue;
      __readerController.invalidate();
    },
    get bookTitle() {
      return bookTitle;
    },
    set bookTitle(nextValue: typeof bookTitle) {
      if (Object.is(bookTitle, nextValue)) return;
      bookTitle = nextValue;
      __readerController.invalidate();
    },
    get htmlContent() {
      return htmlContent;
    },
    set htmlContent(nextValue: typeof htmlContent) {
      if (Object.is(htmlContent, nextValue)) return;
      htmlContent = nextValue;
      __readerController.invalidate();
    },
    get layoutKey() {
      return layoutKey;
    },
    set layoutKey(nextValue: typeof layoutKey) {
      if (Object.is(layoutKey, nextValue)) return;
      layoutKey = nextValue;
      __readerController.invalidate();
    },
    get bookmarkManager() {
      return bookmarkManager;
    },
    set bookmarkManager(nextValue: typeof bookmarkManager) {
      if (Object.is(bookmarkManager, nextValue)) return;
      bookmarkManager = nextValue;
      __readerController.invalidate();
    },
    get onFollow() {
      return onFollow;
    },
    set onFollow(nextValue: typeof onFollow) {
      if (Object.is(onFollow, nextValue)) return;
      onFollow = nextValue;
      __readerController.invalidate();
    },
    get returnFocus() {
      return returnFocus;
    },
    set returnFocus(nextValue: typeof returnFocus) {
      if (Object.is(returnFocus, nextValue)) return;
      returnFocus = nextValue;
      __readerController.invalidate();
    },
    get selectionHint() {
      return selectionHint;
    },
    set selectionHint(nextValue: typeof selectionHint) {
      if (Object.is(selectionHint, nextValue)) return;
      selectionHint = nextValue;
      __readerController.invalidate();
    },
    get mounted() {
      return mounted;
    },
    set mounted(nextValue: typeof mounted) {
      if (Object.is(mounted, nextValue)) return;
      mounted = nextValue;
      __readerController.invalidate();
    },
    get alive() {
      return alive;
    },
    set alive(nextValue: typeof alive) {
      if (Object.is(alive, nextValue)) return;
      alive = nextValue;
      __readerController.invalidate();
    },
    get ready() {
      return ready;
    },
    set ready(nextValue: typeof ready) {
      if (Object.is(ready, nextValue)) return;
      ready = nextValue;
      __readerController.invalidate();
    },
    get audioHost() {
      return audioHost;
    },
    set audioHost(nextValue: typeof audioHost) {
      if (Object.is(audioHost, nextValue)) return;
      audioHost = nextValue;
      __readerController.invalidate();
    },
    get audioBarOpenButton() {
      return audioBarOpenButton;
    },
    set audioBarOpenButton(nextValue: typeof audioBarOpenButton) {
      if (Object.is(audioBarOpenButton, nextValue)) return;
      audioBarOpenButton = nextValue;
      __readerController.invalidate();
    },
    get player() {
      return player;
    },
    set player(nextValue: typeof player) {
      if (Object.is(player, nextValue)) return;
      player = nextValue;
      __readerController.invalidate();
    },
    get pitch() {
      return pitch;
    },
    set pitch(nextValue: typeof pitch) {
      if (Object.is(pitch, nextValue)) return;
      pitch = nextValue;
      __readerController.invalidate();
    },
    get pitchState() {
      return pitchState;
    },
    set pitchState(nextValue: typeof pitchState) {
      if (Object.is(pitchState, nextValue)) return;
      pitchState = nextValue;
      __readerController.invalidate();
    },
    get session() {
      return session;
    },
    set session(nextValue: typeof session) {
      if (Object.is(session, nextValue)) return;
      session = nextValue;
      __readerController.invalidate();
    },
    get highlight() {
      return highlight;
    },
    set highlight(nextValue: typeof highlight) {
      if (Object.is(highlight, nextValue)) return;
      highlight = nextValue;
      __readerController.invalidate();
    },
    get navigator() {
      return navigator;
    },
    set navigator(nextValue: typeof navigator) {
      if (Object.is(navigator, nextValue)) return;
      navigator = nextValue;
      __readerController.invalidate();
    },
    get source() {
      return source;
    },
    set source(nextValue: typeof source) {
      if (Object.is(source, nextValue)) return;
      source = nextValue;
      __readerController.invalidate();
    },
    get liveObserver() {
      return liveObserver;
    },
    set liveObserver(nextValue: typeof liveObserver) {
      if (Object.is(liveObserver, nextValue)) return;
      liveObserver = nextValue;
      __readerController.invalidate();
    },
    get navigation() {
      return navigation;
    },
    set navigation(nextValue: typeof navigation) {
      if (Object.is(navigation, nextValue)) return;
      navigation = nextValue;
      __readerController.invalidate();
    },
    get snapshot() {
      return snapshot;
    },
    set snapshot(nextValue: typeof snapshot) {
      if (Object.is(snapshot, nextValue)) return;
      snapshot = nextValue;
      __readerController.invalidate();
    },
    get subtitleSource() {
      return subtitleSource;
    },
    set subtitleSource(nextValue: typeof subtitleSource) {
      if (Object.is(subtitleSource, nextValue)) return;
      subtitleSource = nextValue;
      __readerController.invalidate();
    },
    get subtitleName() {
      return subtitleName;
    },
    set subtitleName(nextValue: typeof subtitleName) {
      if (Object.is(subtitleName, nextValue)) return;
      subtitleName = nextValue;
      __readerController.invalidate();
    },
    get cues() {
      return cues;
    },
    set cues(nextValue: typeof cues) {
      if (Object.is(cues, nextValue)) return;
      cues = nextValue;
      __readerController.invalidate();
    },
    get timeline() {
      return timeline;
    },
    set timeline(nextValue: typeof timeline) {
      if (Object.is(timeline, nextValue)) return;
      timeline = nextValue;
      __readerController.invalidate();
    },
    get current() {
      return current;
    },
    set current(nextValue: typeof current) {
      if (Object.is(current, nextValue)) return;
      current = nextValue;
      __readerController.invalidate();
    },
    get delay() {
      return delay;
    },
    set delay(nextValue: typeof delay) {
      if (Object.is(delay, nextValue)) return;
      delay = nextValue;
      __readerController.invalidate();
    },
    get follow() {
      return follow;
    },
    set follow(nextValue: typeof follow) {
      if (Object.is(follow, nextValue)) return;
      follow = nextValue;
      __readerController.invalidate();
    },
    get approximate() {
      return approximate;
    },
    set approximate(nextValue: typeof approximate) {
      if (Object.is(approximate, nextValue)) return;
      approximate = nextValue;
      __readerController.invalidate();
    },
    get subtitleLoading() {
      return subtitleLoading;
    },
    set subtitleLoading(nextValue: typeof subtitleLoading) {
      if (Object.is(subtitleLoading, nextValue)) return;
      subtitleLoading = nextValue;
      __readerController.invalidate();
    },
    get subtitleGeneration() {
      return subtitleGeneration;
    },
    set subtitleGeneration(nextValue: typeof subtitleGeneration) {
      if (Object.is(subtitleGeneration, nextValue)) return;
      subtitleGeneration = nextValue;
      __readerController.invalidate();
    },
    get error() {
      return error;
    },
    set error(nextValue: typeof error) {
      if (Object.is(error, nextValue)) return;
      error = nextValue;
      __readerController.invalidate();
    },
    get storageError() {
      return storageError;
    },
    set storageError(nextValue: typeof storageError) {
      if (Object.is(storageError, nextValue)) return;
      storageError = nextValue;
      __readerController.invalidate();
    },
    get matchError() {
      return matchError;
    },
    set matchError(nextValue: typeof matchError) {
      if (Object.is(matchError, nextValue)) return;
      matchError = nextValue;
      __readerController.invalidate();
    },
    get matching() {
      return matching;
    },
    set matching(nextValue: typeof matching) {
      if (Object.is(matching, nextValue)) return;
      matching = nextValue;
      __readerController.invalidate();
    },
    get matchProgress() {
      return matchProgress;
    },
    set matchProgress(nextValue: typeof matchProgress) {
      if (Object.is(matchProgress, nextValue)) return;
      matchProgress = nextValue;
      __readerController.invalidate();
    },
    get matchController() {
      return matchController;
    },
    set matchController(nextValue: typeof matchController) {
      if (Object.is(matchController, nextValue)) return;
      matchController = nextValue;
      __readerController.invalidate();
    },
    get index() {
      return index;
    },
    set index(nextValue: typeof index) {
      if (Object.is(index, nextValue)) return;
      index = nextValue;
      __readerController.invalidate();
    },
    get matches() {
      return matches;
    },
    set matches(nextValue: typeof matches) {
      if (Object.is(matches, nextValue)) return;
      matches = nextValue;
      __readerController.invalidate();
    },
    get matchedCount() {
      return matchedCount;
    },
    set matchedCount(nextValue: typeof matchedCount) {
      if (Object.is(matchedCount, nextValue)) return;
      matchedCount = nextValue;
      __readerController.invalidate();
    },
    get approximateCount() {
      return approximateCount;
    },
    set approximateCount(nextValue: typeof approximateCount) {
      if (Object.is(approximateCount, nextValue)) return;
      approximateCount = nextValue;
      __readerController.invalidate();
    },
    get highlightSupported() {
      return highlightSupported;
    },
    set highlightSupported(nextValue: typeof highlightSupported) {
      if (Object.is(highlightSupported, nextValue)) return;
      highlightSupported = nextValue;
      __readerController.invalidate();
    },
    get lastCue() {
      return lastCue;
    },
    set lastCue(nextValue: typeof lastCue) {
      if (Object.is(lastCue, nextValue)) return;
      lastCue = nextValue;
      __readerController.invalidate();
    },
    get lastHtml() {
      return lastHtml;
    },
    set lastHtml(nextValue: typeof lastHtml) {
      if (Object.is(lastHtml, nextValue)) return;
      lastHtml = nextValue;
      __readerController.invalidate();
    },
    get lastLayout() {
      return lastLayout;
    },
    set lastLayout(nextValue: typeof lastLayout) {
      if (Object.is(lastLayout, nextValue)) return;
      lastLayout = nextValue;
      __readerController.invalidate();
    },
    get lastOpen() {
      return lastOpen;
    },
    set lastOpen(nextValue: typeof lastOpen) {
      if (Object.is(lastOpen, nextValue)) return;
      lastOpen = nextValue;
      __readerController.invalidate();
    },
    get hasMatched() {
      return hasMatched;
    },
    set hasMatched(nextValue: typeof hasMatched) {
      if (Object.is(hasMatched, nextValue)) return;
      hasMatched = nextValue;
      __readerController.invalidate();
    },
    get saveTimer() {
      return saveTimer;
    },
    set saveTimer(nextValue: typeof saveTimer) {
      if (Object.is(saveTimer, nextValue)) return;
      saveTimer = nextValue;
      __readerController.invalidate();
    },
    get lastSave() {
      return lastSave;
    },
    set lastSave(nextValue: typeof lastSave) {
      if (Object.is(lastSave, nextValue)) return;
      lastSave = nextValue;
      __readerController.invalidate();
    },
    get saveGeneration() {
      return saveGeneration;
    },
    set saveGeneration(nextValue: typeof saveGeneration) {
      if (Object.is(saveGeneration, nextValue)) return;
      saveGeneration = nextValue;
      __readerController.invalidate();
    },
    get clearing() {
      return clearing;
    },
    set clearing(nextValue: typeof clearing) {
      if (Object.is(clearing, nextValue)) return;
      clearing = nextValue;
      __readerController.invalidate();
    },
    get confirmClear() {
      return confirmClear;
    },
    set confirmClear(nextValue: typeof confirmClear) {
      if (Object.is(confirmClear, nextValue)) return;
      confirmClear = nextValue;
      __readerController.invalidate();
    },
    get transcriptPage() {
      return transcriptPage;
    },
    set transcriptPage(nextValue: typeof transcriptPage) {
      if (Object.is(transcriptPage, nextValue)) return;
      transcriptPage = nextValue;
      __readerController.invalidate();
    },
    get previousTranscriptPage() {
      return previousTranscriptPage;
    },
    set previousTranscriptPage(nextValue: typeof previousTranscriptPage) {
      if (Object.is(previousTranscriptPage, nextValue)) return;
      previousTranscriptPage = nextValue;
      __readerController.invalidate();
    },
    get nextTranscriptPage() {
      return nextTranscriptPage;
    },
    set nextTranscriptPage(nextValue: typeof nextTranscriptPage) {
      if (Object.is(nextTranscriptPage, nextValue)) return;
      nextTranscriptPage = nextValue;
      __readerController.invalidate();
    },
    get pageSize() {
      return pageSize;
    },
    get key() {
      return key;
    },
    get pageCount() {
      return pageCount;
    },
    set pageCount(nextValue: typeof pageCount) {
      if (Object.is(pageCount, nextValue)) return;
      pageCount = nextValue;
      __readerController.invalidate();
    },
    get visibleCues() {
      return visibleCues;
    },
    set visibleCues(nextValue: typeof visibleCues) {
      if (Object.is(visibleCues, nextValue)) return;
      visibleCues = nextValue;
      __readerController.invalidate();
    },
    get activeCue() {
      return activeCue;
    },
    set activeCue(nextValue: typeof activeCue) {
      if (Object.is(activeCue, nextValue)) return;
      activeCue = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('open' in next) api.open = next.open as typeof open;
      if ('bookId' in next) api.bookId = next.bookId as typeof bookId;
      if ('bookTitle' in next) api.bookTitle = next.bookTitle as typeof bookTitle;
      if ('htmlContent' in next) api.htmlContent = next.htmlContent as typeof htmlContent;
      if ('layoutKey' in next) api.layoutKey = next.layoutKey as typeof layoutKey;
      if ('bookmarkManager' in next)
        api.bookmarkManager = next.bookmarkManager as typeof bookmarkManager;
      if ('onFollow' in next) api.onFollow = next.onFollow as typeof onFollow;
      if ('returnFocus' in next) api.returnFocus = next.returnFocus as typeof returnFocus;
      if ('selectionHint' in next) api.selectionHint = next.selectionHint as typeof selectionHint;
    }
  };
  return api;
}
