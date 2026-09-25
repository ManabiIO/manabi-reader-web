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
