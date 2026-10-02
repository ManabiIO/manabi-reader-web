/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, settle } from './fixtures/statistics-controller.mjs';

test('React date templates publish every date-store write, including destructured source assignments', async () => {
  const f = fixture();
  const c = f.start('statistics-screen');
  for (const [template, date, expected] of [
    [f.types.StatisticsRangeTemplate.WEEK, '2024-02-29', ['2024-02-26', '2024-03-03']],
    [f.types.StatisticsRangeTemplate.MONTH, '2024-02-29', ['2024-02-01', '2024-02-29']],
    [f.types.StatisticsRangeTemplate.YEAR, '2024-02-29', ['2024-01-01', '2024-12-31']]
  ]) {
    f.store.lastStatisticsRangeTemplate$.next(template);
    c.setSelectedStatisticsDays(new Date(`${date}T12:00:00`));
    assert.deepEqual(
      [f.store.lastStatisticsStartDate$.value, f.store.lastStatisticsEndDate$.value],
      expected
    );
  }
  c.controller.destroy();
  await f.frame();
});

test('React custom dates reorder reversed inputs without losing either bound', () => {
  const f = fixture();
  const c = f.start('statistics-screen');
  c.handleSelectedStatisticsDateChange({ detail: { isStartDate: true, dateString: '2025-02-01' } });
  assert.equal(f.store.lastStatisticsStartDate$.value, '2024-12-31');
  assert.equal(f.store.lastStatisticsEndDate$.value, '2025-02-01');
  assert.equal(f.store.lastStatisticsRangeTemplate$.value, f.types.StatisticsRangeTemplate.CUSTOM);
  c.controller.destroy();
});

test('React Strict Mode prepare/cleanup does not clear a book prefilter', async () => {
  const f = fixture();
  const key = `content:${'a'.repeat(64)}`;
  f.types.preFilteredBookKeysForStatistics$.next(new Set([key]));
  const probe = f
    .load('statistics-react/statistics-screen-controller.ts')
    .createStatisticsScreen({});
  probe.controller.prepare();
  probe.controller.destroy();
  await f.frame();
  assert.equal(f.types.preFilteredBookKeysForStatistics$.value.has(key), true);
  const real = f.start('statistics-screen');
  real.controller.destroy();
  assert.equal(f.types.preFilteredBookKeysForStatistics$.value.size, 0);
});

test('React title filter retains private draft changes through search, paging, and unrelated store emissions', async () => {
  const f = fixture(),
    titles = new Map(Array.from({ length: 61 }, (_, i) => [`Title ${i}`, true]));
  const c = f.start('statistics-title-filter', {
    statisticsTitleFilters: titles,
    titlesInStatisticsDateRange: new Set(titles.keys())
  });
  c.selectTitle('Title 0', false);
  c.page = 3;
  await settle();
  f.store.skipKeyDownListener$.next(true);
  await settle();
  assert.equal(c.titlesToFilter[0].isSelected, false);
  assert.equal(titles.get('Title 0'), true);
  assert.equal(c.current.page, 3);
  assert.equal(c.current.rows.length, 11);
  c.titleFilter = 'Title 60';
  await settle();
  assert.equal(c.current.page, 1);
  assert.equal(c.current.rows[0].title, 'Title 60');
  c.controller.destroy();
  assert.equal(f.store.skipKeyDownListener$.value, false);
});

test('React summary keeps an in-progress edit through resize and only resets for changed data', async () => {
  const f = fixture(),
    rows = [f.row('One', '2024-02-28'), f.row('Two', '2024-02-29')];
  const c = f.start('statistics-summary', {
    aggregratedStatistics: rows,
    statisticsDateRangeLabel: '2024'
  });
  await f.frame();
  c.setRowInEditMode(rows[0]);
  c.rowInEditCharacters = 123;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(c.rowInEdit, rows[0]);
  assert.equal(c.rowInEditCharacters, 123);
  c.updateProps({ aggregratedStatistics: [...rows] });
  await settle();
  assert.equal(c.rowInEdit, undefined);
  c.controller.destroy();
  await f.frame();
});

test('React statistics exposes observable projections as read-only while source updates still flow', async () => {
  const f = fixture();
  const screen = f.start('statistics-screen');
  const summary = f.start('statistics-summary', {
    aggregratedStatistics: [],
    statisticsDateRangeLabel: '2024'
  });
  const content = f.start('statistics-content');
  for (const [controller, names] of [
    [screen, ['$currentBookId$']],
    [summary, ['$resizeHandler$']],
    [
      content,
      [
        '$copyStatisticsDataHandler$',
        '$exportStatisticsDataHandler$',
        '$exportRawStatisticsHandler$',
        '$deleteStatisticsDataHandler$',
        '$setStatisticsDatesToAllTimeHandler$'
      ]
    ]
  ]) {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(controller, name);
      assert.equal(typeof descriptor.get, 'function');
      assert.equal(descriptor.set, undefined);
      assert.throws(() => {
        controller[name] = 'not a writable store';
      }, TypeError);
    }
  }
  f.db.lastItem$.next({ dataId: 17 });
  await settle();
  assert.equal(screen.$currentBookId$, 17);
  f.db.lastItem$.next(undefined);
  await settle();
  assert.equal(screen.$currentBookId$, undefined);
  for (const controller of [screen, summary, content]) controller.controller.destroy();
  await f.frame();
});

