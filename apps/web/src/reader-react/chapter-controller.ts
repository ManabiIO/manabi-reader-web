/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  getChapterData,
  nextChapter$,
  tocIsOpen$,
  type SectionWithProgress
} from '$lib/components/book-reader/book-toc/book-toc';
import {
  adjacentChapterIndex,
  chapterCharacters,
  chapterPercentage
} from '../lib/components/book-reader/book-toc/chapter-model';
import { createChapterNavigation } from '../lib/components/book-reader/book-toc/chapter-navigation';
import { isTrackerPaused$ } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { PAGE_CHANGE } from '$lib/data/events';
import { skipKeyDownListener$, statisticsEnabled$ } from '$lib/data/store';
import { ReaderController, readerTick, writeStore, type StoreValue } from './controller';
export interface ChapterProps {
  bookTitle?: string;
  sectionData?: SectionWithProgress[];
  exploredCharCount?: number;
  verticalMode: boolean;
  wasTrackerPaused: boolean;
}

export function createChapter(
  props: ChapterProps,
  _emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let previousIndex: ReturnType<typeof adjacentChapterIndex>;
  let nextIndex: ReturnType<typeof adjacentChapterIndex>;
  let characterProgress: ReturnType<typeof chapterCharacters>;
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $statisticsEnabled$: StoreValue<typeof statisticsEnabled$> =
    __readerController.read(statisticsEnabled$);
  let bookTitle = props.bookTitle !== undefined ? props.bookTitle : '';
  let sectionData: SectionWithProgress[] = props.sectionData !== undefined ? props.sectionData : [];
  let exploredCharCount = props.exploredCharCount !== undefined ? props.exploredCharCount : 0;
  let verticalMode: boolean = props.verticalMode;
  let wasTrackerPaused: boolean = props.wasTrackerPaused;
  let chapters: SectionWithProgress[] = [];
  let currentChapter: SectionWithProgress | undefined;
  let currentChapterIndex = -1;
  let currentChapterProgress: number | undefined;
  let chapterList: HTMLElement;
  let mounted = false;
  let followedReference: string | undefined;
  let followGeneration = 0;
  let navigation: ReturnType<typeof createChapterNavigation> | undefined;
  __readerController.effect(
    () => [chapters, currentChapterIndex, verticalMode],
    () => {
      __readerController.changed(
        (previousIndex = adjacentChapterIndex(
          chapters.length,
          currentChapterIndex,
          verticalMode ? 1 : -1
        ))
      );
    }
  );
  __readerController.effect(
    () => [chapters, currentChapterIndex, verticalMode],
    () => {
      __readerController.changed(
        (nextIndex = adjacentChapterIndex(
          chapters.length,
          currentChapterIndex,
          verticalMode ? -1 : 1
        ))
      );
    }
  );
  __readerController.effect(
    () => [sectionData],
    () => {
      const [mainChapters, chapterIndex, referenceId] = getChapterData(sectionData);
      __readerController.changed((chapters = mainChapters));
      __readerController.changed((currentChapterIndex = chapterIndex));
      __readerController.changed((currentChapter = mainChapters[chapterIndex]));
      __readerController.changed(
        (currentChapterProgress = currentChapter
          ? chapterPercentage(sectionData, referenceId)
          : undefined)
      );
    }
  );
  __readerController.effect(
    () => [currentChapter, exploredCharCount],
    () => {
      __readerController.changed(
        (characterProgress = chapterCharacters(currentChapter, exploredCharCount))
      );
    }
  );
  __readerController.effect(
    () => [mounted, currentChapter],
    () => {
      if (mounted) revealCurrentChapter(currentChapter?.reference);
    }
  );
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    writeStore(skipKeyDownListener$, true);
    __readerController.changed(
      (navigation = createChapterNavigation(
        document,
        PAGE_CHANGE,
        (reference) => nextChapter$.next(reference),
        closeTocMenu
      ))
    );
    // Escape/outside dismissal can start an outro before this component dies.
    const dismissal = tocIsOpen$.subscribe((open) => {
      if (!open) {
        navigation?.cancel();
        __readerController.changed((followGeneration += 1));
      }
    });
    return () => {
      __readerController.changed((mounted = false));
      __readerController.changed((followGeneration += 1));
      navigation?.dispose();
      dismissal.unsubscribe();
      writeStore(skipKeyDownListener$, false);
    };
  });
  function revealCurrentChapter(reference: string | undefined) {
    if (reference === followedReference) return;
    __readerController.changed((followedReference = reference));
    const generation = __readerController.changed(++followGeneration);
    void readerTick().then(() => {
      if (!mounted || generation !== followGeneration) return;
      // Scope to this panel; publication references are not global DOM IDs.
      chapterList
        ?.querySelector<HTMLElement>('[aria-current="location"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  function goToChapter(index: number, closeToc = false) {
    const chapter = chapters[index];
    if (!chapter) return;
    navigation?.select(
      chapter.reference,
      closeToc,
      $statisticsEnabled$ && !wasTrackerPaused && exploredCharCount !== chapter.startCharacter
    );
  }
  function closeTocMenu() {
    navigation?.cancel();
    tocIsOpen$.next(false);
    if ($statisticsEnabled$ && !wasTrackerPaused) {
      isTrackerPaused$.next(false);
    }
  }
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsEnabled$,
    (value) => {
      $statisticsEnabled$ = value;
    }
  );
  const api = {
    controller: __readerController,
    revealCurrentChapter,
    goToChapter,
    closeTocMenu,
    get bookTitle() {
      return bookTitle;
    },
    set bookTitle(nextValue: typeof bookTitle) {
      if (Object.is(bookTitle, nextValue)) return;
      bookTitle = nextValue;
      __readerController.invalidate();
    },
    get sectionData() {
      return sectionData;
    },
    set sectionData(nextValue: typeof sectionData) {
      if (Object.is(sectionData, nextValue)) return;
      sectionData = nextValue;
      __readerController.invalidate();
    },
    get exploredCharCount() {
      return exploredCharCount;
    },
    set exploredCharCount(nextValue: typeof exploredCharCount) {
      if (Object.is(exploredCharCount, nextValue)) return;
      exploredCharCount = nextValue;
      __readerController.invalidate();
    },
    get verticalMode() {
      return verticalMode;
    },
    set verticalMode(nextValue: typeof verticalMode) {
      if (Object.is(verticalMode, nextValue)) return;
      verticalMode = nextValue;
      __readerController.invalidate();
    },
    get wasTrackerPaused() {
      return wasTrackerPaused;
    },
    set wasTrackerPaused(nextValue: typeof wasTrackerPaused) {
      if (Object.is(wasTrackerPaused, nextValue)) return;
      wasTrackerPaused = nextValue;
      __readerController.invalidate();
    },
    get chapters() {
      return chapters;
    },
    set chapters(nextValue: typeof chapters) {
      if (Object.is(chapters, nextValue)) return;
      chapters = nextValue;
      __readerController.invalidate();
    },
    get currentChapter() {
      return currentChapter;
    },
    set currentChapter(nextValue: typeof currentChapter) {
      if (Object.is(currentChapter, nextValue)) return;
      currentChapter = nextValue;
      __readerController.invalidate();
    },
    get currentChapterIndex() {
      return currentChapterIndex;
    },
    set currentChapterIndex(nextValue: typeof currentChapterIndex) {
      if (Object.is(currentChapterIndex, nextValue)) return;
      currentChapterIndex = nextValue;
      __readerController.invalidate();
    },
    get currentChapterProgress() {
      return currentChapterProgress;
    },
    set currentChapterProgress(nextValue: typeof currentChapterProgress) {
      if (Object.is(currentChapterProgress, nextValue)) return;
      currentChapterProgress = nextValue;
      __readerController.invalidate();
    },
    get chapterList() {
      return chapterList;
    },
    set chapterList(nextValue: typeof chapterList) {
      if (Object.is(chapterList, nextValue)) return;
      chapterList = nextValue;
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
    get followedReference() {
      return followedReference;
    },
    set followedReference(nextValue: typeof followedReference) {
      if (Object.is(followedReference, nextValue)) return;
      followedReference = nextValue;
      __readerController.invalidate();
    },
    get followGeneration() {
      return followGeneration;
    },
    set followGeneration(nextValue: typeof followGeneration) {
      if (Object.is(followGeneration, nextValue)) return;
      followGeneration = nextValue;
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
    get previousIndex() {
      return previousIndex;
    },
    set previousIndex(nextValue: typeof previousIndex) {
      if (Object.is(previousIndex, nextValue)) return;
      previousIndex = nextValue;
      __readerController.invalidate();
    },
    get nextIndex() {
      return nextIndex;
    },
    set nextIndex(nextValue: typeof nextIndex) {
      if (Object.is(nextIndex, nextValue)) return;
      nextIndex = nextValue;
      __readerController.invalidate();
    },
    get characterProgress() {
      return characterProgress;
    },
    set characterProgress(nextValue: typeof characterProgress) {
      if (Object.is(characterProgress, nextValue)) return;
      characterProgress = nextValue;
      __readerController.invalidate();
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    get $statisticsEnabled$() {
      return $statisticsEnabled$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('bookTitle' in next) api.bookTitle = next.bookTitle as typeof bookTitle;
      if ('sectionData' in next) api.sectionData = next.sectionData as typeof sectionData;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('verticalMode' in next) api.verticalMode = next.verticalMode as typeof verticalMode;
      if ('wasTrackerPaused' in next)
        api.wasTrackerPaused = next.wasTrackerPaused as typeof wasTrackerPaused;
    }
  };
  return api;
}
