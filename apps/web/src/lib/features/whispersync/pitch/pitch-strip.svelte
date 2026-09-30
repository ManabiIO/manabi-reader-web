<script lang="ts">
  import { PITCH_GUIDES, pitchPaths, type PitchState } from './model';

  export let state: PitchState;
  export let available = false;
  export let onToggle: () => void;
  export let onRetry: () => void;
  export let id = 'audiobook-voice-pitch';

  $: paths = pitchPaths(state.points, state.time);
  $: subtitle = !state.enabled
    ? available
      ? 'See how the voice rises and falls'
      : 'Choose an audio file to begin'
    : state.status === 'loading'
      ? 'Preparing visualization'
      : state.status === 'error'
        ? 'Visualization unavailable'
        : state.activity === 'playing'
          ? state.speechActive
            ? 'Live · last 8 seconds'
            : 'Waiting for dialogue'
          : state.activity === 'buffering'
            ? 'Waiting for audio'
            : state.activity === 'ended'
              ? 'Finished · trace held'
              : state.points.length
                ? 'Paused · trace held'
                : 'Ready when you press Play';
</script>

<div class="voice-pitch" class:enabled={state.enabled} data-testid="voice-pitch">
  <div class="heading">
    <svg class="heading-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4" />
    </svg>
    <div class="heading-copy">
      <span class="label">Voice pitch</span>
      <p class="subtitle">{subtitle}</p>
    </div>
    <button
      class="toggle"
      type="button"
      aria-label={state.enabled ? 'Hide voice pitch' : 'Show voice pitch'}
      aria-expanded={state.enabled}
      aria-controls={`${id}-content`}
      disabled={!available && !state.enabled}
      on:click={onToggle}>{state.enabled ? 'Hide' : 'Show'}</button
    >
  </div>
  <div id={`${id}-content`} hidden={!state.enabled}>
    {#if state.enabled}
      <div class="visualization">
        {#if state.status === 'loading'}
          <div class="feedback" role="status">
            <span class="spinner" aria-hidden="true"></span>
            <span>{state.message}</span>
          </div>
        {:else if state.status === 'error'}
          <div class="feedback error">
            <p role="status">{state.message}</p>
            <button type="button" on:click={onRetry}>Retry</button>
          </div>
        {:else}
          <div class="chart" class:empty={!state.points.length}>
            <div class="frequency-scale" aria-hidden="true">
              <span class="unit">Hz</span>
              {#each PITCH_GUIDES as guide (guide.hz)}
                <span class="frequency" style:top={`${(guide.y / 112) * 100}%`}>{guide.hz}</span>
              {/each}
            </div>
            <svg
              class="trace"
              viewBox="0 0 640 112"
              preserveAspectRatio="none"
              role="img"
              aria-label="Audio waveform and yellow estimated voice pitch. Higher lines mean a higher voice. The most recent audio is on the right."
            >
              {#each PITCH_GUIDES as guide (guide.hz)}
                <path class="pitch-grid" d={`M8 ${guide.y}H624`} />
              {/each}
              <path class="baseline" d="M8 52H624" />
              <path class="waveform" d={paths.waveform} />
              <path class="pitch-halo" d={paths.pitch} />
              <path class="pitch" d={paths.pitch} />
              <path class="playhead" d="M624 8V98" />
              {#if paths.marker}
                <path class="tip" d={`M${paths.marker.x} ${paths.marker.y}h0.01`} />
              {/if}
            </svg>
            {#if !state.points.length}
              <p class="empty-label" role="status">
                {!available
                  ? 'Choose an audio file to see pitch'
                  : state.activity === 'playing'
                    ? state.speechActive
                      ? 'Listening for the voice…'
                      : 'Waiting for dialogue…'
                    : state.activity === 'buffering'
                      ? 'Waiting for audio…'
                      : 'Press Play to follow the voice'}
              </p>
            {/if}
          </div>
          <div class="time-scale" aria-hidden="true">
            <span>−8 s</span><span>−4 s</span><span>Now</span>
          </div>
        {/if}
      </div>
      <details>
        <summary>About this view</summary>
        <p>
          Yellow follows the dialogue’s estimated pitch; the shaded waveform shows the mixed audio
          level. Pausing holds the trace. Seeking starts a new one. Gaps can mean silence, unvoiced
          speech, or a pitch outside 85–520 Hz. Analysis pauses between timed subtitle cues so
          background sound is less likely to be mistaken for dialogue. Simultaneous music or
          another speaker can still affect the estimate. This is a listening aid, not a pitch-accent
          score. Audio stays on your device.
        </p>
      </details>
    {/if}
  </div>
</div>

<style>
  .voice-pitch {
    margin-block: 8px 16px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--background);
    color: var(--foreground);
    writing-mode: horizontal-tb;
    text-align: start;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .heading-icon {
    width: 22px;
    height: 22px;
    flex: none;
    opacity: 0.65;
  }
  .heading-icon path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .heading-copy {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-size: 0.875rem;
    font-weight: 600;
  }
  .subtitle {
    margin: 0.1rem 0 0;
    font-size: 0.75rem;
    line-height: 1.45;
    opacity: 0.72;
  }
  button {
    min-height: 44px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.8125rem;
  }
  .toggle {
    min-width: 68px;
    flex: none;
  }
  .toggle[aria-expanded='true'] {
    background: color-mix(in srgb, var(--foreground) 6%, transparent);
  }
  button:hover:not(:disabled),
  summary:hover {
    background: color-mix(in srgb, var(--foreground) 9%, transparent);
  }
  button:focus-visible,
  summary:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .visualization {
    margin-top: 14px;
    min-height: clamp(140px, 8.75rem, 180px);
  }
  .chart {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    height: clamp(120px, 7.5rem, 160px);
  }
  .frequency-scale {
    position: relative;
    font-size: 0.625rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }
  .unit {
    position: absolute;
    top: 0;
  }
  .frequency {
    position: absolute;
    transform: translateY(-50%);
  }
  .trace {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .trace path {
    vector-effect: non-scaling-stroke;
  }
  .pitch-grid,
  .baseline,
  .playhead {
    fill: none;
    stroke: var(--foreground);
    stroke-width: 0.5;
    opacity: 0.14;
  }
  .pitch-grid {
    stroke-dasharray: 2 5;
  }
  .baseline {
    opacity: 0.08;
  }
  .playhead {
    opacity: 0.24;
  }
  .waveform {
    fill: var(--foreground);
    fill-opacity: 0.12;
    stroke: var(--foreground);
    stroke-opacity: 0.15;
    stroke-width: 0.75;
  }
  .pitch-halo,
  .pitch,
  .tip {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pitch-halo {
    stroke: var(--foreground);
    stroke-width: 4;
    opacity: 0.32;
  }
  .pitch,
  .tip {
    stroke: #ffd83d;
    stroke-width: 2;
  }
  .tip {
    stroke-width: 5;
  }
  .time-scale {
    display: flex;
    justify-content: space-between;
    margin: 4px 6px 0 38px;
    font-size: 0.625rem;
    line-height: 1.4;
    opacity: 0.65;
    font-variant-numeric: tabular-nums;
  }
  .empty .trace {
    opacity: 0.5;
  }
  .empty-label {
    position: absolute;
    inset-inline: 40px 8px;
    top: 50%;
    transform: translateY(-50%);
    margin: 0;
    font-size: 0.75rem;
    text-align: center;
    background: var(--background);
    padding: 6px;
  }
  .feedback {
    min-height: clamp(140px, 8.75rem, 180px);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    font-size: 0.8125rem;
    line-height: 1.5;
  }
  .feedback p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .error {
    justify-content: space-between;
  }
  .error button {
    flex: none;
  }
  details {
    margin-top: 8px;
    font-size: 0.75rem;
    line-height: 1.6;
  }
  summary {
    cursor: pointer;
    display: flex;
    min-height: 44px;
    align-items: center;
    padding-block: 8px;
    width: fit-content;
    border-radius: 0.25rem;
    opacity: 0.75;
  }
  details p {
    max-width: 65ch;
    margin: 0.35rem 0 0;
    opacity: 0.8;
  }
  .spinner {
    display: inline-block;
    flex: none;
    width: clamp(16px, 1rem, 24px);
    height: clamp(16px, 1rem, 24px);
    border: 2px solid currentColor;
    border-inline-end-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 420px) {
    .voice-pitch {
      padding-inline: 12px;
    }
    .heading {
      gap: 8px;
    }
    .heading-icon {
      display: none;
    }
    .feedback {
      flex-wrap: wrap;
      align-content: center;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
  @media (forced-colors: active) {
    .pitch,
    .tip,
    .pitch-halo {
      stroke: Highlight;
      opacity: 1;
    }
    .waveform {
      fill: GrayText;
      stroke: GrayText;
    }
    .pitch-grid,
    .baseline,
    .playhead {
      stroke: CanvasText;
      opacity: 0.5;
    }
  }
</style>
