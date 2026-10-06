/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '../runtime/environment';
import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
import { customReadingPointEnabled$, viewMode$ } from '$lib/data/store';
import { isMobile$, isOnOldUrl } from '$lib/functions/utils';
import { ReaderController, readerTick, type StoreValue } from './controller';
export interface HeaderProps {
  bookTitle?: string;
  hasChapterData: boolean;
  hasText: boolean;
  autoScrollMultiplier: number;
  hasCustomReadingPoint: boolean;
  showFullscreenButton: boolean;
  fullscreenActive?: boolean;
  fullscreenBusy?: boolean;
  hasBookmarkData: boolean;
}

export function createHeader(
  props: HeaderProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let oldDomain: boolean;
  let $readerImageGalleryPictures$: StoreValue<typeof readerImageGalleryPictures$> =
    __readerController.read(readerImageGalleryPictures$);
  let $customReadingPointEnabled$: StoreValue<typeof customReadingPointEnabled$> =
    __readerController.read(customReadingPointEnabled$);
  let $viewMode$: StoreValue<typeof viewMode$> = __readerController.read(viewMode$);
  let $isMobile$: StoreValue<typeof isMobile$> = __readerController.read(isMobile$);
  let bookTitle = props.bookTitle !== undefined ? props.bookTitle : '';
  let hasChapterData: boolean = props.hasChapterData;
  let hasText: boolean = props.hasText;
  let autoScrollMultiplier: number = props.autoScrollMultiplier;
  let hasCustomReadingPoint: boolean = props.hasCustomReadingPoint;
  let showFullscreenButton: boolean = props.showFullscreenButton;
  let fullscreenActive = props.fullscreenActive !== undefined ? props.fullscreenActive : false;
  let fullscreenBusy = props.fullscreenBusy !== undefined ? props.fullscreenBusy : false;
  let hasBookmarkData: boolean = props.hasBookmarkData;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let toolsOpen = false;
  async function selectTool(action: () => void) {
    // A selection can hide the menu trigger while opening a dialog. Retire the
    // portal first so it cannot cover the new dialog or intercept its controls.
    __readerController.changed((toolsOpen = false));
    await readerTick();
    action();
  }
  __readerController.effect(
    () => [],
    () => {
      __readerController.changed((oldDomain = browser && isOnOldUrl(window)));
    }
  );
  __readerController.observeSource(
    () => readerImageGalleryPictures$,
    (value) => {
      $readerImageGalleryPictures$ = value;
    }
  );
  __readerController.observeSource(
    () => customReadingPointEnabled$,
    (value) => {
      $customReadingPointEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => viewMode$,
    (value) => {
      $viewMode$ = value;
    }
  );
  __readerController.observeSource(
    () => isMobile$,
    (value) => {
      $isMobile$ = value;
    }
  );
  const api = {
    controller: __readerController,
    selectTool,
    get bookTitle() {
      return bookTitle;
    },
    set bookTitle(nextValue: typeof bookTitle) {
      if (Object.is(bookTitle, nextValue)) return;
      bookTitle = nextValue;
      __readerController.invalidate();
    },
    get hasChapterData() {
      return hasChapterData;
    },
    set hasChapterData(nextValue: typeof hasChapterData) {
      if (Object.is(hasChapterData, nextValue)) return;
      hasChapterData = nextValue;
      __readerController.invalidate();
    },
    get hasText() {
      return hasText;
    },
    set hasText(nextValue: typeof hasText) {
      if (Object.is(hasText, nextValue)) return;
      hasText = nextValue;
      __readerController.invalidate();
    },
    get autoScrollMultiplier() {
      return autoScrollMultiplier;
    },
    set autoScrollMultiplier(nextValue: typeof autoScrollMultiplier) {
      if (Object.is(autoScrollMultiplier, nextValue)) return;
      autoScrollMultiplier = nextValue;
      __readerController.invalidate();
    },
    get hasCustomReadingPoint() {
      return hasCustomReadingPoint;
    },
    set hasCustomReadingPoint(nextValue: typeof hasCustomReadingPoint) {
      if (Object.is(hasCustomReadingPoint, nextValue)) return;
      hasCustomReadingPoint = nextValue;
      __readerController.invalidate();
    },
    get showFullscreenButton() {
      return showFullscreenButton;
    },
    set showFullscreenButton(nextValue: typeof showFullscreenButton) {
      if (Object.is(showFullscreenButton, nextValue)) return;
      showFullscreenButton = nextValue;
      __readerController.invalidate();
    },
    get fullscreenActive() {
      return fullscreenActive;
    },
    set fullscreenActive(nextValue: typeof fullscreenActive) {
      if (Object.is(fullscreenActive, nextValue)) return;
      fullscreenActive = nextValue;
      __readerController.invalidate();
    },
    get fullscreenBusy() {
      return fullscreenBusy;
    },
    set fullscreenBusy(nextValue: typeof fullscreenBusy) {
      if (Object.is(fullscreenBusy, nextValue)) return;
      fullscreenBusy = nextValue;
      __readerController.invalidate();
    },
    get hasBookmarkData() {
      return hasBookmarkData;
    },
    set hasBookmarkData(nextValue: typeof hasBookmarkData) {
      if (Object.is(hasBookmarkData, nextValue)) return;
      hasBookmarkData = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get toolsOpen() {
      return toolsOpen;
    },
    set toolsOpen(nextValue: typeof toolsOpen) {
      if (Object.is(toolsOpen, nextValue)) return;
      toolsOpen = nextValue;
      __readerController.invalidate();
    },
    get oldDomain() {
      return oldDomain;
    },
    set oldDomain(nextValue: typeof oldDomain) {
      if (Object.is(oldDomain, nextValue)) return;
      oldDomain = nextValue;
      __readerController.invalidate();
    },
    get $readerImageGalleryPictures$() {
      return $readerImageGalleryPictures$;
    },
    get $customReadingPointEnabled$() {
      return $customReadingPointEnabled$;
    },
    get $viewMode$() {
      return $viewMode$;
    },
    get $isMobile$() {
      return $isMobile$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('bookTitle' in next) api.bookTitle = next.bookTitle as typeof bookTitle;
      if ('hasChapterData' in next)
        api.hasChapterData = next.hasChapterData as typeof hasChapterData;
      if ('hasText' in next) api.hasText = next.hasText as typeof hasText;
      if ('autoScrollMultiplier' in next)
        api.autoScrollMultiplier = next.autoScrollMultiplier as typeof autoScrollMultiplier;
      if ('hasCustomReadingPoint' in next)
        api.hasCustomReadingPoint = next.hasCustomReadingPoint as typeof hasCustomReadingPoint;
      if ('showFullscreenButton' in next)
        api.showFullscreenButton = next.showFullscreenButton as typeof showFullscreenButton;
      if ('fullscreenActive' in next)
        api.fullscreenActive = next.fullscreenActive as typeof fullscreenActive;
      if ('fullscreenBusy' in next)
        api.fullscreenBusy = next.fullscreenBusy as typeof fullscreenBusy;
      if ('hasBookmarkData' in next)
        api.hasBookmarkData = next.hasBookmarkData as typeof hasBookmarkData;
    }
  };
  return api;
}
