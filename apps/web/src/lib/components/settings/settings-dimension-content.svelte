<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import {
    dimensionExtent,
    dimensionLabel,
    dimensionLimits,
    dimensionPercentage,
    dimensionPixels
  } from './dimension-presets';

  export let dimensionValue = 0;
  export let isVertical = true;
  export let isFirstDimension = false;

  let width = 0;
  let height = 0;
  let preview: { context: string; percentage: number } | undefined;

  $: extent = dimensionExtent(isVertical, isFirstDimension, width, height);
  $: limits = dimensionLimits(isFirstDimension);
  $: percentage = dimensionPercentage(dimensionValue, extent, isFirstDimension);
  $: context = `${isVertical}:${isFirstDimension}:${extent}:${dimensionValue}`;
  $: shownPercentage = preview?.context === context ? preview.percentage : percentage;
  $: label = dimensionLabel(isVertical, isFirstDimension);
  $: pixels = dimensionPixels(shownPercentage, extent, isFirstDimension);
  $: currentValue =
    !Number.isFinite(dimensionValue) || dimensionValue < 0
      ? 'Not set'
      : !isFirstDimension && dimensionValue === 0
        ? 'Automatic'
        : `${dimensionValue} px${isFirstDimension ? ' per side' : ''}`;

  function setToValue(value: number) {
    const next = dimensionPixels(value, extent, isFirstDimension);
    preview = undefined;
    if (next !== null) dimensionValue = next;
  }
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} />

<fieldset class="dimension-presets min-w-0 space-y-3 p-3">
  <legend class="max-w-full px-1 text-sm font-semibold">{label}</legend>
  <p class="text-sm text-muted-foreground">
    Current: <strong class="text-foreground">{currentValue}</strong>
  </p>
  <label class="block text-sm">
    <span class="font-medium">Quick size</span>
    <span class="block text-xs text-muted-foreground">
      {shownPercentage}% of the window{isFirstDimension ? ', split between both sides' : ''}
      {#if pixels !== null}
        · {pixels} px{isFirstDimension ? ' per side' : ''}{/if}
    </span>
    <input
      class="mt-2 block min-h-11 w-full accent-primary"
      type="range"
      min={limits.min}
      max={limits.max}
      step={limits.step}
      value={shownPercentage}
      disabled={!extent}
      aria-label={`Quick size for ${label.toLowerCase()}`}
      aria-valuetext={`${shownPercentage}%${pixels === null ? '' : `, ${pixels} pixels${isFirstDimension ? ' per side' : ''}`}`}
      on:input={(event) => (preview = { context, percentage: event.currentTarget.valueAsNumber })}
      on:blur={() => (preview = undefined)}
      on:pointercancel={() => (preview = undefined)}
      on:change={(event) => setToValue(event.currentTarget.valueAsNumber)}
    />
  </label>
  <div class="flex flex-wrap gap-2">
    <Button
      class="min-h-11"
      variant="outline"
      disabled={!extent}
      onclick={() => setToValue(isFirstDimension ? 25 : 75)}
    >
      {isFirstDimension ? 25 : 75}%
    </Button>
    <Button class="min-h-11" variant="outline" disabled={!extent} onclick={() => setToValue(50)}
      >50%</Button
    >
    {#if !isFirstDimension}
      <Button class="min-h-11" variant="ghost" onclick={() => (dimensionValue = 0)}
        >Automatic</Button
      >
    {/if}
  </div>
  <p class="text-xs text-muted-foreground">
    Choose a size to save it in pixels. Opening this panel or resizing the window does not change
    your setting.
  </p>
</fieldset>

<style>
  .dimension-presets {
    width: min(20rem, calc(90vw - 1rem));
    overflow-wrap: anywhere;
  }
  input:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
    border-radius: 6px;
  }
</style>
