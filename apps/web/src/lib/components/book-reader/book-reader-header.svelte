<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import { openUserGuide } from '$lib/components/navigation/docs-link';
  import {
    ArrowLeft,
    BookmarkSimple as Bookmark,
    List,
    TextAa,
    ArrowUUpLeft,
    Crosshair,
    Images,
    CheckCircle,
    MapPin,
    ArrowsOut,
    Gear,
    ChartBar,
    Info,
    DotsThree
  } from 'phosphor-svelte';
  import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import { customReadingPointEnabled$, viewMode$ } from '$lib/data/store';
  import { ViewMode } from '$lib/data/view-mode';
  import { isMobile$, isOnOldUrl } from '$lib/functions/utils';

  export let bookTitle = '';
  export let hasChapterData: boolean;
  export let hasText: boolean;
  export let autoScrollMultiplier: number;
  export let hasCustomReadingPoint: boolean;
  export let showFullscreenButton: boolean;
  export let isBookmarkScreen: boolean;
  export let hasBookmarkData: boolean;

  const dispatch = createEventDispatcher<{
    appearanceClick: void;
    tocClick: void;
    bookmarkClick: void;
    scrollToBookmarkClick: void;
    jumpClick: void;
    completeBook: void;
    fullscreenClick: void;
    showCustomReadingPoint: void;
    setCustomReadingPoint: void;
    resetCustomReadingPoint: void;
    statisticsClick: void;
    readerImageGalleryClick: void;
    settingsClick: void;
    domainHintClick: void;
    bookManagerClick: void;
  }>();
  $: oldDomain = browser && isOnOldUrl(window);
</script>

<header
  class="app-header reader-toolbar flex min-h-16 items-center justify-between gap-1 bg-background px-3 text-foreground sm:gap-3 sm:px-6"
  aria-label="Reader toolbar"
>
  <div class="flex items-center gap-1">
    <Button
      variant="ghost"
      class="min-h-11"
      onclick={() => dispatch('bookManagerClick')}
      title="Return to Library"
      ><ArrowLeft class="size-4" aria-hidden="true" /><span>Library</span></Button
    >
    {#if hasChapterData}
      <Button
        variant="ghost"
        onclick={() => dispatch('tocClick')}
        title="Open Table of Contents"
        aria-label="Contents"
        class="min-h-11 min-w-11"
      >
        <List class="size-5" aria-hidden="true" /><span class="hidden sm:inline">Contents</span>
      </Button>
    {/if}
    <Button
      variant={isBookmarkScreen ? 'secondary' : 'ghost'}
      aria-pressed={isBookmarkScreen}
      onclick={() => dispatch('bookmarkClick')}
      title="Create Bookmark"
      aria-label="Bookmark"
      class="min-h-11 min-w-11"
    >
      <Bookmark
        class="size-5"
        weight={isBookmarkScreen ? 'fill' : 'regular'}
        aria-hidden="true"
      /><span class="hidden sm:inline">Bookmark</span>
    </Button>
  </div>
  <p
    class="hidden min-w-0 flex-1 truncate text-center text-sm text-muted-foreground lg:block"
    title={bookTitle}
  >
    {bookTitle}
  </p>
  <div class="flex items-center gap-1">
    <Button
      variant="ghost"
      class="min-h-11 min-w-11"
      aria-label="Themes & Settings"
      onclick={() => dispatch('appearanceClick')}
      ><TextAa class="size-5" aria-hidden="true" /><span class="hidden md:inline">Appearance</span
      ></Button
    >
    <Menu.Root>
      <Menu.Trigger
        >{#snippet child({ props })}<Button
            {...props}
            variant="secondary"
            size="icon"
            class="min-h-11 min-w-11 rounded-full"
            aria-label="Reading tools"
            title="Reading tools"><DotsThree class="size-5" aria-hidden="true" /></Button
          >{/snippet}</Menu.Trigger
      >
      <Menu.Content
        align="end"
        class="max-h-[min(75dvh,36rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto"
      >
        <Menu.Label>Reading</Menu.Label>
        {#if hasBookmarkData}<Menu.Item onSelect={() => dispatch('scrollToBookmarkClick')}
            ><ArrowUUpLeft aria-hidden="true" />Return to Bookmark</Menu.Item
          >{/if}
        {#if hasText}<Menu.Item onSelect={() => dispatch('jumpClick')}
            ><Crosshair aria-hidden="true" />Jump to Position</Menu.Item
          >{/if}
        {#if $readerImageGalleryPictures$.length}<Menu.Item
            onSelect={() => dispatch('readerImageGalleryClick')}
            ><Images aria-hidden="true" />Image Gallery</Menu.Item
          >{/if}
        <Menu.Item onSelect={() => dispatch('completeBook')}
          ><CheckCircle aria-hidden="true" />Complete Book</Menu.Item
        >
        {#if $customReadingPointEnabled$ || $viewMode$ === ViewMode.Paginated}
          <Menu.Separator />
          <Menu.Label>Custom reading point</Menu.Label>
          {#if hasCustomReadingPoint}<Menu.Item onSelect={() => dispatch('showCustomReadingPoint')}
              ><MapPin aria-hidden="true" />Show Point</Menu.Item
            >{/if}
          <Menu.Item onSelect={() => dispatch('setCustomReadingPoint')}
            ><MapPin aria-hidden="true" />Set Point</Menu.Item
          >
          {#if hasCustomReadingPoint}<Menu.Item onSelect={() => dispatch('resetCustomReadingPoint')}
              ><ArrowUUpLeft aria-hidden="true" />Reset Point</Menu.Item
            >{/if}
        {/if}
        {#if $viewMode$ === ViewMode.Continuous && !$isMobile$}
          <Menu.Separator /><Menu.Label>Autoscroll speed: {autoScrollMultiplier}×</Menu.Label>
        {/if}
        <Menu.Separator />
        {#if showFullscreenButton}<Menu.Item onSelect={() => dispatch('fullscreenClick')}
            ><ArrowsOut aria-hidden="true" />Toggle Fullscreen</Menu.Item
          >{/if}
        <Menu.Item onSelect={() => dispatch('settingsClick')}
          ><Gear aria-hidden="true" />Settings</Menu.Item
        >
        <Menu.Item onSelect={() => dispatch('statisticsClick')}
          ><ChartBar aria-hidden="true" />Statistics</Menu.Item
        >
        <Menu.Item onSelect={openUserGuide}>User guide</Menu.Item>
        {#if oldDomain}<Menu.Item onSelect={() => dispatch('domainHintClick')}
            ><Info aria-hidden="true" />Old domain information</Menu.Item
          >{/if}
      </Menu.Content>
    </Menu.Root>
  </div>
</header>

<style>
  .reader-toolbar {
    padding-top: env(safe-area-inset-top);
  }
  .reader-toolbar :global([aria-label='Reading tools']) {
    min-height: 44px;
  }
</style>
