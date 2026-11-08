/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  AppIcon,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  Popover,
  ReaderScope
} from './primitives';
import {
  createStatisticsSummaryHeader,
  type StatisticsSummaryHeaderProps
} from './statistics-summary-header-controller';

import { SortDirection } from '$lib/data/sort-types';

const faArrowDownWideShort = 'faArrowDownWideShort';
const faArrowUpShortWide = 'faArrowUpShortWide';
export function StatisticsSummaryHeader(
  props: Partial<StatisticsSummaryHeaderProps> & ReaderViewProps
) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsSummaryHeader(props as StatisticsSummaryHeaderProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-summary-header">
      <Dom
        as="div"
        className={[c.tableHeaderClasses, c.isHidden && 'hidden'].filter(Boolean).join(' ')}
        style={{ gridRow: c.gridRow ? `${c.gridRow}/${c.gridRow}` : null }}
      >
        {c.options.length > 1 && !c.hasRowInEdit ? (
          <>
            <Popover
              placement={'bottom-start'}
              fallbackPlacements={['top']}
              innerContainerStyles={'width:100%;min-height:44px;padding:0 8px;'}
              containerStyles={'flex: 1;'}
              bindings={{
                this: (value) => {
                  c.summaryHeaderPopover = value;
                }
              }}
            >
              <Dom as="div" title={c.title}>
                {c.selectedOption.label}
              </Dom>
              <Dom
                as="div"
                slot={'content'}
                className={['flex w-[min(11.5rem,calc(100vw-32px))] flex-col overflow-auto p-[8px]']
                  .filter(Boolean)
                  .join(' ')}
              >
                {(c.options ?? []).map((option, _index0) => (
                  <React.Fragment key={option.key}>
                    <Dom
                      as="button"
                      type="button"
                      className={[
                        'my-1 flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      events={{
                        click: (event: MouseEvent) => {
                          event.stopPropagation();
                          Reflect.apply(
                            () => {
                              c.selectedOption = option;
                              c.dispatch('propertyChange', {
                                property: option.key,
                                statisticsSummaryKey: c.statisticsSummaryKey
                              });
                              c.summaryHeaderPopover.toggleOpen();
                            },
                            undefined,
                            [event]
                          );
                        }
                      }}
                    >
                      {option.label}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </Popover>
          </>
        ) : (
          <>
            {' '}
            <Dom
              as="button"
              type="button"
              disabled={c.hasRowInEdit}
              title={c.title}
              className={[
                'flex min-h-[44px] flex-1 items-center rounded-lg px-2 text-left focus-visible:outline-2 focus-visible:outline-ring',
                c.hasRowInEdit && 'cursor-not-allowed'
              ]
                .filter(Boolean)
                .join(' ')}
              events={{
                click: () => {
                  c.dispatch('propertyChange', {
                    property: c.selectedOption.key,
                    statisticsSummaryKey: c.statisticsSummaryKey
                  });
                }
              }}
            >
              {c.selectedOption.label}
            </Dom>
          </>
        )}
        <Dom
          as="button"
          type="button"
          title={'Click to select/sort by this Attribute'}
          aria-label={`Sort by ${c.selectedOption.label}`}
          disabled={c.hasRowInEdit}
          className={[
            'ml-[4px] flex size-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring',
            !c.optionKeys.has(c.$lastStatisticsSummarySortProperty$) && 'opacity-20',
            c.hasRowInEdit && 'cursor-not-allowed'
          ]
            .filter(Boolean)
            .join(' ')}
          events={{
            click: () =>
              c.dispatch('propertyChange', {
                property: c.selectedOption.key,
                statisticsSummaryKey: c.statisticsSummaryKey
              })
          }}
        >
          {c.$lastStatisticsSummarySortDirection$ === SortDirection.ASC ? (
            <>
              <AppIcon icon={faArrowUpShortWide}></AppIcon>
            </>
          ) : (
            <>
              {' '}
              <AppIcon icon={faArrowDownWideShort}></AppIcon>
            </>
          )}
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
