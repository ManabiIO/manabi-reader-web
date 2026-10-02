/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { browser } from '$app/environment';
import { resolvedMode$ } from '$lib/appearance/state';
import { TrackerAutoPause, TrackerSkipThresholdAction } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { optionsForToggle, type ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
import { inputClasses } from '$lib/css-classes';
import { BlurMode } from '$lib/data/blur-mode';
import { dialogManager } from '$lib/data/dialog-manager';
import { LocalFont } from '$lib/data/fonts';
import { effectivePrimaryReaderFont, YU_KYOKASHO } from '$lib/data/reader-typography';
import { FuriganaStyle } from '$lib/data/furigana-style';
import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
import { logger } from '$lib/data/logger';
import { MergeMode } from '$lib/data/merge-mode';
import { isAppDefault } from '$lib/data/storage/storage-source-manager';
import { defaultStorageSources } from '$lib/data/storage/storage-types';
import { isStorageSourceAvailable } from '$lib/data/storage/storage-view';
import { customThemes$, database, fontFamilyGroupOne$, fontFamilyGroupTwo$, horizontalCustomReadingPosition$, textMarginMode$, textMarginValue$, theme$, verticalCustomReadingPosition$ } from '$lib/data/store';
import type { TextMarginMode } from '$lib/data/text-margin-mode';
import { availableThemes as availableThemesMap, themeForMode, themeNames } from '$lib/data/theme-option';
import type { VerticalTextOrientation } from '$lib/data/vertical-text-orientation';
import { ViewMode } from '$lib/data/view-mode';
import type { WritingMode } from '$lib/data/writing-mode';
import { secondsToMinutes } from '$lib/functions/statistic-util';
import { MAX_TRACKER_IDLE_MINUTES, trackerIdleSecondsFromMinutes } from '$lib/components/settings/settings-number-policy';
import { ReplicationSaveBehavior, AutoReplicationType } from '$lib/functions/replication/replication-options';
import { map } from 'rxjs';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';
import { MessageDialog } from '../ui/dialogs';
import { AppearanceSettings } from './appearance-settings';
import { ButtonToggleGroup } from './button-toggle-group';
import { SettingsCustomTheme } from './settings-custom-theme';
import { SettingsDimensionPopover } from './settings-dimension-popover';
import { SettingsFontSelector } from './settings-font-selector';
import { SettingsReadingGoals } from './settings-reading-goals';
import { SettingsItemGroup } from './settings-item-group';
import { SettingsStorageSourceList } from './settings-storage-source-list';
import { SettingsUserFontDialog } from './settings-user-font-dialog';
const Input = 'Input';
const Button = 'Button';
const faSpinner = 'faSpinner';
const AppIcon = 'AppIcon';
export interface SettingsContentProps {
selectedTheme: string;
viewMode: ViewMode;
fontFamilyGroupOne: string;
fontFamilyGroupTwo: string;
yuKyokashoAvailable?: boolean | undefined;
fontWeight: number | null;
fontSize: number;
lineHeight: number;
textIndentation: number;
textMarginValue: number;
blurImage: boolean;
blurImageMode: string;
hideFurigana: boolean;
furiganaStyle: FuriganaStyle;
writingMode: WritingMode;
enableFontKerning: boolean;
enableFontVPAL: boolean;
verticalTextOrientation: VerticalTextOrientation;
prioritizeReaderStyles: boolean;
enableTextJustification: boolean;
enableTextWrapPretty: boolean;
textMarginMode: TextMarginMode;
enableReaderWakeLock: boolean;
showCharacterCounter: boolean;
showPercentage: boolean;
showFooterChapterCharacterCounter: boolean;
showFooterChapterPercentage: boolean;
secondDimensionMaxValue: number;
firstDimensionMargin: number;
swipeThreshold: number;
disableWheelNavigation: boolean;
autoPositionOnResize: boolean;
avoidPageBreak: boolean;
pauseTrackerOnCustomPointChange: boolean;
customReadingPointEnabled: boolean;
selectionToBookmarkEnabled: boolean;
enableTapEdgeToFlip: boolean;
pageColumns: number;
storageQuota: string;
persistentStorage: boolean;
requestPersistentStorage: () => Promise<void>;
hideExternalReadHint: boolean;
confirmClose: boolean;
manualBookmark: boolean;
autoBookmark: boolean;
autoBookmarkTime: number;
activeSettings: string;
importHTMLFixMode: string;
restrictImportFixToAnchor: boolean;
cacheStorageData: boolean;
autoReplication: string;
replicationSaveBehavior: string;
showExternalPlaceholder: boolean;
keepLocalStatisticsOnDeletion: boolean;
overwriteBookCompletion: boolean;
startDayHoursForTracker: number;
statisticsMergeMode: string;
readingGoalsMergeMode: string;
statisticsEnabled: boolean;
trackerAutoPause: string;
openTrackerOnCompletion: boolean;
addCharactersOnCompletion: boolean;
trackerAutoStartTime: number;
trackerIdleTime: number;
trackerForwardSkipThreshold: number;
trackerBackwardSkipThreshold: number;
trackerSkipThresholdAction: string;
trackerPopupDetection: boolean;
adjustStatisticsAfterIdleTime: boolean;
}

export function createSettingsContent(props: SettingsContentProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let availablePrimaryFonts: any;
let availableThemes: any;
let optionsForTheme: any;
let verticalTextOrientationTooltip: any;
let autoBookmarkTooltip: any;
let wakeLockSupported: any;
let verticalMode: any;
let fontCacheSupported: any;
let avoidPageBreakTooltip: any;
let persistentStorageTooltip: any;
let cacheStorageDataTooltip: any;
let replicationSaveBehaviorTooltip: any;
let showExternalPlaceholderToolTip: any;
let startOfDayHours: any;
let trackerIdleTimeInMin: any;
let $customThemes$: StoreValue<typeof customThemes$> = __readerController.read(customThemes$);
let $resolvedMode$: StoreValue<typeof resolvedMode$> = __readerController.read(resolvedMode$);
let $textMarginMode$: StoreValue<typeof textMarginMode$> = __readerController.read(textMarginMode$);
let $textMarginValue$: StoreValue<typeof textMarginValue$> = __readerController.read(textMarginValue$);
let $storageSources$: StoreValue<typeof storageSources$> = undefined as never;
let $theme$: StoreValue<typeof theme$> = __readerController.read(theme$);
let selectedTheme: string = props.selectedTheme;
let viewMode: ViewMode = props.viewMode;
let fontFamilyGroupOne: string = props.fontFamilyGroupOne;
let fontFamilyGroupTwo: string = props.fontFamilyGroupTwo;
let yuKyokashoAvailable: boolean | undefined = props.yuKyokashoAvailable !== undefined ? props.yuKyokashoAvailable : undefined;
const primaryFontsWithoutYuKyokasho = [
    LocalFont.NOTOSERIFJP,
    LocalFont.KZUDMINCHO,
    LocalFont.GENEI,
    LocalFont.SHIPPORIMINCHO,
    LocalFont.KLEEONE,
    LocalFont.KLEEONESEMIBOLD,
    LocalFont.SERIF
];
__readerController.effect(() => [yuKyokashoAvailable, primaryFontsWithoutYuKyokasho], () => { __readerController.changed(availablePrimaryFonts =
    yuKyokashoAvailable === true
        ? [LocalFont.YUKYOKASHO, ...primaryFontsWithoutYuKyokasho]
        : primaryFontsWithoutYuKyokasho); });
let editingPrimaryFont = false;
let primaryFontAtFocus = '';
function beginPrimaryFontEdit() {
    __readerController.changed(primaryFontAtFocus = primaryFontInput);
    __readerController.changed(editingPrimaryFont = true);
}
let primaryFontInput = '';
__readerController.effect(() => [editingPrimaryFont, fontFamilyGroupOne, yuKyokashoAvailable], () => { if (!editingPrimaryFont) {
    __readerController.changed(primaryFontInput = effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable));
} });
function commitPrimaryFont() {
    __readerController.changed(editingPrimaryFont = false);
    if (primaryFontInput !== primaryFontAtFocus)
        __readerController.changed(fontFamilyGroupOne = primaryFontInput.trim() || YU_KYOKASHO);
    __readerController.changed(primaryFontInput = effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable));
}
function handlePrimaryFontKeydown(event: KeyboardEvent) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement))
        return;
    if (event.key === 'Enter')
        target.blur();
    if (event.key !== 'Escape')
        return;
    __readerController.changed(primaryFontInput = primaryFontAtFocus);
    __readerController.changed(editingPrimaryFont = false);
    __readerController.changed(primaryFontInput = effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable));
    __readerController.changed(primaryFontAtFocus = primaryFontInput);
    target.blur();
}
let fontWeight: number | null = props.fontWeight;
let fontSize: number = props.fontSize;
let lineHeight: number = props.lineHeight;
let textIndentation: number = props.textIndentation;
let textMarginValue: number = props.textMarginValue;
let blurImage: boolean = props.blurImage;
let blurImageMode: string = props.blurImageMode;
let hideFurigana: boolean = props.hideFurigana;
let furiganaStyle: FuriganaStyle = props.furiganaStyle;
let writingMode: WritingMode = props.writingMode;
let enableFontKerning: boolean = props.enableFontKerning;
let enableFontVPAL: boolean = props.enableFontVPAL;
let verticalTextOrientation: VerticalTextOrientation = props.verticalTextOrientation;
let prioritizeReaderStyles: boolean = props.prioritizeReaderStyles;
let enableTextJustification: boolean = props.enableTextJustification;
let enableTextWrapPretty: boolean = props.enableTextWrapPretty;
let textMarginMode: TextMarginMode = props.textMarginMode;
let enableReaderWakeLock: boolean = props.enableReaderWakeLock;
let showCharacterCounter: boolean = props.showCharacterCounter;
let showPercentage: boolean = props.showPercentage;
let showFooterChapterCharacterCounter: boolean = props.showFooterChapterCharacterCounter;
let showFooterChapterPercentage: boolean = props.showFooterChapterPercentage;
let secondDimensionMaxValue: number = props.secondDimensionMaxValue;
let firstDimensionMargin: number = props.firstDimensionMargin;
let swipeThreshold: number = props.swipeThreshold;
let disableWheelNavigation: boolean = props.disableWheelNavigation;
let autoPositionOnResize: boolean = props.autoPositionOnResize;
let avoidPageBreak: boolean = props.avoidPageBreak;
let pauseTrackerOnCustomPointChange: boolean = props.pauseTrackerOnCustomPointChange;
let customReadingPointEnabled: boolean = props.customReadingPointEnabled;
let selectionToBookmarkEnabled: boolean = props.selectionToBookmarkEnabled;
let enableTapEdgeToFlip: boolean = props.enableTapEdgeToFlip;
let pageColumns: number = props.pageColumns;
let storageQuota: string = props.storageQuota;
let persistentStorage: boolean = props.persistentStorage;
let requestPersistentStorage: () => Promise<void> = props.requestPersistentStorage;
let hideExternalReadHint: boolean = props.hideExternalReadHint;
let confirmClose: boolean = props.confirmClose;
let manualBookmark: boolean = props.manualBookmark;
let autoBookmark: boolean = props.autoBookmark;
let autoBookmarkTime: number = props.autoBookmarkTime;
let activeSettings: string = props.activeSettings;
let importHTMLFixMode: string = props.importHTMLFixMode;
let restrictImportFixToAnchor: boolean = props.restrictImportFixToAnchor;
let cacheStorageData: boolean = props.cacheStorageData;
let autoReplication: string = props.autoReplication;
let replicationSaveBehavior: string = props.replicationSaveBehavior;
let showExternalPlaceholder: boolean = props.showExternalPlaceholder;
let keepLocalStatisticsOnDeletion: boolean = props.keepLocalStatisticsOnDeletion;
let overwriteBookCompletion: boolean = props.overwriteBookCompletion;
let startDayHoursForTracker: number = props.startDayHoursForTracker;
let statisticsMergeMode: string = props.statisticsMergeMode;
let readingGoalsMergeMode: string = props.readingGoalsMergeMode;
let statisticsEnabled: boolean = props.statisticsEnabled;
let trackerAutoPause: string = props.trackerAutoPause;
let openTrackerOnCompletion: boolean = props.openTrackerOnCompletion;
let addCharactersOnCompletion: boolean = props.addCharactersOnCompletion;
let trackerAutoStartTime: number = props.trackerAutoStartTime;
let trackerIdleTime: number = props.trackerIdleTime;
let trackerForwardSkipThreshold: number = props.trackerForwardSkipThreshold;
let trackerBackwardSkipThreshold: number = props.trackerBackwardSkipThreshold;
let trackerSkipThresholdAction: string = props.trackerSkipThresholdAction;
let trackerPopupDetection: boolean = props.trackerPopupDetection;
let adjustStatisticsAfterIdleTime: boolean = props.adjustStatisticsAfterIdleTime;
__readerController.effect(() => [$customThemes$, $resolvedMode$], () => { __readerController.changed(availableThemes = (browser
    ? [...Array.from(availableThemesMap.entries()), ...Object.entries($customThemes$)]
    : Array.from(availableThemesMap.entries())).map(([theme]) => ({
    theme,
    option: themeForMode(theme, $resolvedMode$, $customThemes$)
}))); });
__readerController.effect(() => [availableThemes], () => { __readerController.changed(optionsForTheme = availableThemes.map(({ theme, option }) => ({
    id: theme,
    text: Object.hasOwn(themeNames, theme) ? themeNames[theme] : theme.replace(/^custom-/, ''),
    style: {
        color: option.fontColor,
        'background-color': option.backgroundColor
    },
    thickBorders: true,
    showIcons: true
}))); });
__readerController.onDestroy(() => dialogManager.dialogs$.next([]));
const optionsForFuriganaStyle: ToggleOption<FuriganaStyle>[] = [
    {
        id: FuriganaStyle.Hide,
        text: 'Hide'
    },
    {
        id: FuriganaStyle.Partial,
        text: 'Partial'
    },
    {
        id: FuriganaStyle.Toggle,
        text: 'Toggle'
    },
    {
        id: FuriganaStyle.Full,
        text: 'Full'
    }
];
const optionsForWritingMode: ToggleOption<WritingMode>[] = [
    {
        id: 'horizontal-tb',
        text: 'Horizontal'
    },
    {
        id: 'vertical-rl',
        text: 'Vertical'
    }
];
const optionsForVerticalTextOrientation: ToggleOption<VerticalTextOrientation>[] = [
    {
        id: 'mixed',
        text: 'Mixed'
    },
    {
        id: 'upright',
        text: 'Upright'
    }
];
const optionsForTextMarginMode: ToggleOption<TextMarginMode>[] = [
    {
        id: 'auto',
        text: 'Auto'
    },
    {
        id: 'manual',
        text: 'Manual'
    }
];
const optionsForViewMode: ToggleOption<ViewMode>[] = [
    {
        id: ViewMode.Continuous,
        text: 'Continuous'
    },
    {
        id: ViewMode.Paginated,
        text: 'Paginated'
    }
];
const optionsForBlurMode: ToggleOption<BlurMode>[] = [
    {
        id: BlurMode.ALL,
        text: 'All'
    },
    {
        id: BlurMode.AFTER_TOC,
        text: 'After ToC'
    }
];
const optionsForImportHTMLFixes: ToggleOption<ImportHTMLFixMode>[] = [
    {
        id: ImportHTMLFixMode.OFF,
        text: 'Off'
    },
    {
        id: ImportHTMLFixMode.STANDARD,
        text: 'Standard'
    },
    {
        id: ImportHTMLFixMode.EXTENDED,
        text: 'Extended'
    }
];
const optionsForAutoReplicationType: ToggleOption<AutoReplicationType>[] = [
    {
        id: AutoReplicationType.Off,
        text: 'Off'
    },
    {
        id: AutoReplicationType.Up,
        text: 'Up'
    },
    {
        id: AutoReplicationType.Down,
        text: 'Down'
    },
    {
        id: AutoReplicationType.All,
        text: 'All'
    }
];
const optionsForReplicationSaveBehavior: ToggleOption<ReplicationSaveBehavior>[] = [
    {
        id: ReplicationSaveBehavior.NewOnly,
        text: 'New Only'
    },
    {
        id: ReplicationSaveBehavior.Overwrite,
        text: 'Overwrite'
    }
];
const optionsForTrackerAutoPause: ToggleOption<TrackerAutoPause>[] = [
    {
        id: TrackerAutoPause.OFF,
        text: 'Off'
    },
    {
        id: TrackerAutoPause.MODERATE,
        text: 'Moderate'
    },
    {
        id: TrackerAutoPause.STRICT,
        text: 'Strict'
    }
];
const optionsForTrackerSkipThresholdAction: ToggleOption<TrackerSkipThresholdAction>[] = [
    {
        id: TrackerSkipThresholdAction.IGNORE,
        text: 'Ignore'
    },
    {
        id: TrackerSkipThresholdAction.PAUSE,
        text: 'Pause Tracker'
    }
];
const optionsForMergeMode: ToggleOption<MergeMode>[] = [
    {
        id: MergeMode.MERGE,
        text: 'Merge'
    },
    {
        id: MergeMode.REPLACE,
        text: 'Replace'
    }
];
const storageSources$ = database.storageSourcesChanged$.pipe(map((storageSources) => [
    ...defaultStorageSources
        .filter((defaultStorageSource) => isStorageSourceAvailable(defaultStorageSource.type, defaultStorageSource.name, window))
        .map((defaultStorageSource) => ({
        name: defaultStorageSource.name,
        type: defaultStorageSource.type,
        storedInManager: false,
        encryptionDisabled: false,
        data: new ArrayBuffer(0),
        lastSourceModified: 0
    })),
    ...storageSources.filter((storageSource) => !isAppDefault(storageSource.name))
]));
let showSpinner = false;
let furiganaStyleTooltip = '';
let importHTMLFixModeTooltip = '';
let autoReplicationTypeTooltip = '';
let trackerAutoPauseTooltip = '';
__readerController.effect(() => [$textMarginMode$], () => { if ($textMarginMode$ === 'auto') {
    writeStore(textMarginValue$, 0);
} });
__readerController.effect(() => [verticalTextOrientation], () => { __readerController.changed(verticalTextOrientationTooltip =
    verticalTextOrientation === 'mixed'
        ? 'Rotates the characters of horizontal scripts 90° clockwise'
        : 'Lays out the characters of horizontal scripts naturally (upright), as well as the glyphs for vertical scripts.'); });
