/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import {
  isNativeBackgroundResource,
  type BackgroundSlot,
  type NativeBackgroundResource
} from './background-contract';
/** A decorative projection of the existing local owner. No native storage or URI loading. */
export function NativeSavedBackground({
  target,
  mode,
  active = true
}: BackgroundSlot & { active?: boolean }) {
  const { snapshot, command } = useReaderRuntime();
  const key = `${snapshot.session}:${snapshot.epoch}:${snapshot.backgroundRevision ?? 0}:${target}:${mode}`;
  const [saved, setSaved] = useState<{ key: string; value: NativeBackgroundResource }>();
  const [failed, setFailed] = useState('');
  useEffect(() => {
    let current = true;
    if (active && snapshot.session)
      void command('appearance.background.read', { target, mode })
        .then((value) => {
          if (
            current &&
            isNativeBackgroundResource(value) &&
            value.target === target &&
            value.mode === mode
          )
            setSaved({ key, value });
        })
        .catch(() => {
          if (current) setSaved(undefined);
        });
    return () => {
      current = false;
    };
  }, [key, active, command]);
  const value = active && saved?.key === key ? saved.value : undefined;
  const image = value?.image;
  if (!image || failed === key) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Image
        key={image.uri}
        testID={`${target}-background-image`}
        source={{ uri: image.uri }}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        accessible={false}
        onError={() => setFailed(key)}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: mode === 'dark' ? '#000' : '#fff', opacity: value.fade }
        ]}
      />
    </View>
  );
}
