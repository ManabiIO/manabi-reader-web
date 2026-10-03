/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { UiText as Text } from '../shared-ui/Typography';
import { useUiTheme } from '../shared-ui/theme';
import { validNativeLibraryCover, type NativeLibraryCover } from './cover-contract';

export function NativeBookCover({
  image,
  title,
  creators,
  blurred,
  grid = false
}: {
  image?: NativeLibraryCover | null;
  title: string;
  creators: string;
  blurred: boolean;
  grid?: boolean;
}) {
  const { colors } = useUiTheme();
  const styles = {
    ...baseStyles,
    frame: [baseStyles.frame, { backgroundColor: colors.muted }],
    placeholder: [baseStyles.placeholder, { backgroundColor: colors.muted }],
    title: [baseStyles.title, { color: colors.foreground }],
    author: [baseStyles.author, { color: colors.mutedForeground }],
    binding: [baseStyles.binding, { backgroundColor: colors.border }]
  };
  const [failed, setFailed] = useState('');
  const uri = validNativeLibraryCover(image) ? image.uri : '';
  useEffect(() => setFailed(''), [uri]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, grid && styles.grid]}
    >
      {uri && uri !== failed ? (
        <Image
          key={uri}
          source={{ uri }}
          resizeMode="contain"
          style={styles.image}
          // The DOM thumbnail is already blurred. This also avoids a platform decoding flash.
          blurRadius={blurred ? 8 : 0}
          onError={() => setFailed(uri)}
          accessible={false}
        />
      ) : (
        <View style={styles.placeholder}>
          <Text numberOfLines={4} style={styles.title}>
            {title}
          </Text>
          {!!creators && (
            <Text numberOfLines={2} style={styles.author}>
              {creators}
            </Text>
          )}
        </View>
      )}
      <View pointerEvents="none" style={styles.binding} />
    </View>
  );
}
const baseStyles = StyleSheet.create({
  frame: {
    width: 76,
    height: 114,
    borderRadius: 4,
    overflow: 'hidden'
  },
  grid: { width: '100%', height: 196, marginBottom: 9 },
  image: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    padding: 8,
    gap: 7
  },
  title: { fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
  author: { fontSize: 10, textAlign: 'center' },
  binding: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 3
  }
});
