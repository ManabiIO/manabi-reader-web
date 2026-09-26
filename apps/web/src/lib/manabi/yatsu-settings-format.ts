/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const booleanSettings = [
  'hideSpoilerImage',
  'hideFurigana',
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
] as const;
const ranges: Record<string, [number, number]> = {
  fontSize: [8, 96],
  fontWeight: [100, 900],
  lineHeight: [1, 3],
  textIndentation: [0, 20],
  textMarginValue: [0, 200],
  secondDimensionMaxValue: [0, 10000],
  firstDimensionMargin: [0, 1000],
  swipeThreshold: [0, 500],
  autoBookmarkTime: [1, 3600],
  pageColumns: [0, 20],
  startDayHoursForTracker: [0, 23],
  trackerAutostartTime: [0, 86400],
  trackerIdleTime: [0, 86400],
  trackerForwardSkipThreshold: [0, 1000000],
  trackerBackwardSkipThreshold: [0, 1000000],
  verticalCustomReadingPosition: [0, 100],
  horizontalCustomReadingPosition: [0, 100]
};
const enums: Record<string, string[]> = {
  writingMode: ['horizontal-tb', 'vertical-rl'],
  viewMode: ['continuous', 'paginated'],
  verticalTextOrientation: ['mixed', 'upright'],
  furiganaStyle: ['partial', 'full'],
  textMarginMode: ['auto', 'manual']
};
const aliases: Record<string, string> = {
  fontWeightGroupOne: 'fontWeight',
  trackerAutoStartTime: 'trackerAutostartTime'
};
export function parseYatsuSettings(value: unknown): {
  values: Record<string, unknown>;
  skipped: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Yatsu settings snapshot.');
  const document = value as Record<string, unknown>;
  if (
    document.app !== 'Yatsu Reader' ||
    document.schemaVersion !== 1 ||
    !document.settings ||
    typeof document.settings !== 'object' ||
    Array.isArray(document.settings)
  )
    throw new Error('Unsupported Yatsu settings snapshot.');
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > 512 * 1024)
    throw new Error('Yatsu settings snapshot is too large.');
  const values: Record<string, unknown> = Object.create(null),
    skipped: string[] = [];
  for (const [source, val] of Object.entries(document.settings)) {
    const name = aliases[source] ?? source;
    let supported = true,
      valid = false;
    if ((booleanSettings as readonly string[]).includes(name)) valid = typeof val === 'boolean';
    else if (ranges[name])
      valid =
        typeof val === 'number' &&
        Number.isFinite(val) &&
        val >= ranges[name][0] &&
        val <= ranges[name][1];
    else if (enums[name]) valid = enums[name].includes(val as string);
    else if (name === 'fontFamilyGroupOne' || name === 'fontFamilyGroupTwo')
      valid =
        typeof val === 'string' &&
        val.length > 0 &&
        val.length <= 128 &&
        !/[;{}<>\\]/.test(val) &&
        [...val].every((char) => char.charCodeAt(0) >= 32);
    else supported = false;
    if (!supported) {
      skipped.push(source);
      continue;
    }
    if (!valid)
      throw new Error(`Invalid supported Yatsu preference: ${source}. No settings were changed.`);
    if (Object.hasOwn(values, name) && values[name] !== val)
      throw new Error(`Conflicting Yatsu preferences for ${name}.`);
    values[name] = val;
  }
  return { values, skipped };
}
