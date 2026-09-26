<script lang="ts">
  import { onKeyDownReaderImageGallery } from '../../../../routes/b/on-keydown-reader';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import {
    readerImageGalleryPictures$,
    toggleImageGalleryPictureSpoiler$
  } from './book-reader-image-gallery';
  import { revealGalleryPicture } from './reveal-gallery-picture';
  import {
    hideSpoilerImage$,
    readerImageGalleryKeybindMap$,
    skipKeyDownListener$
  } from '$lib/data/store';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';

  const dispatch = createEventDispatcher<{ close: void }>();
  let contentContainer: HTMLElement;
  let imageContainer: HTMLElement;
  let desktop = window.matchMedia('(min-width: 1024px)').matches;
  let selectedImageIndex = desktop ? 0 : -1;
  $: selectedImage = $readerImageGalleryPictures$[selectedImageIndex];
  $: selectedIsHidden = !!selectedImage && $hideSpoilerImage$ && !selectedImage.unspoilered;

  onMount(() => {
    const wasSkipping = $skipKeyDownListener$;
    $skipKeyDownListener$ = true;
    const media = window.matchMedia('(min-width: 1024px)');
    const resize = () => {
      desktop = media.matches;
      if (desktop && selectedImageIndex < 0) selectedImageIndex = 0;
    };
    media.addEventListener('change', resize);
    return () => {
      media.removeEventListener('change', resize);
      $skipKeyDownListener$ = wasSkipping;
    };
  });

  function close() {
    dispatch('close');
  }

  function onKeyDown(event: KeyboardEvent) {
    // The dialog owns Tab/Escape and their focus behavior. Retain the reader's
    // configurable gallery bindings for image navigation and alternative close keys.
    if (event.defaultPrevented || event.key === 'Tab' || event.key === 'Escape') return;
    if (
      onKeyDownReaderImageGallery(
        event,
        readerImageGalleryKeybindMap$.getValue(),
        previousImage,
        nextImage,
        close
      )
    )
      event.preventDefault();
  }

  function onWheel(event: WheelEvent) {
    if (document.activeElement !== imageContainer) return;
    if (event.deltaY < 0) previousImage();
    else if (event.deltaY > 0) nextImage();
    event.preventDefault();
  }

  function reveal(url: string) {
    $readerImageGalleryPictures$ = revealGalleryPicture(
      $readerImageGalleryPictures$,
      url,
      (picture) => toggleImageGalleryPictureSpoiler$.next(picture)
    );
  }

  function select(index: number) {
    selectedImageIndex = index;
    void tick().then(() => {
      if (imageContainer?.isConnected) imageContainer.focus();
    });
  }

  function previousImage() {
    if (selectedImageIndex > 0) move(-1);
  }

  function nextImage() {
    if (selectedImageIndex >= 0 && selectedImageIndex < $readerImageGalleryPictures$.length - 1)
      move(1);
  }

  function move(offset: number) {
    selectedImageIndex += offset;
    const thumbnail = contentContainer?.querySelector<HTMLElement>(
      `button[data-image-index="${selectedImageIndex}"]`
    );
    if (thumbnail) {
      contentContainer.scrollTo(0, thumbnail.offsetTop - contentContainer.clientHeight / 2);
    }
  }

  function backToImages() {
    const index = selectedImageIndex;
    selectedImageIndex = -1;
    void tick().then(() => {
      contentContainer?.querySelector<HTMLElement>(`button[data-image-index="${index}"]`)?.focus();
    });
  }
</script>

<svelte:window on:keydown={onKeyDown} on:wheel|nonpassive={onWheel} />
<Dialog.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) close();
  }}
