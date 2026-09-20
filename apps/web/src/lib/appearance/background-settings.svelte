<script lang="ts">
  import {
    backgrounds,
    chooseBackground,
    removeBackground,
    removeBackgrounds
  } from './backgrounds';
  import {
    libraryBackgroundOptions$,
    readerBackgroundOptions$,
    type BackgroundMode,
    type BackgroundTarget
  } from './state';

  export let target: BackgroundTarget;
  export let label: string;

  const modes: { value: BackgroundMode; label: string; fadeColor: string }[] = [
    { value: 'light', label: 'Light', fadeColor: '255 255 255' },
    { value: 'dark', label: 'Dark', fadeColor: '0 0 0' }
  ];

  $: options = target === 'library' ? libraryBackgroundOptions$ : readerBackgroundOptions$;
  $: state = $backgrounds[target];
  $: busy = state.light.busy || state.dark.busy;
  $: hasAnything =
    !!state.light.url || !!state.dark.url || !!state.light.error || !!state.dark.error;
  $: opacity = $options.fade ? $options.amount / 100 : 0;

  async function select(mode: BackgroundMode, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await chooseBackground(target, mode, file).catch(() => undefined);
  }
</script>

<fieldset class="background-setting" aria-busy={busy}>
  <legend>{label}</legend>

  <div class="mode-grid">
    {#each modes as mode (mode.value)}
      {@const image = state[mode.value]}
      <section class="mode-image" aria-labelledby="{target}-{mode.value}-heading">
        <h3 id="{target}-{mode.value}-heading">{mode.label}</h3>
        <div
          class="background-preview"
          class:dark-preview={mode.value === 'dark'}
          style:background-image={image.url ? `url("${image.url}")` : undefined}
          style:--image-fade-color={mode.fadeColor}
          style:--background-fade={opacity}
          aria-hidden="true"
        >
          {#if image.url}
            <span class:reader-preview={target === 'reader'}
              >本を読む<br /><small>Read comfortably</small></span
            >
          {:else}<span>No image</span>{/if}
        </div>

        <label class="image-picker" for="background-{target}-{mode.value}"
          >Choose {mode.label.toLowerCase()} image</label
        >
        <input
          id="background-{target}-{mode.value}"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={image.busy}
          on:change={(event) => select(mode.value, event)}
        />

        {#if image.url || image.error}
          <button
            type="button"
            disabled={image.busy}
            on:click={() => removeBackground(target, mode.value).catch(() => undefined)}
            aria-label="Remove {mode.label.toLowerCase()} {label.toLowerCase()}">Remove</button
          >
        {/if}
        {#if image.name}<p class="filename">{image.name}</p>{/if}
        {#if image.busy}<p role="status">Preparing image…</p>{/if}
        {#if image.error}<p role="alert" class="error">{image.error}</p>{/if}
      </section>
    {/each}
  </div>

  {#if hasAnything}
    <button
      type="button"
      class="remove-both"
      disabled={busy}
      on:click={() => removeBackgrounds(target).catch(() => undefined)}
      aria-label="Remove both {label.toLowerCase()} images">Remove both</button
    >
  {/if}

  <label class="fade-toggle">
    <input
      type="checkbox"
      checked={$options.fade}
      on:change={(event) => options.next({ ...$options, fade: event.currentTarget.checked })}
    />
    Fade background
  </label>
  <label for="fade-{target}" class="fade-label"
    >Fade amount
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
  <p class="fade-note">Light fades toward white; dark fades toward black.</p>
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
  .mode-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: 0.9rem;
  }
  .mode-image {
    min-width: 0;
  }
  h3 {
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 0.35rem;
  }
  .background-preview {
    height: 7rem;
    position: relative;
    overflow: hidden;
    border-radius: 0.4rem;
    background-color: #f7f7f7;
    background-size: cover;
    background-position: center;
    margin-bottom: 0.75rem;
  }
  .background-preview.dark-preview {
    background-color: #111;
  }
  .background-preview span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 1;
    color: #111;
    text-align: center;
    align-content: center;
  }
  .background-preview.dark-preview span {
    color: #f7f7f7;
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
  .remove-both {
    margin-top: 0.85rem;
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
    margin: 0.85rem 0 0.75rem;
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
  .fade-note {
    color: var(--muted);
    font-size: 0.8rem;
    margin-top: 0.3rem;
  }
  .error {
    color: var(--danger);
    margin-top: 0.5rem;
  }
</style>
