/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  addCharactersOnCompletion$,
  adjustStatisticsAfterIdleTime$,
  autoBookmark$,
  autoBookmarkTime$,
  autoPositionOnResize$,
  autoReplication$,
  avoidPageBreak$,
  cacheStorageData$,
  confirmClose$,
  customReadingPointEnabled$,
  disableWheelNavigation$,
  enableFontVPAL$,
  enableReaderWakeLock$,
  enableTapEdgeToFlip$,
  enableTextJustification$,
  enableTextWrapPretty$,
  enableVerticalFontKerning$,
  firstDimensionMargin$,
  fontFamilyGroupOne$,
  fontFamilyGroupTwo$,
  yuKyokashoAvailable$,
  fontSize$,
  fontWeight$,
  furiganaStyle$,
  hideExternalReadHint$,
  hideFurigana$,
  hideSpoilerImage$,
  importHTMLFixMode$,
  lineHeight$,
  manualBookmark$,
  keepLocalStatisticsOnDeletion$,
  openTrackerOnCompletion$,
  overwriteBookCompletion$,
  pageColumns$,
  pauseTrackerOnCustomPointChange$,
  prioritizeReaderStyles$,
  replicationSaveBehavior$,
  restrictImportFixToAnchor$,
  secondDimensionMaxValue$,
  selectionToBookmarkEnabled$,
  showCharacterCounter$,
  showPercentage$,
  showFooterChapterCharacterCounter$,
  showFooterChapterPercentage$,
  showExternalPlaceholder$,
  startDayHoursForTracker$,
  statisticsEnabled$,
  statisticsMergeMode$,
  swipeThreshold$,
  textIndentation$,
  textMarginMode$,
  textMarginValue$,
  theme$,
  trackerAutoPause$,
  trackerBackwardSkipThreshold$,
  trackerForwardSkipThreshold$,
  trackerAutostartTime$,
  trackerIdleTime$,
  trackerPopupDetection$,
  trackerSkipThresholdAction$,
  verticalTextOrientation$,
  viewMode$,
  writingMode$,
  readingGoalsMergeMode$,
  hideSpoilerImageMode$
} from '$lib/data/store';
import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
import { pagePath } from '$lib/data/env';
import { storage } from '$lib/data/window/navigator/storage';
import {
  currentPersistentStorageRequest,
  retryPersistentStorage
} from '$lib/data/window/navigator/persistent-storage';

