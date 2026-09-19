<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { theme$, customThemes$ } from '$lib/data/store';
  import { availableThemes, themeProperties } from '$lib/data/theme-option';
  import {
    appearance$,
    resolvedMode$,
    libraryBackgroundOptions$,
    readerBackgroundOptions$,
    type BackgroundTarget
  } from './state';
  import { backgrounds, startBackgrounds } from './backgrounds';

  $: if (browser) {
    const root = document.documentElement;
    root.dataset.appearance = $appearance$;
    root.dataset.theme = availableThemes.has($theme$) ? $theme$ : 'custom';
    for (const mode of ['light', 'dark'] as const) {
      for (const [key, value] of Object.entries(
        themeProperties($theme$, mode, $customThemes$ ?? {})
      ))
        root.style.setProperty(`--${mode}-${key}`, value);
    }
  }
  $: if (browser) {
    // Browser chrome follows the resolved mode; CSS handles all actual page colors.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        themeProperties($theme$, $resolvedMode$, $customThemes$ ?? {}).canvas
      );
  }
  let target: BackgroundTarget | undefined;
  $: path = $page.url.pathname.slice(base.length).replace(/\/$/, '');
  $: target = path === '/manage' ? 'library' : path === '/b' ? 'reader' : undefined;
  $: background = target ? $backgrounds[target] : undefined;
  $: options = target === 'reader' ? $readerBackgroundOptions$ : $libraryBackgroundOptions$;
  $: opacity = options.fade ? options.amount / 100 : 0;

  onMount(() => {
    if ($theme$ === 'system-theme') theme$.next('manabi-theme');
    const stop = startBackgrounds();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === 'appearance' && ['system', 'light', 'dark'].includes(event.newValue ?? ''))
        appearance$.next(event.newValue as 'system' | 'light' | 'dark');
    };
    window.addEventListener('storage', storageChanged);
    return () => {
      stop();
      window.removeEventListener('storage', storageChanged);
    };
  });
</script>

{#if background?.url}
  <div
    class="page-background"
    data-background={target}
    style:background-image={`url("${background.url}")`}
    style:--background-fade={opacity}
    aria-hidden="true"
  />
{/if}
