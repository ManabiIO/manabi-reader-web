/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { File } from 'node:buffer';
import { webcrypto } from 'node:crypto';
const result = await build({
  entryPoints: ['apps/web/src/native-settings/font-service-core.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node'
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
  crypto: webcrypto
});
const { NativeFontService } = module.exports;
function loadTS(path, mocks, globals = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in mocks)) throw new Error('Unexpected import ' + name);
      return mocks[name];
    },
    Response,
    URL,
    File,
    crypto: webcrypto,
    ...globals
  });
  return module.exports;
}
function fixture() {
  let fonts = [],
    primary = 'Built-in serif',
    secondary = 'Built-in sans',
    putHook,
    deleteHook,
    keysHook,
    matchHook;
  const files = new Map(),
    calls = [];
  const cache = {
    keys: async () => {
      await keysHook?.();
      return [...files.keys()].map((path) => ({ url: 'https://reader.test' + path }));
    },
    match: async (path) => {
      await matchHook?.();
      return files.get(path);
    },
    put: async (path, response) => {
      calls.push(['put', path]);
      await putHook?.();
      files.set(path, response);
    },
    delete: async (path) => {
      calls.push(['delete', path]);
      await deleteHook?.();
      return files.delete(path);
    }
  };
  const subject = (read, write) => ({ getValue: read, next: write });
  const stores = {
    userFonts$: subject(
      () => fonts,
      (value) => {
        fonts = value;
        calls.push(['catalog']);
      }
    ),
    fontFamilyGroupOne$: subject(
      () => primary,
      (value) => {
        primary = value;
        calls.push(['primary', value]);
      }
    ),
    fontFamilyGroupTwo$: subject(
      () => secondary,
      (value) => {
        secondary = value;
        calls.push(['secondary', value]);
      }
    )
  };
  const actions = loadTS('apps/web/src/lib/components/settings/user-font-actions.ts', {});
  const { createNativeFontService } = loadTS(
    'apps/web/src/native-settings/font-service.dom.ts',
    {
      '../lib/data/store': stores,
      '../lib/data/fonts': {
        reservedFontNames: new Set(['Built-in serif', 'Built-in sans']),
        userFontsCacheName: 'reader-user-fonts'
      },
      '../lib/components/settings/user-font-actions': actions,
      './font-service-core': { NativeFontService }
    },
    { caches: { open: async () => cache } }
  );
  const abort = new AbortController();
  const authority = {
    key: 'reader:0',
    signal: abort.signal,
    assertCurrent() {
      abort.signal.throwIfAborted();
    }
  };
  return {
    service: createNativeFontService(),
    authority,
    abort,
    files,
    calls,
    get fonts() {
      return fonts;
    },
    get primary() {
      return primary;
    },
    get secondary() {
      return secondary;
    },
    set putHook(value) {
      putHook = value;
    },
    set deleteHook(value) {
      deleteHook = value;
    },
    set keysHook(value) {
      keysHook = value;
    },
    set matchHook(value) {
      matchHook = value;
    }
  };
}
const font = () => new File(['wOFF2 synthetic bytes'], 'custom.woff2');
const action = (state, type, family = 'primary') => ({
  type,
  token: state.token,
  key: state.fonts[0].key,
  family
});

