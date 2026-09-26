import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync, build } from 'esbuild';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
require('fake-indexeddb/auto');
const { openDB, deleteDB } = require('idb');
const client = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      transformSync(
        readFileSync(new URL('../../apps/web/src/lib/webdav/client.ts', import.meta.url), 'utf8'),
        { loader: 'ts', format: 'esm', target: 'es2022' }
      ).code
    ).toString('base64')
);

test('WebDAV roots reject plaintext nonloopback, credentials, traversal and unscoped queries', () => {
  assert.equal(client.davRoot('https://example.test/Books').href, 'https://example.test/Books/');
  assert.equal(client.davRoot('http://127.0.0.1:8000/Books/').hostname, '127.0.0.1');
  for (const root of [
    'http://nas.local/Books/',
    'https://user:pass@example.test/Books/',
    'https://example.test/Books?token=secret',
    'https://example.test/Books/#x',
    'https://example.test/Books/../secret',
    'https://example.test/Books/%2e%2e/',
    'https://example.test/Books/%252e%252e/',
    'https://example.test/Books/a%2fb/'
  ])
    assert.throws(() => client.davRoot(root), root);
  const root = client.davRoot('https://example.test/Books/');
  for (const href of [
    'https://evil.test/Books/a.epub',
    '/Bookstore/a.epub',
    '/private/a.epub',
    '../private',
    'a%2fb',
    'a\\b'
  ])
    assert.throws(() => client.davChild(root, href), href);
  assert.equal(client.davChild(root, '文.epub').href, 'https://example.test/Books/%E6%96%87.epub');
  assert.throws(() => new client.WebDavClient(root.href, 'u:ser', 'secret'));
});
test('WebDAV reads bound actual streamed bytes and cancel an oversized stream', async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        canceled = true;
      }
    })
  );
  await assert.rejects(client.limitedBytes(response, 10), /too large/);
  assert.equal(canceled, true);
  assert.equal(client.strongEtag('"abc"'), true);
  for (const etag of [null, 'W/"weak"', 'opaque', '"a\nb"'])
    assert.equal(client.strongEtag(etag), false);
  const bytes = await client.limitedBytes(new Response(new Uint8Array([1, 2, 3])), 3);
  assert.deepEqual([...bytes], [1, 2, 3]);
});
test('v9 upgrade adds local feature stores without replacing existing reading records', async () => {
  const result = await build({
    entryPoints: [
      new URL('../../apps/web/src/lib/data/database/books-db/factory.ts', import.meta.url).pathname
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false
  });
  const { createBooksDb } = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
  const name = 'local-features-v9-upgrade';
  const old = await openDB(name, 9, {
    upgrade(db) {
      db.createObjectStore('data', { keyPath: 'id' });
      db.createObjectStore('bookmark', { keyPath: 'dataId' });
      db.createObjectStore('readerStatistic', { keyPath: ['bookKey', 'dateKey'] });
    }
  });
  const book = { id: 4, title: 'Keep me', elementHtml: '<p>本</p>' },
    resume = { dataId: 4, exploredCharCount: 12 };
  await old.put('data', book);
  await old.put('bookmark', resume);
  old.close();
  const db = await createBooksDb(name);
  assert.equal(db.version, 10);
  assert.deepEqual(await db.get('data', 4), book);
  assert.deepEqual(await db.get('bookmark', 4), resume);
  for (const store of ['readerImportRecord', 'readerExternalSync', 'readerSearchProjection'])
    assert.ok(db.objectStoreNames.contains(store));
  db.close();
  await deleteDB(name);
});

test('strong ETags accept only the HTTP opaque-tag grammar', () => {
  for (const value of ['""', '"abc"', '"!#~"', '"\x80\xff"'])
    assert.equal(client.strongEtag(value), true, value);
  for (const value of [
    '"a b"',
    '"a\tb"',
    '"\x00"',
    '"\x1f"',
    '"\x7f"',
    '"本"',
    'W/"x"',
    '"a", "b"'
  ])
    assert.equal(client.strongEtag(value), false, value);
});

test('whole-file GET and completed PUT reject partial or merely accepted success statuses', async (t) => {
  let code = 206;
  let cancelled = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), ...options });
    const body = [204, 205, 304].includes(code)
      ? null
      : new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('incomplete'));
          },
          cancel() {
            cancelled = true;
          }
        });
    return new Response(body, { status: code });
  });
  const source = new client.WebDavClient('https://example.test/Books/');
  for (code of [202, 206, 207]) {
    cancelled = false;
    await assert.rejects(source.get('novel.txt', 1024), /Unexpected WebDAV GET/);
    assert.equal(cancelled, true);
  }
  code = 202;
  await assert.rejects(source.put('state.json', '{}', '"old"'), /Unexpected WebDAV PUT/);
  code = 204;
  await source.put('state.json', '{}', 'missing');
  assert.equal(requests.at(-1).headers['If-None-Match'], '*');
  await source.put('state.json', '{}', '"old"');
  assert.equal(requests.at(-1).headers['If-Match'], '"old"');
  const count = requests.length;
  await assert.rejects(source.put('state.json', '{}', '"bad etag"'), /strong ETag/);
  assert.equal(requests.length, count);
});

test('WebDAV UTF-8 decoding rejects corrupted bytes rather than manufacturing replacement text', () => {
  assert.equal(
    client.decodeDavText(new TextEncoder().encode('猫の本'), 'WebDAV reading data'),
    '猫の本'
  );
  for (const invalid of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe3, 0x81]]) {
    assert.throws(
      () => client.decodeDavText(new Uint8Array(invalid), 'WebDAV reading data'),
      (error) =>
        error.code === 'encoding' && error.message === 'WebDAV reading data is not valid UTF-8.'
    );
  }
  // A genuine U+FFFD in a user's note is valid text; it must not be deleted or rejected.
  assert.equal(client.decodeDavText(new Uint8Array([0xef, 0xbf, 0xbd]), 'note'), '�');
});

test('WebDAV source listing reads one scoped snapshot rather than detached keys', async (t) => {
  const sourcePath = new URL('../../apps/web/src/lib/webdav/source.ts', import.meta.url).pathname;
  const persistencePath = new URL('../../apps/web/src/lib/manabi/persistence.ts', import.meta.url)
    .pathname;
  const result = await build({
    stdin: {
      contents: `export {davSources} from ${JSON.stringify(sourcePath)}; export {integrationDB} from ${JSON.stringify(persistencePath)};`,
      resolveDir: new URL('../../apps/web', import.meta.url).pathname
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    tsconfig: new URL('../../apps/web/tsconfig.json', import.meta.url).pathname
  });
  const { davSources, integrationDB } = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
  const db = await integrationDB();
  try {
    const config = {
      id: 'webdav-one',
      name: 'One',
      url: 'https://example.test/Books/',
      username: '',
      writable: false
    };
    await db.put('metadata', config, 'webdav-source:webdav-one');
    await db.put('metadata', { unrelated: true }, 'webdav-other');
    await db.put('metadata', { unrelated: true }, 'webdav-sourcez');
    t.mock.method(globalThis.IDBObjectStore.prototype, 'getAllKeys', () => {
      throw new Error('Detached source keys are not a coherent snapshot.');
    });
    assert.deepEqual(await davSources(), [config]);
    await db.delete('metadata', 'webdav-source:webdav-one');
    assert.deepEqual(await davSources(), []);
  } finally {
    db.close();
    await deleteDB('manabi-reader-integrations');
  }
});
