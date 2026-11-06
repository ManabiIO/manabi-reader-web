/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import pLimit from 'p-limit';
import { getEventListeners } from 'node:events';
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
  const { api, context } = loadOfflineModule(`apps/web/src/lib/data/storage/handler/${file}.ts`, {
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
  return { handler, context, cloud, calls, uploads, snapshot: () => JSON.stringify(cloud) };
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

for (const provider of ['google', 'onedrive']) {
  for (const malformed of [null, {}, { files: null, value: null }])
    test(`${provider}: malformed discovery cannot authorize export`, async () => {
      const f = fixture(provider);
      const original = f.handler.request;
      f.handler.request = async (href, options) =>
        !options?.method || options.method === 'GET' ? malformed : original(href, options);
      f.handler.readingGoalsMergeMode = 'replace';
      await assert.rejects(f.handler.saveReadingGoals([], 123), /malformed/i);
      assert.deepEqual(
        f.calls.filter((call) => call.mutation),
        []
      );
      assert.equal(f.uploads.length, 0);
    });
  test(`${provider}: cancellation during discovery cannot authorize folder creation`, async () => {
    const f = fixture(provider),
      cancel = new AbortController();
    f.handler.cancelSignal = cancel.signal;
    f.handler.request = async () => {
      cancel.abort();
      return provider === 'google' ? { files: [] } : { value: [] };
    };
    f.handler.readingGoalsMergeMode = 'replace';
    await assert.rejects(f.handler.saveReadingGoals([], 123), { name: 'AbortError' });
    assert.equal(f.uploads.length, 0);
  });
}

test('google: direct file discovery requests and follows continuation fields', async () => {
  const f = fixture('google', [folder('library', rootName), folder('book', 'Book', 'library')]);
  const request = f.handler.request;
  f.handler.request = async (href, ...args) => {
    const url = new URL(href);
    if (!url.searchParams.get('q')?.includes("'book' in parents")) return request(href, ...args);
    assert.ok(url.searchParams.get('fields').includes('nextPageToken'));
    return url.searchParams.has('pageToken')
      ? { files: [{ id: 'progress', name: 'progress_1_8_2_3.json', parents: ['book'] }] }
      : { files: [], nextPageToken: 'second' };
  };
  assert.equal((await f.handler.getExternalFile('progress_')).file.id, 'progress');
});

for (const failure of ['missing', 'duplicate', 'body', 'status'])
  test(`onedrive: invalid ${failure} batch response leaves discovery retryable`, async () => {
    const f = fixture('onedrive', [folder('library', rootName), folder('book', 'Book', 'library')]);
    const request = f.handler.request;
    f.handler.request = async (href, ...args) => {
      const response = await request(href, ...args);
      if (!href.endsWith('/$batch')) return response;
      if (failure === 'missing') response.responses = [];
      if (failure === 'duplicate') response.responses.push(response.responses[0]);
      if (failure === 'body') response.responses[0].body = {};
      if (failure === 'status') response.responses[0].status = undefined;
      return response;
    };
    await assert.rejects(f.handler.getBookList(), /batch|malformed/i);
    assert.equal(f.handler.dataListFetched, false);
    assert.equal(f.handler.titleToFiles.size, 0);
  });

test('onedrive: batch child pagination preserves projected file rows', async () => {
  const f = fixture('onedrive', [folder('library', rootName), folder('book', 'Book', 'library')]);
  const request = f.handler.request;
  f.handler.request = async (href, ...args) => {
    if (href === 'https://graph.microsoft.com/next')
      return { value: [{ id: 'progress', name: 'progress_1_8_2_3.json' }] };
    const response = await request(href, ...args);
    if (href.endsWith('/$batch'))
      response.responses[0].body = {
        value: [{ id: 'book-data', name: 'bookdata_1_8_10_20_0.zip' }],
        '@odata.nextLink': 'https://graph.microsoft.com/next'
      };
    return response;
  };
  f.handler.cacheStorageData = true;
  await f.handler.getBookList();
  assert.equal((await f.handler.getExternalFile('progress_')).file.id, 'progress');
});

function xhrFixture() {
  const f = fixture('google'),
    requests = [],
    started = Promise.withResolvers();
  class Request extends EventTarget {
    readyState = 0;
    upload = {};
    aborts = 0;
    open(method, url) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader() {}
    send(body) {
      this.body = body;
      requests.push(this);
      started.resolve(this);
    }
    abort() {
      this.aborts++;
    } // UNSENT/quiet transports need not emit abort.
    complete(response, status = 200) {
      this.response = response;
      this.status = status;
      this.readyState = 4;
      this.dispatchEvent(new Event('readystatechange'));
    }
  }
  f.context.XMLHttpRequest = Request;
  f.handler.authManager = { getToken: async () => 'token' };
  f.handler.request = Object.getPrototypeOf(Object.getPrototypeOf(f.handler)).request;
  return { ...f, requests, started: started.promise };
}

async function startRequest(f, options) {
  const request = f.handler.request('https://www.googleapis.com/drive/v3/files', options);
  // Wait for dispatch across the actual VM/authentication promise boundary.
  await Promise.race([
    f.started,
    request.then(() => {
      throw new Error('Request finished before dispatch');
    })
  ]);
  assert.equal(f.requests.length, 1);
  return { request, xhr: f.requests[0] };
}

test('cloud transport: cancellation during authentication cannot start an obsolete request', async () => {
  const f = xhrFixture(),
    old = new AbortController(),
    next = new AbortController();
  let authenticated;
  f.handler.authManager = {
    getToken: () =>
      new Promise((resolve) => {
        authenticated = resolve;
      })
  };
  f.handler.cancelSignal = old.signal;
  const pending = f.handler.request('https://www.googleapis.com/drive/v3/files');
  f.handler.cancelSignal = next.signal;
  old.abort();
  authenticated('token');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
});

for (const options of [{}, { trackDownload: true }, { trackUpload: true }])
  test(`cloud transport: cancellation stops ${Object.keys(options)[0] ?? 'metadata'} requests without progress events`, async () => {
    const f = xhrFixture(),
      old = new AbortController(),
      next = new AbortController();
    f.handler.cancelSignal = old.signal;
    const { request, xhr } = await startRequest(f, options);
    f.handler.cancelSignal = next.signal;
    old.abort();
    assert.equal(xhr.aborts, 1);
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(getEventListeners(old.signal, 'abort').length, 0);
    assert.equal(next.signal.aborted, false);
  });

test('cloud transport: success removes the abort listener and later cancellation leaves completed I/O alone', async () => {
  const f = xhrFixture(),
    cancel = new AbortController();
  f.handler.cancelSignal = cancel.signal;
  const { request, xhr } = await startRequest(f);
  xhr.complete({ files: [] });
  assert.deepEqual(await request, { files: [] });
  assert.equal(getEventListeners(cancel.signal, 'abort').length, 0);
  cancel.abort();
  assert.equal(xhr.aborts, 0);
});

test('cloud context: releasing a finished canceled operation allows a later library read', async () => {
  const f = fixture('google'),
    cancel = new AbortController();
  const release = f.handler.startContext({ title: 'Book' }, cancel.signal);
  cancel.abort();
  await assert.rejects(f.handler.getBookList(), { name: 'AbortError' });
  release();
  assert.deepEqual(Array.from(await f.handler.getBookList()), []);
  assert.deepEqual(
    f.calls.filter((call) => call.mutation),
    []
  );
});

test('cloud context: obsolete cleanup cannot release a newer context with the same signal', () => {
  const f = fixture('google'),
    cancel = new AbortController();
  const old = f.handler.startContext({ title: 'Old' }, cancel.signal);
  const next = f.handler.startContext({ title: 'New' }, cancel.signal);
  old();
  assert.equal(f.handler.cancelSignal, cancel.signal);
  next();
  assert.equal(f.handler.cancelSignal, undefined);
});

test('google: goals discovery includes later pages before choosing the existing file', async () => {
  const f = fixture('google', [folder('library', rootName)]),
    request = f.handler.request;
  f.handler.request = async (href, ...args) => {
    const url = new URL(href);
    if (!url.searchParams.get('q')?.includes("mimeType!='application/vnd.google-apps.folder'"))
      return request(href, ...args);
    assert.ok(url.searchParams.get('fields').includes('nextPageToken'));
    return url.searchParams.has('pageToken')
      ? { files: [{ id: 'existing-goals', name: 'ttu-user-goals_1_8_123.json' }] }
      : { files: [], nextPageToken: 'goals-page-2' };
  };
  assert.equal((await f.handler.getRootFile('ttu-user-goals_')).file.id, 'existing-goals');
  assert.equal(f.uploads.length, 0);
});

for (const provider of ['google', 'onedrive'])
  test(`${provider}: a repeated continuation cannot complete or authorize export`, async () => {
    const f = fixture(provider);
    let calls = 0;
    f.handler.request = async () => {
      calls++;
      assert.ok(calls < 5, 'Continuation cycles must be bounded');
      return provider === 'google'
        ? { files: [], nextPageToken: 'same' }
        : { value: [], '@odata.nextLink': 'https://graph.microsoft.com/next' };
    };
    f.handler.readingGoalsMergeMode = 'replace';
    await assert.rejects(f.handler.saveReadingGoals([], 123), /repeated/i);
    assert.equal(f.uploads.length, 0);
  });

test('cloud transport: an already-cancelled context never asks for credentials', async () => {
  const f = xhrFixture(),
    cancel = new AbortController();
  f.handler.authManager = {
    getToken: () => {
      assert.fail('Canceled work must not request authentication');
    }
  };
  f.handler.cancelSignal = cancel.signal;
  cancel.abort();
  await assert.rejects(f.handler.request('https://www.googleapis.com/drive/v3/files'), {
    name: 'AbortError'
  });
  assert.equal(f.requests.length, 0);
});
