/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('../../apps/web/src/', import.meta.url));
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(root, path.endsWith('.ts') ? path : path + '.ts');
    if (cache.has(file)) return cache.get(file);
    const source = readFileSync(file, 'utf8');
    const result = ts.transpileModule(source, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    assert.equal(result.diagnostics.length, 0);
    const module = { exports: {} };
    cache.set(file, module.exports);
    compileFunction(result.outputText, ['require', 'module', 'exports'])(
      (name) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        assert.ok(name.startsWith('.'), `Unapproved test dependency: ${name}`);
        return load(resolve(dirname(file), name));
      },
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const load = loader();
const schema = load('native-settings/schema');
const {
  nativeSettingDefinitions: definitions,
  validateNativeSetting,
  parseSettingDraft,
  settingIsEnabled,
  matchesNativeSetting
} = schema;
const { createNativeSettingsService, themeColorFields } = load('native-settings/service-core');
const { NativeSettingsSession, isNativeSettingsState } = load('native-settings/lifecycle');
const theme = load('lib/data/theme-option');
const initialPalette = { ...theme.availableThemes.get('light-theme') };
const op = { assertCurrent() {} };
function fixture() {
  const values = Object.fromEntries(
    definitions.map((field) => [
      field.key,
      field.kind === 'boolean'
        ? true
        : field.kind === 'number'
          ? field.nullable
            ? null
            : Math.max(1, field.min ?? 0)
          : field.kind === 'choice'
            ? (field.choices[0]?.value ?? 'manabi-theme')
            : 'Example font'
    ])
  );
  Object.assign(values, {
    viewMode: 'paginated',
    writingMode: 'horizontal-tb',
    statisticsEnabled: true,
    trackerAutoPause: 'moderate',
    trackerIdleMinutes: 1,
    theme: 'manabi-theme'
  });
  let custom = {};
  let resets = 0;
  let writes = 0;
  const bindings = Object.fromEntries(
    definitions.map((field) => [
      field.key,
      {
        read: () => values[field.key],
        write: (value) => {
          writes++;
          values[field.key] = value;
        }
      }
    ])
  );
  const service = createNativeSettingsService({
    bindings,
    customThemes: {
      read: () => custom,
      write: (value) => {
        custom = value;
        writes++;
      }
    },
    fonts: () => ({
      primary: ['Klee One'],
      secondary: ['System Sans'],
      effectivePrimary: 'Klee One'
    }),
    resetReadingPoints: () => {
      resets++;
    }
  });
  return {
    service,
    values,
    bindings,
    get custom() {
      return custom;
    },
    set custom(value) {
      custom = value;
    },
    get writes() {
      return writes;
    },
    get resets() {
      return resets;
    }
  };
}
const set = (key, value, expectedValue) => ({ type: 'set', key, value, expectedValue });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('all 64 scalar source groups are admitted, with appearance, background, page-turn and no arbitrary exports', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../tests/fixtures/settings-manifest.json', import.meta.url), 'utf8')
  );
  assert.equal(definitions.length, 70);
  assert.equal(new Set(definitions.map((field) => field.key)).size, 70);
  assert.equal(new Set(definitions.map((field) => field.sourceId)).size, 70);
  for (const group of manifest.filter((group) => group.binding))
    assert.ok(
      definitions.some((field) => field.sourceId === group.id && field.category === group.category),
      group.id
    );
  for (const key of [
    'readingGoal',
    'readingGoalsHistory',
    'storageSources',
    'database',
    'syncTarget',
    'gDriveStorageSource',
    '__proto__',
    'constructor',
    'localUser'
  ])
    assert.throws(() => validateNativeSetting(key, 'x'), /Unknown/);
  const source = readFileSync(resolve(root, 'native-settings/service.ts'), 'utf8');
  assert.doesNotMatch(source, /import \*|\[.*\$.*\]|readingGoal\$|storageSources\$|database/);
  for (const field of definitions) assert.match(source, new RegExp(`${field.key}:`), field.key);
});

