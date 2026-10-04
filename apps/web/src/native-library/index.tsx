/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
  type ViewToken
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Host as ExpoHost, TextInput, useNativeState } from '@expo/ui';
import { Switch } from '../shared-ui/ExpoToggle';
import { router, usePathname } from 'expo-router';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { Action as NativeAction, MenuAction } from '../screens/NativeScreens';
import { UiText as Text } from '../shared-ui/Typography';
import { ActionButton } from '../shared-ui/ActionButton';
import { UiIcon } from '../shared-ui/UiIcon';
import { UiThemeProvider, useUiTheme, createUiTheme, type UiTheme } from '../shared-ui/theme';
import {
  type LibraryAction,
  type LibraryQuery,
  type NativeLibraryBook,
  type NativeLibraryState
} from './contract';
import { reconcileNativeSelection } from './selection';
import {
  librarySortChoices,
  readLibrarySort,
  type LibrarySort
} from '../features/library/sort-options';
import { NativeLibraryContentSearch } from './content-search';
import { NativeBookCover } from './cover';
import { formatCalendarDay } from '../lib/library/reading-state';
import { LibraryBookFace } from '../features/library/LibraryBookFace';
import { bookFaceLayout } from '../features/library/book-face';
import {
  LibraryMetadataFields,
  type LibraryMetadataLayout
} from '../features/library/LibraryMetadataFields';
import { NativeEditorsPicks } from './catalog';
import { NativeContinueShelf } from './continue-shelf';
import {
  NativeLibraryFrame,
  NativeLibraryShelves,
  hasLibrarySidebar,
  LIBRARY_SIDEBAR_WIDTH
} from './shelf-navigation';
import { NativeLibraryCoverController, type NativeCoverState } from './cover-controller';
import type {
  NativeStatisticsSelectionAdmission,
  NativeStatisticsSnapshot
} from '../statistics-react/native-contract';

function Action(props: ComponentProps<typeof NativeAction>) {
  const theme = useUiTheme();
  return <NativeAction {...props} theme={theme} />;
}
function Host(props: ComponentProps<typeof ExpoHost>) {
  const theme = useUiTheme();
  return <ExpoHost {...props} colorScheme={theme.mode} seedColor={theme.seedColor} />;
}
function useLibraryStyles(override?: UiTheme) {
  const provided = useUiTheme();
  const { colors } = override ?? provided;
  return {
    ...baseStyles,
    label: [baseStyles.label, { color: colors.foreground }],
    card: [baseStyles.card, { backgroundColor: 'transparent', borderColor: colors.border }],
    selected: [
      baseStyles.selected,
      { backgroundColor: colors.accent, borderColor: colors.primary }
    ],
    sheet: [baseStyles.sheet, { backgroundColor: colors.background }],
    collection: [baseStyles.collection, { backgroundColor: colors.card }],
    error: [baseStyles.error, { backgroundColor: colors.destructiveBackground }]
  };
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  limit = 1000,
  rows = 3,
  disabled = false,
  placeholder
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  limit?: number;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const styles = useLibraryStyles();
  const native = useNativeState(value);
  useEffect(() => {
    native.value = value;
  }, [native, value]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Host
        matchContents={{ vertical: true }}
        accessibilityLabel={label}
        style={{ width: '100%', minHeight: 48 }}
      >
        <TextInput
          value={native}
          placeholder={placeholder ?? label}
          editable={!disabled}
          maxLength={limit}
          multiline={multiline}
          numberOfLines={multiline ? rows : 1}
          onChangeText={(text) => {
            if (disabled) return;
            native.value = text;
            onChange(text);
          }}
        />
      </Host>
    </View>
  );
}
const metadataLayout: LibraryMetadataLayout = {
  Publication: ({ children }) => <View style={{ gap: 14 }}>{children}</View>,
  Field: ({ label, value, onChange, limit, rows, disabled, placeholder }) => (
    <Field
      label={label}
      value={value}
      onChange={onChange}
      limit={limit}
      multiline={!!rows}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
    />
  )
};

