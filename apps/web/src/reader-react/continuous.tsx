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
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createContinuous, type ContinuousProps } from './continuous-controller';
import { resolveReaderFont } from '$lib/data/reader-typography';
import { FuriganaStyle } from '$lib/data/furigana-style';

const faBookmark = 'faBookmark';
const faSpinner = 'faSpinner';
export function BookReaderContinuous(props: Partial<ContinuousProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createContinuous(props as ContinuousProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-continuous">
      <Dom
        as="div"
        elementRef={(value) => {
          c.contentEl = value;
        }}
        aria-busy={!c.allowDisplay || c.loadingState}
        html={c.htmlContent}
        onHtmlLoad={c.onHtmlLoad}
        className={[
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
          maxWidth:
            !c.verticalMode && c.secondDimensionMaxValue
              ? `${c.secondDimensionMaxValue}px`
              : undefined,
          maxHeight: c.maxHeight ? `${c.maxHeight}px` : undefined,
          paddingLeft:
            c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          paddingRight:
            c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          paddingTop:
            !c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          paddingBottom:
            !c.verticalMode && c.firstDimensionMargin ? `${c.firstDimensionMargin}px` : undefined,
          '--font-family-serif': resolveReaderFont(c.fontFamilyGroupOne, c.verticalMode),
          '--font-family-sans-serif': resolveReaderFont(c.fontFamilyGroupTwo, c.verticalMode, true),
          '--font-weight': c.fontWeight,
          '--book-content-hint-furigana-font-color': c.hintFuriganaFontColor,
          '--book-content-hint-furigana-shadow-color': c.hintFuriganaShadowColor,
          '--book-content-child-height': String((c.maxHeight || c.height) ?? '') + 'px',
          '--book-content-text-margin': String(c.textMarginValue ?? 0) + 'rem',
          '--book-content-text-intendation': String(c.textIndentation ?? 0) + 'rem',
          fontFeatureSettings: c.fontFeatureSettings,
          textOrientation: c.verticalTextOrientation
        }}
      ></Dom>
      {c.firstDimensionMargin ? (
        <>
          <Dom
            as="div"
            styleText={
              String(c.fullLengthDimension ?? '') +
              ': 100%; ' +
              String(c.modifyingDimension ?? '') +
              ': ' +
              String(c.firstDimensionMargin ?? '') +
              'px; ' +
              String(c.boundSide[0] ?? '') +
              ': 0'
            }
            className={[
              'fixed z-[5]',
              c.verticalMode && 'inset-y-0',
              !c.verticalMode && 'inset-x-0'
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ backgroundColor: c.backgroundColor }}
          ></Dom>
          <Dom
            as="div"
            styleText={
              String(c.fullLengthDimension ?? '') +
              ': 100%; ' +
              String(c.modifyingDimension ?? '') +
              ': ' +
              String(c.firstDimensionMargin ?? '') +
              'px; ' +
              String(c.boundSide[1] ?? '') +
              ': 0'
            }
            className={[
              'fixed z-[5]',
              c.verticalMode && 'inset-y-0',
              !c.verticalMode && 'inset-x-0'
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ backgroundColor: c.backgroundColor }}
          ></Dom>
        </>
      ) : null}
      {c.bookmarkPos ? (
        <>
          {c.verticalMode ? (
            <>
              <Dom
                as="div"
                className={['pointer-events-none absolute text-xl opacity-25']
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  color: c.fontColor,
                  right: `calc(${c.bookmarkPos.right} + 1rem)`,
                  top: c.bookmarkAdjustment
                }}
              >
                <AppIcon icon={faBookmark}></AppIcon>
              </Dom>
            </>
          ) : (
            <>
              {' '}
              <Dom
                as="div"
                className={['pointer-events-none absolute text-sm opacity-25 sm:text-xl']
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  color: c.fontColor,
                  left: c.bookmarkAdjustment,
                  top: `calc(${c.bookmarkPos.top} + 1.5rem)`
                }}
              >
                <AppIcon icon={faBookmark}></AppIcon>
              </Dom>
            </>
          )}
        </>
      ) : null}
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
      <SurfaceEvents
        target="body"
        events={{
          wheel: c.onWheel,
          mousedown: (e) => {
            if (c.$disableWheelNavigation$ && e.button === 1) {
              e.preventDefault();
            }
          }
        }}
      ></SurfaceEvents>
      <SurfaceEvents
        target="window"
        events={{
          scroll: c.onScroll,
          resize: () => {
            if (c.autoPositionOnResize) {
              c.isResizeScroll = true;
            }
          }
        }}
      ></SurfaceEvents>
    </ReaderScope>
  );
}
