/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test/'
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  Event: dom.window.Event,
  Element: dom.window.Element,
  IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {}
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.ResizeObserver = globalThis.ResizeObserver;
window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = clearTimeout;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.innerWidth = 1024;
globalThis.innerHeight = 768;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout;
HTMLElement.prototype.scrollIntoView = function () {};
HTMLElement.prototype.scrollBy = function () {};
HTMLElement.prototype.scrollTo = function () {};
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'shared-statistics-actual-web-'));
const outfile = join(output, 'primitives.cjs');
await build({
  stdin: {
    contents: `export * from './apps/web/src/features/statistics/StatisticsScreen'; export { setPort } from 'statistics-test-port'; export { setFocus } from 'expo-router';`,
    resolveDir: process.cwd()
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  conditions: ['browser'],
  resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js'],
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'actual-rnw-and-expo-ui',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve({ filter: /^react-native$/ }, () => ({
          path: appRequire.resolve('react-native-web'),
          external: true
        }));
        // Navigation is outside this control test; RNW still owns the actual anchor.
        b.onResolve({ filter: /^\.\/ports$|^statistics-test-port$/ }, () => ({
          path: 'ports',
          namespace: 'ports'
        }));
        b.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({
          contents: `let port; export function setPort(value){port=value;} export function useStatisticsPort(){return port;}`,
          loader: 'js'
        }));
        b.onResolve({ filter: /^expo-router$/ }, () => ({ path: 'router', namespace: 'router' }));
        b.onLoad({ filter: /.*/, namespace: 'router' }, () => ({
          contents: `import React from 'react'; export function Link({href,children}) { return React.cloneElement(children,{href}); } let focused=true; const listeners=new Set(); export function setFocus(value){focused=value;for(const listener of listeners)listener();} export function useFocusEffect(callback){React.useEffect(()=>{let cleanup;const update=()=>{cleanup?.();cleanup=focused?callback():undefined;};listeners.add(update);update();return()=>{listeners.delete(update);cleanup?.();};},[callback]);}`,
          loader: 'jsx',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const { StatisticsScreenWithPort, StatisticsScreen, setPort, setFocus } = require(outfile);
const h = React.createElement;
const available = { available: true };
function fakePort(overrides = {}) {
  const calls = { load: [], mutate: [], exports: [], copies: [] };
  let invalidation;
  const titles = Array.from(
    { length: 61 },
    (_, index) => `Panel title ${String(index).padStart(3, '0')}`
  );
  const port = {
    ownerKey: 'account-A:route-1',
    userGuideHref: '/Manabi-Web/Docs/',
    initialTheme: { themeId: 'manabi-theme', appearance: 'light' },
    capabilities: {
      goals: available,
      clipboard: available,
      ttuExport: available,
      rawRecovery: available,
      globalDelete: available,
      createDay: available
    },
    initialView: 'summary',
    initialQuery: () => ({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      year: 2026,
      rangeTemplate: 'Custom',
      aggregation: 'none',
      pageSize: 1
    }),
    async load(query) {
      calls.load.push(query);
      return snapshot(query, titles);
    },
    async mutate(action) {
      calls.mutate.push(action);
    },
    async export(...args) {
      calls.exports.push(args);
    },
    async copy(...args) {
      calls.copies.push(args);
    },
    subscribeInvalidation(callback) {
      invalidation = callback;
      return () => {
        invalidation = undefined;
      };
    },
    ...overrides
  };
  return { port, calls, invalidate: () => invalidation?.() };
}
function snapshot(query, titles = ['Panel title 000']) {
  const rows = [
    {
      id: 'entry-A',
      title: 'Panel title 000',
      date: '2026-09-25',
      time: 120,
      characters: 50,
      speed: 1500,
      measurements: {
        readingTime: 120,
        averageReadingTime: 60,
        averageWeightedReadingTime: 40,
        charactersRead: 50,
        averageCharactersRead: 25,
        averageWeightedCharactersRead: 20,
        lastReadingSpeed: 1500,
        minReadingSpeed: 800,
        altMinReadingSpeed: 1000,
        maxReadingSpeed: 1800
      },
      entry: { bookId: 7, bookKey: 'identity-A', title: 'Panel title 000', date: '2026-09-25' }
    }
  ];
  const days = Array.from({ length: 365 }, (_, index) => {
    const d = new Date(query.year, 0, index + 1, 12);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      date,
      time: date.endsWith('09-25') ? 120 : 0,
      color: '',
      details: [date, 'Time: 2 min', 'Characters: 50']
    };
  });
  return {
    snapshotId: `snapshot-${query.year}-${query.page}`,
    query,
    today: '2026-10-02',
    shortcuts: { KeyT: 'range-template', KeyA: 'aggregation' },
    books: [{ id: 7, title: 'Panel title 000', bookKey: 'identity-A', deletable: true }],
    titles: titles.map((title) => ({
      title,
      inDateRange: true,
      selected: query.selectedTitles === undefined || query.selectedTitles.includes(title)
    })),
    rows,
    totalRows: 61,
    pages: 61,
    totals: { time: 120, characters: 50, speed: 1500, days: 1 },
    days,
    goalDays: [],
    daysRead: '1',
    currentStreak: 0,
    longestStreak: 1,
    longestStreakStartDate: `${query.year}-09-25`,
    longestStreakDates: [`${query.year}-09-25`],
    currentStreakDates: [],
    allTime: { startDate: '2025-01-01', endDate: '2026-12-31' },
    notices: []
  };
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(port) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(StatisticsScreenWithPort, { port })));
  await settle();
  return {
    container,
    root,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}
const textOf = (node) => node.getAttribute('aria-label') || node.textContent;
function findButton(label, root = document) {
  const node = [...root.querySelectorAll('button,[role="menuitem"]')].find(
    (node) => textOf(node) === label
  );
  assert.ok(node, `Missing control ${label}`);
  return node;
}
async function press(label, root = document) {
  await act(async () => findButton(label, root).click());
  await settle();
}
async function changeField(node, value) {
  assert.ok(node);
  await act(async () => {
    const proto =
      node.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(
      new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    );
  });
  await settle();
}
const dialog = (label) =>
  [...document.querySelectorAll('dialog,[role="dialog"]')].find(
    (node) =>
      node.getAttribute('aria-label') === label ||
      document.getElementById(node.getAttribute('aria-labelledby'))?.textContent === label
  );

test('production shared screen uses real RNW and ExpoUI controls for every measurement, date/aggregation and export/copy intent', async () => {
  const { port, calls } = fakePort();
  const fixture = await mount(port);
  try {
    assert.equal(
      fixture.container.querySelector('[data-testid="shared-statistics-screen"]')?.tagName,
      'DIV'
    );
    assert.equal(findButton('Statistics options').dataset.variant, 'secondary');
    assert.equal(findButton('Filter books').dataset.variant, 'secondary');
    await press('Heatmap');
    assert.equal(findButton('Heatmap').getAttribute('aria-pressed'), 'true');
    assert.equal(window.getComputedStyle(findButton('Heatmap')).borderBottomWidth, '2px');
    await press('Summary');
    assert.equal(findButton('Summary').getAttribute('aria-pressed'), 'true');
    assert.equal(window.getComputedStyle(findButton('Summary')).borderBottomWidth, '2px');
    await press('Statistics options');
    await press('Statistics Settings');
    const panel = dialog('Statistics options');
    assert.ok(panel);
    assert.equal(panel.dataset.slot, 'sheet-content');
    const pickers = [...panel.querySelectorAll('select')];
    const measurementHelp = panel.querySelector('#statistics-measurement-help');
    assert.match(measurementHelp.textContent, /Choose which values appear in the summary/);
    for (const id of ['timeDataSource', 'charactersSource', 'speedSource', 'primaryAggregration']) {
      const picker = panel.querySelector(`select[data-testid="${id}"]`);
      assert.equal(picker.getAttribute('aria-describedby'), measurementHelp.id);
      assert.equal(
        picker.getAttribute('aria-label'),
        picker.labels[0].querySelector('span').textContent
      );
    }
    assert.equal(
      panel.querySelector('select[data-testid="datesTemplate"]').hasAttribute('aria-describedby'),
      false
    );
    const time = pickers.find((node) =>
      [...node.options].some((o) => o.value === 'averageWeightedReadingTime')
    );
    await changeField(time, 'averageWeightedReadingTime');
    assert.equal(calls.load.at(-1).timeSource, 'averageWeightedReadingTime');
    const characters = [...panel.querySelectorAll('select')].find((node) =>
      [...node.options].some((o) => o.value === 'averageWeightedCharactersRead')
    );
    await changeField(characters, 'averageWeightedCharactersRead');
    assert.equal(calls.load.at(-1).charactersSource, 'averageWeightedCharactersRead');
    const speed = [...panel.querySelectorAll('select')].find((node) =>
      [...node.options].some((o) => o.value === 'altMinReadingSpeed')
    );
    await changeField(speed, 'altMinReadingSpeed');
    assert.equal(calls.load.at(-1).speedSource, 'altMinReadingSpeed');
    await press('Download raw history (JSON)', panel);
    await press('Export Selection', panel);
    await press('Export All', panel);
    assert.deepEqual(
      calls.exports.map((args) => args.slice(0, 2)),
      [
        ['raw', 'all'],
        ['ttu', 'selection'],
        ['ttu', 'all']
      ]
    );
    await press('Close statistics options', panel);
    await press('Statistics options');
    await press('Copy Reading Time');
    assert.equal(calls.copies.at(-1)[0], 'readingTime');
  } finally {
    await fixture.cleanup();
  }
});

test('shared navigation retains the original external User guide destination and browser link gestures', async () => {
  const { port } = fakePort();
  const fixture = await mount(port);
  try {
    await press('Navigate');
    const current = dialog('Manabi Reader').querySelector('a[aria-current="page"]');
    assert.ok(current);
    assert.match(current.textContent, /Statistics/);
    assert.equal(current.hasAttribute('aria-pressed'), false);
    assert.equal(current.hasAttribute('aria-selected'), false);
    const guide = dialog('Manabi Reader').querySelector('a[aria-label="User guide"]');
    assert.ok(guide);
    assert.equal(guide.getAttribute('href'), '/Manabi-Web/Docs/');
    assert.equal(guide.target, '_blank');
    assert.equal(guide.rel, 'noopener noreferrer');
  } finally {
    await fixture.cleanup();
  }
});

test('deletion confirmation setting retains its accessible label and explicit On/Off state', async () => {
  const { port } = fakePort();
  const fixture = await mount(port);
  try {
    await press('Statistics options');
    await press('Statistics Settings');
    const setting = dialog('Statistics options').querySelector(
      '[data-testid="statistics-confirm-deletion"]'
    );
    const control = setting.querySelector('input[role="switch"]');
    assert.match(control.labels[0].textContent, /Confirm Statistics Deletion/);
    const initial = control.checked;
    assert.ok(setting.textContent.endsWith(initial ? 'On' : 'Off'));
    await act(async () => control.click());
    await settle();
    assert.equal(control.checked, !initial);
    assert.ok(setting.textContent.endsWith(initial ? 'Off' : 'On'));
  } finally {
    await fixture.cleanup();
  }
});

test('title filter drafts cancel safely, page focus moves, matching bulk selection applies atomically', async () => {
  const { port, calls } = fakePort();
  const fixture = await mount(port);
  try {
    await press('Filter books');
    let panel = dialog('Filter books');
    assert.ok(panel);
    assert.equal(document.querySelectorAll('dialog').length, 1);
    await press('Next', panel);
    assert.equal(document.activeElement.type, 'checkbox');
    await press('Remove matching', panel);
    await press('Cancel', panel);
    assert.equal(calls.load.at(-1).selectedTitles, undefined);
    await press('Filter books');
    panel = dialog('Filter books');
    await changeField(panel.querySelector('input[type="search"]'), 'Panel title 00');
    await press('Remove matching', panel);
    await press('Apply Filter', panel);
    assert.equal(calls.load.at(-1).selectedTitles.length, 51);
    assert.equal(calls.load.at(-1).selectedTitles.includes('Panel title 000'), false);
  } finally {
    await fixture.cleanup();
  }
});

test('shared row editor retains draft through canceled confirmation and carries snapshot identity through save', async () => {
  const { port, calls } = fakePort();
  const fixture = await mount(port);
  try {
    await press('Edit row Panel title 000');
    await changeField(
      document.querySelector('input[aria-label="Reading time for Panel title 000 (seconds)"]'),
      '210'
    );
    await changeField(
      document.querySelector('input[aria-label="Characters read for Panel title 000"]'),
      '75'
    );
    await press('Save changes');
    assert.ok(dialog('Update Data'));
    await press('Cancel', dialog('Update Data'));
    assert.equal(
      document.querySelector('input[aria-label="Reading time for Panel title 000 (seconds)"]')
        .value,
      '210'
    );
    await press('Save changes');
    await press('Update', dialog('Update Data'));
    assert.equal(calls.mutate.length, 1);
    assert.equal(calls.mutate[0].time, 210);
    assert.equal(calls.mutate[0].characters, 75);
    assert.equal(calls.mutate[0].entry.bookKey, 'identity-A');
    assert.match(calls.mutate[0].snapshotId, /snapshot/);
  } finally {
    await fixture.cleanup();
  }
});

test('shared heatmap preserves one real keyboard button tab stop, native activation and nonmodal dismissal ownership', async () => {
  const { port } = fakePort();
  const fixture = await mount(port);
  try {
    await press('Heatmap');
    const grid = document.querySelector('.heatmap-calendar');
    assert.ok(grid);
    const day = grid.querySelector('[data-date="2026-09-25"]');
    assert.equal(day.tagName, 'BUTTON');
    await act(async () => day.focus());
    assert.equal(grid.querySelectorAll('button[tabindex="0"]').length, 1);
    await act(async () =>
      day.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      )
    );
    assert.equal(document.activeElement.dataset.date, '2026-10-02');
    await act(async () => {
      // JSDOM does not derive computed direction from the HTML dir attribute.
      // Exercise the same computed-style contract with an explicit CSS direction.
      day.style.direction = 'rtl';
      day.focus();
      day.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
    });
    assert.equal(document.activeElement.dataset.date, '2026-09-18');
    day.style.removeProperty('direction');
    await act(async () => day.click());
    await settle();
    assert.ok(dialog('Reading day details'));
    assert.equal(day.getAttribute('aria-expanded'), 'true');
    await press('Close heatmap details');
    assert.equal(document.activeElement, day);
    assert.equal(day.getAttribute('aria-expanded'), 'false');
    await act(async () => day.click());
    await settle();
    const target = findButton('Filter books');
    await act(async () => target.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
    await settle();
    assert.equal(dialog('Reading day details'), undefined);
    assert.notEqual(document.activeElement, day);
  } finally {
    await fixture.cleanup();
  }
});

test('shared tabs wrap at enlarged text and real calendar buttons keep their measured cell size without inherited padding', async () => {
  const width = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
  const previousFontSize = document.documentElement.style.fontSize;
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: 320
  });
  document.documentElement.style.fontSize = '200%';
  await act(async () => window.dispatchEvent(new window.Event('resize')));
  const { port } = fakePort();
  const fixture = await mount(port);
  try {
    // JSDOM has no layout engine. Assert the actual RNW output contract here;
    // the retained 320px browser gates still own reflow and point hit testing.
    const tabs = fixture.container.querySelector('[aria-label="Statistics view"]');
    const tabStyle = window.getComputedStyle(tabs);
    assert.equal(tabStyle.flexWrap, 'wrap');
    assert.equal(tabStyle.minWidth, '0px');
    assert.equal(tabStyle.maxWidth, '100%');
    for (const name of ['Summary', 'Heatmap']) {
      const button = findButton(name, tabs);
      assert.equal(button.tagName, 'BUTTON');
      assert.equal(window.getComputedStyle(button.firstElementChild).fontSize, '0.875rem');
    }

    await press('Heatmap');
    // Numeric textStyle overrides use the same root-scalable text path as
    // ordinary button labels. The browser case verifies actual 200% sizing.
    const streak = [...fixture.container.querySelectorAll('button')].find((button) =>
      textOf(button).startsWith('Longest Streak')
    );
    assert.ok(streak);
    assert.equal(window.getComputedStyle(streak.firstElementChild).fontSize, '0.75rem');
    const grid = fixture.container.querySelector('.heatmap-calendar');
    for (const measuredWidth of [1500, 168]) {
      Object.defineProperty(grid, 'clientWidth', { configurable: true, value: measuredWidth });
      await act(async () => window.dispatchEvent(new window.Event('resize')));
      const expected = `${Math.max(15, Math.floor((measuredWidth - 56) / 57))}px`;
      assert.equal(grid.style.gridAutoColumns, expected);
      assert.equal(grid.style.gridAutoRows, expected);
      for (const date of ['2026-09-25', '2026-10-02', '2026-01-01', '2026-12-31']) {
        const day = grid.querySelector(`[data-date="${date}"]`);
        assert.equal(day.tagName, 'BUTTON');
        assert.equal(day.disabled, false);
        const style = window.getComputedStyle(day);
        assert.equal(style.width, expected);
        assert.equal(style.height, expected);
        assert.equal(style.minWidth, expected);
        assert.equal(style.minHeight, expected);
        assert.equal(style.boxSizing, 'border-box');
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          assert.equal(style[`padding${side}`], '0px');
        }
      }
      assert.equal(
        window.getComputedStyle(grid.querySelector('[data-date="2026-10-02"]')).borderTopWidth,
        '3px'
      );
      assert.equal(grid.querySelectorAll('button[tabindex="0"]').length, 1);
    }
  } finally {
    await fixture.cleanup();
    if (width) Object.defineProperty(document.documentElement, 'clientWidth', width);
    else delete document.documentElement.clientWidth;
    document.documentElement.style.fontSize = previousFontSize;
    await act(async () => window.dispatchEvent(new window.Event('resize')));
  }
});

