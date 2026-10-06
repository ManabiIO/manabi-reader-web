/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import {
  Dom,
  SurfaceEvents,
  ReaderScope,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createBookReader, type BookReaderProps } from './book-reader-controller';
import { ViewMode } from '$lib/data/view-mode';
import { BookReaderContinuous } from './continuous';
import { BookReaderFoliatePaginated } from './foliate';
import { BookReaderPaginated } from './paginated';

export function BookReader(props: Partial<BookReaderProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createBookReader(props as BookReaderProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-book-reader">
      {c.showBlurMessage ? (
        <>
          <Dom
            as="div"
            className={['fixed top-12 right-4 z-[1] max-w-[90vw] border p-2']
              .filter(Boolean)
              .join(' ')}
            style={{
              writingMode: 'horizontal-tb',
              color: c.fontColor,
              backgroundColor: c.backgroundColor,
              borderColor: c.fontColor
            }}
          >
            {' The reader is currently blurred due to an external application (e. g. exstatic) '}
          </Dom>
        </>
      ) : null}
      <Dom
        as="div"
        elementRef={(value) => {
          c.$containerEl$ = value;
        }}
        className={[
          'reader-page-frame',
          c.verticalMode && 'vertical-page',
          c.useFoliatePaginator && c.viewMode === ViewMode.Paginated && 'foliate-page'
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {c.viewMode === ViewMode.Continuous ? (
          <>
            <BookReaderContinuous
              htmlContent={c.htmlContent}
              previewNavigationActive={c.previewNavigationActive}
              width={c.$contentViewportWidth$ ?? 0}
              height={c.$contentViewportHeight$ ?? 0}
              verticalMode={c.verticalMode}
              fontFeatureSettings={c.fontFeatureSettings}
              verticalTextOrientation={c.verticalTextOrientation}
              prioritizeReaderStyles={c.prioritizeReaderStyles}
              enableTextJustification={c.enableTextJustification}
              enableTextWrapPretty={c.enableTextWrapPretty}
              fontColor={c.fontColor}
              backgroundColor={c.backgroundColor}
              hintFuriganaFontColor={c.hintFuriganaFontColor}
              hintFuriganaShadowColor={c.hintFuriganaShadowColor}
              fontFamilyGroupOne={c.fontFamilyGroupOne}
              fontFamilyGroupTwo={c.fontFamilyGroupTwo}
              fontWeight={c.fontWeight}
              fontSize={c.fontSize}
              lineHeight={c.lineHeight}
              textIndentation={c.textIndentation}
              textMarginMode={c.textMarginMode}
              textMarginValue={c.textMarginValue}
              hideSpoilerImage={c.hideSpoilerImage}
              hideFurigana={c.hideFurigana}
              furiganaStyle={c.furiganaStyle}
              secondDimensionMaxValue={c.secondDimensionMaxValue}
              firstDimensionMargin={c.firstDimensionMargin}
              autoPositionOnResize={c.autoPositionOnResize}
              autoBookmark={c.autoBookmark}
              autoBookmarkTime={c.autoBookmarkTime}
              multiplier={c.multiplier}
              loadingState={c.$imageLoadingState$ ?? true}
              exploredCharCount={c.exploredCharCount}
              bookCharCount={c.bookCharCount}
              bookmarkData={c.bookmarkData}
              autoScroller={c.autoScroller}
              bookmarkManager={c.bookmarkManager}
              pageManager={c.pageManager}
              customReadingPoint={c.customReadingPoint}
              customReadingPointTop={c.customReadingPointTop}
              customReadingPointLeft={c.customReadingPointLeft}
              customReadingPointScrollOffset={c.customReadingPointScrollOffset}
              events={{
                contentChange: (ev) => c.handleReaderContentChange(ev.detail),
                bookmark: (event) => props.events?.['bookmark']?.(event),
                trackerPause: (event) => props.events?.['trackerPause']?.(event),
                userNavigation: () => c.dispatch('userNavigation')
              }}
              bindings={{
                exploredCharCount: (value) => {
                  c.exploredCharCount = value;
                },
                bookCharCount: (value) => {
                  c.bookCharCount = value;
                },
                bookmarkData: (value) => {
                  c.bookmarkData = value;
                },
                autoScroller: (value) => {
                  c.autoScroller = value;
                },
                bookmarkManager: (value) => {
                  c.bookmarkManager = value;
                },
                pageManager: (value) => {
                  c.pageManager = value;
                },
                customReadingPoint: (value) => {
                  c.customReadingPoint = value;
                },
                customReadingPointTop: (value) => {
                  c.customReadingPointTop = value;
                },
                customReadingPointLeft: (value) => {
                  c.customReadingPointLeft = value;
                },
                customReadingPointScrollOffset: (value) => {
                  c.customReadingPointScrollOffset = value;
                }
              }}
            ></BookReaderContinuous>
          </>
        ) : (
          <>
            {' '}
            {c.useFoliatePaginator && c.publicationManifest ? (
              <>
                <BookReaderFoliatePaginated
                  htmlContent={c.htmlContent}
                  styleSheet={c.styleSheet}
                  epubResources={c.epubResources}
                  publicationManifest={c.publicationManifest}
                  width={c.width}
                  height={c.height}
                  maxInlineSize={c.secondDimensionMaxValue}
                  controlsVisible={c.controlsVisible}
                  verticalMode={c.verticalMode}
                  fontFeatureSettings={c.fontFeatureSettings}
                  verticalTextOrientation={c.verticalTextOrientation}
                  prioritizeReaderStyles={c.prioritizeReaderStyles}
                  enableTextJustification={c.enableTextJustification}
                  enableTextWrapPretty={c.enableTextWrapPretty}
                  fontColor={c.fontColor}
                  backgroundColor={c.backgroundColor}
                  hintFuriganaFontColor={c.hintFuriganaFontColor}
                  hintFuriganaShadowColor={c.hintFuriganaShadowColor}
                  fontFamilyGroupOne={c.fontFamilyGroupOne}
                  fontFamilyGroupTwo={c.fontFamilyGroupTwo}
                  fontWeight={c.fontWeight}
                  fontSize={c.fontSize}
                  lineHeight={c.lineHeight}
                  textIndentation={c.textIndentation}
                  textMarginMode={c.textMarginMode}
                  textMarginValue={c.textMarginValue}
                  hideSpoilerImage={c.hideSpoilerImage}
                  hideFurigana={c.hideFurigana}
                  furiganaStyle={c.furiganaStyle}
                  loadingState={c.$imageLoadingState$ ?? true}
                  avoidPageBreak={c.avoidPageBreak}
                  pageColumns={c.pageColumns}
                  autoBookmark={c.autoBookmark}
                  autoBookmarkTime={c.autoBookmarkTime}
                  firstDimensionMargin={c.firstDimensionMargin}
                  exploredCharCount={c.exploredCharCount}
                  bookCharCount={c.bookCharCount}
                  isBookmarkScreen={c.isBookmarkScreen}
                  bookmarkData={c.bookmarkData}
                  bookmarkManager={c.bookmarkManager}
                  pageManager={c.pageManager}
                  customReadingPointRange={c.customReadingPointRange}
                  showCustomReadingPoint={c.showCustomReadingPoint}
                  events={{
                    pageTurnStart: (event) => props.events?.['pageTurnStart']?.(event),
                    toggleControls: (event) => props.events?.['toggleControls']?.(event),
                    chromeActivity: (event) => props.events?.['chromeActivity']?.(event),
                    contentChange: (ev) => c.handleReaderContentChange(ev.detail),
                    bookmark: (event) => props.events?.['bookmark']?.(event),
                    trackerPause: (event) => props.events?.['trackerPause']?.(event),
                    userNavigation: () => c.dispatch('userNavigation')
                  }}
                  bindings={{
                    this: (value) => {
                      c.foliatePaginatedReader = value;
                    },
                    exploredCharCount: (value) => {
                      c.exploredCharCount = value;
                    },
                    bookCharCount: (value) => {
                      c.bookCharCount = value;
                    },
                    isBookmarkScreen: (value) => {
                      c.isBookmarkScreen = value;
                    },
                    bookmarkData: (value) => {
                      c.bookmarkData = value;
                    },
                    bookmarkManager: (value) => {
                      c.bookmarkManager = value;
                    },
                    pageManager: (value) => {
                      c.pageManager = value;
                    },
                    customReadingPointRange: (value) => {
                      c.customReadingPointRange = value;
                    },
                    showCustomReadingPoint: (value) => {
                      c.showCustomReadingPoint = value;
                    }
                  }}
                ></BookReaderFoliatePaginated>
              </>
            ) : (
              <>
                {' '}
                <BookReaderPaginated
                  htmlContent={c.htmlContent}
                  width={c.$contentViewportWidth$ ?? 0}
                  height={c.$contentViewportHeight$ ?? 0}
                  verticalMode={c.verticalMode}
                  fontFeatureSettings={c.fontFeatureSettings}
                  verticalTextOrientation={c.verticalTextOrientation}
                  prioritizeReaderStyles={c.prioritizeReaderStyles}
                  enableTextJustification={c.enableTextJustification}
                  enableTextWrapPretty={c.enableTextWrapPretty}
                  fontColor={c.fontColor}
                  backgroundColor={c.backgroundColor}
                  hintFuriganaFontColor={c.hintFuriganaFontColor}
                  hintFuriganaShadowColor={c.hintFuriganaShadowColor}
                  fontFamilyGroupOne={c.fontFamilyGroupOne}
                  fontFamilyGroupTwo={c.fontFamilyGroupTwo}
                  fontWeight={c.fontWeight}
                  fontSize={c.fontSize}
                  lineHeight={c.lineHeight}
                  textIndentation={c.textIndentation}
                  textMarginMode={c.textMarginMode}
                  textMarginValue={c.textMarginValue}
                  hideSpoilerImage={c.hideSpoilerImage}
                  hideFurigana={c.hideFurigana}
                  furiganaStyle={c.furiganaStyle}
                  loadingState={c.$imageLoadingState$ ?? true}
                  avoidPageBreak={c.avoidPageBreak}
                  pageColumns={c.pageColumns}
                  autoBookmark={c.autoBookmark}
                  autoBookmarkTime={c.autoBookmarkTime}
                  firstDimensionMargin={c.firstDimensionMargin}
                  exploredCharCount={c.exploredCharCount}
                  bookCharCount={c.bookCharCount}
                  isBookmarkScreen={c.isBookmarkScreen}
                  bookmarkData={c.bookmarkData}
                  bookmarkManager={c.bookmarkManager}
                  pageManager={c.pageManager}
                  customReadingPointRange={c.customReadingPointRange}
                  showCustomReadingPoint={c.showCustomReadingPoint}
                  events={{
                    contentChange: (ev) => c.handleReaderContentChange(ev.detail),
                    bookmark: (event) => props.events?.['bookmark']?.(event),
                    trackerPause: (event) => props.events?.['trackerPause']?.(event),
                    userNavigation: () => c.dispatch('userNavigation')
                  }}
                  bindings={{
                    this: (value) => {
                      c.paginatedReader = value;
                    },
                    exploredCharCount: (value) => {
                      c.exploredCharCount = value;
                    },
                    bookCharCount: (value) => {
                      c.bookCharCount = value;
                    },
                    isBookmarkScreen: (value) => {
                      c.isBookmarkScreen = value;
                    },
                    bookmarkData: (value) => {
                      c.bookmarkData = value;
                    },
                    bookmarkManager: (value) => {
                      c.bookmarkManager = value;
                    },
                    pageManager: (value) => {
                      c.pageManager = value;
                    },
                    customReadingPointRange: (value) => {
                      c.customReadingPointRange = value;
                    },
                    showCustomReadingPoint: (value) => {
                      c.showCustomReadingPoint = value;
                    }
                  }}
                ></BookReaderPaginated>
              </>
            )}
          </>
        )}
      </Dom>
      {c.$blurListener$ ?? ''}
      {c.$reactiveElements$ ?? ''}
      <SurfaceEvents
        target="document"
        bindings={{
          visibilityState: (value) => {
            c.visibilityState = value;
          }
        }}
      ></SurfaceEvents>
    </ReaderScope>
  );
}
