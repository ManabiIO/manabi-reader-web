/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { bookFragmentElement } from '../lib/functions/book-security/book-fragment';
import { readerUIOwnsEvent } from '$lib/functions/reader-ui-events';
import { projectResource, rangeAt, resolveLocator, type ReaderLocator } from '$lib/reader-location';
import { browser } from '../runtime/environment';
import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import { SECTION_CHANGE } from '$lib/data/events';
import { observeReaderFontLayout } from '$lib/functions/reader-font-layout';
import { FuriganaStyle } from '$lib/data/furigana-style';
import {
  disableWheelNavigation$,
  firstDimensionMargin$,
  selectionToBookmarkEnabled$,
  skipKeyDownListener$,
  swipeThreshold$
} from '$lib/data/store';
import type { TextMarginMode } from '$lib/data/text-margin-mode';
import { clearRange, createRange, pulseElement } from '$lib/functions/range-util';
import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
import { getExternalTargetElement, isMobile$ } from '$lib/functions/utils';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  skip,
  Subject,
  switchMap,
  take,
  takeUntil,
  throttleTime
} from 'rxjs';
import type { BookmarkManager, PageManager } from '../lib/components/book-reader/types';
import { BookmarkManagerPaginated } from '../lib/components/book-reader/book-reader-paginated/bookmark-manager-paginated';
import { PageManagerPaginated } from '../lib/components/book-reader/book-reader-paginated/page-manager-paginated';
import { SectionCharacterStatsCalculator } from '../lib/components/book-reader/book-reader-paginated/section-character-stats-calculator';
import { ReaderController, readerTick, type StoreValue } from './controller';
export interface PaginatedProps {
  htmlContent: string;
  width: number;
  height: number;
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
  bookmarkData: Promise<BooksDbBookmarkData | undefined>;
  pageManager: PageManager | undefined;
  bookmarkManager: BookmarkManager | undefined;
  exploredCharCount: number;
  bookCharCount: number;
  isBookmarkScreen?: boolean;
  avoidPageBreak?: boolean;
  pageColumns: number;
  firstDimensionMargin: number;
  autoBookmark?: boolean;
  autoBookmarkTime: number;
  customReadingPointRange: Range | undefined;
  showCustomReadingPoint: boolean;
}

