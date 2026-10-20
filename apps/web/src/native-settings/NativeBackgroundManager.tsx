/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Dialog } from '../shared-ui/ModalSurface';
import { UiText } from '../shared-ui/Typography';
import { ActionButton } from '../shared-ui/ActionButton';
import {
  SettingsBackgroundImages,
  type BackgroundImageView
} from '../features/settings/SettingsBackgroundImages';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import {
  isNativeBackgroundState,
  isNativeBackgroundResource,
  type BackgroundSlot,
  type NativeBackgroundState
} from './background-contract';

export function NativeBackgroundManager({ onClose }: { onClose(): void }) {
  const { snapshot, command, importBackground } = useReaderRuntime();
  const lifetime = useMemo(() => new AbortController(), [snapshot.session, snapshot.epoch]);
  const active = useRef(lifetime);
  active.current = lifetime;
  const mounted = useRef(false),
    started = useRef<AbortController | undefined>(undefined),
    lease = useRef<symbol | undefined>(undefined);
  const [saved, setSaved] = useState<{ owner: AbortController; data: NativeBackgroundState }>();
  const data = saved?.owner === lifetime ? saved.data : undefined;
  const [images, setImages] = useState<
    Record<string, { uri?: string; fade: number; error?: string }>
  >({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const current = () => mounted.current && active.current === lifetime && !lifetime.signal.aborted;
  async function load() {
    const next = await command('settings.backgrounds.read', {});
    if (!current()) return;
    if (!isNativeBackgroundState(next))
      throw new Error(
        'Saved backgrounds returned an incompatible response. Refresh before continuing.'
      );
    const resources: typeof images = {};
    for (const slot of next.slots) {
      if (!current()) return;
      const key = `${slot.target}:${slot.mode}`;
      try {
        const resource = await command('appearance.background.read', {
          target: slot.target,
          mode: slot.mode
        });
        if (!current()) return;
        if (
          !isNativeBackgroundResource(resource) ||
          resource.target !== slot.target ||
          resource.mode !== slot.mode
        )
          throw new Error('The background preview could not be read.');
        resources[key] = { uri: resource.image?.uri, fade: resource.fade };
      } catch (cause) {
        if (!current()) return;
        resources[key] = {
          fade: 0,
          error:
            cause instanceof Error ? cause.message : 'The background preview could not be read.'
        };
      }
    }
    if (current()) {
      setSaved({ owner: lifetime, data: next });
      setImages(resources);
      setNeedsRefresh(false);
    }
  }
  async function run(work: () => Promise<unknown>) {
    if (!current() || lease.current) return;
    const token = Symbol('background-ui');
    lease.current = token;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      if (current()) {
        setError(
          cause instanceof Error ? cause.message : 'Background storage is unavailable. Try again.'
        );
        setNeedsRefresh(true);
      }
    } finally {
      if (lease.current === token) lease.current = undefined;
      if (current()) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (started.current !== lifetime) {
      started.current = lifetime;
      lease.current = undefined;
      setSaved(undefined);
      setImages({});
      setNeedsRefresh(false);
      void run(load);
    }
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current || active.current !== lifetime) lifetime.abort();
      });
    };
  }, [lifetime]);
  const close = () => {
    lifetime.abort();
    onClose();
  };
  const choose = (slot: BackgroundSlot) =>
    void run(async () => {
      const saved = await importBackground(slot, lifetime.signal);
      if (saved && current()) await load();
    });
  const remove = (target: BackgroundSlot['target'], mode: BackgroundSlot['mode'] | 'both') =>
    void run(async () => {
      await command('settings.backgrounds.action', { type: 'remove', target, mode });
      if (current()) await load();
    });
  return (
    <Dialog visible title="Background images" closeLabel="Close background images" onClose={close}>
      <View style={{ gap: 16, minWidth: 0 }}>
        <UiText>
          Choose separate light and dark images for your library and reader. PNG, JPEG, or WebP, up
          to 8 MB.
        </UiText>
        <UiText>
          Images stay on this device and aren’t synced or included in book backups. Keep your
          originals to use them on another device.
        </UiText>
        {!!error && <UiText accessibilityRole="alert">{error}</UiText>}
        {needsRefresh && (
          <UiText>
            Refresh saved backgrounds before retrying. An interrupted save is never replayed
            automatically.
          </UiText>
        )}
        <ActionButton variant="outline" disabled={busy} onPress={() => void run(load)}>
          Refresh saved backgrounds
        </ActionButton>
        {!data && !error && <UiText accessibilityLiveRegion="polite">Loading backgrounds…</UiText>}
        {data &&
          (['library', 'reader'] as const).map((target) => {
            const slots: BackgroundImageView[] = data.slots
              .filter((slot) => slot.target === target)
              .map((slot) => ({ ...slot, ...images[`${target}:${slot.mode}`], busy }));
            return (
              <SettingsBackgroundImages
                key={target}
                target={target}
                label={target === 'library' ? 'Book browser background' : 'Book reader background'}
                slots={slots}
                fade={0}
                disabled={busy || needsRefresh}
                onChoose={(mode) => choose({ target, mode })}
                onRemove={(mode) => remove(target, mode)}
                onRemoveBoth={() => remove(target, 'both')}
              />
            );
          })}
        <UiText>
          Adjust fading in Appearance settings. Light fades toward white; dark fades toward black.
        </UiText>
      </View>
    </Dialog>
  );
}