test('summary details and a virtualized page chooser remain nonmodal anchored controls', async () => {
  const fake = fakePort();
  const fixture = await mount(fake.port);
  try {
    await press('Show full title Panel title 000');
    const details = dialog('Measurement details');
    assert.ok(details);
    assert.notEqual(details.getAttribute('aria-modal'), 'true');
    await press('Close measurement details');
    await press('Choose statistics page');
    const pages = dialog('Statistics pages');
    assert.ok(pages);
    assert.notEqual(pages.getAttribute('aria-modal'), 'true');
    assert.ok(pages.querySelectorAll('button').length < 61);
    await press('3', pages);
    assert.equal(fake.calls.load.at(-1).page, 3);
  } finally {
    await fixture.cleanup();
  }
});

test('account invalidation retires a mounted pending confirmation before it can mutate another owner', async () => {
  const fake = fakePort();
  const fixture = await mount(fake.port);
  try {
    await press('Delete row Panel title 000');
    assert.ok(dialog('Delete Data'));
    await act(async () => fake.invalidate());
    await settle();
    assert.equal(dialog('Delete Data'), undefined);
    assert.equal(fake.calls.mutate.length, 0);
    assert.match(fixture.container.textContent, /Statistics access changed/);
  } finally {
    await fixture.cleanup();
  }
});

