/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(
  readFileSync(
    new URL('../../apps/web/src/platform/native-reader-navigation.ts', import.meta.url),
    'utf8'
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
).outputText;
const {
  NativeReaderNavigation,
  parseNativeReaderIdentity,
  nativeReaderPath,
  ReaderNavigationCancelled
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const snippet = '11111111-1111-4111-8111-111111111111';
const book = (id) => ({ kind: 'book', id });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(handler = () => undefined) {
  const calls = [],
    routes = [],
    states = [];
  const nav = new NativeReaderNavigation(
    async (method, payload) => {
      calls.push({ method, payload });
      return (
        (await handler(method, payload)) ??
        (method === 'close' ? { allowed: true } : { bookId: payload?.bookId })
      );
    },
    (path) => routes.push(path),
    (state) => states.push(state)
  );
  nav.setScope({ session: 'session-1', epoch: 0 });
  return { nav, calls, routes, states };
}
test('deep-link identities reject ambiguous, repeated, unsafe and malformed IDs', () => {
  assert.deepEqual(parseNativeReaderIdentity({ id: '42' }), book(42));
  assert.deepEqual(parseNativeReaderIdentity({ snippet }), { kind: 'snippet', id: snippet });
  assert.equal(nativeReaderPath(book(42)), '/b?id=42');
  for (const params of [
    {},
    { id: '0' },
    { id: '-1' },
    { id: '01' },
    { id: '1e3' },
    { id: '1.0' },
    { id: ' 1' },
    { id: 1 },
    { id: ['1', '2'] },
    { id: '9007199254740992' },
    { id: '1', snippet },
    { snippet: ['a'] },
    { snippet: '../../auth' },
    { snippet: 'javascript:alert(1)' },
    { snippet: snippet.toUpperCase().replace('1111', 'FFFF') }
  ])
    assert.throws(() => parseNativeReaderIdentity(params), /invalid/);
});
test('direct book deep link opens and shows the persistent reader', async () => {
  const { nav, calls } = setup();
  await nav.route('/b', { id: '42' });
  assert.deepEqual(calls, [{ method: 'open', payload: { bookId: 42 } }]);
  assert.equal(nav.state.visible, true);
  assert.deepEqual(nav.state.identity, book(42));
});
test('StrictMode duplicate route effects coalesce an in-flight admission', async () => {
  const load = deferred();
  const { nav, calls } = setup((method) => (method === 'open' ? load.promise : undefined));
  const first = nav.route('/b', { id: '42' });
  const second = nav.route('/b', { id: '42' });
  await tick();
  assert.equal(calls.length, 1);
  load.resolve({ bookId: 42 });
  await Promise.all([first, second]);
  await nav.route('/b', { id: '42' });
  assert.equal(calls.length, 1);
  assert.equal(nav.state.visible, true);
});
test('Library admitted token payload is retained without reopening on /b activation', async () => {
  const { nav, calls } = setup();
  await nav.ensureOpen(book(42), { bookId: 42, libraryToken: 'lease', libraryKeys: ['item'] });
  assert.equal(nav.state.visible, false);
  await nav.route('/b', { id: '42' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.libraryToken, 'lease');
  assert.equal(nav.state.visible, true);
});
test('snippet action admission is reused by its route; direct snippet links use scoped open', async () => {
  const { nav, calls } = setup((method) =>
    method === 'snippets.action' ? { readerId: snippet, readerRevision: 'rev' } : undefined
  );
  await nav.readSnippet({ type: 'read', token: 'lease', key: 'row' });
  await nav.route('/b', { snippet });
  assert.equal(calls.length, 1);
  assert.deepEqual(nav.state.identity, { kind: 'snippet', id: snippet });
  const other = setup();
  await other.nav.route('/b', { snippet });
  assert.deepEqual(other.calls[0], { method: 'open', payload: { snippetId: snippet } });
});
test('native exit keeps DOM visible and route bridge unchanged until save resolves', async () => {
  const save = deferred();
  const { nav, calls } = setup((method) => (method === 'close' ? save.promise : undefined));
  await nav.route('/b', { id: '1' });
  const leaving = nav.route('/settings', {});
  await tick();
  assert.equal(nav.state.visible, true);
  assert.equal(calls.filter((call) => call.method === 'route').length, 0);
  save.resolve({ allowed: true });
  await leaving;
  assert.equal(nav.state.visible, false);
  assert.deepEqual(calls.at(-1), { method: 'route', payload: { path: '/settings' } });
});
test('cancelled native exit restores same reader without reopening or hiding', async () => {
  const { nav, calls, routes, states } = setup((method) =>
    method === 'close' ? { allowed: false } : undefined
  );
  await nav.route('/b', { id: '1' });
  const afterOpen = states.length;
  await nav.route('/settings', {});
  assert.deepEqual(routes, ['/b?id=1']);
  assert.equal(nav.state.visible, true);
  assert.ok(states.slice(afterOpen).every((state) => state.visible));
  await nav.route('/b', { id: '1' });
  assert.equal(calls.filter((call) => call.method === 'open').length, 1);
});
test('failed bookmark save leaves reader visible and reports error without forwarding route', async () => {
  const { nav, routes, calls } = setup((method) => {
    if (method === 'close') throw new Error('Save failed');
  });
  await nav.route('/b', { id: '1' });
  await nav.route('/manage', {});
  assert.equal(nav.state.visible, true);
  assert.equal(nav.state.error, 'Save failed');
  assert.deepEqual(routes, ['/b?id=1']);
  assert.equal(
    calls.some((call) => call.method === 'route'),
    false
  );
});
test('simultaneous Back/native removal requests share one close operation', async () => {
  const save = deferred();
  const { nav, calls } = setup((method) => (method === 'close' ? save.promise : undefined));
  await nav.route('/b', { id: '1' });
  const first = nav.close();
  const second = nav.close();
  assert.equal(first, second);
  await tick();
  assert.equal(calls.filter((call) => call.method === 'close').length, 1);
  save.resolve({ allowed: true });
  await Promise.all([first, second]);
  assert.equal(nav.state.visible, false);
});
test('reader-to-reader deep links close before opening the new identity', async () => {
  const save = deferred();
  const { nav, calls } = setup((method) => (method === 'close' ? save.promise : undefined));
  await nav.route('/b', { id: '1' });
  const next = nav.route('/b', { id: '2' });
  await tick();
  assert.deepEqual(
    calls.map((call) => call.method),
    ['open', 'close']
  );
  assert.equal(nav.state.visible, true);
  save.resolve({ allowed: true });
  await next;
  assert.deepEqual(
    calls.map((call) => call.method),
    ['open', 'close', 'open']
  );
  assert.deepEqual(nav.state.identity, book(2));
  assert.equal(nav.state.visible, true);
});
test('cancelled reader replacement keeps original route and admission', async () => {
  const { nav, calls, routes } = setup((method) =>
    method === 'close' ? { allowed: false } : undefined
  );
  await nav.route('/b', { id: '1' });
  await nav.route('/b', { id: '2' });
  assert.deepEqual(nav.state.identity, book(1));
  assert.deepEqual(routes, ['/b?id=1']);
  assert.equal(calls.filter((call) => call.method === 'open').length, 1);
});
test('newer open fences late older reply; old completion cannot steal visibility', async () => {
  const old = deferred();
  const { nav, calls } = setup((method, payload) =>
    method === 'open' && payload.bookId === 1 ? old.promise : undefined
  );
  const first = nav.route('/b', { id: '1' });
  await tick();
  const second = nav.route('/b', { id: '2' });
  await second;
  old.resolve({ bookId: 1 });
  await first;
  assert.deepEqual(nav.state.identity, book(2));
  assert.equal(nav.state.visible, true);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['open', 'close', 'open']
  );
});
test('Back during pending admission cancels it before late reply arrives', async () => {
  const old = deferred();
  const { nav } = setup((method) => (method === 'open' ? old.promise : undefined));
  const first = nav.route('/b', { id: '1' });
  await tick();
  await nav.close();
  old.resolve({ bookId: 1 });
  await first;
  assert.equal(nav.state.identity, undefined);
  assert.equal(nav.state.visible, false);
});
test('newer exit supersedes an older rejected navigation restoration', async () => {
  const save = deferred();
  const { nav, routes, calls } = setup((method) => (method === 'close' ? save.promise : undefined));
  await nav.route('/b', { id: '1' });
  const first = nav.route('/settings', {});
  const second = nav.route('/statistics', {});
  save.resolve({ allowed: true });
  await Promise.all([first, second]);
  assert.deepEqual(routes, []);
  assert.deepEqual(
    calls.filter((call) => call.method === 'route'),
    [{ method: 'route', payload: { path: '/statistics' } }]
  );
});
test('malformed deep link cannot dispatch open or any URL/file capability', async () => {
  const { nav, calls } = setup();
  await nav.route('/b', { id: ['1', '2'] });
  assert.deepEqual(calls, []);
  assert.match(nav.state.error, /invalid/);
  assert.equal(nav.state.visible, false);
});
test('malformed link arriving while reading still must pass close confirmation', async () => {
  const { nav, routes } = setup((method) => (method === 'close' ? { allowed: false } : undefined));
  await nav.route('/b', { id: '1' });
  await nav.route('/b', { snippet: '../../auth' });
  assert.equal(nav.state.visible, true);
  assert.deepEqual(routes, ['/b?id=1']);
});
test('ownership change clears admission, fences late reply and does not replay old route', async () => {
  const old = deferred();
  const { nav, calls } = setup((method) => (method === 'open' ? old.promise : undefined));
  const first = nav.route('/b', { id: '1' });
  await tick();
  assert.equal(nav.setScope({ session: 'session-1', epoch: 1 }), '/manage');
  nav.setScope({ session: 'session-1', epoch: 2 });
  await nav.route('/b', { id: '1' });
  old.resolve({ bookId: 1 });
  await first;
  assert.equal(nav.state.visible, false);
  assert.equal(nav.state.identity, undefined);
  assert.equal(calls.filter((call) => call.method === 'open').length, 1);
  await nav.route('/manage', {});
  await nav.route('/b', { id: '1' });
  assert.equal(calls.filter((call) => call.method === 'open').length, 2);
});
test('late old-account close cannot clear a new account reader', async () => {
  const save = deferred();
  const { nav } = setup((method) => (method === 'close' ? save.promise : undefined));
  await nav.route('/b', { id: '1' });
  const closing = nav.close();
  const rejected = assert.rejects(closing, ReaderNavigationCancelled);
  nav.setScope({ session: 'session-2', epoch: 0 });
  await nav.route('/manage', {});
  await nav.route('/b', { id: '2' });
  save.resolve({ allowed: true });
  await rejected;
  assert.deepEqual(nav.state.identity, book(2));
  assert.equal(nav.state.visible, true);
});
test('DOM-confirmed toolbar exit releases admission without duplicate close', async () => {
  const { nav, calls } = setup();
  await nav.route('/b', { id: '1' });
  nav.didExit();
  await nav.route('/manage', {});
  assert.deepEqual(
    calls.map((call) => call.method),
    ['open', 'route']
  );
  assert.equal(nav.state.visible, false);
});
test('native exit during replacement save cancels the queued replacement admission', async () => {
  const save = deferred();
  const { nav, calls } = setup((method) => (method === 'close' ? save.promise : undefined));
  await nav.route('/b', { id: '1' });
  const replacement = nav.route('/b', { id: '2' });
  await tick();
  const exit = nav.route('/settings', {});
  save.resolve({ allowed: true });
  await Promise.all([replacement, exit]);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['open', 'close', 'route']
  );
  assert.equal(nav.state.identity, undefined);
  assert.equal(nav.state.visible, false);
});
