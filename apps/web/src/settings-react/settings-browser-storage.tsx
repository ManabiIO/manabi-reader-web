/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef
} from 'react';
import { View } from 'react-native';
import { storage } from '$lib/data/window/navigator/storage';
import {
  persistentStorageStatus,
  retryPersistentStorage
} from '$lib/data/window/navigator/persistent-storage';
import {
  createBrowserStorageStatus,
  type BrowserStorageStatusState
} from '../runtime/browser-storage-status';
import { ActionButton } from '../shared-ui/ActionButton';
import { UiText } from '../shared-ui/Typography';
import { useUiTheme } from '../shared-ui/theme';
import { SettingsItemGroup } from './settings-item-group';

function formatBytes(value: number) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log10(Math.max(1, value)) / 3), units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1000 ** unit)} ${units[unit]}`;
}

/** Browser observations have one owner; settings controllers do not probe storage. */
export function SettingsBrowserStorage() {
  const [status, setStatus] = useState<Readonly<BrowserStorageStatusState> | null>(null);
  const model = useRef<ReturnType<typeof createBrowserStorageStatus> | null>(null);
  const requestElement = useRef<ComponentRef<typeof View> | null>(null);
  const refreshElement = useRef<ComponentRef<typeof View> | null>(null);
  const handoffFocus = useRef(false);
  const requestRef = useCallback((node: ComponentRef<typeof View> | null) => {
    // A successful grant removes this action. Preserve keyboard position only
    // if the action still owns focus; never steal focus from another control.
    if (!node && requestElement.current === (document.activeElement as unknown))
      handoffFocus.current = true;
    requestElement.current = node;
  }, []);
  const { colors } = useUiTheme();
  useEffect(() => {
    const current = createBrowserStorageStatus({
      readProtection: persistentStorageStatus,
      requestProtection: retryPersistentStorage,
      estimate: storage.estimate,
      capabilities: () => ({
        protection: typeof navigator.storage?.persisted === 'function',
        request: typeof navigator.storage?.persist === 'function',
        estimate: typeof navigator.storage?.estimate === 'function'
      })
    });
    model.current = current;
    const unsubscribe = current.subscribe(setStatus);
    void current.refresh();
    return () => {
      unsubscribe();
      current.dispose();
      if (model.current === current) model.current = null;
    };
  }, []);
  const busy = status?.busy ?? (status ? null : 'checking');
  const protectedStorage = status?.protection === 'protected';
  useLayoutEffect(() => {
    if (handoffFocus.current) {
      handoffFocus.current = false;
      (refreshElement.current as unknown as HTMLElement | null)?.focus();
    }
  }, [protectedStorage]);
  const usage = status?.usage;
  const quota = status?.quota;
  const hasEstimate = typeof usage === 'number' && typeof quota === 'number';
  const percent = hasEstimate ? Math.min(100, (usage / quota) * 100) : 0;
  const muted = { fontSize: 14, color: colors.mutedForeground };
  return (
    <SettingsItemGroup
      settingId="persistent-storage"
      category="library"
      keywords="persistentStorage offline quota usage backup browser protection local device"
      title="Storage on this device"
    >
      <View style={{ gap: 16 }} testID="browser-storage-details" aria-busy={Boolean(busy)}>
        <View style={{ gap: 6 }}>
          <UiText role="status" accessibilityLiveRegion="polite" style={{ fontWeight: '600' }}>
            {busy === 'requesting'
              ? 'Requesting storage protection…'
              : busy === 'checking'
                ? 'Checking browser storage…'
                : protectedStorage
                  ? 'Protected from automatic browser cleanup'
                  : status?.protection === 'unavailable'
                    ? 'Storage protection isn’t available in this browser'
                    : status?.protection === 'unknown'
                      ? 'Storage protection couldn’t be checked'
                      : 'Storage protection isn’t confirmed'}
          </UiText>
          <UiText style={muted}>
            {protectedStorage
              ? 'The browser has granted protection from automatic eviction. Clearing site data can still remove your local reading data.'
              : 'Local books use browser storage. Protection reduces automatic cleanup when storage is low.'}
          </UiText>
        </View>
        <View style={{ gap: 8 }}>
          <UiText style={{ fontSize: 14, fontWeight: '600' }}>Site storage estimate</UiText>
          <UiText style={muted} testID="browser-storage-estimate">
            {busy
              ? 'Checking the browser’s estimate…'
              : hasEstimate
                ? `${formatBytes(usage)} used · ${formatBytes(quota)} browser allowance`
                : 'This browser hasn’t provided a storage estimate.'}
          </UiText>
          {!busy && hasEstimate && (
            <View
              role="progressbar"
              accessibilityLabel="Site storage usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              style={{
                height: 4,
                borderRadius: 2,
                overflow: 'hidden',
                backgroundColor: colors.muted
              }}
            >
              <View style={{ width: `${percent}%`, height: 4, backgroundColor: colors.primary }} />
            </View>
          )}
          <UiText style={muted}>
            Includes other apps on this site. This isn’t a Reader-only total or your device’s free
            space.
          </UiText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {status?.canRequest && !protectedStorage && (
            <ActionButton
              ref={requestRef}
              variant="secondary"
              shape="rounded"
              style={{ minHeight: 44 }}
              aria-busy={busy === 'requesting'}
              onPress={() => {
                if (!busy && !protectedStorage) void model.current?.requestProtection();
              }}
            >
              Request storage protection
            </ActionButton>
          )}
          <ActionButton
            ref={refreshElement}
            variant="outline"
            shape="rounded"
            style={{ minHeight: 44 }}
            aria-busy={busy === 'checking'}
            onPress={() => {
              if (!busy) void model.current?.refresh();
            }}
          >
            Refresh storage details
          </ActionButton>
        </View>
        {status?.feedback === 'not-granted' && (
          <UiText role="status" accessibilityLiveRegion="polite" style={muted}>
            The browser hasn’t granted protection. Your saved data hasn’t been removed. You can try
            again later.
          </UiText>
        )}
        {status?.feedback === 'unavailable' && status.protection !== 'unavailable' && (
          <UiText role="status" accessibilityLiveRegion="polite" style={muted}>
            The protection request couldn’t complete. Your saved data hasn’t been removed.
          </UiText>
        )}
        <UiText style={muted}>
          Keep backups before clearing site data or moving to another device. Protection doesn’t
          sync or back up your library.
        </UiText>
      </View>
    </SettingsItemGroup>
  );
}
