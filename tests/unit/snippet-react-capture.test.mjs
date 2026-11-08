/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourceRoot = new URL('../../apps/web/src/', import.meta.url);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function store(value) {
  const listeners = new Set();
  return {
    get value() { return value; },
    subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of listeners) fn(value); }
  };
}
function load(relative, imports = {}, window = {}) {
  const url = new URL(relative, sourceRoot);
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    fileName: url.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const module = { exports: {} };
  compileFunction(compiled.outputText, ['require', 'module', 'exports', 'window', 'crypto'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    }, module, module.exports, window, { randomUUID }
  );
  return module.exports;
}

function fixture() {
  let user = { id: 'alice' }, authGeneration = 0;
  const account = store({ status: 'ready' }), localUser = store(user);
  class IntegrationError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  const client = {
    account, localUser, localProfileUser: () => user, currentUser: () => user,
    accountScope: () => ({ generation: authGeneration }), IntegrationError
  };
  // Use shipping account-generation admission and document validation, not a no-op guard.
  const admission = load('lib/snippets/scope.ts', {
    '$lib/state/store': { get: (source) => source.value }, '../manabi/client': client
  });
  const document = load('lib/snippets/document.ts');
  const lifecycle = load('reader-react/controller.ts', { react: {} });
  const listeners = new Map(), drafts = [], appends = [], flushes = [];
  const behavior = {};
  const window = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const service = {
    scope: admission.scope,
    snippetItems: store([]),
    async appendToSnippet(id, content, operation, selected) {
      selected.guard();
      await behavior.append?.();
      selected.guard();
      appends.push({ id, content, operation, owner: selected.owner });
    },
    async flushSnippets(selected) { selected.guard(); flushes.push(selected.owner); }
  };
  const database = {
    recordKey: (owner, session) => owner + ':' + session,
    async saveDraft(record, guard) {
      guard();
      await behavior.save?.(record);
      guard();
      drafts.push(structuredClone(record));
    },
    async deleteDraft(key, guard) {
      guard();
      await behavior.remove?.(key);
      guard();
      const index = drafts.findIndex((record) => record.key === key);
      if (index >= 0) drafts.splice(index, 1);
    }
  };
  const { createCapture } = load('snippets-react/capture-controller.ts', {
    '../lib/manabi/client': client,
    '$app/navigation': { goto: async () => behavior.goto?.() },
    '$app/paths': { resolve: (value) => value },
    '../lib/snippets/service': service,
    '../lib/snippets/database': database,
    '../lib/snippets/document': document,
    '../lib/snippets/editor': { importContent: (text) => document.plainContent(text) },
    '../reader-react/controller': lifecycle
  }, window);
  const c = createCapture({});
  c.controller.start();
  return {
    c, behavior, drafts, appends, flushes,
    capture(text, details = {}) {
      return listeners.get('manabi-capture-snippet')({ detail: {
        html: text, title: 'Source', item: 'book', owner: user?.id ?? null, ...details
      } });
    },
    switchAccount(id) {
      user = id ? { id } : null;
      authGeneration++;
      localUser.set(user);
    },
    retireTransport() {
      authGeneration++;
      account.set({ status: 'ready' });
    }
  };
}

test('React old-account capture completion cannot replace a successor account dialog', async () => {
  const f = fixture(), gate = deferred();
  f.behavior.save = (record) => record.owner === 'account:alice' ? gate.promise : undefined;
  const old = f.capture('private Alice text');
  await settle();
  f.switchAccount('bob');
  assert.equal(f.c.busy, false);
  await f.capture('Bob text');
  gate.resolve();
  await old;
  assert.equal(f.c.document.source.quote, 'Bob text');
  assert.equal(f.c.open, true);
  assert.equal(f.c.busy, false);
  assert.equal(f.c.error, '');
  assert.deepEqual(f.drafts.map((record) => record.owner), ['account:bob']);
  f.c.controller.destroy();
});
test('React old-account append rejection cannot publish an error into a new capture', async () => {
  const f = fixture(), gate = deferred();
  await f.capture('Alice text');
  f.behavior.append = () => gate.promise;
  const old = f.c.append('Alice destination');
  f.switchAccount('bob');
  await f.capture('Bob text');
  gate.reject(new Error('Alice destination is no longer available'));
  await old;
  assert.equal(f.c.document.source.quote, 'Bob text');
  assert.equal(f.c.open, true);
  assert.equal(f.c.error, '');
  assert.equal(f.c.busy, false);
  assert.equal(f.appends.length, 0);
  f.c.controller.destroy();
});

test('React transport replacement retires a busy capture even when the local account stays the same', async () => {
  const f = fixture(), gate = deferred();
  let first = true;
  f.behavior.save = () => first ? (first = false, gate.promise) : undefined;
  const old = f.capture('retired transport');
  await settle();
  f.retireTransport();
  assert.equal(f.c.busy, false);
  await f.capture('current transport');
  gate.resolve();
  await old;
  assert.equal(f.c.document.source.quote, 'current transport');
  assert.equal(f.c.error, '');
  assert.equal(f.drafts.length, 1);
  f.c.controller.destroy();
});
