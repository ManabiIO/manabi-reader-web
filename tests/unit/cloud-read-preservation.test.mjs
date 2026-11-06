/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import pLimit from 'p-limit';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

const rootName = 'ttu-reader-data';
const folder = (id, name, parent = 'root') => ({
  id,
  name,
  parents: [parent],
  mimeType: 'application/vnd.google-apps.folder',
  folder: {},
  privateProperty: { untouched: true }
});
const unrelated = {
  id: 'unrelated-file',
  name: 'personal.json',
  parents: ['root'],
  file: {},
  mimeType: 'application/json',
  body: '{"keep":"exact original bytes"}',
  version: '987',
  permissions: ['unchanged'],
  privateProperty: { nested: [1, 2] }
};

/** Execute the real provider, API and base-handler modules. Only OAuth,
 * database/app observers, archive decoding and HTTP transport are boundaries.
 * The stateful provider applies attempted folder mutations, rather than merely
 * rejecting them, so adding a source must preserve the complete cloud state. */
function fixture(provider, initial = [unrelated]) {
  const cloud = structuredClone(initial),
    calls = [],
    uploads = [];
  const observer = { next() {} };
  const modules = {
    '$lib/data/env': {
      ttuCompatibilityRootName: rootName,
      gDriveRefreshEndpoint: '',
      oneDriveTokenEndpoint: ''
    },
    '$lib/data/logger': { logger: { warn() {}, error() {} } },
    '$lib/data/store': {
      database: { listLoading$: observer, dataListChanged$: observer },
      gDriveStorageSource$: { getValue: () => '' },
      oneDriveStorageSource$: { getValue: () => '' }
    },
    '$lib/data/reading-goal': {},
    '$lib/data/storage/storage-handler-factory': {
      getStorageHandler() {
        assert.fail('No other storage source may be used');
      }
    },
    '$lib/data/storage/storage-oauth-manager': { StorageOAuthManager: class {} },
    '$lib/functions/replication/error-handler': {
      handleErrorDuringReplication(error) {
        throw error;
      }
    },
    '$lib/functions/replication/replicator': { exporterVersion: 1 },
    '$lib/functions/replication/replication-progress': { replicationProgress$: observer },
    '$lib/functions/statistic-util': {},
    '$lib/manabi/external-book-data': { getExternalBookData: async () => undefined },
    '$lib/functions/file-loaders/utils/restored-book': {
      readRestoredBook() {
        assert.fail('No archive should be decoded');
      }
    },
    '@zip.js/zip.js': {},
    'p-limit': pLimit
  };
  const file = provider === 'google' ? 'gdrive-handler' : 'onedrive-handler';
  const { api } = loadOfflineModule(`apps/web/src/lib/data/storage/handler/${file}.ts`, {
    modules,
    globals: { URLSearchParams, FormData, File }
  });
  const Type = provider === 'google' ? api.GDriveStorageHandler : api.OneDriveStorageHandler;
  const handler = new Type({});
  handler.currentContext = { title: 'Book' };
  const children = (parent) => cloud.filter((row) => row.parents.includes(parent));
  handler.request = async (href, options = {}) => {
    const url = new URL(href),
      method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { method, href, body, mutation: method !== 'GET' };
    calls.push(call);
    if (url.pathname.endsWith('/$batch')) {
      assert.ok(body.requests.every((request) => request.method === 'GET'));
      call.mutation = false;
      return {
        responses: body.requests.map((request) => ({
          id: request.id,
          status: 200,
          body: {
            value: structuredClone(children(request.url.match(/items\/([^/]+)\/children/)[1]))
          }
        }))
      };
    }
    if (method === 'POST') {
      const parent =
        provider === 'google' ? body.parents[0] : url.pathname.match(/items\/([^/]+)\/children/)[1];
      const row = folder(`created-${cloud.length}`, body.name, parent);
      cloud.push(row);
      return structuredClone(row);
    }
    assert.equal(method, 'GET', 'These operations must never patch or delete cloud files');
    if (provider === 'google') {
      const q = url.searchParams.get('q');
      assert.ok(q, 'Every listing must retain its parent query');
      const parent = q.match(/'([^']+)' in parents/)[1];
      const name = q.match(/name = "([^"]+)"/)?.[1];
      const rows = children(parent).filter(
        (row) =>
          (!name || row.name === name) &&
          (!q.includes("mimeType='application/vnd.google-apps.folder'") || row.folder)
      );
      return { files: structuredClone(rows) };
    }
    const parent = url.pathname.match(/items\/([^/]+)\/children/)[1];
    const filter = url.searchParams.get('filter');
    const name = filter?.match(/name eq '([^']+)'/)?.[1];
    return {
      value: structuredClone(
        children(parent).filter(
          (row) => (!name || row.name === name) && (filter !== 'folder ne null' || row.folder)
        )
      )
    };
  };
  handler.upload = async (...args) => {
    uploads.push(args);
    return { id: 'explicit-upload' };
  };
  return { handler, cloud, calls, uploads, snapshot: () => JSON.stringify(cloud) };
}

