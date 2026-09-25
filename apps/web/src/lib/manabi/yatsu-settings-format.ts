/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { record } from './ttu-migration-format.ts';
export interface SettingsPreview {
  values: Record<string, unknown>;
  skipped: string[];
}
const booleanKeys = [
  'hideSpoilerImage',
  'enableVerticalFontKerning',
  'enableFontVPAL',
  'prioritizeReaderStyles',
  'enableTextJustification',
  'enableTextWrapPretty',
  'showCharacterCounter',
  'showPercentage',
  'showFooterChapterCharacterCounter',
  'showFooterChapterPercentage',
  'disableWheelNavigation',
  'autoPositionOnResize',
  'avoidPageBreak',
  'pauseTrackerOnCustomPointChange',
  'customReadingPointEnabled',
  'selectionToBookmarkEnabled',
  'enableTapEdgeToFlip',
  'confirmClose',
  'manualBookmark',
  'autoBookmark',
  'statisticsEnabled',
  'openTrackerOnCompletion',
  'addCharactersOnCompletion',
  'trackerPopupDetection',
  'adjustStatisticsAfterIdleTime'
];
const ranges: Record<string, [number, number]> = {
  fontSize: [8, 96],
  lineHeight: [1, 3],
  textIndentation: [0, 20],
  textMarginValue: [0, 200],
  secondDimensionMaxValue: [0, 10000],
  firstDimensionMargin: [0, 1000],
  swipeThreshold: [0, 500],
  autoBookmarkTime: [1, 3600],
  pageColumns: [0, 20],
  startDayHoursForTracker: [0, 23],
  trackerAutoStartTime: [0, 86400],
  trackerIdleTime: [0, 86400],
  trackerForwardSkipThreshold: [0, 1000000],
  trackerBackwardSkipThreshold: [0, 1000000],
  verticalCustomReadingPosition: [0, 100],
  horizontalCustomReadingPosition: [0, 100]
};
const mapping: Record<string, string> = {
  fontSize: 'font_size',
  lineHeight: 'line_height',
  trackerAutoStartTime: 'reader.trackerAutostartTime'
};
/** Only independently validated settings with a real Manabi equivalent may run. */
export function previewYatsuSettings(value: unknown): SettingsPreview {
  const envelope = record(value, 'Yatsu settings');
  if (envelope.app !== 'Yatsu Reader' || envelope.schemaVersion !== 1)
    throw new Error('Unsupported Yatsu settings schema.');
  const input = record(envelope.settings, 'Yatsu settings values');
  if (Object.keys(input).length > 1000 || JSON.stringify(input).length > 1024 * 1024)
    throw new Error('Oversized Yatsu settings.');
  const values: Record<string, unknown> = Object.create(null);
  const consumed = new Set<string>();
  const add = (
    source: string,
    target: string,
    valid: (v: unknown) => boolean,
    transform: (v: any) => unknown = (v) => v
  ) => {
    if (!Object.hasOwn(input, source)) return;
    if (!valid(input[source])) throw new Error(`Invalid Yatsu setting: ${source}.`);
    consumed.add(source);
    values[target] = transform(input[source]);
  };
  for (const name of booleanKeys) add(name, `reader.${name}`, (v) => typeof v === 'boolean');
  for (const [name, [min, max]] of Object.entries(ranges))
    add(
      name,
      mapping[name] ?? `reader.${name}`,
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
    );
  add(
    'fontFamilyGroupOne',
    'font_family',
    (v) => typeof v === 'string' && v.length > 0 && v.length <= 128
  );
  add(
    'fontFamilyGroupTwo',
    'reader.fontFamilyGroupTwo',
    (v) => typeof v === 'string' && v.length > 0 && v.length <= 128
  );
  add(
    'hideFurigana',
    'furigana',
    (v) => typeof v === 'boolean',
    (v) => !v
  );
  add(
    'writingMode',
    'writing_mode',
    (v) => ['horizontal-tb', 'vertical-rl'].includes(String(v)),
    (v) => (v === 'vertical-rl' ? 'vertical' : 'horizontal')
  );
  add('viewMode', 'reader.viewMode', (v) => ['continuous', 'paginated'].includes(String(v)));
  // Manabi has one weight. Do not pretend unequal group weights can be represented.
  if (
    input.fontWeightGroupOne !== undefined &&
    input.fontWeightGroupOne === input.fontWeightGroupTwo
  ) {
    add(
      'fontWeightGroupOne',
      'reader.fontWeight',
      (v) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 1000)
    );
    consumed.add('fontWeightGroupTwo');
  }
  if (input.followSystemTheme === true) {
    values.theme = 'system';
    consumed.add('followSystemTheme');
    consumed.add('theme');
  } else if (['light-theme', 'dark-theme'].includes(String(input.theme))) {
    values.theme = input.theme === 'dark-theme' ? 'dark' : 'light';
    consumed.add('theme');
    consumed.add('followSystemTheme');
  }
  // Never retain unrecognized values: they could be credentials, CSS, or provider links.
  return {
    values,
    skipped: Object.keys(input)
      .filter((key) => !consumed.has(key))
      .sort()
  };
}
