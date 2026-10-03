/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedFontStyleSheet } from '../../apps/web/src/runtime/embedded-fonts.ts';
const font = (name = 'Face', fileName = 'face.woff2') => ({
  name,
  fileName,
  path: '/userfonts/' + fileName
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function urls() {
  const created = [],
    revoked = [];
  return {
    created,
    revoked,
    create(blob) {
      const url = 'blob:https://reader.test/' + created.length;
      created.push({ url, blob });
      return url;
    },
    revoke: (url) => revoked.push(url)
  };
}
test('embedded owner consumes exact cached bytes through blob font CSS and releases every resource once', async () => {
  const owner = urls(),
    reads = [];
  const result = await embeddedFontStyleSheet(
    [font(), font('Alias'), { name: 'Bad', fileName: 'face.woff2', path: 'https://attacker/font' }],
    {
      match: async (path) => {
        reads.push(path);
        return new Response('font bytes', { headers: { 'Content-Type': 'font/woff2' } });
      }
    },
    new AbortController().signal,
    owner
  );
  assert.deepEqual(reads, ['/userfonts/face.woff2']);
  assert.equal(await owner.created[0].blob.text(), 'font bytes');
  assert.match(result.css, /blob:https:\/\/reader.test\/0/);
  assert.doesNotMatch(result.css, /src:url\("\/userfonts|attacker/);
  result.dispose();
  result.dispose();
  assert.deepEqual(owner.revoked, [owner.created[0].url]);
});
test('missing, empty or unvalidated font metadata cannot cause a fallback network font request', async () => {
  const owner = urls();
  const result = await embeddedFontStyleSheet(
    [font(), font('Empty', 'empty.woff')],
    { match: async (path) => (path.endsWith('empty.woff') ? new Response('') : undefined) },
    new AbortController().signal,
    owner
  );
  assert.equal(result.css, '');
  assert.equal(owner.created.length, 0);
  result.dispose();
});
test('retirement during a late cache read releases earlier URLs and never creates the late font resource', async () => {
  const owner = urls(),
    gate = deferred(),
    entered = deferred(),
    abort = new AbortController();
  const pending = embeddedFontStyleSheet(
    [font(), font('Second', 'second.ttf')],
    {
      match: async (path) => {
        if (path.endsWith('second.ttf')) {
          entered.resolve();
          await gate.promise;
        }
        return new Response('bytes');
      }
    },
    abort.signal,
    owner
  );
  await entered.promise;
  abort.abort();
  gate.resolve();
  await assert.rejects(pending);
  assert.equal(owner.created.length, 1);
  assert.deepEqual(owner.revoked, [owner.created[0].url]);
});
test('cache failures revoke prepared font resources instead of retaining a half-published stylesheet', async () => {
  const owner = urls();
  await assert.rejects(
    embeddedFontStyleSheet(
      [font(), font('Second', 'second.ttf')],
      {
        match: async (path) => {
          if (path.endsWith('second.ttf')) throw new Error('cache unavailable');
          return new Response('bytes');
        }
      },
      new AbortController().signal,
      owner
    ),
    /cache unavailable/
  );
  assert.equal(owner.revoked.length, 1);
});
