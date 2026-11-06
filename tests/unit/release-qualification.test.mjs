import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import test from 'node:test';

const workflowsDirectory = new URL('../../.github/workflows/', import.meta.url);

test('public qualification cannot dispatch private Actions or publish a release', () => {
  const names = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(
    !names.includes('notify-production-publication.yml'),
    'Legacy private publication notifier stays retired'
  );
  for (const name of names) {
    const source = readFileSync(new URL(name, workflowsDirectory), 'utf8');
    assert.doesNotMatch(
      source,
      /MANABI_PUBLICATION_DISPATCH_TOKEN|\b(?:createWorkflowDispatch|createDispatchEvent)\b|\bgh\s+workflow\s+run\b|\/dispatches\b|(?:workflow|repository)-dispatch@/,
      `${name}: qualification cannot start hosted publication or private Actions`
    );
  }
});

test('library qualification keeps every main push and all data-safety suites', () => {
  const library = readFileSync(new URL('books-library.yml', workflowsDirectory), 'utf8');
  const push = library.split('  push:\n')[1].split('\npermissions:')[0];
  assert.match(push, /branches: \[main\]/);
  assert.doesNotMatch(push, /paths(?:-ignore)?:/);
  assert.match(library, /run: python tests\/browser\/qualify_library_data_safety\.py/);
});

test('required static qualification runs every data-safety suite and stops on any failure', () => {
  const build = readFileSync(
    new URL('../../.github/workflows/manabi-reader-ci.yml', import.meta.url),
    'utf8'
  );
  const step = build
    .split(
      '      - name: Qualify recovery, migration and completed reading before publication\n'
    )[1]
    .split('      - uses:')[0];
  assert.doesNotMatch(step, /continue-on-error:|if:/);
  const commands = step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  const suites = [
    'tests/browser/test_reading_recovery.py',
    'tests/browser/test_ttu_migration.py',
    'tests/browser/test_ttu_migration_edges.py',
    'tests/browser/test_completed_reading.py'
  ];
  for (const failure of ['', ...suites]) {
    // Execute the actual workflow commands with transport doubles. The shell
    // uses GitHub's fail-fast/pipefail behavior; no browser or files are needed.
    const result = spawnSync(
      'bash',
      [
        '-e',
        '-o',
        'pipefail',
        '-c',
        'python() { printf "%s\\n" "$1"; test "$1" != "$FAIL_SUITE"; };\n' +
          'tee() { cat; };\n' +
          commands
      ],
      { encoding: 'utf8', env: { ...process.env, FAIL_SUITE: failure } }
    );
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    const count = failure ? suites.indexOf(failure) + 1 : suites.length;
    assert.deepEqual(result.stdout.trim().split('\n'), suites.slice(0, count));
  }
});
