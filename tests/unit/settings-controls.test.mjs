import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { settingsScript } from './fixtures/settings-script.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const selected = { name: 'Custom', fileName: 'custom.ttf', path: '/userfonts/custom.ttf' };
const aFile = new File(['first bytes'], 'custom.ttf');
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function size(initial = {}) {
  const viewport = { innerWidth: 1200, innerHeight: 900 };
  const h = settingsScript(
    'settings-dimension-content.svelte',
    {
      dimensionValue: 137,
      isVertical: false,
      isFirstDimension: true,
      width: 1200,
      height: 900,
      ...initial
    },
    {
      window: viewport
    },
    ['dimensionValue', 'setToValue'],
    ['isVertical', 'isFirstDimension', 'width', 'height', 'dimensionValue']
  );
  return { ...h, viewport };
}

test('opening size presets does not round and save an exact margin', async () => {
  const h = size();
  await h.mount();
  await turn();
  assert.equal(h.dimensionValue(), 137);
});

test('opening maximum size presets preserves Automatic zero', async () => {
  const h = size({ isFirstDimension: false, dimensionValue: 0 });
  await h.mount();
  await turn();
  assert.equal(h.dimensionValue(), 0);
});

test('a chosen margin preset retains the same two-sided sizing convention', async () => {
  const h = size();
  await h.mount();
  await h.setToValue()(50);
  h.reactive();
  assert.equal(h.dimensionValue(), 225);
});

test('dimension choice uses resized current window extent', async () => {
  const h = size();
  await h.mount();
  h.viewport.innerHeight = 600;
  h.set.height(600);
  h.reactive();
  await h.setToValue()(50);
  assert.equal(h.dimensionValue(), 150);
});

test('changing writing direction changes the calculation axis', async () => {
  const h = size();
  await h.mount();
  h.set.isVertical(true);
  h.reactive();
  await h.setToValue()(25);
  assert.equal(h.dimensionValue(), 150);
});

test('invalid preset does not change the existing pixel setting', async () => {
  const h = size();
  await h.mount();
  h.set.dimensionValue(137);
  h.reactive();
  await h.setToValue()(NaN);
  assert.equal(h.dimensionValue(), 137);
});

function add(cache) {
  return settingsScript(
    'settings-user-font-add.svelte',
    {
      isLoading: false,
      fontCache: cache,
      fontName: 'Custom',
      fontFile: aFile,
      fileElement: { value: 'chosen' }
    },
    { $userFonts$: [] },
    ['addFont', 'fontName', 'fontFile', 'currentError', '$userFonts$', 'isLoading'],
    ['fontName', 'fontFile']
  );
}

test('saving a font owns name and file before cache suspension', async () => {
  const gate = deferred();
  const h = add({ put: async () => gate.promise });
  const saving = h.addFont()();
  await turn();
  h.set.fontName('Later name');
  h.set.fontFile(new File(['other'], 'later.woff2'));
  gate.resolve();
  await saving;
  assert.deepEqual(h.$userFonts$(), [selected]);
});

test('a second submit cannot duplicate a pending font save', async () => {
  const gate = deferred();
  let puts = 0;
  const h = add({
    put: async () => {
      puts += 1;
      await gate.promise;
    }
  });
  const first = h.addFont()();
  const second = h.addFont()();
  await turn();
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(puts, 1);
  assert.deepEqual(h.$userFonts$(), [selected]);
});

test('font submit validates reserved names even without a blur event', async () => {
  let puts = 0;
  const h = add({
    put: async () => {
      puts += 1;
    }
  });
  h.set.fontName('Klee One');
  await h.addFont()();
  assert.equal(puts, 0);
  assert.deepEqual(h.$userFonts$(), []);
  assert.match(h.currentError(), /built-in/);
});

test('font cache rejection is visible and releases pending state', async () => {
  const h = add({
    put: async () => {
      throw new Error('No storage space');
    }
  });
  await h.addFont()();
  assert.equal(h.currentError(), 'No storage space');
  assert.equal(h.isLoading(), false);
  assert.deepEqual(h.$userFonts$(), []);
});

test('explicit Save can finish after dismissal without dispatching into another dialog', async () => {
  const gate = deferred();
  const h = add({ put: async () => gate.promise });
  const saving = h.addFont()();
  await turn();
  h.dispose();
  gate.resolve();
  await saving;
  assert.deepEqual(h.fonts.getValue(), [selected]);
  assert.deepEqual(h.events, []);
});

