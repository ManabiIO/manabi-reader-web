/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// Bundle the real worker and locator module, then provide only the worker host.
// No duplicate search implementation or source-text behavior assertions.
const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(new URL('../../apps/web/src/lib/reader-search-worker.ts', import.meta.url))
  ],
  bundle: true,
  format: 'iife',
  write: false
});

function harness() {
  const messages = [];
  const listeners = new Map();
  const self = {
    onmessage: undefined,
    postMessage(value) {
      const message = JSON.parse(JSON.stringify(value));
      messages.push(message);
      if (message.type === 'done' || message.type === 'error')
        listeners.get(message.requestId)?.(message);
    }
  };
  runInNewContext(outputFiles[0].text, { self, Intl, setTimeout });
  return {
    messages,
    send: (data) => self.onmessage({ data }),
    search(requestId, texts, query = '日', matchCase = false) {
      const done = new Promise((resolve) => listeners.set(requestId, resolve));
      self.onmessage({
        data: {
          type: 'search',
          requestId,
          bookGeneration: 7,
          matchCase,
          query,
          resources: texts.map((text, spineIndex) => ({
            resource: { spineIndex, href: `${spineIndex}.xhtml`, sectionId: `s${spineIndex}` },
            text
          }))
        }
      });
      return done;
    }
  };
}

function hits(worker) {
  return worker.messages.filter((message) => message.type === 'batch').flatMap((m) => m.hits);
}

test('the result cap also stops between short spine resources', async () => {
  const worker = harness();
  const done = await worker.search(1, ['日'.repeat(6000), '日'.repeat(6000), '日'.repeat(40000)]);
  assert.equal(done.type, 'done');
  assert.equal(done.total, 10000);
  assert.equal(done.truncated, true);
  assert.equal(hits(worker).length, 10000);
  assert.equal(hits(worker).at(-1).resource.spineIndex, 1);
  assert.ok(
    worker.messages.every((message) => message.requestId === 1 && message.bookGeneration === 7)
  );
});

test('a long chunk stops at the same result cap without scanning later resources', async () => {
  const worker = harness();
  const done = await worker.search(2, ['日'.repeat(40000), '日'.repeat(10)]);
  assert.equal(done.total, 10000);
  assert.equal(done.truncated, true);
  assert.equal(hits(worker).length, 10000);
  assert.ok(hits(worker).every((hit) => hit.resource.spineIndex === 0));
});

test('normalized matches retain source code-point coordinates', async () => {
  const worker = harness();
  const text = '先頭 𠮷 e\u0301 終点';
  const done = await worker.search(3, [text], 'É');
  assert.equal(done.total, 1);
  assert.equal(done.truncated, false);
  const [hit] = hits(worker);
  assert.equal(Array.from(text).slice(hit.start, hit.end).join(''), 'e\u0301');
});

test('async failures settle with the request identity instead of an unhandled rejection', async () => {
  const worker = harness();
  const failed = await worker.search(4, ['日'], null);
  assert.deepEqual(failed, { type: 'error', requestId: 4, bookGeneration: 7 });
  const retried = await worker.search(5, ['日']);
  assert.equal(retried.total, 1);
});

test('a canceled async failure cannot report an error for its successor', async () => {
  const worker = harness();
  worker.send({ type: 'cancel', requestId: 6 });
  void worker.search(6, ['日'], null);
  const done = await worker.search(7, ['日']);
  await delay(0);
  assert.equal(done.total, 1);
  assert.ok(worker.messages.every((message) => message.requestId === 7));
});

test('cancellation interrupts a chunked scan while newer work still completes', async () => {
  const worker = harness();
  void worker.search(8, ['x'.repeat(100000) + 'needle'], 'needle');
  worker.send({ type: 'cancel', requestId: 8 });
  const done = await worker.search(9, ['needle'], 'needle');
  await delay(10);
  assert.equal(done.total, 1);
  assert.ok(worker.messages.every((message) => message.requestId === 9));
});

test('case-insensitive excerpts retain the original spelling and normalization', async () => {
  const worker = harness();
  const original = 'Original É e\u0301 𠮷 👩‍💻 End';
  const done = await worker.search(10, [original], 'é');
  assert.equal(done.total, 2);
  for (const hit of hits(worker)) assert.equal(hit.excerpt, original);
});

test('excerpt context never splits an astral or joined grapheme at its boundary', async () => {
  const worker = harness();
  // The normalized context starts inside this joined emoji in UTF-16 units.
  const original = 'Prefix 👩‍💻' + 'a'.repeat(63) + 'needle' + 'z'.repeat(63) + '👩‍💻 Suffix';
  const done = await worker.search(11, [original], 'needle');
  assert.equal(done.total, 1);
  const [hit] = hits(worker);
  assert.ok(hit.excerpt.startsWith('👩‍💻'));
  assert.ok(hit.excerpt.endsWith('👩‍💻'));
  assert.equal(Array.from(original).slice(hit.start, hit.end).join(''), 'needle');
});

