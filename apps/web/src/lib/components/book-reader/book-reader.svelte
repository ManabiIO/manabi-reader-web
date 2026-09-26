<script lang="ts">
  import {
    animationFrameScheduler,
    combineLatest,
    debounceTime,
    filter,
    map,
    switchMap,
    of,
    ReplaySubject,
    share,
    shareReplay,
    startWith,
    Subject,
    tap
  } from 'rxjs';
  import type { EpubResourceData } from '$lib/foliate-epub/publication-data';
  import BookReaderContinuous from '$lib/components/book-reader/book-reader-continuous/book-reader-continuous.svelte';
  import BookReaderFoliatePaginated from '$lib/components/book-reader/book-reader-paginated/book-reader-foliate-paginated.svelte';
  import { browser } from '$app/environment';
  import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
  import type { FuriganaStyle } from '$lib/data/furigana-style';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import { ViewMode } from '$lib/data/view-mode';
  import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import { writableSubject } from '$lib/functions/svelte/store';
  import { convertRemToPixels } from '$lib/functions/utils';
  import { logger } from '$lib/data/logger';
  import { imageLoadingState } from './image-loading-state';
  import { reactiveElements } from './reactive-elements';
  import type { AutoScroller, BookmarkManager, PageManager } from './types';
  import BookReaderPaginated from './book-reader-paginated/book-reader-paginated.svelte';
  import { enableReaderWakeLock$, enableTapEdgeToFlip$ } from '$lib/data/store';
  import { createEventDispatcher, onDestroy } from 'svelte';
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

  const dispatch = createEventDispatcher<{
    contentChange: HTMLElement;
    userNavigation: void;
    selectionChange: Range | undefined;
    readerKeydown: KeyboardEvent;
    pageTurnStart: void;
    toggleControls: void;
  }>();
  let currentContentEl: HTMLElement | undefined;
  let selectionDocument: Document | undefined;
  let paginatedReader: BookReaderPaginated | undefined;
  let foliatePaginatedReader: BookReaderFoliatePaginated | undefined;

  const foliatePreviewEnabled =
    browser && localStorage.getItem('manabi-dev-foliate-epub') === 'true';
  $: useFoliatePaginator =
    foliatePreviewEnabled && sourceFormat === 'epub' && !!publicationManifest;
  export let sheetPagination = false;
  export let controlsVisible = false;
  $: sheetPagination = useFoliatePaginator && viewMode === ViewMode.Paginated;

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
      selectionDocument = content.ownerDocument;
      selectionDocument.addEventListener('selectionchange', handleReaderSelectionChange);
    }
    currentContentEl = content;
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
    viewport: { left: number; top: number; right: number; bottom: number }
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
  export async function captureReaderPoint(
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

  export async function captureReaderSelection(
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

  export async function revealReaderLocator(
    locator: ReaderLocator,
    bookKey: string
  ): Promise<boolean> {
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

  export let htmlContent: string;

  export let styleSheet = '';

  export let publicationManifest: PublicationManifest | undefined;
  export let epubResources: EpubResourceData[] | undefined = undefined;

  export let sourceFormat: 'epub' | 'htmlz' | 'txt' | 'unknown' = 'unknown';

  export let previewNavigationActive = false;

  export let width: number;

  export let height: number;

  export let verticalMode: boolean;

  export let fontFeatureSettings: string;

  export let verticalTextOrientation: string;

  export let prioritizeReaderStyles: boolean;

  export let enableTextJustification: boolean;

  export let enableTextWrapPretty: boolean;

  export let textIndentation: number;

  export let textMarginMode: TextMarginMode;

  export let textMarginValue: number;

  export let fontColor: string;

  export let backgroundColor: string;

  export let hintFuriganaFontColor: string;

  export let hintFuriganaShadowColor: string;

  export let fontFamilyGroupOne: string;

  export let fontFamilyGroupTwo: string;

  export let fontWeight: number | null;

  export let fontSize: number;

  export let lineHeight: number;

  export let hideSpoilerImage: boolean;

  export let hideFurigana: boolean;

  export let furiganaStyle: FuriganaStyle;

  export let secondDimensionMaxValue: number;

  export let firstDimensionMargin: number;

  export let autoPositionOnResize: boolean;

  export let avoidPageBreak: boolean;

  export let pageColumns: number;

  export let autoBookmark: boolean;

  export let autoBookmarkTime: number;

  export let viewMode: ViewMode;

  export let exploredCharCount: number;

  export let bookCharCount: number;

  export let multiplier: number;

  export let bookmarkData: Promise<BooksDbBookmarkData | undefined>;

  export let autoScroller: AutoScroller | undefined;

  export let bookmarkManager: BookmarkManager | undefined;

  export let pageManager: PageManager | undefined;

  export let isBookmarkScreen: boolean;

  export let customReadingPoint: number;

  export let customReadingPointTop: number;

  export let customReadingPointLeft: number;

  export let customReadingPointScrollOffset: number;

  export let customReadingPointRange: Range | undefined;

  export let showCustomReadingPoint: boolean;

  let showBlurMessage = false;

  let wakeLock: WakeLockSentinel | undefined;

  let visibilityState: DocumentVisibilityState;

  const mutationObserver: MutationObserver = new MutationObserver(handleMutation);

  const width$ = new Subject<number>();

  const height$ = new Subject<number>();

  const containerEl$ = writableSubject<HTMLElement | null>(null);

  $: heightModifer =
    firstDimensionMargin && ViewMode.Paginated === viewMode && !verticalMode
      ? firstDimensionMargin * 2
      : 0;

  $: if ($enableReaderWakeLock$ && visibilityState === 'visible') {
    setTimeout(requestWakeLock, 500);
  }

  onDestroy(() => {
    selectionDocument?.removeEventListener('selectionchange', handleReaderSelectionChange);
    selectionDocument = undefined;
    mutationObserver.disconnect();

    releaseWakeLock();
  });

  const computedStyle$ = combineLatest([
    containerEl$.pipe(filter((el): el is HTMLElement => !!el)),
    combineLatest([width$, height$]).pipe(startWith(0))
  ]).pipe(
    debounceTime(0, animationFrameScheduler),
    map(([el]) => getComputedStyle(el)),
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
    )
  );

  const contentViewportHeight$ = computedStyle$.pipe(
    map((style) =>
      getAdjustedHeight(
        height - parsePx(style.paddingTop) - parsePx(style.paddingBottom) - heightModifer
      )
    )
  );

  // Content and font reflows replace the listener lifetime; accumulating
  // subscriptions here makes one ruby click toggle twice after a late font.
  const reactiveElements$ = iffBrowser(() => of(document)).pipe(
    switchMap((document) => {
      const reactiveElementsFn = reactiveElements(
        document,
        furiganaStyle,
        hideSpoilerImage,
        navigator.standalone || window.matchMedia('(display-mode: fullscreen)').matches
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

  $: width$.next(width);

  $: height$.next(height);

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
      showBlurMessage = false;
      return;
    }

    showBlurMessage = (mutation.target as HTMLElement).style.filter.includes('blur');
  }

  async function requestWakeLock() {
    if (wakeLock && !wakeLock.released) {
      return;
    }

    wakeLock = await navigator.wakeLock.request().catch(({ message }) => {
      logger.error(`failed to request wakelock: ${message}`);

      return undefined;
    });

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

    wakeLock = undefined;
  }
</script>

{#if showBlurMessage}
  <div
    class="fixed top-12 right-4 p-2 border max-w-[90vw] z-[1]"
    style:writing-mode="horizontal-tb"
    style:color={fontColor}
    style:background-color={backgroundColor}
    style:border-color={fontColor}
  >
    The reader is currently blurred due to an external application (e. g. exstatic)
  </div>
{/if}
<div
  bind:this={$containerEl$}
  class="reader-page-frame"
  class:vertical-page={verticalMode}
  class:foliate-page={useFoliatePaginator && viewMode === ViewMode.Paginated}
>
  {#if viewMode === ViewMode.Continuous}
    <BookReaderContinuous
      {htmlContent}
      {previewNavigationActive}
      width={$contentViewportWidth$ ?? 0}
      height={$contentViewportHeight$ ?? 0}
      {verticalMode}
      {fontFeatureSettings}
      {verticalTextOrientation}
      {prioritizeReaderStyles}
      {enableTextJustification}
      {enableTextWrapPretty}
      {fontColor}
      {backgroundColor}
      {hintFuriganaFontColor}
      {hintFuriganaShadowColor}
      {fontFamilyGroupOne}
      {fontFamilyGroupTwo}
      {fontWeight}
      {fontSize}
      {lineHeight}
      {textIndentation}
      {textMarginMode}
      {textMarginValue}
      {hideSpoilerImage}
      {hideFurigana}
      {furiganaStyle}
      {secondDimensionMaxValue}
      {firstDimensionMargin}
      {autoPositionOnResize}
      {autoBookmark}
      {autoBookmarkTime}
      {multiplier}
      loadingState={$imageLoadingState$ ?? true}
      bind:exploredCharCount
      bind:bookCharCount
      bind:bookmarkData
      bind:autoScroller
      bind:bookmarkManager
      bind:pageManager
      bind:customReadingPoint
      bind:customReadingPointTop
      bind:customReadingPointLeft
      bind:customReadingPointScrollOffset
      on:contentChange={(ev) => handleReaderContentChange(ev.detail)}
      on:bookmark
      on:trackerPause
      on:userNavigation={() => dispatch('userNavigation')}
    />
  {:else if useFoliatePaginator && publicationManifest}
    <BookReaderFoliatePaginated
      bind:this={foliatePaginatedReader}
      on:readerKeydown
      {htmlContent}
      {styleSheet}
      {publicationManifest}
      {epubResources}
      {width}
      {height}
      maxInlineSize={secondDimensionMaxValue}
      {controlsVisible}
      on:pageTurnStart
      on:toggleControls
      {verticalMode}
      {fontFeatureSettings}
      {verticalTextOrientation}
      {prioritizeReaderStyles}
      {enableTextJustification}
      {enableTextWrapPretty}
      {fontColor}
      {backgroundColor}
      {hintFuriganaFontColor}
      {hintFuriganaShadowColor}
      {fontFamilyGroupOne}
      {fontFamilyGroupTwo}
      {fontWeight}
      {fontSize}
      {lineHeight}
      {textIndentation}
      {textMarginMode}
      {textMarginValue}
      {hideSpoilerImage}
      {hideFurigana}
      {furiganaStyle}
      loadingState={$imageLoadingState$ ?? true}
      {avoidPageBreak}
      {pageColumns}
      {autoBookmark}
      {autoBookmarkTime}
      {firstDimensionMargin}
      bind:exploredCharCount
      bind:bookCharCount
      bind:isBookmarkScreen
      bind:bookmarkData
      bind:bookmarkManager
      bind:pageManager
      bind:customReadingPointRange
      bind:showCustomReadingPoint
      on:contentChange={(ev) => handleReaderContentChange(ev.detail)}
      on:bookmark
      on:trackerPause
      on:userNavigation={() => dispatch('userNavigation')}
    />
  {:else}
    <BookReaderPaginated
      bind:this={paginatedReader}
      {htmlContent}
      width={$contentViewportWidth$ ?? 0}
      height={$contentViewportHeight$ ?? 0}
      {verticalMode}
      {fontFeatureSettings}
      {verticalTextOrientation}
      {prioritizeReaderStyles}
      {enableTextJustification}
      {enableTextWrapPretty}
      {fontColor}
      {backgroundColor}
      {hintFuriganaFontColor}
      {hintFuriganaShadowColor}
      {fontFamilyGroupOne}
      {fontFamilyGroupTwo}
      {fontWeight}
      {fontSize}
      {lineHeight}
      {textIndentation}
      {textMarginMode}
      {textMarginValue}
      {hideSpoilerImage}
      {hideFurigana}
      {furiganaStyle}
      loadingState={$imageLoadingState$ ?? true}
      {avoidPageBreak}
      {pageColumns}
      {autoBookmark}
      {autoBookmarkTime}
      {firstDimensionMargin}
      bind:exploredCharCount
      bind:bookCharCount
      bind:isBookmarkScreen
      bind:bookmarkData
      bind:bookmarkManager
      bind:pageManager
      bind:customReadingPointRange
      bind:showCustomReadingPoint
      on:contentChange={(ev) => handleReaderContentChange(ev.detail)}
      on:bookmark
      on:trackerPause
      on:userNavigation={() => dispatch('userNavigation')}
    />
  {/if}
</div>
{$blurListener$ ?? ''}
{$reactiveElements$ ?? ''}
<svelte:document bind:visibilityState />

<style>
  /* The engine measures this padding before pagination, including safe areas. */
  .reader-page-frame {
    --reader-frame-top: calc(4.5rem + env(safe-area-inset-top));
    --reader-frame-bottom: calc(7.5rem + env(safe-area-inset-bottom));
    --reader-frame-left: max(1.5rem, env(safe-area-inset-left));
    --reader-frame-right: max(1.5rem, env(safe-area-inset-right));
  }
  .reader-page-frame {
    padding: var(--reader-frame-top) var(--reader-frame-right) var(--reader-frame-bottom)
      var(--reader-frame-left);
  }
  .reader-page-frame.foliate-page {
    padding: 0;
    --reader-page-radius: 55px;
    --reader-page-insets: var(--reader-frame-top) var(--reader-frame-right)
      var(--reader-frame-bottom) var(--reader-frame-left);
  }
  @media (min-width: 768px) {
    .reader-page-frame.foliate-page {
      --reader-page-radius: 20px;
    }
    .reader-page-frame {
      --reader-frame-top: max(calc(5rem + env(safe-area-inset-top)), calc((100dvh - 780px) / 2));
      --reader-frame-bottom: max(
        calc(7.5rem + env(safe-area-inset-bottom)),
        calc((100dvh - 780px) / 2)
      );
      --reader-frame-left: max(4rem, calc((100vw - 1280px) / 2));
      --reader-frame-right: max(4rem, calc((100vw - 1280px) / 2));
    }
    .vertical-page {
      --reader-frame-left: max(4rem, calc((100vw - 960px) / 2));
      --reader-frame-right: max(4rem, calc((100vw - 960px) / 2));
    }
  }
</style>