function manager(cache, currentFamily = 'YuKyokasho', entries = [selected], bindings = {}) {
  let current = currentFamily;
  const family = {
    getValue: () => current,
    next: (value) => {
      current = value;
    }
  };
  const h = settingsScript(
    'settings-user-font-dialog.svelte',
    { fontFamily: family },
    {
      $userFonts$: entries,
      caches: { open: async () => cache },
      ...bindings
    },
    ['removeFont', '$userFonts$', 'cacheLoaded'],
    []
  );
  return { ...h, family: () => current };
}

test('opening font manager never prunes missing metadata or unknown cached files', async () => {
  const deleted = [];
  const h = manager({
    keys: async () => [new Request('https://reader.example/userfonts/incoming.ttf')],
    delete: async (path) => {
      deleted.push(path);
    }
  });
  await h.mount();
  await turn();
  assert.deepEqual(h.$userFonts$(), [selected]);
  assert.deepEqual(deleted, []);
});

test('removing a custom font does not reset a built-in family', async () => {
  const h = manager({
    keys: async () => [new Request('https://reader.example' + selected.path)],
    delete: async () => true
  });
  await h.mount();
  await turn();
  await h.removeFont()(selected.path);
  assert.equal(h.family(), 'YuKyokasho');
  assert.deepEqual(h.$userFonts$(), []);
});

test('removing the selected custom font still returns that style to its default', async () => {
  const h = manager(
    {
      keys: async () => [new Request('https://reader.example' + selected.path)],
      delete: async () => true
    },
    'Custom'
  );
  await h.mount();
  await turn();
  await h.removeFont()(selected.path);
  assert.equal(h.family(), '');
  assert.deepEqual(h.$userFonts$(), []);
});

test('cache open failure retains metadata and settles the loader', async () => {
  const h = manager({
    keys: async () => {
      throw new Error('Cache denied');
    }
  });
  await h.mount();
  await turn();
  assert.deepEqual(h.$userFonts$(), [selected]);
  assert.equal(h.cacheLoaded(), true);
});

test('a dismissed form merges into the live font store, not its retired subscription', async () => {
  const gate = deferred();
  const h = add({ put: async () => gate.promise });
  const saving = h.addFont()();
  await turn();
  h.dispose();
  const other = { name: 'Other', fileName: 'other.woff2', path: '/userfonts/other.woff2' };
  h.fonts.next([other]);
  gate.resolve();
  await saving;
  assert.deepEqual(h.fonts.getValue(), [other, selected]);
  assert.deepEqual(h.events, []);
});

test('settings scenarios execute the active React controllers and stop revision delivery on teardown', async () => {
  const h = size();
  assert.match(h.sourcePath, /settings-react\/settings-dimension-content-controller\.ts$/);
  assert.equal(h.controller.constructor.name, 'ReaderController');
  let revisions = 0;
  h.controller.subscribe(() => revisions++);
  await h.mount();
  await turn();
  assert.ok(revisions > 0);
  const before = revisions;
  h.set.dimensionValue(190);
  h.dispose();
  h.dispose();
  await turn();
  assert.equal(revisions, before);
  assert.equal(h.controller.disposed, true);
});

test('font save publishes one saved event and clears the mounted form only after cache success', async () => {
  const gate = deferred();
  const h = add({ put: async () => gate.promise });
  await h.mount();
  const saving = h.addFont()();
  await turn();
  assert.equal(h.isLoading(), true);
  assert.equal(h.fontName(), 'Custom');
  assert.equal(h.fontFile(), aFile);
  assert.deepEqual(h.events, []);
  gate.resolve();
  await saving;
  assert.equal(h.fontName(), '');
  assert.equal(h.fontFile(), undefined);
  assert.equal(h.instance.fileElement.value, '');
  assert.equal(h.isLoading(), false);
  assert.deepEqual(h.events, [['saved']]);
  h.dispose();
});