test('source numeric limits keep font weight null, real font minimum, fractional line heights, and twelve-hour idle maximum', () => {
  assert.ok(validateNativeSetting('fontWeight', null));
  for (const value of [100, 450, 1000]) assert.ok(validateNativeSetting('fontWeight', value));
  assert.throws(() => validateNativeSetting('fontWeight', 99));
  assert.throws(() => validateNativeSetting('fontWeight', 1001));
  assert.ok(validateNativeSetting('fontSize', 1));
  assert.ok(validateNativeSetting('fontSize', 120));
  assert.ok(validateNativeSetting('lineHeight', 1.65));
  assert.ok(validateNativeSetting('trackerIdleMinutes', 720));
  assert.throws(() => validateNativeSetting('trackerIdleMinutes', 720.5));
  assert.throws(() => validateNativeSetting('startDayHoursForTracker', 24));
  assert.throws(() => validateNativeSetting('startDayHoursForTracker', 1.5));
  assert.throws(() => validateNativeSetting('pageColumns', 1.5));
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '20', true])
    assert.throws(() => validateNativeSetting('fontSize', value));
});

test('decimal drafts do not silently coerce blanks, hex, exponent notation, or Infinity', () => {
  const number = definitions.find((field) => field.key === 'fontSize');
  for (const value of ['', ' ', '0x10', 'Infinity', '1e9', '1,2'])
    assert.throws(() => parseSettingDraft(number, value));
  assert.equal(parseSettingDraft(number, '20.5'), 20.5);
  assert.equal(
    parseSettingDraft(
      definitions.find((field) => field.key === 'fontWeight'),
      ''
    ),
    null
  );
  assert.ok(validateNativeSetting('fontFamilyGroupOne', '"Noto Serif JP", serif'));
  assert.throws(() => validateNativeSetting('fontFamilyGroupOne', '\u0000secret'));
  assert.throws(() => validateNativeSetting('fontFamilyGroupOne', 'x'.repeat(1025)));
});

test('choice values use actual source enum spellings and page turn options', () => {
  for (const [key, valid, invalid] of [
    ['furiganaStyle', 'Hide', 'hide'],
    ['hideSpoilerImageMode', 'afterToc', 'aftertoc'],
    ['importHTMLFixMode', 'Standard', 'standard'],
    ['autoReplication', 'up', 'upload'],
    ['pageTurnEffect', 'slide', 'curl']
  ]) {
    assert.ok(validateNativeSetting(key, valid));
    assert.throws(() => validateNativeSetting(key, invalid));
  }
  assert.throws(() => validateNativeSetting('theme', 'unlisted'));
  assert.ok(validateNativeSetting('theme', 'my-theme', [{ value: 'my-theme', label: 'My theme' }]));
});

test('global search finds settings outside selected category, with all words required', () => {
  const field = definitions.find((field) => field.key === 'autoBookmarkTime');
  assert.ok(matchesNativeSetting(field, 'appearance', 'AUTOMATIC seconds'));
  assert.equal(matchesNativeSetting(field, 'appearance', ''), false);
  assert.equal(matchesNativeSetting(field, 'all', 'bookmark pizza'), false);
});

test('conditional source settings are disabled until the required preferences are active', () => {
  const f = fixture();
  const field = (key) => definitions.find((field) => field.key === key);
  assert.ok(settingIsEnabled(field('pageColumns'), f.values));
  f.values.writingMode = 'vertical-rl';
  assert.equal(settingIsEnabled(field('pageColumns'), f.values), false);
  assert.ok(settingIsEnabled(field('enableVerticalFontKerning'), f.values));
  f.values.statisticsEnabled = false;
  assert.equal(settingIsEnabled(field('trackerIdleMinutes'), f.values), false);
  assert.throws(() => f.service.action(set('trackerIdleMinutes', 2, 1), op), /not active/);
  assert.equal(f.writes, 0);
});

test('state reads are read-only, bounded DTOs and do not publish malformed palettes or protected data', () => {
  const f = fixture();
  f.custom = {
    valid: initialPalette,
    malicious: { ...initialPalette, backgroundColor: 'url(https://example.invalid)' },
    extra: { ...initialPalette, token: 'secret' }
  };
  f.values.fontSize = Infinity;
  const state = f.service.state(op);
  assert.equal(f.writes, 0);
  assert.ok(isNativeSettingsState(state));
  assert.deepEqual(
    state.themes.filter((item) => item.custom).map((item) => item.id),
    ['valid']
  );
  assert.equal(state.fields.find((item) => item.key === 'fontSize').enabled, false);
  assert.equal(state.fields.find((item) => item.key === 'fontSize').value, null);
  const text = JSON.stringify(state);
  assert.doesNotMatch(text, /secret|https:\/\/example/);
  assert.ok(text.length < 100000);
  assert.ok(state.gates.some((gate) => gate.id === 'reading-goals'));
});

