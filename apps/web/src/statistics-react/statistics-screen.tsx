/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  ReaderScope
} from './primitives';
import { createStatisticsScreen, type StatisticsScreenProps } from './statistics-screen-controller';

import { pxScreen } from '$lib/css-classes';

import { StatisticsHeader } from './statistics-header';
import { StatisticsContent } from './statistics-content';
import { StatisticsSettings } from './statistics-settings';

export function StatisticsScreen(props: Partial<StatisticsScreenProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsScreen(props as StatisticsScreenProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-screen">
      <StatisticsHeader
        currentBookId={c.$currentBookId$}
        showStatisticsSettings={c.showStatisticsSettings}
        bindings={{
          showStatisticsSettings: (value) => {
            c.showStatisticsSettings = value;
          }
        }}
      ></StatisticsHeader>
      <Dom
        as="div"
        data-statistics-content={true}
        className={[String(pxScreen ?? '') + ' flex min-w-0 flex-col py-6']
          .filter(Boolean)
          .join(' ')}
      >
        <StatisticsContent></StatisticsContent>
      </Dom>
      <Sheet.Root
        open={c.showStatisticsSettings}
        bindings={{
          open: (value) => {
            c.showStatisticsSettings = value;
          }
        }}
      >
        <Sheet.Content
          side={'right'}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLButtonElement>('[aria-label="Statistics options"]')?.focus();
          }}
          onInteractOutside={(event) => {
            if (c.$statisticsActionInProgress$) event.preventDefault();
          }}
          onEscapeKeydown={(event) => {
            if (c.$statisticsActionInProgress$) event.preventDefault();
          }}
          className={['data-[side=right]:w-full data-[side=right]:sm:max-w-xl']
            .filter(Boolean)
            .join(' ')}
        >
          <StatisticsSettings
            events={{
              statisticsDateChange: c.handleSelectedStatisticsDateChange,
              close: () => (c.showStatisticsSettings = false)
            }}
          ></StatisticsSettings>
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
