<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createLocalCoverUrl } from '$lib/functions/book-security/local-media';
  import type { PageDirection } from './direction';
  export let imagePath: string | Blob = '';
  export let title = '';
  export let author = '';
  export let identity = '';
  export let direction: PageDirection = 'unknown';
  let url = '',
    previous: string | Blob | undefined,
    ratio = 2 / 3;
  function release() {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
  $: if (imagePath !== previous) {
    release();
    previous = imagePath;
    ratio = 2 / 3;
    url = createLocalCoverUrl(imagePath);
  }
  $: palette = [...(identity || title)].reduce(
    (value, character) => (value * 31 + character.codePointAt(0)!) % 360,
    211
  );
  onDestroy(release);
</script>

<div class="cover-stage" data-direction={direction} aria-hidden="true">
  <div
    class="cover-surface"
    class:right-bound={direction === 'rtl'}
    style:aspect-ratio={ratio}
    style:width={`${Math.min(1, ratio / (2 / 3)) * 100}%`}
  >
    {#if url}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        on:load={(event) => {
          const img = event.currentTarget;
          if (img instanceof HTMLImageElement && img.naturalHeight)
            ratio = img.naturalWidth / img.naturalHeight;
        }}
        on:error={() => {
          release();
          url = '';
        }}
      />
    {:else}
      <div class="placeholder-cover" style:--cover-hue={`${palette}deg`}>
        <span class="placeholder-title">{title}</span>
        {#if author}<span class="placeholder-author">{author}</span>{/if}
      </div>
    {/if}
    <span class="binding"></span>
    <span class="cover-edge"></span>
  </div>
</div>

<style>
  .cover-stage {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .cover-surface {
    position: relative;
    flex: none;
    max-width: 100%;
    border-radius: 2px;
    background: var(--muted);
    box-shadow:
      0 14px 18px -10px rgb(0 0 0 / 45%),
      0 2px 4px rgb(0 0 0 / 18%);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 2px;
  }
  .placeholder-cover {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 14% 10%;
    background: linear-gradient(
      155deg,
      oklch(52% 0.08 var(--cover-hue)),
      oklch(30% 0.055 var(--cover-hue))
    );
    color: white;
    border: 1px solid var(--border);
  }
  .placeholder-title {
    font-family: var(--font-serif, Georgia, serif);
    font-size: clamp(0.8rem, 2.8vw, 1.5rem);
    line-height: 1.3;
    text-align: center;
    overflow-wrap: anywhere;
    display: -webkit-box;
    line-clamp: 8;
    -webkit-line-clamp: 8;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .placeholder-author {
    margin-top: 0.75rem;
    overflow: hidden;
    max-width: 100%;
    font-size: clamp(0.55rem, 1.7vw, 0.9rem);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.82;
  }
  .binding {
    position: absolute;
    inset: 0 auto 0 0;
    width: 8%;
    max-width: 18px;
    border-left: 1px solid #0003;
    background: linear-gradient(90deg, #0004 0%, #fff4 20%, #0003 35%, #0000 100%);
    pointer-events: none;
  }
  .cover-stage[data-direction='unknown'] .binding {
    display: none;
  }
  .right-bound .binding {
    left: auto;
    right: 0;
    transform: scaleX(-1);
  }
  .cover-edge {
    position: absolute;
    inset: 0;
    border: 1px solid #0002;
    border-radius: 2px;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .cover-surface {
      transition: box-shadow 150ms ease;
    }
  }
  @media (forced-colors: active) {
    .cover-surface {
      border: 1px solid CanvasText;
    }
    .binding {
      border-color: CanvasText;
    }
  }
</style>
