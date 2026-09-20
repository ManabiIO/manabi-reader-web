<script lang="ts">
  import { appearance$, type BackgroundTarget } from './state';
  import type { AppearanceMode } from '$lib/data/theme-option';
  import BackgroundSettings from './background-settings.svelte';
  const modes: { value: AppearanceMode; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];
  const backgrounds: { target: BackgroundTarget; label: string }[] = [
    { target: 'library', label: 'Book browser background' },
    { target: 'reader', label: 'Book reader background' }
  ];
</script>

<section aria-labelledby="appearance-heading">
  <h2 id="appearance-heading">Appearance</h2>
  <div role="group" aria-label="Appearance mode" class="modes">
    {#each modes as mode (mode.value)}
      <button
        type="button"
        aria-pressed={$appearance$ === mode.value}
        on:click={() => appearance$.next(mode.value)}>{mode.label}</button
      >
    {/each}
  </div>
  <p class="description">
    System follows your device’s light or dark appearance. Your theme applies to the whole app.
  </p>
  <details>
    <summary>Background images</summary>
    <p class="description">
      Book browser and reader images can each be different in Light and Dark mode. Images fill the
      screen without stretching and are saved only in this browser, never uploaded or included in
      account settings sync. PNG, JPEG, or WebP, up to 8 MB. Existing single-image backgrounds are
      used for both modes until you change or remove either one.
    </p>
    <div class="backgrounds">
      {#each backgrounds as background (background.target)}<BackgroundSettings
          {...background}
        />{/each}
    </div>
  </details>
</section>

<style>
  section {
    padding: 1.25rem 0;
    writing-mode: horizontal-tb;
  }
  h2 {
    font-weight: 600;
    font-size: 1.15rem;
    margin-bottom: 0.75rem;
  }
  .modes {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  button {
    padding: 0.55rem 1.05rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--ink);
  }
  button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .description {
    color: var(--muted);
    max-width: 65ch;
    font-size: 0.875rem;
    margin: 0.75rem 0 1rem;
  }
  summary {
    font-weight: 600;
    cursor: pointer;
    padding: 0.5rem 0;
  }
  .backgrounds {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: 1rem;
  }
</style>
