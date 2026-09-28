/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

// Bundle the complete production request client and its real store/contract code.
// Only browser storage and the HTTP response are controlled platform dependencies.
const { outputFiles } = await build({
  entryPoints: [new URL('../../apps/web/src/lib/manabi/client.ts', import.meta.url).pathname],
  alias: { $lib: new URL('../../apps/web/src/lib', import.meta.url).pathname },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
});
function client() {
  const calls = [];
  const context = {
    exports: {},
    module: { exports: {} },
    Headers,
    Response,
    AbortSignal,
    TextDecoder,
    navigator: { onLine: true },
    localStorage: { getItem: () => null },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response('{}', {
        headers: { 'Content-Type': 'application/json', 'X-Manabi-User': 'alice' }
      });
    }
  };
  vm.runInNewContext(outputFiles[0].text, context);
  const api = context.module.exports;
  api.account.set({
    status: 'available',
    session: { user: { id: 'alice', username: 'Alice' }, csrf_token: 'x'.repeat(64), providers: [] }
  });
  return { api, calls };
}

for (const path of ['preferences/', 'preferences/?book_presentation_version=1']) {
  for (const method of ['GET', 'PUT']) {
    test(`${method} ${path} retains independent snippets capability and request authority`, async () => {
      const { api, calls } = client();
      const options =
        method === 'PUT'
          ? { method, userId: 'alice', revision: '"7"', value: { settings: {} } }
          : { method, userId: 'alice' };
      await api.request(path, options);
      assert.equal(calls.length, 1);
      const { url, options: sent } = calls[0];
      assert.equal(url, '/api/reader-web/' + path, 'The query is retained, not rewritten');
      assert.equal(sent.headers.get('X-Manabi-Library-Items'), 'snippets-v1');
      assert.equal(sent.headers.get('X-Manabi-User'), 'alice');
      assert.equal(sent.credentials, 'same-origin');
      assert.equal(sent.redirect, 'error');
      assert.equal(sent.cache, 'no-store');
      assert.equal(sent.method, method);
      assert.equal(sent.headers.get('X-CSRFToken'), method === 'PUT' ? 'x'.repeat(64) : null);
      assert.equal(sent.headers.get('If-Match'), method === 'PUT' ? '"7"' : null);
      assert.equal(sent.body, method === 'PUT' ? JSON.stringify(options.value) : undefined);
    });
  }
}
test('lookalike endpoints and query values do not inherit preference capabilities', async () => {
  const { api, calls } = client();
  for (const path of ['connections/?next=preferences/', 'preferences/child/', 'preferences-other/'])
    await api.request(path);
  for (const { options } of calls)
    assert.equal(options.headers.get('X-Manabi-Library-Items'), null);
});
test('versioned preference paths retain sign-in, stale-account and invalid-path rejection', async () => {
  const { api, calls } = client();
  const path = 'preferences/?book_presentation_version=1';
  await assert.rejects(api.request(path, { userId: 'bob' }), { code: 'account_changed' });
  await assert.rejects(
    api.request('../preferences/?book_presentation_version=1'),
    /Invalid internal API path/
  );
  api.account.set({ status: 'available', session: null });
  await assert.rejects(api.request(path), { code: 'sign_in_required' });
  assert.equal(calls.length, 0);
});