test('many short spine resources yield to cancellation before scanning the whole book', async () => {
  const worker = harness();
  void worker.search(12, [...Array(100).fill('x'.repeat(1024)), 'needle'], 'needle');
  assert.equal(worker.messages.length, 0, 'the scan must yield before its final resource');
  worker.send({ type: 'cancel', requestId: 12 });
  const done = await worker.search(13, ['needle'], 'needle');
  await delay(10);
  assert.equal(done.total, 1);
  assert.ok(worker.messages.every((message) => message.requestId === 13));
});

test('contextual case matching agrees with grapheme offsets without changing Match case or NFC policy', async () => {
  for (const query of ['ΟΣ', 'οσ', 'ος']) {
    const worker = harness();
    const done = await worker.search(1, ['先頭 ΟΣ 終点'], query);
    assert.equal(done.total, 1, query);
    const [hit] = hits(worker);
    assert.equal(Array.from('先頭 ΟΣ 終点').slice(hit.start, hit.end).join(''), 'ΟΣ');
  }
  for (const [text, query, matchCase, expected] of [
    ['ΟΣ', 'ος', true, 0],
    ['ΟΣ', 'ΟΣ', true, 1],
    ['ＡＢＣ', 'ABC', false, 0],
    ['ＡＢＣ', 'ＡＢＣ', true, 1]
  ]) {
    assert.equal((await harness().search(1, [text], query, matchCase)).total, expected);
  }
});

test('each repeated normalized hit highlights its own original occurrence', async () => {
  const worker = harness();
  const text = 'É e\u0301 É';
  const done = await worker.search(20, [text], 'é');
  assert.equal(done.total, 3);
  assert.deepEqual(
    hits(worker).map((hit) => hit.excerptMatch),
    [
      { start: 0, end: 1 },
      { start: 2, end: 4 },
      { start: 5, end: 6 }
    ]
  );
  assert.deepEqual(
    hits(worker).map((hit) => hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end)),
    ['É', 'e\u0301', 'É']
  );
});

test('highlight coordinates preserve whole source graphemes and case expansions', async () => {
  for (const [text, query, expected] of [
    ['前 İ 後', 'i', 'İ'],
    ['前 か\u3099 後', 'が', 'か\u3099'],
    ['前 👩‍💻 後', '💻', '👩‍💻'],
    ['前 𠮷 後', '𠮷', '𠮷']
  ]) {
    const worker = harness();
    assert.equal((await worker.search(21, [text], query)).total, 1);
    const [hit] = hits(worker);
    assert.equal(hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end), expected);
    assert.equal(Array.from(text).slice(hit.start, hit.end).join(''), expected);
  }
});

test('streaming buffer recycling retains excerpt-relative UTF-16 coordinates', async () => {
  const worker = harness();
  const text = 'x'.repeat(70000) + ' 𠮷 e\u0301 👩‍💻 ' + 'y'.repeat(40000);
  assert.equal((await worker.search(22, [text], 'É')).total, 1);
  const [hit] = hits(worker);
  assert.equal(hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end), 'e\u0301');
  assert.ok(hit.excerptMatch.start < 100);
  assert.ok(hit.excerpt.includes('𠮷'));
  assert.ok(hit.excerpt.includes('👩‍💻'));
});

test('literal markup-like excerpts and metacharacters remain original text', async () => {
  const worker = harness();
  const text = '<script>[a+b].*? & </script>';
  assert.equal((await worker.search(23, [text], '[a+b].*?')).total, 1);
  const [hit] = hits(worker);
  assert.equal(hit.excerpt, text);
  assert.equal(hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end), '[a+b].*?');
});

test('512 supplementary characters receive the complete highlighted range', async () => {
  const worker = harness();
  const query = '𠮷'.repeat(512);
  assert.equal((await worker.search(24, ['前 ' + query + ' 後'], query)).total, 1);
  const [hit] = hits(worker);
  assert.equal(hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end), query);
  assert.equal(hit.excerptMatch.end - hit.excerptMatch.start, 1024);
});

test('overlapping literal results retain distinct selected intervals', async () => {
  const worker = harness();
  assert.equal((await worker.search(25, ['aaaa'], 'aa')).total, 3);
  assert.deepEqual(
    hits(worker).map((hit) => hit.excerptMatch),
    [
      { start: 0, end: 2 },
      { start: 1, end: 3 },
      { start: 2, end: 4 }
    ]
  );
});
