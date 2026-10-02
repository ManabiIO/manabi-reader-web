/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewToken
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Host, Switch, TextInput, useNativeState } from '@expo/ui';
import { router, usePathname } from 'expo-router';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { Screen, Action } from '../screens/NativeScreens';
import {
  LIBRARY_SORTS,
  type LibraryAction,
  type LibraryQuery,
  type NativeLibraryBook,
  type NativeLibraryState
} from './contract';
import { reconcileNativeSelection } from './view-model';
import { NativeLibraryContentSearch } from './content-search';
import { NativeBookCover } from './cover';
import { NativeLibraryCoverController, type NativeCoverState } from './cover-controller';

function Field({
  label,
  value,
  onChange,
  multiline = false,
  limit = 1000
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  limit?: number;
}) {
  const native = useNativeState(value);
  useEffect(() => {
    native.value = value;
  }, [native, value]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Host matchContents>
        <TextInput
          value={native}
          placeholder={label}
          maxLength={limit}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
          onChangeText={(text) => {
            native.value = text;
            onChange(text);
          }}
        />
      </Host>
    </View>
  );
}
function Sheet({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.row}>
          <Text accessibilityRole="header" style={styles.heading}>
            {title}
          </Text>
          <Action label="Close" onPress={close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
const sortNames: Record<string, string> = {
  lastBookOpen: 'Recent',
  title: 'Title',
  author: 'Author',
  id: 'Added',
  progress: 'Progress',
  characters: 'Characters',
  lastBookModified: 'Last update',
  lastBookmarkModified: 'Bookmarked'
};
export function NativeLibraryScreen() {
  const { snapshot } = useReaderRuntime();
  return <Library key={`${snapshot.session}:${snapshot.epoch}`} />;
}
function Library() {
  const { snapshot, command, importBooks, busy: importing } = useReaderRuntime();
  const focused = usePathname() === '/manage';
  const [covers, setCovers] = useState<NativeCoverState>({ token: '', images: new Map() });
  const coverController = useRef<NativeLibraryCoverController | null>(null);
  if (!coverController.current)
    coverController.current = new NativeLibraryCoverController(command, setCovers);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    coverController.current?.viewport(
      viewableItems
        .filter(({ item }) => item.kind === 'book' && item.hasCover)
        .map(({ item }) => item.key)
    );
  }).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 15,
    minimumViewTime: 80
  }).current;
  const [query, setQuery] = useState<LibraryQuery>({
    query: '',
    collection: 'books',
    offset: 0,
    sort: 'lastBookOpen',
    direction: 'desc'
  });
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'metadata' | 'passages'>('metadata');
  const [state, setState] = useState<NativeLibraryState>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [grid, setGrid] = useState(false);
  const [sheet, setSheet] = useState<
    'filters' | 'collections' | 'membership' | 'series' | 'completion' | 'metadata'
  >();
  const [name, setName] = useState('');
  const [collectionTarget, setCollectionTarget] = useState<string>();
  const [seriesIndex, setSeriesIndex] = useState('');
  const [day, setDay] = useState('');
  const serial = useRef(0);
  const mounted = useRef(true);
  const mutationActive = useRef(false);
  useEffect(() => {
    mounted.current = true;
    coverController.current?.activate();
    return () => {
      coverController.current?.dispose();
      mounted.current = false;
      serial.current++;
    };
  }, []);
  const refresh = useCallback(
    async (view = query) => {
      const request = ++serial.current;
      setLoading(true);
      coverController.current?.setView();
      try {
        const next = (await command(
          'library.state',
          view as Record<string, unknown>
        )) as NativeLibraryState;
        if (mounted.current && request === serial.current) {
          setState(next);
          coverController.current?.setView(
            next.coverToken,
            next.items
              .filter((item) => item.kind === 'book' && item.hasCover)
              .map((item) => item.key)
          );
          setSelected((previous) => reconcileNativeSelection(previous, next.items));
        }
      } catch (cause) {
        if (mounted.current && request === serial.current)
          setError(cause instanceof Error ? cause.message : 'The Library could not be loaded.');
      } finally {
        if (mounted.current && request === serial.current) setLoading(false);
      }
    },
    [command, query]
  );
  useEffect(() => {
    if (snapshot.session) void refresh();
  }, [refresh, snapshot.session]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setQuery((previous) =>
          previous.query === search
            ? previous
            : { ...previous, query: search, offset: 0, detail: undefined }
        ),
      220
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    coverController.current?.setActive(focused && searchMode === 'metadata' && !loading);
  }, [focused, searchMode, loading]);
  function view(change: LibraryQuery) {
    setError('');
    setSelected([]);
    setSelecting(false);
    setQuery((previous) => ({ ...previous, ...change, detail: undefined, offset: 0 }));
  }
  async function mutate(action: LibraryAction) {
    if (!state || mutationActive.current) return;
    mutationActive.current = true;
    const token = state.token;
    setBusy(true);
    setError('');
    try {
      await command('library.action', { token, ...action });
      if (!mounted.current) return;
      setSheet(undefined);
      setSelected([]);
      setSelecting(false);
      setQuery((previous) => ({ ...previous, detail: undefined }));
    } catch (cause) {
      if (mounted.current) {
        setSheet(undefined);
        setError(
          cause instanceof Error
            ? cause.message
            : 'The change could not be saved. Refresh before trying again.'
        );
      }
    } finally {
      mutationActive.current = false;
      if (mounted.current) {
        setBusy(false);
        void refresh({ ...query, detail: undefined });
      }
    }
  }
  function toggle(key: string) {
    setSelected((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    );
  }
  function remove() {
    if (!state || mutationActive.current) return;
    const books = state.items.filter(
      (item): item is NativeLibraryBook => item.kind === 'book' && selected.includes(item.key)
    );
    const libraryToken = state.token;
    const libraryKeys = [...selected];
    const ids = books.flatMap((book) => (book.bookId ? [book.bookId] : []));
    if (ids.length !== books.length || !ids.length) {
      setError('Only imported copies can be removed from this device.');
      return;
    }
    Alert.alert(
      'Remove selected books?',
      'Remove these cached copies from this device? Reading statistics will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (mutationActive.current) return;
            mutationActive.current = true;
            setBusy(true);
            void command('delete', { ids, keepStatistics: true, libraryToken, libraryKeys })
              .then(() => {
                if (mounted.current) {
                  setSelected([]);
                  setSelecting(false);
                  void refresh();
                }
              })
              .catch(() => {})
              .finally(() => {
                mutationActive.current = false;
                if (mounted.current) setBusy(false);
              });
          }
        }
      ]
    );
  }
  const actionKeys = selected.length ? selected : state?.detail ? [state.detail.key] : [];
  const close = () => {
    if (!busy) {
      setSheet(undefined);
      setCollectionTarget(undefined);
      setQuery((previous) => (previous.detail ? { ...previous, detail: undefined } : previous));
    }
  };
  const choices = state?.collections ?? [];
  const selectedSource = state?.sources.find((source) => source.id === query.source);
  return (
    <Screen
      title="Library"
      actions={
        <Action
          label={importing ? 'Importing…' : 'Import Books'}
          disabled={importing || busy || !snapshot.session}
          variant="filled"
          onPress={() => {
            void importBooks().then(() => refresh());
          }}
        />
      }
    >
      <View style={styles.controls}>
        <View style={styles.row}>
          <Action
            label="Titles and authors"
            variant={searchMode === 'metadata' ? 'filled' : 'outlined'}
            onPress={() => setSearchMode('metadata')}
          />
          <Action
            label="Passages"
            variant={searchMode === 'passages' ? 'filled' : 'outlined'}
            onPress={() => {
              setSearchMode('passages');
              setSelected([]);
              setSelecting(false);
            }}
          />
        </View>
        {searchMode === 'metadata' && (
          <Field
            label="Search books, authors, or series"
            value={search}
            onChange={setSearch}
            limit={500}
          />
        )}
        <View style={styles.row}>
          <Action label="Sort and filter" onPress={() => setSheet('filters')} />
          <Action
            label="Collections"
            onPress={() => {
              setName('');
              setCollectionTarget(undefined);
              setSheet('collections');
            }}
          />
          <Action
            label={selecting ? 'Cancel selection' : 'Select'}
            disabled={busy || searchMode === 'passages'}
            onPress={() => {
              setSelecting(!selecting);
              setSelected([]);
            }}
          />
          <Action
            label="Refresh"
            disabled={busy || loading}
            onPress={() => {
              void refresh();
            }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.row}>
            <Action
              label={`All Books (${state?.totalBooks ?? 0})`}
              variant={query.collection === 'books' ? 'filled' : 'outlined'}
              onPress={() => view({ collection: 'books', series: '' })}
            />
            <Action
              label={`Finished (${state?.counts.finished ?? 0})`}
              variant={query.collection === 'finished' ? 'filled' : 'outlined'}
              onPress={() => view({ collection: 'finished', series: '' })}
            />
            {choices.map((collection) => (
              <Action
                key={collection.id}
                label={`${collection.name} (${collection.count})`}
                variant={query.collection === collection.id ? 'filled' : 'outlined'}
                onPress={() => view({ collection: collection.id, series: '' })}
              />
            ))}
          </View>
        </ScrollView>
        {!!state?.trail.length && (
          <ScrollView horizontal>
            <View style={styles.row}>
              <Action label="All series" onPress={() => view({ series: '' })} />
              {state.trail.map((item) => (
                <Action key={item.id} label={item.name} onPress={() => view({ series: item.id })} />
              ))}
            </View>
          </ScrollView>
        )}
        {selectedSource && (
          <Text>
            {selectedSource.name}: {selectedSource.reason}
          </Text>
        )}
        {error ? (
          <View accessibilityRole="alert" style={styles.error}>
            <Text>{error}</Text>
            <Action label="Dismiss" onPress={() => setError('')} />
          </View>
        ) : null}
        {selecting && (
          <View style={styles.selection}>
            <Text>{selected.length} selected on this page</Text>
            <ScrollView horizontal>
              <View style={styles.row}>
                <Action
                  label="Select page"
                  onPress={() =>
                    setSelected(
                      state?.items.filter((item) => item.kind === 'book').map((item) => item.key) ??
                        []
                    )
                  }
                />
                <Action
                  label="Add to collection"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    setName('');
                    setSheet('membership');
                  }}
                />
                <Action
                  label="Want to Read"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    void mutate({
                      type: 'membership',
                      keys: selected,
                      collection: 'want-to-read',
                      included: true
                    });
                  }}
                />
                <Action
                  label="Remove from Want to Read"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    void mutate({
                      type: 'membership',
                      keys: selected,
                      collection: 'want-to-read',
                      included: false
                    });
                  }}
                />
                <Action
                  label="Reading status"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    setDay('');
                    setSheet('completion');
                  }}
                />
                <Action
                  label="Set series"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    setName('');
                    setSeriesIndex('');
                    setSheet('series');
                  }}
                />
                <Action
                  label="Blur covers"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    void mutate({
                      type: 'presentation',
                      keys: selected,
                      change: { coverBlur: true }
                    });
                  }}
                />
                <Action
                  label="Reveal covers"
                  disabled={!selected.length || busy}
                  onPress={() => {
                    void mutate({
                      type: 'presentation',
                      keys: selected,
                      change: { coverBlur: false }
                    });
                  }}
                />
                <Action
                  label="Remove copies"
                  disabled={!selected.length || busy}
                  onPress={remove}
                />
              </View>
            </ScrollView>
          </View>
        )}
        {(loading || busy) && (
          <ActivityIndicator
            accessibilityLabel={busy ? 'Saving Library changes' : 'Loading Library'}
          />
        )}
      </View>
      {searchMode === 'passages' ? (
        <NativeLibraryContentSearch
          disabled={busy || importing || !!sheet}
          view={{
            collection: query.collection,
            series: query.series,
            source: query.source,
            unfinished: query.unfinished,
            sort: query.sort,
            direction: query.direction
          }}
        />
      ) : (
        <>
          <FlatList
            key={grid ? 'grid' : 'list'}
            numColumns={grid ? 2 : 1}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={3}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            data={state?.items ?? []}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text>
                {loading
                  ? 'Loading…'
                  : search
                    ? 'No matching books'
                    : 'Import an EPUB, HTMLZ, or text file to start reading.'}
              </Text>
            }
            renderItem={({ item }) =>
              item.kind === 'series' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open series ${item.title}, ${item.count} books`}
                  style={[styles.card, grid && styles.grid]}
                  onPress={() => view({ series: item.key })}
                >
                  <Text style={styles.title}>{item.title}</Text>
                  <Text>
                    {item.count} books · {item.personal ? 'Personal series' : 'Source folder'}
                  </Text>
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.card,
                    grid && styles.grid,
                    selected.includes(item.key) && styles.selected
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: selected.includes(item.key), disabled: busy }}
                    disabled={busy}
                    onLongPress={() => {
                      setSelecting(true);
                      toggle(item.key);
                    }}
                    onPress={() => {
                      if (selecting) toggle(item.key);
                      else if (item.available && item.bookId)
                        void command('open', {
                          bookId: item.bookId,
                          libraryToken: state?.token,
                          libraryKeys: [item.key]
                        })
                          .then(() => router.push({ pathname: '/b', params: { id: item.bookId! } }))
                          .catch(() => {});
                      else setError(item.unavailableReason ?? 'This book is unavailable.');
                    }}
                  >
                    <View style={grid ? styles.gridBook : styles.listBook}>
                      <NativeBookCover
                        image={
                          covers.token === state?.coverToken && !loading
                            ? covers.images.get(item.key)
                            : undefined
                        }
                        title={item.title}
                        creators={item.creators}
                        blurred={item.coverBlur}
                        grid={grid}
                      />
                      <View style={styles.bookText}>
                        <Text style={styles.title}>{item.title}</Text>
                        {!!item.creators && <Text>{item.creators}</Text>}
                        <Text>
                          {item.finished
                            ? `Finished${item.finishedOn ? ` · ${item.finishedOn}` : ''}`
                            : `${Math.round(item.progress * 100)}% read`}
                          {item.wantToRead ? ' · Want to Read' : ''}
                        </Text>
                        <Text>
                          {item.source}
                          {item.coverBlur ? ' · Cover blurred' : ''}
                        </Text>
                        {!item.available && <Text>Import required</Text>}
                      </View>
                    </View>
                  </Pressable>
                  <Action
                    label={`Details: ${item.title.slice(0, 40)}`}
                    disabled={busy}
                    onPress={() => {
                      setSelected([]);
                      setQuery((previous) => ({ ...previous, detail: item.key }));
                      setSheet('metadata');
                    }}
                  />
                </View>
              )
            }
          />
          <View style={styles.pagination}>
            <Action
              label="Previous"
              disabled={!state?.offset || loading || busy}
              onPress={() => {
                setSelected([]);
                setQuery((previous) => ({
                  ...previous,
                  offset: Math.max(0, (state?.offset ?? 0) - (state?.limit ?? 60)),
                  detail: undefined
                }));
              }}
            />
            <Text>
              {state
                ? `${state.total ? state.offset + 1 : 0}–${Math.min(state.offset + state.items.length, state.total)} of ${state.total}`
                : '0 books'}
            </Text>
            <Action
              label="Next"
              disabled={
                !state || state.offset + state.items.length >= state.total || loading || busy
              }
              onPress={() => {
                setSelected([]);
                setQuery((previous) => ({
                  ...previous,
                  offset: (state?.offset ?? 0) + (state?.limit ?? 60),
                  detail: undefined
                }));
              }}
            />
          </View>
        </>
      )}
      {sheet && (
        <Sheet
          title={
            {
              filters: 'Sort and filter',
              collections: 'Manage collections',
              membership: 'Selected collections',
              series: 'Personal series',
              completion: 'Reading status',
              metadata: 'Book details'
            }[sheet]
          }
          close={close}
        >
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {sheet === 'filters' && (
            <>
              <View style={styles.row}>
                {LIBRARY_SORTS.map((sort) => (
                  <Action
                    key={sort}
                    label={sortNames[sort]}
                    variant={query.sort === sort ? 'filled' : 'outlined'}
                    onPress={() => view({ sort })}
                  />
                ))}
              </View>
              <View style={styles.row}>
                <Action
                  label="Ascending"
                  variant={query.direction === 'asc' ? 'filled' : 'outlined'}
                  onPress={() => view({ direction: 'asc' })}
                />
                <Action
                  label="Descending"
                  variant={query.direction === 'desc' ? 'filled' : 'outlined'}
                  onPress={() => view({ direction: 'desc' })}
                />
              </View>
              <Host matchContents>
                <Switch
                  label="Unfinished books only"
                  value={!!query.unfinished}
                  onValueChange={(unfinished) => view({ unfinished })}
                />
                <Switch label="Grid layout" value={grid} onValueChange={setGrid} />
              </Host>
              <Text style={styles.title}>Sources</Text>
              <Action label="All sources" onPress={() => view({ source: '' })} />
              {state?.sources.map((source) => (
                <View key={source.id}>
                  <Action
                    label={source.name}
                    variant={query.source === source.id ? 'filled' : 'outlined'}
                    onPress={() => view({ source: source.id })}
                  />
                  <Text>{source.reason}</Text>
                </View>
              ))}
            </>
          )}
          {(sheet === 'collections' || sheet === 'membership') && (
            <>
              <Field
                label={collectionTarget ? 'Collection name' : 'New collection name'}
                value={name}
                onChange={setName}
                limit={240}
              />
              <Action
                label={collectionTarget ? 'Save collection name' : 'Create collection'}
                disabled={busy || !name.trim()}
                onPress={() => {
                  void mutate(
                    collectionTarget
                      ? { type: 'collection.rename', collection: collectionTarget, name }
                      : {
                          type: 'collection.create',
                          name,
                          keys: sheet === 'membership' ? actionKeys : []
                        }
                  );
                }}
              />
              {choices.map((collection) => (
                <View key={collection.id} style={styles.collection}>
                  <Text style={styles.title}>
                    {collection.name} ({collection.count})
                  </Text>
                  <View style={styles.row}>
                    {sheet === 'membership' ? (
                      <>
                        <Action
                          label="Include selection"
                          disabled={busy || !actionKeys.length}
                          onPress={() => {
                            void mutate({
                              type: 'membership',
                              keys: actionKeys,
                              collection: collection.id,
                              included: true
                            });
                          }}
                        />
                        <Action
                          label="Remove selection"
                          disabled={busy || !actionKeys.length}
                          onPress={() => {
                            void mutate({
                              type: 'membership',
                              keys: actionKeys,
                              collection: collection.id,
                              included: false
                            });
                          }}
                        />
                      </>
                    ) : !collection.builtIn ? (
                      <>
                        <Action
                          label="Rename"
                          onPress={() => {
                            setCollectionTarget(collection.id);
                            setName(collection.name);
                          }}
                        />
                        <Action
                          label="Delete collection"
                          disabled={busy}
                          onPress={() =>
                            Alert.alert(
                              `Delete ${collection.name}?`,
                              'The books and reading history will be kept.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: () => {
                                    if (query.collection === collection.id)
                                      view({ collection: 'books' });
                                    void mutate({
                                      type: 'collection.remove',
                                      collection: collection.id
                                    });
                                  }
                                }
                              ]
                            )
                          }
                        />
                      </>
                    ) : (
                      <Text>Built-in collection</Text>
                    )}
                  </View>
                </View>
              ))}
            </>
          )}
          {sheet === 'series' && (
            <>
              <Field
                label="Series name (blank removes series)"
                value={name}
                onChange={setName}
                limit={240}
              />
              {actionKeys.length === 1 && (
                <Field
                  label="Volume number (optional)"
                  value={seriesIndex}
                  onChange={setSeriesIndex}
                  limit={24}
                />
              )}
              <Text>Personal series organize your library without moving original files.</Text>
              <Action
                label="Save series"
                disabled={busy || !actionKeys.length}
                onPress={() => {
                  void mutate({
                    type: 'presentation',
                    keys: actionKeys,
                    preserveSeriesIndex: actionKeys.length > 1,
                    change: {
                      series: name.trim()
                        ? {
                            name: name.replace(/\s+/gu, ' ').trim().normalize('NFC'),
                            ...(seriesIndex.trim() ? { index: Number(seriesIndex) } : {})
                          }
                        : null
                    }
                  });
                }}
              />
            </>
          )}
          {sheet === 'completion' && (
            <>
              <Field
                label="Finished date YYYY-MM-DD (blank uses today)"
                value={day}
                onChange={setDay}
                limit={10}
              />
              <Action
                label="Mark finished"
                disabled={busy || !actionKeys.length}
                onPress={() => {
                  void mutate({
                    type: 'completion',
                    keys: actionKeys,
                    state: 'finished',
                    ...(day ? { day } : {})
                  });
                }}
              />
              <Action
                label="Mark reading"
                disabled={busy || !actionKeys.length}
                onPress={() => {
                  void mutate({ type: 'completion', keys: actionKeys, state: 'reading' });
                }}
              />
              <Text>Changing status keeps your reader position and statistics.</Text>
            </>
          )}
          {sheet === 'metadata' &&
            (state?.detail && state.detail.key === query.detail ? (
              <>
                <MetadataEditor
                  key={`${state.token}:${state.detail.key}`}
                  book={state.detail}
                  busy={busy}
                  save={(change) => {
                    void mutate({ type: 'presentation', keys: [state.detail!.key], change });
                  }}
                />
                <View style={styles.row}>
                  <Action
                    label="Collections"
                    onPress={() => {
                      setName('');
                      setSheet('membership');
                    }}
                  />
                  <Action
                    label="Reading status"
                    onPress={() => {
                      setDay(state.detail?.finishedOn ?? '');
                      setSheet('completion');
                    }}
                  />
                  <Action
                    label="Series"
                    onPress={() => {
                      setName(state.detail?.series?.name ?? '');
                      setSeriesIndex(
                        state.detail?.series?.index === undefined
                          ? ''
                          : String(state.detail.series.index)
                      );
                      setSheet('series');
                    }}
                  />
                  <Action
                    label={state.detail.wantToRead ? 'Remove from Want to Read' : 'Want to Read'}
                    disabled={busy}
                    onPress={() => {
                      void mutate({
                        type: 'membership',
                        keys: [state.detail!.key],
                        collection: 'want-to-read',
                        included: !state.detail!.wantToRead
                      });
                    }}
                  />
                </View>
              </>
            ) : (
              <ActivityIndicator accessibilityLabel="Loading book metadata" />
            ))}
        </Sheet>
      )}
    </Screen>
  );
}
function MetadataEditor({
  book,
  busy,
  save
}: {
  book: NonNullable<NativeLibraryState['detail']>;
  busy: boolean;
  save(change: Extract<LibraryAction, { type: 'presentation' }>['change']): void;
}) {
  const [title, setTitle] = useState(book.title);
  const [authors, setAuthors] = useState(
    (book.metadata.creators ?? []).map((author) => author.name).join('\n')
  );
  const [authorSort, setAuthorSort] = useState(
    (book.metadata.creators ?? []).map((author) => author.sortAs ?? '').join('\n')
  );
  const [language, setLanguage] = useState(book.metadata.language ?? '');
  const [publisher, setPublisher] = useState(book.metadata.publisher ?? '');
  const [published, setPublished] = useState(book.metadata.published ?? '');
  const [description, setDescription] = useState(book.metadata.description ?? '');
  const [subjects, setSubjects] = useState((book.metadata.subjects ?? []).join('\n'));
  const [blur, setBlur] = useState(book.coverBlur);
  const [direction, setDirection] = useState(book.direction as 'ltr' | 'rtl' | 'unknown');
  function submit() {
    const sorts = authorSort.split(/\r?\n/);
    save({
      title,
      metadata: {
        creators: authors.split(/\r?\n/).flatMap((raw, index) =>
          raw.trim()
            ? [
                {
                  name: raw.replace(/\s+/gu, ' ').trim(),
                  ...(sorts[index]?.trim()
                    ? { sortAs: sorts[index].replace(/\s+/gu, ' ').trim() }
                    : {})
                }
              ]
            : []
        ),
        language: language.trim(),
        publisher: publisher.trim(),
        published: published.trim(),
        description,
        subjects: subjects
          .split(/\r?\n/)
          .map((subject) => subject.trim())
          .filter(Boolean)
      },
      coverBlur: blur,
      direction
    });
  }
  return (
    <>
      <Field label="Title" value={title} onChange={setTitle} />
      <Field
        label="Authors (one per line)"
        value={authors}
        onChange={setAuthors}
        multiline
        limit={16384}
      />
      <Field
        label="Author sort names (matching lines)"
        value={authorSort}
        onChange={setAuthorSort}
        multiline
        limit={16384}
      />
      <Field label="Language" value={language} onChange={setLanguage} limit={128} />
      <Field label="Publisher" value={publisher} onChange={setPublisher} limit={512} />
      <Field label="Published" value={published} onChange={setPublished} limit={128} />
      <Field
        label="Description"
        value={description}
        onChange={setDescription}
        multiline
        limit={16000}
      />
      <Field
        label="Subjects (one per line)"
        value={subjects}
        onChange={setSubjects}
        multiline
        limit={15360}
      />
      <Host matchContents>
        <Switch label="Blur cover" value={blur} onValueChange={setBlur} />
      </Host>
      <Text style={styles.label}>Page direction</Text>
      <View style={styles.row}>
        {(['unknown', 'ltr', 'rtl'] as const).map((value) => (
          <Action
            key={value}
            label={{ unknown: 'Automatic', ltr: 'Left to right', rtl: 'Right to left' }[value]}
            variant={direction === value ? 'filled' : 'outlined'}
            onPress={() => setDirection(value)}
          />
        ))}
      </View>
      <Action label="Save metadata" variant="filled" disabled={busy} onPress={submit} />
    </>
  );
}
const styles = StyleSheet.create({
  controls: { paddingHorizontal: 14, gap: 7 },
  field: { gap: 4 },
  label: { fontWeight: '600', color: '#29352c' },
  heading: { fontSize: 23, fontWeight: '700', flex: 1 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  list: { padding: 14, gap: 9 },
  card: {
    padding: 14,
    gap: 5,
    borderRadius: 14,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#dce2db'
  },
  grid: { flex: 1, margin: 4 },
  listBook: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  gridBook: { gap: 5 },
  bookText: { flexShrink: 1, minWidth: 0 },
  selected: { borderColor: '#387147', borderWidth: 2, backgroundColor: '#eef5ea' },
  selection: { paddingVertical: 7, gap: 6 },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12
  },
  sheet: { flex: 1, paddingHorizontal: 18, backgroundColor: '#faf9f6' },
  sheetContent: { gap: 14, paddingVertical: 18 },
  collection: { padding: 12, backgroundColor: 'white', gap: 8, borderRadius: 12 },
  error: { padding: 10, borderRadius: 10, backgroundColor: '#ffe6df' }
});
