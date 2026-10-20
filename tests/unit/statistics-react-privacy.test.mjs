/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors.
 * UNRUN: regression sources authored under the source-only repair instruction.
 * The JSX projection checks semantics; real browser geometry/AT are deferred. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { fixture } from './fixtures/statistics-controller.mjs';

function summaryView(c, f) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const dependencies = {
    react: { __esModule: true, default: { Fragment: 'fragment' } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '../reader-react/controller': { useReaderController: () => c },
    './primitives': {
      Dom: 'dom',
      AppIcon: 'icon',
      Button: 'button',
      Popover: 'popover',
      ReaderScope: 'scope',
      useLatest: (props) => ({ current: props }),
      useReaderBindings() {}
    },
    './statistics-summary-controller': {},
    '$lib/components/statistics/statistics-summary/statistics-summary': f.load(
      'lib/components/statistics/statistics-summary/statistics-summary.ts'
    ),
    '$lib/components/statistics/statistics-types': f.types,
    '$lib/data/events': { CLOSE_POPOVER: 'closePopover' },
    '$lib/functions/statistic-util': f.load('lib/functions/statistic-util.ts'),
    './statistics-summary-header': { StatisticsSummaryHeader: 'header' }
  };
  const source = readFileSync(
    new URL('../../apps/web/src/statistics-react/statistics-summary.tsx', import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  const exports = {};
  runInNewContext(code, {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, `Declare view dependency ${name}`);
      return dependencies[name];
    }
  });
  return exports.StatisticsSummary({ aggregratedStatistics: c.aggregratedStatistics });
}
function find(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, predicate);
      if (result) return result;
    }
  } else if (node && typeof node === 'object') {
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
  }
}
async function setup() {
  const f = fixture();
  const hidden = new Set([
    'readingTime',
    'charactersRead',
    'lastReadingSpeed',
    'other-tracker-item'
  ]);
  f.store.lastBlurredTrackerItems$.next(hidden);
  const rows = [f.row('Privacy row', '2024-02-28', 120)];
  const c = f.start('statistics-summary', {
    aggregratedStatistics: rows,
    statisticsDateRangeLabel: '2024'
  });
  await f.frame();
  return { f, c, hidden, rows };
}

test('compatibility Summary hides all metric names and descendants; activation reveals only that preference before details', async () => {
  const { f, c, hidden, rows } = await setup();
  const opened = [];
  const anchor = { isConnected: true };
  c.statisticsSummaryPopover = { openAt: (target) => opened.push(target), close() {} };
  try {
    const savedRange = [
      f.store.lastStatisticsStartDate$.value,
      f.store.lastStatisticsEndDate$.value
    ];
    const savedSource = [
      c.$lastReadingTimeDataSource$,
      c.$lastCharactersDataSource$,
      c.$lastReadingSpeedDataSource$
    ];
    for (const key of ['readingTime', 'charactersRead', 'lastReadingSpeed']) {
      let metric = find(summaryView(c, f), (node) => node.props['data-summary-metric'] === key);
      const span = find(metric.props.children, (node) => node.type === 'span');
      assert.match(metric.props['aria-label'], /value hidden.*reveal/i);
      assert.equal(metric.props['aria-pressed'], true);
      assert.equal(span.props['aria-hidden'], true);
      assert.equal(span.props.className, 'blur');
      assert.ok(
        !metric.props.className.split(' ').includes('blur'),
        'Focus chrome remains unblurred'
      );
      assert.ok(!metric.props['aria-label'].includes(String(span.props.children)));
      // Descendant clicks must anchor to the button, never the blurred child.
      await metric.props.events.click({ currentTarget: anchor, target: span });
      assert.equal(opened.length, 0);
      assert.equal(c.statisticsSummaryPopoverDetails.length, 0);
      assert.equal(hidden.has(key), true, 'Never mutate the previously published Set');
      assert.equal(f.store.lastBlurredTrackerItems$.value.has(key), false);
      metric = find(summaryView(c, f), (node) => node.props['data-summary-metric'] === key);
      assert.match(metric.props['aria-label'], /Activate to view details/);
      assert.equal(metric.props['aria-pressed'], false);
      assert.equal(
        find(metric.props.children, (node) => node.type === 'span').props['aria-hidden'],
        false
      );
    }
    assert.equal(f.store.lastBlurredTrackerItems$.value.has('other-tracker-item'), true);
    assert.deepEqual(
      [f.store.lastStatisticsStartDate$.value, f.store.lastStatisticsEndDate$.value],
      savedRange
    );
    assert.deepEqual(
      [c.$lastReadingTimeDataSource$, c.$lastCharactersDataSource$, c.$lastReadingSpeedDataSource$],
      savedSource
    );
    assert.equal(c.currentStatisticsSummaryRows[0], rows[0]);
    const metric = find(
      summaryView(c, f),
      (node) => node.props['data-summary-metric'] === 'readingTime'
    );
    const pending = metric.props.events.click({ currentTarget: anchor, target: {} });
    await f.frame();
    await pending;
    assert.deepEqual(opened, [anchor]);
    assert.match(c.statisticsSummaryPopoverDetails[0], /Time: 2 min/);
    const popover = find(summaryView(c, f), (node) => node.type === 'popover' && node.props.dialog);
    assert.equal(popover.props.label, 'Statistic details');
    assert.equal(popover.props.restoreAnchorFocus, true);
    const close = find(popover, (node) => node.props['aria-label'] === 'Close statistic details');
    assert.equal(close.props.as, 'button');
    assert.match(close.props.className, /size-\[44px\]/);
  } finally {
    c.controller.destroy();
    await f.frame();
  }
});