import { writableSubject } from '$lib/functions/svelte/store';
import { ReaderController, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

export interface SettingsScreenProps {
  /** Immutable origin of this admitted Settings visit, never a live global route. */
  previousPage?: string;
}

export function createSettingsScreen(
  props: SettingsScreenProps,
  _emit: (name: string, detail?: unknown) => void = () => {},
  _componentContext: SettingsContextValue
) {
  const __readerController = new ReaderController();

  let $theme$: StoreValue<typeof theme$> = __readerController.read(theme$);
  let $fontFamilyGroupOne$: StoreValue<typeof fontFamilyGroupOne$> =
    __readerController.read(fontFamilyGroupOne$);
  let $fontFamilyGroupTwo$: StoreValue<typeof fontFamilyGroupTwo$> =
    __readerController.read(fontFamilyGroupTwo$);
  let $yuKyokashoAvailable$: StoreValue<typeof yuKyokashoAvailable$> =
    __readerController.read(yuKyokashoAvailable$);
  let $fontWeight$: StoreValue<typeof fontWeight$> = __readerController.read(fontWeight$);
  let $fontSize$: StoreValue<typeof fontSize$> = __readerController.read(fontSize$);
  let $lineHeight$: StoreValue<typeof lineHeight$> = __readerController.read(lineHeight$);
  let $textIndentation$: StoreValue<typeof textIndentation$> =
    __readerController.read(textIndentation$);
  let $textMarginValue$: StoreValue<typeof textMarginValue$> =
    __readerController.read(textMarginValue$);
  let $hideSpoilerImage$: StoreValue<typeof hideSpoilerImage$> =
    __readerController.read(hideSpoilerImage$);
  let $hideSpoilerImageMode$: StoreValue<typeof hideSpoilerImageMode$> =
    __readerController.read(hideSpoilerImageMode$);
  let $hideFurigana$: StoreValue<typeof hideFurigana$> = __readerController.read(hideFurigana$);
  let $furiganaStyle$: StoreValue<typeof furiganaStyle$> = __readerController.read(furiganaStyle$);
  let $writingMode$: StoreValue<typeof writingMode$> = __readerController.read(writingMode$);
  let $enableVerticalFontKerning$: StoreValue<typeof enableVerticalFontKerning$> =
    __readerController.read(enableVerticalFontKerning$);
  let $enableFontVPAL$: StoreValue<typeof enableFontVPAL$> =
    __readerController.read(enableFontVPAL$);
  let $verticalTextOrientation$: StoreValue<typeof verticalTextOrientation$> =
    __readerController.read(verticalTextOrientation$);
  let $prioritizeReaderStyles$: StoreValue<typeof prioritizeReaderStyles$> =
    __readerController.read(prioritizeReaderStyles$);
  let $enableTextJustification$: StoreValue<typeof enableTextJustification$> =
    __readerController.read(enableTextJustification$);
  let $enableTextWrapPretty$: StoreValue<typeof enableTextWrapPretty$> =
    __readerController.read(enableTextWrapPretty$);
  let $textMarginMode$: StoreValue<typeof textMarginMode$> =
    __readerController.read(textMarginMode$);
  let $enableReaderWakeLock$: StoreValue<typeof enableReaderWakeLock$> =
    __readerController.read(enableReaderWakeLock$);
  let $showCharacterCounter$: StoreValue<typeof showCharacterCounter$> =
    __readerController.read(showCharacterCounter$);
  let $showPercentage$: StoreValue<typeof showPercentage$> =
    __readerController.read(showPercentage$);
  let $showFooterChapterCharacterCounter$: StoreValue<typeof showFooterChapterCharacterCounter$> =
    __readerController.read(showFooterChapterCharacterCounter$);
  let $showFooterChapterPercentage$: StoreValue<typeof showFooterChapterPercentage$> =
    __readerController.read(showFooterChapterPercentage$);
  let $viewMode$: StoreValue<typeof viewMode$> = __readerController.read(viewMode$);
  let $secondDimensionMaxValue$: StoreValue<typeof secondDimensionMaxValue$> =
    __readerController.read(secondDimensionMaxValue$);
  let $firstDimensionMargin$: StoreValue<typeof firstDimensionMargin$> =
    __readerController.read(firstDimensionMargin$);
  let $swipeThreshold$: StoreValue<typeof swipeThreshold$> =
    __readerController.read(swipeThreshold$);
  let $disableWheelNavigation$: StoreValue<typeof disableWheelNavigation$> =
    __readerController.read(disableWheelNavigation$);
  let $autoPositionOnResize$: StoreValue<typeof autoPositionOnResize$> =
    __readerController.read(autoPositionOnResize$);
  let $avoidPageBreak$: StoreValue<typeof avoidPageBreak$> =
    __readerController.read(avoidPageBreak$);
  let $pauseTrackerOnCustomPointChange$: StoreValue<typeof pauseTrackerOnCustomPointChange$> =
    __readerController.read(pauseTrackerOnCustomPointChange$);
  let $customReadingPointEnabled$: StoreValue<typeof customReadingPointEnabled$> =
    __readerController.read(customReadingPointEnabled$);
  let $selectionToBookmarkEnabled$: StoreValue<typeof selectionToBookmarkEnabled$> =
    __readerController.read(selectionToBookmarkEnabled$);
  let $enableTapEdgeToFlip$: StoreValue<typeof enableTapEdgeToFlip$> =
    __readerController.read(enableTapEdgeToFlip$);
  let $pageColumns$: StoreValue<typeof pageColumns$> = __readerController.read(pageColumns$);
  let $persistentStorage$: StoreValue<typeof persistentStorage$> = undefined as never;
  let $hideExternalReadHint$: StoreValue<typeof hideExternalReadHint$> =
    __readerController.read(hideExternalReadHint$);
  let $confirmClose$: StoreValue<typeof confirmClose$> = __readerController.read(confirmClose$);
  let $manualBookmark$: StoreValue<typeof manualBookmark$> =
    __readerController.read(manualBookmark$);
  let $autoBookmark$: StoreValue<typeof autoBookmark$> = __readerController.read(autoBookmark$);
  let $autoBookmarkTime$: StoreValue<typeof autoBookmarkTime$> =
    __readerController.read(autoBookmarkTime$);
  let $importHTMLFixMode$: StoreValue<typeof importHTMLFixMode$> =
    __readerController.read(importHTMLFixMode$);
  let $restrictImportFixToAnchor$: StoreValue<typeof restrictImportFixToAnchor$> =
    __readerController.read(restrictImportFixToAnchor$);
  let $cacheStorageData$: StoreValue<typeof cacheStorageData$> =
    __readerController.read(cacheStorageData$);
  let $replicationSaveBehavior$: StoreValue<typeof replicationSaveBehavior$> =
    __readerController.read(replicationSaveBehavior$);
  let $autoReplication$: StoreValue<typeof autoReplication$> =
    __readerController.read(autoReplication$);
  let $showExternalPlaceholder$: StoreValue<typeof showExternalPlaceholder$> =
    __readerController.read(showExternalPlaceholder$);
  let $keepLocalStatisticsOnDeletion$: StoreValue<typeof keepLocalStatisticsOnDeletion$> =
    __readerController.read(keepLocalStatisticsOnDeletion$);
  let $overwriteBookCompletion$: StoreValue<typeof overwriteBookCompletion$> =
    __readerController.read(overwriteBookCompletion$);
  let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> =
    __readerController.read(startDayHoursForTracker$);
  let $statisticsMergeMode$: StoreValue<typeof statisticsMergeMode$> =
    __readerController.read(statisticsMergeMode$);
  let $readingGoalsMergeMode$: StoreValue<typeof readingGoalsMergeMode$> =
    __readerController.read(readingGoalsMergeMode$);
  let $statisticsEnabled$: StoreValue<typeof statisticsEnabled$> =
    __readerController.read(statisticsEnabled$);
  let $trackerAutoPause$: StoreValue<typeof trackerAutoPause$> =
    __readerController.read(trackerAutoPause$);
  let $openTrackerOnCompletion$: StoreValue<typeof openTrackerOnCompletion$> =
    __readerController.read(openTrackerOnCompletion$);
  let $addCharactersOnCompletion$: StoreValue<typeof addCharactersOnCompletion$> =
    __readerController.read(addCharactersOnCompletion$);
  let $trackerAutostartTime$: StoreValue<typeof trackerAutostartTime$> =
    __readerController.read(trackerAutostartTime$);
  let $trackerIdleTime$: StoreValue<typeof trackerIdleTime$> =
    __readerController.read(trackerIdleTime$);
  let $trackerForwardSkipThreshold$: StoreValue<typeof trackerForwardSkipThreshold$> =
    __readerController.read(trackerForwardSkipThreshold$);
  let $trackerBackwardSkipThreshold$: StoreValue<typeof trackerBackwardSkipThreshold$> =
    __readerController.read(trackerBackwardSkipThreshold$);
  let $trackerSkipThresholdAction$: StoreValue<typeof trackerSkipThresholdAction$> =
    __readerController.read(trackerSkipThresholdAction$);
  let $trackerPopupDetection$: StoreValue<typeof trackerPopupDetection$> =
    __readerController.read(trackerPopupDetection$);
  let $adjustStatisticsAfterIdleTime$: StoreValue<typeof adjustStatisticsAfterIdleTime$> =
    __readerController.read(adjustStatisticsAfterIdleTime$);
  const persistentStorage$ = writableSubject(false);
  __readerController.onMount(() => {
    storage.persisted().then(setPersistentStorage);
    currentPersistentStorageRequest()?.then(setPersistentStorage);
    setStorageQuota();
  });
  const fallbackPage = `${pagePath}${mergeEntries.MANAGE.routeId}`;
  const prevPage = (() => {
    if (!props.previousPage) return fallbackPage;
    try {
      const origin = typeof location === 'undefined' ? 'https://reader.invalid' : location.origin;
      const previous = new URL(props.previousPage, origin);
      // Route context is local only. Never turn this component input into an
      // external redirect, or make a category change its own Back destination.
      return previous.origin === origin &&
        !previous.username &&
        !previous.password &&
        previous.pathname.startsWith(`${pagePath}/`) &&
        previous.pathname.replace(/\/+$/, '') !== `${pagePath}${mergeEntries.SETTINGS.routeId}`
        ? `${previous.pathname}${previous.search}${previous.hash}`
        : fallbackPage;
    } catch {
      return fallbackPage;
    }
  })();
  const activeSettings = 'All';
  let storageQuota = '';
  function setPersistentStorage(value: boolean) {
    persistentStorage$.next(value);
  }
  async function requestPersistentStorage() {
    setPersistentStorage(await retryPersistentStorage());
    setStorageQuota();
  }
  function setStorageQuota() {
    storage
      .estimate()
      .then((storageData) => {
        const { usage, quota } = storageData;
        if (usage === undefined || quota === undefined) {
          return;
        }
        __readerController.changed(
          (storageQuota = `${Math.round(((usage / quota) * 100 + Number.EPSILON) * 100) / 100} % used`)
        );
      })
      .catch(() => {
        // no-op
      });
  }
  __readerController.observeSource(
    () => theme$,
    (value) => {
      $theme$ = value;
    }
  );
  __readerController.observeSource(
    () => fontFamilyGroupOne$,
    (value) => {
      $fontFamilyGroupOne$ = value;
    }
  );
  __readerController.observeSource(
    () => fontFamilyGroupTwo$,
    (value) => {
      $fontFamilyGroupTwo$ = value;
    }
  );
  __readerController.observeSource(
    () => yuKyokashoAvailable$,
    (value) => {
      $yuKyokashoAvailable$ = value;
    }
  );
  __readerController.observeSource(
    () => fontWeight$,
    (value) => {
      $fontWeight$ = value;
    }
  );
  __readerController.observeSource(
    () => fontSize$,
    (value) => {
      $fontSize$ = value;
    }
  );
  __readerController.observeSource(
    () => lineHeight$,
    (value) => {
      $lineHeight$ = value;
    }
  );
  __readerController.observeSource(
    () => textIndentation$,
    (value) => {
      $textIndentation$ = value;
    }
  );
  __readerController.observeSource(
    () => textMarginValue$,
    (value) => {
      $textMarginValue$ = value;
    }
  );
  __readerController.observeSource(
    () => hideSpoilerImage$,
    (value) => {
      $hideSpoilerImage$ = value;
    }
  );
  __readerController.observeSource(
    () => hideSpoilerImageMode$,
    (value) => {
      $hideSpoilerImageMode$ = value;
    }
  );
  __readerController.observeSource(
    () => hideFurigana$,
    (value) => {
      $hideFurigana$ = value;
    }
  );
  __readerController.observeSource(
    () => furiganaStyle$,
    (value) => {
      $furiganaStyle$ = value;
    }
  );
  __readerController.observeSource(
    () => writingMode$,
    (value) => {
      $writingMode$ = value;
    }
  );
  __readerController.observeSource(
    () => enableVerticalFontKerning$,
    (value) => {
      $enableVerticalFontKerning$ = value;
    }
  );
  __readerController.observeSource(
    () => enableFontVPAL$,
    (value) => {
      $enableFontVPAL$ = value;
    }
  );
  __readerController.observeSource(
    () => verticalTextOrientation$,
    (value) => {
      $verticalTextOrientation$ = value;
    }
  );
  __readerController.observeSource(
    () => prioritizeReaderStyles$,
    (value) => {
      $prioritizeReaderStyles$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTextJustification$,
    (value) => {
      $enableTextJustification$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTextWrapPretty$,
    (value) => {
      $enableTextWrapPretty$ = value;
    }
  );
  __readerController.observeSource(
    () => textMarginMode$,
    (value) => {
      $textMarginMode$ = value;
    }
  );
  __readerController.observeSource(
    () => enableReaderWakeLock$,
    (value) => {
      $enableReaderWakeLock$ = value;
    }
  );
  __readerController.observeSource(
    () => showCharacterCounter$,
    (value) => {
      $showCharacterCounter$ = value;
    }
  );
  __readerController.observeSource(
    () => showPercentage$,
    (value) => {
      $showPercentage$ = value;
    }
  );
  __readerController.observeSource(
    () => showFooterChapterCharacterCounter$,
    (value) => {
      $showFooterChapterCharacterCounter$ = value;
    }
  );
  __readerController.observeSource(
    () => showFooterChapterPercentage$,
    (value) => {
      $showFooterChapterPercentage$ = value;
    }
  );
  __readerController.observeSource(
    () => viewMode$,
    (value) => {
      $viewMode$ = value;
    }
  );
  __readerController.observeSource(
    () => secondDimensionMaxValue$,
    (value) => {
      $secondDimensionMaxValue$ = value;
    }
  );
  __readerController.observeSource(
    () => firstDimensionMargin$,
    (value) => {
      $firstDimensionMargin$ = value;
    }
  );
  __readerController.observeSource(
    () => swipeThreshold$,
    (value) => {
      $swipeThreshold$ = value;
    }
  );
  __readerController.observeSource(
    () => disableWheelNavigation$,
    (value) => {
      $disableWheelNavigation$ = value;
    }
  );
  __readerController.observeSource(
    () => autoPositionOnResize$,
    (value) => {
      $autoPositionOnResize$ = value;
    }
  );
  __readerController.observeSource(
    () => avoidPageBreak$,
    (value) => {
      $avoidPageBreak$ = value;
    }
  );
  __readerController.observeSource(
    () => pauseTrackerOnCustomPointChange$,
    (value) => {
      $pauseTrackerOnCustomPointChange$ = value;
    }
  );
  __readerController.observeSource(
    () => customReadingPointEnabled$,
    (value) => {
      $customReadingPointEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => selectionToBookmarkEnabled$,
    (value) => {
      $selectionToBookmarkEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTapEdgeToFlip$,
    (value) => {
      $enableTapEdgeToFlip$ = value;
    }
  );
  __readerController.observeSource(
    () => pageColumns$,
    (value) => {
      $pageColumns$ = value;
    }
  );
  $persistentStorage$ = __readerController.read(persistentStorage$);
  __readerController.observeSource(
    () => persistentStorage$,
    (value) => {
      $persistentStorage$ = value;
    }
  );
  __readerController.observeSource(
    () => hideExternalReadHint$,
    (value) => {
      $hideExternalReadHint$ = value;
    }
  );
  __readerController.observeSource(
    () => confirmClose$,
    (value) => {
      $confirmClose$ = value;
    }
  );
  __readerController.observeSource(
    () => manualBookmark$,
    (value) => {
      $manualBookmark$ = value;
    }
  );
  __readerController.observeSource(
    () => autoBookmark$,
    (value) => {
      $autoBookmark$ = value;
    }
  );
  __readerController.observeSource(
    () => autoBookmarkTime$,
    (value) => {
      $autoBookmarkTime$ = value;
    }
  );
  __readerController.observeSource(
    () => importHTMLFixMode$,
    (value) => {
      $importHTMLFixMode$ = value;
    }
  );
  __readerController.observeSource(
    () => restrictImportFixToAnchor$,
    (value) => {
      $restrictImportFixToAnchor$ = value;
    }
  );
  __readerController.observeSource(
    () => cacheStorageData$,
    (value) => {
      $cacheStorageData$ = value;
    }
  );
  __readerController.observeSource(
    () => replicationSaveBehavior$,
    (value) => {
      $replicationSaveBehavior$ = value;
    }
  );
  __readerController.observeSource(
    () => autoReplication$,
    (value) => {
      $autoReplication$ = value;
    }
  );
  __readerController.observeSource(
    () => showExternalPlaceholder$,
    (value) => {
      $showExternalPlaceholder$ = value;
    }
  );
  __readerController.observeSource(
    () => keepLocalStatisticsOnDeletion$,
    (value) => {
      $keepLocalStatisticsOnDeletion$ = value;
    }
  );
  __readerController.observeSource(
    () => overwriteBookCompletion$,
    (value) => {
      $overwriteBookCompletion$ = value;
    }
  );
  __readerController.observeSource(
    () => startDayHoursForTracker$,
    (value) => {
      $startDayHoursForTracker$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsMergeMode$,
    (value) => {
      $statisticsMergeMode$ = value;
    }
  );
  __readerController.observeSource(
    () => readingGoalsMergeMode$,
    (value) => {
      $readingGoalsMergeMode$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsEnabled$,
    (value) => {
      $statisticsEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerAutoPause$,
    (value) => {
      $trackerAutoPause$ = value;
    }
  );
  __readerController.observeSource(
    () => openTrackerOnCompletion$,
    (value) => {
      $openTrackerOnCompletion$ = value;
    }
  );
  __readerController.observeSource(
    () => addCharactersOnCompletion$,
    (value) => {
      $addCharactersOnCompletion$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerAutostartTime$,
    (value) => {
      $trackerAutostartTime$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerIdleTime$,
    (value) => {
      $trackerIdleTime$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerForwardSkipThreshold$,
    (value) => {
      $trackerForwardSkipThreshold$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerBackwardSkipThreshold$,
    (value) => {
      $trackerBackwardSkipThreshold$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerSkipThresholdAction$,
    (value) => {
      $trackerSkipThresholdAction$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerPopupDetection$,
    (value) => {
      $trackerPopupDetection$ = value;
    }
  );
  __readerController.observeSource(
    () => adjustStatisticsAfterIdleTime$,
    (value) => {
      $adjustStatisticsAfterIdleTime$ = value;
    }
  );
  const api = {
    controller: __readerController,
    setPersistentStorage,
    requestPersistentStorage,
    setStorageQuota,
    get persistentStorage$() {
      return persistentStorage$;
    },
    get prevPage() {
      return prevPage;
    },
    get activeSettings() {
      return activeSettings;
    },
    get storageQuota() {
      return storageQuota;
    },
    set storageQuota(nextValue: typeof storageQuota) {
      if (Object.is(storageQuota, nextValue)) return;
      storageQuota = nextValue;
      __readerController.invalidate();
    },
    get $theme$() {
      return $theme$;
    },
    set $theme$(nextValue: typeof $theme$) {
      writeStore(theme$, nextValue);
    },
    get $fontFamilyGroupOne$() {
      return $fontFamilyGroupOne$;
    },
    set $fontFamilyGroupOne$(nextValue: typeof $fontFamilyGroupOne$) {
      writeStore(fontFamilyGroupOne$, nextValue);
    },
    get $fontFamilyGroupTwo$() {
      return $fontFamilyGroupTwo$;
    },
    set $fontFamilyGroupTwo$(nextValue: typeof $fontFamilyGroupTwo$) {
      writeStore(fontFamilyGroupTwo$, nextValue);
    },
    get $yuKyokashoAvailable$() {
      return $yuKyokashoAvailable$;
    },
    set $yuKyokashoAvailable$(nextValue: typeof $yuKyokashoAvailable$) {
      writeStore(yuKyokashoAvailable$, nextValue);
    },
    get $fontWeight$() {
      return $fontWeight$;
    },
    set $fontWeight$(nextValue: typeof $fontWeight$) {
      writeStore(fontWeight$, nextValue);
    },
    get $fontSize$() {
      return $fontSize$;
    },
    set $fontSize$(nextValue: typeof $fontSize$) {
      writeStore(fontSize$, nextValue);
    },
    get $lineHeight$() {
      return $lineHeight$;
    },
    set $lineHeight$(nextValue: typeof $lineHeight$) {
      writeStore(lineHeight$, nextValue);
    },
    get $textIndentation$() {
      return $textIndentation$;
    },
    set $textIndentation$(nextValue: typeof $textIndentation$) {
      writeStore(textIndentation$, nextValue);
    },
    get $textMarginValue$() {
      return $textMarginValue$;
    },
    set $textMarginValue$(nextValue: typeof $textMarginValue$) {
      writeStore(textMarginValue$, nextValue);
    },
    get $hideSpoilerImage$() {
      return $hideSpoilerImage$;
    },
    set $hideSpoilerImage$(nextValue: typeof $hideSpoilerImage$) {
      writeStore(hideSpoilerImage$, nextValue);
    },
    get $hideSpoilerImageMode$() {
      return $hideSpoilerImageMode$;
    },
    set $hideSpoilerImageMode$(nextValue: typeof $hideSpoilerImageMode$) {
      writeStore(hideSpoilerImageMode$, nextValue);
    },
    get $hideFurigana$() {
      return $hideFurigana$;
    },
    set $hideFurigana$(nextValue: typeof $hideFurigana$) {
      writeStore(hideFurigana$, nextValue);
    },
    get $furiganaStyle$() {
      return $furiganaStyle$;
    },
    set $furiganaStyle$(nextValue: typeof $furiganaStyle$) {
      writeStore(furiganaStyle$, nextValue);
    },
    get $writingMode$() {
      return $writingMode$;
    },
    set $writingMode$(nextValue: typeof $writingMode$) {
      writeStore(writingMode$, nextValue);
    },
    get $enableVerticalFontKerning$() {
      return $enableVerticalFontKerning$;
    },
    set $enableVerticalFontKerning$(nextValue: typeof $enableVerticalFontKerning$) {
      writeStore(enableVerticalFontKerning$, nextValue);
    },
    get $enableFontVPAL$() {
      return $enableFontVPAL$;
    },
    set $enableFontVPAL$(nextValue: typeof $enableFontVPAL$) {
      writeStore(enableFontVPAL$, nextValue);
    },
    get $verticalTextOrientation$() {
      return $verticalTextOrientation$;
    },
    set $verticalTextOrientation$(nextValue: typeof $verticalTextOrientation$) {
      writeStore(verticalTextOrientation$, nextValue);
    },
    get $prioritizeReaderStyles$() {
      return $prioritizeReaderStyles$;
    },
    set $prioritizeReaderStyles$(nextValue: typeof $prioritizeReaderStyles$) {
      writeStore(prioritizeReaderStyles$, nextValue);
    },
    get $enableTextJustification$() {
      return $enableTextJustification$;
    },
    set $enableTextJustification$(nextValue: typeof $enableTextJustification$) {
      writeStore(enableTextJustification$, nextValue);
    },
    get $enableTextWrapPretty$() {
      return $enableTextWrapPretty$;
    },
    set $enableTextWrapPretty$(nextValue: typeof $enableTextWrapPretty$) {
      writeStore(enableTextWrapPretty$, nextValue);
    },
    get $textMarginMode$() {
      return $textMarginMode$;
    },
    set $textMarginMode$(nextValue: typeof $textMarginMode$) {
      writeStore(textMarginMode$, nextValue);
    },
    get $enableReaderWakeLock$() {
      return $enableReaderWakeLock$;
    },
    set $enableReaderWakeLock$(nextValue: typeof $enableReaderWakeLock$) {
      writeStore(enableReaderWakeLock$, nextValue);
    },
    get $showCharacterCounter$() {
      return $showCharacterCounter$;
    },
    set $showCharacterCounter$(nextValue: typeof $showCharacterCounter$) {
      writeStore(showCharacterCounter$, nextValue);
    },
    get $showPercentage$() {
      return $showPercentage$;
    },
    set $showPercentage$(nextValue: typeof $showPercentage$) {
      writeStore(showPercentage$, nextValue);
    },
    get $showFooterChapterCharacterCounter$() {
      return $showFooterChapterCharacterCounter$;
    },
    set $showFooterChapterCharacterCounter$(nextValue: typeof $showFooterChapterCharacterCounter$) {
      writeStore(showFooterChapterCharacterCounter$, nextValue);
    },
    get $showFooterChapterPercentage$() {
      return $showFooterChapterPercentage$;
    },
    set $showFooterChapterPercentage$(nextValue: typeof $showFooterChapterPercentage$) {
      writeStore(showFooterChapterPercentage$, nextValue);
    },
    get $viewMode$() {
      return $viewMode$;
    },
    set $viewMode$(nextValue: typeof $viewMode$) {
      writeStore(viewMode$, nextValue);
    },
    get $secondDimensionMaxValue$() {
      return $secondDimensionMaxValue$;
    },
    set $secondDimensionMaxValue$(nextValue: typeof $secondDimensionMaxValue$) {
      writeStore(secondDimensionMaxValue$, nextValue);
    },
    get $firstDimensionMargin$() {
      return $firstDimensionMargin$;
    },
    set $firstDimensionMargin$(nextValue: typeof $firstDimensionMargin$) {
      writeStore(firstDimensionMargin$, nextValue);
    },
    get $swipeThreshold$() {
      return $swipeThreshold$;
    },
    set $swipeThreshold$(nextValue: typeof $swipeThreshold$) {
      writeStore(swipeThreshold$, nextValue);
    },
    get $disableWheelNavigation$() {
      return $disableWheelNavigation$;
    },
    set $disableWheelNavigation$(nextValue: typeof $disableWheelNavigation$) {
      writeStore(disableWheelNavigation$, nextValue);
    },
    get $autoPositionOnResize$() {
      return $autoPositionOnResize$;
    },
    set $autoPositionOnResize$(nextValue: typeof $autoPositionOnResize$) {
      writeStore(autoPositionOnResize$, nextValue);
    },
    get $avoidPageBreak$() {
      return $avoidPageBreak$;
    },
    set $avoidPageBreak$(nextValue: typeof $avoidPageBreak$) {
      writeStore(avoidPageBreak$, nextValue);
    },
    get $pauseTrackerOnCustomPointChange$() {
      return $pauseTrackerOnCustomPointChange$;
    },
    set $pauseTrackerOnCustomPointChange$(nextValue: typeof $pauseTrackerOnCustomPointChange$) {
      writeStore(pauseTrackerOnCustomPointChange$, nextValue);
    },
    get $customReadingPointEnabled$() {
      return $customReadingPointEnabled$;
    },
    set $customReadingPointEnabled$(nextValue: typeof $customReadingPointEnabled$) {
      writeStore(customReadingPointEnabled$, nextValue);
    },
    get $selectionToBookmarkEnabled$() {
      return $selectionToBookmarkEnabled$;
    },
    set $selectionToBookmarkEnabled$(nextValue: typeof $selectionToBookmarkEnabled$) {
      writeStore(selectionToBookmarkEnabled$, nextValue);
    },
    get $enableTapEdgeToFlip$() {
      return $enableTapEdgeToFlip$;
    },
    set $enableTapEdgeToFlip$(nextValue: typeof $enableTapEdgeToFlip$) {
      writeStore(enableTapEdgeToFlip$, nextValue);
    },
    get $pageColumns$() {
      return $pageColumns$;
    },
    set $pageColumns$(nextValue: typeof $pageColumns$) {
      writeStore(pageColumns$, nextValue);
    },
    get $persistentStorage$() {
      return $persistentStorage$;
    },
    set $persistentStorage$(nextValue: typeof $persistentStorage$) {
      writeStore(persistentStorage$, nextValue);
    },
    get $hideExternalReadHint$() {
      return $hideExternalReadHint$;
    },
    set $hideExternalReadHint$(nextValue: typeof $hideExternalReadHint$) {
      writeStore(hideExternalReadHint$, nextValue);
    },
    get $confirmClose$() {
      return $confirmClose$;
    },
    set $confirmClose$(nextValue: typeof $confirmClose$) {
      writeStore(confirmClose$, nextValue);
    },
    get $manualBookmark$() {
      return $manualBookmark$;
    },
    set $manualBookmark$(nextValue: typeof $manualBookmark$) {
      writeStore(manualBookmark$, nextValue);
    },
    get $autoBookmark$() {
      return $autoBookmark$;
    },
    set $autoBookmark$(nextValue: typeof $autoBookmark$) {
      writeStore(autoBookmark$, nextValue);
    },
    get $autoBookmarkTime$() {
      return $autoBookmarkTime$;
    },
    set $autoBookmarkTime$(nextValue: typeof $autoBookmarkTime$) {
      writeStore(autoBookmarkTime$, nextValue);
    },
    get $importHTMLFixMode$() {
      return $importHTMLFixMode$;
    },
    set $importHTMLFixMode$(nextValue: typeof $importHTMLFixMode$) {
      writeStore(importHTMLFixMode$, nextValue);
    },
    get $restrictImportFixToAnchor$() {
      return $restrictImportFixToAnchor$;
    },
    set $restrictImportFixToAnchor$(nextValue: typeof $restrictImportFixToAnchor$) {
      writeStore(restrictImportFixToAnchor$, nextValue);
    },
    get $cacheStorageData$() {
      return $cacheStorageData$;
    },
    set $cacheStorageData$(nextValue: typeof $cacheStorageData$) {
      writeStore(cacheStorageData$, nextValue);
    },
    get $replicationSaveBehavior$() {
      return $replicationSaveBehavior$;
    },
    set $replicationSaveBehavior$(nextValue: typeof $replicationSaveBehavior$) {
      writeStore(replicationSaveBehavior$, nextValue);
    },
    get $autoReplication$() {
      return $autoReplication$;
    },
    set $autoReplication$(nextValue: typeof $autoReplication$) {
      writeStore(autoReplication$, nextValue);
    },
    get $showExternalPlaceholder$() {
      return $showExternalPlaceholder$;
    },
    set $showExternalPlaceholder$(nextValue: typeof $showExternalPlaceholder$) {
      writeStore(showExternalPlaceholder$, nextValue);
    },
    get $keepLocalStatisticsOnDeletion$() {
      return $keepLocalStatisticsOnDeletion$;
    },
    set $keepLocalStatisticsOnDeletion$(nextValue: typeof $keepLocalStatisticsOnDeletion$) {
      writeStore(keepLocalStatisticsOnDeletion$, nextValue);
    },
    get $overwriteBookCompletion$() {
      return $overwriteBookCompletion$;
    },
    set $overwriteBookCompletion$(nextValue: typeof $overwriteBookCompletion$) {
      writeStore(overwriteBookCompletion$, nextValue);
    },
    get $startDayHoursForTracker$() {
      return $startDayHoursForTracker$;
    },
    set $startDayHoursForTracker$(nextValue: typeof $startDayHoursForTracker$) {
      writeStore(startDayHoursForTracker$, nextValue);
    },
    get $statisticsMergeMode$() {
      return $statisticsMergeMode$;
    },
    set $statisticsMergeMode$(nextValue: typeof $statisticsMergeMode$) {
      writeStore(statisticsMergeMode$, nextValue);
    },
    get $readingGoalsMergeMode$() {
      return $readingGoalsMergeMode$;
    },
    set $readingGoalsMergeMode$(nextValue: typeof $readingGoalsMergeMode$) {
      writeStore(readingGoalsMergeMode$, nextValue);
    },
    get $statisticsEnabled$() {
      return $statisticsEnabled$;
    },
    set $statisticsEnabled$(nextValue: typeof $statisticsEnabled$) {
      writeStore(statisticsEnabled$, nextValue);
    },
    get $trackerAutoPause$() {
      return $trackerAutoPause$;
    },
    set $trackerAutoPause$(nextValue: typeof $trackerAutoPause$) {
      writeStore(trackerAutoPause$, nextValue);
    },
    get $openTrackerOnCompletion$() {
      return $openTrackerOnCompletion$;
    },
    set $openTrackerOnCompletion$(nextValue: typeof $openTrackerOnCompletion$) {
      writeStore(openTrackerOnCompletion$, nextValue);
    },
    get $addCharactersOnCompletion$() {
      return $addCharactersOnCompletion$;
    },
    set $addCharactersOnCompletion$(nextValue: typeof $addCharactersOnCompletion$) {
      writeStore(addCharactersOnCompletion$, nextValue);
    },
    get $trackerAutostartTime$() {
      return $trackerAutostartTime$;
    },
    set $trackerAutostartTime$(nextValue: typeof $trackerAutostartTime$) {
      writeStore(trackerAutostartTime$, nextValue);
    },
    get $trackerIdleTime$() {
      return $trackerIdleTime$;
    },
    set $trackerIdleTime$(nextValue: typeof $trackerIdleTime$) {
      writeStore(trackerIdleTime$, nextValue);
    },
    get $trackerForwardSkipThreshold$() {
      return $trackerForwardSkipThreshold$;
    },
    set $trackerForwardSkipThreshold$(nextValue: typeof $trackerForwardSkipThreshold$) {
      writeStore(trackerForwardSkipThreshold$, nextValue);
    },
    get $trackerBackwardSkipThreshold$() {
      return $trackerBackwardSkipThreshold$;
    },
    set $trackerBackwardSkipThreshold$(nextValue: typeof $trackerBackwardSkipThreshold$) {
      writeStore(trackerBackwardSkipThreshold$, nextValue);
    },
    get $trackerSkipThresholdAction$() {
      return $trackerSkipThresholdAction$;
    },
    set $trackerSkipThresholdAction$(nextValue: typeof $trackerSkipThresholdAction$) {
      writeStore(trackerSkipThresholdAction$, nextValue);
    },
    get $trackerPopupDetection$() {
      return $trackerPopupDetection$;
    },
    set $trackerPopupDetection$(nextValue: typeof $trackerPopupDetection$) {
      writeStore(trackerPopupDetection$, nextValue);
    },
    get $adjustStatisticsAfterIdleTime$() {
      return $adjustStatisticsAfterIdleTime$;
    },
    set $adjustStatisticsAfterIdleTime$(nextValue: typeof $adjustStatisticsAfterIdleTime$) {
      writeStore(adjustStatisticsAfterIdleTime$, nextValue);
    },
    updateProps(_next: Record<string, unknown>) {}
  };
  return api;
}