test('setter admits one exact key and rejects extra keys or stale editor baselines without writes', () => {
  const f = fixture();
  const previous = f.values.fontSize;
  f.service.action(set('fontSize', 22, previous), op);
  assert.equal(f.values.fontSize, 22);
  assert.throws(() => f.service.action(set('fontSize', 23, previous), op), /changed/);
  assert.throws(
    () => f.service.action({ ...set('fontSize', 23, 22), database: {} }, op),
    /Invalid/
  );
  assert.throws(() => f.service.action(set('readingGoal', {}, null), op), /Unknown/);
  assert.throws(() => f.service.action({ type: 'clear-all' }, op), /Unknown/);
  assert.equal(f.writes, 1);
});

test('account/lifetime cancellation is checked before any mutation and before publication', () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () =>
      f.service.action(set('fontSize', 22, f.values.fontSize), {
        signal: controller.signal,
        assertCurrent() {}
      }),
    /cancelled/
  );
  assert.throws(
    () =>
      f.service.state({
        assertCurrent() {
          throw new Error('profile changed');
        }
      }),
    /profile changed/
  );
  assert.equal(f.writes, 0);
  let reads = 0;
  assert.throws(
    () =>
      f.service.action(set('fontSize', 22, f.values.fontSize), {
        assertCurrent() {
          if (++reads === 4) throw new Error('profile changed');
        }
      }),
    /profile changed/
  );
  assert.equal(f.writes, 0);
});

test('custom reading points only reset through the exact continuous-mode action', () => {
  const f = fixture();
  assert.throws(() => f.service.action({ type: 'reading-point.reset' }, op), /continuous/);
  f.values.viewMode = 'continuous';
  f.values.customReadingPointEnabled = true;
  f.service.action({ type: 'reading-point.reset' }, op);
  assert.equal(f.resets, 1);
  assert.throws(() => f.service.action({ type: 'reading-point.reset', value: 9 }, op), /Invalid/);
});

test('custom themes add, edit/rename and delete exact palettes, preserving transparent colors', () => {
  const f = fixture();
  const colors = { ...initialPalette, fontColor: 'rgba(10, 20, 30, 0)' };
  f.service.action(
    { type: 'theme.save', name: 'Study', previousName: null, expectedColors: null, colors },
    op
  );
  assert.equal(f.values.theme, 'Study');
  assert.equal(f.custom.Study.fontColor, colors.fontColor);
  f.service.action(
    { type: 'theme.save', name: 'Quiet', previousName: 'Study', expectedColors: colors, colors },
    op
  );
  assert.equal(Object.hasOwn(f.custom, 'Study'), false);
  assert.equal(f.values.theme, 'Quiet');
  f.service.action({ type: 'theme.delete', name: 'Quiet', expectedColors: colors }, op);
  assert.deepEqual(f.custom, {});
  assert.equal(f.values.theme, 'manabi-theme');
});

test('custom theme collisions, reserved names, CSS URLs, extra data and stale edits cannot overwrite saved palettes', () => {
  const f = fixture();
  f.custom = { Saved: initialPalette };
  const save = (overrides) => ({
    type: 'theme.save',
    name: 'New',
    previousName: null,
    expectedColors: null,
    colors: initialPalette,
    ...overrides
  });
  for (const name of [
    '',
    ' light ',
    '__proto__',
    'constructor',
    'prototype',
    'light-theme',
    'system-theme',
    'Saved',
    'x'.repeat(129)
  ])
    assert.throws(() => f.service.action(save({ name }), op));
  assert.throws(() =>
    f.service.action(
      save({ colors: { ...initialPalette, fontColor: 'url(https://evil.invalid)' } }),
      op
    )
  );
  assert.throws(() =>
    f.service.action(save({ colors: { ...initialPalette, secret: 'token' } }), op)
  );
  assert.throws(
    () =>
      f.service.action(
        save({
          name: 'Saved',
          previousName: 'Saved',
          expectedColors: { ...initialPalette, fontColor: '#abcdef' }
        }),
        op
      ),
    /changed/
  );
  assert.throws(
    () =>
      f.service.action(
        {
          type: 'theme.delete',
          name: 'Saved',
          expectedColors: { ...initialPalette, fontColor: '#abcdef' }
        },
        op
      ),
    /changed/
  );
  assert.equal(f.writes, 0);
  assert.equal(themeColorFields.length, 7);
});

test('native theme reads and creation have a strict custom theme count bound', () => {
  const f = fixture();
  f.custom = Object.fromEntries(
    Array.from({ length: 129 }, (_, i) => [`Theme ${i}`, initialPalette])
  );
  assert.equal(f.service.state(op).themes.length, 135);
  assert.throws(
    () =>
      f.service.action(
        {
          type: 'theme.save',
          name: 'overflow',
          previousName: null,
          expectedColors: null,
          colors: initialPalette
        },
        op
      ),
    /128/
  );
});

