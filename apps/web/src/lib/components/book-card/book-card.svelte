<script lang="ts">
  import { faImage } from '@fortawesome/free-regular-svg-icons';
  import { onDestroy } from 'svelte';
  import { createLocalCoverUrl } from '$lib/functions/book-security/local-media';
  import Fa from 'svelte-fa';

  export let imagePath: string | Blob;
  export let title: string;
  export let progress: number;

  let objectUrl = '';

  onDestroy(() => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  });

  function convertImagePath(value: string | Blob) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
    const url = createLocalCoverUrl(value);
    if (url.startsWith('blob:')) objectUrl = url;
    return url;
  }

  let previousImage: string | Blob | undefined;
  let coverUrl = '';
  $: if (imagePath !== previousImage) {
    previousImage = imagePath;
    coverUrl = convertImagePath(imagePath);
    imageLoading = true;
  }

  let imgEl: HTMLImageElement | undefined;
  let imageLoading = true;

  $: imageLoadComplete = imgEl?.complete && !imageLoading;
  $: alt = `${title}_cover`;
</script>

<div tabindex="0" role="button" class="aspect-w-2 aspect-h-3 relative" on:click on:keyup>
  <div class="inline">
    <div class="h-full w-full text-5xl sm:text-7xl">
      {#if !imageLoadComplete}
        <Fa class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" icon={faImage} />
      {/if}

      {#if coverUrl}
        <img
          decoding="async"
          loading="lazy"
          referrerpolicy="no-referrer"
          class="book-cover relative h-full w-full object-cover transition delay-150 duration-700 ease-out"
          class:blur={!imageLoadComplete}
          src={coverUrl}
          {alt}
          bind:this={imgEl}
          on:load={() => (imageLoading = false)}
        />
      {/if}
    </div>

    <div class="absolute inset-x-0 bottom-0">
      <div
        class="sm:h-21 h-16 bg-surface-raised p-0.5 px-1.5 text-justify text-sm text-ink sm:p-1.5 sm:text-base"
      >
        <span class="line-clamp-3">{title}</span>
      </div>
      <div class="h-2.5 bg-line">
        <div
          class="h-full rounded bg-gradient-to-b from-red-600 to-red-900"
          style:width="{progress * 100}%"
        ></div>
      </div>
    </div>
  </div>
</div>
