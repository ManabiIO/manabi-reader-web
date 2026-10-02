/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readerUIOwnsEvent } from '$lib/functions/reader-ui-events';
import { browser } from '../runtime/environment';
import {
  nextChapter$,
  sectionList$,
  sectionProgress$,
  type SectionWithProgress
} from '$lib/components/book-reader/book-toc/book-toc';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import { observeReaderFontLayout } from '$lib/functions/reader-font-layout';
import { FuriganaStyle } from '$lib/data/furigana-style';
import {
  customReadingPointEnabled$,
  disableWheelNavigation$,
  skipKeyDownListener$
} from '$lib/data/store';
import type { TextMarginMode } from '$lib/data/text-margin-mode';
import { prependValue } from '$lib/functions/file-loaders/epub/generate-epub-html';
import { getReferencePoints } from '$lib/functions/range-util';
import { getExternalTargetElement } from '$lib/functions/utils';
import {
  animationFrameScheduler,
  combineLatest,
  debounce,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  fromEvent,
  map,
  observeOn,
  skip,
  Subject,
  switchMap,
  take,
  takeUntil,
  timer
} from 'rxjs';
import type {
  AutoScroller,
  BookmarkManager,
  PageManager
} from '../lib/components/book-reader/types';
import { AutoScrollerContinuous } from '../lib/components/book-reader/book-reader-continuous/auto-scroller-continuous';
import {
  BookmarkManagerContinuous,
  type BookmarkPosData
} from '../lib/components/book-reader/book-reader-continuous/bookmark-manager-continuous';
import { CharacterStatsCalculator } from '../lib/components/book-reader/book-reader-continuous/character-stats-calculator';
import { horizontalMouseWheel } from '../lib/components/book-reader/book-reader-continuous/horizontal-mouse-wheel';
import { PageManagerContinuous } from '../lib/components/book-reader/book-reader-continuous/page-manager-continuous';
import { ReaderController, type StoreValue } from './controller';
export interface ContinuousProps {
  htmlContent: string;
  previewNavigationActive?: boolean;
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
  secondDimensionMaxValue: number;
  firstDimensionMargin: number;
  autoPositionOnResize: boolean;
  autoBookmark: boolean;
  autoBookmarkTime: number;
  loadingState: boolean;
  multiplier: number;
  bookmarkData: Promise<BooksDbBookmarkData | undefined>;
  exploredCharCount: number;
  bookCharCount: number;
  autoScroller: AutoScroller | undefined;
  bookmarkManager: BookmarkManager | undefined;
  pageManager: PageManager | undefined;
  customReadingPoint: number;
  customReadingPointLeft: number;
  customReadingPointTop: number;
  customReadingPointScrollOffset: number;
}