test('screen request lifetime rejects double taps and late results after account changes', async () => {
  const f = fixture();
  const wait = deferred();
  const updates = [];
  let calls = 0;
  let owner = { session: 'session_one', epoch: 0 };
  const session = new NativeSettingsSession(
    owner,
    () => owner,
    () => {
      calls++;
      return wait.promise;
    },
    (value) => updates.push(value)
  );
  session.start();
  session.start();
  assert.equal(calls, 1);
  assert.equal(await session.act(set('fontSize', 22, 1)), false);
  assert.equal(calls, 1);
  owner = { session: 'session_one', epoch: 1 };
  const count = updates.length;
  wait.resolve(f.service.state(op));
  await drain();
  assert.equal(updates.length, count);
  assert.equal(await session.refresh(), false);
});

test('screen unmount discards a pending result and never replays an action', async () => {
  const wait = deferred();
  const updates = [];
  let calls = 0;
  const owner = { session: 'session_one', epoch: 0 };
  const session = new NativeSettingsSession(
    owner,
    () => owner,
    () => {
      calls++;
      return wait.promise;
    },
    (value) => updates.push(value)
  );
  session.start();
  session.dispose();
  const count = updates.length;
  wait.resolve(fixture().service.state(op));
  await drain();
  assert.equal(updates.length, count);
  assert.equal(await session.act(set('fontSize', 22, 1)), false);
  assert.equal(calls, 1);
});

test('uncertain mutation result requires explicit read reconciliation before further changes', async () => {
  const f = fixture();
  let calls = [];
  let fail = true;
  const updates = [];
  const owner = { session: 'session_one', epoch: 0 };
  const session = new NativeSettingsSession(
    owner,
    () => owner,
    async (method, payload) => {
      calls.push(method);
      if (method === 'settings.action' && fail) throw new Error('Acknowledgement timed out');
      return method === 'settings.state' ? f.service.state(op) : f.service.action(payload, op);
    },
    (value) => updates.push(value)
  );
  await session.refresh();
  assert.equal(await session.act(set('fontSize', 22, 1)), false);
  assert.equal(updates.at(-1).reconcileRequired, true);
  assert.equal(await session.act(set('fontSize', 22, 1)), false);
  assert.equal(calls.length, 2);
  await session.refresh();
  fail = false;
  assert.equal(await session.act(set('fontSize', 22, 1)), true);
  assert.deepEqual(calls, [
    'settings.state',
    'settings.action',
    'settings.state',
    'settings.action'
  ]);
  assert.equal(updates.at(-1).pending, false);
});