test('React summary tolerates detached DOM refs and resumes bounded full-table measurement', async () => {
  const f = fixture();
  const measured = [];
  f.mock['$lib/functions/utils'].getFullHeight = (_window, element) => {
    assert.ok(element, 'Never measure a detached ref');
    measured.push(element);
    return element.height;
  };
  const c = f.start('statistics-summary', {
    aggregratedStatistics: [f.row('One', '2024-02-28')],
    statisticsDateRangeLabel: '2024'
  });
  c.renderFullStatisticsSummaryTable = true;
  c.statisticsSummaryTableContainerElm = null;
  c.statisticsSummaryButtonContainer = null;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(c.rowsPerStatisticsSummaryPage, 1);
  assert.equal(measured.length, 0);
  const table = { height: 500 },
    buttons = { height: 44 };
  c.statisticsSummaryTableContainerElm = table;
  c.statisticsSummaryButtonContainer = buttons;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(c.rowsPerStatisticsSummaryPage, 6);
  assert.deepEqual(measured, [table, buttons]);
  c.controller.destroy();
  c.statisticsSummaryTableContainerElm = null;
  c.statisticsSummaryButtonContainer = null;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(measured.length, 2);
});

test('React heatmap skips measurement and keyboard navigation after its DOM ref is detached', async () => {
  const f = fixture();
  let observations = 0;
  f.mock['$lib/hooks/observe-element-width'].observeElementWidth = () => {
    observations++;
    return () => {};
  };
  const c = f.start('statistics-heatmap', {
    heatmapAggregration: f.heatmap.HeatmapDataAggregration.YEAR,
    statisticsData: [],
    readingGoals: [],
    statisticsTitleFilters: new Map(),
    today: new Date('2024-02-29T12:00:00'),
    todayKey: '2024-02-29'
  });
  assert.equal(observations, 0);
  c.heatmapElement = null;
  const activeDate = c.activeDate;
  c.handleHeatmapDayKeydown({ key: 'ArrowRight' }, c.currentHeatmapDays[0]);
  assert.equal(c.activeDate, activeDate);
  c.controller.destroy();
  await f.frame();
});

test('React heatmap preserves year navigation and highlighted streak on unrelated renders', async () => {
  const f = fixture(),
    rows = [f.row('One', '2024-02-28'), f.row('One', '2024-02-29')];
  const props = {
    heatmapAggregration: f.heatmap.HeatmapDataAggregration.YEAR,
    statisticsData: rows,
    readingGoals: [],
    statisticsTitleFilters: new Map([['One', true]]),
    today: new Date('2024-02-29T12:00:00'),
    todayKey: '2024-02-29'
  };
  const c = f.start('statistics-heatmap', props);
  await settle();
  assert.equal(c.currentHeatmapDays.filter((day) => day.isCurrentYear).length, 366);
  assert.equal(c.currentHeatmapData.daysRead, '2 / 2 days (100%)');
  assert.equal(c.currentHeatmapData.longestStreaks[0].duration, 2);
  await c.highlightStreaks(
    c.currentHeatmapData.longestStreaks,
    f.heatmap.HeatmapStreakType.LONGEST
  );
  await settle();
  const selected = c.selectedStreakDates;
  c.updateProps(props);
  await settle();
  assert.equal(c.selectedStreakDates, selected);
  assert.equal(selected.size, 2);
  c.changeHeatmapYear(1);
  await settle();
  assert.equal(c.heatmapYear, 2025);
  assert.equal(c.currentHeatmapDays.filter((day) => day.isCurrentYear).length, 365);
  c.updateProps(props);
  await settle();
  assert.equal(c.heatmapYear, 2025);
  c.controller.destroy();
  await f.frame();
});

test('React content caches book-prefilter projections, preserves identities, and deletes only selected dates', async () => {
  const f = fixture(),
    a = `content:${'a'.repeat(64)}`,
    b = `content:${'b'.repeat(64)}`;
  f.types.preFilteredBookKeysForStatistics$.next(new Set([a]));
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-28', 60, a),
    f.row('Same', '2024-02-29', 90, b),
    f.row('Same', '2025-01-01', 120, a)
  ];
  const c = f.start('statistics-content');
  await settle();
  assert.equal(c.statisticsForSelection.length, 1);
  const stable = c.bookPrefilterStatistics;
  c.updateProps({});
  await settle();
  assert.equal(c.bookPrefilterStatistics, stable);
  await c.handleDeleteRequest({
    detail: { startDate: '2024-02-28', endDate: '2024-02-28', titlesToCheck: new Set(['Same']) }
  });
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.deleted)), [
    [[], false, '2024-02-28', '2024-02-28', [a]]
  ]);
  assert.deepEqual(
    c.statisticsData.map((r) => r.bookKey + '/' + r.dateKey),
    [b + '/2024-02-29', a + '/2025-01-01']
  );
  c.controller.destroy();
});

