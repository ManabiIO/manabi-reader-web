<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import {
    nextChapter$,
    sectionList$,
    sectionProgress$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import { createBookmarkSnapshot } from '$lib/components/book-reader/bookmark-snapshot';
  import type { BookmarkManager, PageManager } from '$lib/components/book-reader/types';
  import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
  import type { FuriganaStyle } from '$lib/data/furigana-style';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import { resolveReaderFont } from '$lib/data/reader-typography';
  import {
    projectResource,
    rangeAt,
    resolveLocator,
    type PublicationManifest,
    type ReaderLocator
  } from '$lib/reader-location';
  import {
    createStoredFoliateBook,
    type StoredFoliateBook
  } from '$lib/foliate-epub/stored-foliate-book';
  import { FoliateCharacterProgress } from '$lib/foliate-epub/foliate-character-progress';
  import { PageTurnController } from '$lib/foliate-epub/page-turn-controller';
  import {
    ReaderNavigationCoordinator,
    resourceForReaderLocator,
    type ReaderNavigationOwner
  } from '$lib/foliate-epub/reader-navigation-owner';
  import type { Paginator } from '$lib/foliate-epub/paginator.js';

  export let htmlContent: string;
  export let styleSheet = '';
  export let publicationManifest: PublicationManifest;
  export let width: number;
  export let height: number;
  export let maxInlineSize = 0;
  export let controlsVisible = false;
  export let verticalMode: boolean;
  export let fontFeatureSettings: string;
  export let verticalTextOrientation: string;
  export let prioritizeReaderStyles: boolean;
  export let enableTextJustification: boolean;
  export let enableTextWrapPretty: boolean;
  export let fontColor: string;
  export let backgroundColor: string;
  export let hintFuriganaFontColor: string;
  export let hintFuriganaShadowColor: string;
  export let fontFamilyGroupOne: string;
  export let fontFamilyGroupTwo: string;
  export let fontWeight: number | null;
  export let fontSize: number;
  export let lineHeight: number;
  export let textIndentation: number;
  export let textMarginMode: TextMarginMode;
  export let textMarginValue: number;
  export let hideSpoilerImage: boolean;
  export let hideFurigana: boolean;
  export let furiganaStyle: FuriganaStyle;
  export let loadingState: boolean;
  export let avoidPageBreak: boolean;
  export let pageColumns: number;
  export let firstDimensionMargin: number;
  export let autoBookmark: boolean;
  export let autoBookmarkTime: number;
  export let bookmarkData: Promise<BooksDbBookmarkData | undefined>;
  export let exploredCharCount = 0;
  export let bookCharCount = 0;
  export let isBookmarkScreen = false;
  export let bookmarkManager: BookmarkManager | undefined;
  export let pageManager: PageManager | undefined;
  export let customReadingPointRange: Range | undefined;
  export let showCustomReadingPoint = false;

  const dispatch = createEventDispatcher<{
    bookmark: void;
    contentChange: HTMLElement;
    trackerPause: void;
    userNavigation: void;
    pageTurnStart: void;
    toggleControls: void;
  }>();

  let host: HTMLDivElement;
  let paginator: Paginator | undefined;
  let pageTurns: PageTurnController | undefined;
  let book: StoredFoliateBook | undefined;
  let progress: FoliateCharacterProgress | undefined;
  let sourceSections: Element[] = [];
  let contentEl: HTMLElement | undefined;
  let destroyed = false;
  const navigation = new ReaderNavigationCoordinator();
  let bookmarkTimer: ReturnType<typeof setTimeout> | undefined;
  let themeObserver: MutationObserver | undefined;
  let tocSubscription: { unsubscribe(): void } | undefined;

  export function getContentElement(): HTMLElement | undefined {
    return contentEl;
  }

  export function getDocumentSelection(): Selection | null {
    return contentEl?.ownerDocument.defaultView?.getSelection() ?? null;
  }

  const makePageManager = (): PageManager => ({
    nextPage: (input) => pageTurns?.turn(1, input),
    prevPage: (input) => pageTurns?.turn(-1, input),
    updateSectionDataByOffset: () => undefined
  });

  function currentIndex(): number {
    const current = paginator?.getContents?.()[0]?.index;
    return Number.isInteger(current) ? current! : -1;
  }

  function contentForPaginator(): HTMLElement | undefined {
    const doc = paginator?.getContents?.()[0]?.doc;
    return doc?.querySelector<HTMLElement>('.book-content') ?? undefined;
  }

  function runNavigation(operation: (owner: ReaderNavigationOwner) => Promise<boolean>) {
    clearTimeout(bookmarkTimer);
    pageTurns?.cancel();
    return navigation.run(operation);
  }

  function reportNavigationError(error: unknown) {
    if (!destroyed)
      paginator?.dispatchEvent(new CustomEvent('navigationerror', { detail: error }));
  }

  async function restoreCharacterCount(count: number, owner: ReaderNavigationOwner) {
    const renderer = paginator;
    const calculator = progress;
    if (!renderer || !calculator || !owner.isCurrent() || !Number.isFinite(count) || count < 0)
      return false;
    const index = calculator.sectionForCharacterCount(count);
    if (index < 0 || index >= sourceSections.length) return false;
    const accepted = await renderer.goTo({
      index,
      anchor: (doc: Document) => {
        if (!owner.isCurrent()) throw new DOMException('Navigation superseded.', 'AbortError');
        const current = doc.querySelector('.book-content');
        if (!current) throw new Error('The requested EPUB section is unavailable.');
        return calculator.rangeForCharacterCount(index, current, count) ?? 0;
      }
    });
    return accepted === true && owner.isCurrent() && currentIndex() === index;
  }

  function makeBookmarkManager(): BookmarkManager {
    return {
      formatBookmarkData(bookId: number) {
        if (!progress || !bookCharCount || navigation.pending || currentIndex() < 0)
          return undefined;
        return createBookmarkSnapshot(bookId, exploredCharCount, bookCharCount);
      },
      formatBookmarkDataByRange(bookId: number, range: Range | undefined) {
        if (!progress || !bookCharCount || navigation.pending || currentIndex() < 0)
          return undefined;
        const current = contentForPaginator();
        const index = currentIndex();
        const count =
          range && current?.contains(range.commonAncestorContainer)
            ? progress.exploredCharacterCount(index, current, range)
            : exploredCharCount;
        return createBookmarkSnapshot(bookId, count, bookCharCount);
      },
      scrollToBookmark(data: BooksDbBookmarkData) {
        void runNavigation((owner) =>
          restoreCharacterCount(data.exploredCharCount ?? 0, owner)
        ).catch(reportNavigationError);
      }
    };
  }

  function updateSectionProgress(index: number, fraction: number) {
    const entries = sectionList$.getValue();
    if (!entries.length) return;
    const map = new Map<string, SectionWithProgress>();
    entries.forEach((section, sectionIndex) => {
      map.set(section.reference, {
        ...section,
        progress:
          sectionIndex < index
            ? 100
            : sectionIndex > index
              ? 0
              : Math.max(0, Math.min(100, fraction * 100))
      });
    });
    sectionProgress$.next(map);
  }

  function readerStyles() {
    // Theme custom properties do not inherit across an iframe boundary.
    const hostStyles = host ? getComputedStyle(host) : undefined;
    const themeVariables = hostStyles
      ? [
          '--reader-background-color',
          '--reader-font-color',
          '--reader-selection-font-color',
          '--reader-selection-background-color',
          '--reader-hint-furigana-shadow-color',
          '--reader-hint-furigana-font-color'
        ]
          .map((name) => `${name}: ${hostStyles.getPropertyValue(name)};`)
          .join('\n')
      : '';
    const important = prioritizeReaderStyles ? ' !important' : '';
    const primary = resolveReaderFont(fontFamilyGroupOne, verticalMode);
    const secondary = resolveReaderFont(fontFamilyGroupTwo, verticalMode, true);
    const writing = verticalMode ? 'vertical-rl' : 'horizontal-tb';
    const furiganaMode = String(furiganaStyle).toLowerCase();
    const furiganaRules = !hideFurigana
      ? ''
      : furiganaMode === 'hide'
        ? '.book-content rt, .book-content rp { display: none !important; }'
        : furiganaMode === 'partial'
          ? `
            .book-content ruby rt { color: ${hintFuriganaFontColor}; }
            .book-content ruby.reveal-rt rt { color: inherit; }
            @media (hover: hover) { .book-content ruby:hover rt { color: inherit; } }
          `
          : `
            .book-content ruby {
              cursor: pointer;
              text-shadow: ${hintFuriganaShadowColor} 1px 0 10px;
            }
            .book-content ruby rt { visibility: hidden; }
            .book-content ruby.reveal-rt { text-shadow: none; }
            .book-content ruby.reveal-rt rt { visibility: visible; }
            ${
              furiganaMode === 'toggle'
                ? '@media (hover: hover) { .book-content ruby:not(.reveal-rt):hover rt { visibility: hidden; } }'
                : '@media (hover: hover) { .book-content ruby:hover rt { visibility: visible; } }'
            }
          `;
    const spoilerRules = hideSpoilerImage
      ? `
        .book-content [data-ttu-spoiler-img] {
          display: inline-block;
          width: 100%;
          height: 100%;
          vertical-align: middle;
          overflow: hidden;
          position: relative;
          cursor: pointer;
        }
        .book-content [data-ttu-spoiler-img] img,
        .book-content [data-ttu-spoiler-img] svg { filter: blur(44px); }
        .book-content [data-ttu-spoiler-img] .ttu-unspoilered { filter: none !important; }
        .book-content [data-ttu-spoiler-img] .spoiler-label {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: #dcddde;
          background-color: rgba(0, 0, 0, 0.6);
          display: inline-block;
          padding: 12px 8px;
          border-radius: 20px;
          font-size: 15px;
          font-family: system-ui, sans-serif;
          text-transform: uppercase;
          font-weight: 700;
          z-index: 1;
        }
      `
      : '';
    return `
      :root {
        ${themeVariables}
        --font-family-serif: ${primary};
        --font-family-sans-serif: ${secondary};
      }
      html, body { background: ${backgroundColor}; color: ${fontColor}; }
      body {
        writing-mode: ${writing}${important};
        text-orientation: ${verticalTextOrientation || 'mixed'}${important};
        font-family: ${primary}${important};
        font-size: ${fontSize}px${important};
        line-height: ${lineHeight}${important};
        font-weight: ${fontWeight ?? 'normal'}${important};
        font-feature-settings: ${fontFeatureSettings || 'normal'}${important};
      }
      .book-content { margin: ${textMarginMode === 'manual' ? `0 ${textMarginValue}rem` : '0'}; }
      .book-content p { text-indent: ${textIndentation}rem${important}; }
      ${enableTextJustification ? `.book-content p { text-align: justify${important}; }` : ''}
      ${enableTextWrapPretty ? '.book-content { text-wrap: pretty; }' : ''}
      ${avoidPageBreak ? '.book-content p { break-inside: avoid; }' : ''}
      ${furiganaRules}
      ${spoilerRules}
    `;
  }

  export async function revealLocator(locator: ReaderLocator, bookKey: string): Promise<boolean> {
    const renderer = paginator;
    if (!renderer || destroyed) return false;
    const resource = resourceForReaderLocator(publicationManifest.resources, locator);
    const section = resource && sourceSections[resource.spineIndex];
    if (!resource || !section) return false;

    return runNavigation(async (owner) => {
      // Resolve before moving the visible reader. One goTo owns the entire reveal;
      // a delayed digest cannot enqueue a second jump over a newer user request.
      const projected = projectResource(section, resource);
      const offsets = await resolveLocator(locator, projected, bookKey);
      if (!offsets || !owner.isCurrent()) return false;
      const accepted = await renderer.goTo({
        index: resource.spineIndex,
        anchor: (doc: Document) => {
          if (!owner.isCurrent()) throw new DOMException('Navigation superseded.', 'AbortError');
          const current = doc.querySelector('.book-content');
          if (!current) throw new Error('The requested EPUB section is unavailable.');
          const live = projectResource(current, resource);
          if (live.text !== projected.text)
            throw new Error('The EPUB text changed while resolving its saved location.');
          const range = rangeAt(live, offsets.start, offsets.end);
          if (!range) throw new Error('The saved EPUB location could not be resolved.');
          return range;
        }
      });
      if (accepted !== true || !owner.isCurrent()) return false;
      await tick();
      return owner.isCurrent() && currentIndex() === resource.spineIndex;
    });
  }

  function handleLoad(event: Event) {
    const detail = (event as CustomEvent<{ doc: Document; index: number }>).detail;
    const current = detail.doc.querySelector<HTMLElement>('.book-content');
    if (!current || destroyed) return;
    contentEl = current;
    dispatch('contentChange', current);
  }

  function handlePageTurnStart() {
    // Gestures are newer user intent, including while initial bookmark I/O waits.
    navigation.cancel();
    clearTimeout(bookmarkTimer);
    dispatch('pageTurnStart');
  }

  function handleRelocate(event: Event) {
    const detail = (
      event as CustomEvent<{ index: number; fraction?: number; range?: Range; reason?: string }>
    ).detail;
    const current = contentForPaginator();
    if (!current || !progress || destroyed || detail.index !== currentIndex()) return;
    const fraction = Number.isFinite(detail.fraction) ? detail.fraction! : 0;
    exploredCharCount = progress.exploredCharacterCount(detail.index, current, detail.range);
    updateSectionProgress(detail.index, fraction);
    if (navigation.pending) return;
    if (detail.reason === 'page' || detail.reason == null) {
      showCustomReadingPoint = false;
      customReadingPointRange = undefined;
      dispatch('userNavigation');
      if (autoBookmark) {
        clearTimeout(bookmarkTimer);
        bookmarkTimer = setTimeout(() => {
          if (!destroyed && !navigation.pending) dispatch('bookmark');
        }, Math.max(0, autoBookmarkTime) * 1000);
      }
    }
  }

  // Svelte does not follow reactive dependencies through readerStyles().
  $: styleInputs = [
    verticalMode,
    fontFeatureSettings,
    verticalTextOrientation,
    prioritizeReaderStyles,
    enableTextJustification,
    enableTextWrapPretty,
    fontColor,
    backgroundColor,
    hintFuriganaFontColor,
    hintFuriganaShadowColor,
    fontFamilyGroupOne,
    fontFamilyGroupTwo,
    fontWeight,
    fontSize,
    lineHeight,
    textIndentation,
    textMarginMode,
    textMarginValue,
    hideSpoilerImage,
    hideFurigana,
    furiganaStyle,
    avoidPageBreak
  ];

  $: if (paginator && styleInputs) {
    if (maxInlineSize > 0) paginator.setAttribute('max-inline-size', `${maxInlineSize}px`);
    else paginator.removeAttribute('max-inline-size');
    paginator.setAttribute('margin', `${Math.max(0, firstDimensionMargin)}px`);
    paginator.setAttribute('max-column-count', String(Math.max(1, pageColumns || 1)));
    paginator.setStyles(readerStyles());
  }

  $: if (paginator && progress) {
    paginator.setPageNumberDisplay({
      expanded: controlsVisible,
      color: fontColor,
      weights: progress.sectionEnds.map((end, index) => end - progress!.sectionStart(index))
    });
  }

  onMount(async () => {
    await import('$lib/foliate-epub/paginator.js');
    if (destroyed) return;

    const publication = createStoredFoliateBook(
      htmlContent,
      styleSheet,
      publicationManifest,
      document,
      { writingMode: verticalMode ? 'vertical-rl' : 'horizontal-tb' }
    );
    book = publication.book;
    sourceSections = publication.sourceSections;
    progress = new FoliateCharacterProgress(sourceSections);
    bookCharCount = progress.bookCharacterCount;

    paginator = document.createElement('foliate-paginator') as Paginator;
    paginator.setAttribute('flow', 'paginated');
    paginator.setAttribute('gap', '5%');
    if (maxInlineSize > 0) paginator.setAttribute('max-inline-size', `${maxInlineSize}px`);
    else paginator.removeAttribute('max-inline-size');
    paginator.setAttribute('margin', `${Math.max(0, firstDimensionMargin)}px`);
    paginator.setAttribute('max-column-count', String(Math.max(1, pageColumns || 1)));
    paginator.addEventListener('load', handleLoad);
    paginator.addEventListener('relocate', handleRelocate);
    paginator.addEventListener('pageturnstart', handlePageTurnStart);
    paginator.addEventListener('togglecontrols', () => dispatch('toggleControls'));
    pageTurns = new PageTurnController(paginator);
    host.append(paginator);
    paginator.open(book);
    paginator.setStyles(readerStyles());
    themeObserver = new MutationObserver(() => paginator?.setStyles(readerStyles()));
    for (const element of [document.documentElement, document.body])
      themeObserver.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme', 'data-mode', 'data-appearance']
      });

    pageManager = makePageManager();
    bookmarkManager = makeBookmarkManager();

    tocSubscription = nextChapter$.subscribe((target) => {
      if (typeof target === 'string' && !target) return;
      const index =
        typeof target === 'string'
          ? sourceSections.findIndex(
              (section) => section.id === target || section.querySelector(`#${CSS.escape(target)}`)
            )
          : target.spineIndex;
      const renderer = paginator;
      if (!Number.isSafeInteger(index) || index < 0 || index >= sourceSections.length || !renderer)
        return;
      const fragment = typeof target === 'string' ? target : target.fragment;
      void runNavigation(async (owner) => {
        const accepted = await renderer.goTo({
          index,
          anchor: fragment
            ? (doc: Document) => {
                if (!owner.isCurrent())
                  throw new DOMException('Navigation superseded.', 'AbortError');
                return (
                  doc.getElementById(fragment) ?? doc.querySelector(`#${CSS.escape(fragment)}`) ?? 0
                );
              }
            : 0
        });
        return accepted === true && owner.isCurrent() && currentIndex() === index;
      }).catch(reportNavigationError);
    });

    const renderer = paginator;
    await runNavigation(async (owner) => {
      if ((await renderer.goTo({ index: 0 })) !== true || !owner.isCurrent()) return false;
      const saved = await bookmarkData;
      if (!owner.isCurrent()) return false;
      return saved ? restoreCharacterCount(saved.exploredCharCount ?? 0, owner) : true;
    }).catch(reportNavigationError);
  });

  onDestroy(() => {
    destroyed = true;
    navigation.destroy();
    clearTimeout(bookmarkTimer);
    tocSubscription?.unsubscribe();
    paginator?.removeEventListener('load', handleLoad);
    paginator?.removeEventListener('relocate', handleRelocate);
    paginator?.removeEventListener('pageturnstart', handlePageTurnStart);
    themeObserver?.disconnect();
    pageTurns?.destroy();
    pageTurns = undefined;
    paginator?.destroy();
    paginator?.remove();
    paginator = undefined;
    book?.destroy();
    book = undefined;
    contentEl = undefined;
  });
</script>

<div
  bind:this={host}
  class="foliate-reader book-content"
  style:width={width ? `${width}px` : '100%'}
  style:height={height ? `${height}px` : '100%'}
  aria-label="EPUB reader"
  aria-busy={loadingState}
></div>

<style>
  .foliate-reader {
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  .foliate-reader :global(foliate-paginator) {
    width: 100%;
    height: 100%;
  }
</style>
