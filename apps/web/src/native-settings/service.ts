/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** DOM-owner module. Never import this file into a native screen or a second runtime. */
import {
  fontFamilyGroupOne$,
  fontFamilyGroupTwo$,
  fontWeight$,
  fontSize$,
  lineHeight$,
  textIndentation$,
  textMarginMode$,
  textMarginValue$,
  enableVerticalFontKerning$,
  enableFontVPAL$,
  verticalTextOrientation$,
  enableTextJustification$,
  enableTextWrapPretty$,
  viewMode$,
  writingMode$,
  firstDimensionMargin$,
  secondDimensionMaxValue$,
  autoPositionOnResize$,
  avoidPageBreak$,
  pageColumns$,
  swipeThreshold$,
  prioritizeReaderStyles$,
  enableReaderWakeLock$,
  showCharacterCounter$,
  showPercentage$,
  showFooterChapterCharacterCounter$,
  showFooterChapterPercentage$,
  disableWheelNavigation$,
  confirmClose$,
  manualBookmark$,
  autoBookmark$,
  autoBookmarkTime$,
  hideSpoilerImage$,
  hideSpoilerImageMode$,
  hideFurigana$,
  furiganaStyle$,
  pauseTrackerOnCustomPointChange$,
  customReadingPointEnabled$,
  selectionToBookmarkEnabled$,
  enableTapEdgeToFlip$,
  hideExternalReadHint$,
  importHTMLFixMode$,
  restrictImportFixToAnchor$,
  cacheStorageData$,
  autoReplication$,
  replicationSaveBehavior$,
  showExternalPlaceholder$,
  keepLocalStatisticsOnDeletion$,
  overwriteBookCompletion$,
  startDayHoursForTracker$,
  statisticsMergeMode$,
  readingGoalsMergeMode$,
  statisticsEnabled$,
  trackerAutoPause$,
  openTrackerOnCompletion$,
  addCharactersOnCompletion$,
  trackerAutostartTime$,
  trackerIdleTime$,
  trackerForwardSkipThreshold$,
  trackerBackwardSkipThreshold$,
  trackerSkipThresholdAction$,
  trackerPopupDetection$,
  adjustStatisticsAfterIdleTime$,
  verticalCustomReadingPosition$,
  horizontalCustomReadingPosition$,
  yuKyokashoAvailable$,
  userFonts$
} from '$lib/data/store';
import {
  appearance$,
  theme$,
  customThemes$,
  libraryBackgroundOptions$,
  readerBackgroundOptions$
} from '$lib/appearance/state';
import { pageTurnEffect$ } from '$lib/data/page-turn-preferences';
import { effectivePrimaryReaderFont } from '$lib/data/reader-typography';
import { LocalFont } from '$lib/data/fonts';
import { trackerIdleSecondsFromMinutes } from '$lib/components/settings/settings-number-policy';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { createNativeSettingsService, type SettingBinding } from './service-core';
import type { SettingValue } from './schema';

