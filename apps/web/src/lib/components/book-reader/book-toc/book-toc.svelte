<script lang="ts">
  import faXmark from '@lucide/svelte/icons/x';
  import faChevronLeft from '@lucide/svelte/icons/chevron-left';
  import faChevronRight from '@lucide/svelte/icons/chevron-right';
  import {
    getChapterData,
    nextChapter$,
    tocIsOpen$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import { isTrackerPaused$ } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import { PAGE_CHANGE } from '$lib/data/events';
  import { skipKeyDownListener$, statisticsEnabled$ } from '$lib/data/store';
  import { getWeightedAverage } from '$lib/functions/utils';
  import { debounceTime, fromEvent, merge, take } from 'rxjs';
  import { onMount } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';

  export let sectionData: SectionWithProgress[] = [];
  export let exploredCharCount = 0;
  export let verticalMode: boolean;
  export let wasTrackerPaused: boolean;

  let chapters: SectionWithProgress[] = [];
  let currentChapter: SectionWithProgress;
  let currentChapterIndex = -1;
  let currentChapterCharacterProgress = '0/0';
  let currentChapterProgress = '0.00';

  $: prevChapterAvailable = verticalMode
    ? currentChapterIndex < chapters.length - 1
    : !!currentChapterIndex;
  $: nextChapterAvailable = verticalMode
    ? !!currentChapterIndex
    : currentChapterIndex < chapters.length - 1;

  $: if (sectionData) {
    const [mainChapters, chapterIndex, referenceId] = getChapterData(sectionData);
    const relevantSections = sectionData.filter(
      (section) => section.reference === referenceId || section.parentChapter === referenceId
    );

    currentChapterProgress = getWeightedAverage(
      relevantSections.map((section) => section.progress),
      relevantSections.map((section) => section.charactersWeight)
    ).toFixed(2);
    chapters = mainChapters;
    currentChapterIndex = chapterIndex;
    currentChapter = mainChapters[currentChapterIndex];
  }

  $: if (currentChapter) {
    scrollToChapterItem(document.getElementById(`for${currentChapter.reference}`));

    const endCharacter = currentChapter.characters as number;

    currentChapterCharacterProgress = `${Math.min(
      Math.max(exploredCharCount - (currentChapter.startCharacter as number), 0),
      endCharacter
    )} / ${endCharacter}`;
  }

  onMount(() => {
    $skipKeyDownListener$ = true;
    if (currentChapter) {
      scrollToChapterItem(document.getElementById(`for${currentChapter.reference}`));
    }

    return () => {
      $skipKeyDownListener$ = false;
    };
  });

  function scrollToChapterItem(elm: HTMLElement | null) {
    if (!elm) {
      return;
    }

    if (elm.scrollIntoViewIfNeeded) {
      elm.scrollIntoViewIfNeeded();
    } else {
      elm.scrollIntoView();
    }
  }

  function changeChapter(canNavigate: boolean, indexMod: number) {
    if (canNavigate) {
      const nextChapter = chapters[currentChapterIndex + indexMod];

      goToChapter(nextChapter.reference, false);
    }
  }

  function goToChapter(chapterId: string, closeToc = false) {
    const nextChapter = chapters.find((chapter) => chapter.reference === chapterId);
    const hasCharacterChange = exploredCharCount !== nextChapter?.startCharacter;

    if ($statisticsEnabled$ && closeToc && hasCharacterChange && !wasTrackerPaused) {
      merge(fromEvent(document, PAGE_CHANGE))
        .pipe(debounceTime(200), take(1))
        .subscribe(() => {
          if (closeToc) {
            closeTocMenu();
          }
        });
    }

    nextChapter$.next(chapterId);

    if ((!hasCharacterChange || !$statisticsEnabled$ || wasTrackerPaused) && closeToc) {
      closeTocMenu();
    }
  }

  function closeTocMenu() {
    tocIsOpen$.next(false);

    if ($statisticsEnabled$ && !wasTrackerPaused) {
      isTrackerPaused$.next(false);
    }
  }
</script>

<section class="ui-panel flex h-full min-h-0 flex-col" aria-label="Table of contents">
  <div class="flex justify-between p-4">
    <div>Chapter Progress: {currentChapterCharacterProgress} ({currentChapterProgress}%)</div>
    <button
      type="button"
      title="Close Table of Contents"
      class="flex items-end md:items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
      on:click={closeTocMenu}
    >
      <AppIcon icon={faXmark} />
      <span>Close Table of Contents</span></button
    >
  </div>
  <div class="flex-1 overflow-auto p-4">
    {#each chapters as chapter (chapter.reference)}
      <div class="my-6 flex justify-between">
        <button
          type="button"
          title={`Go to ${chapter.label}`}
          id={`for${chapter.reference}`}
          class="mr-4"
          class:opacity-30={chapter.progress === 100 && chapter !== currentChapter}
          class:hover:opacity-100={chapter.progress === 100 && chapter !== currentChapter}
          class:hover:opacity-60={chapter.progress < 100 || chapter === currentChapter}
          on:click={() => goToChapter(chapter.reference, true)}
        >
          {chapter.label}
        </button>
        <div class:opacity-30={chapter.progress === 100 && chapter !== currentChapter}>
          {chapter.startCharacter}
        </div>
      </div>
    {/each}
  </div>
  <div class="flex justify-between px-4 py-6">
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
      disabled={!prevChapterAvailable}
      title={`${verticalMode ? 'Next' : 'Previous'} Chapter`}
      class:opacity-30={!prevChapterAvailable}
      on:click={() => changeChapter(prevChapterAvailable, verticalMode ? 1 : -1)}
    >
      <AppIcon icon={faChevronLeft} />
      <span>{verticalMode ? 'Next Chapter' : 'Previous Chapter'}</span></button
    >
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
      disabled={!nextChapterAvailable}
      title={`${verticalMode ? 'Previous' : 'Next'} Chapter`}
      class:opacity-30={!nextChapterAvailable}
      on:click={() => changeChapter(nextChapterAvailable, verticalMode ? -1 : 1)}
    >
      <AppIcon icon={faChevronRight} />
      <span>{verticalMode ? 'Previous Chapter' : 'Next Chapter'}</span></button
    >
  </div>
</section>
