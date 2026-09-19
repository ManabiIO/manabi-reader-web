<script lang="ts">
  import { backgrounds, chooseBackground, removeBackground } from './backgrounds';
  import {
    libraryBackgroundOptions$,
    readerBackgroundOptions$,
    resolvedMode$,
    type BackgroundTarget
  } from './state';
  export let target: BackgroundTarget;
  export let label: string;
  $: options = target === 'library' ? libraryBackgroundOptions$ : readerBackgroundOptions$;
  $: state = $backgrounds[target];
  $: opacity = state.url && $options.fade ? $options.amount / 100 : 0;
  async function select(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await chooseBackground(target, file).catch(() => undefined);
  }
</script>

<fieldset class="background-setting" aria-busy={state.busy}>
  <legend>{label}</legend>
  <div
    class="background-preview"
    style:background-image={state.url ? `url("${state.url}")` : undefined}
    style:--background-fade={opacity}
    aria-hidden="true"
  >
    {#if state.url}
      <span class:reader-preview={target === 'reader'}
        >本を読む<br /><small>Read comfortably</small></span
      >
    {:else}<span>No image</span>{/if}
  </div>
  <label class="image-picker" for="background-{target}">Choose image</label>
  <input
    id="background-{target}"
    type="file"
    accept="image/png,image/jpeg,image/webp"
    disabled={state.busy}
    on:change={select}
  />
  {#if state.url || state.error}
    <button
      type="button"
      disabled={state.busy}
      on:click={() => removeBackground(target).catch(() => undefined)}
      aria-label="Remove {label.toLowerCase()}">Remove</button
    >
  {/if}
  {#if state.name}<p class="filename">{state.name}</p>{/if}
  <label class="fade-toggle">
    <input
      type="checkbox"
      checked={$options.fade}
      on:change={(event) => options.next({ ...$options, fade: event.currentTarget.checked })}
    />
    Fade background
  </label>
  <label for="fade-{target}" class="fade-label"
    >Fade toward {$resolvedMode$ === 'dark' ? 'black' : 'white'}
    <output for="fade-{target}">{$options.amount}%</output></label
  >
  <input
    id="fade-{target}"
    type="range"
    min="0"
    max="100"
    step="1"
    value={$options.amount}
    disabled={!$options.fade}
    on:input={(event) => options.next({ ...$options, amount: event.currentTarget.valueAsNumber })}
  />
  {#if state.busy}<p role="status">Preparing image…</p>{/if}
  {#if state.error}<p role="alert" class="error">{state.error}</p>{/if}
</fieldset>

<style>
  fieldset {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    padding: 1rem;
  }
  legend {
    font-weight: 600;
    padding: 0 0.3rem;
  }
  .background-preview {
    height: 7rem;
    position: relative;
    overflow: hidden;
    border-radius: 0.4rem;
    background-color: var(--surface-raised);
    background-size: cover;
    background-position: center;
    margin-bottom: 0.75rem;
  }
  .background-preview span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 1;
    color: var(--ink);
    text-align: center;
    align-content: center;
  }
  .background-preview .reader-preview {
    color: var(--reader-font-color);
  }
  .image-picker {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
  }
  input[type='file'] {
    display: block;
    max-width: 100%;
    margin: 0.3rem 0 0.6rem;
    font-size: 0.875rem;
  }
  button {
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    padding: 0.35rem 0.7rem;
  }
  .filename {
    overflow-wrap: anywhere;
    color: var(--muted);
    font-size: 0.8rem;
    margin-top: 0.4rem;
  }
  .fade-toggle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.75rem 0;
  }
  .fade-label {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.875rem;
  }
  input[type='range'] {
    width: 100%;
  }
  .error {
    color: var(--danger);
    margin-top: 0.5rem;
  }
</style>