test('DOM adapters preserve tracker seconds and exact reading-point reset values', () => {
  const source = readFileSync(resolve(root, 'native-settings/service.ts'), 'utf8');
  const keys = source
    .match(/import \{([\s\S]*?)\} from '\$lib\/data\/store'/)[1]
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const subjects = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        value: 1,
        getValue() {
          return this.value;
        },
        next(value) {
          this.value = value;
        }
      }
    ])
  );
  subjects.userFonts$ = {
    value: [{ name: 'Imported font', path: 'secret-path', fileName: 'secret-file' }]
  };
  subjects.yuKyokashoAvailable$.value = false;
  subjects.viewMode$.value = 'continuous';
  subjects.customReadingPointEnabled$.value = true;
  subjects.statisticsEnabled$.value = true;
  subjects.trackerIdleTime$.value = 90;
  let stops = 0;
  const readerBackground = {
    value: { fade: true, amount: 40 },
    getValue() {
      return this.value;
    },
    next(value) {
      this.value = value;
    }
  };
  const libraryBackground = {
    value: { fade: false, amount: 20 },
    getValue() {
      return this.value;
    },
    next(value) {
      this.value = value;
    }
  };
  const imported = loader({
    '$lib/data/store': subjects,
    '$lib/appearance/state': {
      readerBackgroundOptions$: readerBackground,
      libraryBackgroundOptions$: libraryBackground,
      appearance$: { getValue: () => 'system', next() {} },
      theme$: { getValue: () => 'manabi-theme', next() {} },
      customThemes$: { getValue: () => ({}), next() {} }
    },
    '$lib/data/page-turn-preferences': { pageTurnEffect$: { getValue: () => 'slide', next() {} } },
    '$lib/data/reader-typography': load('lib/data/reader-typography'),
    '$lib/data/fonts': load('lib/data/fonts'),
    '$lib/components/settings/settings-number-policy': load(
      'lib/components/settings/settings-number-policy'
    ),
    '$lib/manabi/operation-scope': {
      captureLibraryOperation: () => ({
        assertCurrent() {},
        stop() {
          stops++;
        }
      })
    }
  })('native-settings/service');
  let state = imported.readNativeSettingsState({});
  assert.equal(state.fields.find((field) => field.key === 'trackerIdleMinutes').value, 1.5);
  assert.equal(
    state.fonts.primary.includes('Imported font'),
    false,
    'imported faces are selected through the cache-verified manager, not the built-in picker'
  );
  assert.equal(
    subjects.userFonts$.value[0].name,
    'Imported font',
    'reading Settings never prunes stored font metadata'
  );
  assert.equal(state.fonts.primary.includes('YuKyokasho'), false);
  assert.doesNotMatch(JSON.stringify(state), /secret-path|secret-file/);
  imported.dispatchNativeSettingsAction(set('trackerIdleMinutes', 2.5, 1.5));
  assert.equal(subjects.trackerIdleTime$.value, 150);
  imported.dispatchNativeSettingsAction({ type: 'reading-point.reset' });
  assert.equal(subjects.verticalCustomReadingPosition$.value, 100);
  assert.equal(subjects.horizontalCustomReadingPosition$.value, 0);
  assert.equal(stops, 3);
  imported.dispatchNativeSettingsAction(set('readerBackgroundAmount', 60, 40));
  assert.deepEqual(readerBackground.value, { fade: true, amount: 60 });
  assert.deepEqual(libraryBackground.value, { fade: false, amount: 20 });
  assert.throws(() => imported.readNativeSettingsState({ ownerId: 'other' }), /Invalid/);
  assert.throws(() => imported.dispatchNativeSettingsAction({ type: 'invalid' }));
  assert.equal(stops, 5);
});

test('automatic paragraph margins keep the source reset behavior, without read-time writes', () => {
  const f = fixture();
  f.values.textMarginMode = 'manual';
  f.values.textMarginValue = 3;
  f.service.state(op);
  assert.equal(f.values.textMarginValue, 3);
  assert.equal(f.writes, 0);
  f.service.action(set('textMarginMode', 'auto', 'manual'), op);
  assert.equal(f.values.textMarginValue, 0);
  assert.equal(f.writes, 2);
  assert.throws(() => validateNativeSetting('statisticsMergeMode', 'local'));
  assert.throws(() => validateNativeSetting('readingGoalsMergeMode', 'local'));
});

test('duplicate mutation taps coalesce locally and cannot escape a disposed screen capability', async () => {
  const f = fixture();
  const pending = deferred();
  const owner = { session: 'session_one', epoch: 0 };
  let calls = 0;
  const session = new NativeSettingsSession(
    owner,
    () => owner,
    (method) =>
      method === 'settings.state'
        ? Promise.resolve(f.service.state(op))
        : (calls++, pending.promise),
    () => {}
  );
  await session.refresh();
  const first = session.act(set('fontSize', 22, 1));
  assert.equal(await session.act(set('fontSize', 23, 1)), false);
  assert.equal(calls, 1);
  session.dispose();
  pending.resolve(f.service.state(op));
  assert.equal(await first, false);
  const replacement = new NativeSettingsSession(
    owner,
    () => owner,
    async () => f.service.state(op),
    () => {}
  );
  await replacement.refresh();
  assert.equal(await session.act(set('fontSize', 22, 1)), false);
  assert.equal(calls, 1);
});

test('React development effect replay uses a new owner session instead of reviving cancelled work', async () => {
  const pending = deferred();
  const owner = { session: 'session_one', epoch: 0 };
  const oldUpdates = [],
    nextUpdates = [];
  const first = new NativeSettingsSession(
    owner,
    () => owner,
    () => pending.promise,
    (value) => oldUpdates.push(value)
  );
  first.start();
  first.dispose();
  const count = oldUpdates.length;
  const second = new NativeSettingsSession(
    owner,
    () => owner,
    async () => fixture().service.state(op),
    (value) => nextUpdates.push(value)
  );
  second.start();
  await drain();
  pending.resolve(fixture().service.state(op));
  await drain();
  assert.equal(oldUpdates.length, count);
  assert.equal(nextUpdates.at(-1).pending, false);
  assert.ok(nextUpdates.at(-1).data);
});
