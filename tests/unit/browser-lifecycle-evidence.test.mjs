/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('browser diagnostics preserve errors and identify context-disposal timing', () => {
  const result = spawnSync('python', ['tests/unit/test_browser_lifecycle_evidence.py'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
