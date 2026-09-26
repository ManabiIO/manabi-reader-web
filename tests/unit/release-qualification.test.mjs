import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/notify-production-publication.yml', import.meta.url),
  'utf8'
);
const script = workflow
  .split('          script: |\n')[1]
  .split('      - name: Wake ')[0]
  .split('\n')
  .map((line) => line.replace(/^ {12}/, ''))
  .join('\n');
// Execute the actual privileged workflow's inline gate, not a copy of its policy.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const qualify = new AsyncFunction('github', 'context', 'core', script);
const required = ['manabi-reader-ci.yml', 'appearance.yml', 'books-library.yml'];
const sha = 'a'.repeat(40);
const valid = {
  head_sha: sha,
  event: 'push',
  head_branch: 'main',
  head_repository: { full_name: 'ManabiIO/manabi-reader-web' },
  status: 'completed',
  conclusion: 'success'
};

async function runGate({ main = sha, change = {}, missing = '', reject = '' } = {}) {
  const output = {};
  const calls = [];
  const github = {
    rest: {
      repos: {
        getCommit: async (args) => {
          assert.equal(args.ref, 'main');
          return { data: { sha: main } };
        }
      },
      actions: {
        listWorkflowRuns: async (args) => {
          calls.push(args.workflow_id);
          assert.equal(args.head_sha, sha);
          assert.equal(args.event, 'push');
          assert.equal(args.branch, 'main');
          assert.equal(args.per_page, 1);
          if (args.workflow_id === reject) throw new Error('API unavailable');
          const runs =
            args.workflow_id === missing
              ? []
              : [{ ...valid, ...(change[args.workflow_id] ?? {}) }, valid];
          return { data: { workflow_runs: runs } };
        }
      }
    }
  };
  await qualify(
    github,
    {
      repo: { owner: 'ManabiIO', repo: 'manabi-reader-web' },
      payload: { workflow_run: { head_sha: sha } }
    },
    {
      setOutput: (key, value) => {
        output[key] = value;
      },
      info: () => {}
    }
  );
  return { output, calls };
}

test('all three latest exact-main successes are needed before dispatch', async () => {
  const result = await runGate();
  assert.equal(result.output.qualified, 'true');
  assert.deepEqual(result.calls, required);
  assert.match(workflow, /if: steps\.qualify\.outputs\.qualified == 'true'/);
  assert.match(
    workflow,
    /workflows: \['Manabi Reader static build', 'Appearance', 'Books library'\]/
  );
});

test('delayed completion cannot qualify an older main SHA', async () => {
  const result = await runGate({ main: 'b'.repeat(40) });
  assert.equal(result.output.qualified, 'false');
  assert.deepEqual(result.calls, []);
});

for (const name of required) {
  test(`${name}: missing, red, pending and wrong-origin runs cannot use an older pass`, async () => {
    assert.equal((await runGate({ missing: name })).output.qualified, 'false');
    for (const change of [
      { conclusion: 'failure' },
      { conclusion: 'cancelled' },
      { conclusion: 'skipped' },
      { conclusion: 'timed_out' },
      { status: 'in_progress', conclusion: null },
      { status: 'queued', conclusion: null },
      { head_sha: 'b'.repeat(40) },
      { event: 'pull_request' },
      { head_branch: 'feature' },
      { head_repository: { full_name: 'fork/reader' } }
    ]) {
      assert.equal((await runGate({ change: { [name]: change } })).output.qualified, 'false');
    }
    await assert.rejects(runGate({ reject: name }), /API unavailable/);
  });
}

test('Library qualifies every main push; notification never executes checkout or artifacts', () => {
  const library = readFileSync(
    new URL('../../.github/workflows/books-library.yml', import.meta.url),
    'utf8'
  );
  const push = library.split('  push:\n')[1].split('\npermissions:')[0];
  assert.match(push, /branches: \[main\]/);
  assert.doesNotMatch(push, /paths(?:-ignore)?:/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|download-artifact)/);
  const privileged = workflow.split('      - name: Wake ')[0];
  assert.doesNotMatch(privileged, /\$\{\{\s*secrets\./);
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