export function createPaginated(
  props: PaginatedProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let columnCount: number;
  let $selectionToBookmarkEnabled$: StoreValue<typeof selectionToBookmarkEnabled$> =
    __readerController.read(selectionToBookmarkEnabled$);
  let $disableWheelNavigation$: StoreValue<typeof disableWheelNavigation$> =
    __readerController.read(disableWheelNavigation$);
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $isMobile$: StoreValue<typeof isMobile$> = __readerController.read(isMobile$);
  let $firstDimensionMargin$: StoreValue<typeof firstDimensionMargin$> =
    __readerController.read(firstDimensionMargin$);
  let $swipeThreshold$: StoreValue<typeof swipeThreshold$> =
    __readerController.read(swipeThreshold$);
  let htmlContent: string = props.htmlContent;
  let width: number = props.width;
  let height: number = props.height;
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
  let bookmarkData: Promise<BooksDbBookmarkData | undefined> = props.bookmarkData;
  let pageManager: PageManager | undefined = props.pageManager;
  let bookmarkManager: BookmarkManager | undefined = props.bookmarkManager;
  let exploredCharCount: number = props.exploredCharCount;
  let bookCharCount: number = props.bookCharCount;
  let isBookmarkScreen = props.isBookmarkScreen !== undefined ? props.isBookmarkScreen : false;
  let avoidPageBreak = props.avoidPageBreak !== undefined ? props.avoidPageBreak : true;
  let pageColumns: number = props.pageColumns;
  let firstDimensionMargin: number = props.firstDimensionMargin;
  let autoBookmark = props.autoBookmark !== undefined ? props.autoBookmark : false;
  let autoBookmarkTime: number = props.autoBookmarkTime;
  let customReadingPointRange: Range | undefined = props.customReadingPointRange;
  let showCustomReadingPoint: boolean = props.showCustomReadingPoint;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let scrollEl: HTMLElement | undefined;
  let contentEl: HTMLElement | undefined;
  let calculator: SectionCharacterStatsCalculator | undefined;
  let sections: Element[] = [];
  let concretePageManager: PageManagerPaginated | undefined;
  let concreteBookmarkManager: BookmarkManagerPaginated | undefined;
  let scrollWhenReady: boolean;
  let allowDisplay = false;
  let displayedHtml = '';
  let previousIntendedCount = 0;
  let useExploredCharCount = false;
  let isResizing = false;
  let bookmarkTopAdjustment: string | undefined;
  let bookmarkLeftAdjustment: string | undefined;
  let bookmarkRightAdjustment: string | undefined;
  let stopFontLayout: (() => void) | undefined;
  let currentSectionId = '';
  let currentSpineIndex = -1;
  let mountedGeneration = 0;
  let disposed = false;
  let renderGeneration = 0;
  const width$ = new Subject<number>();
  const height$ = new Subject<number>();
  const sectionIndex$ = new BehaviorSubject<number>(-1);
  const pageChange$ = new Subject<boolean>();
  const virtualScrollPos$ = new BehaviorSubject(0);
  const sectionRenderComplete$ = new Subject<number>();
  const sectionReady$ = new Subject<SectionCharacterStatsCalculator>();
  const currentSection$ = sectionIndex$.pipe(
    map((index) => ({
      index,
      id: sections[index]?.id.startsWith('ttu-') ? sections[index].id : '',
      html: sections[index]?.innerHTML || ''
    }))
  );
  const cssClassOverflowHidden = 'overflow-hidden';
  const gap = 40;
  const destroy$ = new Subject<void>();
  function getContentElement(): HTMLElement | undefined {
    return scrollEl;
  }
  /** Selection belongs to the rendered resource document, which may be framed. */
  function getDocumentSelection(): Selection | null {
    return scrollEl?.ownerDocument.defaultView?.getSelection() ?? null;
  }
  __readerController.effect(
    () => [bookmarkData],
    () => {
      bookmarkData.then((data) => {
        __readerController.changed((useExploredCharCount = false));
        updateBookmarkScreen(data);
      });
    }
  );
  __readerController.effect(
    () => [width, width$],
    () => {
      if (width) width$.next(width);
    }
  );
  __readerController.effect(
    () => [height, height$],
    () => {
      if (height) height$.next(height);
    }
  );
  __readerController.effect(
    () => [verticalMode, pageColumns, width],
    () => {
      __readerController.changed(
        (columnCount = verticalMode ? 1 : pageColumns || Math.ceil(width / 1000))
      );
    }
  );
  __readerController.effect(
    () => [htmlContent],
    () => {
      if (htmlContent) {
        __readerController.changed((scrollWhenReady = true));
      }
    }
  );
  __readerController.effect(
    () => [htmlContent, sectionIndex$],
    () => {
      if (browser) {
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = htmlContent;
        __readerController.changed((sections = Array.from(tempContainer.children)));
        sectionIndex$.next(0);
      }
    }
  );
  __readerController.effect(
    () => [
      contentEl,
      scrollEl,
      sections,
      sectionIndex$,
      virtualScrollPos$,
      width,
      height,
      gap,
      verticalMode,
      pageChange$,
      sectionRenderComplete$
    ],
    () => {
      if (contentEl && scrollEl && sections) {
        __readerController.changed(
          (concretePageManager = new PageManagerPaginated(
            contentEl,
            scrollEl,
            sections,
            sectionIndex$,
            virtualScrollPos$,
            width,
            height,
            gap,
            verticalMode,
            pageChange$,
            sectionRenderComplete$
          ))
        );
        __readerController.changed((pageManager = concretePageManager));
      }
    }
  );
  __readerController.effect(
    () => [calculator, width, height, loadingState, renderGeneration],
    () => {
      if (calculator && width && height && !loadingState) {
        const c = calculator;
        const generation = renderGeneration;
        requestAnimationFrame(() => {
          if (generation === renderGeneration) onContentDisplayChange(c);
        });
      }
    }
  );
  __readerController.effect(
    () => [calculator, concretePageManager, sectionReady$, sectionIndex$],
    () => {
      if (calculator && concretePageManager) {
        __readerController.changed(
          (concreteBookmarkManager = new BookmarkManagerPaginated(
            calculator,
            concretePageManager,
            sectionReady$,
            sectionIndex$,
            (c) => __readerController.changed((previousIntendedCount = c))
          ))
        );
        __readerController.changed((bookmarkManager = concreteBookmarkManager));
      }
    }
  );
  __readerController.effect(
    () => [cssClassOverflowHidden],
    () => {
      if (browser) {
        // because Yomitan popup creates overflow on vertical-rl
        document.body.classList.add(cssClassOverflowHidden);
      }
    }
  );
  __readerController.effect(
    () => [customReadingPointRange],
    () => {
      updateAfterCustomReadingPointUpdate(customReadingPointRange);
    }
  );
  /** Experimental Code - May be removed any time without warning */
  __readerController.onMount(() => document.addEventListener('ttu-action', handleAction, false));
  async function handleAction({ detail }: any) {
    if (!detail.type || !calculator || !concretePageManager) {
      return;
    }
    if (detail.type === 'cue') {
      const targetSection = getTargetSection(detail.selector);
      if (targetSection === -1) {
        return;
      }
      const currentSection = sectionIndex$.getValue();
      if (currentSection !== targetSection) {
        const waitForSection = new Promise<void>((resolve) => {
          sectionReady$.pipe(take(1)).subscribe(() => resolve());
        });
        sectionIndex$.next(targetSection);
        concretePageManager.scrollTo(0, false);
        await waitForSection;
      }
      const scrollPos = getTargetScrollPos(calculator, detail.selector);
      if (scrollPos < 0) {
        return;
      }
      concretePageManager.scrollTo(scrollPos, true);
      if (currentSection !== targetSection) {
        document.dispatchEvent(new CustomEvent(SECTION_CHANGE));
      }
    } else if (detail.type === 'pauseTracker') {
      const targetSection = getTargetSection(detail.selector);
      if (targetSection === -1) {
        return;
      }
      if (targetSection !== sectionIndex$.getValue()) {
        dispatch('trackerPause');
        return;
      }
      const scrollPos = getTargetScrollPos(calculator, detail.selector);
      if (scrollPos < 0) {
        return;
      }
      const currentScrollPos = calculator.getScrollPosByCharCount(
        calculator.calcExploredCharCount(customReadingPointRange)
      );
      if (scrollPos !== currentScrollPos) {
        dispatch('trackerPause');
      }
    }
  }
  function getTargetSection(selector: string) {
    let targetSection = -1;
    for (let index = 0, { length } = sections; index < length; index += 1) {
      const element = getExternalTargetElement(sections[index], selector);
      if (element) {
        targetSection = index;
        break;
      }
    }
    return targetSection;
  }
  function getTargetScrollPos(
    calculatorInstance: SectionCharacterStatsCalculator,
    selector: string
  ) {
    const targetElement = getExternalTargetElement(document, selector);
    const nodeRange = document.createRange();
    if (!targetElement) {
      return -1;
    }
    nodeRange.setStart(targetElement, 0);
    nodeRange.setEnd(targetElement, targetElement.childNodes.length);
    return calculatorInstance.getScrollPosByCharCount(
      calculatorInstance.calcExploredCharCount(nodeRange)
    );
  }
  /** Experimental Code - May be removed or changed any time without warning */
  __readerController.onDestroy(() => {
    __readerController.changed((disposed = true));
    __readerController.changed((renderGeneration += 1));
    stopFontLayout?.();
    sectionReady$.complete();
    sectionRenderComplete$.complete();
    document.removeEventListener('ttu-action', handleAction, false);
    document.body.classList.remove(cssClassOverflowHidden);
    destroy$.next();
    destroy$.complete();
  });
  combineLatest([width$, height$])
    .pipe(
      skip(1),
      switchMap(() => sectionReady$.pipe(take(1))),
      takeUntil(destroy$)
    )
    .subscribe(() => {
      if (!calculator || !concretePageManager) return;
      concretePageManager.scrollTo(0, false);
      calculator.updateParagraphPos();
      const scrollPos = calculator.getScrollPosByCharCount(previousIntendedCount);
      if (scrollPos < 0) return;
      concretePageManager.scrollTo(scrollPos, false);
      __readerController.changed((isResizing = false));
    });
  pageChange$.pipe(takeUntil(destroy$)).subscribe((isUser) => {
    if (!calculator) return;
    if (!isResizing) {
      __readerController.changed((showCustomReadingPoint = false));
      pulseElement(customReadingPointRange?.endContainer?.parentElement, 'remove', 1);
      __readerController.changed((customReadingPointRange = undefined));
    }
    __readerController.changed(
      (exploredCharCount = calculator.calcExploredCharCount(customReadingPointRange))
    );
    if (isUser) {
      dispatch('userNavigation');
      __readerController.changed((previousIntendedCount = exploredCharCount));
      if ($selectionToBookmarkEnabled$) {
        clearRange(window);
      }
    }
    bookmarkData.then((data) => {
      __readerController.changed((useExploredCharCount = isUser || !!customReadingPointRange));
      updateBookmarkScreen(data);
    });
  });
  if (autoBookmark) {
    pageChange$
      .pipe(debounceTime(autoBookmarkTime * 1000), takeUntil(destroy$))
      .subscribe((isUser) => {
        if (isUser) {
          dispatch('bookmark');
        }
      });
  }
  currentSection$
    .pipe(
      distinctUntilChanged((a, b) => a.index === b.index && a.id === b.id && a.html === b.html),
      takeUntil(destroy$)
    )
    .subscribe(({ index, id, html }) => {
      const generation = __readerController.changed(++renderGeneration);
      __readerController.changed((allowDisplay = false));
      __readerController.changed((calculator = undefined));
      stopFontLayout?.();
      const nestAnimationFrame = (fn: () => void, count: number) => {
        if (disposed || generation !== renderGeneration) return;
        if (count === 0) {
          fn();
          return;
        }
        requestAnimationFrame(() => nestAnimationFrame(fn, count - 1));
      };
      // 2x for loading screen to render. Identity and content must mount together:
      // chapter-scoped CSS is needed before any image/font/layout measurement.
      nestAnimationFrame(() => {
        __readerController.changed((currentSectionId = id));
        __readerController.changed((currentSpineIndex = index));
        __readerController.changed((displayedHtml = html));
        __readerController.changed((mountedGeneration = generation));
      }, 2);
    });
  iffBrowser(() => fromEvent<WheelEvent>(document.body, 'wheel', { passive: true }))
    .pipe(
      filter(
        (event) => !$disableWheelNavigation$ && !$skipKeyDownListener$ && !readerUIOwnsEvent(event)
      ),
      throttleTime(50),
      takeUntil(destroy$)
    )
    .subscribe((ev) => {
      let multiplier = (ev.deltaX < 0 ? -1 : 1) * (verticalMode ? -1 : 1);
      if (!ev.deltaX) {
        multiplier = ev.deltaY < 0 ? -1 : 1;
      }
      concretePageManager?.flipPage(multiplier as -1 | 1);
    });
  function updateAfterCustomReadingPointUpdate(updatedCustomReadingPosition: Range | undefined) {
    if (!calculator) {
      return;
    }
    __readerController.changed(
      (exploredCharCount = calculator.calcExploredCharCount(updatedCustomReadingPosition))
    );
    __readerController.changed((previousIntendedCount = exploredCharCount));
    updateSectionData(updatedCustomReadingPosition);
  }
  function updateSectionData(updatedCustomReadingRange: Range | undefined) {
    if (!concretePageManager || !calculator) {
      return;
    }
    concretePageManager.updateSectionDataByOffset(
      calculator.getOffsetToRange(updatedCustomReadingRange, columnCount)
    );
  }
  function onHtmlLoad() {
    if (!scrollEl || currentSpineIndex < 0 || !displayedHtml) return;
    __readerController.changed(
      (calculator = new SectionCharacterStatsCalculator(
        scrollEl,
        sections,
        virtualScrollPos$,
        () => width,
        () => height,
        () => gap,
        verticalMode,
        scrollEl,
        document
      ))
    );
    __readerController.changed((exploredCharCount = 0));
    __readerController.changed((previousIntendedCount = 0));
    __readerController.changed((bookCharCount = calculator.charCount));
    stopFontLayout?.();
    __readerController.changed(
      (stopFontLayout = observeReaderFontLayout(scrollEl, triggerContentChange))
    );
  }
  function triggerContentChange() {
    if (!calculator || !scrollEl || currentSpineIndex !== sectionIndex$.getValue()) return;
    calculator.updateCurrentSection(currentSpineIndex);
    calculator.updateParagraphPos();
    if (!scrollWhenReady && concretePageManager) {
      const scrollPos = calculator.getScrollPosByCharCount(previousIntendedCount);
      if (scrollPos >= 0) {
        __readerController.changed((isResizing = true));
        concretePageManager.scrollTo(scrollPos, false);
        __readerController.changed((isResizing = false));
      }
    }
    dispatch('contentChange', scrollEl);
  }
  function onContentDisplayChange(_calculator: SectionCharacterStatsCalculator) {
    if (
      disposed ||
      _calculator !== calculator ||
      currentSpineIndex < 0 ||
      currentSpineIndex !== sectionIndex$.getValue()
    )
      return;
    const generation = renderGeneration;
    // Initialize the section at the boundary that consumes its geometry. Image
    // readiness can precede the font callback during React binding updates.
    _calculator.updateCurrentSection(sectionIndex$.getValue());
    _calculator.updateParagraphPos();
    __readerController.changed(
      (exploredCharCount = _calculator.calcExploredCharCount(customReadingPointRange))
    );
    sectionReady$.next(_calculator);
    // The parent captures source locations through this element. Publish it on
    // the first completed layout as well as on later font-layout changes; a
    // reader can open Search before the observer has emitted its first change.
    if (scrollEl) dispatch('contentChange', scrollEl);
    if (scrollWhenReady) {
      const generation = renderGeneration;
      bookmarkData.then((data) => {
        if (disposed || generation !== renderGeneration || _calculator !== calculator) return;
        if (!data) {
          __readerController.changed((scrollWhenReady = false));
          return;
        }
        // Use this component's actual owner, not the asynchronously propagated
        // parent binding. Keep restoration pending until its geometry is valid.
        if (!concreteBookmarkManager) return;
        if (concreteBookmarkManager.scrollToBookmark(data)) {
          __readerController.changed((scrollWhenReady = false));
          __readerController.changed((exploredCharCount = data.exploredCharCount || 0));
          __readerController.changed((previousIntendedCount = exploredCharCount));
        }
      });
    } else {
      bookmarkData.then(updateBookmarkScreen);
    }
    if (generation !== renderGeneration || _calculator !== calculator) return;
    __readerController.changed((allowDisplay = true));
    // Consumers may now navigate within this exact mounted occurrence. Never
    // acknowledge a pending chapter using the previous chapter's calculator.
    sectionRenderComplete$.next(currentSpineIndex);
  }
  function updateBookmarkScreen(data: BooksDbBookmarkData | undefined) {
    const bookmarkCharCount = data?.exploredCharCount;
    if (!calculator || !bookmarkCharCount) return;
    const result = calculator.checkBookmarkOnScreen(bookmarkCharCount);
    if (scrollEl && result.isBookmarkScreen) {
      const dimentionAdjustment = Number(
        getComputedStyle(scrollEl)[verticalMode ? 'marginTop' : 'marginRight'].replace(/px$/, '')
      );
      if (!result.bookmarkPos) {
        setDefaultBookmarkPositions(dimentionAdjustment);
      } else if (verticalMode) {
        __readerController.changed(
          (bookmarkTopAdjustment = dimentionAdjustment ? `${dimentionAdjustment}px` : '0.5rem')
        );
        __readerController.changed((bookmarkLeftAdjustment = `${result.bookmarkPos.left}px`));
        __readerController.changed((bookmarkRightAdjustment = undefined));
      } else {
        __readerController.changed((bookmarkTopAdjustment = `${result.bookmarkPos.top}px`));
        __readerController.changed((bookmarkRightAdjustment = undefined));
        __readerController.changed(
          (bookmarkLeftAdjustment =
            result.bookmarkPos.left > 0
              ? `calc(${result.bookmarkPos.left}px - ${$isMobile$ ? '15' : '20'}px)`
              : `calc(${Math.max($isMobile$ ? 15 : 20, dimentionAdjustment)}px)`)
        );
      }
    } else {
      setDefaultBookmarkPositions(0);
    }
    if (result.isBookmarkScreen && data.exploredCharCount) {
      if (result.node && !useExploredCharCount && !result.isFirstNode) {
        updateSectionData(createRange(result.node));
      } else if (result.isFirstNode) {
        updateSectionData(undefined);
      }
      __readerController.changed(
        (exploredCharCount = useExploredCharCount ? exploredCharCount : data.exploredCharCount)
      );
      __readerController.changed((previousIntendedCount = exploredCharCount));
    }
    __readerController.changed((useExploredCharCount = true));
    __readerController.changed((isBookmarkScreen = result.isBookmarkScreen));
  }
  function setDefaultBookmarkPositions(dimensionAdjustment: number) {
    if (verticalMode) {
      __readerController.changed(
        (bookmarkTopAdjustment = dimensionAdjustment ? `${dimensionAdjustment}px` : '0.5rem')
      );
      __readerController.changed(
        (bookmarkLeftAdjustment = $firstDimensionMargin$
          ? `${width - $firstDimensionMargin$}px`
          : undefined)
      );
      __readerController.changed(
        (bookmarkRightAdjustment = $firstDimensionMargin$ ? undefined : '0.75rem')
      );
    } else {
      __readerController.changed(
        (bookmarkTopAdjustment = $firstDimensionMargin$ ? `${$firstDimensionMargin$}px` : '0.5rem')
      );
      __readerController.changed(
        (bookmarkLeftAdjustment = dimensionAdjustment
          ? `calc(${dimensionAdjustment}px + 0.75rem)`
          : '0.75rem')
      );
      __readerController.changed((bookmarkRightAdjustment = undefined));
    }
  }
  function onSwipe(
    ev: CustomEvent<{
      direction: 'top' | 'right' | 'left' | 'bottom' | null;
    }>
  ) {
    if (!concretePageManager || $skipKeyDownListener$ || readerUIOwnsEvent(ev)) return;
    if (ev.detail.direction !== 'left' && ev.detail.direction !== 'right') return;
    const swipeLeft = ev.detail.direction === 'left';
    const nextPage = verticalMode ? !swipeLeft : swipeLeft;
    concretePageManager.flipPage(nextPage ? 1 : -1);
  }
  function onKeydown(ev: KeyboardEvent) {
    if (readerUIOwnsEvent(ev)) return;
    if (
      !concretePageManager ||
      $skipKeyDownListener$ ||
      ev.altKey ||
      ev.ctrlKey ||
      ev.shiftKey ||
      ev.metaKey ||
      ev.repeat
    )
      return;
    switch (ev.code) {
      case 'ArrowLeft':
      case 'KeyA':
        concretePageManager[verticalMode ? 'nextPage' : 'prevPage']();
        break;
      case 'ArrowRight':
      case 'KeyD':
        concretePageManager[verticalMode ? 'prevPage' : 'nextPage']();
        break;
      case 'ArrowUp':
        concretePageManager.prevPage();
        break;
      case 'ArrowDown':
        concretePageManager.nextPage();
        break;
      default:
    }
  }
  nextChapter$.pipe(takeUntil(destroy$)).subscribe((target) => {
    const nextSectionIndex =
      typeof target === 'string'
        ? sections.findIndex(
            (section) => section.id === target || bookFragmentElement(section, target)
          )
        : target.spineIndex;
    if (nextSectionIndex < 0 || nextSectionIndex >= sections.length) return;
    sectionIndex$.next(nextSectionIndex);
    concretePageManager?.scrollTo(0, true);
  });
  /** Reveal a source range after its virtual section has mounted and measured. */
  async function revealLocator(locator: ReaderLocator, bookKey: string): Promise<boolean> {
    const targetIndex = locator.resource.spineIndex;
    if (targetIndex < 0 || targetIndex >= sections.length || disposed) return false;
    if (sectionIndex$.getValue() !== targetIndex) {
      const ready = new Promise<void>((resolve) => {
        sectionReady$.pipe(take(1)).subscribe(() => resolve());
      });
      sectionIndex$.next(targetIndex);
      // The previous resource's virtual page position survives a direct spine
      // switch. Reset it before measuring the newly mounted resource, or a
      // return can calculate its page from the search result's scroll offset.
      concretePageManager?.scrollTo(0, false);
      await ready;
      // Section readiness is published before React commits its display and
      // bookmark-layout updates. Let those settle before accepting the jump.
      await readerTick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!scrollEl || !contentEl || !concretePageManager || disposed) return false;
    const generation = renderGeneration;
    const projected = projectResource(contentEl, locator.resource);
    const position = await resolveLocator(locator, projected, bookKey);
    if (
      !position ||
      disposed ||
      generation !== renderGeneration ||
      sectionIndex$.getValue() !== targetIndex
    )
      return false;
    const range = rangeAt(projected, position.start, position.end);
    if (!range) return false;
    const rect = range.getBoundingClientRect();
    const host = scrollEl.getBoundingClientRect();
    const pageSize = (verticalMode ? height : width) + gap;
    const relative = verticalMode ? rect.top - host.top : rect.left - host.left;
    const target = Math.max(
      0,
      Math.floor((virtualScrollPos$.getValue() + relative) / pageSize) * pageSize
    );
    concretePageManager.scrollTo(target, false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return (
      !disposed &&
      generation === renderGeneration &&
      sectionIndex$.getValue() === targetIndex &&
      (!verticalMode || Math.abs(scrollEl.scrollTop - target) <= 2)
    );
  }
  __readerController.observeSource(
    () => selectionToBookmarkEnabled$,
    (value) => {
      $selectionToBookmarkEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => disableWheelNavigation$,
    (value) => {
      $disableWheelNavigation$ = value;
    }
  );
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  __readerController.observeSource(
    () => isMobile$,
    (value) => {
      $isMobile$ = value;
    }
  );
  __readerController.observeSource(
    () => firstDimensionMargin$,
    (value) => {
      $firstDimensionMargin$ = value;
    }
  );
  __readerController.observeSource(
    () => swipeThreshold$,
    (value) => {
      $swipeThreshold$ = value;
    }
  );
  const api = {
    controller: __readerController,
    getContentElement,
    getDocumentSelection,
    handleAction,
    getTargetSection,
    getTargetScrollPos,
    updateAfterCustomReadingPointUpdate,
    updateSectionData,
    onHtmlLoad,
    triggerContentChange,
    onContentDisplayChange,
    updateBookmarkScreen,
    setDefaultBookmarkPositions,
    onSwipe,
    onKeydown,
    revealLocator,
    get htmlContent() {
      return htmlContent;
    },
    set htmlContent(nextValue: typeof htmlContent) {
      if (Object.is(htmlContent, nextValue)) return;
      htmlContent = nextValue;
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
    get bookmarkData() {
      return bookmarkData;
    },
    set bookmarkData(nextValue: typeof bookmarkData) {
      if (Object.is(bookmarkData, nextValue)) return;
      bookmarkData = nextValue;
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
    get bookmarkManager() {
      return bookmarkManager;
    },
    set bookmarkManager(nextValue: typeof bookmarkManager) {
      if (Object.is(bookmarkManager, nextValue)) return;
      bookmarkManager = nextValue;
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
    get scrollEl() {
      return scrollEl;
    },
    set scrollEl(nextValue: typeof scrollEl) {
      if (Object.is(scrollEl, nextValue)) return;
      scrollEl = nextValue;
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
    get calculator() {
      return calculator;
    },
    set calculator(nextValue: typeof calculator) {
      if (Object.is(calculator, nextValue)) return;
      calculator = nextValue;
      __readerController.invalidate();
    },
    get sections() {
      return sections;
    },
    set sections(nextValue: typeof sections) {
      if (Object.is(sections, nextValue)) return;
      sections = nextValue;
      __readerController.invalidate();
    },
    get concretePageManager() {
      return concretePageManager;
    },
    set concretePageManager(nextValue: typeof concretePageManager) {
      if (Object.is(concretePageManager, nextValue)) return;
      concretePageManager = nextValue;
      __readerController.invalidate();
    },
    get concreteBookmarkManager() {
      return concreteBookmarkManager;
    },
    set concreteBookmarkManager(nextValue: typeof concreteBookmarkManager) {
      if (Object.is(concreteBookmarkManager, nextValue)) return;
      concreteBookmarkManager = nextValue;
      __readerController.invalidate();
    },
    get scrollWhenReady() {
      return scrollWhenReady;
    },
    set scrollWhenReady(nextValue: typeof scrollWhenReady) {
      if (Object.is(scrollWhenReady, nextValue)) return;
      scrollWhenReady = nextValue;
      __readerController.invalidate();
    },
    get allowDisplay() {
      return allowDisplay;
    },
    set allowDisplay(nextValue: typeof allowDisplay) {
      if (Object.is(allowDisplay, nextValue)) return;
      allowDisplay = nextValue;
      __readerController.invalidate();
    },
    get displayedHtml() {
      return displayedHtml;
    },
    set displayedHtml(nextValue: typeof displayedHtml) {
      if (Object.is(displayedHtml, nextValue)) return;
      displayedHtml = nextValue;
      __readerController.invalidate();
    },
    get previousIntendedCount() {
      return previousIntendedCount;
    },
    set previousIntendedCount(nextValue: typeof previousIntendedCount) {
      if (Object.is(previousIntendedCount, nextValue)) return;
      previousIntendedCount = nextValue;
      __readerController.invalidate();
    },
    get useExploredCharCount() {
      return useExploredCharCount;
    },
    set useExploredCharCount(nextValue: typeof useExploredCharCount) {
      if (Object.is(useExploredCharCount, nextValue)) return;
      useExploredCharCount = nextValue;
      __readerController.invalidate();
    },
    get isResizing() {
      return isResizing;
    },
    set isResizing(nextValue: typeof isResizing) {
      if (Object.is(isResizing, nextValue)) return;
      isResizing = nextValue;
      __readerController.invalidate();
    },
    get bookmarkTopAdjustment() {
      return bookmarkTopAdjustment;
    },
    set bookmarkTopAdjustment(nextValue: typeof bookmarkTopAdjustment) {
      if (Object.is(bookmarkTopAdjustment, nextValue)) return;
      bookmarkTopAdjustment = nextValue;
      __readerController.invalidate();
    },
    get bookmarkLeftAdjustment() {
      return bookmarkLeftAdjustment;
    },
    set bookmarkLeftAdjustment(nextValue: typeof bookmarkLeftAdjustment) {
      if (Object.is(bookmarkLeftAdjustment, nextValue)) return;
      bookmarkLeftAdjustment = nextValue;
      __readerController.invalidate();
    },
    get bookmarkRightAdjustment() {
      return bookmarkRightAdjustment;
    },
    set bookmarkRightAdjustment(nextValue: typeof bookmarkRightAdjustment) {
      if (Object.is(bookmarkRightAdjustment, nextValue)) return;
      bookmarkRightAdjustment = nextValue;
      __readerController.invalidate();
    },
    get stopFontLayout() {
      return stopFontLayout;
    },
    set stopFontLayout(nextValue: typeof stopFontLayout) {
      if (Object.is(stopFontLayout, nextValue)) return;
      stopFontLayout = nextValue;
      __readerController.invalidate();
    },
    get currentSectionId() {
      return currentSectionId;
    },
    set currentSectionId(nextValue: typeof currentSectionId) {
      if (Object.is(currentSectionId, nextValue)) return;
      currentSectionId = nextValue;
      __readerController.invalidate();
    },
    get currentSpineIndex() {
      return currentSpineIndex;
    },
    set currentSpineIndex(nextValue: typeof currentSpineIndex) {
      if (Object.is(currentSpineIndex, nextValue)) return;
      currentSpineIndex = nextValue;
      __readerController.invalidate();
    },
    get mountedGeneration() {
      return mountedGeneration;
    },
    set mountedGeneration(nextValue: typeof mountedGeneration) {
      if (Object.is(mountedGeneration, nextValue)) return;
      mountedGeneration = nextValue;
      __readerController.invalidate();
    },
    get disposed() {
      return disposed;
    },
    set disposed(nextValue: typeof disposed) {
      if (Object.is(disposed, nextValue)) return;
      disposed = nextValue;
      __readerController.invalidate();
    },
    get renderGeneration() {
      return renderGeneration;
    },
    set renderGeneration(nextValue: typeof renderGeneration) {
      if (Object.is(renderGeneration, nextValue)) return;
      renderGeneration = nextValue;
      __readerController.invalidate();
    },
    get width$() {
      return width$;
    },
    get height$() {
      return height$;
    },
    get sectionIndex$() {
      return sectionIndex$;
    },
    get pageChange$() {
      return pageChange$;
    },
    get virtualScrollPos$() {
      return virtualScrollPos$;
    },
    get sectionRenderComplete$() {
      return sectionRenderComplete$;
    },
    get sectionReady$() {
      return sectionReady$;
    },
    get currentSection$() {
      return currentSection$;
    },
    get cssClassOverflowHidden() {
      return cssClassOverflowHidden;
    },
    get gap() {
      return gap;
    },
    get destroy$() {
      return destroy$;
    },
    get columnCount() {
      return columnCount;
    },
    set columnCount(nextValue: typeof columnCount) {
      if (Object.is(columnCount, nextValue)) return;
      columnCount = nextValue;
      __readerController.invalidate();
    },
    get $selectionToBookmarkEnabled$() {
      return $selectionToBookmarkEnabled$;
    },
    get $disableWheelNavigation$() {
      return $disableWheelNavigation$;
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    get $isMobile$() {
      return $isMobile$;
    },
    get $firstDimensionMargin$() {
      return $firstDimensionMargin$;
    },
    get $swipeThreshold$() {
      return $swipeThreshold$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('htmlContent' in next) api.htmlContent = next.htmlContent as typeof htmlContent;
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
      if ('bookmarkData' in next) api.bookmarkData = next.bookmarkData as typeof bookmarkData;
      if ('pageManager' in next) api.pageManager = next.pageManager as typeof pageManager;
      if ('bookmarkManager' in next)
        api.bookmarkManager = next.bookmarkManager as typeof bookmarkManager;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('bookCharCount' in next) api.bookCharCount = next.bookCharCount as typeof bookCharCount;
      if ('isBookmarkScreen' in next)
        api.isBookmarkScreen = next.isBookmarkScreen as typeof isBookmarkScreen;
      if ('avoidPageBreak' in next)
        api.avoidPageBreak = next.avoidPageBreak as typeof avoidPageBreak;
      if ('pageColumns' in next) api.pageColumns = next.pageColumns as typeof pageColumns;
      if ('firstDimensionMargin' in next)
        api.firstDimensionMargin = next.firstDimensionMargin as typeof firstDimensionMargin;
      if ('autoBookmark' in next) api.autoBookmark = next.autoBookmark as typeof autoBookmark;
      if ('autoBookmarkTime' in next)
        api.autoBookmarkTime = next.autoBookmarkTime as typeof autoBookmarkTime;
      if ('customReadingPointRange' in next)
        api.customReadingPointRange =
          next.customReadingPointRange as typeof customReadingPointRange;
      if ('showCustomReadingPoint' in next)
        api.showCustomReadingPoint = next.showCustomReadingPoint as typeof showCustomReadingPoint;
    }
  };
  return api;
}
