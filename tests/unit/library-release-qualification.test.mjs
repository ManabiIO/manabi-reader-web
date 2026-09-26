import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';

test('required Library result includes local and shared browser safety and propagates failures', () => {
  const library = readFileSync(
    new URL('../../.github/workflows/books-library.yml', import.meta.url),
    'utf8'
  );
  // A fail-fast suite exits before its successful-result move. Upload its
  // still-live diagnostic directory as well, even on failure/cancellation.
  const upload = library.split('      - uses: actions/upload-artifact@v4')[1];
  assert.match(upload, /if: always\(\)/);
  assert.match(upload, /path: \|\n\s+artifacts\/library\n\s+test-results/);
  const step = library
    .split('      - name: Required Local Library and Shared TTU safety\n')[1]
    .split('      - uses:')[0];
  assert.doesNotMatch(step, /continue-on-error:|if:/);
  assert.match(step, /PYTHONPATH: tests\/browser/);
  const commands = step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  assert.doesNotMatch(commands, /pnpm (?:install|build)|playwright install/);
  const local =
    'test_local_library_features test_local_library_review test_local_library_refinement test_local_library_lifecycle test_library_deletion';
  const lifetime =
    'test_books_library.BooksLibraryFilesystem.test_external_relocation_rebinds_content_identity_and_presentation test_books_library.BooksLibraryFilesystem.test_relocated_book_read_cannot_navigate_after_browser_back';
  const expected = [
    `chromium:-m unittest ${local} -v`,
    `webkit:-m unittest ${local} -v`,
    `chromium:-m unittest ${lifetime} -v`,
    'default:tests/browser/test_shared_ttu.py',
    'default:tests/browser/test_shared_safety.py',
    'chromium:-m unittest test_reader_integration -v'
  ];
  // Compare the exact commands used by the standalone PR qualification, too:
  // adding a suite there must not silently leave main publication uncovered.
  const standaloneLocal = readFileSync(
    new URL('../../.github/workflows/local-library-features.yml', import.meta.url),
    'utf8'
  );
  const standaloneShared = readFileSync(
    new URL('../../.github/workflows/ttu-shared-qualification.yml', import.meta.url),
    'utf8'
  );
  for (const line of standaloneLocal.split('\n')) {
    const match = line.match(/run: python -m unittest (.+) -v/);
    if (match) assert.equal(match[1], local);
  }
  for (const file of ['test_shared_ttu.py', 'test_shared_safety.py']) {
    assert.ok(standaloneShared.includes(`python tests/browser/${file}`));
  }
  const temporary = mkdtempSync(join(tmpdir(), 'reader-release-gate-'));
  mkdirSync(join(temporary, 'artifacts/library'), { recursive: true });
  try {
    for (const failure of ['', ...expected, 'source-diff']) {
      // Run the actual shell with only external commands replaced. A failed
      // browser process behind tee must fail the required job; no retry/waiver.
      const result = spawnSync(
        'bash',
        [
          '-e',
          '-o',
          'pipefail',
          '-c',
          'python() { local key="${LIBRARY_BROWSER:-default}:$*"; printf "%s\\n" "$key"; test "$key" != "$FAIL_SUITE"; };\n' +
            'tee() { cat; }; git() { test "$FAIL_SUITE" != source-diff; };\n' +
            commands
        ],
        {
          cwd: temporary,
          env: { ...process.env, LIBRARY_BROWSER: '', FAIL_SUITE: failure },
          encoding: 'utf8'
        }
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status === 0, failure === '', result.stderr);
      const ran = result.stdout.trim().split('\n');
      const end = expected.indexOf(failure);
      assert.deepEqual(ran, end < 0 ? expected : expected.slice(0, end + 1));
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
