/** @license BSD-3-Clause */
// Wiring-policy tests. Original application suites/assertions remain unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileFunction } from 'node:vm';
import test from 'node:test';

// ESLint's existing config loader declares js-yaml. Resolve its dependency in
// that package's context so this works with pnpm without adding a new dependency.
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint'));
const configRequire = createRequire(eslintRequire.resolve('@eslint/eslintrc'));
const { load } = configRequire('js-yaml');
const root = new URL('../../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const directory = new URL('.github/workflows/', root);
const sources = Object.fromEntries(
  readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, readFileSync(new URL(name, directory), 'utf8')])
);
const workflows = Object.fromEntries(
  Object.entries(sources).map(([name, text]) => [name, load(text)])
);
const migration = workflows['expo-migration.yml'];
const branch = 'feat/expo-android-web-migration';
const repository = 'ManabiIO/manabi-reader-web';
const untouched = {
  'notify-production-publication.yml':
    '7c62879329be43e490b36b44544d347efc9ffe724eae2477dc4dbc3339cb3ab0',
  'moss-shared-custody.yml': 'ed8aaa78a65877003b0de9edd3740bffd32465828eddc8bb789d10701980c17c'
};

function context({
  event = 'pull_request',
  repo = repository,
  headRepo = repository,
  head = branch,
  visibility = 'public',
  privateValue = false
} = {}) {
  return {
    repository: repo,
    event_name: event,
    head_ref: event === 'pull_request' ? head : '',
    ref: event === 'pull_request' ? 'refs/pull/257/merge' : `refs/heads/${head}`,
    event: {
      repository: { visibility, private: privateValue },
      pull_request: { head: { repo: { full_name: headRepo } } }
    }
  };
}

