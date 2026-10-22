/** @license BSD-3-Clause */
import { createBooksDb } from '../../apps/web/src/lib/data/database/books-db/factory.ts';
import { encodeBook } from '../../apps/web/src/lib/data/database/books-db/book-binary.ts';
import {
  packEpubResources,
  epubPublicationManifest
} from '../../apps/web/src/lib/foliate-epub/publication-data.ts';
import { prepareReaderImportContent } from '../../apps/web/src/lib/manabi/reader-import-content.ts';
import {
  listReaderBridgeLocalBooks as list,
  compareReaderBridgeLocalBook as compare
} from '../../apps/web/src/lib/manabi/reader-bridge-local-book.ts';

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const scope = () => ({ profileId: 'alice', assertCurrent() {} });
const raw = () => ({
  title: '本',
  elementHtml:
    '<p id="start" onclick="bad()">日本語<script>bad()</script><img src="ttu:image.png"></p>',
  htmlBackup: '<p onclick="bad()">Original text</p>',
  styleSheet: 'p { color: red; }',
  language: 'ja',
  sections: [{ reference: 'start', charactersWeight: 1, startCharacter: 0, characters: 100 }],
  blobs: { 'image.png': new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
  coverImage: new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' })
});
async function imported(source = raw(), id = 1) {
  return encodeBook({
    ...prepareReaderImportContent(source, document),
    id,
    characters: 100,
    hasThumb: true,
    lastBookModified: 1,
    lastBookOpen: 1,
    // Neither claim proves anything. Matching tests must inspect current bytes.
    contentHash: 'a'.repeat(64),
    manabiTtuImport: { content: 'b'.repeat(64) }
  });
}
async function rejects(work, code) {
  try {
    await work();
  } catch (error) {
    assert(
      error.code === code || error.name === code,
      `Expected ${code}, got ${error.code || error.name}: ${error.message}`
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
async function withDatabase(work) {
  const name = `reader-local-match-${globalThis.crypto.randomUUID()}`;
  const db = await createBooksDb(name);
  try {
    return await work(db, name);
  } finally {
    db.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }
}
async function duringHash(mutate, work) {
  const original = globalThis.crypto.subtle.digest;
  let changed = false;
  globalThis.crypto.subtle.digest = async function (...args) {
    if (!changed) {
      changed = true;
      await mutate();
    }
    return original.apply(this, args);
  };
  try {
    return await work();
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
}
async function allData(db) {
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores);
  const values = await Promise.all(stores.map((store) => tx.objectStore(store).getAll()));
  await tx.done;
  // Binary mutations have dedicated assertions below; this tracks all stores.
  return JSON.stringify(values);
}
const cases = {
  async 'sanitized imported bytes match the original package after a local rename'() {
    await withDatabase(async (db) => {
      const source = raw();
      const book = await imported(source);
      assert(!book.elementHtml.includes('<script>'), 'The fixture must exercise cleanup.');
      assert(!book.elementHtml.includes('onclick'), 'Unsafe event survived.');
      book.title = 'Renamed here';
      book.contentHash = 'c'.repeat(64);
      await db.put('data', book);
      await db.put('bookmark', { dataId: 1, progress: 0.25, lastBookmarkModified: 10 });
      const before = await allData(db);
      const result = await compare(db, scope(), source, 100, 1, document);
      assert(
        result.matches && result.title === 'Renamed here' && result.progress === 0.25,
        'Imported content did not match.'
      );
      assert(before === (await allData(db)), 'A read-only comparison wrote data.');
    });
  },
  async 'same title and receipt cannot hide different text, media, CSS or layout'() {
    const mutations = [
      (book) => {
        book.elementHtml += '<p>New chapter</p>';
      },
      (book) => {
        new Uint8Array(book.blobs['image.png'].bytes)[1] = 9;
      },
      (book) => {
        new Uint8Array(book.coverImage.bytes)[1] = 9;
      },
      (book) => {
        book.styleSheet += 'p{color:blue}';
      },
      (book) => {
        book.sections[0].reference = 'another';
      },
      (book) => {
        book.language = 'en';
      },
      (book) => {
        book.sourceFormat = 'epub';
      },
      (book) => {
        book.publicationManifest = { version: 1, resources: [] };
      },
      (book) => {
        book.htmlBackup = 'different';
      },
      (book) => {
        book.characters = 101;
      }
    ];
    await withDatabase(async (db) => {
      for (const mutate of mutations) {
        const book = await imported();
        mutate(book);
        await db.put('data', book);
        assert(
          !(await compare(db, scope(), raw(), 100, 1, document)).matches,
          'Different content matched.'
        );
      }
    });
  },
  async 'packed EPUB cleanup preserves the exact resource mapping used by import'() {
    await withDatabase(async (db) => {
      const source = raw();
      const packed = packEpubResources([
        {
          href: 'a.xhtml',
          spineIndex: 0,
          sectionId: 'ttu-a',
          html: '<p onclick="bad()">A</p>',
          styleSheet: ''
        },
        {
          href: 'b.xhtml',
          spineIndex: 1,
          sectionId: 'ttu-b',
          html: '<p>B<script>bad()</script></p>',
          styleSheet: ''
        }
      ]);
      Object.assign(source, packed, {
        sourceFormat: 'epub',
        publicationManifest: epubPublicationManifest(packed.epubPublication)
      });
      await db.put('data', await imported(source));
      assert((await compare(db, scope(), source, 100, 1, document)).matches, 'EPUB did not match.');
      const book = await db.get('data', 1);
      book.publicationManifest.resources[1].href = 'wrong.xhtml';
      await db.put('data', book);
      assert(
        !(await compare(db, scope(), source, 100, 1, document)).matches,
        'Different EPUB manifest matched.'
      );
    });
  },
  async 'explicit choices retain duplicate titles and exclude foreign personal books'() {
    await withDatabase(async (db) => {
      for (let id = 1; id <= 4; id++) await db.put('data', await imported(raw(), id));
      const foreign = await db.get('data', 3);
      foreign.libraryOwner = 'bob';
      await db.put('data', foreign);
      await db.put('readerBookScope', { bookId: 4, accountId: 'bob' });
      const before = await allData(db);
      const choices = await list(db, scope());
      assert(
        JSON.stringify(choices.map((book) => book.id)) === '[1,2]',
        'Incorrect local choices.'
      );
      await rejects(() => compare(db, scope(), raw(), 100, 3, document), 'unavailable');
      await rejects(() => compare(db, scope(), raw(), 100, 4, document), 'unavailable');
      assert(before === (await allData(db)), 'Selection changed ownership.');
    });
  },
  async 'second-connection edits during hashing invalidate text, same-size bytes and position'() {
    await withDatabase(async (db, name) => {
      const other = await createBooksDb(name);
      try {
        for (const kind of ['text', 'bytes', 'position', 'delete']) {
          await db.put('data', await imported());
          await db.put('bookmark', { dataId: 1, progress: 0.25, lastBookmarkModified: 10 });
          await duringHash(
            async () => {
              if (kind === 'position')
                await other.put('bookmark', { dataId: 1, progress: 0.5, lastBookmarkModified: 20 });
              else if (kind === 'delete') await other.delete('data', 1);
              else {
                const book = await other.get('data', 1);
                if (kind === 'text') book.elementHtml += '<p>New text</p>';
                else new Uint8Array(book.blobs['image.png'].bytes)[1] = 9;
                await other.put('data', book);
              }
            },
            () =>
              rejects(
                () => compare(db, scope(), raw(), 100, 1, document),
                kind === 'delete' ? 'unavailable' : 'changed'
              )
          );
        }
      } finally {
        other.close();
      }
    });
  },
  async 'ownership and account changes during preparation never release another profile result'() {
    await withDatabase(async (db) => {
      await db.put('data', await imported());
      await duringHash(
        () => db.put('readerBookScope', { bookId: 1, accountId: 'bob' }),
        () => rejects(() => compare(db, scope(), raw(), 100, 1, document), 'unavailable')
      );
      await db.delete('readerBookScope', 1);
      const controller = new AbortController();
      await duringHash(
        () => controller.abort(),
        () =>
          rejects(
            () => compare(db, { ...scope(), signal: controller.signal }, raw(), 100, 1, document),
            'AbortError'
          )
      );
    });
  },
  async 'caller mutation during hashing cannot relabel a captured remote package'() {
    await withDatabase(async (db) => {
      const source = raw();
      await db.put('data', await imported(source));
      const result = await duringHash(
        () => {
          source.elementHtml = 'changed';
          source.blobs = {};
          source.sections = [];
        },
        () => compare(db, scope(), source, 100, 1, document)
      );
      assert(result.matches, 'Caller mutation changed captured comparison.');
    });
  },
  async 'legacy native media and placeholders stay readable without unsafe matching or rewrites'() {
    await withDatabase(async (db) => {
      const book = await imported();
      book.blobs['image.png'] = new Blob(['legacy']);
      await db.put('data', book);
      await rejects(() => compare(db, scope(), raw(), 100, 1, document), 'legacy-media');
      assert(
        (await db.get('data', 1)).blobs['image.png'] instanceof Blob,
        'Legacy media was rewritten.'
      );
      book.elementHtml = '';
      await db.put('data', book);
      await rejects(() => compare(db, scope(), raw(), 100, 1, document), 'unavailable');
    });
  }
};
export const caseNames = Object.keys(cases);
export async function runCase(name) {
  if (!cases[name]) throw new Error(`Unknown case ${name}`);
  await cases[name]();
  return { state: 'passed', name };
}
