/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

const lib = new URL('../../apps/web/src/lib/', import.meta.url);
const compiled = new Map();
const { structuredClone } = globalThis;

// Execute complete production modules. Only the account store, binary codec and
// IDB transport are controlled; unrelated UI/RxJS constructor work is not run.
function load(path, dependencies = {}) {
  let code = compiled.get(path);
  if (!code) {
    code = ts.transpileModule(readFileSync(new URL(path, lib), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    compiled.set(path, code);
  }
  const exports = {};
  runInNewContext(
    code,
    {
      exports,
      AbortController,
      DOMException,
      Error,
      structuredClone,
      require(name) {
        if (name in dependencies) return dependencies[name];
        return new Proxy(
          {},
          {
            get(_target, property) {
              // TypeScript's CommonJS default-import helper probes this marker
              // before any application code uses the dependency.
              if (property === '__esModule') return false;
              throw new Error(`Unexpected dependency use: ${name}`);
            }
          }
        );
      }
    },
    { filename: path }
  );
  return exports;
}

const identity = load('data/database/books-db/direct-import-identity.ts');
const cancellation = load('functions/replication/replication-error.ts');
const behavior = { NewOnly: 1, Overwrite: 2 };
const hash = 'a'.repeat(64);
const original = {
  id: 7,
  title: 'Established title',
  contentHash: hash,
  lastBookModified: 100,
  lastBookOpen: 90,
  elementHtml: '<p>Original</p>'
};
const incoming = {
  title: 'Renamed file',
  contentHash: hash,
  lastBookModified: 200,
  lastBookOpen: 0,
  elementHtml: '<p>Replacement</p>'
};

class IntegrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fixture({
  rows = [],
  scopes = [],
  profile = 'A',
  hook = () => {},
  encodeError,
  databaseError,
  storageError
} = {}) {
  const listeners = new Set();
  const state = {
    rows: structuredClone(rows),
    writes: 0,
    valueReads: 0,
    transactions: 0,
    phase: 'idle',
    listeners,
    aborts: 0,
    stops: 0,
    user: profile === null ? undefined : { id: profile },
    setProfile(id) {
      state.user = id === null ? undefined : { id };
      for (const notify of [...listeners]) notify(state.user);
    },
    roundTrip() {
      const id = state.user?.id ?? null;
      state.setProfile(id === 'B' ? 'C' : 'B');
      state.setProfile(id);
    }
  };
  const client = {
    IntegrationError,
    accountScope() {
      throw new Error('A local import must not need a live session');
    },
    localProfileUser: () => state.user,
    localUser: {
      subscribe(notify) {
        listeners.add(notify);
        notify(state.user);
        return () => {
          state.stops++;
          listeners.delete(notify);
        };
      }
    }
  };
  const operation = load('manabi/operation-scope.ts', { './client': client });
  const db = {
    transaction(stores, mode) {
      assert.deepEqual(Array.from(stores), ['data', 'readerBookScope']);
      assert.equal(mode, 'readwrite');
      state.transactions++;
      state.phase = 'active';
      const staged = new Map(state.rows.map((row) => [row.id, structuredClone(row)]));
      let resolveDone, rejectDone;
      const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      const abortError = new DOMException('Controlled native abort', 'AbortError');
      const request = async (stage, value) => {
        // IDB request results arrive after upsertData has returned its inner
        // promise. This is also where the broken outer finally unsubscribes.
        await Promise.resolve();
        await hook(stage, state);
        if (state.phase !== 'active') throw abortError;
        return value;
      };
      const keyCursor = (values, index = 0, stage = 'keyCursor') =>
        request(
          stage,
          index >= values.length
            ? null
            : {
                key: values[index].contentHash,
                primaryKey: values[index].id,
                continue: () => keyCursor(values, index + 1, 'keyContinue')
              }
        );
      const write = (value, add) => {
        const id = add ? Math.max(0, ...staged.keys()) + 1 : value.id;
        state.writes++;
        staged.set(id, structuredClone({ ...value, id }));
        return request(add ? 'add' : 'put', id);
      };
      const data = {
        openCursor: () => assert.fail('direct import must not clone every stored book'),
        get: async (id) => {
          state.valueReads++;
          return request('get', structuredClone(staged.get(id)));
        },
        index(name) {
          if (name === 'contentHash')
            return {
              openKeyCursor: () =>
                keyCursor(
                  [...staged.values()].filter((row) => typeof row.contentHash === 'string')
                )
            };
          assert.equal(name, 'title');
          return {
            getAllKeys: (title) =>
              request(
                'titleKeys',
                [...staged.values()].filter((row) => row.title === title).map((row) => row.id)
              )
          };
        },
        add: (value) => write(value, true),
        put: (value) => write(value, false)
      };
      const tx = {
        done,
        objectStore(name) {
          if (name === 'data') return data;
          assert.equal(name, 'readerBookScope');
          return {
            get: (id) =>
              request(
                'scope',
                scopes.find((row) => row.bookId === id)
              )
          };
        },
        abort() {
          state.aborts++;
          if (state.phase !== 'active')
            throw new DOMException('Already finished', 'InvalidStateError');
          state.phase = 'aborted';
          setImmediate(() => rejectDone(abortError));
        }
      };
      // The visible rows change only at commit, separately from request success.
      // Aborting never publishes staged rows. This models transport, not native IDB.
      setImmediate(() => {
        if (state.phase !== 'active') return;
        hook('beforeCommit', state);
        if (state.phase !== 'active') return;
        if (storageError) {
          state.phase = 'aborted';
          rejectDone(storageError);
          return;
        }
        state.rows = [...staged.values()];
        state.phase = 'committed';
        resolveDone();
        hook('afterCommit', state);
      });
      return tx;
    }
  };
  const { DatabaseService } = load('data/database/books-db/database.service.ts', {
    './book-binary': {
      async encodeBook(value) {
        const snapshot = structuredClone(value);
        await hook('encoding', state);
        if (encodeError) throw encodeError;
        return snapshot;
      },
      decodeBook: structuredClone
    },
    './commit-transaction.mjs': transactions,
    './direct-import-identity': identity,
    '$lib/manabi/operation-scope': operation,
    '$lib/functions/replication/replication-error': cancellation,
    '$lib/functions/replication/replication-options': { ReplicationSaveBehavior: behavior }
  });
  const service = Object.create(DatabaseService.prototype);
  service.db = databaseError ? Promise.reject(databaseError) : Promise.resolve(db);
  state.save = (data = incoming, saveBehavior = behavior.Overwrite, signal) =>
    service.upsertData(data, saveBehavior, true, true, signal);
  state.assertReleased = () => {
    assert.equal(listeners.size, 0);
    assert.equal(state.stops, 1);
  };
  return state;
}

const accountChanged = (error) => error?.code === 'account_changed';

test('a normal new import waits for commit and releases its profile subscription', async () => {
  const h = fixture();
  const result = await h.save();
  assert.equal(h.phase, 'committed');
  assert.equal(result.id, 1);
  assert.equal(h.rows[0].title, incoming.title);
  h.assertReleased();
});

test('the profile watcher remains enrolled through final transaction completion', async () => {
  let subscribersAtCommit;
  const h = fixture({
    hook(stage, state) {
      if (stage === 'beforeCommit') subscribersAtCommit = state.listeners.size;
    }
  });
  await h.save();
  assert.equal(subscribersAtCommit, 1);
  h.assertReleased();
});

test('an exact-byte reimport retains its logical ID and title', async () => {
  const h = fixture({ rows: [original], scopes: [{ bookId: 7, accountId: 'A' }] });
  const result = await h.save();
  assert.equal(result.id, 7);
  assert.equal(result.title, original.title);
  assert.equal(result.elementHtml, incoming.elementHtml);
  assert.equal(h.rows.length, 1);
  h.assertReleased();
});

test('content matching reads only same-hash candidate payloads', async () => {
  const unrelated = Array.from({ length: 40 }, (_, index) => ({
    ...original,
    id: 100 + index,
    title: `Unrelated ${index}`,
    contentHash: (index + 1).toString(16).padStart(64, '0')
  }));
  const h = fixture({ rows: [...unrelated, original] });
  const result = await h.save();
  assert.equal(result.id, original.id);
  assert.equal(h.valueReads, 1);
  assert.equal(h.rows.length, unrelated.length + 1);
  h.assertReleased();
});

test('content-hash index matching retains legacy hash casing without payload scans', async () => {
  const upper = { ...original, contentHash: hash.toUpperCase() };
  const h = fixture({ rows: [upper] });
  const result = await h.save();
  assert.equal(result.id, original.id);
  assert.equal(h.valueReads, 1);
  h.assertReleased();
});

test('a different personal owner keeps an independent same-byte history', async () => {
  const h = fixture({ rows: [original], scopes: [{ bookId: 7, accountId: 'B' }] });
  assert.equal((await h.save()).id, 8);
  assert.deepEqual(h.rows[0], original);
  assert.equal(h.rows.length, 2);
  h.assertReleased();
});

test('NewOnly preserves an already newer record without a write', async () => {
  const h = fixture({ rows: [original] });
  const result = await h.save({ ...incoming, lastBookModified: 50 }, behavior.NewOnly);
  assert.deepEqual(result, original);
  assert.equal(h.writes, 0);
  assert.equal(h.phase, 'committed');
  h.assertReleased();
});

for (const stage of ['keyCursor', 'get', 'scope', 'keyContinue', 'put', 'beforeCommit']) {
  test(`account round trip during ${stage} revokes reimport and preserves old data`, async () => {
    const h = fixture({
      rows: [original],
      hook(at, state) {
        if (at === stage) state.roundTrip();
      }
    });
    await assert.rejects(h.save(), accountChanged);
    assert.equal(h.phase, 'aborted');
    assert.deepEqual(h.rows, [original]);
    h.assertReleased();
  });
}

test('account departure after the add request rolls back a new import', async () => {
  const h = fixture({
    hook(stage, state) {
      if (stage === 'add') state.setProfile('B');
    }
  });
  await assert.rejects(h.save(), accountChanged);
  assert.equal(h.phase, 'aborted');
  assert.deepEqual(h.rows, []);
  h.assertReleased();
});

test('a revoked NewOnly no-write result is not returned', async () => {
  const h = fixture({
    rows: [original],
    hook(stage, state) {
      if (stage === 'beforeCommit') state.roundTrip();
    }
  });
  await assert.rejects(
    h.save({ ...incoming, lastBookModified: 50 }, behavior.NewOnly),
    accountChanged
  );
  assert.equal(h.writes, 0);
  assert.deepEqual(h.rows, [original]);
  h.assertReleased();
});

test('a profile change after commit rejects acknowledgment but cannot undo durable data', async () => {
  const h = fixture({
    hook(stage, state) {
      if (stage === 'afterCommit') state.roundTrip();
    }
  });
  await assert.rejects(h.save(), accountChanged);
  assert.equal(h.phase, 'committed');
  assert.equal(h.rows.length, 1);
  h.assertReleased();
});

for (const stage of ['add', 'afterCommit']) {
  test(`caller cancellation during ${stage} preserves its exact reason`, async () => {
    const controller = new AbortController();
    const reason = new Error('Caller cancelled');
    const h = fixture({
      hook(at) {
        if (at === stage) controller.abort(reason);
      }
    });
    await assert.rejects(
      h.save(incoming, behavior.Overwrite, controller.signal),
      (error) => error === reason
    );
    assert.equal(h.rows.length, stage === 'afterCommit' ? 1 : 0);
    h.assertReleased();
  });
}

test('pre-aborted import never opens a write transaction', async () => {
  const controller = new AbortController();
  controller.abort();
  const h = fixture();
  await assert.rejects(h.save(incoming, behavior.Overwrite, controller.signal), {
    name: 'AbortError'
  });
  assert.equal(h.transactions, 0);
  h.assertReleased();
});

test('account round trips during encoding remain revoked before storage', async () => {
  const h = fixture({
    hook(stage, state) {
      if (stage === 'encoding') state.roundTrip();
    }
  });
  await assert.rejects(h.save(), accountChanged);
  assert.equal(h.transactions, 0);
  h.assertReleased();
});

for (const boundary of ['encodeError', 'databaseError', 'storageError']) {
  test(`${boundary} preserves the error and releases the operation`, async () => {
    const error = new DOMException('Controlled quota failure', 'QuotaExceededError');
    const h = fixture({ [boundary]: error });
    await assert.rejects(h.save(), (actual) => actual === error);
    assert.deepEqual(h.rows, []);
    h.assertReleased();
  });
}

test('native transaction abort is still reported as a retryable storage failure', async () => {
  const error = new DOMException('Native abort', 'AbortError');
  const h = fixture({ storageError: error });
  await assert.rejects(
    h.save(),
    (actual) => actual.cause === error && /could not be saved/.test(actual.message)
  );
  assert.deepEqual(h.rows, []);
  h.assertReleased();
});

test('ambiguous exact histories reject without replacing either record', async () => {
  const rows = [original, { ...original, id: 8, title: 'Independent copy' }];
  const h = fixture({ rows });
  await assert.rejects(h.save(), /matches multiple local copies/);
  assert.deepEqual(h.rows, rows);
  assert.equal(h.writes, 0);
  h.assertReleased();
});

test('hashless legacy and anonymous local imports retain their previous behavior', async () => {
  const old = { ...original, contentHash: undefined };
  const h = fixture({ profile: null, rows: [old] });
  const result = await h.save({ ...incoming, title: old.title, contentHash: undefined });
  assert.equal(result.id, 7);
  assert.equal(h.rows.length, 1);
  h.assertReleased();
});
