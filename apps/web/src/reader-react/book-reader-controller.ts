/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { createFoliate } from './foliate-controller';
import type { createPaginated } from './paginated-controller';
import {
  animationFrameScheduler,
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  merge,
  Observable,
  switchMap,
  of,
  ReplaySubject,
  share,
  shareReplay,
  startWith,
  Subject,
  tap
} from 'rxjs';
import { browser } from '../runtime/environment';
import type { EpubResourceData } from '$lib/foliate-epub/publication-data';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import type { FuriganaStyle } from '$lib/data/furigana-style';
import type { TextMarginMode } from '$lib/data/text-margin-mode';
import { ViewMode } from '$lib/data/view-mode';
import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
import { convertRemToPixels } from '$lib/functions/utils';
import { logger } from '$lib/data/logger';
import { imageLoadingState } from '../lib/components/book-reader/image-loading-state';
import { reactiveElements } from '../lib/components/book-reader/reactive-elements';
import type {
  AutoScroller,
  BookmarkManager,
  PageManager
} from '../lib/components/book-reader/types';
import { enableReaderWakeLock$, enableTapEdgeToFlip$ } from '$lib/data/store';
import {
  codePointLength,
  makeLocator,
  projectResource,
  rangeAt,
  resolveLocator,
  selectedOffsets,
  type PublicationManifest,
  type ReaderLocator
} from '$lib/reader-location';
import { ReaderController, writeStore, type StoreValue } from './controller';
export interface BookReaderProps {
  sheetPagination?: boolean;
  controlsVisible?: boolean;
  htmlContent: string;
  styleSheet?: string;
  epubResources: EpubResourceData[] | undefined;
  publicationManifest: PublicationManifest | undefined;
  sourceFormat?: 'epub' | 'htmlz' | 'txt' | 'unknown';
  previewNavigationActive?: boolean;
  width: number;
  height: number;
  verticalMode: boolean;
  fontFeatureSettings: string;
  verticalTextOrientation: string;
  prioritizeReaderStyles: boolean;
  enableTextJustification: boolean;
  enableTextWrapPretty: boolean;
  textIndentation: number;
  textMarginMode: TextMarginMode;
  textMarginValue: number;
  fontColor: string;
  backgroundColor: string;
  hintFuriganaFontColor: string;
  hintFuriganaShadowColor: string;
  fontFamilyGroupOne: string;
  fontFamilyGroupTwo: string;
  fontWeight: number | null;
  fontSize: number;
  lineHeight: number;
  hideSpoilerImage: boolean;
  hideFurigana: boolean;
  furiganaStyle: FuriganaStyle;
  secondDimensionMaxValue: number;
  firstDimensionMargin: number;
  autoPositionOnResize: boolean;
  avoidPageBreak: boolean;
  pageColumns: number;
  autoBookmark: boolean;
  autoBookmarkTime: number;
  viewMode: ViewMode;
  exploredCharCount: number;
  bookCharCount: number;
  multiplier: number;
  bookmarkData: Promise<BooksDbBookmarkData | undefined>;
  autoScroller: AutoScroller | undefined;
  bookmarkManager: BookmarkManager | undefined;
  pageManager: PageManager | undefined;
  isBookmarkScreen: boolean;
  customReadingPoint: number;
  customReadingPointTop: number;
  customReadingPointLeft: number;
  customReadingPointScrollOffset: number;
  customReadingPointRange: Range | undefined;
  showCustomReadingPoint: boolean;
}

