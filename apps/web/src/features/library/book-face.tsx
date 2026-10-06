/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useUiTheme } from '../../shared-ui/theme';
import type { LibraryBookFaceLayout } from './LibraryBookFace';
/** Native text/layout leaves retain readable scaling and full titles. */
export const bookFaceLayout: LibraryBookFaceLayout = {
  Face: ({ grid, children }) => <View style={[styles.face, grid && styles.grid]}>{children}</View>,
  Thumbnail: ({ children, grid }) => (
    <View style={[styles.thumbnail, grid && { width: '100%' }]}>{children}</View>
  ),
  Copy: ({ children }) => <View style={styles.copy}>{children}</View>,
  Title: ({ children }) => {
    const { colors } = useUiTheme();
    return <Text style={[styles.title, { color: colors.foreground }]}>{children}</Text>;
  },
  Author: ({ children }) => {
    const { colors } = useUiTheme();
    return <Text style={[styles.author, { color: colors.mutedForeground }]}>{children}</Text>;
  },
  Detail: ({ children }) => {
    const { colors } = useUiTheme();
    return <Text style={[styles.detail, { color: colors.mutedForeground }]}>{children}</Text>;
  },
  Unread: () => {
    const { colors } = useUiTheme();
    return (
      <Text accessibilityLabel="Unread" style={[styles.unread, { color: colors.mutedForeground }]}>
        NEW
      </Text>
    );
  },
  Selected: () => {
    const { colors } = useUiTheme();
    return (
      <Text
        style={[
          styles.selected,
          { color: colors.primaryForeground, backgroundColor: colors.primary }
        ]}
      >
        Selected
      </Text>
    );
  }
};
const styles = StyleSheet.create({
  face: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  grid: { flexDirection: 'column', gap: 5 },
  thumbnail: { position: 'relative' },
  copy: { flexShrink: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 16, fontWeight: '600' },
  author: { fontSize: 14 },
  detail: { fontSize: 13 },
  unread: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  selected: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    fontSize: 11,
    fontWeight: '600'
  }
});
