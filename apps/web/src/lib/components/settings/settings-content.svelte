<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { browser } from '$app/environment';
  import AppearanceSettings from '$lib/appearance/settings.svelte';
  import { resolvedMode$ } from '$lib/appearance/state';
  import faSpinner from '@lucide/svelte/icons/loader-circle';
  import {
    TrackerAutoPause,
    TrackerSkipThresholdAction
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import {
    optionsForToggle,
    type ToggleOption
  } from '$lib/components/button-toggle-group/toggle-option';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsCustomTheme from '$lib/components/settings/settings-custom-theme.svelte';
  import SettingsDimensionPopover from '$lib/components/settings/settings-dimension-popover.svelte';
  import SettingsFontSelector from '$lib/components/settings/settings-font-selector.svelte';
  import SettingsReadingGoals from '$lib/components/settings/settings-reading-goals.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsStorageSourceList from '$lib/components/settings/settings-storage-source-list.svelte';
  import SettingsUserFontDialog from '$lib/components/settings/settings-user-font-dialog.svelte';
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
  import {
    customThemes$,
    database,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    horizontalCustomReadingPosition$,
    textMarginMode$,
    textMarginValue$,
    theme$,
    verticalCustomReadingPosition$
  } from '$lib/data/store';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import {
    availableThemes as availableThemesMap,
    themeForMode,
    themeNames
  } from '$lib/data/theme-option';
  import type { VerticalTextOrientation } from '$lib/data/vertical-text-orientation';
  import { ViewMode } from '$lib/data/view-mode';
  import type { WritingMode } from '$lib/data/writing-mode';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import {
    ReplicationSaveBehavior,
    AutoReplicationType
  } from '$lib/functions/replication/replication-options';
  import { map } from 'rxjs';
  import AppIcon from '$lib/components/app-icon.svelte';
  import { onDestroy } from 'svelte';

  export let selectedTheme: string;

  export let viewMode: ViewMode;

  export let fontFamilyGroupOne: string;

  export let fontFamilyGroupTwo: string;

  export let yuKyokashoAvailable: boolean | undefined = undefined;

  const primaryFontsWithoutYuKyokasho = [
    LocalFont.NOTOSERIFJP,
    LocalFont.KZUDMINCHO,
    LocalFont.GENEI,
    LocalFont.SHIPPORIMINCHO,
    LocalFont.KLEEONE,
    LocalFont.KLEEONESEMIBOLD,
    LocalFont.SERIF
  ];
  $: availablePrimaryFonts =
    yuKyokashoAvailable === true
      ? [LocalFont.YUKYOKASHO, ...primaryFontsWithoutYuKyokasho]
      : primaryFontsWithoutYuKyokasho;
  let editingPrimaryFont = false;
  let primaryFontAtFocus = '';
  function beginPrimaryFontEdit() {
    primaryFontAtFocus = primaryFontInput;
    editingPrimaryFont = true;
  }
  let primaryFontInput = '';
  $: if (!editingPrimaryFont) {
    primaryFontInput = effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable);
  }

  function commitPrimaryFont() {
    editingPrimaryFont = false;
    if (primaryFontInput !== primaryFontAtFocus)
      fontFamilyGroupOne = primaryFontInput.trim() || YU_KYOKASHO;
    primaryFontInput = effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable);
  }

  function handlePrimaryFontKeydown(event: KeyboardEvent) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    if (event.key === 'Enter') target.blur();
    if (event.key !== 'Escape') return;
    primaryFontInput = primaryFontAtFocus;
    editingPrimaryFont = false;
    primaryFontInput = effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable);
    primaryFontAtFocus = primaryFontInput;
    target.blur();
  }

  export let fontWeight: number | null;

  export let fontSize: number;

  export let lineHeight: number;

  export let textIndentation: number;

  export let textMarginValue: number;

  export let blurImage: boolean;

  export let blurImageMode: string;

  export let hideFurigana: boolean;

  export let furiganaStyle: FuriganaStyle;

  export let writingMode: WritingMode;

  export let enableFontKerning: boolean;

  export let enableFontVPAL: boolean;

  export let verticalTextOrientation: VerticalTextOrientation;

  export let prioritizeReaderStyles: boolean;

  export let enableTextJustification: boolean;

  export let enableTextWrapPretty: boolean;

  export let textMarginMode: TextMarginMode;

  export let enableReaderWakeLock: boolean;

  export let showCharacterCounter: boolean;

  export let showPercentage: boolean;

  export let showFooterChapterCharacterCounter: boolean;

  export let showFooterChapterPercentage: boolean;

  export let secondDimensionMaxValue: number;

  export let firstDimensionMargin: number;

  export let swipeThreshold: number;

  export let disableWheelNavigation: boolean;

  export let autoPositionOnResize: boolean;

  export let avoidPageBreak: boolean;

  export let pauseTrackerOnCustomPointChange: boolean;

  export let customReadingPointEnabled: boolean;

  export let selectionToBookmarkEnabled: boolean;

  export let enableTapEdgeToFlip: boolean;

  export let pageColumns: number;

  export let storageQuota: string;

  export let persistentStorage: boolean;

  export let hideExternalReadHint: boolean;

  export let confirmClose: boolean;

  export let manualBookmark: boolean;

  export let autoBookmark: boolean;

  export let autoBookmarkTime: number;

  export let activeSettings: string;

  export let importHTMLFixMode: string;

  export let restrictImportFixToAnchor: boolean;

  export let cacheStorageData: boolean;

  export let autoReplication: string;

  export let replicationSaveBehavior: string;

  export let showExternalPlaceholder: boolean;

  export let keepLocalStatisticsOnDeletion: boolean;

  export let overwriteBookCompletion: boolean;

  export let startDayHoursForTracker: number;

  export let statisticsMergeMode: string;

  export let readingGoalsMergeMode: string;

  export let statisticsEnabled: boolean;

  export let trackerAutoPause: string;

  export let openTrackerOnCompletion: boolean;

  export let addCharactersOnCompletion: boolean;

  export let trackerAutoStartTime: number;

  export let trackerIdleTime: number;

  export let trackerForwardSkipThreshold: number;

  export let trackerBackwardSkipThreshold: number;

  export let trackerSkipThresholdAction: string;

  export let trackerPopupDetection: boolean;

  export let adjustStatisticsAfterIdleTime: boolean;

  $: availableThemes = (
    browser
      ? [...Array.from(availableThemesMap.entries()), ...Object.entries($customThemes$)]
      : Array.from(availableThemesMap.entries())
  ).map(([theme]) => ({
    theme,
    option: themeForMode(theme, $resolvedMode$, $customThemes$)
  }));

  $: optionsForTheme = availableThemes.map(({ theme, option }) => ({
    id: theme,
    text: Object.hasOwn(themeNames, theme) ? themeNames[theme] : theme.replace(/^custom-/, ''),
    style: {
      color: option.fontColor,
      'background-color': option.backgroundColor
    },
    thickBorders: true,
    showIcons: true
  }));

  onDestroy(() => dialogManager.dialogs$.next([]));

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

  const storageSources$ = database.storageSourcesChanged$.pipe(
    map((storageSources) => [
      ...defaultStorageSources
        .filter((defaultStorageSource) =>
          isStorageSourceAvailable(defaultStorageSource.type, defaultStorageSource.name, window)
        )
        .map((defaultStorageSource) => ({
          name: defaultStorageSource.name,
          type: defaultStorageSource.type,
          storedInManager: false,
          encryptionDisabled: false,
          data: new ArrayBuffer(0),
          lastSourceModified: 0
        })),
      ...storageSources.filter((storageSource) => !isAppDefault(storageSource.name))
    ])
  );

  let showSpinner = false;
  let furiganaStyleTooltip = '';
  let importHTMLFixModeTooltip = '';
  let autoReplicationTypeTooltip = '';
  let trackerAutoPauseTooltip = '';

  $: if ($textMarginMode$ === 'auto') {
    $textMarginValue$ = 0;
  }

  $: verticalTextOrientationTooltip =
    verticalTextOrientation === 'mixed'
      ? 'Rotates the characters of horizontal scripts 90° clockwise'
      : 'Lays out the characters of horizontal scripts naturally (upright), as well as the glyphs for vertical scripts.';
  $: autoBookmarkTooltip = `If enabled sets a bookmark after ${autoBookmarkTime} seconds without scrolling/page change`;
  $: wakeLockSupported = browser && 'wakeLock' in navigator;
  $: verticalMode = writingMode === 'vertical-rl';
  $: fontCacheSupported = browser && 'caches' in window;
  $: switch (furiganaStyle) {
    case FuriganaStyle.Hide:
      furiganaStyleTooltip = 'Always hidden';
      break;
    case FuriganaStyle.Toggle:
      furiganaStyleTooltip = 'Hidden by default, can be toggled on click';
      break;
    case FuriganaStyle.Full:
      furiganaStyleTooltip = 'Hidden by default, show on hover or click';
      break;
    default:
      furiganaStyleTooltip = 'Display furigana as grayed out text';
      break;
  }
  $: avoidPageBreakTooltip = avoidPageBreak
    ? 'Avoids breaking words/sentences into different pages'
    : 'Allow words/sentences to break into different pages';
  $: persistentStorageTooltip = persistentStorage
    ? 'Reader uses higher storage limit for local data'
    : 'Uses lower temporary storage for local data.\nMay require bookmark or notification permissions for enablement';
  $: switch (importHTMLFixMode) {
    case ImportHTMLFixMode.OFF:
      importHTMLFixModeTooltip = 'Imports epub files as is';
      break;
    case ImportHTMLFixMode.EXTENDED:
      importHTMLFixModeTooltip =
        'Applies additional fixes for epub imports like removing control characters, replacing html entities etc.';
      break;
    default:
      importHTMLFixModeTooltip =
        'Applies fixes for epub imports like wrong self closing elements etc.';
      break;
  }
  $: cacheStorageDataTooltip = cacheStorageData
    ? 'Storage data is cached. Saves network traffic/latency but requires to reload current/open a new tab to retrieve data changes'
    : 'Storage data is refetched on every action. May consume more network traffic/latency but ensures current data';
  $: replicationSaveBehaviorTooltip =
    replicationSaveBehavior === ReplicationSaveBehavior.Overwrite
      ? 'Data will always be overwritten'
      : 'Data will only be written if none exist on target, no time data is present or if target data is older';
  $: switch (autoReplication) {
    case AutoReplicationType.Up:
      autoReplicationTypeTooltip =
        'Updated data will be exported to sync target when reading once per minute';
      break;
    case AutoReplicationType.Down:
      autoReplicationTypeTooltip = 'Data will be imported from sync target when opening a book';
      break;
    case AutoReplicationType.All:
      autoReplicationTypeTooltip = 'Data will be synced in both directions';
      break;
    default:
      autoReplicationTypeTooltip = 'No automatic import/export of data';
      break;
  }
  $: showExternalPlaceholderToolTip = showExternalPlaceholder
    ? 'Placeholder data for external books is shown in the browser source manager'
    : 'Placeholder data for external books is hidden';

  $: startOfDayHours = `${`${startDayHoursForTracker}`.padStart(2, '0')}:00`;

  $: trackerIdleTimeInMin = secondsToMinutes(trackerIdleTime);

  $: switch (trackerAutoPause) {
    case TrackerAutoPause.OFF:
      trackerAutoPauseTooltip = 'Tracker does not auto pause except for certain reader events';
      break;
    case TrackerAutoPause.STRICT:
      trackerAutoPauseTooltip =
        'Tracker will auto pause on certain reader events and any kind of site focus loss (e. g. dictionary popup)';
      break;
    default:
      trackerAutoPauseTooltip =
        'Tracker will auto pause on certain reader events and when the reader tab loses focus';
      break;
  }

  $: if (
    browser &&
    (activeSettings === 'Data' || activeSettings === 'Statistics' || activeSettings === 'All') &&
    !$storageSources$
  ) {
    database
      .getStorageSources()
      .then((storageSources) => {
        database.storageSourcesChanged$.next(storageSources);
      })
      .catch((error) => {
        logger.error(`Failed to retrieve storage sources: ${error.message}`);
        database.storageSourcesChanged$.next([]);
      });
  }
