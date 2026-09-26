/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterStatisticsTitles,
  setMatchingStatisticsTitleSelection,
  statisticsTitlePage,
  TITLE_FILTER_PAGE_SIZE
} from '../../apps/web/src/lib/components/statistics/title-filter-model.ts';

test('bounded title pages stay valid across empty results and changing filters', () => {
  const rows = Array.from({ length: 61 }, (_, index) => index);
  assert.equal(TITLE_FILTER_PAGE_SIZE, 25);
  assert.deepEqual(statisticsTitlePage(rows, 3), { page: 3, pages: 3, rows: rows.slice(50) });
  assert.deepEqual(statisticsTitlePage([], 3), { page: 1, pages: 1, rows: [] });
  assert.deepEqual(statisticsTitlePage([60], 3), { page: 1, pages: 1, rows: [60] });
  for (const page of [0, -1, NaN, Infinity]) {
    assert.equal(statisticsTitlePage(rows, page).page, 1);
  }
});

test('title search normalizes case and Unicode without rewriting the original title', () => {
  const rows = [{ title: 'Cafe\u0301 日本語の本', isSelected: true }];
  const result = filterStatisticsTitles(rows, ' CAFÉ ', new Set(), false, false);
  assert.equal(result.length, 1);
  assert.equal(result[0], rows[0]);
  assert.equal(result[0].title, 'Cafe\u0301 日本語の本');
});

test('date and selection filters compose without modifying private draft choices', () => {
  const rows = [
    { title: 'A', isSelected: true },
    { title: 'B', isSelected: false },
    { title: 'C', isSelected: true }
  ];
  const before = rows.map((item) => ({ ...item }));
  assert.deepEqual(filterStatisticsTitles(rows, '', new Set(['A', 'B']), true, true), [rows[0]]);
  assert.deepEqual(
    filterStatisticsTitles(rows, '', new Set(['A', 'B']), true, false),
    rows.slice(0, 2)
  );
  assert.deepEqual(rows, before);
  assert.deepEqual(filterStatisticsTitles(rows, '', new Set(['C']), true, true), [rows[2]]);
});

test('bulk title selection changes only the current matching set', () => {
  const rows = [
    { title: 'A', isSelected: true },
    { title: 'B', isSelected: true },
    { title: 'C', isSelected: false }
  ];
  const updated = setMatchingStatisticsTitleSelection(rows, [rows[1]], false);
  assert.deepEqual(updated, [rows[0], { title: 'B', isSelected: false }, rows[2]]);
  assert.equal(updated[0], rows[0]);
  assert.equal(updated[2], rows[2]);
  assert.deepEqual(setMatchingStatisticsTitleSelection(updated, [], true), updated);
});
