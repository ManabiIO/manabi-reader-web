/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ComponentProps
} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View
} from 'react-native';
import { useUiTheme, type UiTheme } from '../shared-ui/theme';
import type {
  NativeSnippetEditor,
  NativeSnippetFolders,
  NativeSnippetPatch,
  NativeSnippetResult,
  NativeSnippetsClient,
  NativeSnippetsState
} from './contract';
export interface NativeSnippetsScreenProps extends NativeSnippetsClient {
  identity: string;
  revision?: number;
  onRead?(id: string): void | Promise<void>;
  backHandlerRef?: MutableRefObject<(() => boolean) | undefined>;
  onEditingChange?(editing: boolean): void;
}
const patchFor = (editor: NativeSnippetEditor): NativeSnippetPatch => ({
  title: editor.title,
  runs: editor.runs.map((run) => ({
    key: run.key,
    text: run.text,
    ...(run.ruby !== undefined ? { ruby: run.ruby } : {})
  })),
  source: { ...editor.source }
});
function Text({ style, ...props }: ComponentProps<typeof NativeText>) {
  const { colors } = useUiTheme();
  return <NativeText {...props} style={[{ color: colors.foreground }, style]} />;
}
function Button({
  title,
  onPress,
  disabled = false,
  danger = false
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const styles = createStyles(useUiTheme().colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, danger && styles.danger, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
/** Remounting on the runtime identity change clears every account-specific field immediately. */
export function NativeSnippetsScreen(props: NativeSnippetsScreenProps) {
  return <Workspace key={props.identity} {...props} />;
}
function Workspace({
  identity,
  request,
  onRead,
  backHandlerRef,
  onEditingChange
}: NativeSnippetsScreenProps) {
  const styles = createStyles(useUiTheme().colors);
  const [state, setState] = useState<NativeSnippetsState>();
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState(false);
  const [source, setSource] = useState<string>();
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<NativeSnippetEditor>();
  const [patch, setPatch] = useState<NativeSnippetPatch>();
  const [dirty, setDirty] = useState(false);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ title: string; action(): void }>();
  const [choosing, setChoosing] = useState(false);
  const [folders, setFolders] = useState<NativeSnippetFolders>();
  const checkpoint = useRef<(close?: boolean) => void>(() => {});
  const alive = useRef(true);
  const running = useRef(false);
  const sequence = useRef(0);
  const latest = useRef({ editor, patch, dirty });
  latest.current = { editor, patch, dirty };
  const report = (cause: unknown) => {
    if (alive.current)
      setError(
        cause instanceof Error
          ? cause.message
          : 'The snippet operation failed. Your saved draft is retained.'
      );
  };
  const load = useCallback(async () => {
    if (!identity) return;
    const run = ++sequence.current;
    try {
      const value = (await request('snippets.state', {
        query,
        trash,
        ...(source ? { source } : {}),
        page
      })) as NativeSnippetsState;
      if (alive.current && run === sequence.current) {
        setState(value);
        setError('');
      }
    } catch (cause) {
      if (alive.current && run === sequence.current) report(cause);
    }
  }, [identity, request, query, trash, source, page]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 180);
    return () => clearTimeout(timer);
  }, [load]);
  const applyEditor = (value: NativeSnippetEditor) => {
    setEditor(value);
    setPatch(patchFor(value));
    setDirty(false);
    latest.current = { editor: value, patch: patchFor(value), dirty: false };
  };
  const act = async (payload: Record<string, unknown>, close = false) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const result = (await request('snippets.action', payload)) as NativeSnippetResult;
      if (!alive.current) return;
      if (result.editor) applyEditor(result.editor);
      if (result.folders) setFolders(result.folders);
      if (result.readerId) await onRead?.(result.readerId);
      if (result.saved || close) {
        setEditor(undefined);
        setPatch(undefined);
        setDirty(false);
        latest.current = { editor: undefined, patch: undefined, dirty: false };
        setChoosing(false);
        await load();
      }
    } catch (cause) {
      if (alive.current) setAutosaveFailed(true);
      report(cause);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const saveDraft = (close = false) => {
    const current = latest.current;
    if (current.editor && current.patch)
      void act(
        {
          type: 'checkpoint',
          token: current.editor.token,
          key: current.editor.key,
          patch: current.patch
        },
        close
      );
  };
  checkpoint.current = saveDraft;
  const change = (value: NativeSnippetPatch) => {
    if (running.current) return;
    setAutosaveFailed(false);
    setPatch(value);
    setDirty(true);
    latest.current = { editor: latest.current.editor, patch: value, dirty: true };
  };
  useEffect(() => {
    if (!dirty || busy || !editor || autosaveFailed) return;
    const timer = setTimeout(() => saveDraft(), 800);
    return () => clearTimeout(timer);
  }, [dirty, patch, busy, editor, autosaveFailed]);
  useEffect(() => {
    alive.current = true;
    const background = AppState.addEventListener('change', (value) => {
      if (value !== 'active' && latest.current.dirty && !running.current) checkpoint.current();
    });
    const handleBack = () => {
      if (!latest.current.editor) return false;
      if (running.current) return true;
      checkpoint.current(true);
      return true;
    };
    if (backHandlerRef) backHandlerRef.current = handleBack;
    const back = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => {
      if (backHandlerRef?.current === handleBack) backHandlerRef.current = undefined;
      alive.current = false;
      sequence.current++;
      background.remove();
      back.remove();
      const current = latest.current;
      if (current.dirty && current.editor && current.patch && !running.current) {
        void request('snippets.action', {
          type: 'checkpoint',
          token: current.editor.token,
          key: current.editor.key,
          patch: current.patch
        }).catch(() => {});
      }
    };
  }, [request, backHandlerRef]);
  useEffect(() => {
    onEditingChange?.(!!editor);
  }, [editor, onEditingChange]);
  const rowAction = (type: string, key: string) => {
    if (state) void act({ type, token: state.token, key });
  };
  const save = (copy = false) => {
    if (editor && patch)
      void act({ type: copy ? 'save-copy' : 'save', key: editor.key, token: editor.token, patch });
  };
  return (
    <View style={styles.root}>
      {!!error && (
        <View accessibilityRole="alert" style={styles.warning}>
          <Text>{error}</Text>
          <Button
            title="Refresh saved state"
            onPress={() => {
              void load();
            }}
          />
        </View>
      )}
      {editor && patch ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.row}>
            <Button title="Keep draft & close" disabled={busy} onPress={() => saveDraft(true)} />
            <Button
              title={busy ? 'Saving…' : 'Save snippet'}
              disabled={busy}
              onPress={() => save()}
            />
          </View>
          <Text accessibilityLiveRegion="polite">
            {busy
              ? 'Saving draft…'
              : dirty
                ? autosaveFailed
                  ? 'Draft could not be saved. Fix the error and retry before leaving.'
                  : 'Unsaved changes; saving shortly'
                : 'Draft saved on this device'}
          </Text>
          <Text style={styles.notice}>{editor.notice}</Text>
          {editor.hasConflict && (
            <View style={styles.warning}>
              <Text>
                The current document was not overwritten. Your draft is safe. Save a separate copy
                or keep the draft and reopen the current version.
              </Text>
              <Button title="Save draft as a new copy" disabled={busy} onPress={() => save(true)} />
            </View>
          )}
          <Text style={styles.label}>Title (blank uses the text)</Text>
          <TextInput
            accessibilityLabel="Snippet title"
            value={patch.title}
            onChangeText={(title) => change({ ...patch, title })}
            editable={!busy}
            maxLength={1000}
            style={styles.input}
          />
          <Text style={styles.label}>Save destination: {editor.destination}</Text>
          {editor.canChooseDestination && (
            <Button
              title="Choose destination"
              disabled={busy}
              onPress={() => {
                setChoosing(!choosing);
                setFolders(undefined);
              }}
            />
          )}
          {choosing && (
            <View style={styles.panel}>
              <Button
                title="This device"
                disabled={busy}
                onPress={() => {
                  change({ ...patch, destinationKey: null });
                  setChoosing(false);
                }}
              />
              {(state?.sources ?? []).map((item) => (
                <View key={item.key}>
                  <Button
                    title={`${item.name} · ${item.provider}`}
                    disabled={busy || !item.writable}
                    onPress={() => {
                      void act({ type: 'browse', token: editor.token, key: item.key });
                    }}
                  />
                  {!item.writable && <Text style={styles.notice}>{item.reason}</Text>}
                </View>
              ))}
              {folders && (
                <View>
                  <Text style={styles.label}>{folders.name}</Text>
                  <Button
                    title="Save in this folder"
                    disabled={busy}
                    onPress={() => {
                      change({ ...patch, destinationKey: folders.destinationKey });
                      setChoosing(false);
                    }}
                  />
                  {folders.folders.map((folder) => (
                    <Button
                      key={folder.key}
                      title={`Open ${folder.name}`}
                      disabled={busy}
                      onPress={() => {
                        void act({ type: 'browse', token: editor.token, key: folder.key });
                      }}
                    />
                  ))}
                </View>
              )}
            </View>
          )}
          <Text style={styles.label}>Source title</Text>
          <TextInput
            accessibilityLabel="Source title"
            value={patch.source.title}
            onChangeText={(title) => change({ ...patch, source: { ...patch.source, title } })}
            editable={!busy}
            maxLength={1000}
            style={styles.input}
          />
          <Text style={styles.label}>Source URL</Text>
          <TextInput
            accessibilityLabel="Source URL"
            value={patch.source.url}
            onChangeText={(url) => change({ ...patch, source: { ...patch.source, url } })}
            editable={!busy}
            autoCapitalize="none"
            keyboardType="url"
            maxLength={4096}
            style={styles.input}
          />
          {editor.runs.map((run, index) => (
            <View key={run.key} style={styles.panel}>
              <Text style={styles.label}>
                {run.block}
                {run.marks.length ? ` · ${run.marks.join(', ')}` : ''}
              </Text>
              <TextInput
                accessibilityLabel={`${run.block} text ${index + 1}`}
                multiline
                editable={!busy}
                value={patch.runs[index]?.text ?? ''}
                maxLength={100000}
                style={[styles.input, styles.body]}
                onChangeText={(text) =>
                  change({
                    ...patch,
                    runs: patch.runs.map((value, i) => (i === index ? { ...value, text } : value))
                  })
                }
              />
              {!run.empty && !run.block.startsWith('Code') && (
                <>
                  <Text style={styles.notice}>Furigana for this text run</Text>
                  <TextInput
                    accessibilityLabel={`Furigana ${index + 1}`}
                    value={patch.runs[index]?.ruby ?? ''}
                    onChangeText={(ruby) =>
                      change({
                        ...patch,
                        runs: patch.runs.map((value, i) =>
                          i === index ? { ...value, ruby } : value
                        )
                      })
                    }
                    editable={!busy}
                    maxLength={1000}
                    style={styles.input}
                  />
                </>
              )}
            </View>
          ))}
          <Text style={styles.label}>Append paragraphs</Text>
          <TextInput
            accessibilityLabel="Append paragraphs"
            multiline
            value={patch.append ?? ''}
            onChangeText={(append) => change({ ...patch, append })}
            editable={!busy}
            maxLength={100000}
            style={[styles.input, styles.body]}
          />
          <Button
            title="Discard this draft"
            danger
            disabled={busy}
            onPress={() =>
              setConfirmation({
                title: 'Discard this saved draft? The existing snippet stays unchanged.',
                action: () => {
                  void act({ type: 'discard', token: editor.token, key: editor.key });
                }
              })
            }
          />
        </ScrollView>
      ) : (
        <>
          <View style={styles.row}>
            <Button
              title="New snippet"
              disabled={busy || !state}
              onPress={() => {
                if (state) void act({ type: 'new', token: state.token });
              }}
            />
            <Button
              title={trash ? 'Show snippets' : 'Show trash'}
              disabled={busy}
              onPress={() => {
                setTrash(!trash);
                setPage(0);
              }}
            />
            <Button
              title="Refresh"
              disabled={busy}
              onPress={() => {
                void load();
              }}
            />
          </View>
          <TextInput
            accessibilityLabel="Search snippets including text and furigana"
            placeholder="Search text, titles or furigana"
            value={query}
            maxLength={512}
            onChangeText={(value) => {
              setQuery(value);
              setPage(0);
            }}
            style={styles.input}
          />
          <ScrollView horizontal style={styles.filters} contentContainerStyle={styles.row}>
            <Button
              title="All sources"
              disabled={!source}
              onPress={() => {
                setSource(undefined);
                setPage(0);
              }}
            />
            {state?.sources.map((item) => (
              <Button
                key={item.key}
                title={item.name}
                disabled={source === item.key}
                onPress={() => {
                  setSource(item.key);
                  setPage(0);
                }}
              />
            ))}
          </ScrollView>
          {!state ? (
            <ActivityIndicator accessibilityLabel="Loading snippets" />
          ) : (
            <FlatList
              data={state.items}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View>
                  {state.notices.map((notice) => (
                    <Text key={notice} style={styles.warning}>
                      {notice}
                    </Text>
                  ))}
                  {state.drafts.length > 0 && (
                    <View style={styles.panel}>
                      <Text style={styles.label}>Saved drafts</Text>
                      {state.drafts.map((draft) => (
                        <Button
                          key={draft.key}
                          title={`Resume ${draft.title}`}
                          disabled={busy}
                          onPress={() => rowAction('resume', draft.key)}
                        />
                      ))}
                    </View>
                  )}
                  <Text>
                    {state.total} {trash ? 'trashed snippets' : 'snippets'}
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <Text style={styles.notice}>
                  {query
                    ? 'No matching snippets in the searched content.'
                    : 'No snippets here yet.'}
                </Text>
              }
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <Text accessibilityRole="header" style={styles.title}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={3}>{item.excerpt}</Text>
                  <Text style={styles.notice}>
                    {item.destination}
                    {item.pending ? ' · Sync pending' : ''}
                    {item.conflicts ? ' · Conflict needs review on web' : ''}
                  </Text>
                  {!!item.issue && <Text style={styles.warning}>{item.issue}</Text>}
                  <View style={styles.row}>
                    {!item.trashed && (
                      <>
                        <Button
                          title="Edit"
                          disabled={busy}
                          onPress={() => rowAction('edit', item.key)}
                        />
                        {onRead && (
                          <Button
                            title="Read"
                            disabled={busy}
                            onPress={() => rowAction('read', item.key)}
                          />
                        )}
                      </>
                    )}
                    <Button
                      title="Duplicate"
                      disabled={busy}
                      onPress={() => rowAction('duplicate', item.key)}
                    />
                    <Button
                      title={item.trashed ? 'Restore' : 'Move to trash'}
                      danger={!item.trashed}
                      disabled={busy}
                      onPress={() =>
                        item.trashed
                          ? rowAction('restore', item.key)
                          : setConfirmation({
                              title: `Move “${item.title}” to trash? You can restore it later.`,
                              action: () => rowAction('trash', item.key)
                            })
                      }
                    />
                  </View>
                </View>
              )}
              ListFooterComponent={
                <View style={styles.row}>
                  <Button
                    title="Previous"
                    disabled={!state.page || busy}
                    onPress={() => setPage(state.page - 1)}
                  />
                  <Text>
                    {state.page + 1} / {state.pages}
                  </Text>
                  <Button
                    title="Next"
                    disabled={state.page + 1 >= state.pages || busy}
                    onPress={() => setPage(state.page + 1)}
                  />
                </View>
              }
            />
          )}
        </>
      )}
      <Modal
        visible={!!confirmation}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmation(undefined)}
      >
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text>{confirmation?.title}</Text>
            <View style={styles.row}>
              <Button title="Cancel" onPress={() => setConfirmation(undefined)} />
              <Button
                title="Confirm"
                danger
                onPress={() => {
                  const action = confirmation?.action;
                  setConfirmation(undefined);
                  action?.();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const createStyles = (colors: UiTheme['colors']) =>
  StyleSheet.create({
    root: { flex: 1, padding: 16, backgroundColor: colors.background },
    heading: { fontSize: 27, fontWeight: '700', marginBottom: 12, color: colors.foreground },
    content: { gap: 12, paddingBottom: 32 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    filters: { flexGrow: 0, marginVertical: 8, maxHeight: 56 },
    input: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      backgroundColor: colors.card,
      color: colors.foreground,
      fontSize: 16
    },
    body: { minHeight: 80, textAlignVertical: 'top' },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginVertical: 3
    },
    buttonText: { color: colors.primaryForeground, fontWeight: '600' },
    disabled: { opacity: 0.45 },
    danger: { backgroundColor: colors.destructive },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border
    },
    panel: { gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.secondary },
    title: { fontSize: 19, fontWeight: '700', color: colors.foreground },
    label: { fontWeight: '600', color: colors.foreground, marginTop: 6 },
    notice: { fontSize: 13, color: colors.mutedForeground, lineHeight: 19 },
    warning: {
      backgroundColor: colors.secondary,
      color: colors.foreground,
      padding: 12,
      borderRadius: 8,
      marginBottom: 8
    },
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#0008',
      padding: 24
    },
    dialog: { backgroundColor: colors.card, borderRadius: 14, padding: 24, gap: 20, maxWidth: 520 }
  });
