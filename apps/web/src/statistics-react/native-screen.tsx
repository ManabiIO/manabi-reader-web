/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  const [selectedDay, setSelectedDay] = useState<string>(),
    [highlight, setHighlight] = useState(false);
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
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const next = (await command(
        'statistics.read',
        query as Record<string, unknown>
      )) as NativeStatisticsSnapshot;
      if (current !== generation.current) return;
      setData(next);
      setFrom(next.query.startDate);
      setTo(next.query.endDate);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : 'Statistics could not be loaded.');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [command, query]);
  useEffect(() => {
    setData(undefined);
    setSelectedDay(undefined);
    setFilters(false);
    setQuery({});
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
  function remove(book: NativeStatisticsBook) {
    const owner = `${runtime.session}:${runtime.epoch}`;
    Alert.alert(
      'Delete reading history?',
      `Delete all reading history for “${book.title}” on this device? This includes all dates and any completion records. The book itself will remain. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete history',
          style: 'destructive',
          onPress: () => {
            if (!mounted.current || mutation.current || owner !== latestScope.current) return;
            mutation.current = true;
            setBusy(true);
            void command('statistics.action', {
              type: 'delete-book-history',
              bookId: book.id,
              title: book.title,
              bookKey: book.bookKey
            })
              .then(() => {
                if (owner === latestScope.current) return refresh();
                return undefined;
              })
              .catch((cause) => {
                if (owner === latestScope.current)
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Deletion was not confirmed. Refresh saved history before trying again.'
                  );
              })
              .finally(() => {
                mutation.current = false;
                if (owner === latestScope.current) setBusy(false);
              });
          }
        }
      ]
    );
  }
  const chosen = query.bookIds ?? [],
    detail = data?.days.find((day) => day.date === selectedDay);
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
          <Action label="Filter books" onPress={() => setFilters(!filters)} />
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
              onPress={() => update({ bookIds: [] })}
            />
            {matchedBooks.map((book) => (
              <View key={book.id} style={styles.book}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={book.title}
                  accessibilityState={{ checked: chosen.includes(book.id) }}
                  disabled={busy}
                  onPress={() =>
                    update({
                      bookIds: chosen.includes(book.id)
                        ? chosen.filter((id) => id !== book.id)
                        : [...chosen, book.id]
                    })
                  }
                  style={styles.bookTitle}
                >
                  <Text>
                    {chosen.includes(book.id) ? '☑ ' : '☐ '}
                    {book.title}
                  </Text>
                </Pressable>
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
            {data.notices.map((notice) => (
              <Text key={notice} style={styles.notice}>
                {notice}
              </Text>
            ))}
          </>
        )}
      </ScrollView>
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