</script>

<div class="settings-grid grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
  {#if activeSettings === 'Reader' || activeSettings === 'All'}
    <SettingsItemGroup
      title="Appearance"
      settingId="appearance"
      category="appearance"
      showHeading={false}
      keywords="wallpaper background image light dark system dim fade"
      ><AppearanceSettings /></SettingsItemGroup
    >
    <SettingsItemGroup
      settingId="selected-theme"
      category="appearance"
      keywords="selectedTheme"
      title="Theme"
    >
      <ButtonToggleGroup
        options={optionsForTheme}
        bind:selectedOptionId={selectedTheme}
        on:edit={({ detail }) =>
          dialogManager.dialogs$.next([
            {
              component: SettingsCustomTheme,
              props: { selectedTheme: detail, existingThemes: optionsForTheme }
            }
          ])}
        on:delete={({ detail }) => {
          $theme$ = 'manabi-theme';
          delete $customThemes$[detail];
          $customThemes$ = { ...$customThemes$ };
        }}
      >
        {#if browser}
          <button
            aria-label="Add custom theme"
            class="m-1 rounded-md border-2 border-border p-2 text-lg"
            on:click={() =>
              dialogManager.dialogs$.next([
                {
                  component: SettingsCustomTheme,
                  props: { existingThemes: optionsForTheme }
                }
              ])}
          >
            Add custom theme
            <Ripple />
          </button>
        {/if}
      </ButtonToggleGroup>
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="view-mode"
      category="layout"
      keywords="viewMode"
      title="View mode"
    >
      <ButtonToggleGroup options={optionsForViewMode} bind:selectedOptionId={viewMode} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="Japanese font defaults"
      settingId="font-defaults"
      category="typography"
    >
      <p class="text-sm text-muted-foreground">
        YuKyokasho is the default when this browser can use it: Yoko for horizontal text and the
        standard face for vertical text. It is hidden when unavailable; Klee One becomes the default
        fallback. Optional fonts download only when used and can remain available offline when
        browser storage permits. Existing explicit font choices are kept.
      </p>
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="primary-font-input"
      category="typography"
      keywords="primaryFontInput"
      title="Primary / Serif font"
    >
      <div slot="header" class="flex items-center">
        <SettingsFontSelector
          label="Show available primary / serif fonts"
          availableFonts={availablePrimaryFonts}
          selectedFont={effectivePrimaryReaderFont(fontFamilyGroupOne, yuKyokashoAvailable)}
          bind:fontValue={fontFamilyGroupOne}
        />
        {#if fontCacheSupported}
          <button
            type="button"
            class="text-sm underline-offset-4 hover:underline"
            on:click={() =>
              dialogManager.dialogs$.next([
                {
                  component: SettingsUserFontDialog,
                  props: { fontFamily: fontFamilyGroupOne$ }
                }
              ])}>Custom fonts</button
          >
        {/if}
      </div>
      <Input
        type="text"
        class={inputClasses}
        aria-label="Primary / Serif font"
        placeholder={yuKyokashoAvailable === false ? 'Klee One' : 'YuKyokasho'}
        bind:value={primaryFontInput}
        onfocus={beginPrimaryFontEdit}
        onblur={commitPrimaryFont}
        onkeydown={handlePrimaryFontKeydown}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="font-family-group-two"
      category="typography"
      keywords="fontFamilyGroupTwo"
      title="Sans-serif font"
    >
      <div slot="header" class="flex items-center">
        <SettingsFontSelector
          label="Show available sans-serif fonts"
          availableFonts={[
            LocalFont.SYSTEMSANS,
            LocalFont.NOTOSANSJP,
            LocalFont.KZUDGOTHIC,
            LocalFont.SANSSERIF
          ]}
          bind:fontValue={fontFamilyGroupTwo}
        />
        {#if fontCacheSupported}
          <button
            type="button"
            class="text-sm underline-offset-4 hover:underline"
            on:click={() =>
              dialogManager.dialogs$.next([
                {
                  component: SettingsUserFontDialog,
                  props: { fontFamily: fontFamilyGroupTwo$ }
                }
              ])}>Custom fonts</button
          >
        {/if}
      </div>
      <Input
        type="text"
        class={inputClasses}
        aria-label="Sans-serif font"
        placeholder="System Sans"
        bind:value={fontFamilyGroupTwo}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="font-weight"
      category="typography"
      keywords="fontWeight"
      title="Font Weight"
      tooltip={'Sets a font weight - leave empty to fallback to default'}
    >
      <Input
        aria-label="Font Weight"
        type="number"
        placeholder="default"
        class={inputClasses}
        step="100"
        min="100"
        max="1000"
        bind:value={fontWeight}
        onchange={() => {
          if (fontWeight === null) {
            return;
          }

          if (fontWeight < 100) {
            fontWeight = 100;
          } else if (fontWeight > 1000) {
            fontWeight = 1000;
          }
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="font-size"
      category="typography"
      keywords="fontSize"
      title="Font size"
    >
      <Input
        aria-label="Font size"
        type="number"
        class={inputClasses}
        step="1"
        min="1"
        bind:value={fontSize}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="line-height"
      category="typography"
      keywords="lineHeight"
      title="Line Height"
    >
      <Input
        aria-label="Line Height"
        type="number"
        class={inputClasses}
        step="0.05"
        min="1"
        bind:value={lineHeight}
        onchange={() => {
          if (!lineHeight || lineHeight < 1) {
            lineHeight = 1.65;
          }
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="text-indentation"
      category="typography"
      keywords="textIndentation"
      title="Paragraph Indentation"
      tooltip="# of rem added as text indentation of new paragraphs"
    >
      <Input
        aria-label="Paragraph Indentation"
        type="number"
        class={inputClasses}
        step=".5"
        min="0"
        bind:value={textIndentation}
        onblur={() => {
          const newValue = Number.parseFloat(`${textIndentation ?? 0}`);

          if (isNaN(newValue) || newValue < 1) {
            textIndentation = 0;
          }
        }}
      />
    </SettingsItemGroup>
    {#if textMarginMode === 'manual'}
      <SettingsItemGroup
        settingId="text-margin-value"
        category="typography"
        keywords="textMarginValue"
        title="Paragraph Margins"
        tooltip="# of rem added as margin to paragraphs"
      >
        <Input
          aria-label="Paragraph Margins"
          type="number"
          class={inputClasses}
          step=".5"
          min="0"
          bind:value={textMarginValue}
          onblur={() => {
            const newValue = Number.parseFloat(`${textMarginValue ?? 0}`);

            if (isNaN(newValue) || newValue < 1) {
              textMarginValue = 0;
            }
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      settingId="first-dimension-margin"
      category="layout"
      keywords="firstDimensionMargin"
      title={verticalMode ? 'Reader Left/right margin' : 'Reader Top/bottom margin'}
    >
      <SettingsDimensionPopover
        slot="header"
        isFirstDimension
        isVertical={verticalMode}
        bind:dimensionValue={firstDimensionMargin}
      />
      <Input
        aria-label={verticalMode ? 'Reader Left/right margin' : 'Reader Top/bottom margin'}
        type="number"
        class={inputClasses}
        step="1"
        min="0"
        bind:value={firstDimensionMargin}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="second-dimension-max-value"
      category="layout"
      keywords="secondDimensionMaxValue"
      title={verticalMode ? 'Reader Max height' : 'Reader Max width'}
    >
      <SettingsDimensionPopover
        slot="header"
        isVertical={verticalMode}
        bind:dimensionValue={secondDimensionMaxValue}
      />
      <Input
        aria-label={verticalMode ? 'Reader Max height' : 'Reader Max width'}
        type="number"
        class={inputClasses}
        step="1"
        min="0"
        bind:value={secondDimensionMaxValue}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="swipe-threshold"
      category="reading"
      keywords="swipeThreshold"
      title="Swipe Threshold"
      tooltip={'Distance which you need to swipe in order trigger a navigation'}
    >
      <Input
        aria-label="Swipe Threshold"
        type="number"
        step="1"
        min="10"
        class={inputClasses}
        bind:value={swipeThreshold}
        onblur={() => {
          if (swipeThreshold < 10 || typeof swipeThreshold !== 'number') {
            swipeThreshold = 10;
          }
        }}
      />
    </SettingsItemGroup>
    {#if autoBookmark}
      <SettingsItemGroup
        settingId="auto-bookmark-time"
        category="reading"
        keywords="autoBookmarkTime"
        title="Auto Bookmark Time"
        tooltip={'Time in s for Auto Bookmark'}
      >
        <Input
          aria-label="Auto Bookmark Time"
          type="number"
          step="1"
          min="1"
          class={inputClasses}
          bind:value={autoBookmarkTime}
          onblur={() => {
            if (autoBookmarkTime < 1 || typeof autoBookmarkTime !== 'number') {
              autoBookmarkTime = 3;
            }
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      settingId="writing-mode"
      category="layout"
      keywords="writingMode"
      title="Writing mode"
    >
      <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={writingMode} />
    </SettingsItemGroup>
    {#if verticalMode}
      <SettingsItemGroup
        settingId="enable-font-kerning"
        category="typography"
        keywords="enableFontKerning"
        title="Enable Font Kerning"
        tooltip={'Can lead to better visual balance for vertical spacing of text if font and browser supports it'}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontKerning} />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="enable-font-vpal"
        category="typography"
        keywords="enableFontVPAL"
        title="Enable VPAL"
        tooltip={'Can lead to more natural spacing for vertically laid-out text if font and browser supports it'}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontVPAL} />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="vertical-text-orientation"
        category="typography"
        keywords="verticalTextOrientation"
        title="Text Orientation"
        tooltip={verticalTextOrientationTooltip}
      >
        <ButtonToggleGroup
          options={optionsForVerticalTextOrientation}
          bind:selectedOptionId={verticalTextOrientation}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      settingId="prioritize-reader-styles"
      category="reading"
      keywords="prioritizeReaderStyles"
      title="Prioritize Reader Styles"
      tooltip={'When enabled the "important" declaration is added to certain rules like margins or justification which makes it more likely to be applied in case of conflicting book styles'}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={prioritizeReaderStyles}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="enable-text-justification"
      category="typography"
      keywords="enableTextJustification"
      title="Enable Text Justification"
      tooltip={'When enabled the reader adds styles to justify text content of paragraphs'}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={enableTextJustification}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="enable-text-wrap-pretty"
      category="typography"
      keywords="enableTextWrapPretty"
      title="Enable Pretty Text Wrap"
      tooltip={'When enabled the reader adds the pretty text wrap style to supported browsers'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTextWrapPretty} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="text-margin-mode"
      category="typography"
      keywords="textMarginMode"
      title="Paragraph Margin Mode"
      tooltip={'When set to manual it allows to specify a margin value which should be applied to paragraphs'}
    >
      <ButtonToggleGroup
        options={optionsForTextMarginMode}
        bind:selectedOptionId={textMarginMode}
      />
    </SettingsItemGroup>
    {#if wakeLockSupported}
      <SettingsItemGroup
        settingId="enable-reader-wake-lock"
        category="reading"
        keywords="enableReaderWakeLock"
        title="Enable Screen Lock"
        tooltip={'When enabled the reader site attempts to request a WakeLock that prevents device screens from dimming or locking'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={enableReaderWakeLock}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      settingId="show-character-counter"
      category="reading"
      keywords="showCharacterCounter"
      title="Show Character Counter"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showCharacterCounter} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="show-percentage"
      category="reading"
      keywords="showPercentage"
      title="Show Percentage"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showPercentage} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="show-footer-chapter-character-counter"
      category="reading"
      keywords="showFooterChapterCharacterCounter"
      title="Show Footer Chapter Characters"
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterCharacterCounter}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="show-footer-chapter-percentage"
      category="reading"
      keywords="showFooterChapterPercentage"
      title="Show Footer Chapter Percentage"
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterPercentage}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="disable-wheel-navigation"
      category="reading"
      keywords="disableWheelNavigation"
      title="Disable Wheel Navigation"
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={disableWheelNavigation}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="confirm-close"
      category="reading"
      keywords="confirmClose"
      title="Close Confirmation"
      tooltip={`When enabled asks for confirmation on closing/reloading a reader tab and unsaved changes were detected`}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={confirmClose} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="manual-bookmark"
      category="reading"
      keywords="manualBookmark"
      title="Manual Bookmark"
      tooltip={'If enabled current position will not be bookmarked when leaving the reader via menu elements'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={manualBookmark} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="auto-bookmark"
      category="reading"
      keywords="autoBookmark"
      title="Auto Bookmark"
      tooltip={autoBookmarkTooltip}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={autoBookmark} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="blur-image"
      category="reading"
      keywords="blurImage"
      title="Blur image"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={blurImage} />
    </SettingsItemGroup>
    {#if blurImage}
      <SettingsItemGroup
        settingId="blur-image-mode"
        category="reading"
        keywords="blurImageMode"
        title="Blur Mode"
        tooltip="Determines if all or only images after the table of contents will be blurred"
      >
        <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      settingId="hide-furigana"
      category="reading"
      keywords="hideFurigana"
      title="Hide furigana"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideFurigana} />
    </SettingsItemGroup>
    {#if hideFurigana}
      <SettingsItemGroup
        settingId="furigana-style"
        category="reading"
        keywords="furiganaStyle"
        title="Hide furigana style"
        tooltip={furiganaStyleTooltip}
      >
        <ButtonToggleGroup
          options={optionsForFuriganaStyle}
          bind:selectedOptionId={furiganaStyle}
        />
      </SettingsItemGroup>
    {/if}
    {#if statisticsEnabled}
      <SettingsItemGroup
        settingId="pause-tracker-on-custom-point-change"
        category="reading"
        keywords="pauseTrackerOnCustomPointChange"
        title="Custom Point pauses Tracker"
        tooltip={'When enabled the tracker will auto pause and unpause while setting a custom reading point'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={pauseTrackerOnCustomPointChange}
        />
      </SettingsItemGroup>
    {/if}
    {#if viewMode === ViewMode.Continuous}
      <SettingsItemGroup
        settingId="custom-reading-point-enabled"
        category="reading"
        keywords="customReadingPointEnabled"
        title="Custom Reading Point"
        tooltip={'Allows to set a persistent custom point in the reader from which the current progress and bookmark is calculated when enabled'}
      >
        <div class="flex items-center">
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={customReadingPointEnabled}
          />
          {#if customReadingPointEnabled}
            <button
              type="button"
              class="ml-4 hover:underline"
              on:click={() => {
                verticalCustomReadingPosition$.next(100);
                horizontalCustomReadingPosition$.next(0);
              }}
            >
              Reset Points
            </button>
          {/if}
        </div>
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="auto-position-on-resize"
        category="layout"
        keywords="autoPositionOnResize"
        title="Auto position on resize"
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={autoPositionOnResize}
        />
      </SettingsItemGroup>
    {:else}
      <SettingsItemGroup
        settingId="avoid-page-break"
        category="layout"
        keywords="avoidPageBreak"
        title="Avoid Page Break"
        tooltip={avoidPageBreakTooltip}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={avoidPageBreak} />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="selection-to-bookmark-enabled"
        category="reading"
        keywords="selectionToBookmarkEnabled"
        title="Selection to Bookmark"
        tooltip={'When enabled bookmarks will be placed to a near paragraph of current/previous selected text instead of page start'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={selectionToBookmarkEnabled}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="enable-tap-edge-to-flip"
        category="reading"
        keywords="enableTapEdgeToFlip"
        title="Tap to Flip"
        tooltip="Reserves small margins on the left and right on which you can tap to turn pages"
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTapEdgeToFlip} />
      </SettingsItemGroup>
      {#if !verticalMode}
        <SettingsItemGroup
          settingId="page-columns"
          category="layout"
          keywords="pageColumns"
          title="Page Columns"
          tooltip="# of text columns rendered"
        >
          <Input
            aria-label="Page Columns"
            type="number"
            class={inputClasses}
            step="1"
            min="0"
            bind:value={pageColumns}
          />
        </SettingsItemGroup>
      {/if}
    {/if}
  {/if}
  {#if activeSettings === 'Data' || activeSettings === 'All'}
    <SettingsItemGroup
      settingId="persistent-storage"
      category="library"
      keywords="persistentStorage"
      title="Persistent storage"
      tooltip={persistentStorageTooltip}
    >
      <div class="flex items-center">
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={persistentStorage} />
        {#if storageQuota}
          <div class="ml-4">{storageQuota}</div>
        {/if}
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="hide-external-read-hint"
      category="library"
      keywords="hideExternalReadHint"
      title="Hide Source Hint"
      tooltip="Hides the user warning when opening a book from an external storage source"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideExternalReadHint} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="import-htmlfix-mode"
      category="library"
      keywords="importHTMLFixMode"
      title="Epub Import Fixes"
      tooltip={importHTMLFixModeTooltip}
    >
      <ButtonToggleGroup
        options={optionsForImportHTMLFixes}
        bind:selectedOptionId={importHTMLFixMode}
      />
    </SettingsItemGroup>
    {#if importHTMLFixMode !== ImportHTMLFixMode.OFF}
      <SettingsItemGroup
        settingId="restrict-import-fix-to-anchor"
        category="library"
        keywords="restrictImportFixToAnchor"
        title="Restrict to Links"
        tooltip="Restricts epub fixes for self closing tags to links only"
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={restrictImportFixToAnchor}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      settingId="cache-storage-data"
      category="library"
      keywords="cacheStorageData"
      title="Cache Data"
      tooltip={cacheStorageDataTooltip}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={cacheStorageData} />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="auto-replication"
      category="library"
      keywords="autoReplication"
      title="Auto Import/Export"
      tooltip={autoReplicationTypeTooltip}
    >
      <ButtonToggleGroup
        options={optionsForAutoReplicationType}
        bind:selectedOptionId={autoReplication}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="replication-save-behavior"
      category="library"
      keywords="replicationSaveBehavior"
      title="Import/Export Behavior"
      tooltip={replicationSaveBehaviorTooltip}
    >
      <ButtonToggleGroup
        options={optionsForReplicationSaveBehavior}
        bind:selectedOptionId={replicationSaveBehavior}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="show-external-placeholder"
      category="library"
      keywords="showExternalPlaceholder"
      title="Show Placeholder"
      tooltip={showExternalPlaceholderToolTip}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showExternalPlaceholder}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="Storage sources"
      settingId="storage-sources"
      category="library"
      keywords="cloud drive local folder encryption"
      ><SettingsStorageSourceList storageSources={$storageSources$} /></SettingsItemGroup
    >
  {/if}
  {#if activeSettings === 'Statistics' || activeSettings === 'All'}
    <SettingsItemGroup
      settingId="keep-local-statistics-on-deletion"
      category="tracking"
      keywords="keepLocalStatisticsOnDeletion"
      title="Keep Local Data on Deletion"
      tooltip={'Determines if local statistics will be deleted or not when removing a local book copy'}
    >
      <div class="flex items-center">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={keepLocalStatisticsOnDeletion}
        />
        <button
          type="button"
          class="ml-4 hover:underline"
          on:click={() => {
            showSpinner = true;
            database
              .clearZombieStatistics()
              .catch(({ message }) =>
                dialogManager.dialogs$.next([
                  {
                    component: MessageDialog,
                    props: {
                      title: 'Error',
                      message: `Error clearing Zombie Statistics: ${message}`
                    }
                  }
                ])
              )
              .finally(() => (showSpinner = false));
          }}
        >
          Clear Zombie Statistics
        </button>
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="overwrite-book-completion"
      category="tracking"
      keywords="overwriteBookCompletion"
      title="Overwrite Book Completion"
      tooltip={`Determines if only the first Book Completion will be tracked or if it always updates to the latest one`}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={overwriteBookCompletion}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="start-day-hours-for-tracker"
      category="tracking"
      keywords="startDayHoursForTracker"
      title={`Start Day Hours: ${startOfDayHours}`}
      tooltip={'Determines at which time a new day starts.\nData before this point will be counted towards the previous day'}
    >
      <input
        aria-label={`Start Day Hours: ${startOfDayHours}`}
        type="range"
        step="1"
        min="0"
        max="23"
        class={inputClasses}
        bind:value={startDayHoursForTracker}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="statistics-merge-mode"
      category="tracking"
      keywords="statisticsMergeMode"
      title="Statistics Merge"
      tooltip={`Determines if statistics will be merged entry by entry or replaced completely on a sync`}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={statisticsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="reading-goals-merge-mode"
      category="tracking"
      keywords="readingGoalsMergeMode"
      title="Reading Goals Merge"
      tooltip={`Determines if reading goals will be merged entry by entry or replaced completely on a sync`}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={readingGoalsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      settingId="statistics-enabled"
      category="tracking"
      keywords="statisticsEnabled"
      title="Enable Statistics"
      tooltip="Enables the tracker icon in the bottom left corner of the reader which you need to use to start tracking your reading session"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={statisticsEnabled} />
    </SettingsItemGroup>
    {#if statisticsEnabled}
      <SettingsItemGroup
        settingId="tracker-auto-pause"
        category="tracking"
        keywords="trackerAutoPause"
        title="Tracker Auto Pause"
        tooltip={trackerAutoPauseTooltip}
      >
        <ButtonToggleGroup
          options={optionsForTrackerAutoPause}
          bind:selectedOptionId={trackerAutoPause}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="open-tracker-on-completion"
        category="tracking"
        keywords="openTrackerOnCompletion"
        title="Open Tracker on Completion"
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={openTrackerOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="add-characters-on-completion"
        category="tracking"
        keywords="addCharactersOnCompletion"
        title="Update on Completion"
        tooltip={`Determines if the missing amount of characters between the current position and the book total will be added to the statistics or not`}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={addCharactersOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="tracker-auto-start-time"
        category="tracking"
        keywords="trackerAutoStartTime"
        title="Autostart tracker (sec)"
        tooltip={'Time in seconds without a change to the character count after which the tracker will initially auto start (0 = disabled, higher value recommended to avoid racing conditions)'}
      >
        <Input
          aria-label="Autostart tracker (sec)"
          type="number"
          class={inputClasses}
          step="1"
          min="0"
          bind:value={trackerAutoStartTime}
          onblur={() => {
            const newValue = Number.parseFloat(`${trackerAutoStartTime ?? 0}`);

            if (isNaN(newValue) || newValue < 1) {
              trackerAutoStartTime = 0;
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="tracker-idle-time-in-min"
        category="tracking"
        keywords="trackerIdleTimeInMin"
        title="Idle Time (min)"
        tooltip={'Time in minutes after which the tracker will auto pause without page interaction (0 = disabled, max 12h)'}
      >
        <Input
          aria-label="Idle Time (min)"
          type="number"
          class={inputClasses}
          step="0.5"
          min="0"
          bind:value={trackerIdleTimeInMin}
          onblur={() => {
            if (!trackerIdleTimeInMin || trackerIdleTimeInMin < 0) {
              trackerIdleTime = 0;
            } else if (trackerIdleTimeInMin > 43200) {
              trackerIdleTime = 900;
            } else {
              trackerIdleTime = Math.floor(trackerIdleTimeInMin * 60);
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="tracker-forward-skip-threshold"
        category="tracking"
        keywords="trackerForwardSkipThreshold"
        title="Forward Skip Threshold"
        tooltip={'Amount of positive characters passed between a tick after which a threshold action is triggered (0 = disabled)'}
      >
        <Input
          aria-label="Forward Skip Threshold"
          type="number"
          class={inputClasses}
          step="1"
          min="0"
          bind:value={trackerForwardSkipThreshold}
          onblur={() => {
            if (trackerForwardSkipThreshold === 0) {
              trackerForwardSkipThreshold = 0;
            } else if (!trackerForwardSkipThreshold || trackerForwardSkipThreshold < 0) {
              trackerForwardSkipThreshold = 2700;
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        settingId="tracker-backward-skip-threshold"
        category="tracking"
        keywords="trackerBackwardSkipThreshold"
        title="Backward Skip Threshold"
        tooltip={'Amount of negative characters passed between a tick after which a threshold action is triggered (0 = disabled)'}
      >
        <Input
          aria-label="Backward Skip Threshold"
          type="number"
          class={inputClasses}
          step="1"
          bind:value={trackerBackwardSkipThreshold}
          onblur={() => {
            if (trackerBackwardSkipThreshold < 0) {
              trackerBackwardSkipThreshold = Math.abs(trackerBackwardSkipThreshold);
            } else if (trackerBackwardSkipThreshold === 0) {
              trackerBackwardSkipThreshold = 0;
            } else if (!trackerBackwardSkipThreshold) {
              trackerBackwardSkipThreshold = 2700;
            }
          }}
        />
      </SettingsItemGroup>
      {#if trackerForwardSkipThreshold || trackerBackwardSkipThreshold}
        <SettingsItemGroup
          settingId="tracker-skip-threshold-action"
          category="tracking"
          keywords="trackerSkipThresholdAction"
          title="Threshold Action"
          tooltip={`Determines what action will be executed in case a skip threshold was triggered`}
        >
          <ButtonToggleGroup
            options={optionsForTrackerSkipThresholdAction}
            bind:selectedOptionId={trackerSkipThresholdAction}
          />
        </SettingsItemGroup>
      {/if}
      {#if trackerAutoPause !== TrackerAutoPause.OFF}
        <SettingsItemGroup
          settingId="tracker-popup-detection"
          category="tracking"
          keywords="trackerPopupDetection"
          title="Dictionary Detection"
          tooltip={`If enabled auto pause is skipped if open yomitan/jpdb-browser-reader was detected - yomitan requires disabled 'Secure Container' settings`}
        >
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={trackerPopupDetection}
          />
        </SettingsItemGroup>
      {/if}
      {#if trackerIdleTime > 0}
        <SettingsItemGroup
          settingId="adjust-statistics-after-idle-time"
          category="tracking"
          keywords="adjustStatisticsAfterIdleTime"
          title="Rollback Statistics on Idle"
          tooltip={`If enabled attempts to rollback statistics by subtracting the idled time value back from the session`}
        >
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={adjustStatisticsAfterIdleTime}
          />
        </SettingsItemGroup>
      {/if}
      <SettingsItemGroup
        title="Reading goals"
        settingId="reading-goals"
        category="tracking"
        keywords="time characters daily weekly monthly history"
      >
        <SettingsReadingGoals
          storageSources={$storageSources$}
          on:spinner={({ detail }) => (showSpinner = detail)}
        />
      </SettingsItemGroup>
    {/if}
  {/if}
  {#if showSpinner}
    <div class="tap-highlight-transparent fixed inset-0 bg-black/[.2]"></div>
    <div
      role="status"
      class="fixed inset-0 z-50 flex h-full w-full items-center justify-center gap-3 text-lg"
    >
      Updating reading data…
      <AppIcon icon={faSpinner} spin />
    </div>
  {/if}
</div>