test('React content cancels its confirmation on teardown without deleting another route’s dialog', async () => {
  const f = fixture();
  f.store.confirmStatisticsDeletion$.next(true);
  f.db.getAllStatistics = async () => [f.row('One', '2024-02-28', 60, 'local:one')];
  const c = f.start('statistics-content');
  await settle();
  const pending = c.handleDeleteRequest({
    detail: { startDate: '', endDate: '', titlesToCheck: new Set(['One']) }
  });
  assert.equal(f.dialogs.dialogs$.value[0].props.dialogHeader, 'Delete Data');
  const other = { component: 'other', props: { title: 'Unrelated dialog' } };
  f.dialogs.dialogs$.next([other]);
  c.controller.destroy();
  await pending;
  assert.equal(f.deleted.length, 0);
  assert.equal(f.dialogs.dialogs$.value[0], other);
  assert.equal(f.types.statisticsActionInProgress$.value, false);
});

test('React content refuses duplicate actions and account changes before confirmation commits', async () => {
  const f = fixture();
  f.store.confirmStatisticsDeletion$.next(true);
  f.db.getAllStatistics = async () => [f.row('One', '2024-02-28', 60, 'local:one')];
  const c = f.start('statistics-content');
  await settle();
  const event = { detail: { startDate: '', endDate: '', titlesToCheck: new Set(['One']) } };
  const pending = c.handleDeleteRequest(event),
    shown = f.dialogs.dialogs$.value[0];
  await c.handleDeleteRequest(event);
  assert.equal(f.dialogs.dialogs$.value[0], shown);
  f.scopeAbort.abort();
  await pending;
  await settle();
  assert.equal(f.deleted.length, 0);
  assert.equal(c.statisticsData.length, 0);
  assert.equal(f.types.statisticsActionInProgress$.value, false);
  c.controller.destroy();
});

test('a late old-route delete cannot release a newer route’s progress lease', async () => {
  const f = fixture(),
    resolvers = [];
  f.db.getAllStatistics = async () => [f.row('One', '2024-02-28', 60, 'local:one')];
  f.db.deleteStatisticEntries = () => new Promise((resolve) => resolvers.push(resolve));
  const old = f.start('statistics-content');
  await settle();
  const event = { detail: { startDate: '', endDate: '', titlesToCheck: new Set(['One']) } };
  const first = old.handleDeleteRequest(event);
  old.controller.destroy();
  const next = f.start('statistics-content');
  await settle();
  const second = next.handleDeleteRequest(event);
  assert.equal(f.types.statisticsActionInProgress$.value, true);
  resolvers[0]();
  await first;
  assert.equal(f.types.statisticsActionInProgress$.value, true);
  resolvers[1]();
  await second;
  assert.equal(f.types.statisticsActionInProgress$.value, false);
  next.controller.destroy();
});

test('React goal heatmap retains original completion and daily streak calculations', async () => {
  const f = fixture();
  const c = f.start('statistics-heatmap', {
    heatmapType: f.heatmap.HeatmapType.READING_GOALS,
    heatmapAggregration: f.heatmap.HeatmapDataAggregration.YEAR,
    statisticsData: [f.row('One', '2024-02-28'), f.row('One', '2024-02-29')],
    readingGoals: [
      {
        goalStartDate: '2024-02-28',
        goalEndDate: '',
        goalOriginalEndDate: '',
        timeGoal: 60,
        characterGoal: 120,
        goalFrequency: f.trackers.ReadingGoalFrequency.DAILY,
        lastGoalModified: 1
      }
    ],
    statisticsTitleFilters: new Map([['One', true]]),
    today: new Date('2024-02-29T12:00:00'),
    todayKey: '2024-02-29'
  });
  await settle();
  assert.equal(c.currentHeatmapData.longestStreaks[0].duration, 2);
  assert.match(c.currentHeatmapData.completedReadingGoals, /^2 /);
  const leap = c.currentHeatmapDays.find((day) => day.dateString === '2024-02-29');
  assert.ok(leap.dayDetails.some((detail) => detail.includes('100%')));
  c.controller.destroy();
  await f.frame();
});

test('React selection export refuses ambiguous same-title identities and restores the action lease', async () => {
  const f = fixture();
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-28', 60, 'local:one'),
    f.row('Same', '2024-02-29', 60, 'local:two')
  ];
  const c = f.start('statistics-content');
  await settle();
  f.types.exportStatisticsData$.next(false);
  await settle();
  assert.equal(f.dialogs.dialogs$.value[0].props.title, 'Statistics export unavailable');
  assert.match(f.dialogs.dialogs$.value[0].props.message, /same title|identity|identities/i);
  assert.equal(f.types.statisticsActionInProgress$.value, false);
  c.controller.destroy();
});
