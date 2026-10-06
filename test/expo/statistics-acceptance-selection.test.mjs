/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('affected Statistics selection preserves identical canonical coverage in both export modes', () => {
  const result = spawnSync(
    'python',
    [
      fileURLToPath(new URL('../../tests/browser/statistics_acceptance_cases.py', import.meta.url)),
      '--list',
      '--json'
    ],
    { encoding: 'utf8', timeout: 10000 }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const manifest = JSON.parse(result.stdout);
  assert.deepEqual(manifest.browsers, ['chromium', 'webkit']);
  assert.deepEqual(manifest.exports.default, manifest.exports.gated);
  const cases = manifest.exports.default;
  assert.equal(cases.length, 20);
  assert.equal(new Set(cases).size, 20);
  const counts = {};
  for (const entry of cases) {
    const module = entry.split('.')[0];
    counts[module] = (counts[module] ?? 0) + 1;
    assert.match(entry, /^[A-Za-z_]+\.[A-Za-z_]+\.test_[A-Za-z_0-9]+$/);
  }
  assert.deepEqual(counts, {
    test_panel_usability: 8,
    test_connect_ui: 4,
    test_rhea_ui: 4,
    test_product_journeys: 1,
    test_books_library: 1,
    test_statistics_shared_route: 2
  });
  assert.ok(manifest.separate_legacy_reader_cases.length > 0);
  assert.match(manifest.full_parity_gate.join(' '), /complete retained.*final source/);
  assert.match(manifest.full_parity_gate.join(' '), /Android packaged-host/);
});