__readerController.effect(() => [autoBookmarkTime], () => { __readerController.changed(autoBookmarkTooltip = `If enabled sets a bookmark after ${autoBookmarkTime} seconds without scrolling/page change`); });
__readerController.effect(() => [], () => { __readerController.changed(wakeLockSupported = browser && 'wakeLock' in navigator); });
__readerController.effect(() => [writingMode], () => { __readerController.changed(verticalMode = writingMode === 'vertical-rl'); });
__readerController.effect(() => [], () => { __readerController.changed(fontCacheSupported = browser && 'caches' in window); });
__readerController.effect(() => [furiganaStyle], () => { switch (furiganaStyle) {
    case FuriganaStyle.Hide:
        __readerController.changed(furiganaStyleTooltip = 'Always hidden');
        break;
    case FuriganaStyle.Toggle:
        __readerController.changed(furiganaStyleTooltip = 'Hidden by default, can be toggled on click');
        break;
    case FuriganaStyle.Full:
        __readerController.changed(furiganaStyleTooltip = 'Hidden by default, show on hover or click');
        break;
    default:
        __readerController.changed(furiganaStyleTooltip = 'Display furigana as grayed out text');
        break;
} });
__readerController.effect(() => [avoidPageBreak], () => { __readerController.changed(avoidPageBreakTooltip = avoidPageBreak
    ? 'Avoids breaking words/sentences into different pages'
    : 'Allow words/sentences to break into different pages'); });
