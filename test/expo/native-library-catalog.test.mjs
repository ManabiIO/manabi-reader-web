/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const output = mkdtempSync(join(tmpdir(), 'native-catalog-'));
const require = createRequire(import.meta.url);
function bundle(path) {
  const outfile = join(output, `${path.split('/').at(-1)}.cjs`);
  buildSync({
    entryPoints: [resolve(`apps/web/src/${path}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  return require(outfile);
}
const { NativeCatalogService } = bundle('native-library/catalog-service');
const { NativeCatalogController } = bundle('native-library/catalog-controller');
const { NativeReaderNavigation } = bundle('platform/native-reader-navigation');
const { BridgeAuthority } = bundle('platform/bridge-contract');
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const identity = {
  bookId: 7,
  contentHash: 'a'.repeat(64),
  readerBookKey: `content:${'a'.repeat(64)}`,
  title: 'Saved title',
  lastBookModified: 1
};
const pick = {
  id: 'https://server.test/private-id',
  title: 'Title',
  author: 'Author',
  summary: '<p>Plain summary</p>',
  bookUrl: 'https://manabi.io/static/reader/books/library/book.epub',
  coverUrl: 'https://manabi.io/static/reader/books/opds/covers/book.jpg'
};
function guard() {
  const controller = new AbortController();
  let generation = 0;
  const admitted = generation;
  return {
    key: 'session-a:0',
    signal: controller.signal,
    assertCurrent() {
      if (generation !== admitted) throw new Error('owner ABA');
    },
    abort: () => controller.abort(),
    aba: () => {
      generation += 2;
    }
  };
}
function fixture(overrides = {}) {
  let serial = 0,
    now = 0,
    preparations = 0;
  const service = new NativeCatalogService(
    {
      load: async () => [pick],
      prepare: async () => {
        preparations++;
        return identity;
      },
      ...overrides
    },
    () => `opaque_${++serial}`,
    () => now
  );
  return {
    service,
    authority: guard(),
    preparations: () => preparations,
    advance: () => {
      now = 600001;
    }
  };
}
async function ready(f) {
  const state = f.service.start({}, f.authority);
  await tick();
  return f.service.read({ token: state.token }, f.authority);
}

test('catalog sends only bounded plain metadata and opaque DOM item handles, with bounded paging', async () => {
  const f = fixture({
    load: async () =>
      Array.from({ length: 45 }, () => ({
        ...pick,
        title: '界'.repeat(9000),
        author: 'a'.repeat(9000),
        summary: '<script>text</script>' + 'b'.repeat(9000)
      }))
  });
  try {
    const state = await ready(f);
    assert.equal(state.items.length, 20);
    assert.equal(state.total, 45);
    assert.deepEqual(Object.keys(state.items[0]).sort(), ['author', 'key', 'summary', 'title']);
    assert.equal(state.items[0].title.length, 1000);
    assert.equal(state.items[0].summary.length, 2000);
    assert.doesNotMatch(JSON.stringify(state), /https:|bookUrl|coverUrl|<script>/);
    assert.equal(f.service.read({ token: state.token, offset: 40 }, f.authority).items.length, 5);
    for (const payload of [
      { token: state.token, offset: -1 },
      { token: state.token, offset: 1.5 },
      { token: state.token, offset: 1001 },
      { token: state.token, url: pick.bookUrl }
    ])
      assert.throws(() => f.service.read(payload, f.authority));
    assert.throws(() => f.service.start({ origin: 'https://evil.test' }, f.authority));
  } finally {
    f.service.dispose();
  }
});

test('one-use catalog Open rejects duplicate activation and forged URL/identifier fields before importer', async () => {
  const wait = deferred();
  let calls = 0;
  const f = fixture({
    prepare: async (selected) => {
      calls++;
      assert.deepEqual(selected, pick);
      await wait.promise;
      return identity;
    }
  });
  try {
    const state = await ready(f),
      payload = { token: state.token, key: state.items[0].key };
    await assert.rejects(f.service.open({ ...payload, bookUrl: 'https://evil.test' }, f.authority));
    await assert.rejects(f.service.open({ ...payload, key: pick.id }, f.authority));
    const first = f.service.open(payload, f.authority);
    await assert.rejects(f.service.open(payload, f.authority), /expired/);
    assert.equal(calls, 1);
    wait.resolve();
    const admitted = await first;
    assert.deepEqual(admitted.identity, identity);
    admitted.assertCurrent();
  } finally {
    f.service.dispose();
  }
});

test('catalog cancel aborts held download/import and late results cannot admit a reader or free another import', async () => {
  const wait = deferred();
  let oldSignal;
  const f = fixture({
    prepare: async (_pick, authority) => {
      oldSignal = authority.signal;
      await wait.promise;
      return identity;
    }
  });
  try {
    const state = await ready(f);
    const opening = f.service.open({ token: state.token, key: state.items[0].key }, f.authority);
    f.service.cancel({ token: state.token }, f.authority);
    assert.equal(oldSignal.aborted, true);
    const next = await ready(f);
    await assert.rejects(
      f.service.open({ token: next.token, key: next.items[0].key }, f.authority),
      /still settling/
    );
    f.service.cancel({ token: state.token }, f.authority);
    assert.equal(f.service.read({ token: next.token }, f.authority).token, next.token);
    wait.resolve();
    await assert.rejects(opening, /could not be opened/);
    const result = await f.service.open({ token: next.token, key: next.items[0].key }, f.authority);
    assert.equal(result.identity.bookId, 7);
  } finally {
    f.service.dispose();
  }
});

test('captured account generation rejects A→B→A even when profile key returns, and lifetime abort revokes load', async () => {
  const wait = deferred();
  const f = fixture({
    prepare: async () => {
      await wait.promise;
      return identity;
    }
  });
  try {
    const state = await ready(f),
      opening = f.service.open({ token: state.token, key: state.items[0].key }, f.authority);
    f.authority.aba();
    wait.resolve();
    await assert.rejects(opening, /could not be opened/);
    assert.throws(() => f.service.read({ token: state.token }, f.authority), /ABA/);
  } finally {
    f.service.dispose();
  }
  const load = deferred(),
    g = fixture({ load: () => load.promise });
  const state = g.service.start({}, g.authority);
  g.authority.abort();
  load.resolve([pick]);
  await tick();
  assert.throws(() => g.service.read({ token: state.token }, g.authority));
  g.service.dispose();
});

test('expiry, catalog replacement, and cancellation after import settlement invalidate retained reader admission', async () => {
  for (const retire of [
    (f, s) => f.service.cancel({ token: s.token }, f.authority),
    (f) => f.advance(),
    (f) => f.service.start({}, f.authority)
  ]) {
    const f = fixture();
    try {
      const state = await ready(f),
        result = await f.service.open({ token: state.token, key: state.items[0].key }, f.authority);
      retire(f, state);
      assert.throws(result.assertCurrent);
      await assert.rejects(
        f.service.open({ token: state.token, key: state.items[0].key }, f.authority)
      );
    } finally {
      f.service.dispose();
    }
  }
});

test('failed public load stays retryable and never publishes upstream URLs/errors', async () => {
  const f = fixture({
    load: async () => {
      throw new Error('https://secret.test/provider?token=secret');
    }
  });
  try {
    const state = await ready(f);
    assert.equal(state.status, 'error');
    assert.deepEqual(state.items, []);
    assert.doesNotMatch(JSON.stringify(state), /secret|provider/);
    f.service.start({}, f.authority);
    await tick();
  } finally {
    f.service.dispose();
  }
});

const screen = (token = 'catalog_token') => ({
  token,
  status: 'ready',
  items: [{ key: 'item_token', title: 'Book', author: '', summary: '' }],
  total: 1,
  offset: 0,
  limit: 20
});
test('native controller coalesces same-turn Open, relinquishes cleanup only on acknowledged navigation', async () => {
  const wait = deferred(),
    calls = [],
    routes = [];
  const controller = new NativeCatalogController(
    async (method, payload) => {
      calls.push([method, payload]);
      return method === 'library.catalog.open' ? wait.promise : screen();
    },
    () => {}
  );
  await controller.start();
  const opening = controller.open('item_token', (id) => routes.push(id));
  await controller.open('item_token', (id) => routes.push(id));
  assert.equal(calls.filter(([method]) => method === 'library.catalog.open').length, 1);
  wait.resolve({ bookId: 7 });
  await opening;
  assert.deepEqual(routes, [7]);
  controller.dispose();
  assert.equal(calls.filter(([method]) => method === 'library.catalog.cancel').length, 0);
});

test('native cancellation before/after import completion and late start replies never navigate or cancel a newer token', async () => {
  for (const completeFirst of [false, true]) {
    const wait = deferred(),
      calls = [],
      routes = [];
    const controller = new NativeCatalogController(
      async (method, payload) => {
        calls.push([method, payload]);
        return method === 'library.catalog.open' ? wait.promise : screen();
      },
      () => {}
    );
    await controller.start();
    const opening = controller.open('item_token', (id) => routes.push(id));
    if (completeFirst) wait.resolve({ bookId: 7 });
    controller.dispose();
    wait.resolve({ bookId: 7 });
    await opening;
    assert.deepEqual(routes, []);
    assert.deepEqual(calls.at(-1), ['library.catalog.cancel', { token: 'catalog_token' }]);
  }
  const wait = deferred(),
    cancelled = [];
  let count = 0;
  const controller = new NativeCatalogController(
    async (method, payload) => {
      if (method === 'library.catalog.cancel') {
        cancelled.push(payload.token);
        return;
      }
      return ++count === 1 ? wait.promise : screen('new_token');
    },
    () => {}
  );
  const old = controller.start();
  await controller.start();
  wait.resolve(screen('old_token'));
  await old;
  assert.equal(controller.state.result.token, 'new_token');
  assert.deepEqual(cancelled, ['old_token']);
  controller.dispose();
});

test('unknown catalog outcome asks to reconcile saved Library and never retries Open', async () => {
  let opens = 0;
  const controller = new NativeCatalogController(
    async (method) => {
      if (method === 'library.catalog.open') {
        opens++;
        throw new Error('lost acknowledgment');
      }
      return screen();
    },
    () => {}
  );
  await controller.start();
  await controller.open('item_token', () => assert.fail('must not navigate'));
  assert.equal(opens, 1);
  assert.match(controller.state.error, /copy may already be saved.*Refresh the Library/);
  assert.equal(controller.state.result, undefined);
  controller.dispose();
});

test('canonical native catalog admission handles Back, newer route, hidden cancellation and account ABA without reopening by ID', async () => {
  for (const action of ['back', 'route', 'cancel', 'account']) {
    const wait = deferred(),
      calls = [],
      replacements = [];
    const nav = new NativeReaderNavigation(
      async (method, payload) => {
        calls.push([method, payload]);
        return method === 'library.catalog.open'
          ? wait.promise
          : { allowed: true, destination: '/manage' };
      },
      (path) => replacements.push(path),
      () => {}
    );
    nav.setScope({ session: 'session_a', epoch: 0 });
    const opening = nav.readCatalog({ token: 'catalog_token', key: 'item_token' });
    await tick();
    const failed = assert.rejects(opening, /cancelled/);
    if (action === 'back') await nav.close();
    if (action === 'route') await nav.route('/snippets', {});
    if (action === 'cancel') await nav.cancelCatalog('catalog_token', false);
    if (action === 'account') {
      nav.setScope({ session: 'session_a', epoch: 1 });
      nav.setScope({ session: 'session_a', epoch: 2 });
    }
    wait.resolve({ bookId: 7 });
    await failed;
    assert.equal(nav.state.visible, false);
    assert.equal(nav.state.identity, undefined);
    assert.deepEqual(replacements, []);
    assert.equal(calls.filter(([method]) => method === 'open').length, 0);
    nav.dispose();
  }
  const calls = [];
  const nav = new NativeReaderNavigation(
    async (method) => {
      calls.push(method);
      return { bookId: 7 };
    },
    () => {},
    () => {}
  );
  nav.setScope({ session: 'session_a', epoch: 0 });
  await nav.readCatalog({ token: 'catalog_token', key: 'item_token' });
  await nav.route('/b', { id: '7' });
  assert.equal(nav.state.visible, true);
  await nav.cancelCatalog('old_token', false);
  await nav.cancelCatalog('catalog_token', true);
  assert.deepEqual(calls, ['library.catalog.open']);
  nav.dispose();
});

test('bridge permanently receipts catalog mutations; read identities cannot authorize download/import', async () => {
  let calls = 0;
  const lifetime = new AbortController();
  const authority = new BridgeAuthority(
    () => ({ session: 'session_a', epoch: 0 }),
    async () => {
      calls++;
      return { cancelled: true };
    },
    lifetime.signal
  );
  const request = {
    version: 1,
    session: 'session_a',
    epoch: 0,
    id: 'command_cancel_1',
    method: 'library.catalog.cancel',
    payload: { token: 'old_token' }
  };
  await authority.request(request);
  await authority.request(request);
  assert.equal(calls, 1);
  const changed = await authority.request({ ...request, payload: { token: 'new_token' } });
  assert.equal(changed.outcome, 'not-started');
  await assert.rejects(
    authority.request({ ...request, id: 'read_open_1', method: 'library.catalog.open' }),
    /Read-only/
  );
});

test('integrated host retains canonical identity, operation lifetime and local import locking; native owns controls', () => {
  const host = readFileSync('apps/web/src/platform/reader-runtime.dom.tsx', 'utf8');
  const branch = host.slice(
    host.indexOf("case 'library.catalog.open':"),
    host.indexOf("case 'library.content.start':")
  );
  assert.match(branch, /state\.bookImport \|\| state\.transfer\.active \|\| state\.coverSave/);
  assert.match(branch, /selected\.assertCurrent\(\)/);
  assert.match(branch, /admission !== state\.openSequence/);
  assert.match(branch, /setExpectedBook\(selected\.identity\)/);
  assert.match(branch, /stop: operation\.stop/);
  assert.match(host, /catalog\.cancel\(\{ token: payload\.catalogToken \}, libraryAuthority\)/);
  assert.equal((host.match(/catalog\.dispose\(\)/g) ?? []).length, 2);
  const native = readFileSync('apps/web/src/native-library/catalog.tsx', 'utf8');
  assert.match(native, /from 'react-native'/);
  assert.match(native, /AppState\.addEventListener/);
  assert.doesNotMatch(native, /WebView|loadEditorsPicks|downloadEditorsPick|bookUrl|fetch\(/);
});

test('lost catalog acknowledgement retains its exact hidden-reader close obligation without replaying import', async () => {
  const calls = [];
  const nav = new NativeReaderNavigation(
    async (method, payload) => {
      calls.push([method, payload]);
      if (method === 'library.catalog.open') throw new Error('unknown acknowledgement');
      return { allowed: true, destination: '/manage' };
    },
    () => {},
    () => {}
  );
  nav.setScope({ session: 'session_a', epoch: 0 });
  await assert.rejects(nav.readCatalog({ token: 'unknown_catalog', key: 'item_token' }), /unknown/);
  assert.equal(nav.state.pending, false);
  await nav.cancelCatalog('other_catalog', false);
  assert.equal(calls.length, 1);
  await nav.cancelCatalog('unknown_catalog', false);
  assert.deepEqual(calls.at(-1), ['close', { catalogToken: 'unknown_catalog' }]);
  await nav.cancelCatalog('unknown_catalog', false);
  assert.equal(calls.length, 2);
  nav.dispose();
});
