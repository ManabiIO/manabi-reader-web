<script lang="ts">
  import { setContext, onMount, tick } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { writable } from 'svelte/store';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { SETTINGS_FILTER } from './settings-context';
  import SettingsOfflineStatus from './settings-offline-status.svelte';
  const categories = [
    {
      id: 'appearance',
      label: 'Appearance',
      description: 'Theme, light and dark mode, and background images'
    },
    {
      id: 'typography',
      label: 'Fonts & text',
      description: 'Typography, spacing, and Japanese font options'
    },
    {
      id: 'layout',
      label: 'Page layout',
      description: 'Writing direction, pagination, and margins'
    },
    {
      id: 'reading',
      label: 'Reading controls',
      description: 'Bookmarks, navigation, furigana, and images'
    },
    {
      id: 'library',
      label: 'Library & sync',
      description: 'Storage sources, import, export, and backups'
    },
    {
      id: 'tracking',
      label: 'Tracking & goals',
      description: 'Reading statistics, session behavior, and goals'
    },
    {
      id: 'all',
      label: 'All settings',
      description: 'Every available setting, grouped in one place'
    }
  ];
  const filter = writable({ category: 'appearance', query: '' });
  setContext(SETTINGS_FILTER, filter);
  let root: HTMLElement;
  let visibleCount = 0;
  $: selected = categories.find((category) => category.id === $filter.category) ?? categories[0];
  afterNavigate(({ to }) => {
    const category = to?.url.hash.slice(1);
    if (category && categories.some((item) => item.id === category))
      filter.set({ category, query: '' });
  });
  onMount(() => {
    const countVisibleSettings = () => {
      if (root?.isConnected)
        visibleCount = root.querySelectorAll('[data-setting]:not([hidden])').length;
    };
    const stop = filter.subscribe(() => {
      void tick().then(countVisibleSettings);
    });
    // Enabling tracking or changing writing mode mounts conditional fields even
    // when the search hasn't changed. Count those real fields, not stale results.
    const observer = new MutationObserver(countVisibleSettings);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
    countVisibleSettings();
    return () => {
      stop();
      observer.disconnect();
    };
  });
  function choose(category: string) {
    filter.set({ category, query: '' });
  }
</script>

<div
  class="settings-workspace grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]"
  bind:this={root}
>
  <aside class="min-w-0 self-start lg:sticky lg:top-20" aria-label="Settings sections">
    <label for="settings-search" class="mb-2 block text-sm font-medium">Search settings</label>
    <Input
      id="settings-search"
      type="search"
      placeholder="Search all settings…"
      value={$filter.query}
      oninput={(event) =>
        filter.update((value) => ({ ...value, query: event.currentTarget.value }))}
    />
    <nav aria-label="Settings categories" class="section-navigation section-navigation-sidebar mt-3">
      {#each categories as category (category.id)}
        <Button
          variant="ghost"
          shape="rounded"
          data-section-link
          class="justify-start"
          aria-pressed={$filter.category === category.id && !$filter.query}
          onclick={() => choose(category.id)}>{category.label}</Button
        >
      {/each}
    </nav>
  </aside>
  <main class="min-w-0" id="settings-content">
    <div class="mb-5">
      <h1 class="text-2xl font-semibold tracking-tight">
        {$filter.query ? 'Search results' : selected.label}
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        {$filter.query ? 'Results across every settings section.' : selected.description}
      </p>
      <p class="mt-2 text-xs text-muted-foreground">
        Changes save automatically. Reading goals have separate Save and Cancel actions.
      </p>
      {#if $filter.query}<p role="status" class="mt-3 text-sm">
          {visibleCount
            ? `${visibleCount} matching settings`
            : 'No matching settings. Try a different search.'}
        </p>{/if}
    </div>
    <SettingsOfflineStatus />
    <slot />
  </main>
</div>

<style>
  :global([data-setting="offline-reading"]:not([hidden])) {
    margin-bottom: 1.25rem;
  }
</style>
