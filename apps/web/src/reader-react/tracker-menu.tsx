/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  AppIcon,
  Button,
  CloseButton,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createTrackerMenu, type TrackerMenuProps } from './tracker-menu-controller';
import { secondsToMinutes, toTimeString } from '$lib/functions/statistic-util';
import { caluclatePercentage } from '$lib/functions/utils';

const faChevronLeft = 'faChevronLeft';
const faChevronRight = 'faChevronRight';

const faFloppyDisk = 'faFloppyDisk';

const faSpinner = 'faSpinner';
const faTrash = 'faTrash';
export function BookTimerMenu(props: Partial<TrackerMenuProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createTrackerMenu(props as TrackerMenuProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-tracker-menu">
      <Dom
        as="div"
        className={['flex min-h-16 items-center justify-between gap-3 px-4 pt-4']
          .filter(Boolean)
          .join(' ')}
      >
        <Dom as="div" className={['min-w-0'].filter(Boolean).join(' ')}>
          <Sheet.Title className={['min-w-0 text-xl font-semibold'].filter(Boolean).join(' ')}>
            {'Reading tracker'}
          </Sheet.Title>
          {c.hadError ? (
            <>
              <Dom
                as="p"
                role={'status'}
                className={['mt-1 text-sm text-destructive'].filter(Boolean).join(' ')}
              >
                {'Last update failed'}
              </Dom>
            </>
          ) : null}
        </Dom>
        <CloseButton
          aria-label={'Close reading tracker'}
          disabled={c.actionInProgress}
          onClick={() => c.dispatch('trackerMenuClosed')}
        ></CloseButton>
      </Dom>
      <Dom
        as="div"
        aria-busy={c.actionInProgress}
        className={['relative flex min-h-0 flex-1'].filter(Boolean).join(' ')}
      >
        <Dom
          as="div"
          inert={c.actionInProgress}
          className={['flex min-h-0 flex-1 flex-col overflow-auto p-4'].filter(Boolean).join(' ')}
        >
          <Dom
            as="p"
            role={'status'}
            aria-live={'polite'}
            className={['mb-4 text-sm text-muted-foreground'].filter(Boolean).join(' ')}
          >
            {' Tracking is paused while this panel is open. '}
            {c.wasTrackerPaused
              ? 'It will remain paused after closing.'
              : 'It will resume after closing.'}
          </Dom>
          {c.currentReadingGoal ? (
            <>
              <Dom as="div" className={['mb-6'].filter(Boolean).join(' ')}>
                {c.currentReadingGoal.timeGoal ? (
                  <>
                    {(() => {
                      const timeGoalPercentage = caluclatePercentage(
                        c.currentTimeGoal,
                        c.currentReadingGoal.timeGoal
                      );
                      return (
                        <>
                          <Dom as="div">
                            {secondsToMinutes(c.currentTimeGoal)}
                            {' / '}
                            {secondsToMinutes(c.currentReadingGoal.timeGoal)}
                            {' Min ('}
                            {timeGoalPercentage}
                            {'%) '}
                          </Dom>

                          <Dom
                            as="div"
                            className={['h-2.5 w-full rounded-full'].filter(Boolean).join(' ')}
                            style={{ 'background-Color': c.fontColor }}
                          >
                            <Dom
                              as="div"
                              className={['h-2.5 rounded-full opacity-70']
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                width: `${Math.min(100, timeGoalPercentage)}%`,
                                backgroundColor: c.backgroundColor
                              }}
                            ></Dom>
                          </Dom>
                        </>
                      );
                    })()}
                  </>
                ) : null}
                {c.currentReadingGoal.characterGoal ? (
                  <>
                    {(() => {
                      const characterGoalPercentage = caluclatePercentage(
                        c.currentCharacterGoal,
                        c.currentReadingGoal.characterGoal
                      );
                      return (
                        <>
                          <Dom as="div" className={['mt-4'].filter(Boolean).join(' ')}>
                            {c.currentCharacterGoal}
                            {' / '}
                            {c.currentReadingGoal.characterGoal}
                            {' Characters ('}
                            {characterGoalPercentage}
                            {'%) '}
                          </Dom>

                          <Dom
                            as="div"
                            className={['h-2.5 w-full rounded-full'].filter(Boolean).join(' ')}
                            style={{ 'background-Color': c.fontColor }}
                          >
                            <Dom
                              as="div"
                              className={['h-2.5 rounded-full opacity-70']
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                width: `${Math.min(100, characterGoalPercentage)}%`,
                                'background-Color': c.backgroundColor
                              }}
                            ></Dom>
                          </Dom>
                        </>
                      );
                    })()}
                  </>
                ) : null}
                <Dom
                  as="div"
                  className={[
                    'mt-4 grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Dom as="div" className={['font-medium'].filter(Boolean).join(' ')}>
                    {'Current Reading Goal'}
                  </Dom>
                  <Dom as="div" className={['min-w-0 break-words'].filter(Boolean).join(' ')}>
                    <Dom as="span">{c.currentReadingGoalStart}</Dom>
                    {c.currentReadingGoalEnd &&
                    c.currentReadingGoalStart !== c.currentReadingGoalEnd ? (
                      <>
                        <Dom as="span">{' – '}</Dom>
                        <Dom as="span">{c.currentReadingGoalEnd}</Dom>
                      </>
                    ) : null}
                  </Dom>
                  <Dom as="div" className={['font-medium'].filter(Boolean).join(' ')}>
                    {'Remaining time'}
                  </Dom>
                  <Dom as="div" className={['min-w-0 break-words'].filter(Boolean).join(' ')}>
                    {c.remainingTimeInReadingGoalWindow}
                  </Dom>
                </Dom>
              </Dom>
            </>
          ) : null}
          {(c.allStatistics ?? []).map((statistic, _index0) => (
            <React.Fragment key={statistic.id}>
              <Dom as="div" className={['mb-7 last:mb-4'].filter(Boolean).join(' ')}>
                <Dom
                  as="div"
                  className={['flex flex-wrap items-center gap-2'].filter(Boolean).join(' ')}
                >
                  <Dom as="div">{statistic.id}</Dom>
                  {statistic.id === 'Current Session' ? (
                    <>
                      {(c.actions ?? []).map((action, _index1) => (
                        <React.Fragment key={action.event}>
                          <Button
                            variant={'ghost'}
                            size={'sm'}
                            title={action.title}
                            aria-pressed={
                              action.event === 'resumeAfterClose'
                                ? !c.wasTrackerPaused
                                : action.event === 'freezeCurrentLocation'
                                  ? c.frozenPosition > -1
                                  : undefined
                            }
                            disabled={
                              c.actionInProgress ||
                              (action.event === 'saveStatistics' && !c.canSaveStatistics)
                            }
                            onClick={() => c.executeAction(action.event)}
                          >
                            <AppIcon icon={action.icon}></AppIcon>
                            {action.title}
                          </Button>
                        </React.Fragment>
                      ))}
                    </>
                  ) : null}
                </Dom>
                <Dom as="hr" />
                <Dom as="div" className={['grid min-w-0 gap-1'].filter(Boolean).join(' ')}>
                  {statistic.id === 'All Time' ? (
                    <>
                      <Dom
                        as="div"
                        className={[
                          'grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                          {'Book started on'}
                        </Dom>
                        <Dom
                          as="span"
                          className={['min-w-0 break-words'].filter(Boolean).join(' ')}
                        >
                          {c.bookStartDate}
                        </Dom>
                      </Dom>
                    </>
                  ) : null}
                  {statistic.id === 'Book Completion' && c.bookCompletionStatistics ? (
                    <>
                      <Dom
                        as="div"
                        className={[
                          'grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                          {'Completed on'}
                        </Dom>
                        <Dom
                          as="span"
                          className={['min-w-0 break-words'].filter(Boolean).join(' ')}
                        >
                          {c.bookCompletionStatistics.dateKey}
                        </Dom>
                      </Dom>
                    </>
                  ) : null}
                  <Dom
                    as="button"
                    data-tracker-metric={true}
                    type={'button'}
                    aria-pressed={c.$lastBlurredTrackerItems$.has('charactersRead')}
                    aria-label={c.privacyMetricLabel(
                      'charactersRead',
                      'Characters Read',
                      statistic.charactersRead
                    )}
                    className={[
                      'grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    events={{ click: () => c.handleBlurredKey('charactersRead') }}
                  >
                    <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                      {'Characters Read'}
                    </Dom>
                    <Dom
                      as="span"
                      data-tracker-value={true}
                      aria-hidden={c.$lastBlurredTrackerItems$.has('charactersRead')}
                      className={[
                        'min-w-0 break-words',
                        c.$lastBlurredTrackerItems$.has('charactersRead') && 'blur'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {statistic.charactersRead}
                    </Dom>
                  </Dom>
                  <Dom
                    as="button"
                    data-tracker-metric={true}
                    type={'button'}
                    aria-pressed={c.$lastBlurredTrackerItems$.has('lastReadingSpeed')}
                    aria-label={c.privacyMetricLabel(
                      'lastReadingSpeed',
                      'Reading Speed',
                      `${statistic.lastReadingSpeed} per hour`
                    )}
                    className={[
                      'grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    events={{ click: () => c.handleBlurredKey('lastReadingSpeed') }}
                  >
                    <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                      {'Reading Speed'}
                    </Dom>
                    <Dom
                      as="span"
                      data-tracker-value={true}
                      aria-hidden={c.$lastBlurredTrackerItems$.has('lastReadingSpeed')}
                      className={[
                        'min-w-0 break-words',
                        c.$lastBlurredTrackerItems$.has('lastReadingSpeed') && 'blur'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {statistic.lastReadingSpeed}
                      {' / h'}
                    </Dom>
                  </Dom>
                  <Dom
                    as="button"
                    data-tracker-metric={true}
                    type={'button'}
                    aria-pressed={c.$lastBlurredTrackerItems$.has('readingTime')}
                    aria-label={c.privacyMetricLabel(
                      'readingTime',
                      'Reading Time',
                      toTimeString(statistic.readingTime)
                    )}
                    className={[
                      'grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    events={{ click: () => c.handleBlurredKey('readingTime') }}
                  >
                    <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                      {'Reading Time'}
                    </Dom>
                    <Dom
                      as="span"
                      data-tracker-value={true}
                      aria-hidden={c.$lastBlurredTrackerItems$.has('readingTime')}
                      className={[
                        'min-w-0 break-words',
                        c.$lastBlurredTrackerItems$.has('readingTime') && 'blur'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {toTimeString(statistic.readingTime)}
                    </Dom>
                  </Dom>
                  {statistic.id === 'Current Session' ? (
                    <>
                      <Dom
                        as="button"
                        data-tracker-metric={true}
                        type={'button'}
                        aria-pressed={c.$lastBlurredTrackerItems$.has('finishETA')}
                        aria-label={c.privacyMetricLabel(
                          'finishETA',
                          'Time to Finish Book',
                          c.timeToFinishBook
                        )}
                        className={[
                          'grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        events={{ click: () => c.handleBlurredKey('finishETA') }}
                      >
                        <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                          {'Time to Finish Book'}
                        </Dom>
                        <Dom
                          as="span"
                          data-tracker-value={true}
                          aria-hidden={c.$lastBlurredTrackerItems$.has('finishETA')}
                          className={[
                            'min-w-0 break-words',
                            c.$lastBlurredTrackerItems$.has('finishETA') && 'blur'
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {c.timeToFinishBook}
                        </Dom>
                      </Dom>
                      {c.timeToFinishChapter ? (
                        <>
                          <Dom
                            as="button"
                            data-tracker-metric={true}
                            type={'button'}
                            aria-pressed={c.$lastBlurredTrackerItems$.has('finishChapterETA')}
                            aria-label={c.privacyMetricLabel(
                              'finishChapterETA',
                              'Time to Finish Chapter',
                              c.timeToFinishChapter
                            )}
                            className={[
                              'grid min-h-11 min-w-0 gap-1 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            events={{ click: () => c.handleBlurredKey('finishChapterETA') }}
                          >
                            <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                              {'Time to Finish Chapter'}
                            </Dom>
                            <Dom
                              as="span"
                              data-tracker-value={true}
                              aria-hidden={c.$lastBlurredTrackerItems$.has('finishChapterETA')}
                              className={[
                                'min-w-0 break-words',
                                c.$lastBlurredTrackerItems$.has('finishChapterETA') && 'blur'
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {c.timeToFinishChapter}
                            </Dom>
                          </Dom>
                        </>
                      ) : null}
                      <Dom
                        as="div"
                        className={[
                          'grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                          {'Current Position'}
                        </Dom>
                        <Dom as="span">{c.lastExploredCharCount}</Dom>
                      </Dom>
                      <Dom
                        as="div"
                        className={[
                          'grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                          {'Previous Position'}
                        </Dom>
                        <Dom as="span">{c.previousLastExploredCharCount}</Dom>
                      </Dom>
                      {c.frozenPosition > -1 ? (
                        <>
                          <Dom
                            as="div"
                            className={[
                              'grid min-w-0 gap-1 px-2 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]'
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <Dom as="span" className={['font-medium'].filter(Boolean).join(' ')}>
                              {'Frozen Position'}
                            </Dom>
                            <Dom as="span">{c.frozenPosition}</Dom>
                          </Dom>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </Dom>
                {statistic.id === 'Current Session' && c.trackingHistoryItems.length ? (
                  <>
                    <Dom as="details" className={['mt-3 min-w-0'].filter(Boolean).join(' ')}>
                      <Dom
                        as="summary"
                        className={['flex min-h-11 cursor-pointer items-center']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {'Recent History'}
                      </Dom>
                      <Dom as="div" className={['grid min-w-0 gap-2'].filter(Boolean).join(' ')}>
                        {(c.trackingHistoryItems ?? []).map((trackingHistoryItem, _index2) => (
                          <React.Fragment key={trackingHistoryItem.id}>
                            <Dom
                              as="div"
                              data-tracker-history-item={true}
                              className={[
                                'grid min-w-0 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center'
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <Dom
                                as="div"
                                className={['min-w-0 break-words'].filter(Boolean).join(' ')}
                              >
                                {trackingHistoryItem.dateTimeKey}
                              </Dom>
                              <Dom as="div">
                                <Dom
                                  as="span"
                                  className={['font-medium sm:sr-only'].filter(Boolean).join(' ')}
                                >
                                  {'Time change: '}
                                </Dom>
                                <Dom
                                  as="span"
                                  className={[
                                    trackingHistoryItem.timeDiff > 0 && 'text-green-500',
                                    trackingHistoryItem.timeDiff < 0 && 'text-red-500'
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {trackingHistoryItem.timeDiff}
                                </Dom>
                              </Dom>
                              <Dom as="div">
                                <Dom
                                  as="span"
                                  className={['font-medium sm:sr-only'].filter(Boolean).join(' ')}
                                >
                                  {'Character change: '}
                                </Dom>
                                <Dom
                                  as="span"
                                  className={[
                                    trackingHistoryItem.characterDiff > 0 && 'text-green-500',
                                    trackingHistoryItem.characterDiff < 0 && 'text-red-500'
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {trackingHistoryItem.characterDiff}
                                </Dom>
                              </Dom>
                              <Dom
                                as="div"
                                className={['flex flex-wrap items-center gap-2']
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <Button
                                  variant={'destructive'}
                                  size={'sm'}
                                  aria-label={'Revert history item'}
                                  title={'Revert Item'}
                                  onClick={() => c.dispatch('revertStatistic', trackingHistoryItem)}
                                  className={['min-h-11'].filter(Boolean).join(' ')}
                                >
                                  <AppIcon icon={faTrash}></AppIcon>
                                  <Dom as="span">{'Revert Item'}</Dom>
                                </Button>
                                <Dom
                                  as="span"
                                  title={
                                    trackingHistoryItem.saved
                                      ? 'Item saved to database'
                                      : 'Item not saved yet'
                                  }
                                  className={[trackingHistoryItem.saved && 'text-green-500']
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  <AppIcon icon={faFloppyDisk}></AppIcon>
                                  <Dom as="span" className={['sr-only'].filter(Boolean).join(' ')}>
                                    {trackingHistoryItem.saved
                                      ? 'Saved to database'
                                      : 'Not saved yet'}
                                  </Dom>
                                </Dom>
                              </Dom>
                            </Dom>
                          </React.Fragment>
                        ))}
                      </Dom>
                      <Dom
                        as="div"
                        className={['mt-3 flex items-center justify-between gap-2']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Button
                          ref={c.previousHistoryPage}
                          variant={'ghost'}
                          size={'icon'}
                          shape={'circle'}
                          aria-label={'Previous history page'}
                          title={'Previous Page'}
                          disabled={c.currentTrackingHistoryIndex === 0}
                          onClick={() => void c.pageHistory(-1)}
                          className={['size-11'].filter(Boolean).join(' ')}
                          bindings={{
                            ref: (value) => {
                              c.previousHistoryPage = value;
                            }
                          }}
                        >
                          <AppIcon icon={faChevronLeft}></AppIcon>
                        </Button>
                        <Dom
                          as="span"
                          role={'status'}
                          aria-live={'polite'}
                          className={['text-center text-sm text-muted-foreground']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {' Page '}
                          {c.trackingHistoryIndex + 1}
                          {' of '}
                          {c.historyPageCount}
                        </Dom>
                        <Button
                          ref={c.nextHistoryPage}
                          variant={'ghost'}
                          size={'icon'}
                          shape={'circle'}
                          aria-label={'Next history page'}
                          title={'Next Page'}
                          disabled={!c.hasNextPage}
                          onClick={() => void c.pageHistory(1)}
                          className={['size-11'].filter(Boolean).join(' ')}
                          bindings={{
                            ref: (value) => {
                              c.nextHistoryPage = value;
                            }
                          }}
                        >
                          <AppIcon icon={faChevronRight}></AppIcon>
                        </Button>
                      </Dom>
                    </Dom>
                  </>
                ) : null}
              </Dom>
            </React.Fragment>
          ))}
        </Dom>
        {c.actionInProgress ? (
          <>
            <Dom
              as="div"
              aria-hidden={'true'}
              className={['absolute inset-0 bg-black/[.2] tap-highlight-transparent']
                .filter(Boolean)
                .join(' ')}
            ></Dom>
            <Dom
              as="div"
              role={'status'}
              aria-label={'Updating reading tracker'}
              className={[
                'pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center text-7xl'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <AppIcon icon={faSpinner} spin={true}></AppIcon>
              <Dom as="span" className={['sr-only'].filter(Boolean).join(' ')}>
                {'Updating reading tracker…'}
              </Dom>
            </Dom>
          </>
        ) : null}
      </Dom>
    </ReaderScope>
  );
}
