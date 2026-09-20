<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
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
      <section
        class="mode-image rounded-2xl bg-muted/40 p-3"
        aria-labelledby="{target}-{mode.value}-heading"
      >
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

        <Button
          variant="outline"
          class="w-full"
          onclick={() => document.getElementById(`background-${target}-${mode.value}`)?.click()}
          disabled={image.busy}>Choose {mode.label.toLowerCase()} image</Button
        >
        <input
          id="background-{target}-{mode.value}"
          type="file"
          class="sr-only"
          aria-label={`Choose ${mode.label.toLowerCase()} ${label.toLowerCase()}`}
          accept="image/png,image/jpeg,image/webp"
          disabled={image.busy}
          on:change={(event) => select(mode.value, event)}
        />

        {#if image.url || image.error}
          <Button
            variant="ghost"
            disabled={image.busy}
            onclick={() => removeBackground(target, mode.value).catch(() => undefined)}
            aria-label="Remove {mode.label.toLowerCase()} {label.toLowerCase()}">Remove</Button
          >
        {/if}
        {#if image.name}<p class="filename">{image.name}</p>{/if}
        {#if image.busy}<p role="status">Preparing image…</p>{/if}
        {#if image.error}<p role="alert" class="error">{image.error}</p>{/if}
      </section>
    {/each}
  </div>

  {#if hasAnything}
    <Button
      variant="outline"
      class="mt-3"
      disabled={busy}
      onclick={() => removeBackgrounds(target).catch(() => undefined)}
      aria-label="Remove both {label.toLowerCase()} images">Remove both</Button
    >
  {/if}

  <div class="fade-toggle">
    <Switch
      id={`fade-enabled-${target}`}
      checked={$options.fade}
      onCheckedChange={(fade) => options.next({ ...$options, fade })}
      aria-label={`Fade ${label.toLowerCase()}`}
    />
    <label for={`fade-enabled-${target}`}>Fade background</label>
  </div>
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
    border: 1px solid var(--border);
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

  .filename {
    overflow-wrap: anywhere;
    color: var(--muted-foreground);
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
    color: var(--muted-foreground);
    font-size: 0.8rem;
    margin-top: 0.3rem;
  }
  .error {
    color: var(--destructive);
    margin-top: 0.5rem;
  }
</style>
