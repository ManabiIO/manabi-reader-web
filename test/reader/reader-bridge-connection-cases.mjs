/** @license BSD-3-Clause */
import { ZipWriter, Uint8ArrayWriter, TextReader, configure } from '@zip.js/zip.js';
import { createBooksDb } from '../../apps/web/src/lib/data/database/books-db/factory.ts';
import { encodeBook } from '../../apps/web/src/lib/data/database/books-db/book-binary.ts';
import { compareReaderBridgeLocalBook as compare } from '../../apps/web/src/lib/manabi/reader-bridge-local-book.ts';
import {
  previewDriveReaderBridge as preview,
  captureDriveReaderPreview as capture
} from '../../apps/web/src/lib/manabi/reader-bridge-source.ts';
import {
  saveReaderBridgeConnection as save,
  listReaderBridgeConnections as list,
  removeReaderBridgeConnection as remove
} from '../../apps/web/src/lib/manabi/reader-bridge-connection.ts';
import {
  prepareReaderBridgeJournal as prepareJournal,
  exportReaderBridgeRecovery as backup,
  restoreReaderBridgeRecovery as restore
} from '../../apps/web/src/lib/manabi/reader-bridge-journal.ts';
import { READER_BRIDGE_CONNECTION_LIMITS as limits } from '../../apps/web/src/lib/manabi/reader-bridge-connection-model.ts';
configure({ useWebWorkers: false });
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const scope = (signal) => ({ profileId: 'alice', signal, assertCurrent() {} });
const journalScope = () => ({ accountId: 'alice', assertCurrent() {} });
const uuid = '00000000-0000-4000-8000-000000000001';
const selection = {
  owner: 'alice',
  connection: uuid,
  root: 'root',
  folder: 'folder',
  profile: 'ttu-1-8'
};
const source = {
  title: 'Book',
  elementHtml: '<p id="start">日本語</p>',
  styleSheet: '',
  sections: [],
  blobs: {}
};
const property = (object, key) => {
  const value = Reflect.get(object, key);
  return typeof value === 'function' ? value.bind(object) : value;
};
async function rejects(work, code) {
  try {
    await work();
  } catch (error) {
    if (code)
      assert(
        error.code === code || error.name === code,
        `Expected ${code}, got ${error.code || error.name}: ${error.message}`
      );
    return;
  }
  throw new Error(`Expected ${code} rejection.`);
}
async function setup(work) {
  const name = `reader-connection-${globalThis.crypto.randomUUID()}`,
    db = await createBooksDb(name);
  try {
    await db.put(
      'data',
      await encodeBook({
        ...source,
        id: 1,
        characters: 100,
        hasThumb: false,
        lastBookModified: 1,
        lastBookOpen: 1
      })
    );
    const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await zip.add('staticdata.json', new TextReader(JSON.stringify(source)));
    const bytes = await zip.close();
    const state = {
      valid: true,
      generation: uuid,
      packageId: 'package',
      version: '1',
      revision: 'a'.repeat(64),
      calls: 0
    };
    globalThis.readerConnectionTransport = {
      scope(owner) {
        assert(owner === 'alice', 'Incorrect source account');
        return {
          signal: new AbortController().signal,
          assertCurrent() {
            if (!state.valid) throw new Error('Account changed');
          },
          stop() {}
        };
      },
      async request(path, options) {
        assert(
          options.userId === 'alice' && !options.method && !options.value,
          'Unexpected write or account.'
        );
        const url = new URL(path, 'https://example.test');
        state.calls++;
        if (url.pathname.endsWith('/reader-bridge-file/')) return bytes.slice().buffer;
        return {
          profile: 'ttu-1-8',
          generation: state.generation,
          revision: state.revision,
          ignoredFiles: 0,
          folder: {
            id: 'folder',
            name: 'Book',
            mime: 'application/vnd.google-apps.folder',
            parents: ['root'],
            version: '1'
          },
          files: [
            {
              id: state.packageId,
              name: 'bookdata_1_8_100_1_1.zip',
              version: state.version,
              md5: '0'.repeat(32),
              mime: 'application/zip',
              parents: ['folder'],
              size: bytes.byteLength,
              role: 'book'
            }
          ]
        };
      }
    };
    const fresh = async (operationScope = scope()) => {
      const remote = await preview(selection);
      const match = await compare(db, operationScope, capture(remote).content, 100, 1, document);
      assert(match.matches, 'Fixture content did not match');
      return { remote, match };
    };
    await work(db, fresh, state, name);
  } finally {
    db.close();
    delete globalThis.readerConnectionTransport;
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = resolve;
      r.onerror = () => reject(r.error);
    });
  }
}
async function reading(db) {
  return JSON.stringify(
    await Promise.all(
      ['data', 'bookmark', 'statistic', 'readerStatistic', 'readerBridgeJournal'].map((name) =>
        db.getAll(name)
      )
    )
  );
}
const cases = {
  async 'a genuine compared pair saves durably without reading changes or Drive writes'() {
    await setup(async (db, fresh, _state, name) => {
      const { remote, match } = await fresh(),
        before = await reading(db);
      const saved = await save(db, scope(), remote, match);
      assert(
        saved.state === 'linked' && saved.descriptor.source.packageId === 'package',
        'Missing verified source'
      );
      assert(
        saved.descriptor.source.files.length === 1 && saved.descriptor.local.identity,
        'Missing source files or local UUID'
      );
      assert((await db.get('readerBookScope', 1)).accountId === 'alice', 'Missing local ownership');
      assert(before === (await reading(db)), 'Saving connection changed reading data');
      const again = await fresh();
      assert(
        (await save(db, scope(), again.remote, again.match)).id === saved.id,
        'Repeated save created another link'
      );
      const other = await createBooksDb(name);
      try {
        assert(
          (await list(other, scope()))[0].id === saved.id,
          'Connection did not survive a new handle'
        );
      } finally {
        other.close();
      }
    });
  },
  async 'copied preview or comparison, cross-account scope and stale content cannot create a connection'() {
    await setup(async (db, fresh) => {
      const { remote, match } = await fresh();
      await rejects(() => save(db, scope(), { ...remote }, match));
      await rejects(() => save(db, scope(), remote, { ...match }));
      await rejects(() => save(db, { ...scope(), profileId: 'bob' }, remote, match), 'changed');
      const book = await db.get('data', 1);
      book.elementHtml += '<p>Changed</p>';
      await db.put('data', book);
      await rejects(() => save(db, scope(), remote, match), 'changed');
      assert(
        (await db.count('readerBridgeConnection')) === 0 &&
          (await db.count('readerLocalIdentity')) === 0,
        'Rejected save partially persisted'
      );
    });
  },
  async 'remote changes during review and later replacements never silently rebind'() {
    await setup(async (db, fresh, state) => {
      const original = await fresh();
      state.version = '2';
      await rejects(() => save(db, scope(), original.remote, original.match), 'conflict');
      const current = await fresh();
      const saved = await save(db, scope(), current.remote, current.match);
      state.version = '3';
      let next = await fresh();
      await rejects(() => save(db, scope(), next.remote, next.match), 'exists');
      state.version = '2';
      state.generation = '00000000-0000-4000-8000-000000000002';
      next = await fresh();
      await rejects(() => save(db, scope(), next.remote, next.match), 'exists');
      state.generation = uuid;
      state.packageId = 'replacement';
      next = await fresh();
      await rejects(() => save(db, scope(), next.remote, next.match), 'exists');
      assert(
        (await list(db, scope()))[0].revision === saved.revision,
        'Replacement changed saved pair'
      );
    });
  },
  async 'competing tabs save one connection and account CAS removal preserves reading and evidence'() {
    await setup(async (db, fresh, _state, name) => {
      const pair = await fresh(),
        other = await createBooksDb(name);
      try {
        const results = await Promise.allSettled([
          save(db, scope(), pair.remote, pair.match),
          save(other, scope(), pair.remote, pair.match)
        ]);
        assert(
          results.some((r) => r.status === 'fulfilled') &&
            (await db.count('readerBridgeConnection')) === 1,
          'Competing pair duplicated'
        );
      } finally {
        other.close();
      }
      const [saved] = await list(db, scope()),
        before = await reading(db);
      await rejects(
        () => remove(db, { ...scope(), profileId: 'bob' }, saved.id, saved.revision),
        'changed'
      );
      await rejects(() => remove(db, scope(), saved.id, globalThis.crypto.randomUUID()), 'changed');
      await remove(db, scope(), saved.id, saved.revision);
      assert(
        (await db.count('readerBridgeConnection')) === 0 && before === (await reading(db)),
        'Removal changed reading data'
      );
      const next = await fresh(),
        replacement = await save(db, scope(), next.remote, next.match);
      await rejects(() => remove(db, scope(), saved.id, saved.revision), 'changed');
      assert((await list(db, scope()))[0].id === replacement.id, 'Old removal removed replacement');
    });
  },
  async 'cancellation or account switch after identity write rolls back connection and ownership'() {
    for (const cancel of [true, false])
      await setup(async (db, fresh) => {
        const pair = await fresh(),
          controller = new AbortController(),
          operationScope = scope(controller.signal);
        const observed = new Proxy(db, {
          get(target, key) {
            if (key !== 'transaction') return property(target, key);
            return (...args) => {
              const tx = target.transaction(...args);
              return new Proxy(tx, {
                get(transaction, field) {
                  if (field !== 'objectStore') return property(transaction, field);
                  return (name) => {
                    const store = transaction.objectStore(name);
                    if (name !== 'readerLocalIdentity') return store;
                    return new Proxy(store, {
                      get(object, operation) {
                        if (operation !== 'put') return property(object, operation);
                        return async (...values) => {
                          const result = await object.put(...values);
                          if (cancel) controller.abort();
                          else operationScope.profileId = 'bob';
                          return result;
                        };
                      }
                    });
                  };
                }
              });
            };
          }
        });
        await rejects(
          () => save(observed, operationScope, pair.remote, pair.match),
          cancel ? 'AbortError' : 'changed'
        );
        assert(
          (await db.count('readerBridgeConnection')) === 0 &&
            (await db.count('readerLocalIdentity')) === 0 &&
            (await db.count('readerBookScope')) === 0,
          'Aborted connection partially committed'
        );
      });
  },
  async 'recovery cancellation rolls back journal evidence and connection hints together'() {
    await setup(async (db, fresh) => {
      const pair = await fresh();
      const saved = await save(db, scope(), pair.remote, pair.match);
      const projection = pair.remote.projection;
      const evidence = {
        book: { title: pair.remote.title, characters: pair.remote.characters },
        direction: 'receive',
        local: { snapshot: projection.snapshot, originals: projection.originals },
        remote: { snapshot: projection.snapshot, originals: projection.originals }
      };
      await prepareJournal(db, journalScope(), globalThis.crypto.randomUUID(), evidence);
      const json = await backup(db, journalScope());
      await remove(db, scope(), saved.id, saved.revision);
      const before = await reading(db),
        controller = new AbortController();
      let wrote = false;
      const observed = new Proxy(db, {
        get(target, key) {
          if (key !== 'transaction') return property(target, key);
          return (...args) => {
            const tx = target.transaction(...args);
            return new Proxy(tx, {
              get(transaction, field) {
                if (field !== 'objectStore') return property(transaction, field);
                return (name) => {
                  const store = transaction.objectStore(name);
                  if (name !== 'readerBridgeConnection') return store;
                  return new Proxy(store, {
                    get(object, operation) {
                      if (operation !== 'add') return property(object, operation);
                      return async (...values) => {
                        const result = await object.add(...values);
                        wrote = true;
                        controller.abort();
                        return result;
                      };
                    }
                  });
                };
              }
            });
          };
        }
      });
      await rejects(
        () => restore(observed, { ...journalScope(), signal: controller.signal }, json),
        'AbortError'
      );
      assert(
        wrote && (await db.count('readerBridgeConnection')) === 0 && before === (await reading(db)),
        'Recovery committed only one store'
      );
      assert(
        (await restore(db, journalScope(), json)) === 2,
        'Valid recovery could not retry both records'
      );
    });
  },
  async 'version 3 recovery restores only inactive hints and rejects a malformed envelope atomically'() {
    await setup(async (db, fresh) => {
      const pair = await fresh(),
        saved = await save(db, scope(), pair.remote, pair.match),
        before = await reading(db);
      const json = await backup(db, journalScope()),
        data = JSON.parse(json);
      assert(
        data.version === 3 && data.connections.length === 1 && !json.includes('syncEnabled'),
        'Wrong portable contract'
      );
      await remove(db, scope(), saved.id, saved.revision);
      assert(
        (await restore(db, journalScope(), json)) === 1 &&
          (await restore(db, journalScope(), json)) === 0,
        'Hints not idempotent'
      );
      const rows = await list(db, scope());
      assert(rows.length === 1 && rows[0].state === 'restored', 'Recovery activated a connection');
      assert(before === (await reading(db)), 'Restoring connection changed reading values');
      const next = await fresh();
      await save(db, scope(), next.remote, next.match);
      assert(
        (await list(db, scope())).filter((row) => row.state === 'linked').length === 1,
        'Explicit reconnect not available'
      );
      for (const mutate of [
        (value) => {
          value.connections[0].source.refresh_token = 'secret';
        },
        (value) => {
          value.connections[0].source.packageId = 'replaced';
        },
        (value) => {
          value.connections[0].binding = 'f'.repeat(64);
        },
        (value) => {
          value.connections[0].accountId = 'bob';
        },
        (value) => {
          value.connections.push({ ...value.connections[0], title: 'x'.repeat(4097) });
        },
        (value) => {
          value.connections = Array.from(
            { length: limits.records + 1 },
            () => value.connections[0]
          );
        }
      ]) {
        const invalid = JSON.parse(json);
        mutate(invalid);
        const current = JSON.stringify(await list(db, scope()));
        await rejects(() => restore(db, journalScope(), JSON.stringify(invalid)));
        assert(
          current === JSON.stringify(await list(db, scope())),
          'Invalid recovery partially changed connections'
        );
      }
    });
  }
};
export const caseNames = Object.keys(cases);
export async function runCase(name) {
  if (!cases[name]) throw new Error(name);
  await cases[name]();
  return { name, state: 'passed' };
}
