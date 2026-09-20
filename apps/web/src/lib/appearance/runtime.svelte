<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { theme$, customThemes$ } from '$lib/data/store';
  import { availableThemes, themeProperties } from '$lib/data/theme-option';
  import {
    appearance$,
    startAppearanceSync,
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
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute('content', $appearance$ === 'system' ? 'light dark' : $appearance$);
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
  $: backgroundSet = target ? $backgrounds[target] : undefined;
  $: background = backgroundSet ? backgroundSet[$resolvedMode$] : undefined;
  $: options = target === 'reader' ? $readerBackgroundOptions$ : $libraryBackgroundOptions$;
  $: opacity = options.fade ? options.amount / 100 : 0;

  onMount(() => {
    const stopAppearance = startAppearanceSync();
    const stopBackgrounds = startBackgrounds();
    return () => {
      stopAppearance();
      stopBackgrounds();
    };
  });
</script>

{#if background?.url}
  <div
    class="page-background"
    data-background={target}
    data-background-mode={$resolvedMode$}
    style:background-image={`url("${background.url}")`}
    style:--background-fade={opacity}
    aria-hidden="true"
  ></div>
{/if}
