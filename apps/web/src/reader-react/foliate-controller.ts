/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { EpubResourceData } from '$lib/foliate-epub/publication-data';
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
import { VisibleReaderLocation } from '$lib/foliate-epub/visible-reader-location';
import { relayReaderKeydown } from '$lib/foliate-epub/reader-keyboard';
import { readerUIOwnsEvent } from '$lib/functions/reader-ui-events';
import { disableWheelNavigation$, skipKeyDownListener$ } from '$lib/data/store';
import { FoliateCharacterProgress } from '$lib/foliate-epub/foliate-character-progress';
import { pageTurnEffect$ } from '$lib/data/page-turn-preferences';
import { resolvedMode$ } from '$lib/appearance/state';
import { PageTurnController } from '$lib/foliate-epub/page-turn-controller';
import {
  ReaderNavigationCoordinator,
  resourceForReaderLocator,
  type ReaderNavigationOwner
} from '$lib/foliate-epub/reader-navigation-owner';
import type { Paginator } from '$lib/foliate-epub/paginator.js';
import { bindReaderChromeInteractions } from '$lib/reader-chrome-events';
import { ReaderController, readerTick, type StoreValue } from './controller';

export interface FoliateProps {
  htmlContent: string;
  styleSheet?: string;
  epubResources: EpubResourceData[] | undefined;
  publicationManifest: PublicationManifest;
  width: number;
  height: number;
  maxInlineSize?: number;
  controlsVisible?: boolean;
  verticalMode: boolean;
  fontFeatureSettings: string;
  verticalTextOrientation: string;
  prioritizeReaderStyles: boolean;
  enableTextJustification: boolean;
  enableTextWrapPretty: boolean;
  fontColor: string;
  backgroundColor: string;
  hintFuriganaFontColor: string;
  hintFuriganaShadowColor: string;
  fontFamilyGroupOne: string;
  fontFamilyGroupTwo: string;
  fontWeight: number | null;
  fontSize: number;
  lineHeight: number;
  textIndentation: number;
  textMarginMode: TextMarginMode;
  textMarginValue: number;
  hideSpoilerImage: boolean;
  hideFurigana: boolean;
  furiganaStyle: FuriganaStyle;
  loadingState: boolean;
  avoidPageBreak: boolean;
  pageColumns: number;
  firstDimensionMargin: number;
  autoBookmark: boolean;
  autoBookmarkTime: number;
  bookmarkData: Promise<BooksDbBookmarkData | undefined>;
  exploredCharCount?: number;
  bookCharCount?: number;
  isBookmarkScreen?: boolean;
  bookmarkManager: BookmarkManager | undefined;
  pageManager: PageManager | undefined;
  customReadingPointRange: Range | undefined;
  showCustomReadingPoint?: boolean;
}

