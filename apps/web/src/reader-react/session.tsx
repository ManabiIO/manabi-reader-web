/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import {
  Dom,
  SurfaceEvents,
  ReaderScope,
  Head,
  Icon,
  AppIcon,
  Sheet,
  StyleSheetRenderer,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createSession, type SessionProps } from './session-controller';
import { debounceTime, fromEvent, merge, take, timer } from 'rxjs';
import { effectivePrimaryReaderFont } from '$lib/data/reader-typography';
import { verticalCustomReadingPosition$, horizontalCustomReadingPosition$ } from '$lib/data/store';
import { localProfileUser } from '$lib/manabi/client';
import { readerSourceFormat } from '$lib/reader-source-format';
import {
  isTrackerMenuOpen$,
  isTrackerPaused$
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { tocIsOpen$ } from '$lib/components/book-reader/book-toc/book-toc';
import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
import { PAGE_CHANGE } from '$lib/data/events';
import { StorageDataType } from '$lib/data/storage/storage-types';
import { formatPageTitle } from '$lib/functions/format-page-title';
import { multiClickHandler } from '$lib/functions/multi-click-handler';
import { dummyFn } from '$lib/functions/utils';
import { pulseElement } from '$lib/functions/range-util';
import { BookReaderHeader } from './header';
import { DictionarySetup } from './dictionary';
import { BookReadingTracker } from './tracker';
import { BookReader } from './book-reader';
import { ReaderHighlights } from './highlights';
import { ReaderLineGuide } from './line-guide';
import { ReaderAppearance } from './appearance';
import { ReaderSearch } from './search';
import { ReaderScrubber } from './scrubber';
import { ReaderAnnotations } from './annotations';
import { BookToc } from './chapter';
import { BookReaderImageGallery } from './gallery';
import { BookCompletionConfetti } from './confetti';
import { AudiobookLauncher } from './extras';
const faCloudBolt = 'faCloudBolt';
const faPause = 'faPause';
const faPlay = 'faPlay';
const faSpinner = 'faSpinner';
export function ReaderScreen(props: Partial<SessionProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createSession(props as SessionProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-session">
      <Head>
        <Dom as="title">{formatPageTitle(c.$rawBookData$?.title ?? '')}</Dom>
      </Head>
      {c.$collectReaderImageGallerySpoilerToggles$ ?? ''}
      {c.$handleUpdateImageGalleryPictureSpoilers$ ?? ''}
      <Dom
        as="div"
        aria-hidden={'true'}
        className={['reader-context writing-horizontal-tb', !c.chromeVisible && 'chrome-hidden']
          .filter(Boolean)
          .join(' ')}
        style={{ color: c.$themeOption$?.tooltipTextFontColor }}
      >
        {c.$rawBookData$?.title ?? ''}
      </Dom>
      <Dom
        as="button"
        type={'button'}
        aria-label={c.showHeader ? 'Hide reading controls' : 'Show reading controls'}
        aria-expanded={c.showHeader}
        data-reader-chrome={true}
        data-reader-controls={true}
        className={[
          !c.chromeVisible && 'chrome-hidden',
          'reader-controls fixed z-20 flex size-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm writing-horizontal-tb'
        ]
          .filter(Boolean)
          .join(' ')}
        events={{
          click: () => {
            if (c.showHeader) c.readerChrome?.hide();
            else c.readerChrome?.pin();
          }
        }}
      >
        {c.showHeader ? (
          <>
            <Icon
              name="X"
              aria-hidden={'true'}
              className={['size-5'].filter(Boolean).join(' ')}
            ></Icon>
          </>
        ) : (
          <>
            {' '}
            <Icon
              name="TextAlignLeft"
              aria-hidden={'true'}
              className={['size-5'].filter(Boolean).join(' ')}
            ></Icon>
          </>
        )}
      </Dom>
      {c.showHeader ? (
        <>
          <Dom
            as="div"
            data-reader-chrome={true}
            className={['fixed inset-x-0 top-0 z-20 w-full writing-horizontal-tb']
              .filter(Boolean)
              .join(' ')}
          >
            <BookReaderHeader
              bookTitle={c.$rawBookData$?.title ?? ''}
              hasChapterData={!!c.$sectionData$?.length}
              hasText={!!c.bookCharCount}
              hasCustomReadingPoint={
                !!(
                  (c.$customReadingPointEnabled$ || c.isPaginated) &&
                  ((c.isPaginated && c.customReadingPointRange) ||
                    (!c.isPaginated &&
                      c.customReadingPointLeft > -1 &&
                      c.customReadingPointTop > -1))
                )
              }
              showFullscreenButton={c.fullscreenAvailable}
              fullscreenActive={c.fullscreenActive}
              fullscreenBusy={c.fullscreenBusy}
              autoScrollMultiplier={c.$multiplier$}
              hasBookmarkData={c.hasBookmarkData}
              events={{
                appearanceClick: () => (c.showAppearance = true),
                tocClick: () => {
                  c.pauseTracker();
                  c.hideReaderChrome();
                  tocIsOpen$.next(true);
                },
                jumpClick: c.handleJump,
                searchBookClick: () => {
                  void c.openBookSearch();
                },
                scrubClick: c.openScrubber,
                lineGuideClick: () => {
                  c.hideReaderChrome();
                  c.lineGuideEnabled = !c.lineGuideEnabled;
                },
                completeBook: c.completeBook,
                setCustomReadingPoint: c.handleSetCustomReadingPoint,
                showCustomReadingPoint: () => {
                  c.hideReaderChrome();
                  c.showCustomReadingPoint = true;
                },
                resetCustomReadingPoint: () => {
                  c.hideReaderChrome();
                  if (c.$pauseTrackerOnCustomPointChange$) {
                    c.pauseTracker();
                  }
                  if (c.isPaginated) {
                    c.customReadingPointRange = undefined;
                  } else if (c.$verticalMode$) {
                    verticalCustomReadingPosition$.next(100);
                    c.customReadingPoint = 100;
                  } else {
                    horizontalCustomReadingPosition$.next(0);
                    c.customReadingPoint = 0;
                  }
                  if (c.$pauseTrackerOnCustomPointChange$) {
                    c.restartTrackerAfterCharacterChangeOrTime(1000);
                  }
                },
                fullscreenClick: c.onFullscreenClick,
                bookmarkClick: c.bookmarkPage,
                annotationsClick: c.openAnnotations,
                scrollToBookmarkClick: () => {
                  c.hideReaderChrome();
                  c.scrollToBookmark();
                },
                statisticsClick: () => {
                  if (c.$rawBookData$) {
                    c.$preFilteredTitlesForStatistics$ = new Set([c.$rawBookData$.title]);
                  }
                  c.leaveReader(mergeEntries.STATISTICS.routeId, false);
                },
                readerImageGalleryClick: () => {
                  c.hideReaderChrome();
                  c.showReaderImageGallery = true;
                },
                settingsClick: () => c.leaveReader(mergeEntries.SETTINGS.routeId, false),
                dictionarySetupClick: () => c.dictionarySetup?.show(),
                domainHintClick: c.onDomainHintClick,
                bookManagerClick: () => c.leaveReader(mergeEntries.MANAGE.routeId)
              }}
            ></BookReaderHeader>
          </Dom>
        </>
      ) : null}
      {c.$bookData$ && c.$rawBookData$ ? (
        <>
          <DictionarySetup
            contentReady={!!c.guideContentEl}
            bindings={{
              this: (value) => {
                c.dictionarySetup = value;
              }
            }}
          ></DictionarySetup>
          {c.$statisticsEnabled$ ? (
            <>
              <BookReadingTracker
                bookTitle={c.$rawBookData$.title}
                bookId={c.$rawBookData$.id}
                sectionData={c.$sectionData$}
                frozenPosition={c.frozenPosition}
                exploredCharCount={c.exploredCharCount}
                bookCharCount={c.bookCharCount}
                autoScroller={c.autoScroller}
                blockDataUpdates={c.blockDataUpdates}
                wasTrackerPaused={c.wasTrackerPaused}
                events={{
                  freezeCurrentLocation: c.freezeTrackerPosition,
                  statisticsSaved: () => {
                    if (!c.blockDataUpdates) {
                      c.scheduleReplication(StorageDataType.STATISTICS);
                    }
                  },
                  trackerAvailable: () => (c.showTrackerIcon = true),
                  trackerMenuClosed: () => {
                    if (!c.wasTrackerPaused) {
                      isTrackerPaused$.next(false);
                    }
                    isTrackerMenuOpen$.next(false);
                    c.bookCompleted = false;
                  }
                }}
                bindings={{
                  wasTrackerPaused: (value) => {
                    c.wasTrackerPaused = value;
                  },
                  this: (value) => {
                    c.trackerElm = value;
                  }
                }}
              ></BookReadingTracker>
            </>
          ) : null}
          <StyleSheetRenderer styleSheet={c.$bookData$.styleSheet}></StyleSheetRenderer>
          <BookReader
            sheetPagination={c.foliatePagination}
            controlsVisible={c.showHeader}
            previewNavigationActive={c.navigationPreviewing || c.suppressResumeSave}
            htmlContent={c.$bookData$.htmlContent}
            epubResources={c.$bookData$.epubResources}
            styleSheet={c.$bookData$.styleSheet}
            publicationManifest={c.$rawBookData$.publicationManifest}
            sourceFormat={readerSourceFormat(c.$rawBookData$)}
            width={c.$containerViewportWidth$ ?? 0}
            height={c.$containerViewportHeight$ ?? 0}
            fontFeatureSettings={c.fontFeatureSettings}
            verticalTextOrientation={c.verticalTextOrientation}
            prioritizeReaderStyles={c.$prioritizeReaderStyles$}
            enableTextJustification={c.$enableTextJustification$}
            enableTextWrapPretty={c.$enableTextWrapPretty$}
            verticalMode={c.$verticalMode$}
            fontColor={c.$themeOption$?.fontColor}
            backgroundColor={c.$backgroundColor$}
            hintFuriganaFontColor={c.$themeOption$?.hintFuriganaFontColor}
            hintFuriganaShadowColor={c.$themeOption$?.hintFuriganaShadowColor}
            fontFamilyGroupOne={effectivePrimaryReaderFont(
              c.$fontFamilyGroupOne$,
              c.$yuKyokashoAvailable$
            )}
            fontFamilyGroupTwo={c.$fontFamilyGroupTwo$}
            fontWeight={c.$fontWeight$}
            fontSize={c.$fontSize$}
            lineHeight={c.$lineHeight$}
            textIndentation={c.$textIndentation$}
            textMarginMode={c.$textMarginMode$}
            textMarginValue={c.$textMarginValue$}
            hideSpoilerImage={c.$hideSpoilerImage$}
            hideFurigana={c.$hideFurigana$}
            furiganaStyle={c.$furiganaStyle$}
            viewMode={c.$viewMode$}
            secondDimensionMaxValue={c.$secondDimensionMaxValue$}
            firstDimensionMargin={c.firstDimensionMargin}
            autoPositionOnResize={c.$autoPositionOnResize$}
            avoidPageBreak={c.$avoidPageBreak$}
            pageColumns={c.$pageColumns$}
            autoBookmark={c.$autoBookmark$}
            autoBookmarkTime={c.$autoBookmarkTime$}
            multiplier={c.$multiplier$}
            exploredCharCount={c.exploredCharCount}
            bookCharCount={c.bookCharCount}
            isBookmarkScreen={c.isBookmarkScreen}
            bookmarkData={c.bookmarkData}
            autoScroller={c.autoScroller}
            bookmarkManager={c.bookmarkManager}
            pageManager={c.pageManager}
            customReadingPoint={c.customReadingPoint}
            customReadingPointTop={c.customReadingPointTop}
            customReadingPointLeft={c.customReadingPointLeft}
            customReadingPointScrollOffset={c.customReadingPointScrollOffset}
            customReadingPointRange={c.customReadingPointRange}
            showCustomReadingPoint={c.showCustomReadingPoint}
            events={{
              pageTurnStart: () => {
                c.chromeNavigationRevision++;
                c.hideReaderChrome();
              },
              toggleControls: () => {
                // The page indicator lives in a closed shadow root: invalidate the app-window
                // click candidate so its retargeted click cannot toggle twice.
                c.chromeNavigationRevision++;
                if (c.showHeader) c.readerChrome?.hide();
                else c.readerChrome?.pin();
              },
              chromeActivity: (event) => {
                if (event.detail === 'pointer') c.readerChrome?.pointer();
                else if (event.detail === 'pin') c.readerChrome?.pin();
                else if (event.detail === 'toggle') c.readerChrome?.toggle();
              },
              bookmark: c.saveBookmark,
              trackerPause: () => c.pauseTracker(true),
              selectionChange: (ev) => c.noteReaderSelection(ev.detail),
              userNavigation: () => {
                c.chromeNavigationRevision++;
                c.readerChrome?.reading();
                if (c.readerNavigation.previewing) c.pendingPreviewAdoption = true;
              },
              contentChange: (event) => {
                c.guideContentEl = event.detail;
                c.readerContentEpoch += 1;
                if (c.readerNavigation.previewing && !c.revealingReaderLocator)
                  void c.restorePreviewAfterReflow(c.readerContentEpoch);
              }
            }}
            bindings={{
              this: (value) => {
                c.bookReaderComponent = value;
              },
              sheetPagination: (value) => {
                c.foliatePagination = value;
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
              },
              customReadingPointRange: (value) => {
                c.customReadingPointRange = value;
              },
              showCustomReadingPoint: (value) => {
                c.showCustomReadingPoint = value;
              }
            }}
          ></BookReader>
          {c.librarySearchMessage ? (
            <>
              <Dom
                as="p"
                role={'alert'}
                className={['fixed inset-x-4 top-16 z-50 rounded-xl bg-card p-4 text-foreground']
                  .filter(Boolean)
                  .join(' ')}
              >
                {c.librarySearchMessage}
              </Dom>
            </>
          ) : null}
          <ReaderHighlights
            contentEl={c.guideContentEl}
            annotations={c.annotations}
            active={c.activeSearchLocator}
            bookKey={c.readerBookKey}
            epoch={c.readerContentEpoch}
          ></ReaderHighlights>
          <ReaderLineGuide
            enabled={c.lineGuideEnabled}
            contentEl={c.guideContentEl}
            verticalMode={c.$verticalMode$}
            visibleLines={c.lineGuideLines}
            dimming={c.lineGuideDimming}
            epoch={c.readerContentEpoch}
            bindings={{
              enabled: (value) => {
                c.lineGuideEnabled = value;
              },
              visibleLines: (value) => {
                c.lineGuideLines = value;
              },
              dimming: (value) => {
                c.lineGuideDimming = value;
              }
            }}
          ></ReaderLineGuide>
          {c.$setBackgroundColor$ ?? ''}
          {c.$setWritingMode$ ?? ''}
          {c.$textSelector$ ?? ''}
          {c.$previewAdoption$ ?? ''}
          {c.$replicator$ ?? ''}
          {c.$autoStartTracker$ ?? ''}
        </>
      ) : (
        <> {c.$leaveIfBookMissing$ ?? ''}</>
      )}
      <ReaderAppearance
        open={c.showAppearance}
        events={{ settingsClick: () => c.leaveReader(mergeEntries.SETTINGS.routeId, false) }}
        bindings={{
          open: (value) => {
            c.showAppearance = value;
          }
        }}
      ></ReaderAppearance>
      <ReaderSearch
        open={c.showBookSearch}
        rawHtml={c.$rawBookData$?.elementHtml ?? ''}
        manifest={c.$rawBookData$?.publicationManifest}
        bookKey={c.readerBookKey}
        bookTitle={c.$rawBookData$?.title ?? ''}
        events={{ select: (event) => c.previewLocator(event.detail, 'search') }}
        bindings={{
          open: (value) => {
            c.showBookSearch = value;
          }
        }}
      ></ReaderSearch>
      <ReaderScrubber
        open={c.showScrubber}
        rawHtml={c.$rawBookData$?.elementHtml ?? ''}
        manifest={c.$rawBookData$?.publicationManifest}
        bookKey={c.readerBookKey}
        current={c.scrubberPoint}
        events={{ select: (event) => c.previewLocator(event.detail, 'scrubber') }}
        bindings={{
          open: (value) => {
            c.showScrubber = value;
          }
        }}
      ></ReaderScrubber>
      <ReaderAnnotations
        bookId={c.$rawBookData$?.id ?? 0}
        bookKey={c.readerBookKey}
        open={c.showAnnotations}
        annotations={c.annotations}
        importConflicts={c.annotationImportConflicts}
        hasSelection={c.annotationSelection.length > 0}
        error={c.annotationError}
        status={c.annotationStatus}
        busy={c.annotationBusy}
        savedVersion={c.annotationSavedVersion}
        events={{
          bookmark: () => c.addAnnotation('bookmark'),
          highlight: () => c.addAnnotation('highlight'),
          snippet: () => {
            if (
              !c.snippetCapture?.html ||
              c.snippetCapture.item !== c.readerBookKey ||
              c.snippetCapture.owner !== (localProfileUser()?.id ?? null)
            ) {
              c.annotationError = 'Select the passage again before capturing it.';
              return;
            }
            const captured = c.snippetCapture;
            c.showAnnotations = false;
            window.dispatchEvent(new CustomEvent('manabi-capture-snippet', { detail: captured }));
          },
          note: (event) => c.addAnnotation('note', event.detail),
          openAnnotation: (event) => {
            c.showAnnotations = false;
            void c.previewLocator(event.detail.targets[0], 'annotations');
          },
          remove: (event) => c.removeAnnotation(event.detail),
          export: c.exportAnnotations,
          import: (event) => c.importAnnotations(event.detail),
          resolveImport: (event) => c.resolveImportConflict(event.detail.id, event.detail.choice)
        }}
        bindings={{
          open: (value) => {
            c.showAnnotations = value;
          }
        }}
      ></ReaderAnnotations>
      {c.navigationPreviewing ? (
        <>
          <Dom
            as="div"
            className={[
              'fixed bottom-16 left-4 z-20 flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-sm writing-horizontal-tb'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Dom
              as="button"
              type={'button'}
              className={['min-h-11 rounded-full px-3 text-sm font-medium']
                .filter(Boolean)
                .join(' ')}
              events={{ click: c.returnToReadingPoint }}
            >
              {'Return to where I was'}
            </Dom>
            <Dom
              as="button"
              type={'button'}
              className={['min-h-11 rounded-full px-3 text-sm text-muted-foreground']
                .filter(Boolean)
                .join(' ')}
              events={{ click: c.continueAtPreview }}
            >
              {'Continue Here'}
            </Dom>
          </Dom>
        </>
      ) : null}
      <Sheet.Root
        open={c.$tocIsOpen$}
        onOpenChange={(open) => {
          if (!open) {
            if (c.$statisticsEnabled$ && !c.wasTrackerPaused) isTrackerPaused$.next(false);
            tocIsOpen$.next(false);
          }
        }}
      >
        <Sheet.Content
          side={'left'}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLButtonElement>('[aria-label="Show reading controls"]')
              ?.focus();
          }}
          className={['writing-horizontal-tb data-[side=left]:w-full data-[side=left]:sm:max-w-md']
            .filter(Boolean)
            .join(' ')}
        >
          <Sheet.Title className={['sr-only'].filter(Boolean).join(' ')}>
            {'Table of contents'}
          </Sheet.Title>
          <Sheet.Description className={['sr-only'].filter(Boolean).join(' ')}>
            {'Chapter navigation and reading progress.'}
          </Sheet.Description>
          {c.$sectionData$ ? (
            <>
              <BookToc
                bookTitle={c.$rawBookData$?.title ?? ''}
                sectionData={c.$sectionData$}
                verticalMode={c.$verticalMode$}
                exploredCharCount={c.exploredCharCount}
                wasTrackerPaused={c.wasTrackerPaused}
              ></BookToc>
            </>
          ) : null}
        </Sheet.Content>
      </Sheet.Root>
      {c.showReaderImageGallery ? (
        <>
          <BookReaderImageGallery
            events={{ close: () => (c.showReaderImageGallery = false) }}
          ></BookReaderImageGallery>
        </>
      ) : null}
      {(c.isSelectingCustomReadingPoint && !c.$isMobile$) ||
      (!c.isPaginated && c.showCustomReadingPoint) ? (
        <>
          <Dom
            as="div"
            className={['fixed left-0 z-20 h-[1px] w-full border border-red-500']
              .filter(Boolean)
              .join(' ')}
            style={{ top: `${c.customReadingPointTop}px` }}
          ></Dom>
          <Dom
            as="div"
            className={['fixed top-0 z-20 h-full w-[1px] border border-red-500']
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${c.customReadingPointLeft}px` }}
          ></Dom>
        </>
      ) : null}
      {c.$enableTapEdgeToFlip$ && c.isPaginated && !c.$skipKeyDownListener$ ? (
        <>
          <Dom
            as="button"
            aria-label={c.$verticalMode$ ? 'Next page' : 'Previous page'}
            className={['fixed left-0 z-10 w-5'].filter(Boolean).join(' ')}
            style={{ height: c.tapButtonHeight, top: c.tapButtonTop }}
            events={{
              click: c.$verticalMode$
                ? () => c.pageManager?.nextPage()
                : () => c.pageManager?.prevPage()
            }}
          ></Dom>
          <Dom
            as="button"
            aria-label={c.$verticalMode$ ? 'Previous page' : 'Next page'}
            className={['fixed right-0 z-10 w-5'].filter(Boolean).join(' ')}
            style={{ height: c.tapButtonHeight, top: c.tapButtonTop }}
            events={{
              click: c.$verticalMode$
                ? () => c.pageManager?.prevPage()
                : () => c.pageManager?.nextPage()
            }}
          ></Dom>
        </>
      ) : null}
      {c.showSpinner ? (
        <>
          <Dom
            as="div"
            className={['fixed inset-0 flex h-full w-full items-center justify-center text-7xl']
              .filter(Boolean)
              .join(' ')}
          >
            <AppIcon icon={faSpinner} spin={true}></AppIcon>
          </Dom>
        </>
      ) : null}
      <Dom
        as="footer"
        id={'ttu-page-footer'}
        data-reader-chrome={true}
        inert={!c.chromeVisible}
        data-reader-controls={true}
        className={[
          !c.chromeVisible && 'chrome-hidden',
          'reader-footer fixed bottom-0 left-0 z-10 flex w-full items-center justify-between text-xs leading-none writing-horizontal-tb',
          c.showHeader && 'controls-expanded',
          c.foliatePagination && !c.showHeader && 'foliate-chrome-hidden',
          c.showTrackerIcon && !!c.dataToReplicate.length && 'many-controls'
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ color: c.$themeOption$?.tooltipTextFontColor }}
      >
        <Dom as="div" className={['flex h-full items-center'].filter(Boolean).join(' ')}>
          {!c.foliatePagination ? (
            <>
              <Dom
                as="button"
                aria-expanded={c.showFooter}
                className={['progress-toggle h-11 px-2'].filter(Boolean).join(' ')}
                events={{ click: () => (c.showFooter = !c.showFooter) }}
              >
                {'Progress'}
              </Dom>
            </>
          ) : null}
          {c.$bookData$ && c.$rawBookData$ ? (
            <>
              <React.Fragment key={`${c.$rawBookData$.id}:${c.$rawBookData$.title}`}>
                <AudiobookLauncher
                  bookId={c.$rawBookData$.id}
                  bookTitle={c.$rawBookData$.title}
                  htmlContent={c.$bookData$.htmlContent}
                  layoutKey={c.$viewMode$}
                  bookmarkManager={c.bookmarkManager}
                  getContentElement={() => c.bookReaderComponent?.activeContentElement()}
                  onFollow={() => c.autoScroller?.off()}
                ></AudiobookLauncher>
              </React.Fragment>
            </>
          ) : null}
          {c.showTrackerIcon ? (
            <>
              <Dom
                as="button"
                type={'button'}
                aria-label={'Open reading tracker'}
                title={'Open Tracker Menu; double-click to toggle tracking'}
                className={[
                  'flex size-11 items-center justify-center rounded-full text-base hover:bg-muted',
                  c.$isTrackerPaused$ && 'text-red-500',
                  c.frozenPosition > -1 && 'animate-pulse'
                ]
                  .filter(Boolean)
                  .join(' ')}
                actions={[
                  [multiClickHandler, [c.trackerSingleClickHandler, c.trackerDblClickHandler]]
                ]}
              >
                <AppIcon icon={c.$isTrackerPaused$ ? faPlay : faPause}></AppIcon>
                <Dom as="span" className={['sr-only'].filter(Boolean).join(' ')}>
                  {'Tracker'}
                </Dom>
              </Dom>
            </>
          ) : null}
          {c.dataToReplicate.length ? (
            <>
              <Dom
                as="button"
                type={'button'}
                aria-label={'Sync reading data'}
                className={[
                  'flex size-11 items-center justify-center rounded-full text-base hover:bg-muted',
                  c.externalStorageErrors > 1 && 'text-red-500',
                  (c.externalStorageErrors > 1 || c.isReplicating) && 'animate-pulse'
                ]
                  .filter(Boolean)
                  .join(' ')}
                events={{
                  click: (event) => {
                    event.stopPropagation();
                    Reflect.apply(
                      () => {
                        if (c.$statisticsEnabled$) {
                          c.wasTrackerPaused = c.$isTrackerPaused$;
                          isTrackerPaused$.next(true);
                        }
                        c.executeReplication(false).finally(() => {
                          if (c.$statisticsEnabled$ && !c.wasTrackerPaused) {
                            isTrackerPaused$.next(false);
                          }
                        });
                      },
                      undefined,
                      [event]
                    );
                  },
                  keyup: dummyFn
                }}
              >
                <AppIcon icon={faCloudBolt}></AppIcon>
                <Dom as="span" className={['sr-only'].filter(Boolean).join(' ')}>
                  {'Sync'}
                </Dom>
              </Dom>
            </>
          ) : null}
        </Dom>
        {c.showFooter && c.bookCharCount && !c.foliatePagination ? (
          <>
            {(() => {
              const currentProgress = [
                c.$showCharacterCounter$ ? `${c.exploredCharCount} / ${c.bookCharCount}` : '',
                c.$showPercentage$
                  ? `${((c.exploredCharCount / c.bookCharCount) * 100).toFixed(2)}%`
                  : '',
                c.$showFooterChapterCharacterCounter$ || c.$showFooterChapterPercentage$ ? 'T' : ''
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <>
                  <Dom
                    as="button"
                    type={'button'}
                    title={'Copy Progress'}
                    className={[
                      'reader-progress absolute z-10 text-xs leading-none select-none writing-horizontal-tb',
                      !c.$showCharacterCounter$ &&
                        !c.$showPercentage$ &&
                        !c.$showFooterChapterCharacterCounter$ &&
                        !c.$showFooterChapterPercentage$ &&
                        'invisible'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ color: c.$themeOption$?.tooltipTextFontColor }}
                    events={{
                      click: (event) => {
                        event.stopPropagation();
                        Reflect.apply(
                          ({ target }) => {
                            if (!c.$showCharacterCounter$ && !c.$showPercentage$) {
                              return;
                            }
                            c.copyCurrentProgress(currentProgress.replace(/ T$/, ''));
                            if (target instanceof HTMLElement) {
                              pulseElement(target.parentElement || target, 'add', 0.5, 500);
                            }
                          },
                          undefined,
                          [event]
                        );
                      },
                      keyup: dummyFn
                    }}
                  >
                    <Dom
                      as="span"
                      className={['progress-details', !c.showHeader && 'hidden']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {c.footerChapterProgress}
                    </Dom>
                    <Dom
                      as="span"
                      className={[!c.$showCharacterCounter$ && !c.$showPercentage$ && 'invisible']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {c.showHeader || !c.$showPercentage$
                        ? currentProgress
                        : `${Math.floor((c.exploredCharCount / c.bookCharCount) * 100)}%`}
                    </Dom>
                  </Dom>
                </>
              );
            })()}
          </>
        ) : null}
      </Dom>
      {c.fullscreenError ? (
        <>
          <Dom
            as="p"
            role={'alert'}
            className={['fixed inset-x-4 top-20 z-50 rounded-xl bg-background p-3 text-foreground']
              .filter(Boolean)
              .join(' ')}
          >
            {c.fullscreenError}
          </Dom>
        </>
      ) : null}
      {c.bookCompleted ? (
        <>
          <BookCompletionConfetti
            confettiWidthModifier={c.confettiWidthModifier}
            confettiMaxRuns={c.confettiMaxRuns}
            window={window}
          ></BookCompletionConfetti>
        </>
      ) : null}
      <SurfaceEvents
        target="window"
        events={{
          keydown: c.onKeydown,
          beforeunload: c.handleUnload,
          resize: () => {
            if (c.$statisticsEnabled$ && !c.$isTrackerPaused$) {
              c.pauseTracker();
              merge(fromEvent(document, PAGE_CHANGE), timer(1000))
                .pipe(debounceTime(1000), take(1))
                .subscribe(() => {
                  c.restartTrackerAfterCharacterChangeOrTime(1000);
                });
            }
          }
        }}
      ></SurfaceEvents>
    </ReaderScope>
  );
}
