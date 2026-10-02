/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { onKeyDownReaderImageGallery } from '../routes/b/on-keydown-reader';
import {
  readerImageGalleryPictures$,
  toggleImageGalleryPictureSpoiler$
} from '../lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
import { revealGalleryPicture } from '../lib/components/book-reader/book-reader-image-gallery/reveal-gallery-picture';
import {
  galleryShortcutAllowed,
  galleryWheelStep
} from '../lib/components/book-reader/book-reader-image-gallery/gallery-input';
import {
  hideSpoilerImage$,
  readerImageGalleryKeybindMap$,
  skipKeyDownListener$
} from '$lib/data/store';
import { ReaderController, readerTick, writeStore, type StoreValue } from './controller';
export type GalleryProps = Record<string, unknown>;

export function createGallery(
  props: GalleryProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let selectedImage: StoreValue<typeof readerImageGalleryPictures$>[number] | undefined;
  let selectedIsHidden: boolean;
  let $readerImageGalleryPictures$: StoreValue<typeof readerImageGalleryPictures$> =
    __readerController.read(readerImageGalleryPictures$);
  let $hideSpoilerImage$: StoreValue<typeof hideSpoilerImage$> =
    __readerController.read(hideSpoilerImage$);
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let gallery: HTMLElement | null = null;
  let focusGeneration = 0;
  let closed = false;
  let contentContainer: HTMLElement;
  let imageContainer: HTMLElement;
  let desktop = window.matchMedia('(min-width: 1024px)').matches;
  let selectedImageIndex = desktop ? 0 : -1;
  __readerController.effect(
    () => [$readerImageGalleryPictures$, selectedImageIndex],
    () => {
      __readerController.changed(
        (selectedImage = $readerImageGalleryPictures$[selectedImageIndex])
      );
    }
  );
  __readerController.effect(
    // The session's debounced spoiler reducer intentionally retains each
    // picture object, so its primitive visibility can change at the same identity.
    () => [selectedImage, selectedImage?.unspoilered, $hideSpoilerImage$],
    () => {
      __readerController.changed(
        (selectedIsHidden = !!selectedImage && $hideSpoilerImage$ && !selectedImage.unspoilered)
      );
    }
  );
  __readerController.onMount(() => {
    const wasSkipping = $skipKeyDownListener$;
    writeStore(skipKeyDownListener$, true);
    const media = window.matchMedia('(min-width: 1024px)');
    const resize = () => {
      __readerController.changed((desktop = media.matches));
      if (desktop && selectedImageIndex < 0) __readerController.changed((selectedImageIndex = 0));
    };
    media.addEventListener('change', resize);
    return () => {
      __readerController.changed((closed = true));
      __readerController.changed((focusGeneration += 1));
      media.removeEventListener('change', resize);
      writeStore(skipKeyDownListener$, wasSkipping);
    };
  });
  function close() {
    __readerController.changed((closed = true));
    __readerController.changed((focusGeneration += 1));
    dispatch('close');
  }
  function onKeyDown(event: KeyboardEvent) {
    // The dialog owns Tab/Escape and their focus behavior. Retain the reader's
    // configurable gallery bindings for image navigation and alternative close keys.
    if (closed || !galleryShortcutAllowed(event, gallery)) return;
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
    if (closed) return;
    const step = galleryWheelStep(event, imageContainer);
    if (!step) return;
    if (step < 0) previousImage();
    else nextImage();
    event.preventDefault();
  }
  function reveal(url: string) {
    writeStore(
      readerImageGalleryPictures$,
      revealGalleryPicture($readerImageGalleryPictures$, url, (picture) =>
        toggleImageGalleryPictureSpoiler$.next(picture)
      )
    );
  }
  function revealSelected() {
    if (closed || !selectedImage) return;
    const url = selectedImage.url;
    // Move focus before removing the activating reveal button. No deferred
    // callback can steal it from a later gesture, dismissal or another dialog.
    imageContainer?.focus({ preventScroll: true });
    if (!closed) reveal(url);
  }
  function select(index: number) {
    if (closed || index < 0 || index >= $readerImageGalleryPictures$.length) return;
    const generation = __readerController.changed(++focusGeneration);
    __readerController.changed((selectedImageIndex = index));
    void readerTick().then(() => {
      if (!closed && generation === focusGeneration && imageContainer?.isConnected)
        imageContainer.focus();
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
    const nextIndex = selectedImageIndex + offset;
    if (closed || nextIndex < 0 || nextIndex >= $readerImageGalleryPictures$.length) return;
    const generation = __readerController.changed(++focusGeneration);
    // Paging can disable the focused end control or remove a reveal button.
    // Hand ownership to the stable viewer before updating either one.
    imageContainer?.focus({ preventScroll: true });
    if (closed || generation !== focusGeneration) return;
    __readerController.changed((selectedImageIndex = nextIndex));
    const thumbnail = contentContainer?.querySelector<HTMLElement>(
      `button[data-image-index="${selectedImageIndex}"]`
    );
    if (thumbnail) {
      contentContainer.scrollTo(0, thumbnail.offsetTop - contentContainer.clientHeight / 2);
    }
  }
  function backToImages() {
    const generation = __readerController.changed(++focusGeneration);
    const index = selectedImageIndex;
    __readerController.changed((selectedImageIndex = -1));
    void readerTick().then(() => {
      if (closed || generation !== focusGeneration || !contentContainer?.isConnected) return;
      contentContainer.querySelector<HTMLElement>(`button[data-image-index="${index}"]`)?.focus();
    });
  }
  __readerController.observeSource(
    () => readerImageGalleryPictures$,
    (value) => {
      $readerImageGalleryPictures$ = value;
    }
  );
  __readerController.observeSource(
    () => hideSpoilerImage$,
    (value) => {
      $hideSpoilerImage$ = value;
    }
  );
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  const api = {
    controller: __readerController,
    close,
    onKeyDown,
    onWheel,
    reveal,
    revealSelected,
    select,
    previousImage,
    nextImage,
    move,
    backToImages,
    get dispatch() {
      return dispatch;
    },
    get gallery() {
      return gallery;
    },
    set gallery(nextValue: typeof gallery) {
      if (Object.is(gallery, nextValue)) return;
      gallery = nextValue;
      __readerController.invalidate();
    },
    get focusGeneration() {
      return focusGeneration;
    },
    set focusGeneration(nextValue: typeof focusGeneration) {
      if (Object.is(focusGeneration, nextValue)) return;
      focusGeneration = nextValue;
      __readerController.invalidate();
    },
    get closed() {
      return closed;
    },
    set closed(nextValue: typeof closed) {
      if (Object.is(closed, nextValue)) return;
      closed = nextValue;
      __readerController.invalidate();
    },
    get contentContainer() {
      return contentContainer;
    },
    set contentContainer(nextValue: typeof contentContainer) {
      if (Object.is(contentContainer, nextValue)) return;
      contentContainer = nextValue;
      __readerController.invalidate();
    },
    get imageContainer() {
      return imageContainer;
    },
    set imageContainer(nextValue: typeof imageContainer) {
      if (Object.is(imageContainer, nextValue)) return;
      imageContainer = nextValue;
      __readerController.invalidate();
    },
    get desktop() {
      return desktop;
    },
    set desktop(nextValue: typeof desktop) {
      if (Object.is(desktop, nextValue)) return;
      desktop = nextValue;
      __readerController.invalidate();
    },
    get selectedImageIndex() {
      return selectedImageIndex;
    },
    set selectedImageIndex(nextValue: typeof selectedImageIndex) {
      if (Object.is(selectedImageIndex, nextValue)) return;
      selectedImageIndex = nextValue;
      __readerController.invalidate();
    },
    get selectedImage() {
      return selectedImage;
    },
    set selectedImage(nextValue: typeof selectedImage) {
      if (Object.is(selectedImage, nextValue)) return;
      selectedImage = nextValue;
      __readerController.invalidate();
    },
    get selectedIsHidden() {
      return selectedIsHidden;
    },
    set selectedIsHidden(nextValue: typeof selectedIsHidden) {
      if (Object.is(selectedIsHidden, nextValue)) return;
      selectedIsHidden = nextValue;
      __readerController.invalidate();
    },
    get $readerImageGalleryPictures$() {
      return $readerImageGalleryPictures$;
    },
    get $hideSpoilerImage$() {
      return $hideSpoilerImage$;
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    updateProps(_next: Record<string, unknown>) {}
  };
  return api;
}
