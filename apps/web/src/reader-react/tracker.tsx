/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import {
  SurfaceEvents,
  ReaderScope,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createTracker, type TrackerProps } from './tracker-controller';
import { BookTimerMenu } from './tracker-menu';

export function BookReadingTracker(props: Partial<TrackerProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createTracker(props as TrackerProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-tracker">
      {c.$readingTracker$ ?? ''}
      {c.$updateTrackerIdleTime$ ?? ''}
      {c.$autoScrollerTimer$ ?? ''}
      <SurfaceEvents
        target="window"
        events={{ blur: c.handleBlur, focus: c.handleFocus }}
      ></SurfaceEvents>
      <SurfaceEvents
        target="document"
        bindings={{
          visibilityState: (value) => {
            c.visibilityState = value;
          }
        }}
      ></SurfaceEvents>
      <Sheet.Root
        open={c.$isTrackerMenuOpen$}
        onOpenChange={(open) => {
          if (!open && !c.actionInProgress) c.dispatch('trackerMenuClosed');
        }}
      >
        <Sheet.Content
          side={'left'}
          showCloseButton={false}
          onInteractOutside={(e) => {
            if (c.actionInProgress) e.preventDefault();
          }}
          onEscapeKeydown={(e) => {
            if (c.actionInProgress) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document
              .querySelector<HTMLButtonElement>('[aria-label="Open reading tracker"]')
              ?.focus();
          }}
          className={['writing-horizontal-tb data-[side=left]:w-full data-[side=left]:sm:max-w-xl']
            .filter(Boolean)
            .join(' ')}
        >
          <Sheet.Description className={['sr-only'].filter(Boolean).join(' ')}>
            {'Session statistics, reading goals, saved progress, and tracking history.'}
          </Sheet.Description>
          <BookTimerMenu
            fontColor={'var(--foreground)'}
            backgroundColor={'var(--background)'}
            actionInProgress={c.actionInProgress}
            hadError={c.hadError}
            currentReadingGoal={c.currentReadingGoal}
            currentTimeGoal={c.currentTimeGoal}
            currentCharacterGoal={c.currentCharacterGoal}
            currentReadingGoalStart={c.currentReadingGoalStart}
            currentReadingGoalEnd={c.currentReadingGoalEnd}
            remainingTimeInReadingGoalWindow={c.remainingTimeInReadingGoalWindow}
            timeToFinishBook={c.timeToFinishBook}
            exploredCharCount={c.exploredCharCount}
            lastExploredCharCount={c.lastExploredCharCount}
            previousLastExploredCharCount={c.previousLastExploredCharCount}
            frozenPosition={c.frozenPosition}
            trackingHistory={c.trackingHistory}
            sessionStatistics={c.sessionStatistics}
            todaysStatistics={c.todaysStatistics}
            allTimeStatistics={c.allTimeStatistics}
            bookCompletionStatistics={c.bookCompletionStatistics}
            autoScrollerStatistics={c.autoScrollerStatistics}
            bookStartDate={c.bookStartDate}
            sectionData={c.sectionData}
            canSaveStatistics={c.statisticsToStore.size > 0}
            wasTrackerPaused={c.wasTrackerPaused}
            events={{
              trackerMenuClosed: (event) => props.events?.['trackerMenuClosed']?.(event),
              freezeCurrentLocation: (event) => props.events?.['freezeCurrentLocation']?.(event),
              updateCurrentLocation: c.updateLastExploredCharCount,
              saveStatistics: () => c.flushUpdates(),
              revertStatistic: c.revertTrackerHistory
            }}
            bindings={{
              wasTrackerPaused: (value) => {
                c.wasTrackerPaused = value;
              }
            }}
          ></BookTimerMenu>
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
