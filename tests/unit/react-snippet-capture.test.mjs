/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule, storeBoundary, deferred } from './fixtures/offline-module.mjs';

function fixture() {
  const { writable } = storeBoundary();
  const account = writable({ status: 'ready' }), localUser = writable(null),
    snippetItems = writable([]), listeners = new Map();
  const saved = [], appended = [];
  let owner = null, generation = 0, cleanupFailure = false, saveGate;
  const scope = () => {
    const captured = generation;
    return { owner: owner === null ? 'local' : 'account:' + owner,
      guard() { if (captured !== generation) throw new Error('Account changed'); } };
  };
  const { api } = loadOfflineModule('apps/web/src/snippets-react/capture-controller.ts', {
    modules: {
      react: {},
      '../lib/manabi/client': { account, localUser },
      '$app/navigation': { goto: async () => {} },
      '$app/paths': { resolve: value => value },
      '../lib/snippets/service': { scope, snippetItems,
        appendToSnippet: async (id, content, session, selected) => {
          selected.guard(); appended.push({ id, content, session });
        },
        flushSnippets: async () => {} },
      '../lib/snippets/database': {
        recordKey: (owner, id) => owner + '/' + id,
        saveDraft: async (value, guard) => {
          if (saveGate) await saveGate.promise;
          guard(); saved.push(value);
        },
        deleteDraft: async (_key, guard) => {
          guard(); if (cleanupFailure) throw new Error('Storage unavailable');
        }
      },
      '../lib/snippets/editor': {
        importContent: text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
      }
    },
    globals: { queueMicrotask,
      window: {
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); }
      }
    }
  });
  const c = api.createCapture({});
  c.controller.prepare(); c.controller.start();
  return { c, saved, appended,
    receive: (text, title = text) => listeners.get('manabi-capture-snippet')({ detail: { html: text, title, item: text, owner } }),
    changeOwner(next) { owner = next; generation++; localUser.set(next ? { id: next } : null); },
    failCleanup() { cleanupFailure = true; },
    delaySave() { return saveGate = deferred(); }
  };
}

test('React capture durably keeps concurrent and open-dialog selections without replacing the first dialog', async () => {
  const f = fixture();
  try {
    await Promise.all([f.receive('first'), f.receive('second')]);
    assert.equal(f.saved.length, 2);
    assert.notEqual(f.saved[0].session, f.saved[1].session);
    assert.equal(f.c.document.source.title, 'first');
    assert.equal(f.c.open, true);
    assert.match(f.c.status, /1 additional selection saved/);
    await f.receive('third');
    assert.equal(f.saved.length, 3);
    assert.equal(f.c.document.source.title, 'first');
    assert.match(f.c.status, /2 additional selections saved/);
  } finally { f.c.controller.destroy(); }
});

test('React capture does not invite another append when post-commit draft cleanup fails', async () => {
  const f = fixture();
  try {
    await f.receive('captured');
    f.failCleanup();
    await f.c.append('destination');
    assert.equal(f.appended.length, 1);
    assert.equal(f.c.open, false);
    assert.equal(f.c.error, '');
    assert.match(f.c.status, /Added to snippet/);
    assert.match(f.c.status, /recoverable/);
  } finally { f.c.controller.destroy(); }
});

test('React capture cannot save an old-account selection after account replacement', async () => {
  const f = fixture(), gate = f.delaySave();
  try {
    const pending = f.receive('old account');
    f.changeOwner('new-account');
    gate.resolve();
    await pending;
    assert.equal(f.saved.length, 0);
    assert.equal(f.c.open, false);
  } finally { f.c.controller.destroy(); }
});

test('React capture preserves an admitted draft but cannot reopen a disposed dialog', async () => {
  const f = fixture(), gate = f.delaySave();
  const pending = f.receive('departing capture', 'a'.repeat(999) + '😀');
  f.c.controller.destroy();
  gate.resolve();
  await pending;
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].document.source.title, 'a'.repeat(999));
  assert.equal(f.c.open, false);
});
