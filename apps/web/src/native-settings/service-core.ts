/** @license BSD-3-Clause */
import { availableThemes, parseColor, themeNames, type ThemeOption } from '../lib/data/theme-option';
import { SETTINGS_SCHEMA_VERSION, nativeSettingsGates, type NativeSettingsState, type NativeTheme } from './contract';
import { nativeSettingDefinitions, settingIsEnabled, validateNativeSetting, type SettingValue } from './schema';

export interface SettingBinding { read(): unknown; write(value: SettingValue): void }
export interface SettingsServiceDependencies {
  /** An explicit map constructed in the DOM owner. Never a store module namespace. */
  bindings: Readonly<Record<string, SettingBinding>>;
  customThemes: { read(): Record<string, ThemeOption>; write(value: Record<string, ThemeOption>): void };
  fonts(): NativeSettingsState['fonts'];
  resetReadingPoints(assertCurrent: () => void): void;
}
export interface SettingsOperation { assertCurrent(): void; signal?: AbortSignal }
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const colorKeys = ['fontColor', 'backgroundColor', 'selectionFontColor', 'selectionBackgroundColor', 'hintFuriganaShadowColor', 'hintFuriganaFontColor', 'tooltipTextFontColor'] as const;
export const themeColorFields = colorKeys;
const maximumCustomThemes = 128;
function safeName(name: unknown): name is string {
  return typeof name === 'string' && !!name.trim() && name === name.trim() && name.length <= 128 && !/[\u0000-\u001f\u007f]/.test(name) && !['__proto__', 'constructor', 'prototype', 'system-theme'].includes(name);
}
function palette(value: unknown): ThemeOption {
  if (!isRecord(value) || Object.keys(value).length !== colorKeys.length || !colorKeys.every(key => Object.hasOwn(value, key) && !!parseColor(value[key]))) throw new Error('Use a valid hex, rgb, or rgba color for every theme color.');
  return Object.fromEntries(colorKeys.map(key => [key, value[key]])) as unknown as ThemeOption;
}
function samePalette(first: unknown, second: unknown) {
  if (!isRecord(first) || !isRecord(second)) return false;
  return colorKeys.every(key => first[key] === second[key]);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new Error('Invalid settings action.');
}
function jsonScalar(value: unknown): value is SettingValue {
  return value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER || typeof value === 'string' && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}
function assertLive(operation: SettingsOperation) {
  if (operation.signal?.aborted) throw new Error('The settings operation was cancelled. Refresh before trying again.');
  operation.assertCurrent();
}

