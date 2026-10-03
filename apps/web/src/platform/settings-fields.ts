/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Explicit field admission: native commands cannot address arbitrary exported subjects. */
export const settingDefinitions = [
  { key: 'appearance', label: 'Appearance', kind: 'choice', choices: ['system', 'light', 'dark'] },
  { key: 'fontSize', label: 'Font size', kind: 'number', min: 8, max: 96 },
  { key: 'lineHeight', label: 'Line height', kind: 'number', min: 1, max: 3 },
  { key: 'fontFamilyGroupOne', label: 'Japanese font', kind: 'text' },
  { key: 'fontFamilyGroupTwo', label: 'Other text font', kind: 'text' },
  {
    key: 'writingMode',
    label: 'Writing mode',
    kind: 'choice',
    choices: ['vertical-rl', 'horizontal-tb']
  },
  {
    key: 'viewMode',
    label: 'Reading layout',
    kind: 'choice',
    choices: ['paginated', 'continuous']
  },
  { key: 'hideFurigana', label: 'Hide furigana', kind: 'boolean' },
  { key: 'hideSpoilerImage', label: 'Hide spoiler images', kind: 'boolean' },
  { key: 'enableVerticalFontKerning', label: 'Vertical font kerning', kind: 'boolean' },
  { key: 'enableFontVPAL', label: 'Vertical proportional alternates', kind: 'boolean' },
  { key: 'prioritizeReaderStyles', label: 'Prefer reader styles', kind: 'boolean' },
  { key: 'enableTextJustification', label: 'Justify text', kind: 'boolean' },
  { key: 'enableTextWrapPretty', label: 'Balance text wrapping', kind: 'boolean' },
  { key: 'pageColumns', label: 'Page columns', kind: 'number', min: 0, max: 20 },
  { key: 'firstDimensionMargin', label: 'Page margin', kind: 'number', min: 0, max: 1000 },
  {
    key: 'secondDimensionMaxValue',
    label: 'Maximum text dimension',
    kind: 'number',
    min: 0,
    max: 10000
  },
  { key: 'showCharacterCounter', label: 'Character counter', kind: 'boolean' },
  { key: 'showPercentage', label: 'Progress percentage', kind: 'boolean' },
  { key: 'showFooterChapterCharacterCounter', label: 'Chapter character counter', kind: 'boolean' },
  { key: 'showFooterChapterPercentage', label: 'Chapter percentage', kind: 'boolean' },
  { key: 'enableTapEdgeToFlip', label: 'Tap page edges to turn', kind: 'boolean' },
  { key: 'enableReaderWakeLock', label: 'Keep screen awake while reading', kind: 'boolean' },
  { key: 'autoPositionOnResize', label: 'Restore position after resize', kind: 'boolean' },
  { key: 'avoidPageBreak', label: 'Avoid paragraph page breaks', kind: 'boolean' },
  { key: 'confirmClose', label: 'Confirm before closing a book', kind: 'boolean' },
  { key: 'autoBookmark', label: 'Automatically save reading position', kind: 'boolean' },
  {
    key: 'autoBookmarkTime',
    label: 'Autosave interval (seconds)',
    kind: 'number',
    min: 1,
    max: 3600
  },
  { key: 'statisticsEnabled', label: 'Track reading statistics', kind: 'boolean' },
  { key: 'trackerAutostartTime', label: 'Tracker start delay', kind: 'number', min: 0, max: 86400 },
  { key: 'trackerIdleTime', label: 'Tracker idle timeout', kind: 'number', min: 0, max: 86400 },
  { key: 'openTrackerOnCompletion', label: 'Show tracker on completion', kind: 'boolean' },
  { key: 'addCharactersOnCompletion', label: 'Count remaining text on completion', kind: 'boolean' }
] as const;
export function validateSetting(key: unknown, value: unknown) {
  const field = settingDefinitions.find((field) => field.key === key);
  if (!field) throw new Error('Unknown reader setting.');
  if (field.kind === 'boolean' && typeof value === 'boolean') return field;
  if (
    field.kind === 'number' &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= field.min &&
    value <= field.max
  )
    return field;
  if (
    field.kind === 'text' &&
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    // eslint-disable-next-line no-control-regex -- reject control characters at the input boundary
    !/[\u0000-\u001f]/.test(value)
  )
    return field;
  if (
    field.kind === 'choice' &&
    typeof value === 'string' &&
    (field.choices as readonly string[]).includes(value)
  )
    return field;
  throw new Error('The setting value is outside its supported range.');
}