function bind<T extends SettingValue>(subject: {
  getValue(): T;
  next(value: T): void;
}): SettingBinding {
  return { read: () => subject.getValue(), write: (value) => subject.next(value as T) };
}
const service = createNativeSettingsService({
  bindings: {
    appearance: bind(appearance$),
    theme: bind(theme$),
    readerBackgroundFade: {
      read: () => readerBackgroundOptions$.getValue().fade,
      write: (value) =>
        readerBackgroundOptions$.next({
          ...readerBackgroundOptions$.getValue(),
          fade: value as boolean
        })
    },
    readerBackgroundAmount: {
      read: () => readerBackgroundOptions$.getValue().amount,
      write: (value) =>
        readerBackgroundOptions$.next({
          ...readerBackgroundOptions$.getValue(),
          amount: value as number
        })
    },
    libraryBackgroundFade: {
      read: () => libraryBackgroundOptions$.getValue().fade,
      write: (value) =>
        libraryBackgroundOptions$.next({
          ...libraryBackgroundOptions$.getValue(),
          fade: value as boolean
        })
    },
    libraryBackgroundAmount: {
      read: () => libraryBackgroundOptions$.getValue().amount,
      write: (value) =>
        libraryBackgroundOptions$.next({
          ...libraryBackgroundOptions$.getValue(),
          amount: value as number
        })
    },
    fontFamilyGroupOne: bind(fontFamilyGroupOne$),
    fontFamilyGroupTwo: bind(fontFamilyGroupTwo$),
    fontWeight: bind(fontWeight$),
    fontSize: bind(fontSize$),
    lineHeight: bind(lineHeight$),
    textIndentation: bind(textIndentation$),
    textMarginMode: bind(textMarginMode$),
    textMarginValue: bind(textMarginValue$),
    enableVerticalFontKerning: bind(enableVerticalFontKerning$),
    enableFontVPAL: bind(enableFontVPAL$),
    verticalTextOrientation: bind(verticalTextOrientation$),
    enableTextJustification: bind(enableTextJustification$),
    enableTextWrapPretty: bind(enableTextWrapPretty$),
    viewMode: bind(viewMode$),
    writingMode: bind(writingMode$),
    pageTurnEffect: bind(pageTurnEffect$),
    firstDimensionMargin: bind(firstDimensionMargin$),
    secondDimensionMaxValue: bind(secondDimensionMaxValue$),
    autoPositionOnResize: bind(autoPositionOnResize$),
    avoidPageBreak: bind(avoidPageBreak$),
    pageColumns: bind(pageColumns$),
    swipeThreshold: bind(swipeThreshold$),
    prioritizeReaderStyles: bind(prioritizeReaderStyles$),
    enableReaderWakeLock: bind(enableReaderWakeLock$),
    showCharacterCounter: bind(showCharacterCounter$),
    showPercentage: bind(showPercentage$),
    showFooterChapterCharacterCounter: bind(showFooterChapterCharacterCounter$),
    showFooterChapterPercentage: bind(showFooterChapterPercentage$),
    disableWheelNavigation: bind(disableWheelNavigation$),
    confirmClose: bind(confirmClose$),
    manualBookmark: bind(manualBookmark$),
    autoBookmark: bind(autoBookmark$),
    autoBookmarkTime: bind(autoBookmarkTime$),
    hideSpoilerImage: bind(hideSpoilerImage$),
    hideSpoilerImageMode: bind(hideSpoilerImageMode$),
    hideFurigana: bind(hideFurigana$),
    furiganaStyle: bind(furiganaStyle$),
    pauseTrackerOnCustomPointChange: bind(pauseTrackerOnCustomPointChange$),
    customReadingPointEnabled: bind(customReadingPointEnabled$),
    selectionToBookmarkEnabled: bind(selectionToBookmarkEnabled$),
    enableTapEdgeToFlip: bind(enableTapEdgeToFlip$),
    hideExternalReadHint: bind(hideExternalReadHint$),
    importHTMLFixMode: bind(importHTMLFixMode$),
    restrictImportFixToAnchor: bind(restrictImportFixToAnchor$),
    cacheStorageData: bind(cacheStorageData$),
    autoReplication: bind(autoReplication$),
    replicationSaveBehavior: bind(replicationSaveBehavior$),
    showExternalPlaceholder: bind(showExternalPlaceholder$),
    keepLocalStatisticsOnDeletion: bind(keepLocalStatisticsOnDeletion$),
    overwriteBookCompletion: bind(overwriteBookCompletion$),
    startDayHoursForTracker: bind(startDayHoursForTracker$),
    statisticsMergeMode: bind(statisticsMergeMode$),
    readingGoalsMergeMode: bind(readingGoalsMergeMode$),
    statisticsEnabled: bind(statisticsEnabled$),
    trackerAutoPause: bind(trackerAutoPause$),
    openTrackerOnCompletion: bind(openTrackerOnCompletion$),
    addCharactersOnCompletion: bind(addCharactersOnCompletion$),
    trackerAutostartTime: bind(trackerAutostartTime$),
    trackerIdleMinutes: {
      read: () => trackerIdleTime$.getValue() / 60,
      write: (value) => trackerIdleTime$.next(trackerIdleSecondsFromMinutes(value))
    },
    trackerForwardSkipThreshold: bind(trackerForwardSkipThreshold$),
    trackerBackwardSkipThreshold: bind(trackerBackwardSkipThreshold$),
    trackerSkipThresholdAction: bind(trackerSkipThresholdAction$),
    trackerPopupDetection: bind(trackerPopupDetection$),
    adjustStatisticsAfterIdleTime: bind(adjustStatisticsAfterIdleTime$)
  },
  customThemes: {
    read: () => customThemes$.getValue(),
    write: (value) => customThemes$.next(value)
  },
  fonts: () => {
    const custom = userFonts$.getValue().map((font) => font.name);
    const primary = [
      LocalFont.KLEEONE,
      LocalFont.KLEEONESEMIBOLD,
      LocalFont.NOTOSERIFJP,
      LocalFont.KZUDMINCHO,
      LocalFont.GENEI,
      LocalFont.SHIPPORIMINCHO,
      LocalFont.SERIF
    ];
    if (yuKyokashoAvailable$.getValue() === true) primary.unshift(LocalFont.YUKYOKASHO);
    return {
      primary: [...primary, ...custom],
      secondary: [
        LocalFont.SYSTEMSANS,
        LocalFont.NOTOSANSJP,
        LocalFont.KZUDGOTHIC,
        LocalFont.SANSSERIF,
        ...custom
      ],
      effectivePrimary: effectivePrimaryReaderFont(
        fontFamilyGroupOne$.getValue(),
        yuKyokashoAvailable$.getValue()
      )
    };
  },
  resetReadingPoints: (assertCurrent) => {
    assertCurrent();
    verticalCustomReadingPosition$.next(100);
    assertCurrent();
    horizontalCustomReadingPosition$.next(0);
  }
});
/** Call only inside ReaderRuntime's existing version/session/epoch/request authority. */
export function readNativeSettingsState(payload: Record<string, unknown> = {}) {
  if (Object.keys(payload).length) throw new Error('Invalid settings state request.');
  const operation = captureLibraryOperation();
  try {
    return service.state(operation);
  } finally {
    operation.stop();
  }
}
/** Mutations remain in the DOM owner; responses contain admitted preference DTOs only. */
export function dispatchNativeSettingsAction(payload: unknown) {
  const operation = captureLibraryOperation();
  try {
    return service.action(payload, operation);
  } finally {
    operation.stop();
  }
}