export function createNativeSettingsService(deps: SettingsServiceDependencies) {
  // Fail early when an admitted control is not explicitly wired to its source.
  for (const definition of nativeSettingDefinitions) if (!Object.hasOwn(deps.bindings, definition.key)) throw new Error(`Missing setting adapter: ${definition.key}`);
  const themeList = (): NativeTheme[] => {
    const builtin = [...availableThemes].map(([id, colors]) => ({ id, label: themeNames[id] ?? id, custom: false, colors: palette(colors) }));
    const custom: NativeTheme[] = [];
    for (const [id, colors] of Object.entries(deps.customThemes.read())) {
      if (!safeName(id) || availableThemes.has(id)) continue;
      try { custom.push({ id, label: id, custom: true, colors: palette(colors) }); } catch { /* Never serialize malformed persisted colors. */ }
      if (custom.length >= maximumCustomThemes) break;
    }
    return [...builtin, ...custom];
  };
  function state(operation: SettingsOperation): NativeSettingsState {
    assertLive(operation);
    const themes = themeList();
    const themeChoices = themes.map(theme => ({ value: theme.id, label: theme.label }));
    const values: Record<string, SettingValue> = {};
    const bad = new Set<string>();
    for (const definition of nativeSettingDefinitions) {
      const value = deps.bindings[definition.key].read();
      if (jsonScalar(value)) values[definition.key] = value;
      else { values[definition.key] = null; bad.add(definition.key); }
    }
    const fields = nativeSettingDefinitions.map(definition => ({
      ...definition,
      value: values[definition.key],
      enabled: !bad.has(definition.key) && settingIsEnabled(definition, values),
      ...(bad.has(definition.key) ? { unavailableReason: 'This saved setting cannot be represented safely. Repair it in the web settings before editing here.' } : {}),
      ...(definition.key === 'theme' ? { choices: themeChoices } : {}),
    }));
    const fonts = deps.fonts();
    const safeFonts = (names: string[]) => [...new Set(names.filter(name => typeof name === 'string' && name.length > 0 && name.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(name)))].slice(0, 128);
    assertLive(operation);
    return { schemaVersion: SETTINGS_SCHEMA_VERSION, fields, themes, fonts: { primary: safeFonts(fonts.primary), secondary: safeFonts(fonts.secondary), effectivePrimary: typeof fonts.effectivePrimary === 'string' && fonts.effectivePrimary.length <= 1024 ? fonts.effectivePrimary : '' }, gates: nativeSettingsGates.map(gate => ({ ...gate })) };
  }
  function action(input: unknown, operation: SettingsOperation): NativeSettingsState {
    assertLive(operation);
    if (!isRecord(input)) throw new Error('Invalid settings action.');
    if (input.type === 'set') {
      exactKeys(input, ['type', 'key', 'value', 'expectedValue']);
      const current = state(operation);
      const field = validateNativeSetting(input.key, input.value, current.themes.map(theme => ({ value: theme.id, label: theme.label })));
      const dto = current.fields.find(candidate => candidate.key === field.key)!;
      if (!dto.enabled) throw new Error(dto.unavailableReason ?? 'This setting is not active for the current reader preferences.');
      const binding = deps.bindings[field.key];
      if (!jsonScalar(input.expectedValue) || !Object.is(binding.read(), input.expectedValue)) throw new Error('This setting changed since you opened it. Refresh before applying your edit.');
      assertLive(operation);
      binding.write(input.value as SettingValue);
      if (field.key === 'textMarginMode' && input.value === 'auto') {
        assertLive(operation);
        deps.bindings.textMarginValue.write(0);
      }
    } else if (input.type === 'reading-point.reset') {
      exactKeys(input, ['type']);
      if (deps.bindings.viewMode.read() !== 'continuous' || deps.bindings.customReadingPointEnabled.read() !== true) throw new Error('Enable the custom reading point in continuous mode before resetting it.');
      assertLive(operation);
      deps.resetReadingPoints(() => assertLive(operation));
    } else if (input.type === 'theme.save') {
      exactKeys(input, ['type', 'name', 'previousName', 'colors', 'expectedColors']);
      if (!safeName(input.name) || availableThemes.has(input.name)) throw new Error('Enter a unique theme name, up to 128 characters, outside the built-in names.');
      const colors = palette(input.colors);
      const previousName = input.previousName;
      const custom = deps.customThemes.read();
      if (previousName !== null) {
        if (!safeName(previousName) || !Object.hasOwn(custom, previousName) || !samePalette(custom[previousName], input.expectedColors)) throw new Error('This theme changed or was removed. Refresh before saving.');
      } else if (input.expectedColors !== null) throw new Error('A new theme cannot replace an existing palette.');
      if (input.name !== previousName && Object.hasOwn(custom, input.name)) throw new Error('A theme with this name already exists.');
      if (previousName === null && Object.keys(custom).length >= maximumCustomThemes) throw new Error('The native theme editor supports up to 128 custom themes.');
      const next = { ...custom, [input.name]: colors };
      if (previousName !== null && previousName !== input.name) delete next[previousName];
      assertLive(operation);
      deps.customThemes.write(next);
      assertLive(operation);
      deps.bindings.theme.write(input.name);
    } else if (input.type === 'theme.delete') {
      exactKeys(input, ['type', 'name', 'expectedColors']);
      const custom = deps.customThemes.read();
      if (!safeName(input.name) || !Object.hasOwn(custom, input.name) || !samePalette(custom[input.name], input.expectedColors)) throw new Error('This theme changed or was removed. Refresh before deleting.');
      const next = { ...custom }; delete next[input.name];
      assertLive(operation);
      // Keep the released deletion behavior: select the existing Manabi preset.
      deps.bindings.theme.write('manabi-theme');
      assertLive(operation);
      deps.customThemes.write(next);
    } else throw new Error('Unknown settings action.');
    return state(operation);
  }
  return { state, action };
}
