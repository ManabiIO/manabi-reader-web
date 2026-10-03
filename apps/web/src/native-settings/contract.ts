/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SettingChoice, SettingDefinition, SettingValue, CategoryId } from './schema';
import type { ThemeOption } from '../lib/data/theme-option';

export const SETTINGS_SCHEMA_VERSION = 1 as const;
export interface NativeSettingField extends SettingDefinition {
  value: SettingValue;
  enabled: boolean;
  unavailableReason?: string;
  choices?: readonly SettingChoice[];
}
export interface NativeTheme {
  id: string;
  label: string;
  custom: boolean;
  colors: ThemeOption;
}
export interface NativeSettingsGate {
  id: string;
  category: CategoryId;
  label: string;
  reason: string;
}
export interface NativeSettingsState {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  fields: NativeSettingField[];
  themes: NativeTheme[];
  fonts: { primary: string[]; secondary: string[]; effectivePrimary: string };
  gates: NativeSettingsGate[];
}
export type NativeSettingsAction =
  | { type: 'set'; key: string; value: SettingValue; expectedValue: SettingValue }
  | { type: 'reading-point.reset' }
  | {
      type: 'theme.save';
      name: string;
      previousName: string | null;
      colors: ThemeOption;
      expectedColors: ThemeOption | null;
    }
  | { type: 'theme.delete'; name: string; expectedColors: ThemeOption };
export type SettingsCommand = (
  method: 'settings.state' | 'settings.action',
  payload?: Record<string, unknown>
) => Promise<unknown>;

export const nativeSettingsGates: readonly NativeSettingsGate[] = [
  {
    id: 'background-images',
    category: 'appearance',
    label: 'Background images',
    reason:
      'Native image selection and a bounded image transfer are not connected yet. Existing reader images are preserved; the native library does not display them.'
  },
  {
    id: 'persistent-storage',
    category: 'library',
    label: 'Storage protection and offline status',
    reason:
      'Reader data is owned by the embedded local reader. Browser storage protection is not an Android persistent-directory permission. Native directory access and eviction behavior need device integration checks.'
  },
  {
    id: 'storage-sources',
    category: 'library',
    label: 'Connect accounts and storage sources',
    reason:
      'Native first-party and provider session handoff, WebDAV credential storage, and persistent folder capabilities are not connected. Changing a sync preference does not connect a source.'
  },
  {
    id: 'reading-goals',
    category: 'tracking',
    label: 'Advanced reading goals, history, merge and sync',
    reason:
      'These flows need an account-owned native goal service. Global legacy goal/history tables are not exposed to the current profile.'
  },
  {
    id: 'zombie-statistics',
    category: 'tracking',
    label: 'Clear orphaned statistics',
    reason:
      'The legacy global cleanup is not exposed here. Use account-scoped statistics actions for data owned by the current profile.'
  }
];
