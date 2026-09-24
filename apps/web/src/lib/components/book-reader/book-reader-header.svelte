<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  import { openUserGuide } from '$lib/components/navigation/docs-link';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import List from '@lucide/svelte/icons/list';
  import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import { customReadingPointEnabled$, viewMode$ } from '$lib/data/store';
  import { ViewMode } from '$lib/data/view-mode';
  import { isMobile$, isOnOldUrl } from '$lib/functions/utils';

  export let hasChapterData: boolean;
  export let hasText: boolean;
  export let autoScrollMultiplier: number;
  export let hasCustomReadingPoint: boolean;
  export let showFullscreenButton: boolean;
  export let isBookmarkScreen: boolean;
  export let hasBookmarkData: boolean;

  const dispatch = createEventDispatcher<{
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
  class="app-header flex h-12 items-center justify-between gap-1 border-b border-border bg-card px-2 text-foreground sm:px-4"
  aria-label="Reader toolbar"
>
  <div class="flex items-center gap-1">
    <Button variant="ghost" onclick={() => dispatch('bookManagerClick')} title="Go to Book Manager"
      >Library</Button
    >
    {#if hasChapterData}
      <Button variant="ghost" onclick={() => dispatch('tocClick')} title="Open Table of Contents">
        <List class="hidden size-4 sm:block" aria-hidden="true" />Contents
      </Button>
    {/if}
    <Button
      variant={isBookmarkScreen ? 'secondary' : 'ghost'}
      aria-pressed={isBookmarkScreen}
      onclick={() => dispatch('bookmarkClick')}
      title="Create Bookmark"
    >
      <Bookmark class="hidden size-4 sm:block" aria-hidden="true" />Bookmark
    </Button>
  </div>
  <ActionMenu label="Tools" title="Reading tools">
    <Menu.Label>Reading</Menu.Label>
    {#if hasBookmarkData}<Menu.Item onSelect={() => dispatch('scrollToBookmarkClick')}
        >Return to Bookmark</Menu.Item
      >{/if}
    {#if hasText}<Menu.Item onSelect={() => dispatch('jumpClick')}>Jump to Position</Menu.Item>{/if}
    {#if $readerImageGalleryPictures$.length}<Menu.Item
        onSelect={() => dispatch('readerImageGalleryClick')}>Image Gallery</Menu.Item
      >{/if}
    <Menu.Item onSelect={() => dispatch('completeBook')}>Complete Book</Menu.Item>
    {#if $customReadingPointEnabled$ || $viewMode$ === ViewMode.Paginated}
      <Menu.Separator />
      <Menu.Label>Custom reading point</Menu.Label>
      {#if hasCustomReadingPoint}<Menu.Item onSelect={() => dispatch('showCustomReadingPoint')}
          >Show Point</Menu.Item
        >{/if}
      <Menu.Item onSelect={() => dispatch('setCustomReadingPoint')}>Set Point</Menu.Item>
      {#if hasCustomReadingPoint}<Menu.Item onSelect={() => dispatch('resetCustomReadingPoint')}
          >Reset Point</Menu.Item
        >{/if}
    {/if}
    {#if $viewMode$ === ViewMode.Continuous && !$isMobile$}
      <Menu.Separator /><Menu.Label>Autoscroll speed: {autoScrollMultiplier}×</Menu.Label>
    {/if}
    <Menu.Separator />
    {#if showFullscreenButton}<Menu.Item onSelect={() => dispatch('fullscreenClick')}
        >Toggle Fullscreen</Menu.Item
      >{/if}
    <Menu.Item onSelect={() => dispatch('settingsClick')}>Settings</Menu.Item>
    <Menu.Item onSelect={() => dispatch('statisticsClick')}>Statistics</Menu.Item>
    <Menu.Item onSelect={openUserGuide}>User guide</Menu.Item>
    {#if oldDomain}<Menu.Item onSelect={() => dispatch('domainHintClick')}
        >Old domain information</Menu.Item
      >{/if}
  </ActionMenu>
</header>
