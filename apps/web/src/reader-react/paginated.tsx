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
  AppIcon,
  swipe,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createPaginated, type PaginatedProps } from './paginated-controller';
import { resolveReaderFont } from '$lib/data/reader-typography';
import { FuriganaStyle } from '$lib/data/furigana-style';

const faBookmark = 'faBookmark';
const faSpinner = 'faSpinner';
export function BookReaderPaginated(props: Partial<PaginatedProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createPaginated(props as PaginatedProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-paginated">
      <Dom
        as="div"
        elementRef={(value) => {
          c.scrollEl = value;
        }}
        data-manabi-resource-count={c.sections.length}
        aria-busy={!c.allowDisplay || c.loadingState}
        className={[
          c.avoidPageBreak && 'book-content--avoid-page-break',
          c.verticalMode && 'book-content--writing-vertical-rl',
          !c.verticalMode && 'book-content--writing-horizontal-rl',
          c.hideFurigana && 'book-content--hide-furigana',
          c.hideSpoilerImage && 'book-content--hide-spoiler-image',
          c.furiganaStyle === FuriganaStyle.Hide && 'book-content--furigana-style-hide',
          c.furiganaStyle === FuriganaStyle.Partial && 'book-content--furigana-style-partial',
          c.furiganaStyle === FuriganaStyle.Toggle && 'book-content--furigana-style-toggle',
          c.furiganaStyle === FuriganaStyle.Full && 'book-content--furigana-style-full',
          !!c.fontWeight && 'ttu-apply-font-weight',
          c.prioritizeReaderStyles && 'ttu-apply-important',
          c.enableTextJustification && 'ttu-apply-justification',
          c.textMarginMode === 'manual' && 'ttu-margin-manual',
          c.enableTextWrapPretty && 'ttu-text-wrap-pretty',
          'book-content m-auto'
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          color: c.fontColor,
          fontSize: String(c.fontSize ?? '') + 'px',
          lineHeight: c.lineHeight,
          paddingTop:
            !c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          paddingBottom:
            !c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          paddingLeft:
            c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          paddingRight:
            c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          maxWidth: c.width ? `${c.width}px` : undefined,
          maxHeight: c.verticalMode && c.height ? `${c.height}px` : undefined,
          '--font-family-serif': resolveReaderFont(c.fontFamilyGroupOne, c.verticalMode),
          '--font-family-sans-serif': resolveReaderFont(c.fontFamilyGroupTwo, c.verticalMode, true),
          '--font-weight': c.fontWeight,
          '--book-content-hint-furigana-font-color': c.hintFuriganaFontColor,
          '--book-content-hint-furigana-shadow-color': c.hintFuriganaShadowColor,
          '--book-content-child-width': String(c.width ?? '') + 'px',
          '--book-content-child-height': String(c.height ?? '') + 'px',
          '--book-content-child-column-width':
            !c.verticalMode && c.columnCount === 1 ? `${c.width}px` : '',
          '--book-content-column-count': c.columnCount,
          '--book-content-image-max-width':
            String((c.verticalMode ? c.width : (c.width + c.gap) / c.columnCount - c.gap) ?? '') +
            'px',
          '--book-content-text-margin': String(c.textMarginValue ?? 0) + 'rem',
          '--book-content-text-intendation': String(c.textIndentation ?? 0) + 'rem',
          fontFeatureSettings: c.fontFeatureSettings,
          textOrientation: c.verticalTextOrientation
        }}
        events={{ swipe: c.onSwipe }}
        actions={[
          [swipe, { timeframe: 500, minSwipeDistance: c.$swipeThreshold$, touchAction: 'pan-y' }]
        ]}
      >
        <Dom
          as="div"
          id={c.currentSectionId || null}
          data-manabi-spine-index={c.currentSpineIndex}
          elementRef={(value) => {
            c.contentEl = value;
          }}
          html={c.displayedHtml}
          htmlIdentity={c.mountedGeneration}
          onHtmlLoad={c.onHtmlLoad}
          className={['book-content-container'].filter(Boolean).join(' ')}
        ></Dom>
      </Dom>
      {!c.allowDisplay ? (
        <>
          <Dom
            as="div"
            className={['fixed inset-0 flex h-full w-full items-center justify-center text-7xl']
              .filter(Boolean)
              .join(' ')}
            style={{ color: c.fontColor, backgroundColor: c.backgroundColor }}
          >
            <AppIcon icon={faSpinner} spin={true}></AppIcon>
          </Dom>
        </>
      ) : null}
      {c.isBookmarkScreen ? (
        <>
          <Dom
            as="div"
            className={['fixed h-3 w-3 text-base opacity-25 sm:text-xl'].filter(Boolean).join(' ')}
            style={{
              color: c.fontColor,
              top: c.bookmarkTopAdjustment,
              left: c.bookmarkLeftAdjustment,
              right: c.bookmarkRightAdjustment
            }}
          >
            <AppIcon icon={faBookmark}></AppIcon>
          </Dom>
        </>
      ) : null}
      <SurfaceEvents
        target="window"
        events={{ keydown: c.onKeydown, resize: () => (c.isResizing = true) }}
      ></SurfaceEvents>
    </ReaderScope>
  );
}