test('configured Statistics shortcuts share controller actions and ignore text fields or open panels', async () => {
  const { port, calls } = fakePort();
  const fixture = await mount(port);
  try {
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent('keyup', {
          code: 'KeyA',
          key: 'a',
          bubbles: true,
          cancelable: true
        })
      )
    );
    await settle();
    assert.equal(calls.load.at(-1).aggregation, 'date');
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent('keyup', {
          code: 'KeyT',
          key: 't',
          bubbles: true,
          cancelable: true
        })
      )
    );
    await settle();
    assert.equal(calls.load.at(-1).rangeTemplate, 'Today');
    await press('Filter books');
    const field = dialog('Filter books').querySelector('input[type="search"]');
    const loads = calls.load.length;
    await act(async () =>
      field.dispatchEvent(
        new window.KeyboardEvent('keyup', {
          code: 'KeyA',
          key: 'a',
          bubbles: true,
          cancelable: true
        })
      )
    );
    await settle();
    assert.equal(calls.load.length, loads);
  } finally {
    await fixture.cleanup();
  }
});

test('reading and goal calendars retain independent periods and highlighted streaks', async () => {
  const fake = fakePort();
  const originalLoad = fake.port.load;
  fake.port.load = async (query, signal) => {
    const data = await originalLoad(query, signal);
    data.goalDays = data.days.map((day) => ({
      ...day,
      date: `${query.goalYear}${day.date.slice(4)}`,
      details: [`${query.goalYear}${day.date.slice(4)}`, 'Goal complete']
    }));
    data.goalStats = {
      completed: '1',
      currentStreak: 1,
      longestStreak: 1,
      longestStreakCount: 1,
      longestStreakStartDate: `${query.goalYear}-09-25`,
      longestStreakDates: [`${query.goalYear}-09-25`],
      currentStreakDates: [`${query.goalYear}-10-02`],
      completedDates: [`${query.goalYear}-09-25`]
    };
    return data;
  };
  const fixture = await mount(fake.port);
  try {
    await press('Heatmap');
    const reading = () =>
      fixture.container.querySelector('[data-testid="statistics-reading-heatmap"]');
    const goals = () => fixture.container.querySelector('[data-testid="statistics-goals-heatmap"]');
    await act(async () => reading().querySelector('button[title="Highlight Streak"]').click());
    await settle();
    await act(async () => goals().querySelectorAll('button[title="Highlight Streak"]')[1].click());
    await settle();
    assert.equal(reading().querySelector('[data-date="2026-09-25"]').dataset.highlighted, 'true');
    assert.equal(goals().querySelector('[data-date="2026-10-02"]').dataset.highlighted, 'true');
    await act(async () =>
      goals().querySelector('button[aria-label="Previous heatmap period"]').click()
    );
    await settle();
    assert.equal(fake.calls.load.at(-1).year, 2026);
    assert.equal(fake.calls.load.at(-1).goalYear, 2025);
    assert.ok(reading().querySelector('[data-date="2026-01-01"]'));
    assert.ok(goals().querySelector('[data-date="2025-01-01"]'));
  } finally {
    await fixture.cleanup();
  }
});

