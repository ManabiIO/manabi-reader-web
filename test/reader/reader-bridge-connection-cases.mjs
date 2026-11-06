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
  removeReaderBridgeConnection as remove,
  setReaderBridgeAutomaticChecks as automatic,
  setReaderBridgeAutomaticReceive as automaticReceive
} from '../../apps/web/src/lib/manabi/reader-bridge-connection.ts';
import {
  prepareReaderBridgeJournal as prepareJournal,
  exportReaderBridgeRecovery as backup,
  restoreReaderBridgeRecovery as restore
} from '../../apps/web/src/lib/manabi/reader-bridge-journal.ts';
import {
  READER_BRIDGE_CONNECTION_LIMITS as limits,
  validateReaderBridgeConnectionRecord as validate
} from '../../apps/web/src/lib/manabi/reader-bridge-connection-model.ts';
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
  async 'automatic checks require explicit consent and revision changes without touching reading data'() {
    await setup(async (db, fresh, state) => {
      const pair = await fresh(),
        saved = await save(db, scope(), pair.remote, pair.match);
      assert(
        saved.version === 3 && saved.automaticChecks === false,
        'New connection opted in automatically'
      );
      const before = await reading(db),
        calls = state.calls,
        descriptor = JSON.stringify(saved.descriptor);
      const enabled = await automatic(db, scope(), saved.id, saved.revision, true);
      assert(
        enabled.version === 3 && enabled.automaticChecks && enabled.revision !== saved.revision,
        'Consent did not rotate the revision'
      );
      assert(JSON.stringify(enabled.descriptor) === descriptor, 'Consent rewrote source evidence');
      const repeated = await automatic(db, scope(), enabled.id, enabled.revision, true);
      assert(
        repeated.revision === enabled.revision,
        'Unchanged consent needlessly invalidated work'
      );
      await rejects(() => automatic(db, scope(), saved.id, saved.revision, false), 'changed');
      await rejects(
        () => automatic(db, { ...scope(), profileId: 'bob' }, enabled.id, enabled.revision, false),
        'changed'
      );
      await rejects(() => automatic(db, scope(), enabled.id, enabled.revision, 'true'), 'changed');
      const disabled = await automatic(db, scope(), enabled.id, enabled.revision, false);
      assert(
        !disabled.automaticChecks && disabled.revision !== enabled.revision,
        'Disabling did not revoke the previous revision'
      );
      assert(
        before === (await reading(db)) && state.calls === calls,
        'Changing consent touched reading or Drive'
      );
      assert(
        JSON.stringify(disabled.descriptor) === descriptor,
        'Disabling changed source evidence'
      );
    });
  },
  async 'legacy records remain readable and off until explicit opt-in while malformed consent is rejected'() {
    await setup(async (db, fresh) => {
      const pair = await fresh(),
        saved = await save(db, scope(), pair.remote, pair.match);
      const old = { ...saved };
      delete old.automaticChecks;
      delete old.automaticReceive;
      const legacy = { ...old, version: 1 };
      await db.put('readerBridgeConnection', legacy);
      const [read] = await list(db, scope());
      assert(read.version === 1 && read.automaticChecks !== true, 'Legacy record gained consent');
      assert(
        JSON.stringify(await db.get('readerBridgeConnection', saved.id)) === JSON.stringify(legacy),
        'Reading migrated the record'
      );
      assert(
        (await automatic(db, scope(), saved.id, saved.revision, false)).revision === saved.revision,
        'Already-off legacy record changed'
      );
      const enabled = await automatic(db, scope(), saved.id, saved.revision, true);
      assert(
        enabled.version === 3 && enabled.automaticChecks,
        'Explicit opt-in did not migrate the record'
      );
      for (const invalid of [
        { ...legacy, automaticChecks: true },
        { ...old, version: 2 },
        { ...enabled, automaticChecks: 'true' },
        { ...enabled, state: 'restored', id: `recovery:${'a'.repeat(64)}` }
      ])
        await rejects(async () => validate(invalid), 'invalid');
    });
  },
  async 'competing consent changes cannot reuse a revision or overwrite a later choice'() {
    await setup(async (db, fresh, _state, name) => {
      const pair = await fresh(),
        saved = await save(db, scope(), pair.remote, pair.match);
      const other = await createBooksDb(name);
      try {
        const result = await Promise.allSettled([
          automatic(db, scope(), saved.id, saved.revision, true),
          automatic(other, scope(), saved.id, saved.revision, true)
        ]);
        assert(
          result.filter((value) => value.status === 'fulfilled').length === 1 &&
            result.find((value) => value.status === 'rejected').reason.code === 'changed',
          'Competing consent reused a stale revision'
        );
      } finally {
        other.close();
      }
      const [enabled] = await list(db, scope());
      const disabled = await automatic(db, scope(), enabled.id, enabled.revision, false);
      await rejects(() => automatic(db, scope(), enabled.id, enabled.revision, true), 'changed');
      assert(
        (await list(db, scope()))[0].revision === disabled.revision && !disabled.automaticChecks,
        'Old enable replaced the newer disable'
      );
    });
  },
  async 'automatic receive is separate explicit consent, implies checks, and is revoked with checks'() {
    await setup(async (db, fresh, state) => {
      const { remote, match } = await fresh();
      const saved = await save(db, scope(), remote, match);
      assert(saved.automaticReceive === false, 'New pair opted in');
      const before = await reading(db),
        calls = state.calls;
      const checks = await automatic(db, scope(), saved.id, saved.revision, true);
      assert(checks.automaticReceive === false, 'Checks granted receive');
      const enabled = await automaticReceive(db, scope(), checks.id, checks.revision, true);
      assert(
        enabled.automaticReceive && enabled.automaticChecks && enabled.revision !== checks.revision,
        'Receive consent not saved'
      );
      const same = await automaticReceive(db, scope(), enabled.id, enabled.revision, true);
      assert(same.revision === enabled.revision, 'Idempotent opt-in changed revision');
      const off = await automatic(db, scope(), enabled.id, enabled.revision, false);
      assert(!off.automaticReceive && !off.automaticChecks, 'Disabling checks retained receive');
      await rejects(
        () => automaticReceive(db, scope(), enabled.id, enabled.revision, true),
        'changed'
      );
      const on = await automaticReceive(db, scope(), off.id, off.revision, true);
      assert(
        on.automaticChecks && on.automaticReceive,
        'Receive did not enable its required checks'
      );
      const receiveOff = await automaticReceive(db, scope(), on.id, on.revision, false);
      assert(
        receiveOff.automaticChecks && !receiveOff.automaticReceive,
        'Receive disable changed independent checks'
      );
      assert(
        before === (await reading(db)) && calls === state.calls,
        'Consent altered data or contacted Drive'
      );
      for (const record of [
        { ...enabled, automaticChecks: false },
        { ...enabled, automaticReceive: 'true' },
        { ...enabled, version: 2 },
        { ...enabled, version: 1 }
      ])
        await rejects(() => validate(record), 'invalid');
      const v2 = { ...enabled };
      delete v2.automaticReceive;
      v2.version = 2;
      await db.put('readerBridgeConnection', validate(v2));
      assert(
        (await list(db, scope()))[0].automaticReceive !== true,
        'V2 inherited receive consent'
      );
      const upgraded = await automaticReceive(db, scope(), v2.id, v2.revision, true);
      assert(upgraded.version === 3 && upgraded.automaticReceive, 'V2 cannot explicitly opt in');
    });
  },
  async 'automatic consent rejects missing or reassigned local authority'() {
    for (const change of [
      'deleted-book',
      'uuid-replaced',
      'uuid-duplicate',
      'missing-owner',
      'foreign-owner',
      'foreign-library'
    ])
      await setup(async (db, fresh) => {
        const pair = await fresh(),
          saved = await save(db, scope(), pair.remote, pair.match);
        if (change === 'deleted-book') await db.delete('data', 1);
        if (change === 'uuid-replaced')
          await db.put('readerLocalIdentity', { bookId: 1, uuid: globalThis.crypto.randomUUID() });
        if (change === 'uuid-duplicate')
          await db.put('readerLocalIdentity', { bookId: 2, uuid: saved.descriptor.local.identity });
        if (change === 'missing-owner') await db.delete('readerBookScope', 1);
        if (change === 'foreign-owner')
          await db.put('readerBookScope', { bookId: 1, accountId: 'bob' });
        if (change === 'foreign-library') {
          const book = await db.get('data', 1);
          await db.put('data', { ...book, libraryOwner: 'bob' });
        }
        const before = await reading(db);
        await rejects(() => automatic(db, scope(), saved.id, saved.revision, true), 'changed');
        assert(
          JSON.stringify(await db.get('readerBridgeConnection', saved.id)) ===
            JSON.stringify(saved) && before === (await reading(db)),
          `Changed local authority accepted: ${change}`
        );
      });
  },
  async 'automatic consent cancellation and account switches after a successful put roll back'() {
    for (const cancel of [true, false])
      await setup(async (db, fresh) => {
        const pair = await fresh(),
          saved = await save(db, scope(), pair.remote, pair.match);
        const controller = new AbortController(),
          operationScope = scope(controller.signal);
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
                        if (operation !== 'put') return property(object, operation);
                        return async (...values) => {
                          const result = await object.put(...values);
                          wrote = true;
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
        const before = await reading(db);
        await rejects(
          () => automatic(observed, operationScope, saved.id, saved.revision, true),
          cancel ? 'AbortError' : 'changed'
        );
        assert(
          wrote &&
            JSON.stringify(await db.get('readerBridgeConnection', saved.id)) ===
              JSON.stringify(saved) &&
            before === (await reading(db)),
          'Revoked consent update partially committed'
        );
      });
  },
  async 'recovery excludes automatic consent and restores inactive off hints without changing live opt-in'() {
    await setup(async (db, fresh) => {
      const pair = await fresh(),
        saved = await save(db, scope(), pair.remote, pair.match);
      const enabled = await automaticReceive(db, scope(), saved.id, saved.revision, true);
      const before = await reading(db),
        json = await backup(db, journalScope());
      assert(
        !json.includes('automaticChecks') && !json.includes('automaticReceive'),
        'Recovery exported permission for automatic checks'
      );
      assert(
        JSON.stringify(JSON.parse(json).connections[0]) === JSON.stringify(enabled.descriptor),
        'Recovery lost source evidence'
      );
      await restore(db, journalScope(), json);
      const rows = await list(db, scope()),
        hint = rows.find((row) => row.state === 'restored');
      assert(
        hint &&
          hint.automaticChecks !== true &&
          hint.automaticReceive !== true &&
          rows.find((row) => row.id === enabled.id).automaticReceive === true,
        'Restore changed live consent or activated its hint'
      );
      await rejects(() => automatic(db, scope(), hint.id, hint.revision, true), 'changed');
      await rejects(() => automatic(db, scope(), hint.id, hint.revision, false), 'changed');
      assert(
        before === (await reading(db)) && (await restore(db, journalScope(), json)) === 0,
        'Restoring consent was not inert or idempotent'
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