test('actual font owner imports, reads, selects and removes through existing catalogue/cache helpers', async () => {
  const f = fixture();
  let state = await f.service.import({ name: 'Custom face' }, font(), f.authority);
  assert.equal(f.fonts.length, 1);
  assert.equal(f.primary, 'Built-in serif');
  assert.equal(f.secondary, 'Built-in sans');
  assert.equal(state.fonts[0].available, true);
  assert.equal('path' in state.fonts[0], false);
  assert.equal(
    (await f.files.get('/userfonts/custom.woff2').arrayBuffer()).byteLength,
    font().size
  );
  assert.equal(f.files.get('/userfonts/custom.woff2').headers.get('Content-Type'), 'font/woff2');
  state = await f.service.action(action(state, 'select'), f.authority);
  assert.equal(f.primary, 'Custom face');
  assert.equal(f.secondary, 'Built-in sans');
  state = await f.service.action(action(state, 'remove'), f.authority);
  assert.equal(state.fonts.length, 0);
  assert.equal(f.primary, '');
  assert.equal(f.secondary, 'Built-in sans');
});
test('missing cache files never prune metadata or replace the selected built-in face', async () => {
  const f = fixture();
  let state = await f.service.import({ name: 'Custom face' }, font(), f.authority);
  f.files.clear();
  state = await f.service.read({}, f.authority);
  assert.equal(state.fonts[0].available, false);
  assert.equal(f.fonts.length, 1);
  await assert.rejects(
    f.service.action(action(state, 'select'), f.authority),
    /no longer available/
  );
  assert.equal(f.primary, 'Built-in serif');
  state = await f.service.read({}, f.authority);
  await f.service.action(action(state, 'remove'), f.authority);
  assert.equal(f.primary, 'Built-in serif');
});
test('forged paths, foreign owners, stale handles and duplicate/reserved font names cannot mutate', async () => {
  const f = fixture();
  const state = await f.service.import({ name: 'Custom face' }, font(), f.authority);
  const before = f.calls.length;
  await assert.rejects(
    f.service.action({ ...action(state, 'remove'), path: '/other-cache' }, f.authority),
    /Invalid/
  );
  await assert.rejects(
    f.service.action(action(state, 'remove'), { ...f.authority, key: 'reader:1' }),
    /changed/
  );
  await f.service.read({}, f.authority);
  await assert.rejects(f.service.action(action(state, 'remove'), f.authority), /changed/);
  await assert.rejects(
    f.service.import({ name: 'Custom face' }, font(), f.authority),
    /already stored/
  );
  await assert.rejects(
    f.service.import({ name: 'Built-in serif' }, new File(['x'], 'other.woff'), f.authority),
    /reserved/
  );
  assert.equal(f.calls.length, before);
  assert.equal(f.fonts.length, 1);
});
test('cache listing/removal failures preserve catalogue and the current selection for explicit retry', async () => {
  const f = fixture();
  const state = await f.service.import({ name: 'Custom face' }, font(), f.authority);
  f.keysHook = () => {
    throw new Error('cache failed');
  };
  await assert.rejects(f.service.read({}, f.authority), /cache failed/);
  assert.equal(f.fonts.length, 1);
  f.keysHook = undefined;
  f.deleteHook = () => {
    throw new Error('delete failed');
  };
  await assert.rejects(f.service.action(action(state, 'remove'), f.authority), /delete failed/);
  assert.equal(f.fonts.length, 1);
  assert.equal(f.primary, 'Built-in serif');
});
for (const retire of ['account', 'dispose'])
  test(`${retire} retirement during cache put cannot publish catalogue or selection after the await`, async () => {
    const f = fixture();
    let release, entered;
    const started = new Promise((resolve) => (entered = resolve));
    f.putHook = () => {
      entered();
      return new Promise((resolve) => (release = resolve));
    };
    const saving = f.service.import({ name: 'Custom face' }, font(), f.authority);
    await started;
    await assert.rejects(f.service.read({}, f.authority), /current font operation/);
    if (retire === 'account') f.abort.abort();
    else f.service.dispose();
    release();
    await assert.rejects(saving);
    assert.equal(f.fonts.length, 0);
    assert.equal(f.primary, 'Built-in serif');
    assert.equal(f.secondary, 'Built-in sans');
  });
test('declared metadata mutation during availability read is refused rather than authorizing a replaced font', async () => {
  const f = fixture();
  await f.service.import({ name: 'Custom face' }, font(), f.authority);
  f.keysHook = () => {
    f.fonts[0].fileName = 'replacement.woff';
  };
  await assert.rejects(f.service.read({}, f.authority), /changed while loading/);
});

test('a caller cannot change the chosen family while the cached file is being verified', async () => {
  const f = fixture();
  const state = await f.service.import({ name: 'Custom face' }, font(), f.authority);
  let release, entered;
  const started = new Promise((resolve) => (entered = resolve));
  f.matchHook = () => {
    entered();
    return new Promise((resolve) => (release = resolve));
  };
  const payload = action(state, 'select', 'primary');
  const pending = f.service.action(payload, f.authority);
  await started;
  payload.family = 'secondary';
  release();
  await pending;
  assert.equal(f.primary, 'Custom face');
  assert.equal(f.secondary, 'Built-in sans');
});
