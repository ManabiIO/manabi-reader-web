<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import SettingsUserFontAdd from '$lib/components/settings/settings-user-font-add.svelte';
  import { Button } from '$lib/components/ui/button';
  import { userFontsCacheName, type UserFont } from '$lib/data/fonts';
  import { userFonts$ } from '$lib/data/store';
  import type { BehaviorSubject } from 'rxjs';
  import { createEventDispatcher, onMount } from 'svelte';
  import {
    fontActionError,
    removeUserFont,
    sameUserFont,
    storedFontPaths
  } from './user-font-actions';

  export let fontFamily: BehaviorSubject<string>;

  const dispatch = createEventDispatcher<{ close: void }>();
  let isLoading = false;
  let cacheLoaded = false;
  let currentTab = 'Stored';
  let fontCache: Cache | undefined;
  let availablePaths = new Set<string>();
  let error = '';
  let alive = false;
  let loadGeneration = 0;

  onMount(() => {
    alive = true;
    void loadCache();
    return () => {
      alive = false;
      loadGeneration += 1;
    };
  });

  async function loadCache() {
    const generation = ++loadGeneration;
    cacheLoaded = false;
    error = '';
    try {
      const cache = await caches.open(userFontsCacheName);
      const paths = await storedFontPaths(cache);
      if (!alive || generation !== loadGeneration) return;
      fontCache = cache;
      availablePaths = paths;
    } catch (cause) {
      if (!alive || generation !== loadGeneration) return;
      fontCache = undefined;
      error = fontActionError(cause);
    } finally {
      if (alive && generation === loadGeneration) cacheLoaded = true;
    }
  }

  async function selectFont(target: UserFont) {
    if (!alive || isLoading || !fontCache) return;
    const font = { ...target };
    const family = fontFamily;
    isLoading = true;
    error = '';
    try {
      const present = await fontCache.match(font.path);
      if (!alive || family !== fontFamily) return;
      if (!present || !$userFonts$.some((entry) => sameUserFont(entry, font))) {
        error = 'This font file is no longer available. Add it again to use it.';
        availablePaths = new Set([...availablePaths].filter((path) => path !== font.path));
        return;
      }
      family.next(font.name);
      dispatch('close');
    } catch (cause) {
      if (alive) error = fontActionError(cause);
    } finally {
      if (alive) isLoading = false;
    }
  }

  async function removeFont(path: string) {
    const target = $userFonts$.find((entry) => entry.path === path);
    if (!target) return;
    if (!alive || isLoading || !fontCache) return;
    const family = fontFamily;
    isLoading = true;
    error = '';
    try {
      await removeUserFont(
        fontCache,
        { read: () => userFonts$.getValue(), write: (fonts) => userFonts$.next(fonts) },
        target,
        { read: () => family.getValue(), write: (name) => family.next(name) }
      );
      if (alive) await loadCache();
    } catch (cause) {
      if (alive) error = fontActionError(cause);
    } finally {
      if (alive) isLoading = false;
    }
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">Custom fonts</svelte:fragment>
  <div slot="content" class="font-manager min-w-0 space-y-4" aria-busy={isLoading || !cacheLoaded}>
    <p class="text-sm text-muted-foreground">
      Manage fonts stored in this browser. Choose a font to use it for this text style.
    </p>
    <div class="section-navigation" role="group" aria-label="Custom font views">
      {#each ['Stored', 'Add'] as tab (tab)}
        <Button
          variant="ghost"
          shape="rounded"
          data-section-link
          class="min-h-11"
          aria-pressed={currentTab === tab}
          disabled={isLoading || !fontCache}
          onclick={() => (currentTab = tab)}>{tab === 'Add' ? 'Add font' : 'Stored fonts'}</Button
        >
      {/each}
    </div>
    {#if error}<p role="alert" class="break-words text-sm text-destructive">{error}</p>{/if}
    {#if !cacheLoaded}
      <p role="status" class="text-sm text-muted-foreground">Checking font storage…</p>
    {:else if !fontCache}
      <p class="text-sm text-muted-foreground">Your saved font list has not been changed.</p>
      <Button variant="outline" onclick={loadCache}>Retry font storage</Button>
    {:else if currentTab === 'Stored'}
      {#if $userFonts$.length}
        <ul class="divide-y divide-border" aria-label="Stored custom fonts">
          {#each $userFonts$ as userFont (userFont.path)}
            <li class="flex min-w-0 flex-wrap items-center gap-3 py-3">
              <div class="min-w-0 flex-1 basis-40">
                <p class="break-words font-medium">{userFont.name}</p>
                <p class="break-words text-xs text-muted-foreground">{userFont.fileName}</p>
                {#if !availablePaths.has(userFont.path)}
                  <p class="mt-1 text-xs text-muted-foreground">
                    File unavailable. Remove this entry, then add the file again.
                  </p>
                {/if}
              </div>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  class="min-h-11"
                  disabled={isLoading || !availablePaths.has(userFont.path)}
                  aria-label={`Use ${userFont.name}`}
                  onclick={() => selectFont(userFont)}>Use font</Button
                >
                <Button
                  variant="destructive"
                  class="min-h-11"
                  disabled={isLoading}
                  aria-label={`Remove ${userFont.name}`}
                  onclick={() => removeFont(userFont.path)}>Remove</Button
                >
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
          No custom fonts yet. Add a font file to make it available here.
        </p>
      {/if}
      {#if isLoading}<p role="status" class="text-sm text-muted-foreground">Updating fonts…</p>{/if}
    {:else}
      <SettingsUserFontAdd
        {fontCache}
        bind:isLoading
        on:saved={() => {
          currentTab = 'Stored';
          void loadCache();
        }}
      />
    {/if}
  </div>
  <svelte:fragment slot="footer"
    ><Button variant="ghost" class="min-h-11" onclick={() => dispatch('close')}>Done</Button
    ></svelte:fragment
  >
</DialogTemplate>

<style>
  .font-manager {
    overflow-wrap: anywhere;
  }
</style>