test('destroying a font manager releases its real catalogue subscription and ignores a late cache listing', async () => {
  const gate = deferred();
  const h = manager({ keys: async () => gate.promise });
  assert.equal(h.fonts.observers.length, 1);
  await h.mount();
  await turn();
  h.dispose();
  h.dispose();
  assert.equal(h.fonts.observers.length, 0);
  gate.resolve([new Request('https://reader.example' + selected.path)]);
  await turn();
  assert.equal(h.instance.fontCache, undefined);
  assert.equal(h.cacheLoaded(), false);
  assert.deepEqual([...h.instance.availablePaths], []);
  assert.deepEqual(h.fonts.getValue(), [selected]);
  assert.deepEqual(h.events, []);
});

test('only the newest font cache load may publish its cache and file list', async () => {
  const gate = deferred();
  const staleCache = { keys: async () => gate.promise };
  const currentCache = {
    keys: async () => [new Request('https://reader.example/userfonts/current.ttf')]
  };
  let opens = 0;
  const h = manager(staleCache, 'YuKyokasho', [selected], {
    caches: { open: async () => (++opens === 1 ? staleCache : currentCache) }
  });
  await h.mount();
  await turn();
  await h.instance.loadCache();
  gate.resolve([new Request('https://reader.example/userfonts/stale.ttf')]);
  await turn();
  assert.equal(h.instance.fontCache, currentCache);
  assert.deepEqual([...h.instance.availablePaths], ['/userfonts/current.ttf']);
  assert.equal(h.cacheLoaded(), true);
  assert.deepEqual(h.fonts.getValue(), [selected]);
  h.dispose();
});

test('cache opening failure keeps font metadata and exposes a retryable error', async () => {
  const h = manager({}, 'YuKyokasho', [selected], {
    caches: {
      open: async () => {
        throw new Error('Cache denied');
      }
    }
  });
  await h.mount();
  await turn();
  assert.equal(h.cacheLoaded(), true);
  assert.equal(h.instance.error, 'Cache denied');
  assert.equal(h.instance.fontCache, undefined);
  assert.deepEqual(h.$userFonts$(), [selected]);
  h.dispose();
});

for (const interruption of ['dismissal', 'family change']) {
  test(`font selection cannot publish after ${interruption} while its cache lookup is pending`, async () => {
    const gate = deferred();
    const h = manager({
      keys: async () => [new Request('https://reader.example' + selected.path)],
      match: async () => gate.promise
    });
    await h.mount();
    await turn();
    const selecting = h.instance.selectFont(selected);
    if (interruption === 'dismissal') h.dispose();
    else
      h.instance.updateProps({
        fontFamily: { next: () => assert.fail('Retargeted font selection') }
      });
    gate.resolve(new Response('font bytes'));
    await selecting;
    assert.equal(h.family(), 'YuKyokasho');
    assert.deepEqual(h.events, []);
    h.dispose();
  });
}

test('a duplicate font removal stays single-flight and retains a concurrent replacement entry', async () => {
  const gate = deferred();
  let deletes = 0;
  const h = manager(
    {
      keys: async () => [new Request('https://reader.example' + selected.path)],
      delete: async () => {
        deletes++;
        await gate.promise;
        return true;
      }
    },
    'Custom'
  );
  await h.mount();
  await turn();
  const first = h.removeFont()(selected.path);
  const second = h.removeFont()(selected.path);
  await turn();
  const replacement = { ...selected, name: 'Replacement' };
  h.fonts.next([replacement]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(deletes, 1);
  assert.deepEqual(h.fonts.getValue(), [replacement]);
  assert.equal(h.family(), 'Custom');
  assert.equal(h.instance.isLoading, false);
  h.dispose();
});

test('an explicit pending font removal owns the original family and live catalogue after dismissal', async () => {
  const gate = deferred();
  const h = manager(
    {
      keys: async () => [new Request('https://reader.example' + selected.path)],
      delete: async () => {
        await gate.promise;
        return true;
      }
    },
    'Custom'
  );
  await h.mount();
  await turn();
  const removing = h.removeFont()(selected.path);
  await turn();
  h.instance.updateProps({
    fontFamily: { next: () => assert.fail('Removal reset a different style') }
  });
  h.dispose();
  const other = { name: 'Other', fileName: 'other.ttf', path: '/userfonts/other.ttf' };
  h.fonts.next([selected, other]);
  gate.resolve();
  await removing;
  assert.deepEqual(h.fonts.getValue(), [other]);
  assert.equal(h.family(), '');
  assert.equal(h.fonts.observers.length, 0);
  assert.deepEqual(h.events, []);
});
