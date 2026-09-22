<script lang="ts">
  import { X, CaretLeft, CaretRight, Check } from 'phosphor-svelte';
  import { Button } from '$lib/components/ui/button';
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

  export let bookTitle = '';
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

<section class="contents-panel flex h-full min-h-0 flex-col" aria-label="Table of contents">
  <div class="flex items-start justify-between gap-4 p-6 pb-4">
    <div class="min-w-0">
      <h2 class="text-xl font-semibold">Contents</h2>
      <p class="mt-1 truncate text-sm text-muted-foreground" title={bookTitle}>{bookTitle}</p>
    </div>
    <Button
      variant="secondary"
      size="icon"
      class="min-h-11 min-w-11 rounded-full"
      aria-label="Close Table of Contents"
      onclick={closeTocMenu}><X aria-hidden="true" /></Button
    >
  </div>
  {#if currentChapter}
    <div class="mx-6 mb-4 rounded-2xl bg-muted p-4">
      <p class="text-xs font-medium text-muted-foreground">Current chapter</p>
      <p class="mt-1 font-medium">{currentChapter.label}</p>
      <div
        class="mt-3 h-1 overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
        aria-label="Chapter progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(currentChapterProgress)}
      >
        <div
          class="h-full rounded-full bg-foreground/60"
          style:width={`${currentChapterProgress}%`}
        ></div>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        {currentChapterProgress}% · {currentChapterCharacterProgress} characters
      </p>
    </div>
  {/if}
  <nav class="min-h-0 flex-1 overflow-y-auto px-3" aria-label="Chapters">
    {#each chapters as chapter (chapter.reference)}
      <button
        type="button"
        title={`Go to ${chapter.label}`}
        id={`for${chapter.reference}`}
        class="chapter-row flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left"
        aria-current={chapter === currentChapter ? 'location' : undefined}
        on:click={() => goToChapter(chapter.reference, true)}
      >
        <span class="min-w-0 flex-1 break-words">{chapter.label}</span>
        {#if chapter.progress === 100}<Check
            class="size-4 shrink-0 text-muted-foreground"
            aria-label="Finished"
          />{:else if chapter === currentChapter}<span
            class="size-1.5 shrink-0 rounded-full bg-foreground"
            aria-hidden="true"
          ></span>{/if}
      </button>
    {/each}
  </nav>
  <div class="flex justify-between gap-2 border-t border-border p-4">
    <Button
      variant="ghost"
      class="min-h-11"
      disabled={!prevChapterAvailable}
      title={`${verticalMode ? 'Next' : 'Previous'} Chapter`}
      aria-label={`${verticalMode ? 'Next' : 'Previous'} Chapter`}
      onclick={() => changeChapter(prevChapterAvailable, verticalMode ? 1 : -1)}
      ><CaretLeft aria-hidden="true" /><span
        >{verticalMode ? 'Next' : 'Previous'}<span class="hidden sm:inline"> Chapter</span></span
      ></Button
    >
    <Button
      variant="ghost"
      class="min-h-11"
      disabled={!nextChapterAvailable}
      title={`${verticalMode ? 'Previous' : 'Next'} Chapter`}
      aria-label={`${verticalMode ? 'Previous' : 'Next'} Chapter`}
      onclick={() => changeChapter(nextChapterAvailable, verticalMode ? -1 : 1)}
      ><span
        >{verticalMode ? 'Previous' : 'Next'}<span class="hidden sm:inline"> Chapter</span></span
      ><CaretRight aria-hidden="true" /></Button
    >
  </div>
</section>

<style>
  .contents-panel {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .chapter-row:hover,
  .chapter-row[aria-current] {
    background: var(--muted);
  }
  .chapter-row:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
</style>