>
  <Dialog.Content
    showCloseButton={false}
    class="top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none p-0 sm:max-w-none writing-horizontal-tb"
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('[aria-label="Show reading controls"]')?.focus();
    }}
  >
    <header class="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div>
        <Dialog.Title>Image gallery</Dialog.Title>
        <Dialog.Description
          >{$readerImageGalleryPictures$.length} book images. Select an image to view it.</Dialog.Description
        >
      </div>
      <Button variant="outline" onclick={close}>Close Image Gallery</Button>
    </header>
    <div class="gallery-layout" class:has-selection={!!selectedImage}>
      <div class="gallery-list bg-muted/40" bind:this={contentContainer}>
        {#each $readerImageGalleryPictures$ as picture, index (picture.url)}
          {@const hidden = $hideSpoilerImage$ && !picture.unspoilered}
          <button
            type="button"
            class="gallery-thumbnail rounded-xl border bg-card p-2 text-card-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={hidden ? `Show hidden image ${index + 1}` : `View image ${index + 1}`}
            aria-pressed={selectedImageIndex === index}
            data-image-index={index}
            on:click={() => {
              if (hidden) reveal(picture.url);
              else select(index);
            }}
          >
            <div class="thumbnail-art" class:spoiler={hidden}>
              <img src={picture.url} alt={hidden ? '' : `Book illustration ${index + 1}`} />
              {#if hidden}<span class="spoiler-label">Show image · ネタバレ</span>{/if}
            </div>
            <span class="mt-2 block text-xs">Image {index + 1}</span>
          </button>
        {/each}
      </div>
      <div
        class="gallery-viewer bg-background text-foreground"
        tabindex="-1"
        bind:this={imageContainer}
      >
        {#if selectedImage}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            {#if !desktop}<Button variant="outline" onclick={backToImages}>All images</Button>{/if}
            <div class="flex items-center gap-2">
              <Button variant="outline" disabled={selectedImageIndex === 0} onclick={previousImage}>
                <ChevronLeft /> Previous
              </Button>
              <span class="text-sm tabular-nums" aria-live="polite"
                >{selectedImageIndex + 1} / {$readerImageGalleryPictures$.length}</span
              >
              <Button
                variant="outline"
                disabled={selectedImageIndex === $readerImageGalleryPictures$.length - 1}
                onclick={nextImage}
              >
                Next <ChevronRight />
              </Button>
            </div>
          </div>
          <div class="gallery-art" class:spoiler={selectedIsHidden}>
            <img
              src={selectedImage.url}
              alt={selectedIsHidden ? '' : `Book illustration ${selectedImageIndex + 1}`}
            />
            {#if selectedIsHidden}
              <button type="button" class="spoiler-label" on:click={() => reveal(selectedImage.url)}
                >Show image · ネタバレ</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  .gallery-layout {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .gallery-list {
    position: relative;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem;
  }
  .gallery-thumbnail {
    display: block;
    width: 100%;
    margin-bottom: 1rem;
    text-align: center;
  }
  .gallery-thumbnail[aria-pressed='true'] {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary);
  }
  .thumbnail-art {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 4rem;
  }
  .thumbnail-art img {
    max-height: 16rem;
    max-width: 100%;
  }
  .gallery-viewer {
    display: none;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    outline: none;
  }
  .has-selection .gallery-viewer {
    display: grid;
  }
  .has-selection .gallery-list {
    display: none;
  }
  .gallery-art {
    position: relative;
    min-height: 0;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    overflow: auto;
  }
  .gallery-art img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .spoiler {
    overflow: hidden;
  }
  .spoiler img {
    filter: blur(44px);
  }
  .spoiler-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    background: var(--popover);
    color: var(--popover-foreground);
    border: 1px solid var(--border);
    font-size: 0.875rem;
    white-space: nowrap;
  }
  @media (min-width: 1024px) {
    .gallery-layout {
      grid-template-columns: 20rem minmax(0, 1fr);
    }
    .has-selection .gallery-list {
      display: block;
      border-right: 1px solid var(--border);
    }
    .gallery-viewer {
      display: grid;
    }
  }
</style>