test('retained Expo Stack blur removes every overlay and retires pending confirmation before refocus', async () => {
  const fake = fakePort();
  setPort(fake.port);
  setFocus(true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(StatisticsScreen)));
    await settle();
    await press('Delete row Panel title 000');
    const staleConfirm = findButton('Confirm', dialog('Delete Data'));
    await act(async () => setFocus(false));
    await settle();
    assert.equal(container.textContent, '');
    assert.equal(document.querySelectorAll('dialog,[role="dialog"]').length, 0);
    await act(async () => staleConfirm.click());
    await settle();
    assert.equal(fake.calls.mutate.length, 0);
    const next = fakePort({ ownerKey: 'account-A:route-2' });
    setPort(next.port);
    await act(async () => setFocus(true));
    await settle();
    await press('Filter books');
    assert.ok(dialog('Filter books'));
    await act(async () => setFocus(false));
    await settle();
    assert.equal(document.querySelectorAll('dialog,[role="dialog"]').length, 0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    setFocus(true);
  }
});

test('an admitted durable mutation can settle after route blur without reopening stale UI or blocking a new visit', async () => {
  let finish;
  const durable = new Promise((resolve) => {
    finish = resolve;
  });
  let admitted = 0;
  const fake = fakePort({
    async mutate() {
      admitted++;
      await durable;
    }
  });
  setPort(fake.port);
  setFocus(true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(StatisticsScreen)));
    await settle();
    await press('Delete row Panel title 000');
    await press('Confirm', dialog('Delete Data'));
    assert.equal(admitted, 1);
    await act(async () => setFocus(false));
    await settle();
    assert.equal(container.textContent, '');
    const next = fakePort({ ownerKey: 'account-B:route-3' });
    setPort(next.port);
    await act(async () => setFocus(true));
    await settle();
    await act(async () => finish());
    await settle();
    assert.equal(document.querySelectorAll('dialog,[role="dialog"]').length, 0);
    await press('Delete row Panel title 000');
    assert.ok(dialog('Delete Data'));
    assert.equal(next.calls.mutate.length, 0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    setFocus(true);
    finish();
  }
});

test.after(() => {
  rmSync(output, { recursive: true, force: true });
  dom.window.close();
});
