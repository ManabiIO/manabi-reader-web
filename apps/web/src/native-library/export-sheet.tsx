/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { UiText } from '../shared-ui/Typography';
import { ActionButton } from '../shared-ui/ActionButton';
import { CheckboxField } from '../shared-ui/Fields';
import {
  BookExportContent,
  type BookExportContentLayout
} from '../features/library/BookExportContent';
import { bookExportOptions, type BookExportPart } from '../features/library/export-options';

const layout: BookExportContentLayout = {
  Group: ({ children }) => <View style={{ gap: 8 }}>{children}</View>,
  Choice: ({ label, checked, disabled, onChange }) => (
    <CheckboxField label={label} value={checked} disabled={disabled} onValueChange={onChange} />
  )
};

export function NativeBookExportForm({
  selection,
  onFinished
}: {
  selection: { token: string; keys: string[] };
  onFinished(message: string, failed?: boolean): void;
}) {
  const { exportBooks } = useReaderRuntime();
  const [parts, setParts] = useState<BookExportPart[]>(() =>
    bookExportOptions.map(([part]) => part)
  );
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);
  const save = async () => {
    if (pending.current) return;
    const operation = new AbortController();
    pending.current = operation;
    setWorking(true);
    try {
      const result = await exportBooks(
        { token: selection.token, keys: [...selection.keys], parts: [...parts] },
        operation.signal,
        (text) => {
          if (mounted.current && !operation.signal.aborted) setMessage(text);
        }
      );
      if (!mounted.current) return;
      if (result) onFinished(`Saved ${result.filename} to the chosen folder.`);
      else {
        setMessage('No folder selected.');
      }
    } catch (cause) {
      if (mounted.current) {
        // Admission is single-use once preparation starts. Finish this dialog
        // and refresh before any explicit retry; never replay an uncertain save.
        const cancelled =
          operation.signal.aborted && cause instanceof Error && cause.name === 'AbortError';
        onFinished(
          cancelled
            ? 'Export cancelled.'
            : cause instanceof Error
              ? cause.message
              : 'The ZIP could not be saved.',
          !cancelled
        );
      }
    } finally {
      pending.current = null;
      if (mounted.current) setWorking(false);
    }
  };
  return (
    <View style={{ gap: 16 }}>
      <UiText>{selection.keys.length} selected on this page</UiText>
      <UiText>
        Save a ZIP to a folder you choose. This works offline. Keep this file somewhere safe; it is
        a copy of the selected data, not a sync.
      </UiText>
      <UiText>
        Settings, fonts, background images, snippets and annotations are not included. ZIP
        restoration is currently available on the web.
      </UiText>
      <UiText accessibilityRole="header">Export content</UiText>
      <BookExportContent layout={layout} selected={parts} onChange={setParts} disabled={working} />
      {message ? <UiText accessibilityLiveRegion="polite">{message}</UiText> : null}
      <ActionButton
        disabled={working || !parts.length}
        onPress={() => {
          void save();
        }}
      >
        {working ? 'Saving ZIP…' : 'Choose folder and save ZIP'}
      </ActionButton>
      {working ? (
        <ActionButton onPress={() => pending.current?.abort()}>Cancel export</ActionButton>
      ) : null}
    </View>
  );
}