export function createFoliate(
  props: FoliateProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let styleInputs: unknown[];
  let $pageTurnEffect$: StoreValue<typeof pageTurnEffect$> =
    __readerController.read(pageTurnEffect$);
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $disableWheelNavigation$: StoreValue<typeof disableWheelNavigation$> =
    __readerController.read(disableWheelNavigation$);
  let $resolvedMode$: StoreValue<typeof resolvedMode$> = __readerController.read(resolvedMode$);
  let htmlContent: string = props.htmlContent;
  let styleSheet = props.styleSheet !== undefined ? props.styleSheet : '';
  let epubResources: EpubResourceData[] | undefined = props.epubResources;
  let publicationManifest: PublicationManifest = props.publicationManifest;
  let width: number = props.width;
  let height: number = props.height;
  let maxInlineSize = props.maxInlineSize !== undefined ? props.maxInlineSize : 0;
  let controlsVisible = props.controlsVisible !== undefined ? props.controlsVisible : false;
  let verticalMode: boolean = props.verticalMode;
  let fontFeatureSettings: string = props.fontFeatureSettings;
  let verticalTextOrientation: string = props.verticalTextOrientation;
  let prioritizeReaderStyles: boolean = props.prioritizeReaderStyles;
  let enableTextJustification: boolean = props.enableTextJustification;
  let enableTextWrapPretty: boolean = props.enableTextWrapPretty;
  let fontColor: string = props.fontColor;
  let backgroundColor: string = props.backgroundColor;
  let hintFuriganaFontColor: string = props.hintFuriganaFontColor;
  let hintFuriganaShadowColor: string = props.hintFuriganaShadowColor;
  let fontFamilyGroupOne: string = props.fontFamilyGroupOne;
  let fontFamilyGroupTwo: string = props.fontFamilyGroupTwo;
  let fontWeight: number | null = props.fontWeight;
  let fontSize: number = props.fontSize;
  let lineHeight: number = props.lineHeight;
  let textIndentation: number = props.textIndentation;
  let textMarginMode: TextMarginMode = props.textMarginMode;
  let textMarginValue: number = props.textMarginValue;
  let hideSpoilerImage: boolean = props.hideSpoilerImage;
  let hideFurigana: boolean = props.hideFurigana;
  let furiganaStyle: FuriganaStyle = props.furiganaStyle;
  let loadingState: boolean = props.loadingState;
  let avoidPageBreak: boolean = props.avoidPageBreak;
  let pageColumns: number = props.pageColumns;
  let firstDimensionMargin: number = props.firstDimensionMargin;
  let autoBookmark: boolean = props.autoBookmark;
  let autoBookmarkTime: number = props.autoBookmarkTime;
  let bookmarkData: Promise<BooksDbBookmarkData | undefined> = props.bookmarkData;
  let exploredCharCount = props.exploredCharCount !== undefined ? props.exploredCharCount : 0;
  let bookCharCount = props.bookCharCount !== undefined ? props.bookCharCount : 0;
  let isBookmarkScreen = props.isBookmarkScreen !== undefined ? props.isBookmarkScreen : false;
  let bookmarkManager: BookmarkManager | undefined = props.bookmarkManager;
  let pageManager: PageManager | undefined = props.pageManager;
  let customReadingPointRange: Range | undefined = props.customReadingPointRange;
  let showCustomReadingPoint =
    props.showCustomReadingPoint !== undefined ? props.showCustomReadingPoint : false;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let host: HTMLDivElement;
  let paginator: Paginator | undefined;
  let pageTurns: PageTurnController | undefined;
  let book: StoredFoliateBook | undefined;
  let progress: FoliateCharacterProgress | undefined;
  let sourceSections: Element[] = [];
  let contentEl: HTMLElement | undefined;
  let destroyed = false;
  let stopChromeInteractions: (() => void) | undefined;
  let chromeNavigationRevision = 0;
  const navigation = new ReaderNavigationCoordinator();
  const visibleLocation = new VisibleReaderLocation();
  let bookmarkTimer: ReturnType<typeof setTimeout> | undefined;
  let themeObserver: MutationObserver | undefined;
  let tocSubscription:
    | {
        unsubscribe(): void;
      }
    | undefined;
  function getContentElement(): HTMLElement | undefined {
    return contentEl;
  }
  function capturePoint(bookKey: string): Promise<ReaderLocator | undefined> {
    return visibleLocation.capture(bookKey);
  }
  function getDocumentSelection(): Selection | null {
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
  let bookmarkVisibleRange: Range | undefined;
  function runNavigation(operation: (owner: ReaderNavigationOwner) => Promise<boolean>) {
    clearTimeout(bookmarkTimer);
    pageTurns?.cancel();
    return navigation.run(operation);
  }
  function reportNavigationError(error: unknown) {
    if (!destroyed) paginator?.dispatchEvent(new CustomEvent('navigationerror', { detail: error }));
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
        const current = contentForPaginator();
        const count =
          current && bookmarkVisibleRange
            ? progress.bookmarkCharacterCount(currentIndex(), current, bookmarkVisibleRange)
            : exploredCharCount;
        return createBookmarkSnapshot(bookId, count, bookCharCount);
      },
      formatBookmarkDataByRange(bookId: number, range: Range | undefined) {
        if (!progress || !bookCharCount || navigation.pending || currentIndex() < 0)
          return undefined;
        const current = contentForPaginator();
        const index = currentIndex();
        const count =
          range && current?.contains(range.commonAncestorContainer)
            ? progress.bookmarkCharacterCount(index, current, range)
            : current && bookmarkVisibleRange
              ? progress.bookmarkCharacterCount(index, current, bookmarkVisibleRange)
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
  async function revealLocator(locator: ReaderLocator, bookKey: string): Promise<boolean> {
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
      await readerTick();
      return owner.isCurrent() && currentIndex() === resource.spineIndex;
    });
  }
  function handleLoad(event: Event) {
    const detail = (
      event as CustomEvent<{
        doc: Document;
        index: number;
      }>
    ).detail;
    const current = detail.doc.querySelector<HTMLElement>('.book-content');
    if (!current || destroyed) return;
    stopChromeInteractions?.();
    __readerController.changed(
      (stopChromeInteractions = bindReaderChromeInteractions(detail.doc, {
        activity: (kind) => {
          if (!destroyed) dispatch('chromeActivity', kind);
        },
        navigationRevision: () => chromeNavigationRevision,
        selection: () => detail.doc.getSelection()?.toString() ?? '',
        keys: false
      }))
    );
    visibleLocation.clear();
    __readerController.changed((bookmarkVisibleRange = undefined));
    __readerController.changed((contentEl = current));
    dispatch('contentChange', current);
  }
  function handlePageTurnStart() {
    __readerController.changed(chromeNavigationRevision++);
    // Gestures are newer user intent, including while initial bookmark I/O waits.
    navigation.cancel();
    clearTimeout(bookmarkTimer);
    dispatch('pageTurnStart');
  }
  function handleRelocate(event: Event) {
    const detail = (
      event as CustomEvent<{
        index: number;
        fraction?: number;
        range?: Range;
        reason?: string;
      }>
    ).detail;
    const current = contentForPaginator();
    if (!current || !progress || destroyed || detail.index !== currentIndex()) return;
    const resource = publicationManifest.resources[detail.index];
    if (!resource || resource.spineIndex !== detail.index) return;
    visibleLocation.update(current, resource, detail.range);
    __readerController.changed((bookmarkVisibleRange = detail.range?.cloneRange()));
    const fraction = Number.isFinite(detail.fraction) ? detail.fraction! : 0;
    __readerController.changed(
      (exploredCharCount = progress.exploredCharacterCount(detail.index, current, detail.range))
    );
    updateSectionProgress(detail.index, fraction);
    if (navigation.pending) return;
    if (detail.reason === 'page' || detail.reason == null) {
      __readerController.changed((showCustomReadingPoint = false));
      __readerController.changed((customReadingPointRange = undefined));
      dispatch('userNavigation');
      if (autoBookmark) {
        clearTimeout(bookmarkTimer);
        __readerController.changed(
          (bookmarkTimer = setTimeout(
            () => {
              if (!destroyed && !navigation.pending) dispatch('bookmark');
            },
            Math.max(0, autoBookmarkTime) * 1000
          ))
        );
      }
    }
  }
  __readerController.effect(
    () => [
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
    ],
    () => {
      __readerController.changed(
        (styleInputs = [
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
        ])
      );
    }
  );
  __readerController.effect(
    () => [paginator, styleInputs, maxInlineSize, firstDimensionMargin, pageColumns],
    () => {
      if (paginator && styleInputs) {
        if (maxInlineSize > 0) paginator.setAttribute('max-inline-size', `${maxInlineSize}px`);
        else paginator.removeAttribute('max-inline-size');
        paginator.setAttribute('margin', `${Math.max(0, firstDimensionMargin)}px`);
        paginator.setAttribute('max-column-count', String(Math.max(1, pageColumns || 1)));
        paginator.setStyles(readerStyles());
      }
    }
  );
  __readerController.effect(
    () => [paginator, progress, controlsVisible, fontColor],
    () => {
      if (paginator && progress) {
        paginator.setPageNumberDisplay({
          expanded: controlsVisible,
          color: fontColor,
          weights: progress.sectionEnds.map((end, index) => end - progress!.sectionStart(index))
        });
      }
    }
  );
  __readerController.effect(
    () => [pageTurns, $pageTurnEffect$],
    () => {
      pageTurns?.setEffect($pageTurnEffect$);
    }
  );
  __readerController.onMount(async () => {
    await import('$lib/foliate-epub/paginator.js');
    if (destroyed) return;
    __readerController.changed((isBookmarkScreen = false));
    const publication = createStoredFoliateBook(
      htmlContent,
      styleSheet,
      publicationManifest,
      document,
      { writingMode: verticalMode ? 'vertical-rl' : 'horizontal-tb', resources: epubResources }
    );
    __readerController.changed((book = publication.book));
    __readerController.changed((sourceSections = publication.sourceSections));
    __readerController.changed((progress = new FoliateCharacterProgress(sourceSections)));
    __readerController.changed((bookCharCount = progress.bookCharacterCount));
    __readerController.changed(
      (paginator = document.createElement('foliate-paginator') as Paginator)
    );
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
    __readerController.changed(
      (pageTurns = new PageTurnController(paginator, {
        keydown: (event) => relayReaderKeydown(event, window),
        canTurn: (event) =>
          !$skipKeyDownListener$ &&
          !readerUIOwnsEvent(event) &&
          !(event?.type === 'wheel' && $disableWheelNavigation$)
      }))
    );
    pageTurns.setEffect($pageTurnEffect$);
    host.append(paginator);
    paginator.open(book);
    paginator.setStyles(readerStyles());
    __readerController.changed(
      (themeObserver = new MutationObserver(() => paginator?.setStyles(readerStyles())))
    );
    for (const element of [document.documentElement, document.body])
      themeObserver.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme', 'data-mode', 'data-appearance']
      });
    __readerController.changed((pageManager = makePageManager()));
    __readerController.changed((bookmarkManager = makeBookmarkManager()));
    __readerController.changed(
      (tocSubscription = nextChapter$.subscribe((target) => {
        if (typeof target === 'string' && !target) return;
        const index =
          typeof target === 'string'
            ? sourceSections.findIndex(
                (section) =>
                  section.id === target || section.querySelector(`#${CSS.escape(target)}`)
              )
            : target.spineIndex;
        const renderer = paginator;
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= sourceSections.length ||
          !renderer
        )
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
                    doc.getElementById(fragment) ??
                    doc.querySelector(`#${CSS.escape(fragment)}`) ??
                    0
                  );
                }
              : 0
          });
          return accepted === true && owner.isCurrent() && currentIndex() === index;
        }).catch(reportNavigationError);
      }))
    );
    const renderer = paginator;
    await runNavigation(async (owner) => {
      if ((await renderer.goTo({ index: 0 })) !== true || !owner.isCurrent()) return false;
      const saved = await bookmarkData;
      if (!owner.isCurrent()) return false;
      return saved ? restoreCharacterCount(saved.exploredCharCount ?? 0, owner) : true;
    }).catch(reportNavigationError);
  });
  __readerController.onDestroy(() => {
    __readerController.changed((destroyed = true));
    stopChromeInteractions?.();
    visibleLocation.clear();
    navigation.destroy();
    clearTimeout(bookmarkTimer);
    tocSubscription?.unsubscribe();
    paginator?.removeEventListener('load', handleLoad);
    paginator?.removeEventListener('relocate', handleRelocate);
    paginator?.removeEventListener('pageturnstart', handlePageTurnStart);
    themeObserver?.disconnect();
    pageTurns?.destroy();
    __readerController.changed((pageTurns = undefined));
    paginator?.destroy();
    paginator?.remove();
    __readerController.changed((paginator = undefined));
    book?.destroy();
    __readerController.changed((book = undefined));
    __readerController.changed((contentEl = undefined));
  });
  __readerController.observeSource(
    () => pageTurnEffect$,
    (value) => {
      $pageTurnEffect$ = value;
    }
  );
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  __readerController.observeSource(
    () => disableWheelNavigation$,
    (value) => {
      $disableWheelNavigation$ = value;
    }
  );
  __readerController.observeSource(
    () => resolvedMode$,
    (value) => {
      $resolvedMode$ = value;
    }
  );
  const api = {
    controller: __readerController,
    getContentElement,
    capturePoint,
    getDocumentSelection,
    currentIndex,
    contentForPaginator,
    runNavigation,
    reportNavigationError,
    restoreCharacterCount,
    makeBookmarkManager,
    updateSectionProgress,
    readerStyles,
    revealLocator,
    handleLoad,
    handlePageTurnStart,
    handleRelocate,
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
    get maxInlineSize() {
      return maxInlineSize;
    },
    set maxInlineSize(nextValue: typeof maxInlineSize) {
      if (Object.is(maxInlineSize, nextValue)) return;
      maxInlineSize = nextValue;
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
    get loadingState() {
      return loadingState;
    },
    set loadingState(nextValue: typeof loadingState) {
      if (Object.is(loadingState, nextValue)) return;
      loadingState = nextValue;
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
    get firstDimensionMargin() {
      return firstDimensionMargin;
    },
    set firstDimensionMargin(nextValue: typeof firstDimensionMargin) {
      if (Object.is(firstDimensionMargin, nextValue)) return;
      firstDimensionMargin = nextValue;
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
    get bookmarkData() {
      return bookmarkData;
    },
    set bookmarkData(nextValue: typeof bookmarkData) {
      if (Object.is(bookmarkData, nextValue)) return;
      bookmarkData = nextValue;
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
    get isBookmarkScreen() {
      return isBookmarkScreen;
    },
    set isBookmarkScreen(nextValue: typeof isBookmarkScreen) {
      if (Object.is(isBookmarkScreen, nextValue)) return;
      isBookmarkScreen = nextValue;
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
    get dispatch() {
      return dispatch;
    },
    get host() {
      return host;
    },
    set host(nextValue: typeof host) {
      if (Object.is(host, nextValue)) return;
      host = nextValue;
      __readerController.invalidate();
    },
    get paginator() {
      return paginator;
    },
    set paginator(nextValue: typeof paginator) {
      if (Object.is(paginator, nextValue)) return;
      paginator = nextValue;
      __readerController.invalidate();
    },
    get pageTurns() {
      return pageTurns;
    },
    set pageTurns(nextValue: typeof pageTurns) {
      if (Object.is(pageTurns, nextValue)) return;
      pageTurns = nextValue;
      __readerController.invalidate();
    },
    get book() {
      return book;
    },
    set book(nextValue: typeof book) {
      if (Object.is(book, nextValue)) return;
      book = nextValue;
      __readerController.invalidate();
    },
    get progress() {
      return progress;
    },
    set progress(nextValue: typeof progress) {
      if (Object.is(progress, nextValue)) return;
      progress = nextValue;
      __readerController.invalidate();
    },
    get sourceSections() {
      return sourceSections;
    },
    set sourceSections(nextValue: typeof sourceSections) {
      if (Object.is(sourceSections, nextValue)) return;
      sourceSections = nextValue;
      __readerController.invalidate();
    },
    get contentEl() {
      return contentEl;
    },
    set contentEl(nextValue: typeof contentEl) {
      if (Object.is(contentEl, nextValue)) return;
      contentEl = nextValue;
      __readerController.invalidate();
    },
    get destroyed() {
      return destroyed;
    },
    set destroyed(nextValue: typeof destroyed) {
      if (Object.is(destroyed, nextValue)) return;
      destroyed = nextValue;
      __readerController.invalidate();
    },
    get stopChromeInteractions() {
      return stopChromeInteractions;
    },
    set stopChromeInteractions(nextValue: typeof stopChromeInteractions) {
      if (Object.is(stopChromeInteractions, nextValue)) return;
      stopChromeInteractions = nextValue;
      __readerController.invalidate();
    },
    get chromeNavigationRevision() {
      return chromeNavigationRevision;
    },
    set chromeNavigationRevision(nextValue: typeof chromeNavigationRevision) {
      if (Object.is(chromeNavigationRevision, nextValue)) return;
      chromeNavigationRevision = nextValue;
      __readerController.invalidate();
    },
    get navigation() {
      return navigation;
    },
    get visibleLocation() {
      return visibleLocation;
    },
    get bookmarkTimer() {
      return bookmarkTimer;
    },
    set bookmarkTimer(nextValue: typeof bookmarkTimer) {
      if (Object.is(bookmarkTimer, nextValue)) return;
      bookmarkTimer = nextValue;
      __readerController.invalidate();
    },
    get themeObserver() {
      return themeObserver;
    },
    set themeObserver(nextValue: typeof themeObserver) {
      if (Object.is(themeObserver, nextValue)) return;
      themeObserver = nextValue;
      __readerController.invalidate();
    },
    get tocSubscription() {
      return tocSubscription;
    },
    set tocSubscription(nextValue: typeof tocSubscription) {
      if (Object.is(tocSubscription, nextValue)) return;
      tocSubscription = nextValue;
      __readerController.invalidate();
    },
    get makePageManager() {
      return makePageManager;
    },
    get bookmarkVisibleRange() {
      return bookmarkVisibleRange;
    },
    set bookmarkVisibleRange(nextValue: typeof bookmarkVisibleRange) {
      if (Object.is(bookmarkVisibleRange, nextValue)) return;
      bookmarkVisibleRange = nextValue;
      __readerController.invalidate();
    },
    get styleInputs() {
      return styleInputs;
    },
    set styleInputs(nextValue: typeof styleInputs) {
      if (Object.is(styleInputs, nextValue)) return;
      styleInputs = nextValue;
      __readerController.invalidate();
    },
    get $pageTurnEffect$() {
      return $pageTurnEffect$;
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    get $disableWheelNavigation$() {
      return $disableWheelNavigation$;
    },
    get $resolvedMode$() {
      return $resolvedMode$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('htmlContent' in next) api.htmlContent = next.htmlContent as typeof htmlContent;
      if ('styleSheet' in next) api.styleSheet = next.styleSheet as typeof styleSheet;
      if ('epubResources' in next) api.epubResources = next.epubResources as typeof epubResources;
      if ('publicationManifest' in next)
        api.publicationManifest = next.publicationManifest as typeof publicationManifest;
      if ('width' in next) api.width = next.width as typeof width;
      if ('height' in next) api.height = next.height as typeof height;
      if ('maxInlineSize' in next) api.maxInlineSize = next.maxInlineSize as typeof maxInlineSize;
      if ('controlsVisible' in next)
        api.controlsVisible = next.controlsVisible as typeof controlsVisible;
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
      if ('textIndentation' in next)
        api.textIndentation = next.textIndentation as typeof textIndentation;
      if ('textMarginMode' in next)
        api.textMarginMode = next.textMarginMode as typeof textMarginMode;
      if ('textMarginValue' in next)
        api.textMarginValue = next.textMarginValue as typeof textMarginValue;
      if ('hideSpoilerImage' in next)
        api.hideSpoilerImage = next.hideSpoilerImage as typeof hideSpoilerImage;
      if ('hideFurigana' in next) api.hideFurigana = next.hideFurigana as typeof hideFurigana;
      if ('furiganaStyle' in next) api.furiganaStyle = next.furiganaStyle as typeof furiganaStyle;
      if ('loadingState' in next) api.loadingState = next.loadingState as typeof loadingState;
      if ('avoidPageBreak' in next)
        api.avoidPageBreak = next.avoidPageBreak as typeof avoidPageBreak;
      if ('pageColumns' in next) api.pageColumns = next.pageColumns as typeof pageColumns;
      if ('firstDimensionMargin' in next)
        api.firstDimensionMargin = next.firstDimensionMargin as typeof firstDimensionMargin;
      if ('autoBookmark' in next) api.autoBookmark = next.autoBookmark as typeof autoBookmark;
      if ('autoBookmarkTime' in next)
        api.autoBookmarkTime = next.autoBookmarkTime as typeof autoBookmarkTime;
      if ('bookmarkData' in next) api.bookmarkData = next.bookmarkData as typeof bookmarkData;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('bookCharCount' in next) api.bookCharCount = next.bookCharCount as typeof bookCharCount;
      if ('isBookmarkScreen' in next)
        api.isBookmarkScreen = next.isBookmarkScreen as typeof isBookmarkScreen;
      if ('bookmarkManager' in next)
        api.bookmarkManager = next.bookmarkManager as typeof bookmarkManager;
      if ('pageManager' in next) api.pageManager = next.pageManager as typeof pageManager;
      if ('customReadingPointRange' in next)
        api.customReadingPointRange =
          next.customReadingPointRange as typeof customReadingPointRange;
      if ('showCustomReadingPoint' in next)
        api.showCustomReadingPoint = next.showCustomReadingPoint as typeof showCustomReadingPoint;
    }
  };
  return api;
}