function admits(expression, github) {
  // The checked-in job guards intentionally use only boolean operators, exact
  // string equality and toJSON. Execute that expression, not a duplicated rule.
  assert.equal(typeof expression, 'string');
  assert.doesNotMatch(expression, /\$\{\{|\b(?:success|failure|always|cancelled)\(/);
  return compileFunction(`return Boolean(${expression});`, ['github', 'toJSON'])(github, (value) =>
    JSON.stringify(value ?? null)
  );
}

const cases = [
  ['same-repo migration PR', {}, true, false],
  ['same-repo migration push (legacy suppression)', { event: 'push' }, true, false],
  [
    'same-repo migration dispatch preserves legacy manual behavior',
    { event: 'workflow_dispatch' },
    true,
    true
  ],
  ['other branch dispatch', { event: 'workflow_dispatch', head: 'feature/another' }, false, true],
  [
    'private migration dispatch',
    { event: 'workflow_dispatch', visibility: 'private', privateValue: true },
    false,
    true
  ],
  [
    'unknown-visibility migration dispatch',
    { event: 'workflow_dispatch', visibility: null, privateValue: null },
    false,
    true
  ],
  ['other branch PR', { head: 'feature/another' }, false, true],
  ['main push', { event: 'push', head: 'main' }, false, true],
  ['other branch push', { event: 'push', head: 'feature/another' }, false, true],
  ['fork contributor, same branch name', { headRepo: 'contributor/reader' }, false, true],
  ['fork repository push', { event: 'push', repo: 'contributor/reader' }, false, true],
  ['private migration PR', { visibility: 'private', privateValue: true }, false, false],
  [
    'private migration push',
    { event: 'push', visibility: 'private', privateValue: true },
    false,
    false
  ],
  ['internal visibility', { visibility: 'internal' }, false, false],
  ['unknown visibility', { visibility: null, privateValue: null }, false, false],
  ['missing visibility', { visibility: undefined }, false, false],
  ['inconsistent private flag', { visibility: 'public', privateValue: true }, false, false],
  ['missing private flag', { privateValue: undefined }, false, false],
  ['string false private flag', { visibility: 'public', privateValue: 'false' }, false, false],
  ['unrelated event', { event: 'workflow_run' }, false, true]
];

for (const [name, fixture, migrationExpected, legacyExpected] of cases) {
  test(`exact migration routing: ${name}`, () => {
    const github = context(fixture);
    if (Object.hasOwn(fixture, 'visibility') && fixture.visibility === undefined)
      delete github.event.repository.visibility;
    if (Object.hasOwn(fixture, 'privateValue') && fixture.privateValue === undefined)
      delete github.event.repository.private;
    for (const [job, definition] of Object.entries(migration.jobs)) {
      assert.equal(admits(definition.if, github), migrationExpected, `migration/${job}`);
    }
    for (const [file, workflow] of Object.entries(workflows)) {
      if (file === 'expo-migration.yml' || Object.hasOwn(untouched, file)) continue;
      for (const [job, definition] of Object.entries(workflow.jobs)) {
        assert.equal(admits(definition.if, github), legacyExpected, `${file}/${job}`);
      }
    }
  });
}

test('only three stock, read-only jobs; no duplicate push or matrix allocation', () => {
  assert.deepEqual(Object.keys(migration.jobs), ['regression', 'web', 'android']);
  assert.deepEqual(Object.keys(migration.on), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(migration.permissions, { contents: 'read' });
  for (const job of Object.values(migration.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job.strategy, undefined);
    assert.equal(job.needs, undefined);
    assert.equal(job.uses, undefined);
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  }
});

test('affected qualification is explicit and the complete final gate remains selectable', () => {
  const input = migration.on.workflow_dispatch.inputs.qualification_scope;
  assert.equal(input.type, 'choice');
  assert.equal(input.required, true);
  assert.equal(input.default, 'affected');
  assert.deepEqual(input.options, ['affected', 'full']);
  assert.equal(
    migration.env.QUALIFICATION_SCOPE,
    "${{ github.event_name == 'workflow_dispatch' && inputs.qualification_scope || 'affected' }}"
  );
  for (const job of Object.values(migration.jobs)) {
    const evidence = job.steps.find(
      (step) => step.name === 'Record exact source and qualification limits'
    );
    assert.match(evidence.run, /case "\$QUALIFICATION_SCOPE" in[\s\S]*affected\|full/);
    assert.match(evidence.run, /Unknown qualification scope[\s\S]*exit 1/);
    assert.match(evidence.run, /Affected checks are not the final full-parity gate/);
  }
});

test('executing jobs cannot upload artifacts, save remote caches or hide composite actions', () => {
  const allowed = new Set([
    'actions/checkout@v4',
    'pnpm/action-setup@v6.1.0',
    'actions/setup-node@v4',
    'actions/setup-python@v5',
    'actions/setup-java@v4'
  ]);
  for (const job of Object.values(migration.jobs)) {
    for (const step of job.steps) {
      if (step.uses) {
        assert.ok(allowed.has(step.uses), `Review every new action: ${step.uses}`);
        if (step.uses.startsWith('pnpm/action-setup')) {
          assert.equal(step.with.cache, false);
          assert.equal(step.with.run_install, false);
        } else {
          assert.equal(step.with?.cache, undefined);
        }
      }
      if (step.run) {
        assert.doesNotMatch(
          step.run,
          /upload-artifact|download-artifact|actions\/cache|saveCache|uploadArtifact|ACTIONS_(?:CACHE|RESULTS|RUNTIME)|gh\s+(?:api|release|cache|run)|rclone|\bs3\s+(?:cp|sync)|\b(?:eas|npm|pnpm)\s+(?:publish|deploy)/
        );
      }
    }
  }
});

test('the redundant lifetime workflow is removed while its assertions remain colocated', () => {
  assert.equal(Object.hasOwn(workflows, 'web-reader-lifetime.yml'), false);
  const commands = migration.jobs.web.steps.map((step) => step.run ?? '').join('\n');
  for (const suite of [
    'test_web_reader_lifetime',
    'test_books_library',
    'test_library_parity',
    'test_editors_picks'
  ])
    assert.ok(commands.includes(suite), suite);
  for (const [name, workflow] of Object.entries(workflows)) {
    if (name === 'expo-migration.yml' || Object.hasOwn(untouched, name)) continue;
    for (const job of Object.values(workflow.jobs))
      assert.doesNotMatch(job.if, /workflow_dispatch/);
  }
});

test('publication and manual MOSS workflows stay byte-for-byte unchanged', () => {
  for (const [name, expected] of Object.entries(untouched)) {
    assert.equal(createHash('sha256').update(sources[name]).digest('hex'), expected, name);
  }
  assert.deepEqual(Object.keys(workflows['moss-shared-custody.yml'].on), ['workflow_dispatch']);
  assert.deepEqual(workflows['notify-production-publication.yml'].on.workflow_run.branches, [
    'main'
  ]);
});

const webSteps = migration.jobs.web.steps;
const defaultSteps = migration.jobs.regression.steps;
const allBrowserSteps = [...defaultSteps, ...webSteps];
const stepNamed = (part) => {
  const matches = allBrowserSteps.filter((step) => step.name?.includes(part));
  assert.equal(matches.length, 1, part);
  return matches[0];
};

test('two independent exports qualify the promoted reader and do not mask default-route failures', () => {
  const exports = allBrowserSteps.filter((step) =>
    step.run?.includes('expo export --platform web')
  );
  assert.equal(
    defaultSteps.filter((step) => step.run?.includes('expo export --platform web')).length,
    1
  );
  assert.equal(
    webSteps.filter((step) => step.run?.includes('expo export --platform web')).length,
    1
  );
  const setup = defaultSteps.find((step) => step.id === 'browser-python');
  assert.match(setup.if, /!cancelled\(\)/);
  assert.match(setup.if, /steps\.dependencies\.outcome == 'success'/);
  assert.ok(
    defaultSteps.indexOf(setup) >
      defaultSteps.findIndex(
        (step) => step.name === 'Existing library dispatcher and diagnostic contracts'
      )
  );
  assert.equal(exports.length, 2);
  for (const step of exports)
    assert.equal(step.env.EXPO_PUBLIC_QUALIFY_WEB_READER_LIFETIME, undefined);
  for (const step of exports) {
    assert.match(step.run, /rm -rf apps\/web\/build/);
    assert.match(step.run, /expo export --platform web --clear/);
    assert.match(step.run, /verify-expo-export\.mjs --platform web/);
  }
  assert.match(exports[1].if, /!cancelled\(\)/);
  assert.doesNotMatch(exports[1].if, /default-export|success\(\)/);
  const normal = stepNamed('Core default-route acceptance').run;
  const gated = stepNamed('Retained actual-app assertions').run;
  for (const suite of [
    'test_static_reader',
    'test_settings_controls',
    'test_product_journeys',
    'test_library_parity',
    'test_statistics_shared_route'
  ]) {
    assert.ok(normal.includes(suite), `default ${suite}`);
    assert.ok(gated.includes(suite), `gated ${suite}`);
  }
  for (const commands of [normal, gated]) {
    assert.match(commands, /for engine in chromium webkit/);
    assert.match(commands, /exit "\$status"/);
  }
  const layout = read('apps/web/src/app/_layout.tsx');
  const route = read('apps/web/src/screens/routes/b.web.tsx');
  const binding = read('apps/web/src/runtime/router-binding.tsx');
  for (const source of [layout, route, binding])
    assert.doesNotMatch(source, /qualifyWebReaderLifetime|EXPO_PUBLIC_QUALIFY_WEB_READER_LIFETIME/);
  assert.match(layout, /Platform\.OS === 'web'\s*\?\s*\(\s*<Slot/);
  assert.match(route, /return <QualifiedWebReader routeUrl=\{url\.href\}/);
  assert.match(binding, /return installQualifiedWebNavigation\(window, adapter, setError\)/);
});

test('required original browser and runtime assertions remain selected', () => {
  const gated = stepNamed('Retained actual-app assertions').run;
  for (const suite of [
    'test_static_reader',
    'test_library_parity',
    'test_settings_controls',
    'test_annotations_quality',
    'test_offline_reader',
    'test_web_reader_lifetime',
    'test_books_library.py',
    'test_editors_picks',
    'test_reading_recovery',
    'test_ttu_migration',
    'test_ttu_migration_edges',
    'test_completed_reading',
    'test_statistics_shared_route'
  ]) {
    assert.ok(gated.includes(suite), suite);
  }
  assert.match(gated, /cases=\(BooksLibraryBrowser\)/);
  assert.match(gated, /cases\+=\(BooksLibraryFilesystem\)/);
  assert.equal(
    stepNamed('Required shared and local data safety').run,
    'python tests/browser/qualify_library_data_safety.py'
  );
  assert.match(stepNamed('Assembled snippets').run, /for engine in chromium webkit/);
  assert.match(stepNamed('Assembled snippets').run, /node test\/snippets\/browser\.mjs/);
  for (const name of ['Required shared and local data safety', 'Assembled snippets'])
    assert.match(stepNamed(name).if, /env\.QUALIFICATION_SCOPE == 'full'/);
  for (const script of ['onnx-runtime-browser.mjs', 'native-library-cover-browser.mjs']) {
    assert.ok(
      webSteps.some((step) => step.run?.includes(script)),
      script
    );
  }
});

for (const [label, mode] of [
  ['Core default-route acceptance', 'default'],
  ['Retained actual-app assertions', 'gated']
]) {
  test(`${label}: real shell selects equal affected coverage and retains full inventory without hiding failures`, () => {
    const commands = stepNamed(label).run;
    for (const scope of ['affected', 'full']) {
      const temporary = mkdtempSync(path.join(tmpdir(), 'expo-ci-scope-'));
      try {
        const summary = path.join(temporary, 'summary.md');
        // A PATH executable also intercepts `env NAME=value python ...`; a
        // shell function alone would accidentally launch those real suites.
        writeFileSync(
          path.join(temporary, 'python'),
          '#!/usr/bin/env bash\n' +
            'printf "SELECTED|%s|%s\\n" "${LIBRARY_BROWSER:-chromium}" "$*"\n' +
            'case "$*" in *statistics_acceptance_cases.py*) exit 7;; *) exit 0;; esac\n',
          { mode: 0o755 }
        );
        const result = spawnSync(
          'bash',
          ['-e', '-o', 'pipefail', '-c', 'timeout() { shift 2; "$@"; }\n' + commands],
          {
            encoding: 'utf8',
            env: {
              PATH: `${temporary}${path.delimiter}${process.env.PATH}`,
              GITHUB_STEP_SUMMARY: summary,
              QUALIFICATION_SCOPE: scope
            }
          }
        );
        assert.equal(
          result.status,
          1,
          'An affected failure must remain a job failure in either scope'
        );
        for (const engine of ['chromium', 'webkit']) {
          assert.ok(
            result.stdout.includes(
              `SELECTED|${engine}|tests/browser/statistics_acceptance_cases.py --export-mode ${mode}`
            )
          );
          assert.ok(
            result.stdout.includes(`SELECTED|${engine}|tests/browser/test_web_reader_lifetime.py`)
          );
          for (const settingsSuite of ['test_settings_controls', 'test_settings_editor_usability'])
            assert.ok(
              result.stdout.includes(`SELECTED|${engine}|tests/browser/${settingsSuite}.py`)
            );
          assert.ok(
            result.stdout.includes(
              `SELECTED|${engine}|-m unittest test_library_sync.LibraryOrganizationSync.test_offline_bookmark_survives_reload_and_syncs_on_reconnect test_offline_account_profile.OfflineAccountProfile.test_owned_book_opens_offline_and_disappears_after_confirmed_signout -v`
            )
          );
        }
        const selected = result.stdout.split('\n').filter((line) => line.startsWith('SELECTED|'));
        if (scope === 'full' && mode === 'gated') {
          for (const engine of ['chromium', 'webkit'])
            assert.ok(
              selected.includes(
                `SELECTED|${engine}|-m unittest test_gallery_reveal_lifetime test_gallery_continuity -v`
              )
            );
        }
        assert.doesNotMatch(result.stdout + result.stderr, /Traceback|playwright\._impl/);
        assert.equal(
          selected.some((line) => line.includes('test_library_parity.py')),
          scope === 'full'
        );
        assert.equal(
          selected.some((line) => line.includes('test_settings_controls.py')),
          true
        );
        assert.match(
          readFileSync(summary, 'utf8'),
          /FAIL \(exit 7\): .*shared-statistics-chromium[\s\S]*PASS: .*offline-handoff-webkit/
        );
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  });
}

for (const label of ['Core default-route acceptance', 'Retained actual-app assertions']) {
  test(`${label}: actual shell dispatcher preserves all failures and later results`, () => {
    const commands = stepNamed(label).run;
    // YAML leaves shell indentation; take exactly the existing function body.
    const end = commands.indexOf('\n}\n', commands.indexOf('run_suite()'));
    assert.notEqual(end, -1);
    const dispatcher = commands.slice(commands.indexOf('status=0'), end + 3);
    for (const failed of [false, true]) {
      const temporary = mkdtempSync(path.join(tmpdir(), 'expo-ci-policy-'));
      try {
        const summary = path.join(temporary, 'summary.md');
        const result = spawnSync(
          'bash',
          [
            '-e',
            '-o',
            'pipefail',
            '-c',
            `timeout() { shift 2; "$@"; }\n${dispatcher}\n` +
              `run_suite first bash -c 'echo first; exit ${failed ? 7 : 0}'\n` +
              'run_suite later bash -c "echo later"\nexit "$status"\n'
          ],
          { encoding: 'utf8', env: { GITHUB_STEP_SUMMARY: summary, PATH: process.env.PATH } }
        );
        assert.equal(result.status, failed ? 1 : 0, result.stderr);
        assert.match(result.stdout, /first[\s\S]*later/);
        const text = readFileSync(summary, 'utf8');
        assert.match(text, failed ? /FAIL \(exit 7\): first/ : /PASS: first/);
        assert.match(text, /PASS: later/);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  });
}

test('only the Android job contains the approved KVM setup and existing fresh-AVD harness', () => {
  const android = migration.jobs.android;
  const kvm = android.steps.find((step) => step.id === 'kvm');
  assert.equal(
    kvm.run,
    `echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules\n` +
      'sudo udevadm control --reload-rules\nsudo udevadm trigger --name-match=kvm\n'
  );
  assert.match(kvm.if, /steps\.apk\.outcome == 'success'/);
  const runtime = android.steps.find((step) => step.id === 'runtime');
  assert.match(runtime.if, /steps\.kvm\.outcome == 'success'/);
  assert.match(runtime.run, /Refusing an existing emulator/);
  assert.ok(
    runtime.run.indexOf(
      "sdkmanager --install 'system-images;android-35;google_apis;x86_64' emulator platform-tools"
    ) < runtime.run.indexOf('emulator -accel-check'),
    'A stock runner may lack the emulator binary: install it before probing acceleration'
  );
  assert.match(runtime.run, /command -v emulator; emulator -accel-check/);
  assert.match(runtime.run, /tee -a test-results\/android\/acceleration\.log/);
  assert.match(runtime.run, /mktemp -d "\$RUNNER_TEMP\/manabi-reader-avd/);
  assert.match(runtime.run, /bash tests\/android\/run-qualification\.sh/);
  assert.doesNotMatch(runtime.run, /chmod|chown|usermod|udevadm|sudo/);
  for (const key of ['regression', 'web']) {
    assert.doesNotMatch(JSON.stringify(migration.jobs[key]), /udevadm|\/dev\/kvm|avdmanager/);
  }
  const report = android.steps.at(-1);
  assert.match(report.run, /RUNTIME_OUTCOME.*success/);
  assert.match(report.run, /Android runtime is UNQUALIFIED/);
});
