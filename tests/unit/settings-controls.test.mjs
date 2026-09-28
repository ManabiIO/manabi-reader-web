import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as dimensions from '../../apps/web/src/lib/components/settings/dimension-presets.ts';
import * as fonts from '../../apps/web/src/lib/components/settings/user-font-actions.ts';
import { settingsScript } from './fixtures/settings-script.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const reservedFontNames = new Set(['YuKyokasho', 'Klee One', 'System Sans']);
const selected = { name: 'Custom', fileName: 'custom.ttf', path: '/userfonts/custom.ttf' };
const aFile = new File(['first bytes'], 'custom.ttf');
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function size(initial = {}) {
  const viewport = { innerWidth: 1200, innerHeight: 900 };
  const h = settingsScript('settings-dimension-content.svelte', {
    dimensionValue: 137, isVertical: false, isFirstDimension: true, width: 1200, height: 900, ...initial
  }, {
    ...dimensions, window: viewport
  }, ['dimensionValue', 'setToValue'], ['isVertical', 'isFirstDimension', 'width', 'height', 'dimensionValue']);
  return { ...h, viewport };
}

test('opening size presets does not round and save an exact margin', async () => {
  const h = size(); await h.mount(); await turn();
  assert.equal(h.dimensionValue(), 137);
});

test('opening maximum size presets preserves Automatic zero', async () => {
  const h = size({ isFirstDimension: false, dimensionValue: 0 });
  await h.mount(); await turn();
  assert.equal(h.dimensionValue(), 0);
});

test('a chosen margin preset retains the same two-sided sizing convention', async () => {
  const h = size(); await h.mount(); await h.setToValue()(50); h.reactive();
  assert.equal(h.dimensionValue(), 225);
});

test('dimension choice uses resized current window extent', async () => {
  const h = size(); await h.mount();
  h.viewport.innerHeight = 600; h.set.height(600); h.reactive(); await h.setToValue()(50);
  assert.equal(h.dimensionValue(), 150);
});

test('changing writing direction changes the calculation axis', async () => {
  const h = size(); await h.mount();
  h.set.isVertical(true); h.reactive(); await h.setToValue()(25);
  assert.equal(h.dimensionValue(), 150);
});

test('invalid preset does not change the existing pixel setting', async () => {
  const h = size(); await h.mount();
  h.set.dimensionValue(137); h.reactive(); await h.setToValue()(NaN);
  assert.equal(h.dimensionValue(), 137);
});

function add(cache) {
  return settingsScript('settings-user-font-add.svelte', {
    isLoading: false, fontCache: cache, fontName: 'Custom', fontFile: aFile, fileElement: { value: 'chosen' }
  }, { ...fonts, reservedFontNames, $userFonts$: [], dummyFn: () => {} },
  ['addFont', 'fontName', 'fontFile', 'currentError', '$userFonts$', 'isLoading'], ['fontName', 'fontFile']);
}

test('saving a font owns name and file before cache suspension', async () => {
  const gate = deferred();
  const h = add({ put: async () => gate.promise });
  const saving = h.addFont()(); await turn();
  h.set.fontName('Later name'); h.set.fontFile(new File(['other'], 'later.woff2'));
  gate.resolve(); await saving;
  assert.deepEqual(h.$userFonts$(), [selected]);
});

test('a second submit cannot duplicate a pending font save', async () => {
  const gate = deferred(); let puts = 0;
  const h = add({ put: async () => { puts += 1; await gate.promise; } });
  const first = h.addFont()(); const second = h.addFont()(); await turn();
  gate.resolve(); await Promise.all([first, second]);
  assert.equal(puts, 1);
  assert.deepEqual(h.$userFonts$(), [selected]);
});

test('font submit validates reserved names even without a blur event', async () => {
  let puts = 0;
  const h = add({ put: async () => { puts += 1; } });
  h.set.fontName('Klee One'); await h.addFont()();
  assert.equal(puts, 0);
  assert.deepEqual(h.$userFonts$(), []);
  assert.match(h.currentError(), /built-in/);
});

test('font cache rejection is visible and releases pending state', async () => {
  const h = add({ put: async () => { throw new Error('No storage space'); } });
  await h.addFont()();
  assert.equal(h.currentError(), 'No storage space');
  assert.equal(h.isLoading(), false);
  assert.deepEqual(h.$userFonts$(), []);
});

test('explicit Save can finish after dismissal without dispatching into another dialog', async () => {
  const gate = deferred(); const h = add({ put: async () => gate.promise });
  const saving = h.addFont()(); await turn(); h.dispose(); gate.resolve(); await saving;
  assert.deepEqual(h.fonts.getValue(), [selected]);
  assert.deepEqual(h.events, []);
});

function manager(cache, currentFamily = 'YuKyokasho', entries = [selected]) {
  let current = currentFamily;
  const family = { getValue: () => current, next: (value) => { current = value; } };
  const h = settingsScript('settings-user-font-dialog.svelte', { fontFamily: family }, {
    ...fonts, $userFonts$: entries, userFontsCacheName: 'ttu-userfonts',
    caches: { open: async () => cache }, logger: { error: () => {} },
    dialogManager: { dialogs$: { next: () => {} } }
  }, ['removeFont', '$userFonts$', 'cacheLoaded'], []);
  return { ...h, family: () => current };
}

test('opening font manager never prunes missing metadata or unknown cached files', async () => {
  const deleted = [];
  const h = manager({ keys: async () => [new Request('https://reader.example/userfonts/incoming.ttf')], delete: async (path) => { deleted.push(path); } });
  await h.mount(); await turn();
  assert.deepEqual(h.$userFonts$(), [selected]);
  assert.deepEqual(deleted, []);
});

test('removing a custom font does not reset a built-in family', async () => {
  const h = manager({ keys: async () => [new Request('https://reader.example' + selected.path)], delete: async () => true });
  await h.mount(); await turn(); await h.removeFont()(selected.path);
  assert.equal(h.family(), 'YuKyokasho');
  assert.deepEqual(h.$userFonts$(), []);
});

test('removing the selected custom font still returns that style to its default', async () => {
  const h = manager({ keys: async () => [new Request('https://reader.example' + selected.path)], delete: async () => true }, 'Custom');
  await h.mount(); await turn(); await h.removeFont()(selected.path);
  assert.equal(h.family(), '');
  assert.deepEqual(h.$userFonts$(), []);
});

test('cache open failure retains metadata and settles the loader', async () => {
  const h = manager({ keys: async () => { throw new Error('Cache denied'); } });
  await h.mount(); await turn();
  assert.deepEqual(h.$userFonts$(), [selected]);
  assert.equal(h.cacheLoaded(), true);
});


test('a dismissed form merges into the live font store, not its retired subscription', async () => {
  const gate = deferred(); const h = add({ put: async () => gate.promise });
  const saving = h.addFont()(); await turn(); h.dispose();
  const other = { name: 'Other', fileName: 'other.woff2', path: '/userfonts/other.woff2' };
  h.fonts.next([other]); gate.resolve(); await saving;
  assert.deepEqual(h.fonts.getValue(), [other, selected]);
  assert.deepEqual(h.events, []);
});
