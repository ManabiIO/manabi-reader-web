import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import {
  commitLibraryBook as commit,
  readIndexedBookIdentities,
  readLibraryIdentities
} from '../../apps/web/src/lib/data/database/books-db/library-import.ts';

const hash = 'a'.repeat(64);
const other = 'b'.repeat(64);
const source = { id: 'disk', owner: null, root: '' };
const request = (changes = {}) => ({ source, fileId: 'copy.epub', contentHash: hash, ...changes });
const prepared = (changes = {}) => ({
  title: 'Book',
  contentHash: hash,
  elementHtml: '<p>Read</p>',
  blobs: {},
  lastBookOpen: 10,
  lastBookModified: 10,
  ...changes
});
const record = (id, changes = {}) => ({ id, ...prepared(), ...changes });
const link = (bookId, changes = {}) => ({
  id: `link-${bookId}`,
  bookId,
  sourceId: source.id,
  owner: null,
  root: '',
  fileId: 'original.epub',
  contentHash: hash,
  ...changes
});

// Only the IndexedDB transport is substituted. The actual cursor projection,
// identity decision, insertion, placeholder hydration and transaction wrapper run.
function harness(initial, { onAdd, onPut, manual = false } = {}) {
  let rows = new Map(initial.map((row) => [row.id, row]));
  const writes = [];
  let opened = 0;
  let payloadCursors = 0;
  let payloadGets = 0;
  let complete;
  const db = {
    transaction(name) {
      assert.equal(name, 'data');
      opened++;
      const draft = new Map(rows);
      let settle;
      let reject;
      let settled = false;
      const done = new Promise((yes, no) => {
        settle = yes;
        reject = no;
      });
      const finish = (failure) => {
        if (settled) return;
        settled = true;
        if (failure) reject(failure);
        else {
          rows = draft;
          settle();
        }
      };
      complete = finish;
      const tx = {
        done,
        abort: () => finish(new DOMException('rollback', 'AbortError')),
        store: {
          async openCursor() {
            payloadCursors++;
            const values = [...draft.values()];
            const cursor = (i) =>
              i < values.length ? { value: values[i], continue: async () => cursor(i + 1) } : null;
            return cursor(0);
          },
          async get(id) {
            payloadGets++;
            return draft.get(id);
          },
          index(name) {
            assert.ok(['title', 'contentHash', 'libraryOwner'].includes(name));
            const values = [...draft.values()].filter((row) => row[name] !== undefined);
            const cursor = (i) =>
              i < values.length
                ? {
                    key: values[i][name],
                    primaryKey: values[i].id,
                    continue: async () => cursor(i + 1)
                  }
                : null;
            return {
              openKeyCursor: async () => cursor(0),
              async getKey(value) {
                return values.find((row) => row[name] === value)?.id;
              }
            };
          },
          async add(value) {
            const id = value.id ?? Math.max(100, ...draft.keys()) + 1;
            assert.equal(draft.has(id), false);
            const row = { ...value, id };
            draft.set(id, row);
            writes.push(['add', row]);
            onAdd?.();
            return id;
          },
          async put(value) {
            draft.set(value.id, value);
            writes.push(['put', value]);
            onPut?.();
            return value.id;
          }
        }
      };
      if (!manual) setImmediate(() => finish());
      return tx;
    }
  };
  return {
    db,
    writes,
    rows: () => [...rows.values()],
    opened: () => opened,
    payloadCursors: () => payloadCursors,
    payloadGets: () => payloadGets,
    finish: (error) => complete(error)
  };
}
const current = () => {};

test('identity inspection retains metadata but not every book payload and resource buffer', async () => {
  const h = harness([record(1, { blobs: { huge: new ArrayBuffer(100) }, htmlBackup: 'source' })]);
  const values = await readLibraryIdentities(h.db);
  assert.deepEqual(values, [
    { id: 1, title: 'Book', contentHash: hash, libraryOwner: undefined, isPlaceholder: false }
  ]);
  assert.equal(h.writes.length, 0);
});

test('indexed identity projection never opens a payload cursor or fetches book values', async () => {
  const h = harness([
    record(1, { blobs: { huge: new ArrayBuffer(100) }, libraryOwner: 'alice' }),
    record(2, { contentHash: other, blobs: { huge: new ArrayBuffer(200) } })
  ]);
  const values = await readIndexedBookIdentities(h.db);
  assert.deepEqual(values, [
    { id: 1, contentHash: hash, libraryOwner: 'alice' },
    { id: 2, contentHash: other }
  ]);
  assert.equal(h.payloadCursors(), 0);
  assert.equal(h.payloadGets(), 0);
});

