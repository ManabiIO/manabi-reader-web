import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

const source = readFileSync(
  new URL('../../apps/web/src/lib/library/commands.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
assert.equal(compiled.diagnostics.length, 0);

// These tests isolate the live ownership check. Account lifetime, input
// snapshots and failure rollback have separate production-command coverage.
function fixture(libraryOwner, accountId) {
  let saved = { dataId: 1, progress: 0.2, lastBookmarkModified: 10 };
  let notifications = 0;
  let stopped = 0;
  const before = globalThis.structuredClone(saved);
  const db = {
    transaction(names) {
      let pending;
      let active = true;
      let reject;
      const done = new Promise((resolve, fail) => {
        reject = fail;
        setImmediate(() => {
          if (!active) return;
          if (pending) saved = pending;
          active = false;
          resolve();
        });
      });
      return {
        done,
        abort() {
          if (!active) throw new Error('Already settled.');
          active = false;
          reject(new Error('Aborted.'));
        },
        objectStore(name) {
          assert.ok(names.includes(name));
          return {
            async get(id) {
              assert.equal(id, 1);
              if (name === 'data') return { id, libraryOwner };
              if (name === 'readerBookScope')
                return accountId === undefined ? undefined : { bookId: id, accountId };
              assert.equal(name, 'bookmark');
              return globalThis.structuredClone(saved);
            },
            async put(value) {
              assert.equal(name, 'bookmark');
              pending = globalThis.structuredClone(value);
            }
          };
        }
      };
    }
  };
  const imports = {
    '$lib/data/store': {
      database: { db: Promise.resolve(db), bookmarksChanged$: { next: () => notifications++ } }
    },
    './completion': { calendarDay: () => '2026-09-28', validDay: () => true },
    '$lib/manabi/operation-scope': {
      captureLibraryOperation: () => ({
        profileId: 'alice',
        signal: new AbortController().signal,
        assertCurrent() {},
        stop: () => stopped++
      })
    },
    '$lib/data/database/books-db/commit-transaction.mjs': transactions
  };
  const module = { exports: {} };
  compileFunction(compiled.outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    },
    module,
    module.exports
  );
  return {
    command: module.exports,
    result: () => ({ saved, notifications, stopped }),
    before
  };
}
for (const owner of [undefined, 'alice']) {
  test(`a foreign legacy scope blocks completion with libraryOwner=${owner}`, async () => {
    const f = fixture(owner, 'bob');
    await assert.rejects(f.command.setCompletion(1, 'finished'), /another account/);
    assert.deepEqual(f.result(), { saved: f.before, notifications: 0, stopped: 1 });
  });
}
for (const owner of [undefined, 'alice']) {
  test(`a permitted legacy scope preserves completion and position (${owner})`, async () => {
    const f = fixture(undefined, owner);
    await f.command.setCompletion(1, 'finished');
    const { saved, notifications, stopped } = f.result();
    assert.equal(saved.dataId, 1);
    assert.equal(saved.progress, f.before.progress);
    assert.equal(saved.completion.state, 'finished');
    assert.equal(notifications, 1);
    assert.equal(stopped, 1);
  });
}