const reads = [
  ['library listing', (h) => h.getBookList()],
  ['book read', (h) => h.getBook()],
  ['progress read', (h) => h.getProgress()],
  ['statistics read', (h) => h.getStatistics()],
  ['cover read', (h) => h.getCover()],
  ['reading goals read', (h) => h.getReadingGoals()],
  ['progress existence check', (h) => h.isProgressPresentAndUpToDate(undefined)],
  ['root file read', (h) => h.getRootFile('ttu-user-goals_')],
  ['delete from absent library', (h) => h.deleteBookData(['Book'], new AbortController().signal)]
];
for (const provider of ['google', 'onedrive']) {
  for (const [label, read] of reads)
    test(`${provider}: ${label} preserves a missing cloud library`, async () => {
      const f = fixture(provider),
        before = f.snapshot();
      await read(f.handler);
      assert.equal(
        f.snapshot(),
        before,
        'Reading must preserve all remote bytes, metadata and identities'
      );
      assert.deepEqual(
        f.calls.filter((call) => call.mutation),
        [],
        'A read must not even attempt a provider mutation'
      );
      assert.equal(f.uploads.length, 0);
    });
  test(`${provider}: existing library and missing book reads preserve unrelated cloud data`, async () => {
    const f = fixture(provider, [
      unrelated,
      folder('library', rootName),
      folder('existing-book', 'Existing Book', 'library'),
      {
        id: 'book-data',
        name: 'bookdata_1_8_10_20_0.zip',
        parents: ['existing-book'],
        file: {},
        body: 'original archive',
        version: '18'
      }
    ]);
    const before = f.snapshot();
    const books = await f.handler.getBookList();
    assert.equal(books.length, 1);
    assert.equal(books[0].title, 'Existing Book');
    assert.equal(await f.handler.getProgress(), undefined);
    assert.equal(f.snapshot(), before);
    assert.deepEqual(
      f.calls.filter((call) => call.mutation),
      []
    );
  });
  test(`${provider}: an explicit goals export can create the library after an empty listing`, async () => {
    const f = fixture(provider),
      before = f.snapshot();
    await f.handler.getBookList();
    assert.equal(f.snapshot(), before);
    f.handler.readingGoalsMergeMode = 'replace';
    await f.handler.saveReadingGoals([], 123);
    assert.equal(f.calls.filter((call) => call.mutation).length, 1);
    assert.equal(f.cloud.length, 2);
    assert.equal(f.cloud[1].name, rootName);
    assert.equal(f.uploads.length, 1);
    assert.equal(f.uploads[0][0], f.cloud[1].id);
    assert.deepEqual(f.cloud[0], unrelated);
  });
  test(`${provider}: denied access is an error rather than an empty library or create instruction`, async () => {
    const f = fixture(provider),
      before = f.snapshot();
    const denied = new Error('Access denied');
    f.handler.request = async () => {
      throw denied;
    };
    await assert.rejects(f.handler.getBookList(), (error) => error === denied);
    assert.equal(f.snapshot(), before);
    assert.equal(f.uploads.length, 0);
  });
  test(`${provider}: a book named like the library root keeps its own folder identity`, async () => {
    for (const listFirst of [false, true]) {
      const f = fixture(provider, [
        unrelated,
        folder('library', rootName),
        folder('same-name-book', rootName, 'library'),
        {
          id: 'book-data',
          name: 'bookdata_1_8_10_20_0.zip',
          parents: ['same-name-book'],
          file: {},
          body: 'original archive',
          version: '18'
        }
      ]);
      const before = f.snapshot();
      f.handler.currentContext = { title: rootName };
      if (listFirst) await f.handler.getBookList();
      const read = await f.handler.getExternalFile('bookdata_');
      assert.equal(read.titleId, 'same-name-book');
      assert.equal(read.file.id, 'book-data');
      const write = await f.handler.getExternalFile('progress_', '', 1, false);
      assert.equal(write.titleId, 'same-name-book');
      assert.equal(f.handler.rootId, 'library');
      assert.equal(f.snapshot(), before);
      assert.deepEqual(
        f.calls.filter((call) => call.mutation),
        []
      );
    }
  });
  test(`${provider}: cancelled deletion never starts a cloud request`, async () => {
    const f = fixture(provider),
      cancel = new AbortController();
    cancel.abort();
    await assert.rejects(f.handler.deleteBookData(['Book'], cancel.signal), { name: 'AbortError' });
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.cloud, [unrelated]);
  });
  test(`${provider}: duplicate book titles cannot silently select one cloud folder`, async () => {
    const f = fixture(provider, [
      unrelated,
      folder('library', rootName),
      folder('book-a', 'Book', 'library'),
      folder('book-b', 'Boo%6B', 'library')
    ]);
    const before = f.snapshot();
    await assert.rejects(f.handler.getBookList(), /multiple|more than one|ambiguous/i);
    assert.equal(f.snapshot(), before);
    assert.deepEqual(
      f.calls.filter((call) => call.mutation),
      []
    );
  });
}

