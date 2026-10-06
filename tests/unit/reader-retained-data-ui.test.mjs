/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fakeIndexedDB from 'fake-indexeddb';

const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { act } from 'react';
      import { createRoot } from 'react-dom/client';
      import { AudiobookPanel } from './reader-react/audio-panel';
      import { ImportedYatsuNotes } from './reader-react/notes';
      import { database } from './lib/data/store';
      import { editImportedNote } from './lib/manabi/imported-notes';
      import { AudiobookSessionStore, emptySession, sessionKey } from './lib/features/whispersync/persistence';
      const root = createRoot(document.getElementById('root'));
      const audioKey = sessionKey(1, 'Retained fixture');
      const bookKey = 'local:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const noteId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      async function withAudio(work) {
        const store = new AudiobookSessionStore();
        try { return await work(store); } finally { await store.close(); }
      }
      window.fixture = {
        act,
        async mountAudio() {
          await withAudio(async store => {
            await store.load(audioKey);
            await store.save(audioKey, { ...emptySession(), subtitleName: 'captions.srt',
              subtitleSource: '1\\n00:00:00,000 --> 00:00:20,000\\nFixture words\\n' });
          });
          await act(async () => root.render(<React.StrictMode><AudiobookPanel bookId={1} bookTitle="Retained fixture"
            open htmlContent="" layoutKey={0} onFollow={() => {}} returnFocus={() => {}}
            getContentElement={() => document.getElementById('content')}
            bindings={{ this: value => { window.controller = value; } }} /></React.StrictMode>));
        },
        resetAudio: () => withAudio(async store => { await store.load(audioKey); await store.remove(audioKey); }),
        savedAudio: () => withAudio(store => store.load(audioKey)),
        async mountNotes(status) {
          const source = { text: 'Original imported note' };
          await (await database.db).put('readerImportRecord', {
            id: noteId, bookId: 1, bookKey, accountId: null, part: status === 'book-note' ? 'notes' : 'highlights',
            status, label: 'Notebook title', body: 'Original imported note', quote: '',
            importedLabel: 'Notebook title', importedBody: 'Original imported note',
            createdAt: '2026-10-01T00:00:00.000Z', modifiedAt: '2026-10-01T00:00:00.000Z',
            source, sourceCanonical: JSON.stringify(source)
          });
          await act(async () => root.render(<React.StrictMode><ImportedYatsuNotes bookId={1} bookKey={bookKey} open
            bindings={{ this: value => { window.controller = value; } }} /></React.StrictMode>));
        },
        async updateOtherNote(body) {
          const row = await (await database.db).get('readerImportRecord', noteId);
          await editImportedNote(row, body, row.label);
        },
        note: async () => (await database.db).get('readerImportRecord', noteId),
        async unmount() { await act(async () => root.unmount()); (await database.db).close(); }
      };
    `,
    resolveDir: fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
    loader: 'tsx'
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  tsconfig: 'apps/web/tsconfig.json',
  loader: { '.css': 'empty' },
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.env': '{}',
    'import.meta.url': '"https://reader.example/reader.js"'
  },
  logLevel: 'silent'
});

async function setup() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  virtualConsole.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<div id="root"></div><article id="content">Fixture words</article>', {
    url: 'https://reader.example/reader-web/b?id=1',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  const ports = [];
  window.MessageChannel = class extends MessageChannel {
    constructor() {
      super();
      ports.push(this.port1, this.port2);
    }
  };
  for (const [name, value] of Object.entries(fakeIndexedDB))
    if (name.startsWith('IDB') || name === 'indexedDB')
      Object.defineProperty(window, name, {
        value: name === 'indexedDB' ? new fakeIndexedDB.IDBFactory() : value,
        configurable: true
      });
  Object.assign(window, {
    TextEncoder,
    TextDecoder,
    structuredClone,
    IS_REACT_ACT_ENVIRONMENT: true
  });
  window.URL.createObjectURL = () => 'blob:https://reader.example/audio';
  window.URL.revokeObjectURL = () => {};
  // JSDOM does not decode media. Metadata is supplied explicitly, while the real
  // player, controller, persistence transactions and React event lifecycle run.
  window.HTMLMediaElement.prototype.load = function () {};
  window.HTMLMediaElement.prototype.pause = function () {};
  window.eval(outputFiles[0].text);
  const fixture = window.fixture;
  async function settle(predicate, message) {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt++)
      await fixture.act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    assert.ok(predicate(), message);
  }
  async function click(text) {
    const button = [...window.document.querySelectorAll('button')].find(
      (element) =>
        element.textContent.trim() === text || element.getAttribute('aria-label') === text
    );
    assert.ok(button, `${text} is available`);
    await fixture.act(async () => button.click());
  }
  async function input(element, value) {
    assert.ok(element, 'editable control exists');
    const prototype =
      element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    await fixture.act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }
  async function commit(element) {
    await fixture.act(async () =>
      element.dispatchEvent(new window.Event('change', { bubbles: true }))
    );
  }
  async function addAudio() {
    await fixture.act(async () => {
      window.controller.player.load(new window.File(['audio'], 'fixture.wav', { lastModified: 1 }));
      const audio = window.document.querySelector('audio');
      Object.defineProperty(audio, 'duration', { value: 40 });
      audio.dispatchEvent(new window.Event('loadedmetadata'));
    });
    await settle(() => window.controller.snapshot.ready, 'audio metadata is admitted');
  }
  return {
    window,
    fixture,
    settle,
    click,
    input,
    commit,
    addAudio,
    async close() {
      await fixture.unmount();
      for (const port of ports) port.close();
      window.close();
      assert.deepEqual(errors, [], 'no React controlled-field or runtime errors');
    }
  };
}

for (const withAudio of [false, true]) {
  test(`audiobook number drafts commit stale-session protection ${withAudio ? 'with' : 'without'} audio`, async () => {
    const t = await setup();
    try {
      await t.fixture.mountAudio();
      await t.settle(() => t.window.controller?.ready, 'saved captions restore');
      if (withAudio) await t.addAudio();
      await t.fixture.act(async () => {
        await t.window.controller.save();
        await t.fixture.resetAudio();
      });
      const input = t.window.document.querySelector('input[min="-3600"]');
      await t.input(input, '1');
      assert.equal(input.value, '1', 'React retains the native draft until its commit event');
      assert.equal(t.window.controller.delay, 0, 'typing alone does not commit a partial number');
      await t.commit(input);
      assert.equal(t.window.controller.delay, 1);
      await t.settle(
        () => t.window.controller.storageError.includes('changed in another tab'),
        'the conflict is reported'
      );
      assert.match(
        t.window.document.querySelector('[role="status"]').textContent,
        /changed in another tab/
      );
      await t.click('Close audiobook');
      assert.match(
        t.window.document.querySelector('[role="status"]').textContent,
        /Audiobook changes are not being saved/
      );
      await t.click('View details');
      assert.match(
        t.window.document.querySelector('[role="status"]').textContent,
        /changed in another tab/
      );
      assert.equal(
        await t.fixture.savedAudio(),
        undefined,
        'the reset tombstone survives the stale autosave'
      );
    } finally {
      await t.close();
    }
  });
}

test('audiobook controls retain intermediate number drafts and commit toggles and normalized rates', async () => {
  const t = await setup();
  try {
    await t.fixture.mountAudio();
    await t.settle(() => t.window.controller?.ready, 'saved captions restore');
    const input = t.window.document.querySelector('input[min="-3600"]');
    await t.input(input, '');
    assert.equal(input.value, '');
    await t.input(input, '-0.5');
    assert.equal(input.value, '-0.5');
    await t.commit(input);
    assert.equal(t.window.controller.delay, -0.5);
    await t.input(input, '3601');
    await t.commit(input);
    assert.equal(input.value, '-0.5', 'invalid committed delay returns to the saved value');
    const checks = [...t.window.document.querySelectorAll('input[type="checkbox"]')];
    await t.fixture.act(async () => {
      for (const checkbox of checks) checkbox.click();
    });
    assert.equal(t.window.controller.follow, true);
    assert.equal(t.window.controller.approximate, true);
    assert.ok(checks.every((checkbox) => checkbox.checked));
    await t.addAudio();
    const rate = t.window.document.querySelector('input[min="0.5"]');
    await t.input(rate, '4');
    await t.commit(rate);
    assert.equal(rate.value, '3', 'the rate reflects the real player clamp');
    await t.fixture.act(async () => t.window.controller.save());
    const saved = await t.fixture.savedAudio();
    assert.equal(saved.delay, -0.5);
    assert.equal(saved.rate, 3);
    assert.equal(saved.follow, true);
    assert.equal(saved.approximate, true);
  } finally {
    await t.close();
  }
});

for (const status of ['book-note', 'unresolved']) {
  test(`imported ${status} exposes a stable Note label and retains drafts on concurrent edits`, async () => {
    const t = await setup();
    try {
      await t.fixture.mountNotes(status);
      await t.settle(() => t.window.controller?.records.length === 1, 'the retained note loads');
      await t.click('Edit imported note');
      let textarea = t.window.document.querySelector('textarea');
      assert.ok(textarea);
      assert.deepEqual(
        [...textarea.labels].map((label) => label.textContent),
        ['Note'],
        'the imported body is not part of the field label'
      );
      await t.input(textarea, 'Draft from first tab');
      await t.fixture.updateOtherNote('Newer second-tab note');
      await t.click('Save imported note');
      await t.settle(
        () => t.window.controller.error.includes('changed since it was opened'),
        'stale writes require a reload'
      );
      assert.equal(textarea.value, 'Draft from first tab');
      assert.equal((await t.fixture.note()).body, 'Newer second-tab note');
      await t.click('Reload latest notes');
      await t.settle(() => !t.window.controller.busy, 'latest notes reload');
      await t.click('Edit imported note');
      textarea = t.window.document.querySelector('textarea');
      assert.equal(textarea.value, 'Newer second-tab note');
      assert.equal(textarea.labels[0].textContent, 'Note');
      await t.input(textarea, 'Reviewed local edit');
      await t.click('Save imported note');
      await t.settle(() => !t.window.controller.busy, 'the reviewed edit saves');
      const saved = await t.fixture.note();
      assert.equal(saved.body, 'Reviewed local edit');
      assert.equal(
        saved.source.text,
        'Original imported note',
        'original import evidence remains available'
      );
      await t.click('Remove imported note');
      await t.settle(() => !t.window.controller.busy, 'the note is removed');
      assert.ok((await t.fixture.note()).deletedAt, 'removal retains a recoverable record');
    } finally {
      await t.close();
    }
  });
}
