/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../apps/web/', import.meta.url));
// Real persistence subjects and importer, with a narrow reader/account fixture.
// The storage double fails a named write; it does not replace RxJS error semantics.
const result = await build({
  stdin: {
    contents: `export { importYatsuSettings } from './src/lib/manabi/yatsu-settings';
      export { config } from 'rxjs'; export * from '$lib/data/store';`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'settings-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^\$lib\/data\/store$/ }, () => ({
          path: 'reader',
          namespace: 'fixture'
        }));
        builder.onResolve({ filter: /^\.\/client$/ }, (args) =>
          args.importer.endsWith('yatsu-settings.ts')
            ? { path: 'account', namespace: 'fixture' }
            : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          resolveDir: root,
          contents:
            path === 'account'
              ? 'export const currentUser = () => null;'
              : `
        import { writableStorageSubject } from './src/lib/data/internal/writable-storage-subject';
        const number = writableStorageSubject(globalThis.localStorage, Number, String);
        const string = writableStorageSubject(globalThis.localStorage, s => s, s => s);
        export const fontSize$ = number('fontSize', 20);
        export const writingMode$ = string('writingMode', 'vertical-rl');`
        }));
      }
    }
  ]
});
const values = new Map();
let rejectWrite = () => false;
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  removeItem: (key) => values.delete(key),
  setItem(key, value) {
    if (rejectWrite(key, value))
      throw new DOMException('Storage write failed', 'QuotaExceededError');
    values.set(key, value);
  }
};
const { importYatsuSettings, config, fontSize$, writingMode$ } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64')
);
const unhandled = [];
config.onUnhandledError = (error) => unhandled.push(error);
const receipt = 'manabi-yatsu-settings-receipt-v1';
const snapshot = (settings) => ({ app: 'Yatsu Reader', schemaVersion: 1, settings });
function reset() {
  rejectWrite = () => false;
  fontSize$.next(20);
  writingMode$.next('vertical-rl');
  values.delete(receipt);
  unhandled.length = 0;
}

test('persistence failures throw before next/set publish, rather than escape via RxJS', async () => {
  reset();
  const seen = [];
  const sub = fontSize$.subscribe((value) => seen.push(value));
  rejectWrite = (key) => key === 'fontSize';
  assert.throws(() => fontSize$.next(26), { name: 'QuotaExceededError' });
  assert.throws(() => fontSize$.set(28), { name: 'QuotaExceededError' });
  assert.equal(fontSize$.getValue(), 20);
  assert.equal(values.get('fontSize'), '20');
  assert.deepEqual(seen, [20]);
  await delay(10);
  assert.deepEqual(unhandled, []);
  sub.unsubscribe();
  rejectWrite = () => false;
  fontSize$.set(26);
  assert.equal(fontSize$.getValue(), 26);
  assert.equal(values.get('fontSize'), '26');
});

test('settings failure rolls back earlier writes and does not acknowledge an unpersisted value', async () => {
  reset();
  rejectWrite = (key, value) => key === 'writingMode' && value === 'horizontal-tb';
  const input = snapshot({ fontSize: 26, writingMode: 'horizontal-tb' });
  await assert.rejects(importYatsuSettings(input), { name: 'QuotaExceededError' });
  assert.equal(fontSize$.getValue(), 20);
  assert.equal(writingMode$.getValue(), 'vertical-rl');
  assert.equal(values.get('fontSize'), '20');
  assert.equal(values.get('writingMode'), 'vertical-rl');
  assert.equal(values.has(receipt), false);
  await delay(10);
  assert.deepEqual(unhandled, []);
  rejectWrite = () => false;
  assert.equal((await importYatsuSettings(input)).status, 'imported');
  assert.equal(values.get('writingMode'), 'horizontal-tb');
  fontSize$.next(30);
  assert.equal((await importYatsuSettings(input)).status, 'unchanged');
  assert.equal(fontSize$.getValue(), 30);
});

test('a failed receipt write restores values and the prior acknowledgement for a retry', async () => {
  reset();
  await importYatsuSettings(snapshot({ fontSize: 22 }));
  const prior = values.get(receipt);
  rejectWrite = (key, value) => key === receipt && value !== prior;
  await assert.rejects(importYatsuSettings(snapshot({ fontSize: 26 })), {
    name: 'QuotaExceededError'
  });
  assert.equal(values.get(receipt), prior);
  assert.equal(fontSize$.getValue(), 22);
  assert.equal(values.get('fontSize'), '22');
  rejectWrite = () => false;
  assert.equal((await importYatsuSettings(snapshot({ fontSize: 26 }))).status, 'imported');
});
