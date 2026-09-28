/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  heatmapNavigationDate,
  heatmapMonthLabels,
  heatmapCellSize
} from '../../apps/web/src/lib/components/statistics/statistics-heatmap/heatmap-navigation.ts';
import { stickyPanelInsets } from '../../apps/web/src/lib/hooks/sticky-panel.ts';

function yearDays(year, startDay) {
  const date = new Date(Date.UTC(year, 0, 1));
  const offset = (date.getUTCDay() - startDay + 7) % 7;
  const days = [];
  while (date.getUTCFullYear() === year) {
    const index = days.length + offset;
    days.push({
      dateString: date.toISOString().slice(0, 10),
      isCurrentYear: true,
      heatmapRow: 2 + (index % 7),
      heatmapColumn: 3 + Math.floor(index / 7)
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

for (const year of [2024, 2025, 2026]) {
  for (const weekStart of [0, 1, 6]) {
    test(`heatmap keyboard geometry: ${year}, week starts ${weekStart}`, () => {
      const days = yearDays(year, weekStart);
      const at = days[100];
      assert.equal(heatmapNavigationDate(days, at.dateString, 'ArrowUp'), days[99].dateString);
      assert.equal(heatmapNavigationDate(days, at.dateString, 'ArrowDown'), days[101].dateString);
      assert.equal(heatmapNavigationDate(days, at.dateString, 'ArrowLeft'), days[93].dateString);
      assert.equal(heatmapNavigationDate(days, at.dateString, 'ArrowRight'), days[107].dateString);
      assert.equal(
        heatmapNavigationDate(days, at.dateString, 'ArrowLeft', true),
        days[107].dateString
      );
      assert.equal(
        heatmapNavigationDate(days, at.dateString, 'ArrowRight', true),
        days[93].dateString
      );
      const start = days.find(
        (day) => day.dateString === heatmapNavigationDate(days, at.dateString, 'Home')
      );
      const end = days.find(
        (day) => day.dateString === heatmapNavigationDate(days, at.dateString, 'End')
      );
      assert.equal(start.heatmapColumn, at.heatmapColumn);
      assert.equal(start.heatmapRow, 2);
      assert.equal(end.heatmapColumn, at.heatmapColumn);
      assert.equal(end.heatmapRow, 8);
      assert.equal(
        heatmapNavigationDate(days, at.dateString, 'Home', false, true),
        days[0].dateString
      );
      assert.equal(
        heatmapNavigationDate(days, at.dateString, 'End', false, true),
        days.at(-1).dateString
      );
      assert.equal(
        heatmapNavigationDate(days, days[0].dateString, 'ArrowLeft'),
        days[0].dateString
      );
      assert.equal(
        heatmapNavigationDate(days, days.at(-1).dateString, 'ArrowDown'),
        days.at(-1).dateString
      );
    });
  }
}

test('outside-year padding and unhandled or modified keys do not become navigation targets', () => {
  const days = [{ dateString: '-1', isCurrentYear: false }, ...yearDays(2026, 0)];
  assert.equal(heatmapNavigationDate(days, '-1', 'ArrowRight'), undefined);
  assert.equal(heatmapNavigationDate(days, '2026-01-01', 'Tab'), undefined);
  assert.equal(heatmapNavigationDate(days, '2026-01-01', 'ArrowRight', false, true), undefined);
  assert.equal(heatmapNavigationDate([], '2026-01-01', 'Home'), undefined);
});

test('month columns follow the current calendar without changing previous labels', () => {
  const labels = Array.from({ length: 12 }, (_, i) => ({ monthLabel: String(i + 1) }));
  const prior = heatmapMonthLabels(yearDays(2024, 0), labels);
  const frozen = prior.map((item) => ({ ...item }));
  for (const year of [2025, 2026]) {
    for (let weekStart = 0; weekStart < 7; weekStart += 1) {
      const days = yearDays(year, weekStart);
      const next = heatmapMonthLabels(days, prior);
      for (let month = 0; month < 12; month += 1) {
        const first = days.find(
          (day) => day.dateString === `${year}-${String(month + 1).padStart(2, '0')}-01`
        );
        assert.equal(
          next[month].heatmapColumn,
          `${first.heatmapColumn + 1}/${first.heatmapColumn + 3}`
        );
      }
    }
  }
  assert.deepEqual(prior, frozen);
  assert.deepEqual(
    heatmapMonthLabels([], prior),
    labels.map((label) => ({ ...label, heatmapColumn: '' }))
  );
});

test('cell sizing shrinks after resizing and fits the measured grid', () => {
  const large = heatmapCellSize(1800, 15, 1, 57);
  const small = heatmapCellSize(200, 15, 1, 57);
  assert.ok(large > 15);
  assert.equal(small, 15);
  assert.ok(large * 57 + 56 <= 1800);
  assert.equal(heatmapCellSize(NaN, 15, 1, 57), 15);
  assert.equal(heatmapCellSize(0, 15, 1, 57), 15);
});

test('sticky bars fall back to flow before obscuring enlarged controls', () => {
  assert.deepEqual(stickyPanelInsets(844, 76, 80), { enabled: true, top: 84, bottom: 88 });
  assert.deepEqual(stickyPanelInsets(320, 120, 120), { enabled: false, top: 8, bottom: 8 });
  assert.deepEqual(stickyPanelInsets(0, 76, 80), { enabled: false, top: 8, bottom: 8 });
  assert.deepEqual(stickyPanelInsets(NaN, 76, 80), { enabled: false, top: 8, bottom: 8 });
});
