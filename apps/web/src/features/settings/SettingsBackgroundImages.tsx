/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { ActionButton } from '../../shared-ui/ActionButton';
import type { BackgroundMode, BackgroundTarget } from '../../lib/appearance/state';
import {
  BackgroundFrame,
  BackgroundModes,
  BackgroundModeFrame,
  BackgroundPreview,
  BackgroundMessage,
  BackgroundActions
} from './background-layout';
export interface BackgroundImageView {
  mode: BackgroundMode;
  fade?: number;
  present: boolean;
  uri?: string;
  name?: string;
  busy: boolean;
  error?: string;
  input?: ReactNode;
}
/** Shared image-editor composition. All persistence and file selection stay in the owners. */
export function SettingsBackgroundImages({
  target,
  label,
  slots,
  fade,
  onChoose,
  onRemove,
  onRemoveBoth,
  children,
  disabled = false
}: {
  target: BackgroundTarget;
  label: string;
  slots: BackgroundImageView[];
  fade: number;
  onChoose(mode: BackgroundMode): void;
  onRemove(mode: BackgroundMode): void;
  onRemoveBoth(): void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const busy = slots.some((slot) => slot.busy);
  return (
    <BackgroundFrame label={label} busy={busy}>
      <BackgroundModes>
        {slots.map((slot) => (
          <BackgroundModeFrame key={slot.mode} target={target} mode={slot.mode}>
            <BackgroundPreview
              target={target}
              mode={slot.mode}
              uri={slot.uri}
              fade={slot.fade ?? fade}
              present={slot.present}
            />
            <BackgroundActions>
              <ActionButton
                variant="outline"
                disabled={disabled || slot.busy}
                accessibilityLabel={`Choose ${slot.mode} ${label.toLowerCase()}`}
                onPress={() => onChoose(slot.mode)}
                style={{ width: '100%', minHeight: 44 }}
              >
                {`Choose ${slot.mode} image`}
              </ActionButton>
              {slot.input}
              {slot.present || slot.error ? (
                <ActionButton
                  variant="ghost"
                  disabled={disabled || slot.busy}
                  accessibilityLabel={`Remove ${slot.mode} ${label.toLowerCase()}`}
                  onPress={() => onRemove(slot.mode)}
                >
                  Remove
                </ActionButton>
              ) : null}
            </BackgroundActions>
            {!!slot.name && <BackgroundMessage kind="filename">{slot.name}</BackgroundMessage>}
            {slot.busy && <BackgroundMessage kind="status">Preparing image…</BackgroundMessage>}
            {!!slot.error && <BackgroundMessage kind="error">{slot.error}</BackgroundMessage>}
          </BackgroundModeFrame>
        ))}
      </BackgroundModes>
      {slots.some((slot) => slot.present || slot.error) && (
        <ActionButton
          variant="outline"
          disabled={disabled || busy}
          accessibilityLabel={`Remove both ${label.toLowerCase()} images`}
          onPress={onRemoveBoth}
          style={{ marginTop: 12 }}
        >
          Remove both
        </ActionButton>
      )}
      {children}
    </BackgroundFrame>
  );
}