export function createBookReader(
  props: BookReaderProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let useFoliatePaginator: boolean;
  let heightModifer: number;
  let $enableReaderWakeLock$: StoreValue<typeof enableReaderWakeLock$> =
    __readerController.read(enableReaderWakeLock$);
  let $enableTapEdgeToFlip$: StoreValue<typeof enableTapEdgeToFlip$> =
    __readerController.read(enableTapEdgeToFlip$);
  let $containerEl$: StoreValue<typeof containerEl$> = undefined as never;
  let $contentViewportWidth$: StoreValue<typeof contentViewportWidth$> = undefined as never;
  let $contentViewportHeight$: StoreValue<typeof contentViewportHeight$> = undefined as never;
  let $imageLoadingState$: StoreValue<typeof imageLoadingState$> = undefined as never;
  let $blurListener$: StoreValue<typeof blurListener$> = undefined as never;
  let $reactiveElements$: StoreValue<typeof reactiveElements$> = undefined as never;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let currentContentEl: HTMLElement | undefined;
  let selectionDocument: Document | undefined;
  let paginatedReader: ReturnType<typeof createPaginated> | undefined;
  let foliatePaginatedReader: ReturnType<typeof createFoliate> | undefined;
  const foliatePreviewEnabled =
    browser && localStorage.getItem('manabi-dev-foliate-epub') === 'true';
  __readerController.effect(
    () => [foliatePreviewEnabled, sourceFormat, publicationManifest],
    () => {
      __readerController.changed(
        (useFoliatePaginator =
          foliatePreviewEnabled && sourceFormat === 'epub' && !!publicationManifest)
      );
    }
  );
  let sheetPagination = props.sheetPagination !== undefined ? props.sheetPagination : false;
  let controlsVisible = props.controlsVisible !== undefined ? props.controlsVisible : false;
  __readerController.effect(
    () => [useFoliatePaginator, viewMode],
    () => {
      __readerController.changed(
        (sheetPagination = useFoliatePaginator && viewMode === ViewMode.Paginated)
      );
    }
  );
  function handleReaderSelectionChange() {
    const selection = selectionDocument?.defaultView?.getSelection();
    const range =
      selection?.rangeCount && selection.toString().trim()
        ? selection.getRangeAt(0).cloneRange()
        : undefined;
    dispatch('selectionChange', range);
  }
  function handleReaderContentChange(content: HTMLElement) {
    if (selectionDocument !== content.ownerDocument) {
      selectionDocument?.removeEventListener('selectionchange', handleReaderSelectionChange);
      __readerController.changed((selectionDocument = content.ownerDocument));
      selectionDocument.addEventListener('selectionchange', handleReaderSelectionChange);
    }
    __readerController.changed((currentContentEl = content));
    contentEl$.next(content);
    dispatch('contentChange', content);
  }
  function activeContentElement(): HTMLElement | undefined {
    return viewMode === ViewMode.Paginated
      ? ((useFoliatePaginator
          ? foliatePaginatedReader?.getContentElement()
          : paginatedReader?.getContentElement()) ?? currentContentEl)
      : currentContentEl;
  }
  function firstVisibleTextOffset(
    node: Text,
    viewport: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
  ): number | undefined {
    const range = node.ownerDocument.createRange();
    const intersectsViewport = (start: number, end: number) => {
      range.setStart(node, start);
      range.setEnd(node, end);
      return Array.from(range.getClientRects()).some(
        (box) =>
          box.width > 0 &&
          box.height > 0 &&
          box.right > viewport.left &&
          box.left < viewport.right &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom
      );
    };
    let start = 0;
    let end = node.length;
    if (!end || !intersectsViewport(start, end)) return undefined;
    // Hit-testing a text point can return an adjacent element in WebKit's CSS
    // columns. Resolve against source ranges instead, so a later visible page
    // cannot silently become an offset-zero return point.
    while (end - start > 1) {
      const middle = start + Math.floor((end - start) / 2);
      if (intersectsViewport(start, middle)) end = middle;
      else start = middle;
    }
    return start > 0 && /[\uDC00-\uDFFF]/.test(node.data[start]) ? start - 1 : start;
  }
  /** Capture a visible passage in canonical source coordinates. */
  async function captureReaderPoint(
    bookKey: string,
    manifest?: PublicationManifest
  ): Promise<ReaderLocator | undefined> {
    if (viewMode === ViewMode.Paginated && useFoliatePaginator)
      return foliatePaginatedReader?.capturePoint(bookKey);
    const contentEl = activeContentElement();
    if (!contentEl) return undefined;
    // Text clipped by the reader's own scrollport can still have a DOM rect
    // inside the window. Capture only ink that the reader is actually showing.
    const scrollport = contentEl.getBoundingClientRect();
    const view = contentEl.ownerDocument.defaultView;
    if (!view) return undefined;
    const viewport = {
      left: Math.max(0, scrollport.left),
      top: Math.max(0, scrollport.top),
      right: Math.min(view.innerWidth, scrollport.right),
      bottom: Math.min(view.innerHeight, scrollport.bottom)
    };
    const paginatedSection = contentEl.matches('[data-manabi-spine-index]')
      ? contentEl
      : contentEl.querySelector<HTMLElement>('[data-manabi-spine-index]');
    const sections =
      viewMode === ViewMode.Paginated
        ? [paginatedSection].filter((value): value is HTMLElement => !!value)
        : (Array.from(contentEl.children) as HTMLElement[]);
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      // CSS columns can paint paginated text well outside the section's own
      // block box. Its rect may be offscreen while a later page is visible.
      if (
        viewMode !== ViewMode.Paginated &&
        (rect.right <= viewport.left ||
          rect.left >= viewport.right ||
          rect.bottom <= viewport.top ||
          rect.top >= viewport.bottom)
      )
        continue;
      const spineIndex =
        viewMode === ViewMode.Paginated
          ? Number(section.dataset.manabiSpineIndex)
          : Array.prototype.indexOf.call(contentEl.children, section);
      const resource = manifest?.resources[spineIndex] ?? {
        href: `legacy-section-${spineIndex}`,
        spineIndex,
        sectionId: section.id || `section-${spineIndex}`
      };
      const projected = projectResource(section, resource);
      for (const run of projected.runs) {
        const offset = firstVisibleTextOffset(run.node, viewport);
        if (offset === undefined) continue;
        const start = run.start + codePointLength(run.node.data.slice(0, offset));
        return makeLocator(bookKey, projected, start);
      }
      if (!projected.runs.length) return makeLocator(bookKey, projected, 0);
    }
    return undefined;
  }
  /** Capture authored markup before opening a sheet can change the DOM selection. */
  function captureSnippetHTML(savedRange?: Range): string {
    const root = activeContentElement();
    const range = savedRange?.cloneRange();
    if (!root || !range || range.collapsed || !root.contains(range.commonAncestorContainer))
      return '';
    const container = root.ownerDocument.createElement('div');
    container.append(range.cloneContents());
    container
      .querySelectorAll('script,style,[data-manabi-overlay]')
      .forEach((item) => item.remove());
    return container.innerHTML;
  }
  async function captureReaderSelection(
    bookKey: string,
    manifest?: PublicationManifest,
    savedRange?: Range
  ): Promise<ReaderLocator[]> {
    const selection =
      viewMode === ViewMode.Paginated
        ? ((useFoliatePaginator
            ? foliatePaginatedReader?.getDocumentSelection()
            : paginatedReader?.getDocumentSelection()) ?? window.getSelection())
        : window.getSelection();
    const range =
      savedRange?.cloneRange() ??
      (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined);
    const contentEl = activeContentElement();
    if (!range || range.collapsed || !contentEl) return [];
    if (!contentEl.contains(range.commonAncestorContainer)) return [];
    const paginatedSection = contentEl.matches('[data-manabi-spine-index]')
      ? contentEl
      : contentEl.querySelector<HTMLElement>('[data-manabi-spine-index]');
    const sections =
      viewMode === ViewMode.Paginated
        ? [paginatedSection].filter((value): value is HTMLElement => !!value)
        : (Array.from(contentEl.children) as HTMLElement[]);
    const targets: ReaderLocator[] = [];
    for (const section of sections) {
      if (!range.intersectsNode(section)) continue;
      const spineIndex =
        viewMode === ViewMode.Paginated
          ? Number(section.dataset.manabiSpineIndex)
          : Array.prototype.indexOf.call(contentEl.children, section);
      const resource = manifest?.resources[spineIndex] ?? {
        href: `legacy-section-${spineIndex}`,
        spineIndex,
        sectionId: section.id || `section-${spineIndex}`
      };
      const projected = projectResource(section, resource);
      const offsets = selectedOffsets(projected, range);
      if (offsets) targets.push(await makeLocator(bookKey, projected, offsets.start, offsets.end));
    }
    return targets;
  }
  async function revealReaderLocator(locator: ReaderLocator, bookKey: string): Promise<boolean> {
    if (viewMode === ViewMode.Paginated)
      return useFoliatePaginator
        ? (foliatePaginatedReader?.revealLocator(locator, bookKey) ?? false)
        : (paginatedReader?.revealLocator(locator, bookKey) ?? false);
    const section = currentContentEl?.children[locator.resource.spineIndex];
    if (!section) return false;
    const projected = projectResource(section, locator.resource);
    const position = await resolveLocator(locator, projected, bookKey);
    if (!position) return false;
    const range = rangeAt(projected, position.start, position.end);
    if (!range) return false;
    const rect = range.getBoundingClientRect();
    const host = currentContentEl?.getBoundingClientRect();
    if (!host || !currentContentEl) return false;
    // The continuous reader owns the scroll container. Its scroll axis can
    // differ from writing mode (notably vertical Japanese in WebKit).
    if (currentContentEl.scrollHeight > currentContentEl.clientHeight + 1) {
      currentContentEl.scrollBy({ top: rect.top - host.top - host.height / 2, behavior: 'auto' });
    } else if (currentContentEl.scrollWidth > currentContentEl.clientWidth + 1) {
      currentContentEl.scrollBy({ left: rect.left - host.left - host.width / 2, behavior: 'auto' });
    } else if (verticalMode) window.scrollBy(rect.right - window.innerWidth / 2, 0);
    else window.scrollBy(0, rect.top - window.innerHeight / 2);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return true;
  }
  let htmlContent: string = props.htmlContent;
  let styleSheet = props.styleSheet !== undefined ? props.styleSheet : '';
  let epubResources: EpubResourceData[] | undefined = props.epubResources;
  let publicationManifest: PublicationManifest | undefined = props.publicationManifest;
  let sourceFormat: 'epub' | 'htmlz' | 'txt' | 'unknown' =
    props.sourceFormat !== undefined ? props.sourceFormat : 'unknown';
  let previewNavigationActive =
    props.previewNavigationActive !== undefined ? props.previewNavigationActive : false;
  let width: number = props.width;
  let height: number = props.height;
  let verticalMode: boolean = props.verticalMode;
  let fontFeatureSettings: string = props.fontFeatureSettings;
  let verticalTextOrientation: string = props.verticalTextOrientation;
  let prioritizeReaderStyles: boolean = props.prioritizeReaderStyles;
  let enableTextJustification: boolean = props.enableTextJustification;
  let enableTextWrapPretty: boolean = props.enableTextWrapPretty;
  let textIndentation: number = props.textIndentation;
  let textMarginMode: TextMarginMode = props.textMarginMode;
  let textMarginValue: number = props.textMarginValue;
  let fontColor: string = props.fontColor;
  let backgroundColor: string = props.backgroundColor;
  let hintFuriganaFontColor: string = props.hintFuriganaFontColor;
  let hintFuriganaShadowColor: string = props.hintFuriganaShadowColor;
  let fontFamilyGroupOne: string = props.fontFamilyGroupOne;
  let fontFamilyGroupTwo: string = props.fontFamilyGroupTwo;
  let fontWeight: number | null = props.fontWeight;
  let fontSize: number = props.fontSize;
  let lineHeight: number = props.lineHeight;
  let hideSpoilerImage: boolean = props.hideSpoilerImage;
  let hideFurigana: boolean = props.hideFurigana;
  let furiganaStyle: FuriganaStyle = props.furiganaStyle;
  let secondDimensionMaxValue: number = props.secondDimensionMaxValue;
  let firstDimensionMargin: number = props.firstDimensionMargin;
  let autoPositionOnResize: boolean = props.autoPositionOnResize;
  let avoidPageBreak: boolean = props.avoidPageBreak;
  let pageColumns: number = props.pageColumns;
  let autoBookmark: boolean = props.autoBookmark;
  let autoBookmarkTime: number = props.autoBookmarkTime;
  let viewMode: ViewMode = props.viewMode;
  let exploredCharCount: number = props.exploredCharCount;
  let bookCharCount: number = props.bookCharCount;
  let multiplier: number = props.multiplier;
  let bookmarkData: Promise<BooksDbBookmarkData | undefined> = props.bookmarkData;
  let autoScroller: AutoScroller | undefined = props.autoScroller;
  let bookmarkManager: BookmarkManager | undefined = props.bookmarkManager;
  let pageManager: PageManager | undefined = props.pageManager;
  let isBookmarkScreen: boolean = props.isBookmarkScreen;
  let customReadingPoint: number = props.customReadingPoint;
  let customReadingPointTop: number = props.customReadingPointTop;
  let customReadingPointLeft: number = props.customReadingPointLeft;
  let customReadingPointScrollOffset: number = props.customReadingPointScrollOffset;
  let customReadingPointRange: Range | undefined = props.customReadingPointRange;
  let showCustomReadingPoint: boolean = props.showCustomReadingPoint;
  let showBlurMessage = false;
  let wakeLock: WakeLockSentinel | undefined;
  let visibilityState: DocumentVisibilityState;
  const mutationObserver: MutationObserver = new MutationObserver(handleMutation);
  const width$ = new Subject<number>();
  const height$ = new Subject<number>();
  const containerEl$ = new BehaviorSubject<HTMLElement | null>(null);
  __readerController.effect(
    () => [firstDimensionMargin, viewMode, verticalMode],
    () => {
      __readerController.changed(
        (heightModifer =
          firstDimensionMargin && ViewMode.Paginated === viewMode && !verticalMode
            ? firstDimensionMargin * 2
            : 0)
      );
    }
  );
  __readerController.effect(
    () => [$enableReaderWakeLock$, visibilityState],
    () => {
      if ($enableReaderWakeLock$ && visibilityState === 'visible') {
        setTimeout(requestWakeLock, 500);
      }
    }
  );
  __readerController.onDestroy(() => {
    selectionDocument?.removeEventListener('selectionchange', handleReaderSelectionChange);
    __readerController.changed((selectionDocument = undefined));
    mutationObserver.disconnect();
    releaseWakeLock();
  });
  const computedStyle$ = containerEl$.pipe(
    switchMap((el) => {
      if (!el) return EMPTY;
      // Text zoom changes rem padding without a window resize. Observe the
      // border box: the content box can stay unchanged while padding grows.
      // switchMap and refCount retire the observer with its mounted frame.
      const frameResize$ = new Observable<void>((subscriber) => {
        const observer = new ResizeObserver(() => subscriber.next());
        observer.observe(el, { box: 'border-box' });
        return () => observer.disconnect();
      });
      return merge(combineLatest([width$, height$]), frameResize$).pipe(
        startWith(0),
        map(() => el)
      );
    }),
    debounceTime(0, animationFrameScheduler),
    map((el) => getComputedStyle(el)),
    shareReplay({ refCount: true, bufferSize: 1 })
  );
  const contentEl$ = new ReplaySubject<HTMLElement>(1);
  const contentViewportWidth$ = computedStyle$.pipe(
    map((style) =>
      getAdjustedWidth(
        width -
          parsePx(style.paddingLeft) -
          parsePx(style.paddingRight) -
          ($enableTapEdgeToFlip$ && ViewMode.Paginated === viewMode && !verticalMode
            ? convertRemToPixels(window, 1.75)
            : 0)
      )
    ),
    distinctUntilChanged()
  );
  const contentViewportHeight$ = computedStyle$.pipe(
    map((style) =>
      getAdjustedHeight(
        height - parsePx(style.paddingTop) - parsePx(style.paddingBottom) - heightModifer
      )
    ),
    distinctUntilChanged()
  );
  // Content and font reflows replace the listener lifetime; accumulating
  // subscriptions here makes one ruby click toggle twice after a late font.
  const reactiveElements$ = iffBrowser(() => of(document)).pipe(
    switchMap((document) => {
      const reactiveElementsFn = reactiveElements(
        document,
        furiganaStyle,
        hideSpoilerImage,
        (navigator as Navigator & { standalone?: boolean }).standalone ||
          window.matchMedia('(display-mode: fullscreen)').matches
      );
      return contentEl$.pipe(switchMap((contentEl) => reactiveElementsFn(contentEl)));
    }),
    reduceToEmptyString()
  );
  const imageLoadingState$ = contentEl$.pipe(
    switchMap((contentEl) => imageLoadingState(contentEl)),
    share()
  );
  const blurListener$ = contentEl$.pipe(
    tap((contentEl) => {
      mutationObserver.disconnect();
      mutationObserver.observe(contentEl, { attributes: true });
    }),
    reduceToEmptyString()
  );
  __readerController.effect(
    () => [width$, width],
    () => {
      width$.next(width);
    }
  );
  __readerController.effect(
    () => [height$, height],
    () => {
      height$.next(height);
    }
  );
  function getAdjustedWidth(widthValue: number) {
    if (ViewMode.Paginated === viewMode && !verticalMode && secondDimensionMaxValue) {
      return Math.min(secondDimensionMaxValue, widthValue);
    }
    return widthValue;
  }
  function getAdjustedHeight(heightValue: number) {
    if (ViewMode.Paginated === viewMode && verticalMode && secondDimensionMaxValue) {
      return Math.min(secondDimensionMaxValue, heightValue);
    }
    return heightValue;
  }
  function parsePx(px: string) {
    return Number(px.replace(/px$/, ''));
  }
  function handleMutation([mutation]: MutationRecord[]) {
    if (mutation.target.nodeType !== 1) {
      __readerController.changed((showBlurMessage = false));
      return;
    }
    __readerController.changed(
      (showBlurMessage = (mutation.target as HTMLElement).style.filter.includes('blur'))
    );
  }
  async function requestWakeLock() {
    if (__readerController.disposed || !navigator.wakeLock || (wakeLock && !wakeLock.released)) {
      return;
    }
    __readerController.changed(
      (wakeLock = await navigator.wakeLock.request().catch(({ message }) => {
        logger.error(`failed to request wakelock: ${message}`);
        return undefined;
      }))
    );
    if (__readerController.disposed) {
      await releaseWakeLock();
      return;
    }
    if (wakeLock) {
      wakeLock.addEventListener('release', releaseWakeLock, false);
    }
  }
  async function releaseWakeLock() {
    if (wakeLock && !wakeLock.released) {
      await wakeLock.release().catch(() => {
        // no-op
      });
    }
    __readerController.changed((wakeLock = undefined));
  }
  __readerController.observeSource(
    () => enableReaderWakeLock$,
    (value) => {
      $enableReaderWakeLock$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTapEdgeToFlip$,
    (value) => {
      $enableTapEdgeToFlip$ = value;
    }
  );
  __readerController.observeSource(
    () => containerEl$,
    (value) => {
      $containerEl$ = value;
    }
  );
  __readerController.observeSource(
    () => contentViewportWidth$,
    (value) => {
      $contentViewportWidth$ = value;
    }
  );
  __readerController.observeSource(
    () => contentViewportHeight$,
    (value) => {
      $contentViewportHeight$ = value;
    }
  );
  __readerController.observeSource(
    () => imageLoadingState$,
    (value) => {
      $imageLoadingState$ = value;
    }
  );
  __readerController.observeSource(
    () => blurListener$,
    (value) => {
      $blurListener$ = value;
    }
  );
  __readerController.observeSource(
    () => reactiveElements$,
    (value) => {
      $reactiveElements$ = value;
    }
  );
  const api = {
    controller: __readerController,
    handleReaderSelectionChange,
    handleReaderContentChange,
    activeContentElement,
    firstVisibleTextOffset,
    captureReaderPoint,
    captureSnippetHTML,
    captureReaderSelection,
    revealReaderLocator,
    getAdjustedWidth,
    getAdjustedHeight,
    parsePx,
    handleMutation,
    requestWakeLock,
    releaseWakeLock,
    get dispatch() {
      return dispatch;
    },
    get currentContentEl() {
      return currentContentEl;
    },
    set currentContentEl(nextValue: typeof currentContentEl) {
      if (Object.is(currentContentEl, nextValue)) return;
      currentContentEl = nextValue;
      __readerController.invalidate();
    },
    get selectionDocument() {
      return selectionDocument;
    },
    set selectionDocument(nextValue: typeof selectionDocument) {
      if (Object.is(selectionDocument, nextValue)) return;
      selectionDocument = nextValue;
      __readerController.invalidate();
    },
    get paginatedReader() {
      return paginatedReader;
    },
    set paginatedReader(nextValue: typeof paginatedReader) {
      if (Object.is(paginatedReader, nextValue)) return;
      paginatedReader = nextValue;
      __readerController.invalidate();
    },
    get foliatePaginatedReader() {
      return foliatePaginatedReader;
    },
    set foliatePaginatedReader(nextValue: typeof foliatePaginatedReader) {
      if (Object.is(foliatePaginatedReader, nextValue)) return;
      foliatePaginatedReader = nextValue;
      __readerController.invalidate();
    },
    get foliatePreviewEnabled() {
      return foliatePreviewEnabled;
    },
    get sheetPagination() {
      return sheetPagination;
    },
    set sheetPagination(nextValue: typeof sheetPagination) {
      if (Object.is(sheetPagination, nextValue)) return;
      sheetPagination = nextValue;
      __readerController.invalidate();
    },
    get controlsVisible() {
      return controlsVisible;
    },
    set controlsVisible(nextValue: typeof controlsVisible) {
      if (Object.is(controlsVisible, nextValue)) return;
      controlsVisible = nextValue;
      __readerController.invalidate();
    },
    get htmlContent() {
      return htmlContent;
    },
    set htmlContent(nextValue: typeof htmlContent) {
      if (Object.is(htmlContent, nextValue)) return;
      htmlContent = nextValue;
      __readerController.invalidate();
    },
    get styleSheet() {
      return styleSheet;
    },
    set styleSheet(nextValue: typeof styleSheet) {
      if (Object.is(styleSheet, nextValue)) return;
      styleSheet = nextValue;
      __readerController.invalidate();
    },
    get epubResources() {
      return epubResources;
    },
    set epubResources(nextValue: typeof epubResources) {
      if (Object.is(epubResources, nextValue)) return;
      epubResources = nextValue;
      __readerController.invalidate();
    },
    get publicationManifest() {
      return publicationManifest;
    },
    set publicationManifest(nextValue: typeof publicationManifest) {
      if (Object.is(publicationManifest, nextValue)) return;
      publicationManifest = nextValue;
      __readerController.invalidate();
    },
    get sourceFormat() {
      return sourceFormat;
    },
    set sourceFormat(nextValue: typeof sourceFormat) {
      if (Object.is(sourceFormat, nextValue)) return;
      sourceFormat = nextValue;
      __readerController.invalidate();
    },
    get previewNavigationActive() {
      return previewNavigationActive;
    },
    set previewNavigationActive(nextValue: typeof previewNavigationActive) {
      if (Object.is(previewNavigationActive, nextValue)) return;
      previewNavigationActive = nextValue;
      __readerController.invalidate();
    },
    get width() {
      return width;
    },
    set width(nextValue: typeof width) {
      if (Object.is(width, nextValue)) return;
      width = nextValue;
      __readerController.invalidate();
    },
    get height() {
      return height;
    },
    set height(nextValue: typeof height) {
      if (Object.is(height, nextValue)) return;
      height = nextValue;
      __readerController.invalidate();
    },
    get verticalMode() {
      return verticalMode;
    },
    set verticalMode(nextValue: typeof verticalMode) {
      if (Object.is(verticalMode, nextValue)) return;
      verticalMode = nextValue;
      __readerController.invalidate();
    },
    get fontFeatureSettings() {
      return fontFeatureSettings;
    },
    set fontFeatureSettings(nextValue: typeof fontFeatureSettings) {
      if (Object.is(fontFeatureSettings, nextValue)) return;
      fontFeatureSettings = nextValue;
      __readerController.invalidate();
    },
    get verticalTextOrientation() {
      return verticalTextOrientation;
    },
    set verticalTextOrientation(nextValue: typeof verticalTextOrientation) {
      if (Object.is(verticalTextOrientation, nextValue)) return;
      verticalTextOrientation = nextValue;
      __readerController.invalidate();
    },
    get prioritizeReaderStyles() {
      return prioritizeReaderStyles;
    },
    set prioritizeReaderStyles(nextValue: typeof prioritizeReaderStyles) {
      if (Object.is(prioritizeReaderStyles, nextValue)) return;
      prioritizeReaderStyles = nextValue;
      __readerController.invalidate();
    },
    get enableTextJustification() {
      return enableTextJustification;
    },
    set enableTextJustification(nextValue: typeof enableTextJustification) {
      if (Object.is(enableTextJustification, nextValue)) return;
      enableTextJustification = nextValue;
      __readerController.invalidate();
    },
    get enableTextWrapPretty() {
      return enableTextWrapPretty;
    },
    set enableTextWrapPretty(nextValue: typeof enableTextWrapPretty) {
      if (Object.is(enableTextWrapPretty, nextValue)) return;
      enableTextWrapPretty = nextValue;
      __readerController.invalidate();
    },
    get textIndentation() {
      return textIndentation;
    },
    set textIndentation(nextValue: typeof textIndentation) {
      if (Object.is(textIndentation, nextValue)) return;
      textIndentation = nextValue;
      __readerController.invalidate();
    },
    get textMarginMode() {
      return textMarginMode;
    },
    set textMarginMode(nextValue: typeof textMarginMode) {
      if (Object.is(textMarginMode, nextValue)) return;
      textMarginMode = nextValue;
      __readerController.invalidate();
    },
    get textMarginValue() {
      return textMarginValue;
    },
    set textMarginValue(nextValue: typeof textMarginValue) {
      if (Object.is(textMarginValue, nextValue)) return;
      textMarginValue = nextValue;
      __readerController.invalidate();
    },
    get fontColor() {
      return fontColor;
    },
    set fontColor(nextValue: typeof fontColor) {
      if (Object.is(fontColor, nextValue)) return;
      fontColor = nextValue;
      __readerController.invalidate();
    },
    get backgroundColor() {
      return backgroundColor;
    },
    set backgroundColor(nextValue: typeof backgroundColor) {
      if (Object.is(backgroundColor, nextValue)) return;
      backgroundColor = nextValue;
      __readerController.invalidate();
    },
    get hintFuriganaFontColor() {
      return hintFuriganaFontColor;
    },
    set hintFuriganaFontColor(nextValue: typeof hintFuriganaFontColor) {
      if (Object.is(hintFuriganaFontColor, nextValue)) return;
      hintFuriganaFontColor = nextValue;
      __readerController.invalidate();
    },
    get hintFuriganaShadowColor() {
      return hintFuriganaShadowColor;
    },
    set hintFuriganaShadowColor(nextValue: typeof hintFuriganaShadowColor) {
      if (Object.is(hintFuriganaShadowColor, nextValue)) return;
      hintFuriganaShadowColor = nextValue;
      __readerController.invalidate();
    },
    get fontFamilyGroupOne() {
      return fontFamilyGroupOne;
    },
    set fontFamilyGroupOne(nextValue: typeof fontFamilyGroupOne) {
      if (Object.is(fontFamilyGroupOne, nextValue)) return;
      fontFamilyGroupOne = nextValue;
      __readerController.invalidate();
    },
    get fontFamilyGroupTwo() {
      return fontFamilyGroupTwo;
    },
    set fontFamilyGroupTwo(nextValue: typeof fontFamilyGroupTwo) {
      if (Object.is(fontFamilyGroupTwo, nextValue)) return;
      fontFamilyGroupTwo = nextValue;
      __readerController.invalidate();
    },
    get fontWeight() {
      return fontWeight;
    },
    set fontWeight(nextValue: typeof fontWeight) {
      if (Object.is(fontWeight, nextValue)) return;
      fontWeight = nextValue;
      __readerController.invalidate();
    },
    get fontSize() {
      return fontSize;
    },
    set fontSize(nextValue: typeof fontSize) {
      if (Object.is(fontSize, nextValue)) return;
      fontSize = nextValue;
      __readerController.invalidate();
    },
    get lineHeight() {
      return lineHeight;
    },
    set lineHeight(nextValue: typeof lineHeight) {
      if (Object.is(lineHeight, nextValue)) return;
      lineHeight = nextValue;
      __readerController.invalidate();
    },
    get hideSpoilerImage() {
      return hideSpoilerImage;
    },
    set hideSpoilerImage(nextValue: typeof hideSpoilerImage) {
      if (Object.is(hideSpoilerImage, nextValue)) return;
      hideSpoilerImage = nextValue;
      __readerController.invalidate();
    },
    get hideFurigana() {
      return hideFurigana;
    },
    set hideFurigana(nextValue: typeof hideFurigana) {
      if (Object.is(hideFurigana, nextValue)) return;
      hideFurigana = nextValue;
      __readerController.invalidate();
    },
    get furiganaStyle() {
      return furiganaStyle;
    },
    set furiganaStyle(nextValue: typeof furiganaStyle) {
      if (Object.is(furiganaStyle, nextValue)) return;
      furiganaStyle = nextValue;
      __readerController.invalidate();
    },
    get secondDimensionMaxValue() {
      return secondDimensionMaxValue;
    },
    set secondDimensionMaxValue(nextValue: typeof secondDimensionMaxValue) {
      if (Object.is(secondDimensionMaxValue, nextValue)) return;
      secondDimensionMaxValue = nextValue;
      __readerController.invalidate();
    },
    get firstDimensionMargin() {
      return firstDimensionMargin;
    },
    set firstDimensionMargin(nextValue: typeof firstDimensionMargin) {
      if (Object.is(firstDimensionMargin, nextValue)) return;
      firstDimensionMargin = nextValue;
      __readerController.invalidate();
    },
    get autoPositionOnResize() {
      return autoPositionOnResize;
    },
    set autoPositionOnResize(nextValue: typeof autoPositionOnResize) {
      if (Object.is(autoPositionOnResize, nextValue)) return;
      autoPositionOnResize = nextValue;
      __readerController.invalidate();
    },
    get avoidPageBreak() {
      return avoidPageBreak;
    },
    set avoidPageBreak(nextValue: typeof avoidPageBreak) {
      if (Object.is(avoidPageBreak, nextValue)) return;
      avoidPageBreak = nextValue;
      __readerController.invalidate();
    },
    get pageColumns() {
      return pageColumns;
    },
    set pageColumns(nextValue: typeof pageColumns) {
      if (Object.is(pageColumns, nextValue)) return;
      pageColumns = nextValue;
      __readerController.invalidate();
    },
    get autoBookmark() {
      return autoBookmark;
    },
    set autoBookmark(nextValue: typeof autoBookmark) {
      if (Object.is(autoBookmark, nextValue)) return;
      autoBookmark = nextValue;
      __readerController.invalidate();
    },
    get autoBookmarkTime() {
      return autoBookmarkTime;
    },
    set autoBookmarkTime(nextValue: typeof autoBookmarkTime) {
      if (Object.is(autoBookmarkTime, nextValue)) return;
      autoBookmarkTime = nextValue;
      __readerController.invalidate();
    },
    get viewMode() {
      return viewMode;
    },
    set viewMode(nextValue: typeof viewMode) {
      if (Object.is(viewMode, nextValue)) return;
      viewMode = nextValue;
      __readerController.invalidate();
    },
    get exploredCharCount() {
      return exploredCharCount;
    },
    set exploredCharCount(nextValue: typeof exploredCharCount) {
      if (Object.is(exploredCharCount, nextValue)) return;
      exploredCharCount = nextValue;
      __readerController.invalidate();
    },
    get bookCharCount() {
      return bookCharCount;
    },
    set bookCharCount(nextValue: typeof bookCharCount) {
      if (Object.is(bookCharCount, nextValue)) return;
      bookCharCount = nextValue;
      __readerController.invalidate();
    },
    get multiplier() {
      return multiplier;
    },
    set multiplier(nextValue: typeof multiplier) {
      if (Object.is(multiplier, nextValue)) return;
      multiplier = nextValue;
      __readerController.invalidate();
    },
    get bookmarkData() {
      return bookmarkData;
    },
    set bookmarkData(nextValue: typeof bookmarkData) {
      if (Object.is(bookmarkData, nextValue)) return;
      bookmarkData = nextValue;
      __readerController.invalidate();
    },
    get autoScroller() {
      return autoScroller;
    },
    set autoScroller(nextValue: typeof autoScroller) {
      if (Object.is(autoScroller, nextValue)) return;
      autoScroller = nextValue;
      __readerController.invalidate();
    },
    get bookmarkManager() {
      return bookmarkManager;
    },
    set bookmarkManager(nextValue: typeof bookmarkManager) {
      if (Object.is(bookmarkManager, nextValue)) return;
      bookmarkManager = nextValue;
      __readerController.invalidate();
    },
    get pageManager() {
      return pageManager;
    },
    set pageManager(nextValue: typeof pageManager) {
      if (Object.is(pageManager, nextValue)) return;
      pageManager = nextValue;
      __readerController.invalidate();
    },
    get isBookmarkScreen() {
      return isBookmarkScreen;
    },
    set isBookmarkScreen(nextValue: typeof isBookmarkScreen) {
      if (Object.is(isBookmarkScreen, nextValue)) return;
      isBookmarkScreen = nextValue;
      __readerController.invalidate();
    },
    get customReadingPoint() {
      return customReadingPoint;
    },
    set customReadingPoint(nextValue: typeof customReadingPoint) {
      if (Object.is(customReadingPoint, nextValue)) return;
      customReadingPoint = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointTop() {
      return customReadingPointTop;
    },
    set customReadingPointTop(nextValue: typeof customReadingPointTop) {
      if (Object.is(customReadingPointTop, nextValue)) return;
      customReadingPointTop = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointLeft() {
      return customReadingPointLeft;
    },
    set customReadingPointLeft(nextValue: typeof customReadingPointLeft) {
      if (Object.is(customReadingPointLeft, nextValue)) return;
      customReadingPointLeft = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointScrollOffset() {
      return customReadingPointScrollOffset;
    },
    set customReadingPointScrollOffset(nextValue: typeof customReadingPointScrollOffset) {
      if (Object.is(customReadingPointScrollOffset, nextValue)) return;
      customReadingPointScrollOffset = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointRange() {
      return customReadingPointRange;
    },
    set customReadingPointRange(nextValue: typeof customReadingPointRange) {
      if (Object.is(customReadingPointRange, nextValue)) return;
      customReadingPointRange = nextValue;
      __readerController.invalidate();
    },
    get showCustomReadingPoint() {
      return showCustomReadingPoint;
    },
    set showCustomReadingPoint(nextValue: typeof showCustomReadingPoint) {
      if (Object.is(showCustomReadingPoint, nextValue)) return;
      showCustomReadingPoint = nextValue;
      __readerController.invalidate();
    },
    get showBlurMessage() {
      return showBlurMessage;
    },
    set showBlurMessage(nextValue: typeof showBlurMessage) {
      if (Object.is(showBlurMessage, nextValue)) return;
      showBlurMessage = nextValue;
      __readerController.invalidate();
    },
    get wakeLock() {
      return wakeLock;
    },
    set wakeLock(nextValue: typeof wakeLock) {
      if (Object.is(wakeLock, nextValue)) return;
      wakeLock = nextValue;
      __readerController.invalidate();
    },
    get visibilityState() {
      return visibilityState;
    },
    set visibilityState(nextValue: typeof visibilityState) {
      if (Object.is(visibilityState, nextValue)) return;
      visibilityState = nextValue;
      __readerController.invalidate();
    },
    get mutationObserver() {
      return mutationObserver;
    },
    get width$() {
      return width$;
    },
    get height$() {
      return height$;
    },
    get containerEl$() {
      return containerEl$;
    },
    get computedStyle$() {
      return computedStyle$;
    },
    get contentEl$() {
      return contentEl$;
    },
    get contentViewportWidth$() {
      return contentViewportWidth$;
    },
    get contentViewportHeight$() {
      return contentViewportHeight$;
    },
    get reactiveElements$() {
      return reactiveElements$;
    },
    get imageLoadingState$() {
      return imageLoadingState$;
    },
    get blurListener$() {
      return blurListener$;
    },
    get useFoliatePaginator() {
      return useFoliatePaginator;
    },
    set useFoliatePaginator(nextValue: typeof useFoliatePaginator) {
      if (Object.is(useFoliatePaginator, nextValue)) return;
      useFoliatePaginator = nextValue;
      __readerController.invalidate();
    },
    get heightModifer() {
      return heightModifer;
    },
    set heightModifer(nextValue: typeof heightModifer) {
      if (Object.is(heightModifer, nextValue)) return;
      heightModifer = nextValue;
      __readerController.invalidate();
    },
    get $enableReaderWakeLock$() {
      return $enableReaderWakeLock$;
    },
    get $enableTapEdgeToFlip$() {
      return $enableTapEdgeToFlip$;
    },
    get $containerEl$() {
      return $containerEl$;
    },
    set $containerEl$(nextValue: typeof $containerEl$) {
      writeStore(containerEl$, nextValue);
    },
    get $contentViewportWidth$() {
      return $contentViewportWidth$;
    },
    get $contentViewportHeight$() {
      return $contentViewportHeight$;
    },
    get $imageLoadingState$() {
      return $imageLoadingState$;
    },
    get $blurListener$() {
      return $blurListener$;
    },
    get $reactiveElements$() {
      return $reactiveElements$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('sheetPagination' in next)
        api.sheetPagination = next.sheetPagination as typeof sheetPagination;
      if ('controlsVisible' in next)
        api.controlsVisible = next.controlsVisible as typeof controlsVisible;
      if ('htmlContent' in next) api.htmlContent = next.htmlContent as typeof htmlContent;
      if ('styleSheet' in next) api.styleSheet = next.styleSheet as typeof styleSheet;
      if ('epubResources' in next) api.epubResources = next.epubResources as typeof epubResources;
      if ('publicationManifest' in next)
        api.publicationManifest = next.publicationManifest as typeof publicationManifest;
      if ('sourceFormat' in next) api.sourceFormat = next.sourceFormat as typeof sourceFormat;
      if ('previewNavigationActive' in next)
        api.previewNavigationActive =
          next.previewNavigationActive as typeof previewNavigationActive;
      if ('width' in next) api.width = next.width as typeof width;
      if ('height' in next) api.height = next.height as typeof height;
      if ('verticalMode' in next) api.verticalMode = next.verticalMode as typeof verticalMode;
      if ('fontFeatureSettings' in next)
        api.fontFeatureSettings = next.fontFeatureSettings as typeof fontFeatureSettings;
      if ('verticalTextOrientation' in next)
        api.verticalTextOrientation =
          next.verticalTextOrientation as typeof verticalTextOrientation;
      if ('prioritizeReaderStyles' in next)
        api.prioritizeReaderStyles = next.prioritizeReaderStyles as typeof prioritizeReaderStyles;
      if ('enableTextJustification' in next)
        api.enableTextJustification =
          next.enableTextJustification as typeof enableTextJustification;
      if ('enableTextWrapPretty' in next)
        api.enableTextWrapPretty = next.enableTextWrapPretty as typeof enableTextWrapPretty;
      if ('textIndentation' in next)
        api.textIndentation = next.textIndentation as typeof textIndentation;
      if ('textMarginMode' in next)
        api.textMarginMode = next.textMarginMode as typeof textMarginMode;
      if ('textMarginValue' in next)
        api.textMarginValue = next.textMarginValue as typeof textMarginValue;
      if ('fontColor' in next) api.fontColor = next.fontColor as typeof fontColor;
      if ('backgroundColor' in next)
        api.backgroundColor = next.backgroundColor as typeof backgroundColor;
      if ('hintFuriganaFontColor' in next)
        api.hintFuriganaFontColor = next.hintFuriganaFontColor as typeof hintFuriganaFontColor;
      if ('hintFuriganaShadowColor' in next)
        api.hintFuriganaShadowColor =
          next.hintFuriganaShadowColor as typeof hintFuriganaShadowColor;
      if ('fontFamilyGroupOne' in next)
        api.fontFamilyGroupOne = next.fontFamilyGroupOne as typeof fontFamilyGroupOne;
      if ('fontFamilyGroupTwo' in next)
        api.fontFamilyGroupTwo = next.fontFamilyGroupTwo as typeof fontFamilyGroupTwo;
      if ('fontWeight' in next) api.fontWeight = next.fontWeight as typeof fontWeight;
      if ('fontSize' in next) api.fontSize = next.fontSize as typeof fontSize;
      if ('lineHeight' in next) api.lineHeight = next.lineHeight as typeof lineHeight;
      if ('hideSpoilerImage' in next)
        api.hideSpoilerImage = next.hideSpoilerImage as typeof hideSpoilerImage;
      if ('hideFurigana' in next) api.hideFurigana = next.hideFurigana as typeof hideFurigana;
      if ('furiganaStyle' in next) api.furiganaStyle = next.furiganaStyle as typeof furiganaStyle;
      if ('secondDimensionMaxValue' in next)
        api.secondDimensionMaxValue =
          next.secondDimensionMaxValue as typeof secondDimensionMaxValue;
      if ('firstDimensionMargin' in next)
        api.firstDimensionMargin = next.firstDimensionMargin as typeof firstDimensionMargin;
      if ('autoPositionOnResize' in next)
        api.autoPositionOnResize = next.autoPositionOnResize as typeof autoPositionOnResize;
      if ('avoidPageBreak' in next)
        api.avoidPageBreak = next.avoidPageBreak as typeof avoidPageBreak;
      if ('pageColumns' in next) api.pageColumns = next.pageColumns as typeof pageColumns;
      if ('autoBookmark' in next) api.autoBookmark = next.autoBookmark as typeof autoBookmark;
      if ('autoBookmarkTime' in next)
        api.autoBookmarkTime = next.autoBookmarkTime as typeof autoBookmarkTime;
      if ('viewMode' in next) api.viewMode = next.viewMode as typeof viewMode;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('bookCharCount' in next) api.bookCharCount = next.bookCharCount as typeof bookCharCount;
      if ('multiplier' in next) api.multiplier = next.multiplier as typeof multiplier;
      if ('bookmarkData' in next) api.bookmarkData = next.bookmarkData as typeof bookmarkData;
      if ('autoScroller' in next) api.autoScroller = next.autoScroller as typeof autoScroller;
      if ('bookmarkManager' in next)
        api.bookmarkManager = next.bookmarkManager as typeof bookmarkManager;
      if ('pageManager' in next) api.pageManager = next.pageManager as typeof pageManager;
      if ('isBookmarkScreen' in next)
        api.isBookmarkScreen = next.isBookmarkScreen as typeof isBookmarkScreen;
      if ('customReadingPoint' in next)
        api.customReadingPoint = next.customReadingPoint as typeof customReadingPoint;
      if ('customReadingPointTop' in next)
        api.customReadingPointTop = next.customReadingPointTop as typeof customReadingPointTop;
      if ('customReadingPointLeft' in next)
        api.customReadingPointLeft = next.customReadingPointLeft as typeof customReadingPointLeft;
      if ('customReadingPointScrollOffset' in next)
        api.customReadingPointScrollOffset =
          next.customReadingPointScrollOffset as typeof customReadingPointScrollOffset;
      if ('customReadingPointRange' in next)
        api.customReadingPointRange =
          next.customReadingPointRange as typeof customReadingPointRange;
      if ('showCustomReadingPoint' in next)
        api.showCustomReadingPoint = next.showCustomReadingPoint as typeof showCustomReadingPoint;
    }
  };
  return api;
}
