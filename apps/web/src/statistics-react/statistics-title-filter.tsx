/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Button,
  CloseButton,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  Input,
  ReaderScope
} from './primitives';
import {
  createStatisticsTitleFilter,
  type StatisticsTitleFilterProps
} from './statistics-title-filter-controller';
import { stickyPanel } from '$lib/hooks/sticky-panel';

export function StatisticsTitleFilter(
  props: Partial<StatisticsTitleFilterProps> & ReaderViewProps
) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsTitleFilter(props as StatisticsTitleFilterProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-title-filter">
      <Dom
        as="div"
        className={['filter-panel'].filter(Boolean).join(' ')}
        actions={[[stickyPanel, undefined]]}
      >
        <Dom
          as="div"
          data-sticky-header={true}
          className={['filter-header'].filter(Boolean).join(' ')}
        >
          <Sheet.Title className={['min-w-0 text-xl font-semibold'].filter(Boolean).join(' ')}>
            {'Filter books'}
          </Sheet.Title>
          <CloseButton
            aria-label={'Close title filter'}
            onClick={() => c.dispatch('close')}
          ></CloseButton>
        </Dom>
        <Input
          type={'search'}
          placeholder={'Filter titles'}
          aria-label={'Filter book titles'}
          value={c.titleFilter}
          onInput={(event) => {
            c.titleFilter = event.currentTarget.value;
            c.page = 1;
          }}
        ></Input>
        <Dom
          as="div"
          role={'group'}
          aria-label={'Title visibility'}
          className={['flex flex-wrap gap-2'].filter(Boolean).join(' ')}
        >
          <Button
            variant={c.$lastStatisticsFilterDateRangeOnly$ ? 'secondary' : 'ghost'}
            shape={'rounded'}
            aria-pressed={c.$lastStatisticsFilterDateRangeOnly$}
            onClick={() => {
              c.$lastStatisticsFilterDateRangeOnly$ = !c.$lastStatisticsFilterDateRangeOnly$;
              c.page = 1;
            }}
          >
            {'Selected dates only'}
          </Button>
          <Button
            variant={c.$lastStatisticsFilterShowSelectedTitlesOnly$ ? 'secondary' : 'ghost'}
            shape={'rounded'}
            aria-pressed={c.$lastStatisticsFilterShowSelectedTitlesOnly$}
            onClick={() => {
              c.$lastStatisticsFilterShowSelectedTitlesOnly$ =
                !c.$lastStatisticsFilterShowSelectedTitlesOnly$;
              c.page = 1;
            }}
          >
            {'Selected titles only'}
          </Button>
        </Dom>
        <Dom as="div" className={['flex flex-wrap items-center gap-2'].filter(Boolean).join(' ')}>
          <Button
            variant={'ghost'}
            disabled={!c.filteredTitles.length}
            onClick={() => c.selectMatching(true)}
          >
            {'Select matching'}
          </Button>
          <Button
            variant={'ghost'}
            disabled={!c.filteredTitles.length}
            onClick={() => c.selectMatching(false)}
          >
            {'Remove matching'}
          </Button>
          {c.$preFilteredTitlesForStatistics$.size || c.$preFilteredBookKeysForStatistics$.size ? (
            <>
              <Button variant={'outline'} onClick={() => c.dispatch('clearPrefilter')}>
                {'Remove Prefilter'}
              </Button>
            </>
          ) : null}
        </Dom>
        <Dom
          as="p"
          role={'status'}
          className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
        >
          {c.filteredTitles.length}
          {' matching titles · '}
          {c.titlesToFilter.filter((item) => item.isSelected).length}
          {' selected '}
        </Dom>
        {c.current.rows.length ? (
          <>
            <Dom
              as="div"
              elementRef={(value) => {
                c.titleList = value;
              }}
              role={'group'}
              aria-label={'Book title selection'}
              className={['title-list'].filter(Boolean).join(' ')}
            >
              {(c.current.rows ?? []).map((item, index0) => (
                <React.Fragment key={item.title}>
                  <Dom as="label" className={['title-row'].filter(Boolean).join(' ')}>
                    <Dom
                      as="input"
                      type={'checkbox'}
                      aria-label={item.title}
                      checked={item.isSelected}
                      onChange={(event) => c.selectTitle(item.title, event.currentTarget.checked)}
                    />
                    <Dom
                      as="span"
                      className={[
                        !c.titlesInStatisticsDateRange.has(item.title) && 'text-muted-foreground'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {item.title}
                    </Dom>
                  </Dom>
                </React.Fragment>
              ))}
            </Dom>
          </>
        ) : (
          <>
            {' '}
            <Dom
              as="p"
              className={['rounded-xl bg-muted p-5 text-center'].filter(Boolean).join(' ')}
            >
              {'No Titles to filter'}
            </Dom>
          </>
        )}
        {c.current.pages > 1 ? (
          <>
            <Dom
              as="div"
              aria-label={'Title pages'}
              className={['flex flex-wrap items-center justify-between gap-2']
                .filter(Boolean)
                .join(' ')}
            >
              <Button
                variant={'ghost'}
                disabled={c.current.page === 1}
                onClick={() => c.changePage(c.current.page - 1)}
              >
                {'Previous'}
              </Button>
              <Dom
                as="span"
                className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
              >
                {'Page '}
                {c.current.page}
                {' / '}
                {c.current.pages}
              </Dom>
              <Button
                variant={'ghost'}
                disabled={c.current.page === c.current.pages}
                onClick={() => c.changePage(c.current.page + 1)}
              >
                {'Next'}
              </Button>
            </Dom>
          </>
        ) : null}
        <Dom
          as="div"
          data-sticky-footer={true}
          className={['filter-footer'].filter(Boolean).join(' ')}
        >
          <Button variant={'ghost'} onClick={() => c.dispatch('close')}>
            {'Cancel'}
          </Button>
          <Button
            variant={'secondary'}
            onClick={() => {
              c.dispatch('applyFilter', c.titlesToFilter);
              c.dispatch('close');
            }}
          >
            {'Apply Filter'}
          </Button>
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