test('commit scans compact identity keys and loads only the selected full book', async () => {
  const unrelated = Array.from({ length: 40 }, (_, index) =>
    record(100 + index, {
      title: `Unrelated ${index}`,
      contentHash: (index + 1).toString(16).padStart(64, '0'),
      blobs: { huge: new ArrayBuffer(256) }
    })
  );
  const h = harness([...unrelated, record(1)]);
  const result = await commit(h.db, [], request(), undefined, current);
  assert.equal(result.id, 1);
  assert.equal(h.payloadCursors(), 0);
  assert.equal(h.payloadGets(), 1);
});

test('all browser-only histories are checked before any import write', async () => {
  const h = harness([record(1), record(2)]);
  await assert.rejects(commit(h.db, [], request(), prepared(), current), /multiple saved/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.rows().length, 2);
});

test('a valid exact link is reused without replacing its content or personal metadata', async () => {
  const saved = record(1, { title: 'Custom', elementHtml: 'Keep', lastBookOpen: 900 });
  const h = harness([saved, record(2)]);
  const links = [link(1, { fileId: 'copy.epub' }), link(2)];
  const result = await commit(h.db, links, request(), prepared(), current);
  assert.equal(result.id, 1);
  assert.equal(result.title, 'Custom');
  assert.equal(h.writes.length, 0);
  assert.equal(h.rows()[0], saved);
});

test('reopening a legacy cloud copy durably records its account scope', async () => {
  const saved = record(1, { title: 'Custom', elementHtml: 'Keep', lastBookOpen: 900 });
  const h = harness([saved]);
  const alice = request({ source: { ...source, owner: 'alice' } });
  const links = [link(1, { owner: 'alice', fileId: 'copy.epub' })];
  const result = await commit(h.db, links, alice, undefined, current);
  assert.equal(result.id, 1);
  assert.equal(h.rows()[0].libraryOwner, 'alice');
  assert.equal(h.rows()[0].elementHtml, 'Keep');
  assert.equal(h.rows()[0].lastBookOpen, 900);
});

for (const placeholder of [false, true]) {
  test(`session revocation rolls back ${placeholder ? 'placeholder hydration' : 'legacy owner promotion'}`, async () => {
    const saved = record(1, { elementHtml: placeholder ? '' : 'Keep', lastBookOpen: 900 });
    let valid = true;
    const h = harness([saved], { onPut: () => (valid = false) });
    // A cloud session generation can change while the local profile remains
    // the same, so the profile AbortSignal alone does not fence this write.
    const controller = new AbortController();
    const failure = new Error('session revoked');
    const check = () => {
      if (!valid) throw failure;
    };
    await assert.rejects(
      commit(
        h.db,
        [link(1, { owner: 'alice', fileId: 'copy.epub' })],
        request({ source: { ...source, owner: 'alice' } }),
        prepared(),
        check,
        controller.signal
      ),
      (error) => error === failure
    );
    assert.equal(controller.signal.aborted, false);
    assert.equal(h.writes.length, 1, 'a pending write must be rolled back');
    assert.deepEqual(h.rows(), [saved]);
  });
}

test('a deleted expected book is never recreated from a previously prepared import', async () => {
  const h = harness([]);
  await assert.rejects(
    commit(h.db, [link(1)], request({ expectedBookId: 1 }), prepared(), current),
    /changed/
  );
  assert.equal(h.writes.length, 0);
});

test('dangling old links do not permanently block reimporting removed browser data', async () => {
  const h = harness([]);
  const result = await commit(h.db, [link(1), link(2)], request(), prepared(), current);
  assert.equal(result.id, 101);
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].contentHash, hash);
});

test('a mismatched stored hash cannot be reused through an old exact file link', async () => {
  const saved = record(1, { contentHash: other, elementHtml: 'Different content' });
  const h = harness([saved]);
  const links = [link(1, { fileId: 'copy.epub' })];
  const result = await commit(h.db, links, request(), prepared(), current);
  assert.notEqual(result.id, 1);
  assert.equal(h.rows()[0], saved);
  assert.equal(h.writes.filter(([kind]) => kind === 'put').length, 0);
});

