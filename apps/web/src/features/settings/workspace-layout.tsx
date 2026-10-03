/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Host, TextInput, useNativeState } from '@expo/ui';
export interface WorkspaceColors {
  text: string;
  muted: string;
  mode: 'light' | 'dark';
  seedColor: string;
}
export interface WorkspaceFrameProps {
  children?: ReactNode;
  rootRef?(value: unknown): void;
}
export interface WorkspaceSearchProps {
  query: string;
  onSearch(query: string): void;
  colors?: WorkspaceColors;
}
export interface WorkspaceCategoryProps {
  id: string;
  label: string;
  selected: boolean;
  onActivate(event?: unknown): void;
  colors?: WorkspaceColors;
}
export interface WorkspaceIntroductionProps {
  title: string;
  description: string;
  saveDescription: string;
  resultText?: string;
  colors?: WorkspaceColors;
}
export function WorkspaceFrame({ children }: WorkspaceFrameProps) {
  return <View style={styles.frame}>{children}</View>;
}
export function WorkspaceAside({ children }: { children?: ReactNode }) {
  return <View style={styles.aside}>{children}</View>;
}
export function WorkspaceSearch({ query, onSearch, colors }: WorkspaceSearchProps) {
  const value = useNativeState(query);
  useEffect(() => {
    value.value = query;
  }, [value, query]);
  return (
    <View style={styles.search}>
      <Text style={[styles.label, { color: colors?.text }]}>Search settings</Text>
      <Host
        matchContents={{ vertical: true }}
        colorScheme={colors?.mode}
        seedColor={colors?.seedColor}
        accessibilityLabel="Search settings"
        style={{ width: '100%', minHeight: 48 }}
      >
        <TextInput
          value={value}
          placeholder="Search all settings…"
          maxLength={1024}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(next) => {
            value.value = next;
            onSearch(next);
          }}
        />
      </Host>
    </View>
  );
}
export function WorkspaceNavigation({ children }: { children?: ReactNode }) {
  return <View style={styles.navigation}>{children}</View>;
}
export function WorkspaceCategory({ label, selected, onActivate, colors }: WorkspaceCategoryProps) {
  return (
    <Host matchContents colorScheme={colors?.mode} seedColor={colors?.seedColor}>
      <Button
        label={label}
        variant={selected ? 'filled' : 'outlined'}
        onPress={() => onActivate()}
      />
    </Host>
  );
}
export function WorkspaceMain({ children }: { children?: ReactNode }) {
  return <View style={styles.main}>{children}</View>;
}
export function WorkspaceIntroduction({
  title,
  description,
  saveDescription,
  resultText,
  colors
}: WorkspaceIntroductionProps) {
  return (
    <View style={styles.introduction}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors?.text }]}>
        {title}
      </Text>
      <Text style={[styles.description, { color: colors?.muted }]}>{description}</Text>
      <Text style={[styles.save, { color: colors?.muted }]}>{saveDescription}</Text>
      {resultText !== undefined ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.description, { color: colors?.text }]}
        >
          {resultText}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { minWidth: 0, gap: 24 },
  aside: { minWidth: 0, gap: 12 },
  search: { minWidth: 0, gap: 8 },
  label: { fontSize: 14, fontWeight: '500' },
  navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  main: { minWidth: 0, gap: 14 },
  introduction: { gap: 8, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '600' },
  description: { fontSize: 14 },
  save: { fontSize: 12 }
});
