/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import {
  Dom,
  AppIcon,
  Button,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  Popover,
  ReaderScope
} from './primitives';
import {
  createStatisticsSummary,
  type StatisticsSummaryProps
} from './statistics-summary-controller';
import { StatisticsSummaryKey } from '$lib/components/statistics/statistics-summary/statistics-summary';
import {
  StatisticsReadingDataAggregationMode,
  readingTimeDataSources,
  charactersDataSources,
  readingSpeedDataSources,
  dateDataSources,
  titleDataSources
} from '$lib/components/statistics/statistics-types';
import { CLOSE_POPOVER } from '$lib/data/events';

import { getNumberFromObject, secondsToMinutes } from '$lib/functions/statistic-util';

import { StatisticsSummaryHeader } from './statistics-summary-header';

const faChevronLeft = 'faChevronLeft';
const faChevronRight = 'faChevronRight';
const faClose = 'faClose';
const faFloppyDisk = 'faFloppyDisk';
const faPen = 'faPen';
const faTrash = 'faTrash';
const faXmark = 'faXmark';
export function StatisticsSummary(props: Partial<StatisticsSummaryProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsSummary(props as StatisticsSummaryProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-summary">
      {c.$resizeHandler$ ?? ''}
      <Dom
        as="div"
        className={['my-4', !c.aggregratedStatistics.length && 'hidden'].filter(Boolean).join(' ')}
      >
        {' Data for '}
        {c.statisticsDateRangeLabel}
      </Dom>
      <Dom
        as="div"
        elementRef={(value: HTMLDivElement | null) => {
          c.statisticsSummaryTableContainerElm = value;
        }}
        className={[
          'grow overflow-auto p-2',
          !c.statisticsData.length && 'flex',
          !c.statisticsData.length && 'justify-center',
          !c.statisticsData.length && 'items-center',
          !c.statisticsData.length && 'text-4xl'
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {c.statisticsData.length ? (
          <>
            {(() => {
              const isNoneAggregation =
                c.$lastPrimaryReadingDataAggregationMode$ ===
                StatisticsReadingDataAggregationMode.NONE;
              const isDateAggregation =
                c.$lastPrimaryReadingDataAggregationMode$ ===
                StatisticsReadingDataAggregationMode.DATE;
              const isTitleAggregation =
                c.$lastPrimaryReadingDataAggregationMode$ ===
                StatisticsReadingDataAggregationMode.TITLE;
              return (
                <>
                  <Dom
                    as="div"
                    className={[
                      'grid grid-cols-[0.75fr_1fr] items-center gap-x-8',
                      isNoneAggregation && 'md:grid-cols-[0.31fr_0.6fr_0.77fr_0.74fr_0.6fr_0.57fr]',
                      isNoneAggregation &&
                        'lg:grid-cols-[0.14fr_0.26fr_0.85fr_repeat(2,_0.59fr)_0.45fr]',
                      isDateAggregation && 'md:grid-cols-[0.1fr_0.6fr_1fr_1.1fr_0.85fr]',
                      isDateAggregation && 'lg:grid-cols-[0.1fr_repeat(4,1fr)]',
                      isTitleAggregation && 'md:grid-cols-[0.1fr_1fr_repeat(3,_0.45fr)]',
                      isTitleAggregation && 'lg:grid-cols-[0.1fr_0.93fr_0.35fr_0.42fr_0.3fr]'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      gridAutoRows: `${c.statisticsSummaryBaseRowRem}rem`,
                      rowGap: `${c.statisticsSummaryBaseRowGap}rem`
                    }}
                  >
                    {c.renderFullStatisticsSummaryTable ? (
                      <>
                        <Dom as="div"></Dom>
                      </>
                    ) : null}
                    <StatisticsSummaryHeader
                      statisticsSummaryKey={StatisticsSummaryKey.DATE}
                      options={dateDataSources}
                      selectionKey={StatisticsSummaryKey.DATE}
                      hasRowInEdit={c.rowInEdit !== undefined}
                      isHidden={isTitleAggregation}
                      gridRow={c.renderFullStatisticsSummaryTable ? undefined : 2}
                      title={'Click to select/sort by this Attribute'}
                      events={{ propertyChange: (detail) => c.handlePropertyChange(detail) }}
                    ></StatisticsSummaryHeader>
                    <StatisticsSummaryHeader
                      statisticsSummaryKey={StatisticsSummaryKey.TITLE}
                      options={titleDataSources}
                      selectionKey={StatisticsSummaryKey.TITLE}
                      hasRowInEdit={c.rowInEdit !== undefined}
                      isHidden={isDateAggregation}
                      gridRow={
                        c.renderFullStatisticsSummaryTable
                          ? undefined
                          : 3 - c.statisticsSummaryGridRowMod
                      }
                      title={'Click to select/sort by this Attribute'}
                      events={{ propertyChange: (detail) => c.handlePropertyChange(detail) }}
                    ></StatisticsSummaryHeader>
                    <StatisticsSummaryHeader
                      statisticsSummaryKey={StatisticsSummaryKey.READING_TIME}
                      options={readingTimeDataSources}
                      selectionKey={c.$lastReadingTimeDataSource$}
                      hasRowInEdit={c.rowInEdit !== undefined}
                      gridRow={
                        c.renderFullStatisticsSummaryTable
                          ? undefined
                          : 4 - c.statisticsSummaryGridRowMod
                      }
                      title={'Switch between Reading Time Attributes'}
                      events={{ propertyChange: (detail) => c.handlePropertyChange(detail) }}
                    ></StatisticsSummaryHeader>
                    <StatisticsSummaryHeader
                      statisticsSummaryKey={StatisticsSummaryKey.CHARACTERS}
                      options={charactersDataSources}
                      selectionKey={c.$lastCharactersDataSource$}
                      hasRowInEdit={c.rowInEdit !== undefined}
                      gridRow={
                        c.renderFullStatisticsSummaryTable
                          ? undefined
                          : 5 - c.statisticsSummaryGridRowMod
                      }
                      title={'Switch between Character Attributes'}
                      events={{ propertyChange: (detail) => c.handlePropertyChange(detail) }}
                    ></StatisticsSummaryHeader>
                    <StatisticsSummaryHeader
                      statisticsSummaryKey={StatisticsSummaryKey.READING_SPEED}
                      options={readingSpeedDataSources}
                      selectionKey={c.$lastReadingSpeedDataSource$}
                      hasRowInEdit={c.rowInEdit !== undefined}
                      gridRow={
                        c.renderFullStatisticsSummaryTable
                          ? undefined
                          : 6 - c.statisticsSummaryGridRowMod
                      }
                      title={'Switch between Reading Speed Attributes'}
                      events={{ propertyChange: (detail) => c.handlePropertyChange(detail) }}
                    ></StatisticsSummaryHeader>
                    {(c.currentStatisticsSummaryRows ?? []).map(
                      (currentStatisticsSummaryRow, _index0) => (
                        <React.Fragment key={currentStatisticsSummaryRow.id}>
                          {(() => {
                            const currentRowInEdit =
                              c.rowInEdit && c.rowInEdit.id === currentStatisticsSummaryRow.id;
                            const otherRowInEdit = c.rowInEdit && !currentRowInEdit;
                            return (
                              <>
                                <Dom
                                  as="div"
                                  className={['col-span-2 md:col-span-1'].filter(Boolean).join(' ')}
                                >
                                  <Button
                                    variant={currentRowInEdit ? 'ghost' : 'destructive'}
                                    size={'icon-sm'}
                                    shape={'circle'}
                                    aria-label={
                                      currentRowInEdit
                                        ? 'Cancel edit'
                                        : `Delete row ${currentStatisticsSummaryRow.title}`
                                    }
                                    title={
                                      otherRowInEdit
                                        ? ''
                                        : currentRowInEdit
                                          ? 'Cancel Edit'
                                          : 'Delete Row'
                                    }
                                    disabled={otherRowInEdit}
                                    onClick={() => {
                                      if (c.rowInEdit) {
                                        c.setRowInEditMode();
                                      } else {
                                        c.dispatchDeleteRequest(currentStatisticsSummaryRow);
                                      }
                                    }}
                                  >
                                    <AppIcon icon={currentRowInEdit ? faXmark : faTrash}></AppIcon>
                                  </Button>
                                  {isNoneAggregation ? (
                                    <>
                                      <Button
                                        variant={currentRowInEdit ? 'secondary' : 'ghost'}
                                        size={'icon-sm'}
                                        shape={'circle'}
                                        aria-label={
                                          currentRowInEdit
                                            ? 'Save changes'
                                            : `Edit row ${currentStatisticsSummaryRow.title}`
                                        }
                                        title={
                                          otherRowInEdit
                                            ? ''
                                            : currentRowInEdit
                                              ? 'Save Changes'
                                              : 'Edit Row'
                                        }
                                        disabled={otherRowInEdit}
                                        onClick={() => {
                                          if (c.rowInEdit) {
                                            c.dispatch('edit', {
                                              dateKey: c.rowInEdit.dateKey,
                                              title: c.rowInEdit.title,
                                              bookKey: c.rowInEdit.bookKey,
                                              newReadingTime: c.rowInEditTime,
                                              newCharactersRead: c.rowInEditCharacters,
                                              resetMinMaxValues: c.rowInEditResetMinMaxValues
                                            });
                                            c.setRowInEditMode();
                                          } else {
                                            c.setRowInEditMode(currentStatisticsSummaryRow);
                                          }
                                        }}
                                        className={['ml-1'].filter(Boolean).join(' ')}
                                      >
                                        <AppIcon
                                          icon={currentRowInEdit ? faFloppyDisk : faPen}
                                        ></AppIcon>
                                      </Button>
                                    </>
                                  ) : null}
                                </Dom>
                                <Dom
                                  as="div"
                                  className={[isTitleAggregation && 'hidden']
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {currentStatisticsSummaryRow.dateKey}
                                </Dom>
                                <Dom
                                  as="button"
                                  type={'button'}
                                  title={currentStatisticsSummaryRow.title}
                                  className={['line-clamp-2', isDateAggregation && 'hidden']
                                    .filter(Boolean)
                                    .join(' ')}
                                  events={{
                                    click: (event: MouseEvent) => {
                                      c.statisticsSummaryPopoverDetails = [
                                        currentStatisticsSummaryRow.title
                                      ];
                                      readerTick().then(() => {
                                        if (event.target instanceof HTMLElement) {
                                          c.statisticsSummaryPopover.toggleOpen(event.target);
                                        }
                                      });
                                    }
                                  }}
                                >
                                  {currentStatisticsSummaryRow.title}
                                </Dom>
                                {currentRowInEdit ? (
                                  <>
                                    <Dom
                                      as="input"
                                      type={'number'}
                                      value={c.rowInEditTime}
                                      className={['w-full'].filter(Boolean).join(' ')}
                                      events={{
                                        change: () => {
                                          if (
                                            c.rowInEdit &&
                                            (typeof c.rowInEditTime !== 'number' ||
                                              !Number.isFinite(c.rowInEditTime) ||
                                              c.rowInEditTime < 0)
                                          ) {
                                            c.rowInEditTime = c.rowInEdit.readingTime;
                                          }
                                        }
                                      }}
                                      bindings={{
                                        value: (value: number | undefined) => {
                                          c.rowInEditTime = value;
                                        }
                                      }}
                                    />
                                  </>
                                ) : (
                                  <>
                                    {' '}
                                    <Dom
                                      as="button"
                                      className={[
                                        'text-left',
                                        c.$lastBlurredTrackerItems$.has('readingTime') && 'blur'
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                      events={{
                                        click: (event: MouseEvent) => {
                                          c.statisticsSummaryPopoverDetails = [
                                            `Time: ${secondsToMinutes(currentStatisticsSummaryRow.readingTime)} min`,
                                            `Average Time: ${secondsToMinutes(currentStatisticsSummaryRow.averageReadingTime)} min`,
                                            `Weighted Time: ${secondsToMinutes(currentStatisticsSummaryRow.averageWeightedReadingTime)} min`
                                          ];
                                          readerTick().then(() => {
                                            if (event.target instanceof HTMLElement) {
                                              c.statisticsSummaryPopover.toggleOpen(event.target);
                                            }
                                          });
                                        }
                                      }}
                                    >
                                      {secondsToMinutes(
                                        getNumberFromObject(
                                          currentStatisticsSummaryRow,
                                          c.$lastReadingTimeDataSource$
                                        )
                                      )}
                                      {' min '}
                                    </Dom>
                                  </>
                                )}
                                {currentRowInEdit ? (
                                  <>
                                    <Dom
                                      as="input"
                                      type={'number'}
                                      value={c.rowInEditCharacters}
                                      className={['w-full'].filter(Boolean).join(' ')}
                                      events={{
                                        change: () => {
                                          if (
                                            c.rowInEdit &&
                                            (typeof c.rowInEditCharacters !== 'number' ||
                                              !Number.isFinite(c.rowInEditCharacters) ||
                                              c.rowInEditCharacters < 0)
                                          ) {
                                            c.rowInEditCharacters = c.rowInEdit.charactersRead;
                                          }
                                        }
                                      }}
                                      bindings={{
                                        value: (value: number | undefined) => {
                                          c.rowInEditCharacters = value;
                                        }
                                      }}
                                    />
                                  </>
                                ) : (
                                  <>
                                    {' '}
                                    <Dom
                                      as="button"
                                      className={[
                                        'text-left',
                                        c.$lastBlurredTrackerItems$.has('charactersRead') && 'blur'
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                      events={{
                                        click: (event: MouseEvent) => {
                                          c.statisticsSummaryPopoverDetails = [
                                            `Characters: ${currentStatisticsSummaryRow.charactersRead}`,
                                            `Average Characters: ${currentStatisticsSummaryRow.averageCharactersRead}`,
                                            `Weighted Characters: ${currentStatisticsSummaryRow.averageWeightedCharactersRead}`
                                          ];
                                          readerTick().then(() => {
                                            if (event.target instanceof HTMLElement) {
                                              c.statisticsSummaryPopover.toggleOpen(event.target);
                                            }
                                          });
                                        }
                                      }}
                                    >
                                      {getNumberFromObject(
                                        currentStatisticsSummaryRow,
                                        c.$lastCharactersDataSource$
                                      )}
                                    </Dom>
                                  </>
                                )}
                                {currentRowInEdit ? (
                                  <>
                                    <Dom
                                      as="div"
                                      className={['flex items-center'].filter(Boolean).join(' ')}
                                    >
                                      <Dom
                                        as="input"
                                        id={'reset-min-max'}
                                        type={'checkbox'}
                                        checked={c.rowInEditResetMinMaxValues}
                                        bindings={{
                                          checked: (value: boolean) => {
                                            c.rowInEditResetMinMaxValues = value;
                                          }
                                        }}
                                      />
                                      <Dom
                                        as="label"
                                        htmlFor={'reset-min-max'}
                                        className={['ml-1'].filter(Boolean).join(' ')}
                                      >
                                        {'Reset Min/Max'}
                                      </Dom>
                                    </Dom>
                                  </>
                                ) : (
                                  <>
                                    {' '}
                                    <Dom
                                      as="button"
                                      className={[
                                        'text-left',
                                        c.$lastBlurredTrackerItems$.has('lastReadingSpeed') &&
                                          'blur'
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                      events={{
                                        click: (event: MouseEvent) => {
                                          c.statisticsSummaryPopoverDetails = [
                                            `Speed: ${currentStatisticsSummaryRow.lastReadingSpeed}`,
                                            `Min Speed: ${currentStatisticsSummaryRow.minReadingSpeed}`,
                                            `Alt Min Speed: ${currentStatisticsSummaryRow.altMinReadingSpeed}`,
                                            `Max Speed: ${currentStatisticsSummaryRow.maxReadingSpeed}`
                                          ];
                                          readerTick().then(() => {
                                            if (event.target instanceof HTMLElement) {
                                              c.statisticsSummaryPopover.toggleOpen(event.target);
                                            }
                                          });
                                        }
                                      }}
                                    >
                                      {getNumberFromObject(
                                        currentStatisticsSummaryRow,
                                        c.$lastReadingSpeedDataSource$
                                      )}
                                      {' / h '}
                                    </Dom>
                                  </>
                                )}
                              </>
                            );
                          })()}
                        </React.Fragment>
                      )
                    )}
                  </Dom>
                  {c.statisticsSummaryPopoverDetails.length ? (
                    <>
                      <Popover
                        placement={c.renderFullStatisticsSummaryTable ? 'top-start' : 'top'}
                        yOffset={5}
                        containerStyles={`align-self:flex-start;display:${isDateAggregation ? 'none' : 'flex'}`}
                        bindings={{
                          this: (value) => {
                            c.statisticsSummaryPopover = value;
                          }
                        }}
                      >
                        <Dom
                          as="div"
                          slot={'content'}
                          className={['p-4'].filter(Boolean).join(' ')}
                        >
                          <Dom
                            as="button"
                            className={['absolute top-1 right-2 flex w-full justify-end']
                              .filter(Boolean)
                              .join(' ')}
                            events={{ click: () => (c.statisticsSummaryPopoverDetails = []) }}
                          >
                            <AppIcon icon={faClose}></AppIcon>
                          </Dom>
                          {(c.statisticsSummaryPopoverDetails ?? []).map(
                            (popoverDetail, _index1) => (
                              <React.Fragment key={popoverDetail}>
                                <Dom
                                  as="div"
                                  className={['mb-2 last:mb-0'].filter(Boolean).join(' ')}
                                >
                                  {popoverDetail}
                                </Dom>
                              </React.Fragment>
                            )
                          )}
                        </Dom>
                      </Popover>
                    </>
                  ) : null}
                </>
              );
            })()}
          </>
        ) : (
          <>
            {' '}
            {'No Data found for '}
            {c.statisticsDateRangeLabel}
          </>
        )}
      </Dom>
      <Dom
        as="div"
        elementRef={(value: HTMLDivElement | null) => {
          c.statisticsSummaryButtonContainer = value;
        }}
        className={['my-6 flex justify-between', c.statisticsSummaryMaxPages < 2 && 'invisible']
          .filter(Boolean)
          .join(' ')}
      >
        <Dom
          as="button"
          disabled={c.currentStatisticsSummaryPage === 1}
          className={[
            c.currentStatisticsSummaryPage === 1 && 'opacity-25',
            c.currentStatisticsSummaryPage === 1 && 'cursor-not-allowed'
          ]
            .filter(Boolean)
            .join(' ')}
          events={{
            click: () => {
              c.setRowInEditMode();
              c.currentStatisticsSummaryPage -= 1;
            }
          }}
        >
          <AppIcon icon={faChevronLeft}></AppIcon>
        </Dom>
        <Popover
          yOffset={5}
          events={{
            open: () => {
              const currentPageElement =
                c.statisticsSummaryPageRefs[c.currentStatisticsSummaryPage];
              if (!currentPageElement || !c.statisticsSummaryPagesContainer) {
                return;
              }
              const absoluteElementTop =
                currentPageElement.offsetTop + currentPageElement.clientHeight / 2;
              const middle =
                absoluteElementTop - c.statisticsSummaryPagesContainer.clientHeight / 2;
              c.statisticsSummaryPagesContainer.scrollTo(0, middle);
            }
          }}
        >
          <Dom as="div" className={['mx-6'].filter(Boolean).join(' ')}>
            {c.statisticsSummaryPageLabel}
          </Dom>
          <Dom
            as="div"
            slot={'content'}
            elementRef={(value: HTMLDivElement | null) => {
              c.statisticsSummaryPagesContainer = value;
            }}
            className={['flex max-h-32 w-32 flex-col overflow-auto p-2'].filter(Boolean).join(' ')}
          >
            {(c.statisticsSummaryPages ?? []).map((statisticsSummaryPage, pageIndex) => (
              <React.Fragment key={statisticsSummaryPage}>
                <Dom
                  as="button"
                  elementRef={(value: HTMLButtonElement | null) => {
                    c.statisticsSummaryPageRefs[pageIndex + 1] = value;
                  }}
                  className={[
                    'hover:bg-accent hover:text-foreground hover:opacity-50',
                    statisticsSummaryPage === c.currentStatisticsSummaryPage && 'bg-accent',
                    statisticsSummaryPage === c.currentStatisticsSummaryPage && 'text-foreground'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  events={{
                    click: ({ target }: MouseEvent) => {
                      c.setRowInEditMode();
                      c.currentStatisticsSummaryPage = statisticsSummaryPage;
                      target?.dispatchEvent(new CustomEvent(CLOSE_POPOVER, { bubbles: true }));
                    }
                  }}
                >
                  {statisticsSummaryPage}
                </Dom>
              </React.Fragment>
            ))}
          </Dom>
        </Popover>
        <Dom
          as="button"
          disabled={c.currentStatisticsSummaryPage === c.statisticsSummaryMaxPages}
          className={[
            c.currentStatisticsSummaryPage === c.statisticsSummaryMaxPages && 'opacity-25',
            c.currentStatisticsSummaryPage === c.statisticsSummaryMaxPages && 'cursor-not-allowed'
          ]
            .filter(Boolean)
            .join(' ')}
          events={{
            click: () => {
              c.setRowInEditMode();
              c.currentStatisticsSummaryPage += 1;
            }
          }}
        >
          <AppIcon icon={faChevronRight}></AppIcon>
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