test('same-title and same-hash foreign account records cannot be overwritten by upsert', async () => {
  const saved = record(1);
  const h = harness([saved]);
  const links = [link(1, { owner: 'bob' })];
  const intent = request({ source: { ...source, owner: 'alice' } });
  const result = await commit(h.db, links, intent, prepared(), current);
  assert.notEqual(result.id, 1);
  assert.equal(result.title, `Book [${hash.slice(0, 10)}]`);
  assert.equal(h.rows()[0], saved);
  assert.equal(h.writes.filter(([kind]) => kind === 'put').length, 0);
});

test('a cloud import keeps its owner if link publication fails after book commit', async () => {
  const h = harness([]);
  const alice = request({ source: { ...source, owner: 'alice' } });
  const imported = await commit(h.db, [], alice, prepared(), current);
  assert.equal(h.rows()[0].libraryOwner, 'alice');
  const bob = await commit(
    h.db,
    [],
    request({ source: { ...source, owner: 'bob' } }),
    prepared(),
    current
  );
  assert.notEqual(bob.id, imported.id);
  assert.equal(h.rows()[0].libraryOwner, 'alice');
});

test('a matching book inserted while parsing is reused without replacing newer content', async () => {
  const newer = record(4, {
    title: 'Newer title',
    elementHtml: 'Newer parsed snapshot',
    lastBookOpen: 999
  });
  const h = harness([newer]);
  const result = await commit(h.db, [], request(), prepared(), current);
  assert.equal(result.id, 4);
  assert.equal(h.rows()[0], newer);
  assert.equal(h.writes.length, 0);
});

test('an exact placeholder is filled without changing its book identity or last-read timestamp', async () => {
  const h = harness([record(7, { elementHtml: '', title: 'Retained', lastBookOpen: 999 })]);
  const result = await commit(h.db, [link(7)], request({ expectedBookId: 7 }), prepared(), current);
  assert.equal(result.id, 7);
  assert.equal(h.rows()[0].title, 'Retained');
  assert.equal(h.rows()[0].lastBookOpen, 999);
  assert.equal(h.rows()[0].elementHtml, '<p>Read</p>');
});

test('no prepared payload cannot turn a missing local book into a successful open', async () => {
  const h = harness([]);
  await assert.rejects(commit(h.db, [], request(), undefined, current), /changed/);
  assert.equal(h.writes.length, 0);
});

test('prepared bytes with a different identity fail before opening storage', async () => {
  const h = harness([]);
  await assert.rejects(
    commit(h.db, [], request(), prepared({ contentHash: other }), current),
    /does not match/
  );
  assert.equal(h.opened(), 0);
});

test('revocation during an IDB request rolls back the newly added book', async () => {
  let valid = true;
  const h = harness([], {
    onAdd: () => {
      valid = false;
    }
  });
  const failure = new Error('scope revoked');
  const check = () => {
    if (!valid) throw failure;
  };
  await assert.rejects(
    commit(h.db, [], request(), prepared(), check),
    (error) => error === failure
  );
  assert.equal(h.writes.length, 1, 'the rollback covers a write that actually occurred');
  assert.deepEqual(h.rows(), []);
});

test('an account abort signal cancels and rolls back a pending storage transaction', async () => {
  const controller = new AbortController();
  const h = harness([], { onAdd: () => controller.abort() });
  await assert.rejects(commit(h.db, [], request(), prepared(), current, controller.signal), {
    name: 'AbortError'
  });
  assert.deepEqual(h.rows(), []);
});

test('an already revoked operation cannot open a transaction', async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness([]);
  await assert.rejects(commit(h.db, [], request(), prepared(), current, controller.signal));
  assert.equal(h.opened(), 0);
});

test('request success does not publish an import until transaction completion', async () => {
  const h = harness([], { manual: true });
  let settled = false;
  const operation = commit(h.db, [], request(), prepared(), current);
  operation.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  h.finish();
  assert.equal((await operation).id, 101);
});

test('commit-time storage failure rejects instead of reporting a saved book', async () => {
  const h = harness([], { manual: true });
  const operation = commit(h.db, [], request(), prepared(), current);
  const checked = assert.rejects(operation, { name: 'QuotaExceededError' });
  await new Promise((resolve) => setImmediate(resolve));
  h.finish(new DOMException('Full', 'QuotaExceededError'));
  await checked;
  assert.deepEqual(h.rows(), []);
});

test('new imports never accept a supplied database primary key from their payload', async () => {
  const h = harness([]);
  const result = await commit(h.db, [], request(), prepared({ id: 999 }), current);
  assert.equal(result.id, 101);
});
