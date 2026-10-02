/** @license BSD-3-Clause */
import { MAX_TRACKER_IDLE_MINUTES } from '../lib/components/settings/settings-number-policy';
import { matchesSetting } from '../lib/components/settings/settings-context';

export type SettingValue = string | number | boolean | null;
export type CategoryId = 'appearance' | 'typography' | 'layout' | 'reading' | 'library' | 'tracking';
export interface SettingChoice { value: string; label: string }
export interface SettingDefinition {
  key: string;
  sourceId: string;
  category: CategoryId;
  label: string;
  kind: 'boolean' | 'number' | 'text' | 'choice';
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  nullable?: boolean;
  integer?: boolean;
  choices?: readonly SettingChoice[];
  /** Conditional controls remain searchable, but cannot be changed while inapplicable. */
  when?: readonly { key: string; values: readonly SettingValue[] }[];
}
export const settingCategories = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'typography', label: 'Fonts & text' },
  { id: 'layout', label: 'Page layout' },
  { id: 'reading', label: 'Reading controls' },
  { id: 'library', label: 'Library & sync' },
  { id: 'tracking', label: 'Tracking & goals' },
  { id: 'all', label: 'All settings' },
] as const;
const choices = (...entries: readonly (readonly [string, string])[]): SettingChoice[] => entries.map(([value, label]) => ({ value, label }));
const condition = (key: string, ...values: SettingValue[]) => [{ key, values }];
const vertical = condition('writingMode', 'vertical-rl');
const paginated = condition('viewMode', 'paginated');
const tracking = condition('statisticsEnabled', true);

/** Hand-admitted controls from settings-content and page-turn-effect-select.
 * Keys are bridge field identities, not property paths or arbitrary store exports.
 * Source minima/maxima are retained. Unbounded source numbers have only a safe
 * JSON-number ceiling at validation time; no new preference defaults are stored.
 */