function Sheet({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const styles = useLibraryStyles();
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
export function NativeLibraryScreen() {
  const { snapshot } = useReaderRuntime();
  return <Library key={`${snapshot.session}:${snapshot.epoch}`} />;
}
function Library() {
  const { snapshot, command, importBooks, changeCover, busy: importing } = useReaderRuntime();
  const focused = usePathname() === '/manage';
  const activeRoute = useRef(focused);
  activeRoute.current = focused;
  const [covers, setCovers] = useState<NativeCoverState>({ token: '', images: new Map() });
  const refreshCoverView = useRef<(() => Promise<void>) | undefined>(undefined);
  const coverController = useRef<NativeLibraryCoverController | null>(null);
  if (!coverController.current)
    coverController.current = new NativeLibraryCoverController(command, setCovers, () => {
      if (activeRoute.current) void refreshCoverView.current?.();
    });
  const visibleBooks = useRef<string[]>([]);
  const visibleRecent = useRef<string[]>([]);
  const onRecentViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      visibleRecent.current = viewableItems
        .filter(({ item }) => item.hasCover)
        .map(({ item }) => item.key);
      coverController.current?.viewport([...visibleRecent.current, ...visibleBooks.current]);
    }
  ).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    visibleBooks.current = viewableItems
      .filter(({ item }) => item.kind === 'book' && item.hasCover)
      .map(({ item }) => item.key);
    coverController.current?.viewport([...visibleRecent.current, ...visibleBooks.current]);
  }).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 15,
    minimumViewTime: 80
  }).current;
  const [query, setQuery] = useState<LibraryQuery>({
    query: '',
    collection: 'books',
    offset: 0
  });
  const latestQuery = useRef(query);
  latestQuery.current = query;
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'metadata' | 'passages'>('metadata');
  const [state, setState] = useState<NativeLibraryState>();
  const sort = readLibrarySort(state?.sort);
  const systemMode = useColorScheme();
  const appearance = state?.uiTheme?.appearance ?? 'system';
  const uiTheme = createUiTheme(
    state?.uiTheme?.themeId ?? 'manabi-theme',
    appearance === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : appearance,
    state?.uiTheme?.customThemes
  );
  const styles = useLibraryStyles(uiTheme);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const grid = state?.layout === 'grid';
  const finishedShelf = query.collection === 'finished' && !query.series;
  const timeline = finishedShelf && !grid;
  const { width, fontScale } = useWindowDimensions();
  const wide = hasLibrarySidebar(width, fontScale);
  const [pane, setPane] = useState<{ windowWidth: number; width: number }>();
  const paneWidth =
    pane?.windowWidth === width ? pane.width : width - (wide ? LIBRARY_SIDEBAR_WIDTH : 0);
  const columns = Math.max(1, Math.floor((paneWidth - 28) / (150 * Math.max(1, fontScale))));
  const cardWidth = (paneWidth - 28) / columns - 8;
  const [catalogVisible, setCatalogVisible] = useState(false);
  const [sheet, setSheet] = useState<
    'filters' | 'collections' | 'membership' | 'series' | 'completion' | 'metadata'
  >();
  const activeSheet = useRef(sheet);
  activeSheet.current = sheet;
  const [name, setName] = useState('');
  const [collectionTarget, setCollectionTarget] = useState<string>();
  const [seriesIndex, setSeriesIndex] = useState('');
  const [day, setDay] = useState('');
  const serial = useRef(0);
  const mounted = useRef(true);
  const mutationActive = useRef(false);
  const coverOperation = useRef<AbortController | null>(null);
  const statisticsIntent = useRef(0);
  const statisticsPending = useRef(false);
  const statisticsWriting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    coverController.current?.activate();
    return () => {
      coverController.current?.dispose();
      coverOperation.current?.abort();
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
            [...next.items, ...(next.recentBooks ?? [])]
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
  refreshCoverView.current = () => refresh(latestQuery.current);
  useEffect(() => {
    if (snapshot.session && focused) void refresh();
  }, [refresh, snapshot.session, focused]);
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
    if (!focused) {
      statisticsIntent.current++;
      if (statisticsPending.current) {
        statisticsPending.current = false;
        statisticsWriting.current = false;
        mutationActive.current = false;
        setBusy(false);
      }
      coverOperation.current?.abort();
      setCatalogVisible(false);
      setSheet(undefined);
    }
  }, [focused, searchMode, loading]);
  function view(change: LibraryQuery) {
    setError('');
    setSelected([]);
    setSelecting(false);
    setQuery((previous) => ({
      ...previous,
      ...change,
      ...(change.collection === 'finished' ? { unfinished: false } : {}),
      detail: undefined,
      offset: 0
    }));
  }
  async function openBook(book: NativeLibraryBook) {
    if (!state || loading || mutationActive.current || !activeRoute.current) return;
    if (!book.available || !book.bookId) {
      setError(book.unavailableReason ?? 'This book is unavailable.');
      return;
    }
    const request = serial.current;
    mutationActive.current = true;
    setBusy(true);
    setError('');
    try {
      await command('open', {
        bookId: book.bookId,
        libraryToken: state.token,
        libraryKeys: [book.key]
      });
      if (mounted.current && activeRoute.current && request === serial.current)
        router.push({ pathname: '/b', params: { id: book.bookId } });
    } catch (cause) {
      if (mounted.current && activeRoute.current && request === serial.current) {
        setError(cause instanceof Error ? cause.message : 'This book could not be opened.');
        // Access admissions are single-use even on failure. Reconcile before a user retries.
        await refresh(latestQuery.current);
      }
    } finally {
      mutationActive.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function bookDetails(book: NativeLibraryBook) {
    if (mutationActive.current || loading || !activeRoute.current) return;
    setSelected([]);
    setQuery((previous) => ({ ...previous, detail: book.key }));
    setSheet('metadata');
  }
  async function chooseSort(property: LibrarySort, direction: 'asc' | 'desc' = sort.direction) {
    if (
      !state ||
      mutationActive.current ||
      loading ||
      !activeRoute.current ||
      (property === sort.property && direction === sort.direction)
    )
      return;
    await savePreference({ type: 'sort', property, direction }, true);
  }
  async function chooseFinishedOrder(value: 'asc' | 'desc') {
    if (
      !state ||
      !finishedShelf ||
      mutationActive.current ||
      loading ||
      !activeRoute.current ||
      value === state.finishedOrder
    )
      return;
    await savePreference({ type: 'finished.order', value }, true);
  }
  async function chooseLayout(value: boolean) {
    if (!state || mutationActive.current || loading || !activeRoute.current || value === grid)
      return;
    await savePreference({ type: 'layout', value: value ? 'grid' : 'list' }, false);
  }
  async function savePreference(
    action: Extract<LibraryAction, { type: 'sort' | 'layout' | 'finished.order' }>,
    resetPage: boolean
  ) {
    if (!state) return;
    mutationActive.current = true;
    const request = serial.current;
    setBusy(true);
    setError('');
    try {
      await command('library.action', { token: state.token, ...action });
    } catch (cause) {
      if (mounted.current && activeRoute.current && request === serial.current)
        setError(
          cause instanceof Error ? cause.message : 'The Library preference could not be saved.'
        );
    } finally {
      if (mounted.current && activeRoute.current) {
        if (request === serial.current) {
          if (resetPage) {
            setSelected([]);
            setSelecting(false);
            setQuery((previous) => ({ ...previous, detail: undefined, offset: 0 }));
          } else {
            await refresh(latestQuery.current);
          }
        } else {
          await refresh(latestQuery.current);
        }
      }
      mutationActive.current = false;
      if (mounted.current) setBusy(false);
    }
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
  async function chooseCover() {
    if (!state?.detail?.canChangeCover || mutationActive.current || importing) return;
    const selection = { token: state.token, key: state.detail.key };
    const controller = new AbortController();
    coverOperation.current = controller;
    mutationActive.current = true;
    setBusy(true);
    setError('');
    let reconcile = false;
    try {
      const saved = await changeCover(selection, controller.signal);
      reconcile = saved;
      if (saved && mounted.current) setSheet(undefined);
    } catch (cause) {
      reconcile = true;
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The cover outcome is unknown. Refresh before trying again.'
        );
    } finally {
      coverOperation.current = null;
      mutationActive.current = false;
      if (mounted.current) {
        setBusy(false);
        if (reconcile) void refresh();
      }
    }
  }
  function toggle(key: string) {
    setSelected((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    );
  }
  async function statistics(removeHistory: boolean) {
    const detail = state?.detail;
    if (!state || !detail?.available || !detail.bookId || mutationActive.current || loading) return;
    const intent = ++statisticsIntent.current;
    const viewSerial = serial.current;
    const current = () =>
      mounted.current &&
      activeRoute.current &&
      activeSheet.current === 'metadata' &&
      statisticsIntent.current === intent &&
      serial.current === viewSerial;
    mutationActive.current = true;
    statisticsPending.current = true;
    setBusy(true);
    setError('');
    const finish = () => {
      if (statisticsIntent.current !== intent) return;
      statisticsIntent.current++;
      statisticsPending.current = false;
      statisticsWriting.current = false;
      mutationActive.current = false;
      if (mounted.current) {
        setBusy(false);
        if (activeRoute.current) void refresh();
      }
    };
    try {
      if (!removeHistory) {
        // Navigation needs only an identity-bound hint. Do not read a legacy
        // capped history projection or create mutation authority just to open.
        const admission = (await command('statistics.read', {
          admissionVersion: 1,
          librarySelection: { token: state.token, key: detail.key }
        })) as NativeStatisticsSelectionAdmission;
        if (!current()) {
          finish();
          return;
        }
        if (
          !admission ||
          admission.admissionVersion !== 1 ||
          admission.bookId !== detail.bookId ||
          typeof admission.selectionToken !== 'string' ||
          !/^[A-Za-z0-9-]{1,64}$/.test(admission.selectionToken)
        )
          throw new Error(
            'The book Statistics selection changed. Refresh the Library and try again.'
          );
        setSheet(undefined);
        router.push({ pathname: '/statistics', params: { selection: admission.selectionToken } });
        finish();
        return;
      }
      const proof = (await command('statistics.read', {
        librarySelection: { token: state.token, key: detail.key }
      })) as NativeStatisticsSnapshot;
      if (!current()) {
        finish();
        return;
      }
      const book = proof.books[0];
      if (
        !proof.query.selectionToken ||
        proof.books.length !== 1 ||
        book.id !== detail.bookId ||
        proof.query.bookSelection !== 'selected' ||
        proof.query.bookIds.length !== 1 ||
        proof.query.bookIds[0] !== book.id
      )
        throw new Error(
          'The book Statistics selection changed. Refresh the Library and try again.'
        );
      if (!book.deletable)
        throw new Error(
          'Older history could not be safely assigned to this copy. Open Statistics to review it.'
        );
      let confirmed = false;
      Alert.alert(
        'Delete reading history?',
        `Delete all reading history for “${book.title}” on this device? This includes all dates and any completion records. The book itself will remain. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: finish },
          {
            text: 'Delete history',
            style: 'destructive',
            onPress: () => {
              if (!current() || confirmed) return;
              confirmed = true;
              statisticsWriting.current = true;
              // Only the newly admitted Statistics snapshot authorizes the write.
              void command('statistics.action', {
                type: 'delete-book-history',
                snapshotId: proof.snapshotId,
                bookId: book.id,
                bookKey: book.bookKey,
                title: book.title
              })
                .catch((cause) => {
                  if (current())
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'The deletion was not confirmed. Refresh before trying again.'
                    );
                })
                .finally(finish);
            }
          }
        ],
        {
          cancelable: true,
          onDismiss: () => {
            if (!confirmed) finish();
          }
        }
      );
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : 'Statistics could not be loaded.');
      finish();
    }
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
    const canClose = !busy || (statisticsPending.current && !statisticsWriting.current);
    if (statisticsPending.current && !statisticsWriting.current) {
      statisticsIntent.current++;
      statisticsPending.current = false;
      mutationActive.current = false;
      setBusy(false);
      void refresh({ ...query, detail: undefined });
    }
    if (canClose) {
      setSheet(undefined);
      setCollectionTarget(undefined);
      setQuery((previous) => (previous.detail ? { ...previous, detail: undefined } : previous));
    }
  };
  const searchNative = useNativeState(search);
  useEffect(() => {
    searchNative.value = search;
  }, [search, searchNative]);
  const choices = state?.collections ?? [];
  const selectedSource = state?.sources.find((source) => source.id === query.source);
  const closeCatalog = () => {
    setCatalogVisible(false);
    void refresh();
  };
  function emptyShelfText() {
    if (loading) return 'Loading…';
    if (search) return 'No matching books';
    if (query.collection === 'finished') return 'No finished books yet.';
    if (query.collection === 'want-to-read') return 'No books marked Want to Read yet.';
    if (query.collection && query.collection !== 'books') return 'No books in this collection yet.';
    if (query.series) return 'No books in this series.';
    if (query.source) return 'No books in this source.';
    if (query.unfinished) return 'No unread books in this view.';
    return 'Import an EPUB, HTMLZ, or text file to start reading.';
  }
  const recentBooks =
    !selecting &&
    !loading &&
    !search.trim() &&
    query.collection === 'books' &&
    !query.series &&
    !query.source &&
    !query.unfinished
      ? (state?.recentBooks ?? [])
      : [];
  useEffect(() => {
    if (!recentBooks.length) {
      visibleRecent.current = [];
      coverController.current?.viewport(visibleBooks.current);
    }
  }, [recentBooks.length]);
  const content = (
    <NativeLibraryFrame
      theme={uiTheme}
      onPaneWidth={(paneWidth) =>
        setPane((previous) =>
          previous?.windowWidth === width && previous.width === paneWidth
            ? previous
            : { windowWidth: width, width: paneWidth }
        )
      }
      sidebar={
        wide && (
          <NativeLibraryShelves
            state={state}
            selected={query.collection ?? 'books'}
            disabled={busy || importing || !snapshot.session || !focused}
            onSelect={(collection) => view({ collection, series: '' })}
            onSnippets={() => router.push('/snippets')}
            onManage={() => {
              setName('');
              setCollectionTarget(undefined);
              setSheet('collections');
            }}
          />
        )
      }
      title="Manabi Reader"
      actions={
        <Action
          label={importing ? 'Importing…' : 'Add Books'}
          disabled={importing || busy || !snapshot.session}
          variant="filled"
          onPress={() => {
            void importBooks().then(() => refresh());
          }}
        />
      }
      menuActions={(close) => (
        <View style={{ gap: 4 }}>
          <MenuAction
            label={searchMode === 'metadata' ? 'Search passages' : 'Search titles and authors'}
            onPress={() => {
              close();
              setSearchMode(searchMode === 'metadata' ? 'passages' : 'metadata');
              setSelected([]);
              setSelecting(false);
            }}
          />
          <MenuAction
            label="Editor's Picks"
            disabled={busy || importing || !snapshot.session}
            onPress={() => {
              close();
              setCatalogVisible(true);
            }}
          />
          <MenuAction
            label="Sort and filter"
            onPress={() => {
              close();
              setSheet('filters');
            }}
          />
          <MenuAction
            label="Collections"
            onPress={() => {
              close();
              setName('');
              setCollectionTarget(undefined);
              setSheet('collections');
            }}
          />
          <MenuAction
            label={selecting ? 'Cancel selection' : 'Select'}
            disabled={busy || searchMode === 'passages'}
            onPress={() => {
              close();
              setSelecting(!selecting);
              setSelected([]);
            }}
          />
          <MenuAction
            label="Refresh"
            disabled={busy || loading}
            onPress={() => {
              close();
              void refresh();
            }}
          />
        </View>
      )}
    >
      <View style={styles.controls}>
        {searchMode === 'metadata' && (
          <Host matchContents={{ vertical: true }} style={{ width: '100%', minHeight: 44 }}>
            <TextInput
              value={searchNative}
              placeholder="Search books, authors, or series"
              textStyle={{ color: uiTheme.colors.foreground }}
              cursorColor={uiTheme.colors.foreground}
              onChangeText={(text) => {
                searchNative.value = text;
                setSearch(text);
              }}
              style={{ padding: 10, backgroundColor: uiTheme.colors.muted, borderRadius: 10 }}
            />
          </Host>
        )}
        {!wide && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.row}>
              {[
                { id: 'books', name: 'All Books', count: state?.totalBooks ?? 0 },
                { id: 'finished', name: 'Finished', count: state?.counts.finished ?? 0 },
                ...choices
              ].map((collection) => (
                <View
                  key={collection.id}
                  style={{
                    borderBottomWidth: 2,
                    borderBottomColor:
                      query.collection === collection.id ? uiTheme.colors.primary : 'transparent'
                  }}
                >
                  <Action
                    label={`${collection.name} (${collection.count})`}
                    variant="text"
                    onPress={() => view({ collection: collection.id, series: '' })}
                  />
                </View>
              ))}
            </View>
          </ScrollView>
        )}
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
      {catalogVisible && focused && (
        <Modal visible animationType="slide" onRequestClose={closeCatalog}>
          <NativeEditorsPicks close={closeCatalog} />
        </Modal>
      )}
      {searchMode === 'passages' ? (
        <NativeLibraryContentSearch
          disabled={busy || importing || !!sheet}
          view={{
            collection: query.collection,
            series: query.series,
            source: query.source,
            unfinished: query.unfinished,
            sort: sort.property,
            direction: sort.direction
          }}
        />
      ) : (
        <>
          <FlatList
            key={grid ? `grid-${columns}` : 'list'}
            numColumns={grid ? columns : 1}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={3}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            data={state?.items ?? []}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              recentBooks.length ? (
                <NativeContinueShelf
                  books={recentBooks}
                  paneWidth={paneWidth}
                  fontScale={fontScale}
                  disabled={busy || importing || !focused}
                  images={
                    covers.token === state?.coverToken && !loading ? covers.images : undefined
                  }
                  onOpen={(book) => void openBook(book)}
                  onDetails={bookDetails}
                  onViewableItemsChanged={onRecentViewableItemsChanged}
                  viewabilityConfig={viewabilityConfig}
                />
              ) : undefined
            }
            ListEmptyComponent={<Text>{emptyShelfText()}</Text>}
            renderItem={({ item, index }) => (
              <Fragment>
                {timeline &&
                  item.kind === 'book' &&
                  (index === 0 ||
                    (state?.items[index - 1] as NativeLibraryBook)?.finishedOn !==
                      item.finishedOn) && (
                    <Text
                      accessibilityRole="header"
                      style={{
                        fontSize: 18,
                        fontWeight: '600',
                        marginTop: index ? 24 : 0,
                        marginBottom: 12
                      }}
                    >
                      {item.finishedOn ? formatCalendarDay(item.finishedOn) : 'Date not set'}
                    </Text>
                  )}
                {item.kind === 'series' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open series ${item.title}, ${item.count} books`}
                    style={[styles.card, grid && [styles.grid, { width: cardWidth }]]}
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
                      grid && [styles.grid, { width: cardWidth }],
                      selected.includes(item.key) && styles.selected
                    ]}
                  >
                    <Pressable
                      style={{ flex: 1, minWidth: 0 }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selected.includes(item.key), disabled: busy }}
                      disabled={busy}
                      onLongPress={() => {
                        setSelecting(true);
                        toggle(item.key);
                      }}
                      onPress={() => {
                        if (selecting) toggle(item.key);
                        else void openBook(item);
                      }}
                    >
                      <LibraryBookFace
                        layout={bookFaceLayout}
                        title={item.title}
                        author={item.creators}
                        readingLabel={item.readingLabel}
                        finishedDay={
                          timeline && item.finishedOn
                            ? formatCalendarDay(item.finishedOn)
                            : item.finishedOn
                        }
                        readingNow={
                          item.available && !!item.bookId && item.bookId === snapshot.lastBookId
                        }
                        selected={selected.includes(item.key)}
                        grid={grid}
                        cover={
                          <NativeBookCover
                            gridWidth={cardWidth}
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
                        }
                      />
                      {item.wantToRead && <Text>Want to Read</Text>}
                      {(item.source !== 'On this device' || item.coverBlur) && (
                        <Text>
                          {item.source}
                          {item.coverBlur ? ' · Cover blurred' : ''}
                        </Text>
                      )}
                      {!item.available && <Text>Import required</Text>}
                    </Pressable>
                    <ActionButton
                      variant="ghost"
                      size="icon-lg"
                      shape="circle"
                      accessibilityLabel={`Details: ${item.title}`}
                      style={grid ? { alignSelf: 'flex-end' } : undefined}
                      disabled={busy}
                      onPress={() => bookDetails(item)}
                    >
                      <UiIcon name="more" size={20} />
                    </ActionButton>
                  </View>
                )}
              </Fragment>
            )}
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
              {finishedShelf ? (
                <View style={styles.row}>
                  <Action
                    label="Newest first"
                    variant={state?.finishedOrder !== 'asc' ? 'filled' : 'outlined'}
                    disabled={busy || loading}
                    onPress={() => void chooseFinishedOrder('desc')}
                  />
                  <Action
                    label="Oldest first"
                    variant={state?.finishedOrder === 'asc' ? 'filled' : 'outlined'}
                    disabled={busy || loading}
                    onPress={() => void chooseFinishedOrder('asc')}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.row}>
                    {librarySortChoices.map((choice) => (
                      <Action
                        key={choice.property}
                        label={choice.label}
                        variant={sort.property === choice.property ? 'filled' : 'outlined'}
                        disabled={busy || loading}
                        onPress={() => void chooseSort(choice.property)}
                      />
                    ))}
                  </View>
                  <View style={styles.row}>
                    <Action
                      label="Ascending"
                      variant={sort.direction === 'asc' ? 'filled' : 'outlined'}
                      disabled={busy || loading}
                      onPress={() => void chooseSort(sort.property, 'asc')}
                    />
                    <Action
                      label="Descending"
                      variant={sort.direction === 'desc' ? 'filled' : 'outlined'}
                      disabled={busy || loading}
                      onPress={() => void chooseSort(sort.property, 'desc')}
                    />
                  </View>
                </>
              )}
              <View style={{ gap: 8 }}>
                {query.collection !== 'finished' && (
                  <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
                    <Switch
                      label="Unfinished books only"
                      value={!!query.unfinished}
                      onValueChange={(unfinished) => view({ unfinished })}
                    />
                  </Host>
                )}
                <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
                  <Switch
                    label={finishedShelf ? 'Grid layout (off uses timeline)' : 'Grid layout'}
                    value={grid}
                    disabled={!state || busy || loading}
                    onValueChange={(value) => void chooseLayout(value)}
                  />
                </Host>
              </View>
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
                <Action
                  label={busy && coverOperation.current ? 'Changing cover…' : 'Choose cover image'}
                  disabled={busy || importing || !state.detail.canChangeCover}
                  onPress={() => {
                    void chooseCover();
                  }}
                />
                <Text>
                  {state.detail.canChangeCover
                    ? 'PNG, JPEG, or WebP up to 32 MB. The image is resized before saving.'
                    : 'Re-import this book to choose a cover for a verified copy on this device.'}
                </Text>
                <View style={styles.row}>
                  <Action
                    label="Book Statistics"
                    disabled={busy || loading || !state.detail.available}
                    onPress={() => {
                      void statistics(false);
                    }}
                  />
                  <Action
                    label="Delete reading history"
                    disabled={busy || loading || !state.detail.available}
                    onPress={() => {
                      void statistics(true);
                    }}
                  />
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
    </NativeLibraryFrame>
  );
  return <UiThemeProvider {...state?.uiTheme}>{content}</UiThemeProvider>;
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
  const styles = useLibraryStyles();
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
      <LibraryMetadataFields
        layout={metadataLayout}
        labelPrefix="native-book-metadata"
        disabled={busy}
        value={{
          title,
          authors,
          authorSort,
          language,
          publisher,
          published,
          description,
          subjects
        }}
        onChange={(name, value) =>
          ({
            title: setTitle,
            authors: setAuthors,
            authorSort: setAuthorSort,
            language: setLanguage,
            publisher: setPublisher,
            published: setPublished,
            description: setDescription,
            subjects: setSubjects
          })[name](value)
        }
      />
      <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
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
const baseStyles = StyleSheet.create({
  controls: { paddingHorizontal: 14, gap: 7 },
  field: { gap: 4 },
  label: { fontWeight: '600', color: '#29352c' },
  heading: { fontSize: 23, fontWeight: '700', flex: 1 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  list: { padding: 14, gap: 9 },
  card: {
    paddingVertical: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderColor: '#dce2db'
  },
  grid: {
    margin: 4,
    flexDirection: 'column',
    alignItems: 'stretch',
    borderBottomWidth: 0,
    paddingVertical: 8
  },
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
