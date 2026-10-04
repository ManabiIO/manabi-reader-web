/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Button,
  Menu,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  AppNav,
  ActionMenu,
  ReaderScope
} from './primitives';
import { createStatisticsHeader, type StatisticsHeaderProps } from './statistics-header-controller';
import { pagePath } from '$lib/data/env';
import { StatisticsTab, copyStatisticsData$ } from '../lib/components/statistics/statistics-types';

export function StatisticsHeader(props: Partial<StatisticsHeaderProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsHeader(props as StatisticsHeaderProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-header">
      <Dom
        as="header"
        aria-label={'Statistics toolbar'}
        className={['app-header sticky top-0 z-10 border-b border-border bg-card text-foreground']
          .filter(Boolean)
          .join(' ')}
      >
        <Dom
          as="div"
          className={[
            'mx-auto flex min-h-12 max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Dom as="h1" className={['text-lg font-semibold'].filter(Boolean).join(' ')}>
            {'Statistics'}
          </Dom>
          <Dom as="div" className={['flex flex-wrap items-center gap-1'].filter(Boolean).join(' ')}>
            {c.currentBookId ? (
              <>
                <Button href={`${pagePath}/b?id=${c.currentBookId}`} variant={'ghost'}>
                  {'Resume reading'}
                </Button>
              </>
            ) : null}
            <AppNav></AppNav>
          </Dom>
        </Dom>
        <Dom
          as="div"
          className={[
            'mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 sm:px-6'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Dom
            as="div"
            role={'group'}
            aria-label={'Statistics view'}
            className={['section-navigation'].filter(Boolean).join(' ')}
          >
            <Button
              variant={'ghost'}
              shape={'rounded'}
              data-section-link={true}
              aria-pressed={c.$lastStatisticsTab$ === StatisticsTab.SUMMARY}
              onClick={() => (c.$lastStatisticsTab$ = StatisticsTab.SUMMARY)}
            >
              {'Summary'}
            </Button>
            <Button
              variant={'ghost'}
              shape={'rounded'}
              data-section-link={true}
              aria-pressed={c.$lastStatisticsTab$ === StatisticsTab.OVERVIEW}
              onClick={() => (c.$lastStatisticsTab$ = StatisticsTab.OVERVIEW)}
            >
              {'Heatmap'}
            </Button>
          </Dom>
          <Button
            variant={'secondary'}
            disabled={!c.$statisticsTitleFilterEnabled$}
            onClick={() => (c.$statisticsTitleFilterIsOpen$ = true)}
            title={'Open Title Filter Menu'}
          >
            {'Filter books'}
          </Button>
          <ActionMenu label={'Options'} title={'Statistics options'} variant={'secondary'}>
            <Menu.Item onSelect={() => (c.showStatisticsSettings = true)}>
              {'Statistics Settings'}
            </Menu.Item>
            <Menu.Separator></Menu.Separator>
            <Menu.Label>{'Copy TMW log data'}</Menu.Label>
            {(c.copyItems ?? []).map((item, _index0) => (
              <React.Fragment key={item.key}>
                <Menu.Item onSelect={() => copyStatisticsData$.next(item.key)}>
                  {'Copy '}
                  {item.label}
                </Menu.Item>
              </React.Fragment>
            ))}
          </ActionMenu>
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