export const nativeSettingDefinitions: readonly SettingDefinition[] = [
  { key: 'appearance', sourceId: 'appearance', category: 'appearance', label: 'Color mode', kind: 'choice', choices: choices(['system', 'System'], ['light', 'Light'], ['dark', 'Dark']), description: 'System follows the device. Reader theme and color mode are independent.' },
  { key: 'theme', sourceId: 'selected-theme', category: 'appearance', label: 'Theme', kind: 'choice', choices: [] },
  { key: 'readerBackgroundFade', sourceId: 'reader-background-fade', category: 'appearance', label: 'Fade reader background image', kind: 'boolean', description: 'Applies to an existing image in the embedded reader. Native image selection is not connected yet.' },
  { key: 'readerBackgroundAmount', sourceId: 'reader-background-amount', category: 'appearance', label: 'Reader background fade amount (%)', kind: 'number', min: 0, max: 100, step: 1, when: condition('readerBackgroundFade', true) },
  { key: 'libraryBackgroundFade', sourceId: 'library-background-fade', category: 'appearance', label: 'Fade web library background image', kind: 'boolean', description: 'Saves the existing web-library preference. Background images are not rendered in the native library yet.' },
  { key: 'libraryBackgroundAmount', sourceId: 'library-background-amount', category: 'appearance', label: 'Web library background fade amount (%)', kind: 'number', min: 0, max: 100, step: 1, when: condition('libraryBackgroundFade', true) },
  { key: 'fontFamilyGroupOne', sourceId: 'primary-font-input', category: 'typography', label: 'Primary / Serif font', kind: 'text', description: 'Keep an explicit font family or choose an available font. YuKyokasho falls back to Klee One when unavailable.' },
  { key: 'fontFamilyGroupTwo', sourceId: 'font-family-group-two', category: 'typography', label: 'Sans-serif font', kind: 'text' },
  { key: 'fontWeight', sourceId: 'font-weight', category: 'typography', label: 'Font weight', kind: 'number', min: 100, max: 1000, step: 100, nullable: true, description: 'Leave empty to use the default font weight.' },
  { key: 'fontSize', sourceId: 'font-size', category: 'typography', label: 'Font size', kind: 'number', min: 1, step: 1 },
  { key: 'lineHeight', sourceId: 'line-height', category: 'typography', label: 'Line height', kind: 'number', min: 1, step: 0.05 },
  { key: 'textIndentation', sourceId: 'text-indentation', category: 'typography', label: 'Paragraph indentation (rem)', kind: 'number', min: 0, step: 0.5 },
  { key: 'textMarginMode', sourceId: 'text-margin-mode', category: 'typography', label: 'Paragraph margin mode', kind: 'choice', choices: choices(['auto', 'Automatic'], ['manual', 'Manual']) },
  { key: 'textMarginValue', sourceId: 'text-margin-value', category: 'typography', label: 'Paragraph margins (rem)', kind: 'number', min: 0, step: 0.5, when: condition('textMarginMode', 'manual') },
  { key: 'enableVerticalFontKerning', sourceId: 'enable-font-kerning', category: 'typography', label: 'Vertical font kerning', kind: 'boolean', when: vertical },
  { key: 'enableFontVPAL', sourceId: 'enable-font-vpal', category: 'typography', label: 'Vertical proportional alternates', kind: 'boolean', when: vertical },
  { key: 'verticalTextOrientation', sourceId: 'vertical-text-orientation', category: 'typography', label: 'Vertical text orientation', kind: 'choice', choices: choices(['mixed', 'Mixed'], ['upright', 'Upright']), when: vertical },
  { key: 'enableTextJustification', sourceId: 'enable-text-justification', category: 'typography', label: 'Justify text', kind: 'boolean' },
  { key: 'enableTextWrapPretty', sourceId: 'enable-text-wrap-pretty', category: 'typography', label: 'Pretty text wrapping', kind: 'boolean', description: 'Applied when supported by the embedded reader engine.' },
  { key: 'viewMode', sourceId: 'view-mode', category: 'layout', label: 'View mode', kind: 'choice', choices: choices(['continuous', 'Continuous'], ['paginated', 'Paginated']) },
  { key: 'writingMode', sourceId: 'writing-mode', category: 'layout', label: 'Writing mode', kind: 'choice', choices: choices(['horizontal-tb', 'Horizontal'], ['vertical-rl', 'Vertical']) },
  { key: 'pageTurnEffect', sourceId: 'page-turn-effect', category: 'layout', label: 'Page turn effect', kind: 'choice', choices: choices(['slide', 'Slide'], ['none', 'None']), description: 'Paginated EPUBs only. Continuous scrolling is unchanged.', when: paginated },
  { key: 'firstDimensionMargin', sourceId: 'first-dimension-margin', category: 'layout', label: 'Page margin (pixels per side)', kind: 'number', min: 0, step: 1 },
  { key: 'secondDimensionMaxValue', sourceId: 'second-dimension-max-value', category: 'layout', label: 'Maximum text dimension (pixels)', kind: 'number', min: 0, step: 1, description: '0 uses automatic sizing.' },
  { key: 'autoPositionOnResize', sourceId: 'auto-position-on-resize', category: 'layout', label: 'Restore position after resize', kind: 'boolean', when: condition('viewMode', 'continuous') },
  { key: 'avoidPageBreak', sourceId: 'avoid-page-break', category: 'layout', label: 'Avoid paragraph page breaks', kind: 'boolean', when: paginated },
  { key: 'pageColumns', sourceId: 'page-columns', category: 'layout', label: 'Page columns', kind: 'number', min: 0, step: 1, integer: true, when: [...paginated, ...condition('writingMode', 'horizontal-tb')] },
  { key: 'swipeThreshold', sourceId: 'swipe-threshold', category: 'reading', label: 'Swipe threshold (pixels)', kind: 'number', min: 10, step: 1 },
  { key: 'prioritizeReaderStyles', sourceId: 'prioritize-reader-styles', category: 'reading', label: 'Prioritize reader styles', kind: 'boolean', description: 'Prefer reader margins and text styles when they conflict with book styles.' },
  { key: 'enableReaderWakeLock', sourceId: 'enable-reader-wake-lock', category: 'reading', label: 'Keep screen awake while reading', kind: 'boolean' },
  { key: 'showCharacterCounter', sourceId: 'show-character-counter', category: 'reading', label: 'Character counter', kind: 'boolean' },
  { key: 'showPercentage', sourceId: 'show-percentage', category: 'reading', label: 'Progress percentage', kind: 'boolean' },
  { key: 'showFooterChapterCharacterCounter', sourceId: 'show-footer-chapter-character-counter', category: 'reading', label: 'Chapter character counter', kind: 'boolean' },
  { key: 'showFooterChapterPercentage', sourceId: 'show-footer-chapter-percentage', category: 'reading', label: 'Chapter progress percentage', kind: 'boolean' },
  { key: 'disableWheelNavigation', sourceId: 'disable-wheel-navigation', category: 'reading', label: 'Disable mouse wheel navigation', kind: 'boolean', description: 'For connected mice and trackpads.' },
  { key: 'confirmClose', sourceId: 'confirm-close', category: 'reading', label: 'Confirm closing with unsaved changes', kind: 'boolean' },
  { key: 'manualBookmark', sourceId: 'manual-bookmark', category: 'reading', label: 'Manual bookmarks', kind: 'boolean', description: 'Do not automatically bookmark when leaving through reader menus.' },
  { key: 'autoBookmark', sourceId: 'auto-bookmark', category: 'reading', label: 'Automatic bookmarks', kind: 'boolean' },
  { key: 'autoBookmarkTime', sourceId: 'auto-bookmark-time', category: 'reading', label: 'Automatic bookmark interval (seconds)', kind: 'number', min: 1, step: 1, when: condition('autoBookmark', true) },
  { key: 'hideSpoilerImage', sourceId: 'blur-image', category: 'reading', label: 'Blur spoiler images', kind: 'boolean' },
  { key: 'hideSpoilerImageMode', sourceId: 'blur-image-mode', category: 'reading', label: 'Image blur mode', kind: 'choice', choices: choices(['all', 'All images'], ['afterToc', 'After table of contents']), when: condition('hideSpoilerImage', true) },
  { key: 'hideFurigana', sourceId: 'hide-furigana', category: 'reading', label: 'Hide furigana', kind: 'boolean' },
  { key: 'furiganaStyle', sourceId: 'furigana-style', category: 'reading', label: 'Hidden furigana style', kind: 'choice', choices: choices(['Hide', 'Hide'], ['partial', 'Partial'], ['toggle', 'Toggle'], ['full', 'Full']), when: condition('hideFurigana', true) },
  { key: 'pauseTrackerOnCustomPointChange', sourceId: 'pause-tracker-on-custom-point-change', category: 'reading', label: 'Pause tracker while changing reading point', kind: 'boolean', when: tracking },
  { key: 'customReadingPointEnabled', sourceId: 'custom-reading-point-enabled', category: 'reading', label: 'Custom reading point', kind: 'boolean', when: condition('viewMode', 'continuous') },
  { key: 'selectionToBookmarkEnabled', sourceId: 'selection-to-bookmark-enabled', category: 'reading', label: 'Bookmark near selected text', kind: 'boolean', when: paginated },
  { key: 'enableTapEdgeToFlip', sourceId: 'enable-tap-edge-to-flip', category: 'reading', label: 'Tap page edges to turn', kind: 'boolean', when: paginated },
  { key: 'hideExternalReadHint', sourceId: 'hide-external-read-hint', category: 'library', label: 'Hide external source warning', kind: 'boolean' },
  { key: 'importHTMLFixMode', sourceId: 'import-htmlfix-mode', category: 'library', label: 'EPUB import fixes', kind: 'choice', choices: choices(['Off', 'Off'], ['Standard', 'Standard'], ['Extended', 'Extended']) },
  { key: 'restrictImportFixToAnchor', sourceId: 'restrict-import-fix-to-anchor', category: 'library', label: 'Restrict import fixes to links', kind: 'boolean', when: condition('importHTMLFixMode', 'Standard', 'Extended') },
  { key: 'cacheStorageData', sourceId: 'cache-storage-data', category: 'library', label: 'Cache external book data', kind: 'boolean' },
  { key: 'autoReplication', sourceId: 'auto-replication', category: 'library', label: 'Automatic import/export preference', kind: 'choice', choices: choices(['off', 'Off'], ['up', 'Export'], ['down', 'Import'], ['all', 'Import and export']), description: 'A preference for an existing usable source. It does not connect a provider or grant folder access.' },
  { key: 'replicationSaveBehavior', sourceId: 'replication-save-behavior', category: 'library', label: 'Import/export behavior', kind: 'choice', choices: choices(['overwrite', 'Overwrite'], ['new', 'New only']) },
  { key: 'showExternalPlaceholder', sourceId: 'show-external-placeholder', category: 'library', label: 'Show external book placeholders', kind: 'boolean' },
  { key: 'keepLocalStatisticsOnDeletion', sourceId: 'keep-local-statistics-on-deletion', category: 'tracking', label: 'Keep statistics when deleting local books', kind: 'boolean' },
  { key: 'overwriteBookCompletion', sourceId: 'overwrite-book-completion', category: 'tracking', label: 'Update book completion date', kind: 'boolean', description: 'Track the latest completion rather than only the first.' },
  { key: 'startDayHoursForTracker', sourceId: 'start-day-hours-for-tracker', category: 'tracking', label: 'New reading day starts at (hour)', kind: 'number', min: 0, max: 23, step: 1, integer: true },
  { key: 'statisticsMergeMode', sourceId: 'statistics-merge-mode', category: 'tracking', label: 'Statistics merge preference', kind: 'choice', choices: choices(['merge', 'Merge entries'], ['replace', 'Replace']) },
  { key: 'readingGoalsMergeMode', sourceId: 'reading-goals-merge-mode', category: 'tracking', label: 'Reading goals merge preference', kind: 'choice', choices: choices(['merge', 'Merge entries'], ['replace', 'Replace']), description: 'Saves only the preference. Account-owned goal editing and syncing need an ownership-aware native service.' },
  { key: 'statisticsEnabled', sourceId: 'statistics-enabled', category: 'tracking', label: 'Track reading statistics', kind: 'boolean' },
  { key: 'trackerAutoPause', sourceId: 'tracker-auto-pause', category: 'tracking', label: 'Tracker auto pause', kind: 'choice', choices: choices(['off', 'Off'], ['moderate', 'Moderate'], ['strict', 'Strict']), when: tracking },
  { key: 'openTrackerOnCompletion', sourceId: 'open-tracker-on-completion', category: 'tracking', label: 'Show tracker on completion', kind: 'boolean', when: tracking },
  { key: 'addCharactersOnCompletion', sourceId: 'add-characters-on-completion', category: 'tracking', label: 'Count remaining text on completion', kind: 'boolean', when: tracking },
  { key: 'trackerAutostartTime', sourceId: 'tracker-auto-start-time', category: 'tracking', label: 'Tracker start delay (seconds)', kind: 'number', min: 0, step: 1, when: tracking, description: '0 disables automatic starting.' },
  { key: 'trackerIdleMinutes', sourceId: 'tracker-idle-time-in-min', category: 'tracking', label: 'Tracker idle time (minutes)', kind: 'number', min: 0, max: MAX_TRACKER_IDLE_MINUTES, step: 0.5, when: tracking, description: '0 disables idle pause. Maximum 12 hours. Persisted in seconds by the existing policy.' },
  { key: 'trackerForwardSkipThreshold', sourceId: 'tracker-forward-skip-threshold', category: 'tracking', label: 'Forward skip threshold (characters)', kind: 'number', min: 0, step: 1, when: tracking, description: '0 disables this threshold.' },
  { key: 'trackerBackwardSkipThreshold', sourceId: 'tracker-backward-skip-threshold', category: 'tracking', label: 'Backward skip threshold (characters)', kind: 'number', min: 0, step: 1, when: tracking, description: 'Use a positive count; 0 disables this threshold.' },
  { key: 'trackerSkipThresholdAction', sourceId: 'tracker-skip-threshold-action', category: 'tracking', label: 'Skip threshold action', kind: 'choice', choices: choices(['ignore', 'Ignore'], ['pause', 'Pause']), when: tracking },
  { key: 'trackerPopupDetection', sourceId: 'tracker-popup-detection', category: 'tracking', label: 'Dictionary popup detection', kind: 'boolean', when: [...tracking, ...condition('trackerAutoPause', 'moderate', 'strict')], description: 'Skip automatic pause while a supported dictionary popup is detected in the reader.' },
  { key: 'adjustStatisticsAfterIdleTime', sourceId: 'adjust-statistics-after-idle-time', category: 'tracking', label: 'Roll back idle reading time', kind: 'boolean', when: tracking },
];

