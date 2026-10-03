/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type {
  StatisticsIntent,
  StatisticsMutation,
  StatisticsPort,
  StatisticsQuery,
  StatisticsRangeTemplate,
  StatisticsState
} from './contract';
import { acquireStatisticsActionLease, releaseStatisticsActionLease } from './action-lease';
import { heatmapNavigationDate } from '../../lib/components/statistics/statistics-heatmap/heatmap-navigation';

const dateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && dateString(new Date(`${value}T12:00:00`)) === value;

export function statisticsDateTemplate(
  value: StatisticsRangeTemplate,
  today: string,
  weekStartsOn: number
) {
  const start = new Date(`${today}T12:00:00`),
    end = new Date(start);
  if (value === 'This Week') {
    start.setDate(start.getDate() - ((start.getDay() - weekStartsOn + 7) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else if (value === 'This Month') {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (value === 'This Year') {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  }
  return { startDate: dateString(start), endDate: dateString(end) };
}

/** One route interaction state machine. DOM ownership and bridge authority stay in ports. */
export function createStatisticsController(port: StatisticsPort) {
  const today = dateString(new Date());
  let state: StatisticsState = {
    query: {
      startDate: today,
      endDate: today,
      year: Number(today.slice(0, 4)),
      goalYear: Number(today.slice(0, 4)),
      weekStartsOn: 0,
      rangeTemplate: 'Today',
      confirmDeletion: true,
      aggregation: 'title',
      sort: 'time',
      direction: 'desc',
      timeSource: 'readingTime',
      charactersSource: 'charactersRead',
      speedSource: 'lastReadingSpeed',
      page: 1,
      pageSize: 25,
      prefilteredBookKeys: [],
      heatmapAggregation: 'year',
      goalHeatmapAggregation: 'year',
      ...port.initialQuery()
    },
    busy: false,
    error: '',
    settingsOpen: false,
    titleFilterOpen: false,
    titleSearch: '',
    titleDraft: [],
    filterPreferences: port.initialFilterPreferences ?? { dateOnly: false, selectedOnly: false },
    view: port.initialView ?? 'overview',
    highlightStreak: false,
    capabilities: port.capabilities
  };
  const listeners = new Set<() => void>();
  let mounted = false,
    generation = 0,
    abort = new AbortController(),
    unsubscribe = () => {};
  let actionLease: symbol | undefined;
  let pendingAction: StatisticsMutation | undefined;
  const publish = (patch: Partial<StatisticsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const current = (version: number, owner: string) =>
    mounted && generation === version && port.ownerKey === owner && !abort.signal.aborted;
  function releaseAction() {
    if (!actionLease) return;
    port.setProgress?.(false, actionLease);
    releaseStatisticsActionLease(actionLease);
    actionLease = undefined;
  }
  function acquireAction() {
    if (!mounted || state.busy) return false;
    actionLease = acquireStatisticsActionLease();
    if (!actionLease) return false;
    port.setProgress?.(true, actionLease);
    return true;
  }
  function invalidate() {
    generation++;
    abort.abort();
    pendingAction = undefined;
    releaseAction();
    publish({
      data: undefined,
      busy: false,
      editor: undefined,
      confirmation: undefined,
      selectedDay: undefined,
      highlight: undefined,
      goalHighlight: undefined,
      highlightStreak: false,
      titleDraft: [],
      titleFilterOpen: false,
      error: 'Statistics access changed. Return to Library and reopen Statistics.'
    });
  }
  async function refresh(patch?: Partial<StatisticsQuery>) {
    if (!mounted) return;
    const query = { ...state.query, ...patch };
    const selections = (value: StatisticsQuery) =>
      JSON.stringify([
        value.selectedTitles === undefined ? null : [...value.selectedTitles].sort(),
        [...value.prefilteredBookKeys].sort(),
        value.selectionToken ?? ''
      ]);
    const selectionChanged = selections(query) !== selections(state.query);
    const resetReadingHighlight =
      selectionChanged ||
      query.heatmapAggregation !== state.query.heatmapAggregation ||
      (query.year !== state.query.year && query.heatmapAggregation === 'year');
    const resetGoalHighlight =
      selectionChanged ||
      query.goalHeatmapAggregation !== state.query.goalHeatmapAggregation ||
      (query.goalYear !== state.query.goalYear && query.goalHeatmapAggregation === 'year');
    if (
      !validDate(query.startDate) ||
      !validDate(query.endDate) ||
      query.startDate > query.endDate
    ) {
      publish({ error: 'Choose valid start and end dates.' });
      return;
    }
    if (
      !Number.isInteger(query.weekStartsOn) ||
      query.weekStartsOn < 0 ||
      query.weekStartsOn > 6 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 250
    ) {
      publish({ error: 'Choose a valid calendar and page size.' });
      return;
    }
    abort.abort();
    abort = new AbortController();
    const version = ++generation,
      owner = port.ownerKey,
      signal = abort.signal;
    pendingAction = undefined;
    publish({
      query,
      ...(resetReadingHighlight ? { highlight: undefined, highlightStreak: false } : {}),
      ...(resetGoalHighlight ? { goalHighlight: undefined } : {}),
      data: undefined,
      busy: true,
      error: '',
      editor: undefined,
      confirmation: undefined,
      selectedDay: undefined
    });
    try {
      // An accepted user preference is durable immediately, as in the original
      // controls; an asynchronous history read must not delay or drop it.
      // Initial bootstrap still waits for the owner to resolve saved preferences.
      if (patch) port.persistQuery?.(query);
      const data = await port.load(query, signal);
      if (!current(version, owner)) return;
      if (query.selectionToken && query.selectionToken !== data.query.selectionToken)
        throw new Error('The Library selection changed. Reopen Statistics from Library.');
      port.persistQuery?.(data.query);
      publish({ data, query: data.query, busy: false });
    } catch (error) {
      if (current(version, owner))
        publish({ data: undefined, busy: false, error: errorMessage(error) });
    }
  }
  async function run(
    work: (signal: AbortSignal) => Promise<void>,
    reload = false,
    alreadyLeased = false
  ) {
    if (!alreadyLeased && !acquireAction()) return;
    const version = generation,
      owner = port.ownerKey,
      lease = actionLease;
    publish({ busy: true, error: '', confirmation: undefined });
    try {
      await work(abort.signal);
      if (!current(version, owner)) return;
      if (reload) {
        publish({ highlight: undefined, goalHighlight: undefined, highlightStreak: false });
        await refresh();
      }
    } catch (error) {
      if (current(version, owner)) publish({ error: errorMessage(error) });
    } finally {
      if (actionLease === lease) {
        releaseAction();
        if (mounted && owner === port.ownerKey && !abort.signal.aborted) publish({ busy: false });
      }
    }
  }
  function requestMutation(
    action: StatisticsMutation,
    title: string,
    message: string,
    confirmLabel: string,
    confirm = true
  ) {
    if (!acquireAction()) return;
    if (!confirm) {
      void run((signal) => port.mutate(action, signal), true, true);
      return;
    }
    pendingAction = action;
    publish({ busy: false, confirmation: { title, message, confirmLabel } });
  }
  const unavailable = (capability: keyof StatisticsPort['capabilities']) => {
    const value = port.capabilities[capability];
    if (value.available) return false;
    publish({ error: value.reason });
    return true;
  };
  async function dispatch(intent: StatisticsIntent): Promise<void> {
    if (!mounted) return;
    const data = state.data;
    if (state.confirmation && intent.type !== 'confirm' && intent.type !== 'clear-error') return;
    switch (intent.type) {
      case 'query': {
        // A newer read may supersede a pending read. A mutation/confirmation
        // lease remains exclusive and cannot be superseded by field changes.
        if (actionLease) return;
        const patch = { ...intent.patch, page: intent.patch.page ?? 1 };
        if ('startDate' in patch || 'endDate' in patch) {
          patch.rangeTemplate = 'Custom';
          if (patch.startDate === '') patch.startDate = data?.today ?? today;
          if (patch.endDate === '') patch.endDate = data?.today ?? today;
          const start = patch.startDate ?? state.query.startDate,
            end = patch.endDate ?? state.query.endDate;
          if (validDate(start) && validDate(end) && start > end) {
            patch.startDate = end;
            patch.endDate = start;
          }
        }
        const aggregation = patch.aggregation ?? state.query.aggregation,
          sort = patch.sort ?? state.query.sort;
        if (
          (aggregation === 'title' && sort === 'date') ||
          (aggregation === 'date' && sort === 'title')
        )
          patch.sort = 'time';
        if (patch.aggregation === 'none') patch.timeSource = 'readingTime';
        if ('weekStartsOn' in patch && state.query.rangeTemplate !== 'Custom')
          Object.assign(
            patch,
            statisticsDateTemplate(
              state.query.rangeTemplate,
              data?.today ?? today,
              patch.weekStartsOn!
            )
          );
        await refresh(patch);
        return;
      }
      case 'template':
        if (!actionLease)
          await refresh({
            ...(intent.value === 'Custom'
              ? {}
              : statisticsDateTemplate(
                  intent.value,
                  data?.today ?? today,
                  state.query.weekStartsOn
                )),
            rangeTemplate: intent.value,
            page: 1
          });
        return;
      case 'view':
        publish({ view: intent.value });
        port.persistView?.(intent.value);
        return;
      case 'settings':
        publish({ settingsOpen: intent.open });
        return;
      case 'title-filter':
        if (!state.busy)
          publish({
            titleFilterOpen: intent.open,
            titleSearch: '',
            titleDraft: intent.open
              ? (data?.titles.filter((item) => item.selected).map((item) => item.title) ?? [])
              : state.titleDraft
          });
        return;
      case 'title-search':
        publish({ titleSearch: intent.value });
        return;
      case 'filter-preferences': {
        const filterPreferences = { ...state.filterPreferences, ...intent.patch };
        publish({ filterPreferences });
        port.persistFilterPreferences?.(filterPreferences);
        return;
      }
      case 'title-toggle':
        publish({
          titleDraft: state.titleDraft.includes(intent.title)
            ? state.titleDraft.filter((title) => title !== intent.title)
            : [...state.titleDraft, intent.title]
        });
        return;
      case 'title-all': {
        const titles = intent.titles ?? data?.titles.map((item) => item.title) ?? [];
        publish({
          titleDraft: intent.selected
            ? [...new Set([...state.titleDraft, ...titles])]
            : state.titleDraft.filter((title) => !titles.includes(title))
        });
        return;
      }
      case 'title-apply':
        if (!state.busy) {
          publish({ titleFilterOpen: false });
          await refresh({ selectedTitles: [...state.titleDraft], page: 1 });
        }
        return;
      case 'clear-prefilter':
        if (!state.busy) {
          await refresh({
            selectedTitles: undefined,
            prefilteredBookKeys: [],
            prefilteredTitles: [],
            page: 1
          });
          if (state.titleFilterOpen && state.data)
            publish({
              titleDraft: state.data.titles
                .filter((item) => item.selected)
                .map((item) => item.title)
            });
        }
        return;
      case 'edit': {
        const row = data?.rows.find((row) => row.id === intent.row.id);
        if (!state.busy && row?.entry)
          publish({
            editor: {
              row,
              date: row.entry.date,
              time: String(row.time),
              characters: String(row.characters),
              resetMinMax: false,
              mode: 'edit'
            },
            error: ''
          });
        return;
      }
      case 'create-day': {
        if (state.busy || unavailable('createDay') || !data) return;
        const entry = {
          bookId: intent.book.id,
          bookKey: intent.book.bookKey,
          title: intent.book.title,
          date: data.today
        };
        publish({
          editor: {
            row: {
              id: '',
              title: intent.book.title,
              date: data.today,
              time: 0,
              characters: 0,
              speed: 0,
              measurements: {
                readingTime: 0,
                averageReadingTime: 0,
                averageWeightedReadingTime: 0,
                charactersRead: 0,
                averageCharactersRead: 0,
                averageWeightedCharactersRead: 0,
                lastReadingSpeed: 0,
                minReadingSpeed: 0,
                altMinReadingSpeed: 0,
                maxReadingSpeed: 0
              },
              entry
            },
            date: data.today,
            time: '0',
            characters: '0',
            resetMinMax: false,
            mode: 'create'
          }
        });
        return;
      }
      case 'editor':
        if (!state.busy && state.editor) publish({ editor: { ...state.editor, ...intent.patch } });
        return;
      case 'close-editor':
        if (!state.busy) publish({ editor: undefined });
        return;
      case 'save-editor': {
        const editor = state.editor;
        if (!data || !editor?.row.entry || state.busy) return;
        if (editor.mode === 'edit' && editor.date !== editor.row.entry.date) {
          publish({ error: 'An existing entry cannot be moved to another date.' });
          return;
        }
        const time = Number(editor.time),
          characters = Number(editor.characters);
        if (
          !editor.time.trim() ||
          !editor.characters.trim() ||
          !Number.isFinite(time) ||
          time < 0 ||
          !Number.isFinite(characters) ||
          characters < 0 ||
          !validDate(editor.date)
        ) {
          publish({ error: 'Enter a valid date and non-negative seconds and characters.' });
          return;
        }
        const speed = time ? Math.ceil((3600 * characters) / time) : 0;
        requestMutation(
          {
            type: 'save-day',
            snapshotId: data.snapshotId,
            entry: { ...editor.row.entry, date: editor.date },
            time,
            characters,
            resetMinMax: editor.resetMinMax,
            mode: editor.mode
          },
          'Update Data',
          `This will update the Data for ${editor.row.title} on ${editor.date}.\n\nTime: ${editor.row.time / 60} min => ${time / 60} min\nCharacters: ${editor.row.characters} => ${characters}\nSpeed: ${editor.row.speed} / h => ${speed} / h\nMin Speed: ${editor.row.measurements.minReadingSpeed} / h => ${editor.resetMinMax || !editor.row.measurements.minReadingSpeed ? speed : Math.min(editor.row.measurements.minReadingSpeed, speed)} / h\nAlt Min Speed: ${editor.row.measurements.altMinReadingSpeed} / h => ${characters || editor.resetMinMax ? (editor.resetMinMax || !editor.row.measurements.altMinReadingSpeed ? speed : Math.min(editor.row.measurements.altMinReadingSpeed, speed)) : editor.row.measurements.altMinReadingSpeed} / h\nMax Speed: ${editor.row.measurements.maxReadingSpeed} / h => ${editor.resetMinMax ? speed : Math.max(editor.row.measurements.maxReadingSpeed, speed)} / h`,
          'Update'
        );
        return;
      }
      case 'delete-row':
      case 'delete-selection':
      case 'delete-all': {
        if (!data || state.busy || (intent.type === 'delete-all' && unavailable('globalDelete')))
          return;
        const row =
          intent.type === 'delete-row'
            ? data.rows.find((row) => row.id === intent.row.id)
            : undefined;
        if (intent.type === 'delete-row' && !row) return;
        const affectedTitles =
          intent.type === 'delete-all'
            ? (data.allTitles ?? data.titles.map((item) => item.title))
            : row
              ? (row.affectedTitles ?? (row.title ? [row.title] : (data.selectionTitles ?? [])))
              : (data.selectionTitles ??
                data.titles
                  .filter((item) => item.selected && item.inDateRange)
                  .map((item) => item.title));
        requestMutation(
          {
            type: 'delete',
            snapshotId: data.snapshotId,
            scope: intent.type === 'delete-all' ? 'all' : 'selection',
            row
          },
          'Delete Data',
          `This will delete ${intent.type === 'delete-all' ? 'all reading history' : row ? `reading history for ${row.title || 'selected titles'}${row.date ? ` on ${row.date}` : ''}` : `selected reading history from ${state.query.startDate} through ${state.query.endDate}`} (which may include start and/or completion Data).\n\nExecute a one time Sync with an export behavior of "overwrite" and/or statistics merge mode of "replace" to apply deletions to other devices.\n\n${affectedTitles.length} ${affectedTitles.length === 1 ? 'Title' : 'Titles'}:\n${affectedTitles.join('\n\n')}`,
          'Confirm',
          state.query.confirmDeletion
        );
        return;
      }
      case 'confirm': {
        const action = pendingAction;
        pendingAction = undefined;
        if (!action || !actionLease) return;
        if (!intent.accept) {
          releaseAction();
          publish({ busy: false, confirmation: undefined });
          return;
        }
        if (action.snapshotId !== state.data?.snapshotId) {
          releaseAction();
          publish({
            busy: false,
            confirmation: undefined,
            error: 'History changed. Refresh before confirming again.'
          });
          return;
        }
        await run((signal) => port.mutate(action, signal), true, true);
        return;
      }
      case 'export':
        if (data && !unavailable(intent.format === 'raw' ? 'rawRecovery' : 'ttuExport'))
          await run((signal) => port.export(intent.format, intent.scope, data.snapshotId, signal));
        return;
      case 'copy':
        if (data && !unavailable('clipboard'))
          await run((signal) => port.copy(intent.measurement, data.snapshotId, signal));
        return;
      case 'day':
        publish({ selectedDay: intent.date, selectedDayGoal: intent.goal });
        return;
      case 'day-key': {
        const days = (data?.days ?? []).map((day, index) => ({
          dateString: day.date,
          isCurrentYear: true,
          heatmapRow:
            ((new Date(`${day.date}T12:00:00`).getDay() - state.query.weekStartsOn + 7) % 7) + 2,
          heatmapColumn: Math.floor(index / 7)
        }));
        const next = heatmapNavigationDate(
          days,
          intent.date,
          intent.key,
          intent.rtl,
          intent.control
        );
        if (next) publish({ selectedDay: next });
        return;
      }
      case 'longest-streak':
        return dispatch({ type: 'highlight', kind: 'longest', goal: false });
      case 'highlight': {
        const currentHighlight = intent.goal ? state.goalHighlight : state.highlight;
        const value =
          currentHighlight?.kind === intent.kind && currentHighlight.goal === intent.goal
            ? undefined
            : { kind: intent.kind, goal: intent.goal };
        const stats = intent.goal ? data?.goalStats : data;
        const ranges =
          intent.kind === 'longest'
            ? (stats?.longestStreaks ?? [])
            : intent.kind === 'current'
              ? stats?.currentStreakRange
                ? [stats.currentStreakRange]
                : []
              : (data?.goalStats?.completedStreaks ?? []);
        const year = intent.goal ? state.query.goalYear : state.query.year;
        const first = `${year}-01-01`,
          last = `${year}-12-31`;
        const inYear = ranges.find((range) => range.startDate <= last && range.endDate >= first);
        const start = (inYear ?? ranges[0])?.startDate;
        const allTime =
          (intent.goal ? state.query.goalHeatmapAggregation : state.query.heatmapAggregation) ===
          'all-time';
        if (
          value &&
          allTime &&
          !inYear &&
          start &&
          Number(start.slice(0, 4)) !== year &&
          !state.busy
        )
          await refresh(
            intent.goal
              ? { goalYear: Number(start.slice(0, 4)) }
              : { year: Number(start.slice(0, 4)) }
          );
        publish(
          intent.goal
            ? { goalHighlight: value }
            : { highlight: value, highlightStreak: !!value && value.kind === 'longest' }
        );
        return;
      }
      case 'all-time':
        if (data?.allTime && !state.busy)
          await refresh({ ...data.allTime, rangeTemplate: 'Custom', page: 1 });
        return;
      case 'refresh':
        if (!state.busy) await refresh();
        return;
      case 'clear-error':
        publish({ error: '' });
        return;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      mounted = true;
      abort = new AbortController();
      unsubscribe = port.subscribeInvalidation(invalidate);
      void refresh();
      return () => {
        mounted = false;
        generation++;
        abort.abort();
        pendingAction = undefined;
        releaseAction();
        unsubscribe();
        port.release?.();
      };
    },
    dispatch
  };
}
