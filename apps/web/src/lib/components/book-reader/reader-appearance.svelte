<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import { Check, TextAa } from 'phosphor-svelte';
  import { appearance$, resolvedMode$, theme$ } from '$lib/appearance/state';
  import { themeNames, themeForMode, type AppearanceMode } from '$lib/data/theme-option';
  import { LocalFont } from '$lib/data/fonts';
  import { effectivePrimaryReaderFont } from '$lib/data/reader-typography';
  import {
    fontSize$,
    fontFamilyGroupOne$,
    lineHeight$,
    viewMode$,
    yuKyokashoAvailable$
  } from '$lib/data/store';
  import { ViewMode } from '$lib/data/view-mode';

  export let open = false;
  const dispatch = createEventDispatcher<{ settingsClick: void }>();
  const modes: AppearanceMode[] = ['system', 'light', 'dark'];
  const themes = [
    'manabi-theme',
    'light-theme',
    'ecru-theme',
    'water-theme',
    'gray-theme',
    'dark-theme'
  ];
  const fonts = [
    LocalFont.KLEEONE,
    LocalFont.NOTOSERIFJP,
    LocalFont.KZUDMINCHO,
    LocalFont.SHIPPORIMINCHO,
    LocalFont.GENEI,
    LocalFont.SERIF
  ];
  $: currentFont = effectivePrimaryReaderFont($fontFamilyGroupOne$, $yuKyokashoAvailable$);
  $: availableFonts = [
    ...new Set([...($yuKyokashoAvailable$ ? [LocalFont.YUKYOKASHO] : []), currentFont, ...fonts])
  ];
  function changeSize(delta: number) {
    fontSize$.next(Math.max(8, Math.min(72, $fontSize$ + delta)));
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content
    side="bottom"
    overlayProps={{ onclick: () => (open = false) }}
    showCloseButton={false}
    class="reader-appearance writing-horizontal-tb mx-auto max-h-[min(90dvh,48rem)] max-w-md gap-5 overflow-y-auto rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:mb-5 sm:mr-5 sm:rounded-3xl"
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      const controls = document.querySelector<HTMLButtonElement>('button[data-reader-controls]');
      const trigger =
        controls?.getAttribute('aria-expanded') === 'true'
          ? document.querySelector<HTMLButtonElement>('[aria-label="Themes & Settings"]')
          : controls;
      trigger?.focus();
    }}
  >
    <Sheet.Header class="flex flex-row items-center justify-between gap-3 p-0">
      <Sheet.Title class="text-lg font-semibold">Themes &amp; Settings</Sheet.Title>
      <CloseButton
        aria-label="Close reading appearance"
        onclick={() => (open = false)}
      />
    </Sheet.Header>
    <Sheet.Description class="sr-only"
      >Adjust text and appearance without leaving your book.</Sheet.Description
    >
    <div class="size-controls" role="group" aria-label="Text size">
      <Button
        variant="ghost"
        class="min-h-12 text-lg"
        aria-label="Decrease text size"
        disabled={$fontSize$ <= 8}
        onclick={() => changeSize(-1)}>A</Button
      >
      <output aria-live="polite" class="text-sm text-muted-foreground">{$fontSize$} px</output>
      <Button
        variant="ghost"
        class="min-h-12 text-2xl"
        aria-label="Increase text size"
        disabled={$fontSize$ >= 72}
        onclick={() => changeSize(1)}>A</Button
      >
    </div>
    <div class="modes" role="group" aria-label="Reading appearance mode">
      {#each modes as mode (mode)}<Button
          variant={$appearance$ === mode ? 'secondary' : 'ghost'}
          shape="rounded"
          class="min-h-11 capitalize"
          aria-pressed={$appearance$ === mode}
          onclick={() => appearance$.next(mode)}>{mode}</Button
        >{/each}
    </div>
    <div class="theme-grid" role="group" aria-label="Reading theme">
      {#each themes as id (id)}
        {@const palette = themeForMode(id, $resolvedMode$ ?? 'light')}
        <button
          type="button"
          class="theme-tile"
          aria-pressed={$theme$ === id}
          aria-label={`${themeNames[id]} theme`}
          style:background={palette.backgroundColor}
          style:color={palette.fontColor}
          onclick={() => theme$.next(id)}
        >
          <TextAa class="size-7" aria-hidden="true" />
          <span>{themeNames[id]}</span>
          {#if $theme$ === id}<Check
              class="absolute right-2 top-2 size-3"
              aria-hidden="true"
            />{/if}
        </button>
      {/each}
    </div>
    <p class="-mt-3 text-xs text-muted-foreground">
      Theme and appearance apply throughout Manabi Reader.
    </p>
    <label class="setting-row"
      ><span>Font</span><select
        aria-label="Reading font"
        value={currentFont}
        onchange={(event) => fontFamilyGroupOne$.next(event.currentTarget.value)}
        >{#each availableFonts as font (font)}<option value={font}>{font}</option>{/each}</select
      ></label
    >
    <label class="setting-row"
      ><span>Line spacing</span><select
        aria-label="Reading line spacing"
        value={$lineHeight$}
        onchange={(event) => lineHeight$.next(Number(event.currentTarget.value))}
      >
        {#each [...new Set( [1.4, 1.65, 1.9, 2.2, $lineHeight$] )].sort((a, b) => a - b) as value (value)}<option
            {value}>{value}×</option
          >{/each}
      </select></label
    >
    <div class="modes" role="group" aria-label="Reading layout">
      <Button
        variant={$viewMode$ === ViewMode.Paginated ? 'secondary' : 'ghost'}
        shape="rounded"
        class="min-h-11"
        aria-pressed={$viewMode$ === ViewMode.Paginated}
        onclick={() => viewMode$.next(ViewMode.Paginated)}>Pages</Button
      >
      <Button
        variant={$viewMode$ === ViewMode.Continuous ? 'secondary' : 'ghost'}
        shape="rounded"
        class="min-h-11"
        aria-pressed={$viewMode$ === ViewMode.Continuous}
        onclick={() => viewMode$.next(ViewMode.Continuous)}>Scroll</Button
      >
    </div>
    <Button
      variant="outline"
      class="min-h-11"
      onclick={() => {
        open = false;
        dispatch('settingsClick');
      }}>All Settings…</Button
    >
  </Sheet.Content>
</Sheet.Root>

<style>
  :global(.reader-appearance > *) {
    flex-shrink: 0;
    min-width: 0;
  }
  .size-controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
    border-radius: 1rem;
    background: var(--muted);
    text-align: center;
  }
  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: 1rem;
    background: var(--muted);
  }
  .modes :global(button) {
    flex: 1 1 auto;
  }
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 6rem), 1fr));
    gap: 0.65rem;
  }
  .theme-tile {
    position: relative;
    min-height: 5.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    font-size: 0.75rem;
  }
  .theme-tile[aria-pressed='true'] {
    outline: 2px solid var(--foreground);
    outline-offset: 2px;
  }
  .theme-tile:focus-visible {
    outline: 3px solid var(--ring);
    outline-offset: 3px;
  }
  .setting-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
  }
  select {
    min-width: 0;
    width: 65%;
    min-height: 44px;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--background);
    color: var(--foreground);
  }
</style>