export function definitionFor(key: unknown): SettingDefinition {
  const result = nativeSettingDefinitions.find(field => field.key === key);
  if (!result) throw new Error('Unknown reader setting.');
  return result;
}
export function validateNativeSetting(key: unknown, value: unknown, dynamicChoices: readonly SettingChoice[] = []): SettingDefinition {
  const field = definitionFor(key);
  if (value === null && field.nullable) return field;
  if (field.kind === 'boolean' && typeof value === 'boolean') return field;
  if (field.kind === 'number' && typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && value >= (field.min ?? -Number.MAX_SAFE_INTEGER) && value <= (field.max ?? Number.MAX_SAFE_INTEGER) && (!field.integer || Number.isSafeInteger(value))) return field;
  // Match the reader font resolver's supported length, excluding control characters.
  if (field.kind === 'text' && typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value)) return field;
  if (field.kind === 'choice' && typeof value === 'string' && (field.key === 'theme' ? dynamicChoices : field.choices)?.some(choice => choice.value === value)) return field;
  throw new Error(`Enter a supported value for ${field.label}.`);
}
export function parseSettingDraft(field: SettingDefinition, draft: string): SettingValue {
  if (field.kind !== 'number') return draft;
  if (!draft.trim()) {
    if (field.nullable) return null;
    throw new Error('Enter a number.');
  }
  // Number('')/hex/Infinity coercion must not silently become a saved preference.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(draft.trim())) throw new Error('Enter a finite decimal number.');
  const value = Number(draft);
  validateNativeSetting(field.key, value);
  return value;
}
export function settingIsEnabled(field: SettingDefinition, values: Readonly<Record<string, SettingValue>>): boolean {
  if (field.when && !field.when.every(rule => rule.values.includes(values[rule.key]))) return false;
  if (field.key === 'trackerSkipThresholdAction' && !values.trackerForwardSkipThreshold && !values.trackerBackwardSkipThreshold) return false;
  if (field.key === 'adjustStatisticsAfterIdleTime' && !(Number(values.trackerIdleMinutes) > 0)) return false;
  return true;
}
export function matchesNativeSetting(field: SettingDefinition, category: string, query: string): boolean {
  return matchesSetting({ category, query }, field.category, `${field.label} ${field.key} ${field.sourceId} ${field.description ?? ''}`);
}
