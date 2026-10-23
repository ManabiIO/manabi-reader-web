/** @license BSD-3-Clause */
import { createBooksDb } from '../../apps/web/src/lib/data/database/books-db/factory.ts';
import { encodeBook } from '../../apps/web/src/lib/data/database/books-db/book-binary.ts';
import { identifyReaderBook } from '../../apps/web/src/lib/manabi/reader-book-identity.ts';
import { prepareReaderImportContent } from '../../apps/web/src/lib/manabi/reader-import-content.ts';
import { compareReaderBridgeLocalBook as compare } from '../../apps/web/src/lib/manabi/reader-bridge-local-book.ts';
import { projectReaderBridgeFiles as project } from '../../apps/web/src/lib/manabi/reader-bridge-projection.ts';
import {
  reviewReaderBridgeLocalChanges as review,
  receiveReaderBridgeLocalChanges as receive
} from '../../apps/web/src/lib/manabi/reader-bridge-local-state.ts';
import {
  exportReaderBridgeRecovery as backup,
  restoreReaderBridgeRecovery as restore
} from '../../apps/web/src/lib/manabi/reader-bridge-journal.ts';

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const scope = (signal) => ({ profileId: 'alice', signal, assertCurrent() {} });
const journalScope = () => ({ accountId: 'alice', assertCurrent() {} });
const raw = () => ({
  title: '本',
  elementHtml: '<p id="start">日本語</p>',
  styleSheet: '',
  sections: [],
  blobs: { image: new Blob([new Uint8Array([1, 2, 3])]) }
});
const mark = (progress) => ({
  dataId: 1,
  progress,
  exploredCharCount: progress * 100,
  lastBookmarkModified: 10
});
const day = (dateKey = '2026-10-01', readingTime = 100) => ({
  title: '本',
  dateKey,
  charactersRead: 20,
  readingTime,
  minReadingSpeed: 12,
  altMinReadingSpeed: 12,
  lastReadingSpeed: 12,
  maxReadingSpeed: 12,
  lastStatisticModified: 10
});
const localUuid = '00000000-0000-4000-8000-000000000001';
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
  throw new Error(`Expected rejection: ${code}`);
}
async function remote(progress = 0.5, days = [day()], profile = 'ttu-1-6', extras = {}) {
  const { fingerprint } = await identifyReaderBook(raw(), 100);
  const version = profile.split('-').slice(1).join('_');
  return project(
    {
      fingerprint,
      profile,
      binding: 'drive-book',
      generation: 'connection',
      revision: globalThis.crypto.randomUUID()
    },
    { title: '本', characters: 100 },
    [
      ...(progress == null
        ? []
        : [
            {
              name: `progress_${version}_10_${progress}.json`,
              body: JSON.stringify({ ...mark(progress), ...extras })
            }
          ]),
      ...(days.length
        ? [
            {
              name: `statistics_${version}_0_${Array(12).fill('0').join('_')}_na.json`,
              body: JSON.stringify(days)
            }
          ]
        : [])
    ]
  );
}
async function setup(work) {
  const name = `reader-receive-${globalThis.crypto.randomUUID()}`;
  const db = await createBooksDb(name);
  await db.put(
    'data',
    await encodeBook({
      ...prepareReaderImportContent(raw(), document),
      id: 1,
      characters: 100,
      hasThumb: false,
      lastBookModified: 1,
      lastBookOpen: 1
    })
  );
  try {
    await work(db, name);
  } finally {
    db.close();
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = resolve;
      r.onerror = () => reject(r.error);
    });
  }
}
async function prepare(db, incoming, operationScope = scope()) {
  const match = await compare(db, operationScope, raw(), 100, 1, document);
  assert(match.matches, 'Fixture did not match.');
  return review(db, operationScope, match, incoming, { title: '本', characters: 100 });
}
async function dataState(db) {
  const names = [
    'data',
    'bookmark',
    'statistic',
    'readerStatistic',
    'readerLocalIdentity',
    'readerBookScope',
    'readerStatisticMigration',
    'lastModified'
  ];
  const tx = db.transaction(names);
  const out = await Promise.all(names.map((name) => tx.objectStore(name).getAll()));
  await tx.done;
  return JSON.stringify(out, (_key, value) =>
    value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value
  );
}
const cases = {
  async 'review is read-only and initial receive atomically retains evidence and local data'() {
    await setup(async (db) => {
      const before = await dataState(db),
        incoming = await remote();
      const pending = await prepare(db, incoming);
      assert(
        before === (await dataState(db)) && (await db.count('readerBridgeJournal')) === 0,
        'Review wrote data.'
      );
      assert(
        pending.plan.state === 'ready' && pending.plan.pull.length === 2,
        'Initial pull not prepared.'
      );
      let observations = 0;
      const accepted = await receive(pending, 'incoming', async () => {
        observations++;
      });
      assert(
        observations === 2 && accepted.phase === 'accepted',
        'Missing observation or acceptance.'
      );
      const saved = await db.get('bookmark', 1),
        rows = await db.getAll('readerStatistic');
      assert(
        saved.progress === 0.5 &&
          saved.lastBookmarkModified > 10 &&
          rows.length === 1 &&
          rows[0].readingTime === 100,
        'Incoming values not saved.'
      );
      assert((await db.get('readerBookScope', 1)).accountId === 'alice', 'Missing personal scope.');
      assert(
        accepted.entry.evidence.remote.originals[0].body === incoming.originals[0].body,
        'Original source text lost.'
      );
      assert(
        Object.keys(accepted.entry.acceptance.baseline.local.records).length === 2,
        'Missing agreed baseline.'
      );
    });
  },
  async 'initial differences require a deliberate Drive choice and replace rather than sum totals'() {
    await setup(async (db) => {
      await db.put('bookmark', mark(0.8));
      await db.put('statistic', day('2026-10-01', 900));
      const pending = await prepare(db, await remote());
      assert(
        pending.plan.state === 'review' && pending.plan.conflicts.length === 2,
        'Different copies bypassed review.'
      );
      const before = await dataState(db);
      await rejects(() => receive(pending, 'incoming', async () => {}), 'recovery');
      assert(before === (await dataState(db)), 'Unapproved conflict changed data.');
      const accepted = await receive(pending, 'use-drive', async () => {});
      const rows = await db.getAll('readerStatistic');
      assert(
        accepted.phase === 'accepted' && rows[0].readingTime === 100,
        'Daily totals were summed or maximized.'
      );
      assert(
        (await db.get('statistic', ['本', '2026-10-01'])).readingTime === 900,
        'Legacy recovery evidence removed.'
      );
      assert(
        (await db.get('readerStatisticMigration', '本')).state === 'assigned',
        'Legacy rows would be counted twice.'
      );
    });
  },
  async 'acceptance carries only agreement while keeping local-only reading days pending'() {
    await setup(async (db) => {
      await db.put('statistic', day('2026-10-02', 77));
      const incoming = await remote();
      const pending = await prepare(db, incoming);
      assert(pending.plan.pending.includes('statistics/2026-10-02'), 'Local-only day disappeared.');
      const first = await receive(pending, 'incoming', async () => {});
      assert(
        !first.entry.acceptance.baseline.local.records['statistics/2026-10-02'],
        'Unsent local day was acknowledged.'
      );
      const second = await prepare(db, await remote(0.3));
      assert(second.plan.pull.includes('resume'), 'A backwards remote position was ignored.');
      await receive(second, 'incoming', async () => {});
      assert(
        (await db.get('bookmark', 1)).progress === 0.3 &&
          (await db.getAll('readerStatistic')).length === 2,
        'Receive lost pending history.'
      );
      const entries = await db.getAll('readerBridgeJournal');
      assert(
        entries.filter((row) => row.phase === 'accepted').length === 1 &&
          entries.some((row) => row.phase === 'superseded'),
        'Multiple active acceptances.'
      );
    });
  },
  async 'assigned legacy rows are not counted again and ambiguous histories pause'() {
    await setup(async (db) => {
      await db.put('readerLocalIdentity', { bookId: 1, uuid: localUuid });
      await db.put('statistic', day('2026-10-01', 999));
      await db.put('readerStatistic', { ...day(), bookKey: `local:${localUuid}` });
      await db.put('readerStatisticMigration', {
        title: '本',
        state: 'assigned',
        bookKey: `local:${localUuid}`
      });
      const prepared = await prepare(db, await remote());
      assert(
        prepared.local.values['statistics/2026-10-01'].readingTime === 100,
        'Retained legacy row counted again.'
      );
      await db.put('readerStatisticMigration', { title: '本', state: 'ambiguous' });
      await rejects(async () => prepare(db, await remote()), 'statistics-review');
    });
  },
  async 'changed content, current position and history invalidate a reviewed receive'() {
    for (const kind of ['bytes', 'position', 'history'])
      await setup(async (db) => {
        const pending = await prepare(db, await remote());
        if (kind === 'bytes') {
          const book = await db.get('data', 1);
          new Uint8Array(book.blobs.image.bytes)[0] = 9;
          await db.put('data', book);
        }
        if (kind === 'position') await db.put('bookmark', mark(0.9));
        if (kind === 'history') await db.put('statistic', day('2026-10-02', 123));
        const before = await dataState(db);
        await rejects(() => receive(pending, 'incoming', async () => {}), 'changed');
        assert(before === (await dataState(db)), 'Stale receive changed data.');
        assert(
          (await db.getAll('readerBridgeJournal')).every((row) => row.phase !== 'accepted'),
          'Failed receive acknowledged.'
        );
      });
  },
  async 'late remote change and cancellation leave local data and acceptance untouched'() {
    await setup(async (db) => {
      const pending = await prepare(db, await remote());
      const before = await dataState(db);
      let calls = 0;
      await rejects(() =>
        receive(pending, 'incoming', async () => {
          if (++calls === 2) throw new Error('remote changed');
        })
      );
      assert(before === (await dataState(db)), 'Changed remote applied.');
      const controller = new AbortController();
      controller.abort();
      await rejects(
        () => receive(pending, 'incoming', async () => {}, controller.signal),
        'AbortError'
      );
      assert(before === (await dataState(db)), 'Canceled receive applied.');
    });
  },
  async 'a lost result can be retried without replaying over later local reading'() {
    await setup(async (db) => {
      const pending = await prepare(db, await remote());
      const accepted = await receive(pending, 'incoming', async () => {});
      await db.put('bookmark', mark(0.9));
      const retried = await receive(pending, 'incoming', async () => {});
      assert(
        retried.id === accepted.id && (await db.get('bookmark', 1)).progress === 0.9,
        'Retry overwrote newer local reading.'
      );
      assert((await db.count('readerBridgeJournal')) === 1, 'Retry created another operation.');
    });
  },
  async 'abort after a successful local put rolls back data, legacy assignment and acceptance'() {
    await setup(async (db) => {
      await db.put('statistic', day('2026-10-02', 33));
      const controller = new AbortController();
      const property = (object, key) => {
        const value = Reflect.get(object, key);
        return typeof value === 'function' ? value.bind(object) : value;
      };
      const guarded = new Proxy(db, {
        get(object, key) {
          if (key !== 'transaction') return property(object, key);
          return (...args) => {
            const tx = object.transaction(...args);
            if (args[1] !== 'readwrite' || !Array.isArray(args[0]) || !args[0].includes('bookmark'))
              return tx;
            return new Proxy(tx, {
              get(transaction, name) {
                if (name !== 'objectStore') return property(transaction, name);
                return (storeName) => {
                  const store = transaction.objectStore(storeName);
                  if (storeName !== 'bookmark') return store;
                  return new Proxy(store, {
                    get(value, method) {
                      if (method !== 'put') return property(value, method);
                      return async (...parameters) => {
                        const result = await value.put(...parameters);
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
      const pending = await prepare(guarded, await remote());
      const before = await dataState(db);
      await rejects(
        () => receive(pending, 'incoming', async () => {}, controller.signal),
        'AbortError'
      );
      assert((await dataState(db)) === before, 'Successful requests escaped aborted transaction.');
      assert(
        (await db.getAll('readerBridgeJournal')).every((row) => row.phase !== 'accepted'),
        'Aborted data was acknowledged.'
      );
    });
  },
  async 'missing remote records are not deletion instructions even after explicit Drive selection'() {
    await setup(async (db) => {
      await receive(await prepare(db, await remote()), 'incoming', async () => {});
      const pending = await prepare(db, await remote(null, []));
      assert(
        pending.plan.conflicts.some((item) => item.reason === 'removed'),
        'Missing rows were silently forgotten.'
      );
      const before = await dataState(db);
      await rejects(() => receive(pending, 'use-drive', async () => {}), 'recovery');
      assert(before === (await dataState(db)), 'Missing remote rows deleted local reading data.');
    });
  },
  async 'concurrent receives have one acceptance and cannot apply twice'() {
    await setup(async (db) => {
      const pending = await prepare(db, await remote());
      const results = await Promise.allSettled([
        receive(pending, 'incoming', async () => {}),
        receive(pending, 'incoming', async () => {})
      ]);
      assert(
        results.some((value) => value.status === 'fulfilled'),
        'Neither receive succeeded.'
      );
      assert(
        (await db.getAll('readerBridgeJournal')).filter((row) => row.phase === 'accepted')
          .length === 1,
        'Duplicate acceptance.'
      );
      assert((await db.count('readerStatistic')) === 1, 'Duplicate daily row.');
    });
  },
  async 'unsupported Yatsu fields and unknown local fields pause instead of being discarded'() {
    await setup(async (db) => {
      const withLayout = await remote(0.5, [day()], 'yatsu-1-11', { targetSectionIndex: 0 });
      await rejects(() => prepare(db, withLayout), 'unsupported-mapping');
      const withDictionary = await remote(
        0.5,
        [{ ...day(), dictionaryPopupOpenCount: 0 }],
        'yatsu-1-11'
      );
      await rejects(() => prepare(db, withDictionary), 'unsupported-mapping');
      await db.put('bookmark', { ...mark(0.2), unknownLocator: 'keep me' });
      await rejects(async () => prepare(db, await remote()), 'unsupported-mapping');
    });
  },
  async 'a content comparison cannot be reused for another package or fabricated review'() {
    await setup(async (db) => {
      const match = await compare(db, scope(), raw(), 100, 1, document);
      const incoming = await remote();
      await rejects(
        () => review(db, scope(), { ...match }, incoming, { title: '本', characters: 100 }),
        'unavailable'
      );
      const other = {
        ...incoming,
        snapshot: { ...incoming.snapshot, fingerprint: 'f'.repeat(64) }
      };
      await rejects(
        () => review(db, scope(), match, other, { title: '本', characters: 100 }),
        'changed'
      );
      const pending = await prepare(db, incoming);
      await rejects(() => receive({ ...pending }, 'incoming', async () => {}), 'changed');
    });
  },
  async 'accepted recovery is versioned, inert and cannot forge a different agreement'() {
    await setup(async (db) => {
      const pending = await prepare(db, await remote());
      await receive(pending, 'incoming', async () => {});
      const before = await dataState(db),
        json = await backup(db, journalScope());
      assert(JSON.parse(json).version === 2, 'Acceptance did not version the portable envelope.');
      assert(
        (await restore(db, journalScope(), json)) === 1 &&
          (await restore(db, journalScope(), json)) === 0,
        'Recovery was not idempotent.'
      );
      assert(before === (await dataState(db)), 'Restoring acceptance applied reading data.');
      const rows = await db.getAll('readerBridgeJournal');
      assert(
        rows.filter((row) => row.phase === 'accepted').length === 1 &&
          rows.some((row) => row.phase === 'restored'),
        'Restored acceptance became active.'
      );
      const invalid = JSON.parse(json);
      invalid.entries[0].acceptance.baseline.local.records.resume = 'f'.repeat(64);
      await rejects(() => restore(db, journalScope(), JSON.stringify(invalid)), 'invalid');
    });
  }
};
export const caseNames = Object.keys(cases);
export async function runCase(name) {
  if (!cases[name]) throw new Error(name);
  await cases[name]();
  return { state: 'passed', name };
}