export function createContinuous(
  props: ContinuousProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let fullLengthDimension: 'height' | 'width';
  let modifyingDimension: 'width' | 'height';
  let boundSide: readonly ['left', 'right'] | readonly ['top', 'bottom'];
  let maxHeight: number | undefined;
  let $customReadingPointEnabled$: StoreValue<typeof customReadingPointEnabled$> =
    __readerController.read(customReadingPointEnabled$);
  let $disableWheelNavigation$: StoreValue<typeof disableWheelNavigation$> =
    __readerController.read(disableWheelNavigation$);
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let htmlContent: string = props.htmlContent;
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
  let secondDimensionMaxValue: number = props.secondDimensionMaxValue;
  let firstDimensionMargin: number = props.firstDimensionMargin;
  let autoPositionOnResize: boolean = props.autoPositionOnResize;
  let autoBookmark: boolean = props.autoBookmark;
  let autoBookmarkTime: number = props.autoBookmarkTime;
  let loadingState: boolean = props.loadingState;
  let multiplier: number = props.multiplier;
  let bookmarkData: Promise<BooksDbBookmarkData | undefined> = props.bookmarkData;
  let exploredCharCount: number = props.exploredCharCount;
  let bookCharCount: number = props.bookCharCount;
  let autoScroller: AutoScroller | undefined = props.autoScroller;
  let bookmarkManager: BookmarkManager | undefined = props.bookmarkManager;
  let pageManager: PageManager | undefined = props.pageManager;
  let customReadingPoint: number = props.customReadingPoint;
  let customReadingPointLeft: number = props.customReadingPointLeft;
  let customReadingPointTop: number = props.customReadingPointTop;
  let customReadingPointScrollOffset: number = props.customReadingPointScrollOffset;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let allowDisplay = false;
  let contentEl: HTMLElement | undefined;
  let calculator: CharacterStatsCalculator | undefined;
  let contentReadyEvent = {};
  let autoScrollerConcrete: AutoScrollerContinuous | undefined;
  let bookmarkManagerConcrete: BookmarkManagerContinuous | undefined;
  let pageManagerConcrete: PageManagerContinuous | undefined;
  let bookmarkPos: BookmarkPosData | undefined;
  let scrollWhenReady: boolean;
  let prevIntendedCharCount = 0;
  let isResizeScroll = false;
  let bookmarkAdjustment = window.matchMedia('(min-width: 640px)').matches ? '0.5rem' : '0.25rem';
  let stopFontLayout: (() => void) | undefined;
  const scrollFn = browser
    ? horizontalMouseWheel(4, document.documentElement, requestAnimationFrame)
    : () => 0;
  const width$ = new Subject<number>();
  const height$ = new Subject<number>();
  const destroy$ = new Subject<void>();
  const sectionToElement = new Map<string, HTMLElement>();
  const sectionData = new Map<string, SectionWithProgress>();
  let scrollAdjustment = 0;
  let willNavigate = false;
  __readerController.effect(
    () => [verticalMode],
    () => {
      __readerController.changed((fullLengthDimension = verticalMode ? 'height' : 'width'));
    }
  );
  __readerController.effect(
    () => [verticalMode],
    () => {
      __readerController.changed((modifyingDimension = verticalMode ? 'width' : 'height'));
    }
  );
  __readerController.effect(
    () => [verticalMode],
    () => {
      __readerController.changed(
        (boundSide = verticalMode ? (['left', 'right'] as const) : (['top', 'bottom'] as const))
      );
    }
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
  __readerController.effect(
    () => [verticalMode, secondDimensionMaxValue],
    () => {
      __readerController.changed(
        (maxHeight = verticalMode && secondDimensionMaxValue ? secondDimensionMaxValue : undefined)
      );
    }
  );
  __readerController.effect(
    () => [secondDimensionMaxValue, contentEl, verticalMode],
    () => {
      if (secondDimensionMaxValue && contentEl) {
        const dimensionAdjustment = Number(
          getComputedStyle(contentEl)[verticalMode ? 'marginTop' : 'marginRight'].replace(/px$/, '')
        );
        __readerController.changed(
          (bookmarkAdjustment = `min(max(calc(${`${dimensionAdjustment}px - ${bookmarkAdjustment}`}), ${bookmarkAdjustment}), ${dimensionAdjustment ? `${dimensionAdjustment}px` : bookmarkAdjustment})`)
        );
      }
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
    () => [calculator, width, height, loadingState],
    () => {
      if (calculator && width && height && !loadingState) {
        const c = calculator;
        requestAnimationFrame(() => {
          onContentDisplayChange(c);
        });
      }
    }
  );
  __readerController.effect(
    () => [autoScrollerConcrete, multiplier, verticalMode],
    () => {
      if (autoScrollerConcrete) {
        __readerController.changed((autoScrollerConcrete.multiplier = multiplier));
        __readerController.changed((autoScrollerConcrete.verticalMode = verticalMode));
      }
    }
  );
  __readerController.effect(
    () => [calculator, firstDimensionMargin],
    () => {
      if (browser && calculator) {
        __readerController.changed(
          (bookmarkManagerConcrete =
            browser &&
            calculator &&
            new BookmarkManagerContinuous(calculator, window, firstDimensionMargin || 0))
        );
        __readerController.changed((bookmarkManager = bookmarkManagerConcrete));
      }
    }
  );
  __readerController.effect(
    () => [contentReadyEvent, bookmarkData, bookmarkManagerConcrete],
    () => {
      if (contentReadyEvent) {
        __readerController.changed((bookmarkPos = undefined));
        bookmarkData.then((data) => {
          if (!data) return;
          __readerController.changed(
            (bookmarkPos = bookmarkManagerConcrete?.getBookmarkBarPosition(data))
          );
        });
      }
    }
  );
  __readerController.effect(
    () => [verticalMode, firstDimensionMargin],
    () => {
      if (browser) {
        __readerController.changed(
          (pageManagerConcrete = new PageManagerContinuous(
            verticalMode,
            firstDimensionMargin,
            window
          ))
        );
        __readerController.changed((pageManager = pageManagerConcrete));
      }
    }
  );
  __readerController.effect(
    () => [$customReadingPointEnabled$, contentEl, customReadingPoint],
    () => {
      if ($customReadingPointEnabled$ && contentEl && Number.isFinite(customReadingPoint)) {
        updateCustomReadingPointPosition();
        onScroll();
        updateSectionProgress();
      }
    }
  );
  /** Experimental Code - May be removed any time without warning */
  __readerController.onMount(() => document.addEventListener('ttu-action', handleAction, false));
  function handleAction({ detail }: any) {
    if (!detail.type) {
      return;
    }
    if (detail.type === 'cue') {
      const { scroll, rect } = needScroll(detail.selector, detail.scrollMode);
      if (!scroll) {
        return;
      }
      __readerController.changed((willNavigate = true));
      if (verticalMode) {
        window.scrollBy({
          left: -(
            window.innerWidth -
            rect.right -
            (firstDimensionMargin || 0) -
            customReadingPointScrollOffset -
            (!customReadingPointScrollOffset ||
            (customReadingPointScrollOffset && scrollAdjustment > customReadingPointScrollOffset)
              ? scrollAdjustment
              : 0)
          ),
          top: 0,
          behavior: detail.scrollBehavior || 'instant'
        });
      } else {
        window.scrollBy({
          left: 0,
          top:
            rect.top -
            (firstDimensionMargin || 0) -
            customReadingPointScrollOffset -
            (!customReadingPointScrollOffset ||
            (customReadingPointScrollOffset && scrollAdjustment > customReadingPointScrollOffset)
              ? scrollAdjustment
              : 0),
          behavior: detail.scrollBehavior || 'instant'
        });
      }
    } else if (
      detail.type === 'pauseTracker' &&
      needScroll(detail.selector, detail.scrollMode).scroll
    ) {
      dispatch('trackerPause');
    }
  }
  function needScroll(selector: string, scrollMode: string) {
    const targetElement = getExternalTargetElement(document, selector, !verticalMode);
    if (!targetElement || !contentEl) {
      return { scroll: false, rect: { top: 0, right: 0, bottom: 0, left: 0 } };
    }
    const rect = targetElement.getBoundingClientRect();
    if (!scrollMode || scrollMode === 'Always') {
      return { scroll: true, rect };
    }
    const footerElement = verticalMode ? null : document.getElementById('ttu-page-footer');
    const {
      elTopReferencePoint,
      elLeftReferencePoint,
      elBottomReferencePoint,
      elRightReferencePoint
    } = getReferencePoints(
      window,
      contentEl,
      verticalMode,
      firstDimensionMargin,
      !verticalMode && footerElement
        ? Number.parseFloat(getComputedStyle(footerElement).height.replace('px', ''))
        : 0
    );
    if (verticalMode) {
      return {
        scroll: rect.left <= elLeftReferencePoint || rect.right >= elRightReferencePoint,
        rect
      };
    }
    return {
      scroll: rect.top <= elTopReferencePoint || rect.bottom >= elBottomReferencePoint,
      rect
    };
  }
  /** Experimental Code - May be removed any time without warning */
  __readerController.onDestroy(() => {
    stopFontLayout?.();
    document.removeEventListener('ttu-action', handleAction, false);
    destroy$.next();
    destroy$.complete();
  });
  if (browser) {
    __readerController.changed(
      (autoScrollerConcrete = new AutoScrollerContinuous(
        multiplier,
        verticalMode,
        destroy$,
        document
      ))
    );
    __readerController.changed((autoScroller = autoScrollerConcrete));
  }
  function layoutScrollPosition(): number | undefined {
    if (!calculator) return undefined;
    const currentScroll = verticalMode ? window.scrollX : window.scrollY;
    let intendedCharCount = prevIntendedCharCount;
    // Opening a modal can resize visualViewport without a user navigation.
    // Chromium may deliver that before the next scroll frame has captured the
    // reader's intended character. Never translate a stale zero into scrollTo(0).
    if (!intendedCharCount && Math.abs(currentScroll) > 0.5) {
      const currentCharCount = calculator.calcExploredCharCount(customReadingPointScrollOffset);
      if (!currentCharCount) return currentScroll;
      intendedCharCount = currentCharCount;
      __readerController.changed((prevIntendedCharCount = currentCharCount));
      __readerController.changed((exploredCharCount = currentCharCount));
    }
    return (
      calculator.getScrollPosByCharCount(intendedCharCount) +
      (verticalMode ? customReadingPointScrollOffset : -customReadingPointScrollOffset)
    );
  }
  combineLatest([width$, height$])
    .pipe(
      filter(() => autoPositionOnResize),
      skip(1),
      map(([w, h]) => (verticalMode ? h : w)),
      distinctUntilChanged(),
      debounceTime(10),
      observeOn(animationFrameScheduler),
      takeUntil(destroy$)
    )
    .subscribe(() => {
      if (!pageManagerConcrete) return;
      const scrollPos = layoutScrollPosition();
      if (scrollPos === undefined) return;
      const currentScroll = verticalMode ? window.scrollX : window.scrollY;
      if (Math.abs(currentScroll - scrollPos) <= 0.5) return;
      __readerController.changed((isResizeScroll = true));
      pageManagerConcrete.scrollTo(scrollPos);
    });
  function updateCustomReadingPointPosition() {
    if (!$customReadingPointEnabled$ || !contentEl) {
      return;
    }
    const {
      elLeftReferencePoint,
      elTopReferencePoint,
      elRightReferencePoint,
      elBottomReferencePoint,
      firstDimensionMargin: firstDimensionMarginValue,
      pointGap
    } = getReferencePoints(window, contentEl, verticalMode, firstDimensionMargin);
    if (verticalMode) {
      __readerController.changed((customReadingPointTop = elTopReferencePoint));
      __readerController.changed(
        (customReadingPointLeft = Math.min(
          Math.max(
            firstDimensionMarginValue +
              (elRightReferencePoint - elLeftReferencePoint) * (customReadingPoint / 100) -
              2,
            elLeftReferencePoint + pointGap
          ),
          elRightReferencePoint - 2
        ))
      );
      __readerController.changed(
        (customReadingPointScrollOffset =
          window.innerWidth - firstDimensionMarginValue - customReadingPointLeft)
      );
      return;
    }
    __readerController.changed(
      (customReadingPointTop = Math.min(
        Math.max(
          firstDimensionMarginValue +
            (elBottomReferencePoint - elTopReferencePoint) * (customReadingPoint / 100),
          firstDimensionMarginValue
        ),
        elBottomReferencePoint - pointGap * 1.5
      ))
    );
    __readerController.changed((customReadingPointLeft = elLeftReferencePoint));
    __readerController.changed(
      (customReadingPointScrollOffset = customReadingPointTop - firstDimensionMarginValue)
    );
  }
  function onContentDisplayChange(_calculator: CharacterStatsCalculator) {
    _calculator.updateParagraphPos();
    updateCustomReadingPointPosition();
    __readerController.changed(
      (exploredCharCount = _calculator.calcExploredCharCount(customReadingPointScrollOffset))
    );
    if (scrollWhenReady) {
      __readerController.changed((scrollWhenReady = false));
      bookmarkData
        .then((data) => {
          if (__readerController.disposed || !data || !bookmarkManager) {
            return;
          }
          __readerController.changed((prevIntendedCharCount = data.exploredCharCount || 0));
          bookmarkManager.scrollToBookmark(data, customReadingPointScrollOffset);
        })
        .finally(() => {
          if (__readerController.disposed) return;
          if (autoBookmark) {
            fromEvent(window, 'scroll')
              .pipe(skip(1), debounceTime(autoBookmarkTime * 1000), takeUntil(destroy$))
              .subscribe(() => {
                dispatch('bookmark');
              });
          }
          sectionList$
            .pipe(
              take(1),
              switchMap((sections) => {
                if (!sections.length) {
                  return EMPTY;
                }
                sections.forEach((section) => {
                  const ref = section.reference;
                  const elm = document.getElementById(ref);
                  if (elm) {
                    if (!scrollAdjustment) {
                      __readerController.changed(
                        (scrollAdjustment =
                          Number(
                            getComputedStyle(elm)[
                              verticalMode ? 'marginLeft' : 'marginBottom'
                            ].replace(/px$/, '')
                          ) / 2)
                      );
                    }
                    sectionData.set(ref, { ...section, progress: 0 });
                    sectionToElement.set(ref, elm);
                  }
                });
                if (sectionToElement.size) {
                  updateSectionProgress();
                  return fromEvent(window, 'scroll');
                }
                return EMPTY;
              }),
              debounce(() => timer(willNavigate ? 100 : 500)),
              takeUntil(destroy$)
            )
            .subscribe(updateSectionProgress);
        });
    }
    __readerController.changed((contentReadyEvent = {}));
    __readerController.changed((allowDisplay = true));
  }
  function updateSectionProgress() {
    const entries = [...sectionData.entries()];
    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [ref, entry] = entries[index];
      const elm = sectionToElement.get(ref) as HTMLElement;
      const rect = elm.getBoundingClientRect();
      entry.progress = verticalMode
        ? (Math.min(
            Math.max(
              rect.right +
                (firstDimensionMargin || 0) -
                window.innerWidth +
                customReadingPointScrollOffset,
              0
            ),
            rect.width
          ) /
            (rect.width || 1)) *
          100
        : (Math.abs(
            Math.min(
              Math.max(
                rect.top - (firstDimensionMargin || 0) - customReadingPointScrollOffset,
                -rect.height
              ),
              0
            )
          ) /
            (rect.height || 1)) *
          100;
      sectionData.set(ref, entry);
    }
    __readerController.changed((willNavigate = false));
    sectionProgress$.next(sectionData);
  }
  function onWheel(ev: WheelEvent) {
    if (!readerUIOwnsEvent(ev) && (ev.deltaX || ev.deltaY)) dispatch('userNavigation');
    if (
      verticalMode &&
      !$disableWheelNavigation$ &&
      !$skipKeyDownListener$ &&
      !readerUIOwnsEvent(ev)
    ) {
      scrollFn(ev, fontSize, window.innerWidth);
    }
  }
  function onScroll() {
    requestAnimationFrame(() => {
      if (!calculator) return;
      __readerController.changed(
        (exploredCharCount = calculator.calcExploredCharCount(customReadingPointScrollOffset))
      );
      if (!isResizeScroll && exploredCharCount) {
        __readerController.changed((prevIntendedCharCount = exploredCharCount));
      }
      __readerController.changed((isResizeScroll = false));
    });
  }
  function onHtmlLoad() {
    if (!contentEl) return;
    __readerController.changed(
      (calculator = new CharacterStatsCalculator(
        contentEl,
        verticalMode ? 'vertical' : 'horizontal',
        verticalMode ? 'rtl' : 'ltr',
        document.documentElement,
        document
      ))
    );
    __readerController.changed((exploredCharCount = 0));
    __readerController.changed((prevIntendedCharCount = exploredCharCount));
    __readerController.changed((bookCharCount = calculator.charCount));
    stopFontLayout?.();
    __readerController.changed(
      (stopFontLayout = observeReaderFontLayout(contentEl, () => {
        if (!contentEl || !calculator) return;
        const currentScroll = verticalMode ? window.scrollX : window.scrollY;
        const previousTarget = previewNavigationActive ? undefined : layoutScrollPosition();
        calculator.updateParagraphPos();
        updateCustomReadingPointPosition();
        // A font load must not restore the saved reading position over a search,
        // scrubber or annotation preview. Those jumps own their source locator.
        if (previewNavigationActive) {
          if (sectionToElement.size) updateSectionProgress();
          dispatch('contentChange', contentEl);
          return;
        }
        if (pageManagerConcrete && !scrollWhenReady) {
          const nextTarget = layoutScrollPosition();
          // Keep the reader's exact offset within its current paragraph. Font
          // reflow moves that paragraph by the difference between the old and
          // new targets; an unchanged layout must not quantize a 1627px scroll
          // back to the paragraph's 1624px boundary when a dialog opens.
          const scrollPos =
            previousTarget === undefined || nextTarget === undefined
              ? nextTarget
              : currentScroll + nextTarget - previousTarget;
          if (scrollPos !== undefined && Math.abs(currentScroll - scrollPos) > 0.5) {
            __readerController.changed((isResizeScroll = true));
            pageManagerConcrete.scrollTo(scrollPos);
          } else {
            __readerController.changed(
              (exploredCharCount = calculator.calcExploredCharCount(customReadingPointScrollOffset))
            );
          }
        } else {
          __readerController.changed(
            (exploredCharCount = calculator.calcExploredCharCount(customReadingPointScrollOffset))
          );
        }
        if (sectionToElement.size) updateSectionProgress();
        dispatch('contentChange', contentEl);
      }))
    );
  }
  nextChapter$.pipe(takeUntil(destroy$)).subscribe((target) => {
    let targetElement: Element | null;
    if (typeof target === 'string') {
      targetElement = document.getElementById(target);
      if (!targetElement) return;
      if (!target.startsWith(prependValue)) {
        targetElement = targetElement.closest(`div[id^="${prependValue}"]`) || targetElement;
      }
    } else {
      const section = contentEl?.children.item(target.spineIndex);
      if (!section) return;
      targetElement = target.fragment
        ? section.querySelector(`[id="${CSS.escape(target.fragment)}"]`)
        : section;
      if (!targetElement) return;
    }
    __readerController.changed((willNavigate = true));
    const rect = targetElement.getBoundingClientRect();
    if (verticalMode) {
      window.scrollBy(
        -(
          window.innerWidth -
          rect.right -
          (firstDimensionMargin || 0) -
          customReadingPointScrollOffset -
          (!customReadingPointScrollOffset ||
          (customReadingPointScrollOffset && scrollAdjustment > customReadingPointScrollOffset)
            ? scrollAdjustment
            : 0)
        ),
        0
      );
    } else {
      window.scrollBy(
        0,
        rect.top -
          (firstDimensionMargin || 0) -
          customReadingPointScrollOffset -
          (!customReadingPointScrollOffset ||
          (customReadingPointScrollOffset && scrollAdjustment > customReadingPointScrollOffset)
            ? scrollAdjustment
            : 0)
      );
    }
  });
  __readerController.observeSource(
    () => customReadingPointEnabled$,
    (value) => {
      $customReadingPointEnabled$ = value;
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
  const api = {
    controller: __readerController,
    handleAction,
    needScroll,
    layoutScrollPosition,
    updateCustomReadingPointPosition,
    onContentDisplayChange,
    updateSectionProgress,
    onWheel,
    onScroll,
    onHtmlLoad,
    get htmlContent() {
      return htmlContent;
    },
    set htmlContent(nextValue: typeof htmlContent) {
      if (Object.is(htmlContent, nextValue)) return;
      htmlContent = nextValue;
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
    get loadingState() {
      return loadingState;
    },
    set loadingState(nextValue: typeof loadingState) {
      if (Object.is(loadingState, nextValue)) return;
      loadingState = nextValue;
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
    get customReadingPoint() {
      return customReadingPoint;
    },
    set customReadingPoint(nextValue: typeof customReadingPoint) {
      if (Object.is(customReadingPoint, nextValue)) return;
      customReadingPoint = nextValue;
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
    get customReadingPointTop() {
      return customReadingPointTop;
    },
    set customReadingPointTop(nextValue: typeof customReadingPointTop) {
      if (Object.is(customReadingPointTop, nextValue)) return;
      customReadingPointTop = nextValue;
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
    get dispatch() {
      return dispatch;
    },
    get allowDisplay() {
      return allowDisplay;
    },
    set allowDisplay(nextValue: typeof allowDisplay) {
      if (Object.is(allowDisplay, nextValue)) return;
      allowDisplay = nextValue;
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
    get contentReadyEvent() {
      return contentReadyEvent;
    },
    set contentReadyEvent(nextValue: typeof contentReadyEvent) {
      if (Object.is(contentReadyEvent, nextValue)) return;
      contentReadyEvent = nextValue;
      __readerController.invalidate();
    },
    get autoScrollerConcrete() {
      return autoScrollerConcrete;
    },
    set autoScrollerConcrete(nextValue: typeof autoScrollerConcrete) {
      if (Object.is(autoScrollerConcrete, nextValue)) return;
      autoScrollerConcrete = nextValue;
      __readerController.invalidate();
    },
    get bookmarkManagerConcrete() {
      return bookmarkManagerConcrete;
    },
    set bookmarkManagerConcrete(nextValue: typeof bookmarkManagerConcrete) {
      if (Object.is(bookmarkManagerConcrete, nextValue)) return;
      bookmarkManagerConcrete = nextValue;
      __readerController.invalidate();
    },
    get pageManagerConcrete() {
      return pageManagerConcrete;
    },
    set pageManagerConcrete(nextValue: typeof pageManagerConcrete) {
      if (Object.is(pageManagerConcrete, nextValue)) return;
      pageManagerConcrete = nextValue;
      __readerController.invalidate();
    },
    get bookmarkPos() {
      return bookmarkPos;
    },
    set bookmarkPos(nextValue: typeof bookmarkPos) {
      if (Object.is(bookmarkPos, nextValue)) return;
      bookmarkPos = nextValue;
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
    get prevIntendedCharCount() {
      return prevIntendedCharCount;
    },
    set prevIntendedCharCount(nextValue: typeof prevIntendedCharCount) {
      if (Object.is(prevIntendedCharCount, nextValue)) return;
      prevIntendedCharCount = nextValue;
      __readerController.invalidate();
    },
    get isResizeScroll() {
      return isResizeScroll;
    },
    set isResizeScroll(nextValue: typeof isResizeScroll) {
      if (Object.is(isResizeScroll, nextValue)) return;
      isResizeScroll = nextValue;
      __readerController.invalidate();
    },
    get bookmarkAdjustment() {
      return bookmarkAdjustment;
    },
    set bookmarkAdjustment(nextValue: typeof bookmarkAdjustment) {
      if (Object.is(bookmarkAdjustment, nextValue)) return;
      bookmarkAdjustment = nextValue;
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
    get scrollFn() {
      return scrollFn;
    },
    get width$() {
      return width$;
    },
    get height$() {
      return height$;
    },
    get destroy$() {
      return destroy$;
    },
    get sectionToElement() {
      return sectionToElement;
    },
    get sectionData() {
      return sectionData;
    },
    get scrollAdjustment() {
      return scrollAdjustment;
    },
    set scrollAdjustment(nextValue: typeof scrollAdjustment) {
      if (Object.is(scrollAdjustment, nextValue)) return;
      scrollAdjustment = nextValue;
      __readerController.invalidate();
    },
    get willNavigate() {
      return willNavigate;
    },
    set willNavigate(nextValue: typeof willNavigate) {
      if (Object.is(willNavigate, nextValue)) return;
      willNavigate = nextValue;
      __readerController.invalidate();
    },
    get fullLengthDimension() {
      return fullLengthDimension;
    },
    set fullLengthDimension(nextValue: typeof fullLengthDimension) {
      if (Object.is(fullLengthDimension, nextValue)) return;
      fullLengthDimension = nextValue;
      __readerController.invalidate();
    },
    get modifyingDimension() {
      return modifyingDimension;
    },
    set modifyingDimension(nextValue: typeof modifyingDimension) {
      if (Object.is(modifyingDimension, nextValue)) return;
      modifyingDimension = nextValue;
      __readerController.invalidate();
    },
    get boundSide() {
      return boundSide;
    },
    set boundSide(nextValue: typeof boundSide) {
      if (Object.is(boundSide, nextValue)) return;
      boundSide = nextValue;
      __readerController.invalidate();
    },
    get maxHeight() {
      return maxHeight;
    },
    set maxHeight(nextValue: typeof maxHeight) {
      if (Object.is(maxHeight, nextValue)) return;
      maxHeight = nextValue;
      __readerController.invalidate();
    },
    get $customReadingPointEnabled$() {
      return $customReadingPointEnabled$;
    },
    get $disableWheelNavigation$() {
      return $disableWheelNavigation$;
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('htmlContent' in next) api.htmlContent = next.htmlContent as typeof htmlContent;
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
      if ('secondDimensionMaxValue' in next)
        api.secondDimensionMaxValue =
          next.secondDimensionMaxValue as typeof secondDimensionMaxValue;
      if ('firstDimensionMargin' in next)
        api.firstDimensionMargin = next.firstDimensionMargin as typeof firstDimensionMargin;
      if ('autoPositionOnResize' in next)
        api.autoPositionOnResize = next.autoPositionOnResize as typeof autoPositionOnResize;
      if ('autoBookmark' in next) api.autoBookmark = next.autoBookmark as typeof autoBookmark;
      if ('autoBookmarkTime' in next)
        api.autoBookmarkTime = next.autoBookmarkTime as typeof autoBookmarkTime;
      if ('loadingState' in next) api.loadingState = next.loadingState as typeof loadingState;
      if ('multiplier' in next) api.multiplier = next.multiplier as typeof multiplier;
      if ('bookmarkData' in next) api.bookmarkData = next.bookmarkData as typeof bookmarkData;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('bookCharCount' in next) api.bookCharCount = next.bookCharCount as typeof bookCharCount;
      if ('autoScroller' in next) api.autoScroller = next.autoScroller as typeof autoScroller;
      if ('bookmarkManager' in next)
        api.bookmarkManager = next.bookmarkManager as typeof bookmarkManager;
      if ('pageManager' in next) api.pageManager = next.pageManager as typeof pageManager;
      if ('customReadingPoint' in next)
        api.customReadingPoint = next.customReadingPoint as typeof customReadingPoint;
      if ('customReadingPointLeft' in next)
        api.customReadingPointLeft = next.customReadingPointLeft as typeof customReadingPointLeft;
      if ('customReadingPointTop' in next)
        api.customReadingPointTop = next.customReadingPointTop as typeof customReadingPointTop;
      if ('customReadingPointScrollOffset' in next)
        api.customReadingPointScrollOffset =
          next.customReadingPointScrollOffset as typeof customReadingPointScrollOffset;
    }
  };
  return api;
}
