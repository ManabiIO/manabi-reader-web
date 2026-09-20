/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeMove,
  planMove,
  renameSeriesOnDisk,
  safePath
} from '../../apps/web/src/lib/library/file-operations.ts';
import { validDirectionEvidence } from '../../apps/web/src/lib/library/direction.ts';
import { boundedBytes } from '../../apps/web/src/lib/library/bounded-response.ts';

// Fault-injectable handles for transaction unit tests. The browser suite separately
// exercises Chromium's real filesystem handles, IndexedDB and the production UI.
function filesystem() {
  const events = [];
  let failWrite;
  class Directory {
    kind = 'directory';
    constructor(name, path = '') {
      this.name = name;
      this.path = path;
      this.children = new Map();
    }
    async getDirectoryHandle(name, options = {}) {
      let value = this.children.get(name);
      if (!value && options.create) {
        value = new Directory(name, [this.path, name].filter(Boolean).join('/'));
        this.children.set(name, value);
      }
      if (!value) throw new DOMException('Missing directory', 'NotFoundError');
      if (value.kind !== 'directory')
        throw new DOMException('Not a directory', 'TypeMismatchError');
      return value;
    }
    async getFileHandle(name, options = {}) {
      let value = this.children.get(name);
      if (!value && options.create) {
        value = new Handle(name, [this.path, name].filter(Boolean).join('/'));
        this.children.set(name, value);
      }
      if (!value) throw new DOMException('Missing file', 'NotFoundError');
      if (value.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
      return value;
    }
    async *entries() {
      yield* this.children.entries();
    }
    async removeEntry(name) {
      if (!this.children.has(name)) throw new DOMException('Missing file', 'NotFoundError');
      events.push(['delete', [this.path, name].filter(Boolean).join('/')]);
      this.children.delete(name);
    }
  }
  class Handle {
    kind = 'file';
    constructor(name, path) {
      this.name = name;
      this.path = path;
      this.bytes = new Uint8Array();
    }
    async getFile() {
      return new File([this.bytes], this.name);
    }
    async createWritable() {
      let bytes = this.bytes;
      return {
        write: async (value) => {
          if (failWrite?.(this.path)) throw new Error('Injected write failure');
          bytes = new Uint8Array(await new Blob([value]).arrayBuffer());
        },
        close: async () => {
          this.bytes = bytes;
          events.push(['write', this.path]);
        },
        abort: async () => {
          events.push(['abort', this.path]);
        }
      };
    }
  }
  const root = new Directory('Fixture');
  async function put(path, text) {
    const parts = path.split('/'),
      name = parts.pop();
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const file = await dir.getFileHandle(name, { create: true });
    file.bytes = new TextEncoder().encode(text);
  }
  async function read(path) {
    const parts = path.split('/'),
      name = parts.pop();
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }
  return {
    root,
    events,
    put,
    read,
    fail: (value) => {
      failWrite = value;
    }
  };
}
async function fixture() {
  const fs = filesystem();
  await fs.put('One/1.epub', 'one');
  await fs.put('Two/2.epub', 'two');
  const plan = await planMove(fs.root, 'source', '', 'My Series', ['One/1.epub', 'Two/2.epub']);
  return { ...fs, plan };
}

test('physical grouping verifies all copies before relinking and removing originals', async () => {
  const fs = await fixture(),
    journals = [],
    linked = [];
  await executeMove(
    fs.root,
    fs.plan,
    async (plan) => {
      journals.push(structuredClone(plan));
      if (plan.phase === 'copied') {
        assert.equal(await fs.read('My Series/1.epub'), 'one');
        assert.equal(await fs.read('My Series/2.epub'), 'two');
        assert.equal(await fs.read('One/1.epub'), 'one');
        assert.equal(await fs.read('Two/2.epub'), 'two');
      }
    },
    async (file) => {
      linked.push(file.to);
    }
  );
  assert.deepEqual(
    journals.map((p) => p.phase),
    ['copied', 'done']
  );
  assert.deepEqual(linked, ['My Series/1.epub', 'My Series/2.epub']);
  assert.equal(await fs.read('My Series/.Manabi-Reader.yaml'), 'name: "My Series"\n');
  await assert.rejects(fs.read('One/1.epub'), { name: 'NotFoundError' });
  await assert.rejects(fs.read('Two/2.epub'), { name: 'NotFoundError' });
});

test('a failed copy keeps every original and a verified copy can be resumed', async () => {
  const fs = await fixture();
  fs.fail((path) => path.endsWith('2.epub'));
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      async () => {},
      async () => {}
    ),
    /Injected write failure/
  );
  assert.equal(await fs.read('One/1.epub'), 'one');
  assert.equal(await fs.read('Two/2.epub'), 'two');
  assert.equal(
    fs.events.some(([op]) => op === 'delete'),
    false
  );
  fs.fail(undefined);
  // An incomplete destination is deliberately NOT overwritten during recovery.
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      async () => {},
      async () => {}
    ),
    /changed or is incomplete/
  );
  const destination = await fs.root.getDirectoryHandle('My Series');
  await destination.removeEntry('2.epub');
  await executeMove(
    fs.root,
    fs.plan,
    async () => {},
    async () => {}
  );
  assert.equal(await fs.read('My Series/2.epub'), 'two');
});

