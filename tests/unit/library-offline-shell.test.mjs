/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('offline shell handoff preserves no-claim activation and bounded failure evidence', () => {
  const result = spawnSync(
    'python',
    [fileURLToPath(new URL('./test_offline_shell.py', import.meta.url))],
    {
      encoding: 'utf8',
      timeout: 15000
    }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