test('compatibility details focus waits for committed content and repeated close cancels delayed focus/reopen', async () => {
  const { f, c } = await setup();
  const focused = [],
    opened = [],
    closed = [];
  const anchor = { isConnected: true };
  const close = { isConnected: true, focus: (options) => focused.push(options) };
  c.statisticsSummaryDetailsClose = close;
  c.statisticsSummaryPopover = {
    openAt: (target) => {
      opened.push(target);
      c.statisticsSummaryDetailsOpen = true;
    },
    close: (restore) => {
      closed.push(restore);
      c.statisticsSummaryDetailsOpen = false;
    }
  };
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      const opening = c.openDetails(anchor, ['Full title']);
      await f.frame();
      await opening;
      const focus = c.focusDetails();
      assert.equal(focused.length, cycle);
      await f.frame();
      await focus;
      assert.equal(focused[cycle].preventScroll, true);
      const delayedFocus = c.focusDetails();
      c.closeDetails();
      c.closeDetails();
      await f.frame();
      await delayedFocus;
      assert.equal(focused.length, cycle + 1);
      assert.equal(c.statisticsSummaryPopoverDetails.length, 0);
    }
    assert.deepEqual(opened, [anchor, anchor]);
    assert.ok(
      closed.every(Boolean),
      'Explicit close asks the existing primitive to restore the anchor'
    );
    const pending = c.openDetails(anchor, ['Cancelled details']);
    c.closeDetails();
    await f.frame();
    await pending;
    assert.equal(opened.length, 2);
  } finally {
    c.controller.destroy();
    await f.frame();
  }
});

test('compatibility details ignore superseded, detached and retired open/focus callbacks', async () => {
  const { f, c, hidden } = await setup();
  const opened = [],
    focused = [];
  const first = { isConnected: true },
    second = { isConnected: true };
  c.statisticsSummaryPopover = { openAt: (target) => opened.push(target), close() {} };
  c.statisticsSummaryDetailsClose = { isConnected: true, focus: () => focused.push('close') };
  const a = c.openDetails(first, ['First title']),
    b = c.openDetails(second, ['Second title']);
  await f.frame();
  await Promise.all([a, b]);
  assert.deepEqual(opened, [second]);
  const detached = c.openDetails(first, ['Detached title']);
  first.isConnected = false;
  await f.frame();
  await detached;
  assert.equal(opened.length, 1);
  c.statisticsSummaryDetailsOpen = true;
  const focus = c.focusDetails(),
    pending = c.openDetails(second, ['Retired title']);
  c.controller.destroy();
  await f.frame();
  await Promise.all([focus, pending]);
  assert.deepEqual(focused, []);
  assert.equal(opened.length, 1);
  await c.openMetricDetails('readingTime', second, ['Retired numeric details']);
  assert.equal(f.store.lastBlurredTrackerItems$.value, hidden);
});
