<script lang="ts">
  import { pitchPaths, type PitchState } from './model';

  export let state: PitchState;
  export let available = false;
  export let onToggle: () => void;
  export let onRetry: () => void;

  $: paths = pitchPaths(state.points, state.time);
</script>

<div class="voice-pitch" data-testid="voice-pitch">
  <div class="heading">
    <span class="label">Voice pitch</span>
    <button
      type="button"
      aria-label="Show voice pitch"
      aria-pressed={state.enabled}
      aria-expanded={state.enabled}
      disabled={!available && !state.enabled}
      on:click={onToggle}>{state.enabled ? 'Hide' : 'Show'}</button
    >
  </div>
  {#if state.enabled}
    <div class="plot" aria-busy={state.status === 'loading'}>
      {#if state.status === 'loading'}
        <p role="status"><span class="spinner" aria-hidden="true"></span>{state.message}</p>
      {:else if state.status === 'error'}
        <p role="status">{state.message} <button type="button" on:click={onRetry}>Retry</button></p>
      {:else if !state.points.length}
        <p role="status">{available ? 'Play audio to see the live pitch contour.' : 'Choose an audio file to see pitch.'}</p>
      {:else}
        <svg viewBox="0 0 640 72" preserveAspectRatio="none" role="img" aria-label="Live waveform with yellow voice pitch contour, last eight seconds">
          <path class="grid" d="M8 10H632M8 23H632M8 36H632M8 49H632M8 62H632" />
          <path class="waveform" d={paths.waveform} />
          <path class="outline" d={paths.pitch} />
          <path class="pitch" d={paths.pitch} />
        </svg>
      {/if}
    </div>
    <p class="hint">Live audio · last 8 seconds · estimated pitch, not pitch-accent grading</p>
  {/if}
</div>

<style>
  .voice-pitch {
    margin-block: 0.5rem 1rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--background);
    color: var(--foreground);
  }
  .heading { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .label { font-size: 0.875rem; font-weight: 600; }
  button { min-height: 2.25rem; padding: 0.25rem 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem; background: transparent; color: inherit; cursor: pointer; }
  button[aria-pressed='true'] { border-color: currentColor; }
  button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  button:disabled { opacity: 0.5; cursor: default; }
  .plot { min-height: 4.5rem; display: grid; align-items: center; margin-top: 0.5rem; }
  .plot p { font-size: 0.8125rem; margin: 0; overflow-wrap: anywhere; }
  svg { display: block; width: 100%; height: 4.5rem; overflow: hidden; }
  path { fill: none; vector-effect: non-scaling-stroke; }
  .grid { stroke: var(--foreground); stroke-width: 0.5; opacity: 0.12; }
  .waveform { stroke: var(--foreground); stroke-width: 2.2; stroke-linecap: round; opacity: 0.32; }
  .outline { stroke: #463800; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.65; }
  .pitch { stroke: #ffd83d; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .hint { margin: 0.35rem 0 0; font-size: 0.75rem; opacity: 0.75; }
  .spinner { display: inline-block; width: 0.9rem; height: 0.9rem; margin-inline-end: 0.5rem; vertical-align: -0.1rem; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
