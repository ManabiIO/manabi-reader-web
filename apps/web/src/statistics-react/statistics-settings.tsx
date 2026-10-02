/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  AppIcon,
  Button,
  CloseButton,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  ReaderScope
} from './primitives';
import {
  createStatisticsSettings,
  type StatisticsSettingsProps
} from './statistics-settings-controller';
import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
import {
  statisticsRangeTemplates,
  readingTimeDataSources,
  charactersDataSources,
  readingSpeedDataSources,
  statisticsDataAggregrationModes,
  exportRawStatistics$,
  setStatisticsDatesToAllTime$
} from '$lib/components/statistics/statistics-types';

import { SettingsItemGroup } from '../settings-react/settings-item-group';
import { ButtonToggleGroup } from '../settings-react/button-toggle-group';

const faLeftLong = 'faLeftLong';
const faRightLong = 'faRightLong';
export function StatisticsSettings(props: Partial<StatisticsSettingsProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsSettings(props as StatisticsSettingsProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-settings">
      <Dom as="div" className={['statistics-options'].filter(Boolean).join(' ')}>
        <Dom
          as="div"
          className={['flex flex-wrap-reverse items-start justify-between gap-3']
            .filter(Boolean)
            .join(' ')}
        >
          <Sheet.Title
            className={['min-w-min flex-auto break-normal text-xl font-semibold']
              .filter(Boolean)
              .join(' ')}
          >
            {'Statistics options'}
          </Sheet.Title>
          <CloseButton
            aria-label={'Close statistics options'}
            disabled={c.$statisticsActionInProgress$}
            onClick={() => c.dispatch('close')}
            className={['ms-auto'].filter(Boolean).join(' ')}
          ></CloseButton>
        </Dom>
        <Sheet.Description>
          {'Choose your date range, measurements, and export format.'}
        </Sheet.Description>
        <Dom
          as="fieldset"
          disabled={c.$statisticsActionInProgress$}
          className={['options-group'].filter(Boolean).join(' ')}
        >
          <Dom as="legend">{'Date range'}</Dom>
          <Dom as="div" className={['fields'].filter(Boolean).join(' ')}>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'datesTemplate'}>
                {'Template'}
              </Dom>
              <Dom
                as="select"
                id={'datesTemplate'}
                value={c.$lastStatisticsRangeTemplate$}
                bindings={{
                  value: (value: typeof c.$lastStatisticsRangeTemplate$) => {
                    c.$lastStatisticsRangeTemplate$ = value;
                  }
                }}
              >
                {(statisticsRangeTemplates ?? []).map((template, index0) => (
                  <React.Fragment key={template}>
                    <Dom as="option" value={template}>
                      {template}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Dom>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'weekDay'}>
                {'Start of Week'}
              </Dom>
              <Dom
                as="select"
                id={'weekDay'}
                value={c.$lastStartDayOfWeek$}
                bindings={{
                  value: (value: typeof c.$lastStartDayOfWeek$) => {
                    c.$lastStartDayOfWeek$ = value;
                  }
                }}
              >
                {(c.weekDays ?? []).map((weekDay, index1) => (
                  <React.Fragment key={weekDay.day}>
                    <Dom as="option" value={weekDay.index}>
                      {weekDay.day}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Dom>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'fromDate'}>
                {'From'}
              </Dom>
              <Dom
                as="input"
                id={'fromDate'}
                type={'date'}
                value={c.selectedStatisticsStartDate}
                events={{
                  change: (event: Event & { currentTarget: HTMLInputElement }) =>
                    c.dispatch('statisticsDateChange', {
                      isStartDate: true,
                      dateString: event.currentTarget.value
                    })
                }}
              />
            </Dom>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'toDate'}>
                {'To'}
              </Dom>
              <Dom
                as="input"
                id={'toDate'}
                type={'date'}
                value={c.selectedStatisticsEndDate}
                events={{
                  change: (event: Event & { currentTarget: HTMLInputElement }) =>
                    c.dispatch('statisticsDateChange', {
                      isStartDate: false,
                      dateString: event.currentTarget.value
                    })
                }}
              />
            </Dom>
          </Dom>
          <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
            <Button
              variant={'ghost'}
              aria-label={'Set end date to start date'}
              onClick={() =>
                c.dispatch('statisticsDateChange', {
                  isStartDate: false,
                  dateString: c.selectedStatisticsStartDate
                })
              }
            >
              <AppIcon icon={faRightLong}></AppIcon>
              {'Use start date for both'}
            </Button>
            <Button
              variant={'ghost'}
              aria-label={'Set start date to end date'}
              onClick={() =>
                c.dispatch('statisticsDateChange', {
                  isStartDate: true,
                  dateString: c.selectedStatisticsEndDate
                })
              }
            >
              <AppIcon icon={faLeftLong}></AppIcon>
              {'Use end date for both'}
            </Button>
            <Button
              variant={'ghost'}
              shape={'rounded'}
              onClick={() => setStatisticsDatesToAllTime$.next()}
            >
              {'Use all available dates for selected books'}
            </Button>
          </Dom>
        </Dom>
        <Dom
          as="fieldset"
          disabled={c.$statisticsActionInProgress$}
          className={['options-group'].filter(Boolean).join(' ')}
        >
          <Dom as="legend">{'Measurements'}</Dom>
          <Dom
            as="p"
            id={'statistics-measurement-help'}
            className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
          >
            {' Choose which values appear in the summary and how the reading data is grouped. '}
          </Dom>
          <Dom as="div" className={['fields'].filter(Boolean).join(' ')}>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'timeDataSource'}>
                {'Time Data Source'}
              </Dom>
              <Dom
                as="select"
                id={'timeDataSource'}
                aria-describedby={'statistics-measurement-help'}
                value={c.$lastReadingTimeDataSource$}
                bindings={{
                  value: (value: typeof c.$lastReadingTimeDataSource$) => {
                    c.$lastReadingTimeDataSource$ = value;
                  }
                }}
              >
                {(readingTimeDataSources ?? []).map((source, index2) => (
                  <React.Fragment key={source.key}>
                    <Dom as="option" value={source.key}>
                      {source.label}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Dom>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'charactersSource'}>
                {'Characters Data Source'}
              </Dom>
              <Dom
                as="select"
                id={'charactersSource'}
                aria-describedby={'statistics-measurement-help'}
                value={c.$lastCharactersDataSource$}
                bindings={{
                  value: (value: typeof c.$lastCharactersDataSource$) => {
                    c.$lastCharactersDataSource$ = value;
                  }
                }}
              >
                {(charactersDataSources ?? []).map((source, index3) => (
                  <React.Fragment key={source.key}>
                    <Dom as="option" value={source.key}>
                      {source.label}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Dom>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'speedSource'}>
                {'Speed Data Source'}
              </Dom>
              <Dom
                as="select"
                id={'speedSource'}
                aria-describedby={'statistics-measurement-help'}
                value={c.$lastReadingSpeedDataSource$}
                bindings={{
                  value: (value: typeof c.$lastReadingSpeedDataSource$) => {
                    c.$lastReadingSpeedDataSource$ = value;
                  }
                }}
              >
                {(readingSpeedDataSources ?? []).map((source, index4) => (
                  <React.Fragment key={source.key}>
                    <Dom as="option" value={source.key}>
                      {source.label}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Dom>
            <Dom as="div" className={['option-field'].filter(Boolean).join(' ')}>
              <Dom as="label" htmlFor={'primaryAggregration'}>
                {'Primary Aggregation'}
              </Dom>
              <Dom
                as="select"
                id={'primaryAggregration'}
                aria-describedby={'statistics-measurement-help'}
                value={c.$lastPrimaryReadingDataAggregationMode$}
                bindings={{
                  value: (value: typeof c.$lastPrimaryReadingDataAggregationMode$) => {
                    c.$lastPrimaryReadingDataAggregationMode$ = value;
                  }
                }}
              >
                {(statisticsDataAggregrationModes ?? []).map((mode, index5) => (
                  <React.Fragment key={mode}>
                    <Dom as="option" value={mode}>
                      {mode}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Dom>
          </Dom>
        </Dom>
        <Dom
          as="fieldset"
          disabled={c.$statisticsActionInProgress$}
          className={['options-group'].filter(Boolean).join(' ')}
        >
          <Dom as="legend">{'Export history'}</Dom>
          <Dom as="p" className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
            {
              ' Raw history preserves book identities, unresolved legacy days, and migration receipts for recovery; it is not a TTU import file. The TTU ZIP exports use titles and cannot preserve book identities. '
            }
          </Dom>
          <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
            <Button
              variant={'secondary'}
              onClick={() => {
                c.$statisticsActionInProgress$ = true;
                exportRawStatistics$.next();
              }}
            >
              {'Download raw history (JSON)'}
            </Button>
            <Button variant={'outline'} onClick={() => c.exportStatisticsData(false)}>
              {'Export Selection'}
            </Button>
            <Button variant={'outline'} onClick={() => c.exportStatisticsData()}>
              {'Export All'}
            </Button>
          </Dom>
        </Dom>
        <Dom
          as="fieldset"
          disabled={c.$statisticsActionInProgress$}
          className={['options-group'].filter(Boolean).join(' ')}
        >
          <Dom as="legend">{'Manage history'}</Dom>
          <SettingsItemGroup title={'Confirm Statistics Deletion'} applyHeaderClasses={false}>
            <ButtonToggleGroup
              invertColors={true}
              options={optionsForToggle}
              selectedOptionId={c.$confirmStatisticsDeletion$}
              bindings={{
                selectedOptionId: (value) => {
                  c.$confirmStatisticsDeletion$ = value;
                }
              }}
            ></ButtonToggleGroup>
          </SettingsItemGroup>
          <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
            <Button variant={'destructive'} onClick={() => c.deleteStatisticsData(false)}>
              {'Delete Selection'}
            </Button>
            <Button variant={'destructive'} onClick={() => c.deleteStatisticsData()}>
              {'Delete All'}
            </Button>
          </Dom>
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
