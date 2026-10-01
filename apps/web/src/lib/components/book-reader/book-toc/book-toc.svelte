<script lang="ts">
  import { CaretLeft, CaretRight, Check } from 'phosphor-svelte';
  import { Button } from '$lib/components/ui/button';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import {
    getChapterData,
    nextChapter$,
    tocIsOpen$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import { adjacentChapterIndex, chapterCharacters, chapterPercentage } from './chapter-model';
  import { createChapterNavigation } from './chapter-navigation';
  import { isTrackerPaused$ } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import { PAGE_CHANGE } from '$lib/data/events';
  import { skipKeyDownListener$, statisticsEnabled$ } from '$lib/data/store';
  import { onMount, tick } from 'svelte';

  export let bookTitle = '';
  export let sectionData: SectionWithProgress[] = [];
  export let exploredCharCount = 0;
  export let verticalMode: boolean;
  export let wasTrackerPaused: boolean;

  let chapters: SectionWithProgress[] = [];
  let currentChapter: SectionWithProgress | undefined;
  let currentChapterIndex = -1;
  let currentChapterProgress: number | undefined;
  let chapterList: HTMLElement;
  let mounted = false;
  let followedReference: string | undefined;
  let followGeneration = 0;
  let navigation: ReturnType<typeof createChapterNavigation> | undefined;

  $: previousIndex = adjacentChapterIndex(
    chapters.length,
    currentChapterIndex,
    verticalMode ? 1 : -1
  );
  $: nextIndex = adjacentChapterIndex(
    chapters.length,
    currentChapterIndex,
    verticalMode ? -1 : 1
  );
  $: {
    const [mainChapters, chapterIndex, referenceId] = getChapterData(sectionData);
    chapters = mainChapters;
    currentChapterIndex = chapterIndex;
    currentChapter = mainChapters[chapterIndex];
    currentChapterProgress = currentChapter
      ? chapterPercentage(sectionData, referenceId)
      : undefined;
  }
  $: characterProgress = chapterCharacters(currentChapter, exploredCharCount);
  $: if (mounted) revealCurrentChapter(currentChapter?.reference);

  onMount(() => {
    mounted = true;
    $skipKeyDownListener$ = true;
    navigation = createChapterNavigation(
      document,
      PAGE_CHANGE,
      (reference) => nextChapter$.next(reference),
      closeTocMenu
    );
    // Escape/outside dismissal can start an outro before this component dies.
    const dismissal = tocIsOpen$.subscribe((open) => {
      if (!open) {
        navigation?.cancel();
        followGeneration += 1;
      }
    });
    return () => {
      mounted = false;
      followGeneration += 1;
      navigation?.dispose();
      dismissal.unsubscribe();
      $skipKeyDownListener$ = false;
    };
  });

  function revealCurrentChapter(reference: string | undefined) {
    if (reference === followedReference) return;
    followedReference = reference;
    const generation = ++followGeneration;
    void tick().then(() => {
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
</script>

<!-- The enclosing Sheet is the sole scroll owner. A long title, large text or
     short landscape viewport must never shrink the chapter list to nothing. -->
<section class="contents-panel flex min-h-full shrink-0 flex-col" aria-label="Table of contents">
  <header
    class="grid grid-cols-[minmax(0,1fr)_44px] items-start gap-[16px] px-[24px] pt-[24px] pb-[16px]"
  >
    <div class="min-w-0">
      <h2 class="whitespace-nowrap text-xl font-semibold">Contents</h2>
      <p class="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{bookTitle}</p>
    </div>
    <CloseButton aria-label="Close Table of Contents" onclick={closeTocMenu} />
  </header>
  {#if currentChapter}
    <div class="mx-6 mb-3 border-b border-border pb-4">
      <p class="text-xs font-medium text-muted-foreground">Current chapter</p>
      <p class="mt-1 font-medium [overflow-wrap:anywhere]">
        {currentChapter.label || `Chapter ${currentChapterIndex + 1}`}
      </p>
      {#if currentChapterProgress !== undefined}
        <div
          class="mt-3 h-1 overflow-hidden rounded-full bg-foreground/10"
          role="progressbar"
          aria-label="Chapter progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={currentChapterProgress}
        >
          <div
            class="h-full rounded-full bg-foreground/60"
            style:width={`${currentChapterProgress}%`}
          ></div>
        </div>
      {/if}
      <p class="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {currentChapterProgress === undefined
          ? 'Progress unavailable'
          : `${Number(currentChapterProgress.toFixed(2))}%`}
        {#if characterProgress}
          · {characterProgress.read} / {characterProgress.total} characters
        {/if}
      </p>
    </div>
  {/if}
  <nav bind:this={chapterList} class="flex-1 px-3 pb-4" aria-label="Chapters">
    {#each chapters as chapter, index (chapter.reference)}
      <button
        type="button"
        title={`Go to ${chapter.label || `Chapter ${index + 1}`}`}
        class="chapter-row flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left"
        aria-current={index === currentChapterIndex ? 'location' : undefined}
        on:click={() => goToChapter(index, true)}
      >
        <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {chapter.label || `Chapter ${index + 1}`}
        </span>
        {#if chapter.progress === 100}<Check
            class="size-4 shrink-0 text-muted-foreground"
            aria-label="Finished"
          />{:else if index === currentChapterIndex}<span
            class="size-1.5 shrink-0 rounded-full bg-foreground"
            aria-hidden="true"
          ></span>{/if}
      </button>
    {:else}
      <p class="px-3 py-6 text-sm text-muted-foreground">No chapters available for this book.</p>
    {/each}
  </nav>
  <footer class="flex flex-wrap justify-between gap-2 border-t border-border p-4">
    <Button
      variant="ghost"
      class="min-h-11"
      disabled={previousIndex < 0}
      title={`${verticalMode ? 'Next' : 'Previous'} Chapter`}
      aria-label={`${verticalMode ? 'Next' : 'Previous'} Chapter`}
      onclick={() => goToChapter(previousIndex)}
      ><CaretLeft aria-hidden="true" /><span
        >{verticalMode ? 'Next' : 'Previous'}<span class="hidden sm:inline"> Chapter</span></span
      ></Button
    >
    <Button
      variant="ghost"
      class="min-h-11"
      disabled={nextIndex < 0}
      title={`${verticalMode ? 'Previous' : 'Next'} Chapter`}
      aria-label={`${verticalMode ? 'Previous' : 'Next'} Chapter`}
      onclick={() => goToChapter(nextIndex)}
      ><span
        >{verticalMode ? 'Previous' : 'Next'}<span class="hidden sm:inline"> Chapter</span></span
      ><CaretRight aria-hidden="true" /></Button
    >
  </footer>
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
