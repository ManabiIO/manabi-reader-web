/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';

const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint'));
const configRequire = createRequire(eslintRequire.resolve('@eslint/eslintrc'));
const { load } = configRequire('js-yaml');
const source = readFileSync(
  new URL('../../.github/workflows/windows-bootstrap.yml', import.meta.url),
  'utf8'
);
const workflow = load(source);
const job = workflow.jobs.native;
const repository = 'ManabiIO/manabi-reader-web';
const branch = 'codex/reader-windows-sdk56-20261020';
const admits = compileFunction(`return Boolean(${job.if});`, ['github', 'toJSON']);
const context = (overrides = {}) => ({
  repository,
  event_name: 'push',
  ref: `refs/heads/${branch}`,
  event: { repository: { visibility: 'public', private: false } },
  ...overrides
});

test('Windows job admits only explicit public candidate pushes and dispatches', () => {
  assert.equal(admits(context(), JSON.stringify), true);
  assert.equal(admits(context({ event_name: 'workflow_dispatch' }), JSON.stringify), true);
  for (const overrides of [
    { event_name: 'pull_request' },
    { event_name: 'workflow_run' },
    { repository: 'contributor/reader' },
    { ref: 'refs/heads/main' },
    { ref: 'refs/heads/feature/another' },
    ...[
      { visibility: 'private', private: true },
      { visibility: 'internal', private: false },
      { visibility: 'public', private: true },
      { visibility: 'public', private: 'false' },
      { visibility: 'public' },
      { private: false },
      {}
    ].map((repository) => ({ event: { repository } }))
  ])
    assert.equal(admits(context(overrides), JSON.stringify), false, JSON.stringify(overrides));
});

test('one stock VS2026 job has no remote cache, artifact, secret or deployment path', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['native']);
  assert.deepEqual(Object.keys(workflow.on), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push.branches, [branch]);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(job['runs-on'], 'windows-2025-vs2026');
  assert.equal(job.strategy, undefined);
  assert.equal(job.uses, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.doesNotMatch(
    source,
    /secrets\.|upload-artifact|download-artifact|actions\/cache|ACTIONS_(?:CACHE|RESULTS|RUNTIME)|saveCache|uploadArtifact/
  );
  for (const step of job.steps) {
    assert.equal(step['continue-on-error'], undefined);
    if (step.uses) {
      assert.ok(
        ['actions/checkout@v4', 'pnpm/action-setup@v6.1.0', 'actions/setup-node@v4'].includes(
          step.uses
        )
      );
      assert.equal(step.with?.cache, step.uses.startsWith('pnpm/') ? false : undefined);
      if (step.uses.startsWith('pnpm/')) assert.equal(step.with.run_install, false);
      if (step.uses.startsWith('actions/checkout'))
        assert.equal(step.with['persist-credentials'], false);
    }
  }
});

test('both native builds are required independently, with runtime evidence from the built executable', () => {
  for (const id of ['debug', 'release']) {
    const step = job.steps.find((step) => step.id === id);
    assert.match(step.if, /steps\.dependencies\.outcome == 'success'/);
    assert.match(step.run, /--arch x64 --no-deploy --no-launch/);
    assert.match(step.run, /AppxPackageSigningEnabled=false/);
  }
  assert.match(job.steps.find((step) => step.id === 'release').run, /--release/);
  const runtime = job.steps.find((step) => step.id === 'runtime');
  assert.match(runtime.if, /steps\.release\.outcome == 'success'/);
  assert.equal(runtime.run, './test/windows/native-host.ps1');
  const script = readFileSync(new URL('./native-host.ps1', import.meta.url), 'utf8');
  assert.match(script, /Start-Process/);
  assert.match(script, /AutomationElement\]::FromHandle/);
  assert.match(script, /InvokePattern/);
  assert.match(script, /ValuePattern/);
  assert.match(script, /finally/);
  assert.doesNotMatch(script, /Remove-Item|Add-AppxPackage|Set-ItemProperty|Invoke-WebRequest/);
});