__readerController.effect(() => [persistentStorage], () => { __readerController.changed(persistentStorageTooltip = persistentStorage
    ? 'Browser storage is protected from automatic eviction. The user can still clear site data.'
    : 'Reader requests browser storage protection automatically when saving books locally. Until granted, local data remains best-effort and may be evicted under storage pressure.'); });
__readerController.effect(() => [importHTMLFixMode], () => { switch (importHTMLFixMode) {
    case ImportHTMLFixMode.OFF:
        __readerController.changed(importHTMLFixModeTooltip = 'Imports epub files as is');
        break;
    case ImportHTMLFixMode.EXTENDED:
        __readerController.changed(importHTMLFixModeTooltip =
            'Applies additional fixes for epub imports like removing control characters, replacing html entities etc.');
        break;
    default:
        __readerController.changed(importHTMLFixModeTooltip =
            'Applies fixes for epub imports like wrong self closing elements etc.');
        break;
} });
__readerController.effect(() => [cacheStorageData], () => { __readerController.changed(cacheStorageDataTooltip = cacheStorageData
    ? 'Storage data is cached. Saves network traffic/latency but requires to reload current/open a new tab to retrieve data changes'
    : 'Storage data is refetched on every action. May consume more network traffic/latency but ensures current data'); });
__readerController.effect(() => [replicationSaveBehavior], () => { __readerController.changed(replicationSaveBehaviorTooltip =
    replicationSaveBehavior === ReplicationSaveBehavior.Overwrite
        ? 'Data will always be overwritten'
        : 'Data will only be written if none exist on target, no time data is present or if target data is older'); });
__readerController.effect(() => [autoReplication], () => { switch (autoReplication) {
    case AutoReplicationType.Up:
        __readerController.changed(autoReplicationTypeTooltip =
            'Updated data will be exported to sync target when reading once per minute');
        break;
    case AutoReplicationType.Down:
        __readerController.changed(autoReplicationTypeTooltip = 'Data will be imported from sync target when opening a book');
        break;
    case AutoReplicationType.All:
        __readerController.changed(autoReplicationTypeTooltip = 'Data will be synced in both directions');
        break;
    default:
        __readerController.changed(autoReplicationTypeTooltip = 'No automatic import/export of data');
        break;
} });
__readerController.effect(() => [showExternalPlaceholder], () => { __readerController.changed(showExternalPlaceholderToolTip = showExternalPlaceholder
    ? 'Placeholder data for external books is shown in the browser source manager'
    : 'Placeholder data for external books is hidden'); });
