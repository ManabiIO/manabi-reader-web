/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Action, Screen } from '../screens/NativeScreens';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import type {
  NativeStatisticsQuery,
  NativeStatisticsSnapshot,
  NativeStatisticsAction,
  NativeStatisticsRow,
  NativeStatisticsBook
} from './native-contract';
const minutes = (seconds: number) => `${Math.round((seconds / 60) * 100) / 100} min`;
const dateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Native Android screen. Database ownership and identity remain inside the
 * bounded trusted DOM bridge; this component receives display projections only. */
export function NativeStatisticsScreen() {
  const { command, snapshot: runtime } = useReaderRuntime();
  const [data, setData] = useState<NativeStatisticsSnapshot>();
  const [query, setQuery] = useState<NativeStatisticsQuery>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [view, setView] = useState<'summary' | 'heatmap'>('summary');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [search, setSearch] = useState(''),
    [filters, setFilters] = useState(false);
  const [filterDraft, setFilterDraft] = useState<number[]>([]);
  const [filterAll, setFilterAll] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string>(),
    [highlight, setHighlight] = useState(false);
  const [editor, setEditor] = useState<{
    book: NativeStatisticsBook;
    entry?: NativeStatisticsRow['entry'];
    snapshotId: string;
    owner: string;
    date: string;
    time: string;
    characters: string;
    resetMinMax: boolean;
  }>();
  const generation = useRef(0),
    mutation = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const latestScope = useRef('');
  latestScope.current = `${runtime.session}:${runtime.epoch}`;
  const latestSnapshot = useRef<string | undefined>(undefined);
  latestSnapshot.current = data?.snapshotId;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const owner = latestScope.current;
    setBusy(true);
    setError('');
    try {
      const next = (await command(
        'statistics.read',
        query as Record<string, unknown>
      )) as NativeStatisticsSnapshot;
      if (!mounted.current || owner !== latestScope.current || current !== generation.current)
        return;
      setData(next);
      setFrom(next.query.startDate);
      setTo(next.query.endDate);
    } catch (cause) {
      if (mounted.current && owner === latestScope.current && current === generation.current)
        setError(cause instanceof Error ? cause.message : 'Statistics could not be loaded.');
    } finally {
      if (mounted.current && owner === latestScope.current && current === generation.current)
        setBusy(false);
    }
  }, [command, query]);
  useEffect(() => {
    setData(undefined);
    setSelectedDay(undefined);
    setEditor(undefined);
    setBusy(false);
    setError('');
    setFilters(false);
    setFilterDraft([]);
    setFilterAll(true);
    setSearch('');
    setQuery((previous) => (Object.keys(previous).length ? {} : previous));
  }, [runtime.session, runtime.epoch]);
  useEffect(() => {
    if (runtime.session) void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, runtime.session, runtime.epoch]);
  function update(next: NativeStatisticsQuery) {
    setQuery((previous) => ({ ...previous, ...next, page: next.page ?? 1 }));
  }
  function template(kind: 'Today' | 'Week' | 'Month' | 'Year') {
    if (!data) return;
    const start = new Date(`${data.today}T12:00:00`),
      end = new Date(start);
    if (kind === 'Week') {
      start.setDate(start.getDate() - ((start.getDay() - data.weekStartsOn + 7) % 7));
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    }
    if (kind === 'Month') {
      start.setDate(1);
      end.setMonth(end.getMonth() + 1, 0);
    }
    if (kind === 'Year') {
      start.setMonth(0, 1);
      end.setMonth(11, 31);
    }
    update({ startDate: dateString(start), endDate: dateString(end) });
  }
  async function mutate(action: NativeStatisticsAction, owner: string) {
    if (
      !mounted.current ||
      mutation.current ||
      owner !== latestScope.current ||
      action.snapshotId !== latestSnapshot.current
    )
      return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await command('statistics.action', action as unknown as Record<string, unknown>);
      if (!mounted.current || owner !== latestScope.current) return;
      setEditor(undefined);
      await refresh();
    } catch (cause) {
      if (mounted.current && owner === latestScope.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The change was not confirmed. Refresh saved history before trying again.'
        );
    } finally {
      mutation.current = false;
      if (mounted.current && owner === latestScope.current) setBusy(false);
    }
  }
  function remove(book: NativeStatisticsBook) {
    if (!data) return;
    const owner = latestScope.current,
      snapshotId = data.snapshotId;
    Alert.alert(
      'Delete reading history?',
      `Delete all reading history for “${book.title}” on this device? This includes all dates and any completion records. The book itself will remain. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete history',
          style: 'destructive',
          onPress: () => {
            void mutate(
              {
                type: 'delete-book-history',
                snapshotId,
                bookId: book.id,
                title: book.title,
                bookKey: book.bookKey
              },
              owner
            );
          }
        }
      ]
    );
  }
  function removeRange(bookIds: number[], startDate: string, endDate: string) {
    if (!data || !bookIds.length) return;
    const owner = latestScope.current,
      snapshotId = data.snapshotId;
    Alert.alert(
      'Delete selected reading history?',
      `Delete history for ${bookIds.length} selected book(s) from ${startDate} through ${endDate}, including completion records on those dates? Other dates remain. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete selected dates',
          style: 'destructive',
          onPress: () => {
            void mutate({ type: 'delete-range', snapshotId, bookIds, startDate, endDate }, owner);
          }
        }
      ]
    );
  }
  function removeDay(row: NativeStatisticsRow) {
    const entry = row.entry;
    if (!data || !entry) return;
    const book = data.books.find((item) => item.id === entry.bookId);
    if (!book) return;
    const owner = latestScope.current,
      snapshotId = data.snapshotId;
    Alert.alert(
      'Delete this reading entry?',
      `${book.title} · ${row.date}\nDelete this individual entry, including its completion record? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete entry',
          style: 'destructive',
          onPress: () => {
            void mutate(
              {
                type: 'delete-day',
                snapshotId,
                bookId: book.id,
                title: book.title,
                bookKey: entry.bookKey,
                date: row.date
              },
              owner
            );
          }
        }
      ]
    );
  }
  function edit(book: NativeStatisticsBook, row?: NativeStatisticsRow) {
    if (!data) return;
    setEditor({
      book,
      entry: row?.entry,
      snapshotId: data.snapshotId,
      owner: latestScope.current,
      date: row?.date ?? data.today,
      time: String(row?.time ?? 0),
      characters: String(row?.characters ?? 0),
      resetMinMax: false
    });
  }
  function saveDay() {
    if (!editor || !/^\d+$/.test(editor.time) || !/^\d+$/.test(editor.characters)) {
      setError('Time and characters must be whole, non-negative numbers.');
      return;
    }
    const time = Number(editor.time),
      characters = Number(editor.characters);
    if (
      !Number.isSafeInteger(time) ||
      time > 86400 ||
      !Number.isSafeInteger(characters) ||
      characters > 100000000
    ) {
      setError('Enter at most 86,400 seconds and 100,000,000 characters for one day.');
      return;
    }
    const value = editor;
    Alert.alert(
      value.entry ? 'Save reading day?' : 'Add reading day?',
      `${value.book.title} · ${value.date}\n${time} seconds · ${characters} characters${value.resetMinMax ? '\nReset minimum/maximum reading speeds' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: () => {
            void mutate(
              {
                type: 'save-day',
                snapshotId: value.snapshotId,
                bookId: value.book.id,
                bookKey: value.entry?.bookKey ?? value.book.bookKey,
                title: value.book.title,
                date: value.date,
                mode: value.entry ? 'edit' : 'create',
                time,
                characters,
                resetMinMax: value.resetMinMax
              },
              value.owner
            );
          }
        }
      ]
    );
  }
  const chosen = query.bookIds ?? [],
    detail = data?.days.find((day) => day.date === selectedDay);
  const rangeBooks =
    data?.books.filter(
      (book) => book.deletable && (data.query.bookSelection === 'all' || chosen.includes(book.id))
    ) ?? [];
  const matchedBooks =
    data?.books.filter((book) =>
      book.title.normalize('NFKC').toLowerCase().includes(search.normalize('NFKC').toLowerCase())
    ) ?? [];
  return (
    <Screen
      title="Statistics"
      actions={
        <Action
          label="Refresh"
          disabled={busy}
          onPress={() => {
            void refresh();
          }}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? (
          <View accessibilityRole="alert" style={styles.notice}>
            <Text>{error}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Action
            label="Summary"
            variant={view === 'summary' ? 'filled' : 'outlined'}
            onPress={() => setView('summary')}
          />
          <Action
            label="Heatmap"
            variant={view === 'heatmap' ? 'filled' : 'outlined'}
            onPress={() => setView('heatmap')}
          />
          <Action
            label="Filter books"
            disabled={busy || !data}
            onPress={() => {
              if (!filters && data) {
                setFilterAll(data.query.bookSelection === 'all');
                setFilterDraft(
                  data.query.bookSelection === 'all'
                    ? data.books.map((book) => book.id)
                    : [...data.query.bookIds]
                );
              }
              setFilters(!filters);
            }}
          />
        </View>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.heading}>
            Date range
          </Text>
          <View style={styles.row}>
            {(['Today', 'Week', 'Month', 'Year'] as const).map((kind) => (
              <Action
                key={kind}
                label={kind}
                disabled={busy || !data}
                onPress={() => template(kind)}
              />
            ))}
          </View>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text>From</Text>
              <TextInput
                accessibilityLabel="From date"
                value={from}
                onChangeText={setFrom}
                placeholder="YYYY-MM-DD"
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text>To</Text>
              <TextInput
                accessibilityLabel="To date"
                value={to}
                onChangeText={setTo}
                placeholder="YYYY-MM-DD"
                style={styles.input}
              />
            </View>
          </View>
          <Action
            label="All time for selected books"
            disabled={busy || !data?.allTime}
            onPress={() => data?.allTime && update(data.allTime)}
          />
          <Action
            label="Delete selected dates and books"
            disabled={busy || !rangeBooks.length || !data?.rows.length}
            onPress={() =>
              data &&
              removeRange(
                rangeBooks.map((book) => book.id),
                data.query.startDate,
                data.query.endDate
              )
            }
          />
          <Action
            label="Apply dates"
            disabled={busy || !from || !to}
            onPress={() =>
              update({ startDate: from < to ? from : to, endDate: from < to ? to : from })
            }
          />
        </View>
        {filters && (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>
              Book selection
            </Text>
            <TextInput
              accessibilityLabel="Search statistics titles"
              placeholder="Search titles"
              value={search}
              onChangeText={setSearch}
              style={styles.input}
            />
            <Action
              label="All available books"
              disabled={busy}
              onPress={() => {
                setFilterAll(true);
                setFilterDraft(data?.books.map((book) => book.id) ?? []);
              }}
            />
            <View style={styles.row}>
              <Action
                label="Clear book selection"
                onPress={() => {
                  setFilterAll(false);
                  setFilterDraft([]);
                }}
              />
              <Action
                label="Select matching books"
                onPress={() => {
                  setFilterAll(false);
                  setFilterDraft([
                    ...new Set([...filterDraft, ...matchedBooks.map((book) => book.id)])
                  ]);
                }}
              />
              <Action
                label="Remove matching books"
                onPress={() => {
                  setFilterAll(false);
                  setFilterDraft(
                    filterDraft.filter((id) => !matchedBooks.some((book) => book.id === id))
                  );
                }}
              />
              <Action label="Cancel book filters" onPress={() => setFilters(false)} />
              <Action
                label="Apply book filters"
                disabled={busy || (!filterAll && filterDraft.length > 200)}
                onPress={() => {
                  update({
                    bookSelection: filterAll ? 'all' : 'selected',
                    bookIds: filterAll ? [] : filterDraft
                  });
                  setFilters(false);
                }}
              />
            </View>
            <Text>
              {filterAll ? 'All available books' : `${filterDraft.length} selected books`}. Choose
              at most 200 individual books. Changes apply when you choose Apply book filters.
            </Text>
            {matchedBooks.map((book) => (
              <View key={book.id} style={styles.book}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={book.title}
                  accessibilityState={{ checked: filterAll || filterDraft.includes(book.id) }}
                  disabled={busy}
                  onPress={() => {
                    setFilterAll(false);
                    setFilterDraft(
                      filterDraft.includes(book.id)
                        ? filterDraft.filter((id) => id !== book.id)
                        : [...filterDraft, book.id]
                    );
                  }}
                  style={styles.bookTitle}
                >
                  <Text>
                    {filterAll || filterDraft.includes(book.id) ? '☑ ' : '☐ '}
                    {book.title}
                  </Text>
                </Pressable>
                <Action
                  label={`Add reading day for ${book.title}`}
                  disabled={busy || !book.deletable}
                  onPress={() => edit(book)}
                />
                <Action
                  label={`Delete ${book.title} history`}
                  disabled={busy || !book.deletable}
                  onPress={() => remove(book)}
                />
              </View>
            ))}
            {!matchedBooks.length && <Text>No matching books</Text>}
          </View>
        )}
        {busy && <ActivityIndicator accessibilityLabel="Loading statistics" />}
        {data && (
          <>
            <View style={styles.card}>
              <Text accessibilityRole="header" style={styles.heading}>
                Reading totals
              </Text>
              <Text>
                {minutes(data.totals.time)} · {data.totals.characters.toLocaleString()} characters
              </Text>
              <Text>
                {data.totals.speed.toLocaleString()} characters/hour · {data.totals.days} reading
                days
              </Text>
            </View>
            {view === 'summary' ? (
              <>
                <View style={styles.row}>
                  {(['title', 'date', 'none'] as const).map((aggregation) => (
                    <Action
                      key={aggregation}
                      label={aggregation === 'none' ? 'Individual days' : `Group by ${aggregation}`}
                      variant={data.query.aggregation === aggregation ? 'filled' : 'outlined'}
                      disabled={busy}
                      onPress={() => update({ aggregation })}
                    />
                  ))}
                </View>
                <View style={styles.row}>
                  {(['title', 'date', 'time', 'characters', 'speed'] as const).map((sort) => (
                    <Action
                      key={sort}
                      label={`Sort by ${sort}`}
                      variant={data.query.sort === sort ? 'filled' : 'outlined'}
                      disabled={busy}
                      onPress={() =>
                        update({
                          sort,
                          direction:
                            data.query.sort === sort && data.query.direction === 'desc'
                              ? 'asc'
                              : 'desc'
                        })
                      }
                    />
                  ))}
                </View>
                {data.rows.map((row) => (
                  <View key={row.id} style={styles.card}>
                    {row.title ? <Text style={styles.heading}>{row.title}</Text> : null}
                    {row.date ? <Text>{row.date}</Text> : null}
                    <Text>
                      {minutes(row.time)} · {row.characters.toLocaleString()} characters
                    </Text>
                    <Text>{row.speed.toLocaleString()} characters/hour</Text>
                    {row.entry && (
                      <View style={styles.row}>
                        <Action
                          label={`Edit ${row.title} on ${row.date}`}
                          disabled={busy}
                          onPress={() => {
                            const book = data.books.find((item) => item.id === row.entry?.bookId);
                            if (book) edit(book, row);
                          }}
                        />
                        <Action
                          label={`Delete ${row.title} on ${row.date}`}
                          disabled={busy}
                          onPress={() => removeDay(row)}
                        />
                      </View>
                    )}
                  </View>
                ))}
                {!data.rows.length && <Text>No data found for the selected dates and books</Text>}
                <View style={styles.row}>
                  <Action
                    label="Previous page"
                    disabled={busy || data.query.page <= 1}
                    onPress={() => update({ page: data.query.page - 1 })}
                  />
                  <Text>
                    Page {data.query.page} / {data.pages}
                  </Text>
                  <Action
                    label="Next page"
                    disabled={busy || data.query.page >= data.pages}
                    onPress={() => update({ page: data.query.page + 1 })}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.row}>
                  <Action
                    label="Previous year"
                    disabled={busy}
                    onPress={() => update({ year: data.query.year - 1 })}
                  />
                  <Text accessibilityRole="header" style={styles.heading}>
                    {data.query.year}
                  </Text>
                  <Action
                    label="Next year"
                    disabled={busy}
                    onPress={() => update({ year: data.query.year + 1 })}
                  />
                  <Action
                    label="Return to current year"
                    disabled={busy}
                    onPress={() => update({ year: Number(data.today.slice(0, 4)) })}
                  />
                </View>
                <Text>
                  {data.daysRead} · Current streak: {data.currentStreak} days
                </Text>
                <Action
                  label={`Highlight longest streak: ${data.longestStreak} days`}
                  onPress={() => setHighlight(!highlight)}
                />
                {Array.from({ length: 12 }, (_, month) => (
                  <View key={month} style={styles.card}>
                    <Text accessibilityRole="header" style={styles.heading}>
                      {new Date(data.query.year, month, 1).toLocaleDateString(undefined, {
                        month: 'long'
                      })}
                    </Text>
                    <View style={styles.calendar}>
                      {data.days
                        .filter((day) => Number(day.date.slice(5, 7)) === month + 1)
                        .map((day) => (
                          <Pressable
                            key={day.date}
                            accessibilityRole="button"
                            accessibilityLabel={day.details.join('. ')}
                            accessibilityState={{ selected: selectedDay === day.date }}
                            onPress={() => setSelectedDay(day.date)}
                            style={[
                              styles.day,
                              { backgroundColor: day.color || '#eef1ea' },
                              highlight &&
                                data.longestStreakDates.includes(day.date) &&
                                styles.highlight,
                              selectedDay === day.date && styles.selected
                            ]}
                          >
                            <Text style={styles.dayNumber}>{Number(day.date.slice(8))}</Text>
                          </Pressable>
                        ))}
                    </View>
                  </View>
                ))}
                {detail && (
                  <View style={styles.card}>
                    <Text accessibilityRole="header" style={styles.heading}>
                      Reading day details
                    </Text>
                    {detail.details.map((line, index) => (
                      <Text key={index}>{line}</Text>
                    ))}
                    <Action
                      label="Close heatmap details"
                      onPress={() => setSelectedDay(undefined)}
                    />
                  </View>
                )}
              </>
            )}
            <View style={styles.notice}>
              <Text accessibilityRole="header" style={styles.heading}>
                Reading goals
              </Text>
              <Text>{data.goals.reason}</Text>
            </View>
            {data.notices.map((notice) => (
              <Text key={notice} style={styles.notice}>
                {notice}
              </Text>
            ))}
          </>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(editor)}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setEditor(undefined);
        }}
      >
        {editor && (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.heading}>
              {editor.entry ? 'Edit reading day' : 'Add reading day'}
            </Text>
            <Text>{editor.book.title}</Text>
            {error ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                {error}
              </Text>
            ) : null}
            <Text>Date</Text>
            <TextInput
              accessibilityLabel="Reading day date"
              value={editor.date}
              editable={!busy && !editor.entry}
              placeholder="YYYY-MM-DD"
              style={styles.input}
              onChangeText={(date) => setEditor({ ...editor, date })}
            />
            <Text>Reading time (seconds)</Text>
            <TextInput
              accessibilityLabel="Reading time in seconds"
              value={editor.time}
              keyboardType="number-pad"
              editable={!busy}
              style={styles.input}
              onChangeText={(time) => setEditor({ ...editor, time })}
            />
            <Text>Characters</Text>
            <TextInput
              accessibilityLabel="Characters read"
              value={editor.characters}
              keyboardType="number-pad"
              editable={!busy}
              style={styles.input}
              onChangeText={(characters) => setEditor({ ...editor, characters })}
            />
            {editor.entry && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Reset minimum and maximum reading speeds"
                accessibilityState={{ checked: editor.resetMinMax }}
                disabled={busy}
                style={styles.bookTitle}
                onPress={() => setEditor({ ...editor, resetMinMax: !editor.resetMinMax })}
              >
                <Text>
                  {editor.resetMinMax ? '☑ ' : '☐ '}Reset minimum and maximum reading speeds
                </Text>
              </Pressable>
            )}
            <Text>
              Existing completion records are preserved. A new day cannot replace existing history.
            </Text>
            <View style={styles.row}>
              <Action label="Cancel edit" disabled={busy} onPress={() => setEditor(undefined)} />
              <Action label="Save reading day" disabled={busy} onPress={saveDay} />
            </View>
          </ScrollView>
        )}
      </Modal>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'white',
    gap: 10,
    borderWidth: 1,
    borderColor: '#e0e4dc'
  },
  heading: { fontSize: 18, fontWeight: '600', color: '#222923' },
  field: { minWidth: 140, flex: 1, gap: 4 },
  input: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#c9d1c6', minHeight: 48 },
  book: { gap: 6, borderBottomWidth: 1, borderBottomColor: '#e0e4dc', paddingVertical: 8 },
  bookTitle: { paddingVertical: 12 },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#b4c3ad'
  },
  dayNumber: {
    color: '#182914',
    fontWeight: '600',
    textShadowColor: '#ffffff',
    textShadowRadius: 2
  },
  highlight: { borderWidth: 3, borderColor: '#a67600' },
  selected: { borderWidth: 3, borderColor: '#1e446f' },
  notice: { padding: 12, borderRadius: 10, backgroundColor: '#fff2d6' }
});
