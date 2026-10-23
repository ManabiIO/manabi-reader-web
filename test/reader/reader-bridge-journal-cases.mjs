/** @license BSD-3-Clause */
// The same cases run against native browser IndexedDB and fake-indexeddb.
import { createBooksDb } from '../../apps/web/src/lib/data/database/books-db/factory.ts';
import { projectReaderBridgeFiles } from '../../apps/web/src/lib/manabi/reader-bridge-projection.ts';
import {
  prepareReaderBridgeJournal as prepare,
  markReaderBridgeAttempt as attempt,
  abandonReaderBridgeDraft as abandon,
  acceptReaderBridgeReceive as accept,
  readReaderBridgeJournal as read,
  exportReaderBridgeRecovery as backup,
  restoreReaderBridgeRecovery as restore,
  READER_BRIDGE_JOURNAL_LIMITS as limits
} from '../../apps/web/src/lib/manabi/reader-bridge-journal.ts';

const assert = (value, description) => {
  if (!value) throw new Error(description);
};
const equal = (a, b, description) => assert(JSON.stringify(a) === JSON.stringify(b), description);
async function rejects(work, code) {
  try {
    await work();
  } catch (error) {
    if (code)
      assert(
        error.code === code || error.name === code,
        `Expected ${code}, received ${error.code || error.name}: ${error.message}`
      );
    return;
  }
  throw new Error('Expected rejection.');
}
const scope = (accountId = 'reader-a') => ({ accountId, assertCurrent() {} });
const qualified = 'conditional-recoverable';
const property = (target, key) => {
  const value = Reflect.get(target, key);
  return typeof value === 'function' ? value.bind(target) : value;
};
async function projection(position, revision, binding = 'binding', generation = 'generation') {
  return projectReaderBridgeFiles(
    { binding, generation, profile: 'ttu-1-6', fingerprint: 'a'.repeat(64), revision },
    { title: '本', characters: 300 },
    [
      {
        name: `progress_1_6_100_${position}.json`,
        body: JSON.stringify({
          dataId: 9,
          progress: position,
          exploredCharCount: position * 300,
          lastBookmarkModified: 100
        })
      }
    ]
  );
}
function wire(projection) {
  return {
    snapshot: structuredClone(projection.snapshot),
    originals: structuredClone(projection.originals)
  };
}
async function evidence(binding = 'binding', direction = 'both') {
  const before = await projection(0.1, 'base', binding);
  return {
    book: { title: '本', characters: 300 },
    direction,
    local: wire(await projection(0.2, 'local', binding)),
    remote: wire(await projection(0.1, 'remote', binding)),
    baseline: { local: structuredClone(before.snapshot), remote: structuredClone(before.snapshot) }
  };
}
async function withDatabase(work) {
  const name = `reader-bridge-journal-${globalThis.crypto.randomUUID()}`;
  let db = await createBooksDb(name);
  try {
    return await work(
      db,
      async () => {
        db.close();
        db = await createBooksDb(name);
        return db;
      },
      name
    );
  } finally {
    db.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      // WebKit can report blocked while an already-closed handle drains. Wait
      // for success/error; the browser runner bounds the complete case.
    });
  }
}
const cases = {
  async 'prepared intent survives reopening without retaining mutable caller data'() {
    await withDatabase(async (db, reopen) => {
      const input = await evidence(),
        id = globalThis.crypto.randomUUID();
      const wanted = structuredClone(input);
      const pending = prepare(db, scope(), id, input, qualified);
      input.local.originals[0].body = '{}';
      input.remote.snapshot.generation = 'mutated';
      const value = await pending;
      assert(
        value.phase === 'prepared' && value.plan.push.includes('resume'),
        'Prepared outbound intent missing.'
      );
      db = await reopen();
      equal(
        (await read(db, scope()))[0].entry.evidence,
        wanted,
        'Originals or observed identities changed after reopen.'
      );
      equal(
        await prepare(db, scope(), id, wanted, qualified),
        value,
        'Lost-response retry changed durable identity.'
      );
      await rejects(
        () => prepare(db, scope(), id, { ...wanted, direction: 'receive' }, qualified),
        'stale'
      );
    });
  },
  async 'two tabs cannot prepare competing operations for one book'() {
    await withDatabase(async (db, _reopen, name) => {
      const other = await createBooksDb(name);
      try {
        const input = await evidence();
        const results = await Promise.allSettled([
          prepare(db, scope(), globalThis.crypto.randomUUID(), input, qualified),
          prepare(other, scope(), globalThis.crypto.randomUUID(), input, qualified)
        ]);
        assert(
          results.filter((r) => r.status === 'fulfilled').length === 1,
          'Competing tab was admitted.'
        );
        assert(
          results.find((r) => r.status === 'rejected').reason.code === 'pending',
          'Wrong contention result.'
        );
        assert((await read(db, scope())).length === 1, 'Competing drafts persisted.');
      } finally {
        other.close();
      }
    });
  },
  async 'upload uncertainty commits before transport and survives a crash without replay'() {
    await withDatabase(async (db, reopen) => {
      const input = await evidence(),
        id = globalThis.crypto.randomUUID();
      const prepared = await prepare(db, scope(), id, input, qualified);
      const pending = await attempt(db, scope(), id, prepared.revision, qualified);
      assert(
        pending.phase === 'uncertain' && pending.entry.attempt.id,
        'Attempt was not durably fenced.'
      );
      db = await reopen(); // Simulate process loss before the caller knows whether the upload was sent.
      equal(
        await prepare(db, scope(), id, input, qualified),
        pending,
        'Retry erased an uncertain outcome.'
      );
      await rejects(() => attempt(db, scope(), id, pending.revision, qualified), 'recovery');
      await rejects(() => abandon(db, scope(), id, pending.revision), 'recovery');
      await rejects(
        () => prepare(db, scope(), globalThis.crypto.randomUUID(), input, qualified),
        'pending'
      );
      equal((await read(db, scope()))[0], pending, 'Recovery rejection changed evidence.');
    });
  },
  async 'stale tab revisions cannot abandon or transmit a newer operation'() {
    await withDatabase(async (db) => {
      const input = await evidence(),
        id = globalThis.crypto.randomUUID();
      const prepared = await prepare(db, scope(), id, input, qualified);
      const archived = await abandon(db, scope(), id, prepared.revision);
      assert(
        archived.phase === 'abandoned' && archived.revision !== prepared.revision,
        'CAS revision did not advance.'
      );
      await rejects(() => attempt(db, scope(), id, prepared.revision, qualified), 'stale');
      await rejects(() => abandon(db, scope(), id, prepared.revision), 'stale');
      const replacement = await prepare(
        db,
        scope(),
        globalThis.crypto.randomUUID(),
        input,
        qualified
      );
      assert(
        replacement.phase === 'prepared',
        'Explicitly abandoned draft still blocked replanning.'
      );
      assert((await read(db, scope())).length === 2, 'Abandoned originals were discarded.');
    });
  },
  async 'receive-only, unqualified writes and conflicting changes cannot start uploads'() {
    await withDatabase(async (db) => {
      const receive = await prepare(
        db,
        scope(),
        globalThis.crypto.randomUUID(),
        await evidence('receive', 'receive')
      );
      assert(receive.plan.pending.includes('resume'), 'Unsent local change was acknowledged.');
      await rejects(
        () => attempt(db, scope(), receive.id, receive.revision, qualified),
        'recovery'
      );
      const paused = await prepare(
        db,
        scope(),
        globalThis.crypto.randomUUID(),
        await evidence('unqualified')
      );
      assert(paused.phase === 'paused', 'Unqualified writer became ready.');
      await rejects(() => attempt(db, scope(), paused.id, paused.revision, qualified), 'recovery');
      const input = await evidence('conflict');
      delete input.baseline;
      const review = await prepare(db, scope(), globalThis.crypto.randomUUID(), input, qualified);
      assert(
        review.phase === 'review' && review.plan.conflicts.length === 1,
        'First-connection difference was not retained.'
      );
      await rejects(() => attempt(db, scope(), review.id, review.revision, qualified), 'recovery');
      equal(review.entry.evidence, input, 'Conflicting versions were discarded.');
    });
  },
  async 'tampered digests, unknown fields, divergent baselines and changed bindings never persist'() {
    await withDatabase(async (db) => {
      for (const mutate of [
        (v) => {
          v.local.snapshot.records.resume = 'b'.repeat(64);
        },
        (v) => {
          v.local.originals[0].body = v.local.originals[0].body.replace('0.2', '0.3');
        },
        (v) => {
          v.remote.snapshot.generation = 'different';
        },
        (v) => {
          v.baseline.remote.records.resume = 'c'.repeat(64);
        },
        (v) => {
          v.baseline.remote.fingerprint = 'c'.repeat(64);
        },
        (v) => {
          v.clientSecret = 'must-not-be-retained';
        },
        (v) => {
          v.local.snapshot.refresh_token = 'must-not-be-retained';
        },
        (v) => {
          v.remote.originals[0].access_token = 'must-not-be-retained';
        }
      ]) {
        const input = await evidence();
        mutate(input);
        await rejects(() => prepare(db, scope(), globalThis.crypto.randomUUID(), input, qualified));
        assert((await read(db, scope())).length === 0, 'Invalid evidence partially persisted.');
      }
    });
  },
  async 'account switch or cancellation rolls back a transaction after its first write'() {
    await withDatabase(async (db) => {
      for (const cancel of [true, false]) {
        const controller = new AbortController();
        let wrote = false;
        // Inject the external account change at the storage boundary, while the
        // real IndexedDB transaction is still live. Never substitute transaction.done.
        const observed = new Proxy(db, {
          get(target, key) {
            if (key !== 'transaction') return property(target, key);
            return (...args) => {
              const tx = target.transaction(...args);
              return new Proxy(tx, {
                get(transaction, field) {
                  if (field !== 'store') return property(transaction, field);
                  return new Proxy(transaction.store, {
                    get(store, operation) {
                      if (operation !== 'add') return property(store, operation);
                      return async (...values) => {
                        const result = await store.add(...values);
                        wrote = true;
                        if (cancel) controller.abort();
                        return result;
                      };
                    }
                  });
                }
              });
            };
          }
        });
        await rejects(async () =>
          prepare(
            observed,
            {
              accountId: 'reader-a',
              signal: controller.signal,
              assertCurrent() {
                if (wrote && !cancel) throw new Error('Account changed');
              }
            },
            globalThis.crypto.randomUUID(),
            await evidence(),
            qualified
          )
        );
        assert(wrote, 'Fault injection did not reach a real write.');
        assert((await read(db, scope())).length === 0, 'Revoked transaction partially committed.');
      }
    });
  },
  async 'recovery import is inert, lossless, idempotent and cannot overwrite a live operation'() {
    await withDatabase(async (db) => {
      const prepared = await prepare(
        db,
        scope(),
        globalThis.crypto.randomUUID(),
        await evidence(),
        qualified
      );
      const pending = await attempt(db, scope(), prepared.id, prepared.revision, qualified);
      const json = await backup(db, scope());
      const document = JSON.parse(json);
      equal(
        Object.keys(document).sort(),
        ['accountId', 'connections', 'entries', 'format', 'version'],
        'Unexpected backup authority.'
      );
      assert(!json.includes('conditional-recoverable'), 'Backup retained a live writer assertion.');
      assert(document.version === 3, 'New backups must use the version 3 envelope.');
      const legacyDocument = { ...document };
      delete legacyDocument.connections;
      const legacy = JSON.stringify({ ...legacyDocument, version: 1 });
      const version2 = JSON.stringify({ ...legacyDocument, version: 2 });
      assert((await restore(db, scope(), legacy)) === 1, 'Version 1 recovery evidence missing.');
      assert((await restore(db, scope(), version2)) === 0, 'Version 2 import created duplicates.');
      assert((await restore(db, scope(), json)) === 0, 'Repeated import created duplicates.');
      const rows = await read(db, scope()),
        recovered = rows.find((row) => row.phase === 'restored');
      equal(
        rows.find((row) => row.id === pending.id),
        pending,
        'Restore rewrote current intent.'
      );
      equal(
        recovered.entry,
        pending.entry,
        'Original bytes or uncertain operation identity were lost.'
      );
      await rejects(
        () => attempt(db, scope(), recovered.id, recovered.revision, qualified),
        'recovery'
      );
      await rejects(() => abandon(db, scope(), recovered.id, recovered.revision), 'recovery');
      await rejects(
        async () =>
          prepare(db, scope(), globalThis.crypto.randomUUID(), await evidence(), qualified),
        'pending'
      );
      const exported = JSON.parse(await backup(db, scope()));
      assert(
        exported.entries.every((entry) => entry.phase === 'uncertain'),
        'Restoring hid the original unknown outcome.'
      );
    });
  },
  async 'uncertain recovery restored after preparation blocks local acceptance without losing evidence'() {
    await withDatabase(async (db) => {
      const input = await evidence('binding', 'receive');
      [input.local, input.remote] = [input.remote, input.local];
      const prepared = await prepare(db, scope(), globalThis.crypto.randomUUID(), input);
      assert(
        prepared.plan.pull.includes('resume'),
        'Fixture did not prepare an incoming position.'
      );
      await withDatabase(async (source) => {
        const outgoing = await prepare(
          source,
          scope(),
          globalThis.crypto.randomUUID(),
          await evidence(),
          qualified
        );
        await attempt(source, scope(), outgoing.id, outgoing.revision, qualified);
        await restore(db, scope(), await backup(source, scope()));
      });
      let applied = false;
      await rejects(
        () =>
          accept(
            db,
            scope(),
            prepared.id,
            prepared.revision,
            {
              bookId: 1,
              localIdentity: '00000000-0000-4000-8000-000000000001',
              statisticsKey: 'local:00000000-0000-4000-8000-000000000001',
              title: '本'
            },
            'incoming',
            async () => {
              applied = true;
            }
          ),
        'pending'
      );
      assert(!applied, 'Unresolved restored upload allowed reading values to change.');
      const rows = await read(db, scope());
      assert(
        rows.length === 2 &&
          rows.some((row) => row.phase === 'restored') &&
          rows.some((row) => row.id === prepared.id && row.phase === 'prepared'),
        'Rejected receive altered recovery evidence.'
      );
    });
  },
  async 'malformed multi-entry backups restore nothing and never import connection credentials'() {
    await withDatabase(async (db) => {
      const prepared = await prepare(
        db,
        scope(),
        globalThis.crypto.randomUUID(),
        await evidence(),
        qualified
      );
      const json = await backup(db, scope());
      for (const mutate of [
        (v) => {
          v.entries.push({ ...v.entries[0], operationId: 'invalid' });
        },
        (v) => {
          v.entries[0].attempt = {
            id: globalThis.crypto.randomUUID(),
            startedAt: new Date().toISOString()
          };
        },
        (v) => {
          v.entries[0].phase = 'uncertain';
        },
        (v) => {
          v.entries[0].refresh_token = 'secret';
        },
        (v) => {
          v.entries[0].evidence.remote.originals[0].body = '{}';
        },
        (v) => {
          v.entries = Array.from({ length: limits.entries + 1 }, () => v.entries[0]);
        }
      ]) {
        const value = JSON.parse(json);
        mutate(value);
        await rejects(() => restore(db, scope(), JSON.stringify(value)));
        equal(await read(db, scope()), [prepared], 'Invalid backup partially replaced local data.');
      }
    });
  },
  async 'account boundaries apply to reads, mutations and restore without rebinding'() {
    await withDatabase(async (db) => {
      const prepared = await prepare(
        db,
        scope(),
        globalThis.crypto.randomUUID(),
        await evidence(),
        qualified
      );
      equal(await read(db, scope('reader-b')), [], 'Another account could read intent.');
      await rejects(
        () => attempt(db, scope('reader-b'), prepared.id, prepared.revision, qualified),
        'stale'
      );
      await rejects(() => abandon(db, scope('reader-b'), prepared.id, prepared.revision), 'stale');
      const json = await backup(db, scope());
      await rejects(() => restore(db, scope('reader-b'), json), 'invalid');
      equal(await read(db, scope()), [prepared], 'Foreign account mutation changed intent.');
    });
  },
  async 'bounded retention refuses new work without evicting recovery evidence'() {
    await withDatabase(async (db) => {
      for (let index = 0; index < limits.entries; index++)
        await prepare(db, scope(), globalThis.crypto.randomUUID(), await evidence(`book-${index}`));
      const before = await backup(db, scope());
      await rejects(
        async () =>
          prepare(db, scope(), globalThis.crypto.randomUUID(), await evidence('one-too-many')),
        'capacity'
      );
      equal(
        await backup(db, scope()),
        before,
        'Storage pressure evicted or mutated an earlier recovery record.'
      );
    });
  }
};
export const caseNames = Object.keys(cases);
export async function runCase(name) {
  if (!cases[name]) throw new Error(`Unknown journal case: ${name}`);
  try {
    await cases[name]();
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
  return { name, state: 'passed' };
}