test('google: duplicate matching roots require review instead of choosing an arbitrary library', async () => {
  const f = fixture('google', [
    unrelated,
    folder('first-root', rootName),
    folder('second-root', rootName)
  ]);
  const before = f.snapshot();
  await assert.rejects(f.handler.getBookList(), /multiple|more than one|ambiguous/i);
  assert.equal(f.snapshot(), before);
  assert.deepEqual(
    f.calls.filter((call) => call.mutation),
    []
  );
});

for (const duplicate of [false, true])
  test(`google: root discovery follows partial pages${duplicate ? ' before rejecting duplicates' : ' to a unique root'}`, async () => {
    const f = fixture('google', [
      unrelated,
      folder('library', rootName),
      ...(duplicate ? [folder('second-library', rootName)] : [])
    ]);
    const before = f.snapshot(),
      request = f.handler.request;
    f.handler.request = async (href, ...args) => {
      const response = await request(href, ...args),
        url = new URL(href);
      if (!url.searchParams.get('q')?.includes(`name = "${rootName}"`)) return response;
      if (!url.searchParams.has('pageToken'))
        return { files: duplicate ? response.files.slice(0, 1) : [], nextPageToken: 'next' };
      assert.equal(url.searchParams.get('pageToken'), 'next');
      return { files: duplicate ? response.files.slice(1) : response.files };
    };
    if (duplicate)
      await assert.rejects(f.handler.getBookList(), /multiple|more than one|ambiguous/i);
    else {
      assert.deepEqual(Array.from(await f.handler.getBookList()), []);
      assert.equal(f.handler.rootId, 'library');
    }
    assert.equal(
      f.calls.filter((call) => new URL(call.href).searchParams.has('pageToken')).length,
      1
    );
    assert.equal(f.snapshot(), before);
    assert.deepEqual(
      f.calls.filter((call) => call.mutation),
      []
    );
  });

for (const provider of ['google', 'onedrive']) {
  for (const readOnly of [true, false])
    test(`${provider}: direct ${readOnly ? 'read' : 'export'} rejects decoded book aliases before listing`, async () => {
      const f = fixture(provider, [
        unrelated,
        folder('library', rootName),
        folder('book-a', 'Book', 'library'),
        folder('book-b', 'Boo%6B', 'library')
      ]);
      const before = f.snapshot();
      await assert.rejects(
        f.handler.getExternalFile('progress_', '', 1, readOnly),
        /multiple|more than one|ambiguous/i
      );
      assert.equal(f.snapshot(), before);
      assert.equal(f.uploads.length, 0);
      assert.deepEqual(
        f.calls.filter((call) => call.mutation),
        []
      );
    });
  test(`${provider}: direct lookup preserves a unique decoded book alias`, async () => {
    const f = fixture(provider, [
      unrelated,
      folder('library', rootName),
      folder('book-alias', 'Boo%6B', 'library')
    ]);
    const before = f.snapshot();
    const result = await f.handler.getExternalFile('progress_', '', 1, false);
    assert.equal(result.titleId, 'book-alias');
    assert.equal(f.snapshot(), before);
    assert.deepEqual(
      f.calls.filter((call) => call.mutation),
      []
    );
  });
}