test('interrupted link publication resumes from durable copied journal without losing bytes', async () => {
  const fs = await fixture();
  let persisted;
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      async (plan) => {
        persisted = structuredClone(plan);
      },
      async (file) => {
        if (file.to.endsWith('2.epub')) throw new Error('Injected link persistence failure');
      }
    ),
    /link persistence/
  );
  assert.equal(persisted.phase, 'copied');
  await assert.rejects(fs.read('One/1.epub'), { name: 'NotFoundError' });
  assert.equal(await fs.read('My Series/1.epub'), 'one');
  assert.equal(await fs.read('Two/2.epub'), 'two');
  const linked = [];
  await executeMove(
    fs.root,
    persisted,
    async (plan) => {
      persisted = structuredClone(plan);
    },
    async (file) => {
      linked.push(file.to);
    }
  );
  assert.equal(persisted.phase, 'done');
  assert.equal(linked.length, 2);
  assert.equal(await fs.read('My Series/2.epub'), 'two');
});

test('a destination changed during asynchronous relinking stops deletion', async () => {
  const fs = await fixture();
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      async () => {},
      async (file) => {
        await fs.put(file.to, 'external edit');
      }
    ),
    /changed during the move/
  );
  assert.equal(await fs.read('One/1.epub'), 'one');
  assert.equal(await fs.read('Two/2.epub'), 'two');
  assert.equal(await fs.read('My Series/1.epub'), 'external edit');
});

test('an unrelated destination and filename collisions never overwrite files', async () => {
  const fs = await fixture();
  await fs.put('My Series/other.txt', 'keep');
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      async () => {},
      async () => {}
    ),
    /destination changed/
  );
  assert.equal(await fs.read('My Series/other.txt'), 'keep');
  await fs.put('Other/1.EPUB', 'different book');
  await assert.rejects(
    planMove(fs.root, 'source', '', 'New', ['One/1.epub', 'Other/1.EPUB']),
    /same filename/
  );
});

test('rename changes only safe metadata; root and unknown YAML are protected', async () => {
  const fs = await fixture();
  await fs.put('Series/one.epub', 'book');
  await renameSeriesOnDisk(fs.root, 'Series', 'A: "name"');
  assert.equal(
    await fs.read('Series/.Manabi-Reader.yaml'),
    `name: ${JSON.stringify('A: "name"')}\n`
  );
  assert.equal(await fs.read('Series/one.epub'), 'book');
  await assert.rejects(renameSeriesOnDisk(fs.root, '', 'Root'), /root is not a series/);
  await fs.put('Series/.Manabi-Reader.yaml', 'name: Prior\nunknown: Keep\n');
  await assert.rejects(renameSeriesOnDisk(fs.root, 'Series', 'Next'));
  assert.match(await fs.read('Series/.Manabi-Reader.yaml'), /unknown: Keep/);
});

test('tampered recovery paths are rejected before touching disk', async () => {
  const fs = await fixture();
  fs.plan.files[0].to = '../outside.epub';
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      async () => {},
      async () => {}
    ),
    /Invalid move recovery path/
  );
  assert.equal(fs.events.length, 0);
  for (const path of ['../a', '/a', 'a//b', 'a/../b', '.manabi-reader/a', 'a\\b'])
    assert.throws(() => safePath(path));
});

test('bounded sidecar reads enforce actual stream size as well as declared size', async () => {
  const bytes = new TextEncoder().encode('name: "Test"\n');
  assert.deepEqual(new Uint8Array(await boundedBytes(new Response(bytes), 4096)), bytes);
  await assert.rejects(
    boundedBytes(new Response(bytes, { headers: { 'Content-Length': '5000' } }), 4096)
  );
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4097));
    },
    cancel() {
      cancelled = true;
    }
  });
  await assert.rejects(boundedBytes(new Response(body), 4096));
  assert.equal(cancelled, true);
});

test('direction backup evidence rejects malformed, unknown and contradictory fields', () => {
  for (const value of [
    { value: 'ltr', source: 'spine' },
    { value: 'rtl', source: 'content' },
    { value: 'unknown', source: 'unknown' }
  ])
    assert.equal(validDirectionEvidence(value), true);
  for (const value of [
    null,
    [],
    {},
    { value: 'rtl', source: 'unknown' },
    { value: 'unknown', source: 'spine' },
    { value: 'rtl', source: 'spine', code: 'not a field' },
    { value: 'arbitrary', source: 'content' }
  ])
    assert.equal(validDirectionEvidence(value), false);
});