__readerController.effect(() => [startDayHoursForTracker], () => { __readerController.changed(startOfDayHours = `${`${startDayHoursForTracker}`.padStart(2, '0')}:00`); });
__readerController.effect(() => [trackerIdleTime], () => { __readerController.changed(trackerIdleTimeInMin = secondsToMinutes(trackerIdleTime)); });
__readerController.effect(() => [trackerAutoPause], () => { switch (trackerAutoPause) {
    case TrackerAutoPause.OFF:
        __readerController.changed(trackerAutoPauseTooltip = 'Tracker does not auto pause except for certain reader events');
        break;
    case TrackerAutoPause.STRICT:
        __readerController.changed(trackerAutoPauseTooltip =
            'Tracker will auto pause on certain reader events and any kind of site focus loss (e. g. dictionary popup)');
        break;
    default:
        __readerController.changed(trackerAutoPauseTooltip =
            'Tracker will auto pause on certain reader events and when the reader tab loses focus');
        break;
} });
__readerController.effect(() => [activeSettings, $storageSources$], () => { if (browser &&
    (activeSettings === 'Data' || activeSettings === 'Statistics' || activeSettings === 'All') &&
    !$storageSources$) {
    database
        .getStorageSources()
        .then((storageSources) => {
        database.storageSourcesChanged$.next(storageSources);
    })
        .catch((error) => {
        logger.error(`Failed to retrieve storage sources: ${error.message}`);
        database.storageSourcesChanged$.next([]);
    });
} });
__readerController.observeSource(() => customThemes$, (value) => { $customThemes$ = value; });
__readerController.observeSource(() => resolvedMode$, (value) => { $resolvedMode$ = value; });
__readerController.observeSource(() => textMarginMode$, (value) => { $textMarginMode$ = value; });
__readerController.observeSource(() => textMarginValue$, (value) => { $textMarginValue$ = value; });
$storageSources$ = __readerController.read(storageSources$);
__readerController.observeSource(() => storageSources$, (value) => { $storageSources$ = value; });
__readerController.observeSource(() => theme$, (value) => { $theme$ = value; });
const api = { controller: __readerController, beginPrimaryFontEdit, commitPrimaryFont, handlePrimaryFontKeydown,
get selectedTheme() { return selectedTheme; }, set selectedTheme(nextValue: typeof selectedTheme) { if (Object.is(selectedTheme, nextValue)) return; selectedTheme = nextValue; __readerController.invalidate(); },
get viewMode() { return viewMode; }, set viewMode(nextValue: typeof viewMode) { if (Object.is(viewMode, nextValue)) return; viewMode = nextValue; __readerController.invalidate(); },
get fontFamilyGroupOne() { return fontFamilyGroupOne; }, set fontFamilyGroupOne(nextValue: typeof fontFamilyGroupOne) { if (Object.is(fontFamilyGroupOne, nextValue)) return; fontFamilyGroupOne = nextValue; __readerController.invalidate(); },
get fontFamilyGroupTwo() { return fontFamilyGroupTwo; }, set fontFamilyGroupTwo(nextValue: typeof fontFamilyGroupTwo) { if (Object.is(fontFamilyGroupTwo, nextValue)) return; fontFamilyGroupTwo = nextValue; __readerController.invalidate(); },
get yuKyokashoAvailable() { return yuKyokashoAvailable; }, set yuKyokashoAvailable(nextValue: typeof yuKyokashoAvailable) { if (Object.is(yuKyokashoAvailable, nextValue)) return; yuKyokashoAvailable = nextValue; __readerController.invalidate(); },
get primaryFontsWithoutYuKyokasho() { return primaryFontsWithoutYuKyokasho; },
get editingPrimaryFont() { return editingPrimaryFont; }, set editingPrimaryFont(nextValue: typeof editingPrimaryFont) { if (Object.is(editingPrimaryFont, nextValue)) return; editingPrimaryFont = nextValue; __readerController.invalidate(); },
get primaryFontAtFocus() { return primaryFontAtFocus; }, set primaryFontAtFocus(nextValue: typeof primaryFontAtFocus) { if (Object.is(primaryFontAtFocus, nextValue)) return; primaryFontAtFocus = nextValue; __readerController.invalidate(); },
get primaryFontInput() { return primaryFontInput; }, set primaryFontInput(nextValue: typeof primaryFontInput) { if (Object.is(primaryFontInput, nextValue)) return; primaryFontInput = nextValue; __readerController.invalidate(); },
get fontWeight() { return fontWeight; }, set fontWeight(nextValue: typeof fontWeight) { if (Object.is(fontWeight, nextValue)) return; fontWeight = nextValue; __readerController.invalidate(); },
get fontSize() { return fontSize; }, set fontSize(nextValue: typeof fontSize) { if (Object.is(fontSize, nextValue)) return; fontSize = nextValue; __readerController.invalidate(); },
get lineHeight() { return lineHeight; }, set lineHeight(nextValue: typeof lineHeight) { if (Object.is(lineHeight, nextValue)) return; lineHeight = nextValue; __readerController.invalidate(); },
get textIndentation() { return textIndentation; }, set textIndentation(nextValue: typeof textIndentation) { if (Object.is(textIndentation, nextValue)) return; textIndentation = nextValue; __readerController.invalidate(); },
get textMarginValue() { return textMarginValue; }, set textMarginValue(nextValue: typeof textMarginValue) { if (Object.is(textMarginValue, nextValue)) return; textMarginValue = nextValue; __readerController.invalidate(); },
get blurImage() { return blurImage; }, set blurImage(nextValue: typeof blurImage) { if (Object.is(blurImage, nextValue)) return; blurImage = nextValue; __readerController.invalidate(); },
get blurImageMode() { return blurImageMode; }, set blurImageMode(nextValue: typeof blurImageMode) { if (Object.is(blurImageMode, nextValue)) return; blurImageMode = nextValue; __readerController.invalidate(); },
get hideFurigana() { return hideFurigana; }, set hideFurigana(nextValue: typeof hideFurigana) { if (Object.is(hideFurigana, nextValue)) return; hideFurigana = nextValue; __readerController.invalidate(); },
get furiganaStyle() { return furiganaStyle; }, set furiganaStyle(nextValue: typeof furiganaStyle) { if (Object.is(furiganaStyle, nextValue)) return; furiganaStyle = nextValue; __readerController.invalidate(); },
get writingMode() { return writingMode; }, set writingMode(nextValue: typeof writingMode) { if (Object.is(writingMode, nextValue)) return; writingMode = nextValue; __readerController.invalidate(); },
get enableFontKerning() { return enableFontKerning; }, set enableFontKerning(nextValue: typeof enableFontKerning) { if (Object.is(enableFontKerning, nextValue)) return; enableFontKerning = nextValue; __readerController.invalidate(); },
get enableFontVPAL() { return enableFontVPAL; }, set enableFontVPAL(nextValue: typeof enableFontVPAL) { if (Object.is(enableFontVPAL, nextValue)) return; enableFontVPAL = nextValue; __readerController.invalidate(); },
get verticalTextOrientation() { return verticalTextOrientation; }, set verticalTextOrientation(nextValue: typeof verticalTextOrientation) { if (Object.is(verticalTextOrientation, nextValue)) return; verticalTextOrientation = nextValue; __readerController.invalidate(); },
get prioritizeReaderStyles() { return prioritizeReaderStyles; }, set prioritizeReaderStyles(nextValue: typeof prioritizeReaderStyles) { if (Object.is(prioritizeReaderStyles, nextValue)) return; prioritizeReaderStyles = nextValue; __readerController.invalidate(); },
get enableTextJustification() { return enableTextJustification; }, set enableTextJustification(nextValue: typeof enableTextJustification) { if (Object.is(enableTextJustification, nextValue)) return; enableTextJustification = nextValue; __readerController.invalidate(); },
get enableTextWrapPretty() { return enableTextWrapPretty; }, set enableTextWrapPretty(nextValue: typeof enableTextWrapPretty) { if (Object.is(enableTextWrapPretty, nextValue)) return; enableTextWrapPretty = nextValue; __readerController.invalidate(); },
get textMarginMode() { return textMarginMode; }, set textMarginMode(nextValue: typeof textMarginMode) { if (Object.is(textMarginMode, nextValue)) return; textMarginMode = nextValue; __readerController.invalidate(); },
get enableReaderWakeLock() { return enableReaderWakeLock; }, set enableReaderWakeLock(nextValue: typeof enableReaderWakeLock) { if (Object.is(enableReaderWakeLock, nextValue)) return; enableReaderWakeLock = nextValue; __readerController.invalidate(); },
get showCharacterCounter() { return showCharacterCounter; }, set showCharacterCounter(nextValue: typeof showCharacterCounter) { if (Object.is(showCharacterCounter, nextValue)) return; showCharacterCounter = nextValue; __readerController.invalidate(); },
get showPercentage() { return showPercentage; }, set showPercentage(nextValue: typeof showPercentage) { if (Object.is(showPercentage, nextValue)) return; showPercentage = nextValue; __readerController.invalidate(); },
get showFooterChapterCharacterCounter() { return showFooterChapterCharacterCounter; }, set showFooterChapterCharacterCounter(nextValue: typeof showFooterChapterCharacterCounter) { if (Object.is(showFooterChapterCharacterCounter, nextValue)) return; showFooterChapterCharacterCounter = nextValue; __readerController.invalidate(); },
get showFooterChapterPercentage() { return showFooterChapterPercentage; }, set showFooterChapterPercentage(nextValue: typeof showFooterChapterPercentage) { if (Object.is(showFooterChapterPercentage, nextValue)) return; showFooterChapterPercentage = nextValue; __readerController.invalidate(); },
get secondDimensionMaxValue() { return secondDimensionMaxValue; }, set secondDimensionMaxValue(nextValue: typeof secondDimensionMaxValue) { if (Object.is(secondDimensionMaxValue, nextValue)) return; secondDimensionMaxValue = nextValue; __readerController.invalidate(); },
get firstDimensionMargin() { return firstDimensionMargin; }, set firstDimensionMargin(nextValue: typeof firstDimensionMargin) { if (Object.is(firstDimensionMargin, nextValue)) return; firstDimensionMargin = nextValue; __readerController.invalidate(); },
get swipeThreshold() { return swipeThreshold; }, set swipeThreshold(nextValue: typeof swipeThreshold) { if (Object.is(swipeThreshold, nextValue)) return; swipeThreshold = nextValue; __readerController.invalidate(); },
get disableWheelNavigation() { return disableWheelNavigation; }, set disableWheelNavigation(nextValue: typeof disableWheelNavigation) { if (Object.is(disableWheelNavigation, nextValue)) return; disableWheelNavigation = nextValue; __readerController.invalidate(); },
get autoPositionOnResize() { return autoPositionOnResize; }, set autoPositionOnResize(nextValue: typeof autoPositionOnResize) { if (Object.is(autoPositionOnResize, nextValue)) return; autoPositionOnResize = nextValue; __readerController.invalidate(); },
get avoidPageBreak() { return avoidPageBreak; }, set avoidPageBreak(nextValue: typeof avoidPageBreak) { if (Object.is(avoidPageBreak, nextValue)) return; avoidPageBreak = nextValue; __readerController.invalidate(); },
get pauseTrackerOnCustomPointChange() { return pauseTrackerOnCustomPointChange; }, set pauseTrackerOnCustomPointChange(nextValue: typeof pauseTrackerOnCustomPointChange) { if (Object.is(pauseTrackerOnCustomPointChange, nextValue)) return; pauseTrackerOnCustomPointChange = nextValue; __readerController.invalidate(); },
get customReadingPointEnabled() { return customReadingPointEnabled; }, set customReadingPointEnabled(nextValue: typeof customReadingPointEnabled) { if (Object.is(customReadingPointEnabled, nextValue)) return; customReadingPointEnabled = nextValue; __readerController.invalidate(); },
get selectionToBookmarkEnabled() { return selectionToBookmarkEnabled; }, set selectionToBookmarkEnabled(nextValue: typeof selectionToBookmarkEnabled) { if (Object.is(selectionToBookmarkEnabled, nextValue)) return; selectionToBookmarkEnabled = nextValue; __readerController.invalidate(); },
get enableTapEdgeToFlip() { return enableTapEdgeToFlip; }, set enableTapEdgeToFlip(nextValue: typeof enableTapEdgeToFlip) { if (Object.is(enableTapEdgeToFlip, nextValue)) return; enableTapEdgeToFlip = nextValue; __readerController.invalidate(); },
get pageColumns() { return pageColumns; }, set pageColumns(nextValue: typeof pageColumns) { if (Object.is(pageColumns, nextValue)) return; pageColumns = nextValue; __readerController.invalidate(); },
get storageQuota() { return storageQuota; }, set storageQuota(nextValue: typeof storageQuota) { if (Object.is(storageQuota, nextValue)) return; storageQuota = nextValue; __readerController.invalidate(); },
get persistentStorage() { return persistentStorage; }, set persistentStorage(nextValue: typeof persistentStorage) { if (Object.is(persistentStorage, nextValue)) return; persistentStorage = nextValue; __readerController.invalidate(); },
get requestPersistentStorage() { return requestPersistentStorage; }, set requestPersistentStorage(nextValue: typeof requestPersistentStorage) { if (Object.is(requestPersistentStorage, nextValue)) return; requestPersistentStorage = nextValue; __readerController.invalidate(); },
get hideExternalReadHint() { return hideExternalReadHint; }, set hideExternalReadHint(nextValue: typeof hideExternalReadHint) { if (Object.is(hideExternalReadHint, nextValue)) return; hideExternalReadHint = nextValue; __readerController.invalidate(); },
get confirmClose() { return confirmClose; }, set confirmClose(nextValue: typeof confirmClose) { if (Object.is(confirmClose, nextValue)) return; confirmClose = nextValue; __readerController.invalidate(); },
get manualBookmark() { return manualBookmark; }, set manualBookmark(nextValue: typeof manualBookmark) { if (Object.is(manualBookmark, nextValue)) return; manualBookmark = nextValue; __readerController.invalidate(); },
get autoBookmark() { return autoBookmark; }, set autoBookmark(nextValue: typeof autoBookmark) { if (Object.is(autoBookmark, nextValue)) return; autoBookmark = nextValue; __readerController.invalidate(); },
get autoBookmarkTime() { return autoBookmarkTime; }, set autoBookmarkTime(nextValue: typeof autoBookmarkTime) { if (Object.is(autoBookmarkTime, nextValue)) return; autoBookmarkTime = nextValue; __readerController.invalidate(); },
get activeSettings() { return activeSettings; }, set activeSettings(nextValue: typeof activeSettings) { if (Object.is(activeSettings, nextValue)) return; activeSettings = nextValue; __readerController.invalidate(); },
get importHTMLFixMode() { return importHTMLFixMode; }, set importHTMLFixMode(nextValue: typeof importHTMLFixMode) { if (Object.is(importHTMLFixMode, nextValue)) return; importHTMLFixMode = nextValue; __readerController.invalidate(); },
get restrictImportFixToAnchor() { return restrictImportFixToAnchor; }, set restrictImportFixToAnchor(nextValue: typeof restrictImportFixToAnchor) { if (Object.is(restrictImportFixToAnchor, nextValue)) return; restrictImportFixToAnchor = nextValue; __readerController.invalidate(); },
get cacheStorageData() { return cacheStorageData; }, set cacheStorageData(nextValue: typeof cacheStorageData) { if (Object.is(cacheStorageData, nextValue)) return; cacheStorageData = nextValue; __readerController.invalidate(); },
get autoReplication() { return autoReplication; }, set autoReplication(nextValue: typeof autoReplication) { if (Object.is(autoReplication, nextValue)) return; autoReplication = nextValue; __readerController.invalidate(); },
get replicationSaveBehavior() { return replicationSaveBehavior; }, set replicationSaveBehavior(nextValue: typeof replicationSaveBehavior) { if (Object.is(replicationSaveBehavior, nextValue)) return; replicationSaveBehavior = nextValue; __readerController.invalidate(); },
get showExternalPlaceholder() { return showExternalPlaceholder; }, set showExternalPlaceholder(nextValue: typeof showExternalPlaceholder) { if (Object.is(showExternalPlaceholder, nextValue)) return; showExternalPlaceholder = nextValue; __readerController.invalidate(); },
get keepLocalStatisticsOnDeletion() { return keepLocalStatisticsOnDeletion; }, set keepLocalStatisticsOnDeletion(nextValue: typeof keepLocalStatisticsOnDeletion) { if (Object.is(keepLocalStatisticsOnDeletion, nextValue)) return; keepLocalStatisticsOnDeletion = nextValue; __readerController.invalidate(); },
get overwriteBookCompletion() { return overwriteBookCompletion; }, set overwriteBookCompletion(nextValue: typeof overwriteBookCompletion) { if (Object.is(overwriteBookCompletion, nextValue)) return; overwriteBookCompletion = nextValue; __readerController.invalidate(); },
get startDayHoursForTracker() { return startDayHoursForTracker; }, set startDayHoursForTracker(nextValue: typeof startDayHoursForTracker) { if (Object.is(startDayHoursForTracker, nextValue)) return; startDayHoursForTracker = nextValue; __readerController.invalidate(); },
get statisticsMergeMode() { return statisticsMergeMode; }, set statisticsMergeMode(nextValue: typeof statisticsMergeMode) { if (Object.is(statisticsMergeMode, nextValue)) return; statisticsMergeMode = nextValue; __readerController.invalidate(); },
get readingGoalsMergeMode() { return readingGoalsMergeMode; }, set readingGoalsMergeMode(nextValue: typeof readingGoalsMergeMode) { if (Object.is(readingGoalsMergeMode, nextValue)) return; readingGoalsMergeMode = nextValue; __readerController.invalidate(); },
get statisticsEnabled() { return statisticsEnabled; }, set statisticsEnabled(nextValue: typeof statisticsEnabled) { if (Object.is(statisticsEnabled, nextValue)) return; statisticsEnabled = nextValue; __readerController.invalidate(); },
get trackerAutoPause() { return trackerAutoPause; }, set trackerAutoPause(nextValue: typeof trackerAutoPause) { if (Object.is(trackerAutoPause, nextValue)) return; trackerAutoPause = nextValue; __readerController.invalidate(); },
get openTrackerOnCompletion() { return openTrackerOnCompletion; }, set openTrackerOnCompletion(nextValue: typeof openTrackerOnCompletion) { if (Object.is(openTrackerOnCompletion, nextValue)) return; openTrackerOnCompletion = nextValue; __readerController.invalidate(); },
get addCharactersOnCompletion() { return addCharactersOnCompletion; }, set addCharactersOnCompletion(nextValue: typeof addCharactersOnCompletion) { if (Object.is(addCharactersOnCompletion, nextValue)) return; addCharactersOnCompletion = nextValue; __readerController.invalidate(); },
get trackerAutoStartTime() { return trackerAutoStartTime; }, set trackerAutoStartTime(nextValue: typeof trackerAutoStartTime) { if (Object.is(trackerAutoStartTime, nextValue)) return; trackerAutoStartTime = nextValue; __readerController.invalidate(); },
get trackerIdleTime() { return trackerIdleTime; }, set trackerIdleTime(nextValue: typeof trackerIdleTime) { if (Object.is(trackerIdleTime, nextValue)) return; trackerIdleTime = nextValue; __readerController.invalidate(); },
get trackerForwardSkipThreshold() { return trackerForwardSkipThreshold; }, set trackerForwardSkipThreshold(nextValue: typeof trackerForwardSkipThreshold) { if (Object.is(trackerForwardSkipThreshold, nextValue)) return; trackerForwardSkipThreshold = nextValue; __readerController.invalidate(); },
get trackerBackwardSkipThreshold() { return trackerBackwardSkipThreshold; }, set trackerBackwardSkipThreshold(nextValue: typeof trackerBackwardSkipThreshold) { if (Object.is(trackerBackwardSkipThreshold, nextValue)) return; trackerBackwardSkipThreshold = nextValue; __readerController.invalidate(); },
get trackerSkipThresholdAction() { return trackerSkipThresholdAction; }, set trackerSkipThresholdAction(nextValue: typeof trackerSkipThresholdAction) { if (Object.is(trackerSkipThresholdAction, nextValue)) return; trackerSkipThresholdAction = nextValue; __readerController.invalidate(); },
get trackerPopupDetection() { return trackerPopupDetection; }, set trackerPopupDetection(nextValue: typeof trackerPopupDetection) { if (Object.is(trackerPopupDetection, nextValue)) return; trackerPopupDetection = nextValue; __readerController.invalidate(); },
get adjustStatisticsAfterIdleTime() { return adjustStatisticsAfterIdleTime; }, set adjustStatisticsAfterIdleTime(nextValue: typeof adjustStatisticsAfterIdleTime) { if (Object.is(adjustStatisticsAfterIdleTime, nextValue)) return; adjustStatisticsAfterIdleTime = nextValue; __readerController.invalidate(); },
get optionsForFuriganaStyle() { return optionsForFuriganaStyle; },
get optionsForWritingMode() { return optionsForWritingMode; },
get optionsForVerticalTextOrientation() { return optionsForVerticalTextOrientation; },
get optionsForTextMarginMode() { return optionsForTextMarginMode; },
get optionsForViewMode() { return optionsForViewMode; },
get optionsForBlurMode() { return optionsForBlurMode; },
get optionsForImportHTMLFixes() { return optionsForImportHTMLFixes; },
get optionsForAutoReplicationType() { return optionsForAutoReplicationType; },
get optionsForReplicationSaveBehavior() { return optionsForReplicationSaveBehavior; },
get optionsForTrackerAutoPause() { return optionsForTrackerAutoPause; },
get optionsForTrackerSkipThresholdAction() { return optionsForTrackerSkipThresholdAction; },
get optionsForMergeMode() { return optionsForMergeMode; },
get storageSources$() { return storageSources$; },
get showSpinner() { return showSpinner; }, set showSpinner(nextValue: typeof showSpinner) { if (Object.is(showSpinner, nextValue)) return; showSpinner = nextValue; __readerController.invalidate(); },
get furiganaStyleTooltip() { return furiganaStyleTooltip; }, set furiganaStyleTooltip(nextValue: typeof furiganaStyleTooltip) { if (Object.is(furiganaStyleTooltip, nextValue)) return; furiganaStyleTooltip = nextValue; __readerController.invalidate(); },
get importHTMLFixModeTooltip() { return importHTMLFixModeTooltip; }, set importHTMLFixModeTooltip(nextValue: typeof importHTMLFixModeTooltip) { if (Object.is(importHTMLFixModeTooltip, nextValue)) return; importHTMLFixModeTooltip = nextValue; __readerController.invalidate(); },
get autoReplicationTypeTooltip() { return autoReplicationTypeTooltip; }, set autoReplicationTypeTooltip(nextValue: typeof autoReplicationTypeTooltip) { if (Object.is(autoReplicationTypeTooltip, nextValue)) return; autoReplicationTypeTooltip = nextValue; __readerController.invalidate(); },
get trackerAutoPauseTooltip() { return trackerAutoPauseTooltip; }, set trackerAutoPauseTooltip(nextValue: typeof trackerAutoPauseTooltip) { if (Object.is(trackerAutoPauseTooltip, nextValue)) return; trackerAutoPauseTooltip = nextValue; __readerController.invalidate(); },
get availablePrimaryFonts() { return availablePrimaryFonts; }, set availablePrimaryFonts(nextValue: typeof availablePrimaryFonts) { if (Object.is(availablePrimaryFonts, nextValue)) return; availablePrimaryFonts = nextValue; __readerController.invalidate(); },
get availableThemes() { return availableThemes; }, set availableThemes(nextValue: typeof availableThemes) { if (Object.is(availableThemes, nextValue)) return; availableThemes = nextValue; __readerController.invalidate(); },
get optionsForTheme() { return optionsForTheme; }, set optionsForTheme(nextValue: typeof optionsForTheme) { if (Object.is(optionsForTheme, nextValue)) return; optionsForTheme = nextValue; __readerController.invalidate(); },
get verticalTextOrientationTooltip() { return verticalTextOrientationTooltip; }, set verticalTextOrientationTooltip(nextValue: typeof verticalTextOrientationTooltip) { if (Object.is(verticalTextOrientationTooltip, nextValue)) return; verticalTextOrientationTooltip = nextValue; __readerController.invalidate(); },
get autoBookmarkTooltip() { return autoBookmarkTooltip; }, set autoBookmarkTooltip(nextValue: typeof autoBookmarkTooltip) { if (Object.is(autoBookmarkTooltip, nextValue)) return; autoBookmarkTooltip = nextValue; __readerController.invalidate(); },
get wakeLockSupported() { return wakeLockSupported; }, set wakeLockSupported(nextValue: typeof wakeLockSupported) { if (Object.is(wakeLockSupported, nextValue)) return; wakeLockSupported = nextValue; __readerController.invalidate(); },
get verticalMode() { return verticalMode; }, set verticalMode(nextValue: typeof verticalMode) { if (Object.is(verticalMode, nextValue)) return; verticalMode = nextValue; __readerController.invalidate(); },
get fontCacheSupported() { return fontCacheSupported; }, set fontCacheSupported(nextValue: typeof fontCacheSupported) { if (Object.is(fontCacheSupported, nextValue)) return; fontCacheSupported = nextValue; __readerController.invalidate(); },
get avoidPageBreakTooltip() { return avoidPageBreakTooltip; }, set avoidPageBreakTooltip(nextValue: typeof avoidPageBreakTooltip) { if (Object.is(avoidPageBreakTooltip, nextValue)) return; avoidPageBreakTooltip = nextValue; __readerController.invalidate(); },
get persistentStorageTooltip() { return persistentStorageTooltip; }, set persistentStorageTooltip(nextValue: typeof persistentStorageTooltip) { if (Object.is(persistentStorageTooltip, nextValue)) return; persistentStorageTooltip = nextValue; __readerController.invalidate(); },
get cacheStorageDataTooltip() { return cacheStorageDataTooltip; }, set cacheStorageDataTooltip(nextValue: typeof cacheStorageDataTooltip) { if (Object.is(cacheStorageDataTooltip, nextValue)) return; cacheStorageDataTooltip = nextValue; __readerController.invalidate(); },
get replicationSaveBehaviorTooltip() { return replicationSaveBehaviorTooltip; }, set replicationSaveBehaviorTooltip(nextValue: typeof replicationSaveBehaviorTooltip) { if (Object.is(replicationSaveBehaviorTooltip, nextValue)) return; replicationSaveBehaviorTooltip = nextValue; __readerController.invalidate(); },
get showExternalPlaceholderToolTip() { return showExternalPlaceholderToolTip; }, set showExternalPlaceholderToolTip(nextValue: typeof showExternalPlaceholderToolTip) { if (Object.is(showExternalPlaceholderToolTip, nextValue)) return; showExternalPlaceholderToolTip = nextValue; __readerController.invalidate(); },
get startOfDayHours() { return startOfDayHours; }, set startOfDayHours(nextValue: typeof startOfDayHours) { if (Object.is(startOfDayHours, nextValue)) return; startOfDayHours = nextValue; __readerController.invalidate(); },
get trackerIdleTimeInMin() { return trackerIdleTimeInMin; }, set trackerIdleTimeInMin(nextValue: typeof trackerIdleTimeInMin) { if (Object.is(trackerIdleTimeInMin, nextValue)) return; trackerIdleTimeInMin = nextValue; __readerController.invalidate(); },
get $customThemes$() { return $customThemes$; }, set $customThemes$(nextValue: typeof $customThemes$) { writeStore(customThemes$, nextValue); },
get $resolvedMode$() { return $resolvedMode$; }, set $resolvedMode$(nextValue: typeof $resolvedMode$) { writeStore(resolvedMode$, nextValue); },
get $textMarginMode$() { return $textMarginMode$; }, set $textMarginMode$(nextValue: typeof $textMarginMode$) { writeStore(textMarginMode$, nextValue); },
get $textMarginValue$() { return $textMarginValue$; }, set $textMarginValue$(nextValue: typeof $textMarginValue$) { writeStore(textMarginValue$, nextValue); },
get $storageSources$() { return $storageSources$; }, set $storageSources$(nextValue: typeof $storageSources$) { writeStore(storageSources$, nextValue); },
get $theme$() { return $theme$; }, set $theme$(nextValue: typeof $theme$) { writeStore(theme$, nextValue); },
updateProps(next: Record<string, unknown>) {
if ('selectedTheme' in next) api.selectedTheme = next.selectedTheme as typeof selectedTheme;
if ('viewMode' in next) api.viewMode = next.viewMode as typeof viewMode;
if ('fontFamilyGroupOne' in next) api.fontFamilyGroupOne = next.fontFamilyGroupOne as typeof fontFamilyGroupOne;
if ('fontFamilyGroupTwo' in next) api.fontFamilyGroupTwo = next.fontFamilyGroupTwo as typeof fontFamilyGroupTwo;
if ('yuKyokashoAvailable' in next) api.yuKyokashoAvailable = next.yuKyokashoAvailable as typeof yuKyokashoAvailable;
if ('fontWeight' in next) api.fontWeight = next.fontWeight as typeof fontWeight;
if ('fontSize' in next) api.fontSize = next.fontSize as typeof fontSize;
if ('lineHeight' in next) api.lineHeight = next.lineHeight as typeof lineHeight;
if ('textIndentation' in next) api.textIndentation = next.textIndentation as typeof textIndentation;
if ('textMarginValue' in next) api.textMarginValue = next.textMarginValue as typeof textMarginValue;
if ('blurImage' in next) api.blurImage = next.blurImage as typeof blurImage;
if ('blurImageMode' in next) api.blurImageMode = next.blurImageMode as typeof blurImageMode;
if ('hideFurigana' in next) api.hideFurigana = next.hideFurigana as typeof hideFurigana;
if ('furiganaStyle' in next) api.furiganaStyle = next.furiganaStyle as typeof furiganaStyle;
if ('writingMode' in next) api.writingMode = next.writingMode as typeof writingMode;
if ('enableFontKerning' in next) api.enableFontKerning = next.enableFontKerning as typeof enableFontKerning;
if ('enableFontVPAL' in next) api.enableFontVPAL = next.enableFontVPAL as typeof enableFontVPAL;
if ('verticalTextOrientation' in next) api.verticalTextOrientation = next.verticalTextOrientation as typeof verticalTextOrientation;
if ('prioritizeReaderStyles' in next) api.prioritizeReaderStyles = next.prioritizeReaderStyles as typeof prioritizeReaderStyles;
if ('enableTextJustification' in next) api.enableTextJustification = next.enableTextJustification as typeof enableTextJustification;
if ('enableTextWrapPretty' in next) api.enableTextWrapPretty = next.enableTextWrapPretty as typeof enableTextWrapPretty;
if ('textMarginMode' in next) api.textMarginMode = next.textMarginMode as typeof textMarginMode;
if ('enableReaderWakeLock' in next) api.enableReaderWakeLock = next.enableReaderWakeLock as typeof enableReaderWakeLock;
if ('showCharacterCounter' in next) api.showCharacterCounter = next.showCharacterCounter as typeof showCharacterCounter;
if ('showPercentage' in next) api.showPercentage = next.showPercentage as typeof showPercentage;
if ('showFooterChapterCharacterCounter' in next) api.showFooterChapterCharacterCounter = next.showFooterChapterCharacterCounter as typeof showFooterChapterCharacterCounter;
if ('showFooterChapterPercentage' in next) api.showFooterChapterPercentage = next.showFooterChapterPercentage as typeof showFooterChapterPercentage;
if ('secondDimensionMaxValue' in next) api.secondDimensionMaxValue = next.secondDimensionMaxValue as typeof secondDimensionMaxValue;
if ('firstDimensionMargin' in next) api.firstDimensionMargin = next.firstDimensionMargin as typeof firstDimensionMargin;
if ('swipeThreshold' in next) api.swipeThreshold = next.swipeThreshold as typeof swipeThreshold;
if ('disableWheelNavigation' in next) api.disableWheelNavigation = next.disableWheelNavigation as typeof disableWheelNavigation;
if ('autoPositionOnResize' in next) api.autoPositionOnResize = next.autoPositionOnResize as typeof autoPositionOnResize;
if ('avoidPageBreak' in next) api.avoidPageBreak = next.avoidPageBreak as typeof avoidPageBreak;
if ('pauseTrackerOnCustomPointChange' in next) api.pauseTrackerOnCustomPointChange = next.pauseTrackerOnCustomPointChange as typeof pauseTrackerOnCustomPointChange;
if ('customReadingPointEnabled' in next) api.customReadingPointEnabled = next.customReadingPointEnabled as typeof customReadingPointEnabled;
if ('selectionToBookmarkEnabled' in next) api.selectionToBookmarkEnabled = next.selectionToBookmarkEnabled as typeof selectionToBookmarkEnabled;
if ('enableTapEdgeToFlip' in next) api.enableTapEdgeToFlip = next.enableTapEdgeToFlip as typeof enableTapEdgeToFlip;
if ('pageColumns' in next) api.pageColumns = next.pageColumns as typeof pageColumns;
if ('storageQuota' in next) api.storageQuota = next.storageQuota as typeof storageQuota;
if ('persistentStorage' in next) api.persistentStorage = next.persistentStorage as typeof persistentStorage;
if ('requestPersistentStorage' in next) api.requestPersistentStorage = next.requestPersistentStorage as typeof requestPersistentStorage;
if ('hideExternalReadHint' in next) api.hideExternalReadHint = next.hideExternalReadHint as typeof hideExternalReadHint;
if ('confirmClose' in next) api.confirmClose = next.confirmClose as typeof confirmClose;
if ('manualBookmark' in next) api.manualBookmark = next.manualBookmark as typeof manualBookmark;
if ('autoBookmark' in next) api.autoBookmark = next.autoBookmark as typeof autoBookmark;
if ('autoBookmarkTime' in next) api.autoBookmarkTime = next.autoBookmarkTime as typeof autoBookmarkTime;
if ('activeSettings' in next) api.activeSettings = next.activeSettings as typeof activeSettings;
if ('importHTMLFixMode' in next) api.importHTMLFixMode = next.importHTMLFixMode as typeof importHTMLFixMode;
if ('restrictImportFixToAnchor' in next) api.restrictImportFixToAnchor = next.restrictImportFixToAnchor as typeof restrictImportFixToAnchor;
if ('cacheStorageData' in next) api.cacheStorageData = next.cacheStorageData as typeof cacheStorageData;
if ('autoReplication' in next) api.autoReplication = next.autoReplication as typeof autoReplication;
if ('replicationSaveBehavior' in next) api.replicationSaveBehavior = next.replicationSaveBehavior as typeof replicationSaveBehavior;
if ('showExternalPlaceholder' in next) api.showExternalPlaceholder = next.showExternalPlaceholder as typeof showExternalPlaceholder;
if ('keepLocalStatisticsOnDeletion' in next) api.keepLocalStatisticsOnDeletion = next.keepLocalStatisticsOnDeletion as typeof keepLocalStatisticsOnDeletion;
if ('overwriteBookCompletion' in next) api.overwriteBookCompletion = next.overwriteBookCompletion as typeof overwriteBookCompletion;
if ('startDayHoursForTracker' in next) api.startDayHoursForTracker = next.startDayHoursForTracker as typeof startDayHoursForTracker;
if ('statisticsMergeMode' in next) api.statisticsMergeMode = next.statisticsMergeMode as typeof statisticsMergeMode;
if ('readingGoalsMergeMode' in next) api.readingGoalsMergeMode = next.readingGoalsMergeMode as typeof readingGoalsMergeMode;
if ('statisticsEnabled' in next) api.statisticsEnabled = next.statisticsEnabled as typeof statisticsEnabled;
if ('trackerAutoPause' in next) api.trackerAutoPause = next.trackerAutoPause as typeof trackerAutoPause;
if ('openTrackerOnCompletion' in next) api.openTrackerOnCompletion = next.openTrackerOnCompletion as typeof openTrackerOnCompletion;
if ('addCharactersOnCompletion' in next) api.addCharactersOnCompletion = next.addCharactersOnCompletion as typeof addCharactersOnCompletion;
if ('trackerAutoStartTime' in next) api.trackerAutoStartTime = next.trackerAutoStartTime as typeof trackerAutoStartTime;
if ('trackerIdleTime' in next) api.trackerIdleTime = next.trackerIdleTime as typeof trackerIdleTime;
if ('trackerForwardSkipThreshold' in next) api.trackerForwardSkipThreshold = next.trackerForwardSkipThreshold as typeof trackerForwardSkipThreshold;
if ('trackerBackwardSkipThreshold' in next) api.trackerBackwardSkipThreshold = next.trackerBackwardSkipThreshold as typeof trackerBackwardSkipThreshold;
if ('trackerSkipThresholdAction' in next) api.trackerSkipThresholdAction = next.trackerSkipThresholdAction as typeof trackerSkipThresholdAction;
if ('trackerPopupDetection' in next) api.trackerPopupDetection = next.trackerPopupDetection as typeof trackerPopupDetection;
if ('adjustStatisticsAfterIdleTime' in next) api.adjustStatisticsAfterIdleTime = next.adjustStatisticsAfterIdleTime as typeof adjustStatisticsAfterIdleTime;
}
};
return api;
}
