/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  SETTINGS_SCHEMA_VERSION,
  type NativeSettingsAction,
  type NativeSettingsState,
  type SettingsCommand
} from './contract';
import { nativeSettingDefinitions } from './schema';
export interface SettingsViewState {
  data?: NativeSettingsState;
  pending: boolean;
  error: string;
  reconcileRequired: boolean;
}
export interface SettingsOwner {
  session: string;
  epoch: number;
}
/** Screen-local admission. Bridge authority still owns request deduplication and mutations. */
export class NativeSettingsSession {
  private disposed = false;
  private started = false;
  private inFlight = false;
  private value: SettingsViewState = { pending: false, error: '', reconcileRequired: false };
  constructor(
    private owner: SettingsOwner,
    private currentOwner: () => SettingsOwner,
    private command: SettingsCommand,
    private publish: (value: SettingsViewState) => void
  ) {}
  private current() {
    const owner = this.currentOwner();
    return (
      !this.disposed &&
      !!this.owner.session &&
      owner.session === this.owner.session &&
      owner.epoch === this.owner.epoch
    );
  }
  private emit(patch: Partial<SettingsViewState>) {
    if (this.current()) {
      this.value = { ...this.value, ...patch };
      this.publish(this.value);
    }
  }
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.refresh();
  }
  dispose() {
    this.disposed = true;
  }
  refresh() {
    return this.run('settings.state');
  }
  act(action: NativeSettingsAction) {
    if (this.value.reconcileRequired) return Promise.resolve(false);
    return this.run('settings.action', action as unknown as Record<string, unknown>);
  }
  private async run(
    method: 'settings.state' | 'settings.action',
    payload?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.current() || this.inFlight) return false;
    this.inFlight = true;
    this.emit({ pending: true, error: '' });
    try {
      const data = await this.command(method, payload);
      if (!this.current()) return false;
      if (!isNativeSettingsState(data))
        throw new Error(
          'The settings response is incompatible. Reopen Settings to refresh the saved state.'
        );
      this.emit({ data, reconcileRequired: false });
      return true;
    } catch (cause) {
      this.emit({
        error:
          cause instanceof Error
            ? cause.message
            : 'Settings could not be loaded. Refresh saved state before trying again.',
        reconcileRequired: true
      });
      return false;
    } finally {
      this.inFlight = false;
      this.emit({ pending: false });
    }
  }
}
export function isNativeSettingsState(value: unknown): value is NativeSettingsState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<NativeSettingsState>;
  return (
    state.schemaVersion === SETTINGS_SCHEMA_VERSION &&
    Array.isArray(state.fields) &&
    state.fields.length === nativeSettingDefinitions.length &&
    new Set(state.fields.map((field) => field.key)).size === state.fields.length &&
    state.fields.every(
      (field) =>
        nativeSettingDefinitions.some(
          (definition) => definition.key === field.key && definition.kind === field.kind
        ) && typeof field.enabled === 'boolean'
    ) &&
    Array.isArray(state.themes) &&
    state.themes.length <= 135 &&
    !!state.fonts &&
    Array.isArray(state.fonts.primary) &&
    Array.isArray(state.fonts.secondary) &&
    Array.isArray(state.gates)
  );
}
