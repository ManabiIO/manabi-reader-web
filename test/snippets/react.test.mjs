/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
const messagePorts = [];
import 'fake-indexeddb/auto';
import * as fixture from 'snippet-ui-fixture';
let React,
  act,
  createRoot,
  SnippetEditor,
  SnippetReader,
  SnippetCapture,
  Shelf,
  DestinationPicker,
  Workspace,
  SnippetsRoute,
  Button,
  Dom;
let createReader, createDestinationPicker, createWorkspace, documentAPI, database, dom;
const mounted = [];
const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
before(async () => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://manabi.io/reader-web/snippets',
    pretendToBeVisual: true
  });
  for (const key of [
    'window',
    'document',
    'location',
    'history',
    'navigator',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'Node',
    'DocumentFragment',
    'DOMParser',
    'MutationObserver',
    'CustomEvent',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'getComputedStyle',
    'Range'
  ])
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  globalThis.PointerEvent = dom.window.PointerEvent ?? dom.window.MouseEvent;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.MessageChannel = class extends MessageChannel {
    constructor() {
      super();
      messagePorts.push(this.port1, this.port2);
    }
  };
  globalThis.CSS = {
    escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
  };
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;
  window.scrollTo = () => {};
  window.scrollBy = () => {};
  HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.scrolled = 'true';
  };
  Range.prototype.getClientRects = () => [];
  Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0
  });
  HTMLElement.prototype.getClientRects = () => [
    { left: 0, top: 100, bottom: 120, right: 800, width: 800, height: 20 }
  ];
  HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 100,
    bottom: 120,
    right: 800,
    width: 800,
    height: 20
  });
  ({ default: React, act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  ({ Button, Dom } = await import('../../apps/web/src/reader-react/dom'));
  ({ SnippetEditor } = await import('../../apps/web/src/snippets-react/editor'));
  ({ SnippetReader } = await import('../../apps/web/src/snippets-react/reader'));
  ({ SnippetCapture } = await import('../../apps/web/src/snippets-react/capture'));
  ({ Shelf } = await import('../../apps/web/src/snippets-react/shelf'));
  ({ DestinationPicker } = await import('../../apps/web/src/snippets-react/destination-picker'));
  ({ Workspace } = await import('../../apps/web/src/snippets-react/workspace'));
  ({ default: SnippetsRoute } = await import('../../apps/web/src/screens/routes/snippets.web'));
  ({ createReader } = await import('../../apps/web/src/snippets-react/reader-controller'));
  ({ createDestinationPicker } = await import(
    '../../apps/web/src/snippets-react/destination-picker-controller'
  ));
  ({ createWorkspace } = await import('../../apps/web/src/snippets-react/workspace-controller'));
  documentAPI = await import('../../apps/web/src/lib/snippets/document');
  database = await import('../../apps/web/src/lib/snippets/database');
});
after(() => {
  dom.window.close();
  for (const port of messagePorts) port.close();
});
beforeEach(async () => {
  window.history.replaceState({}, '', '/reader-web/snippets');
  const { refreshLocation } = await import('../../apps/web/src/runtime/stores');
  refreshLocation();
  fixture.changeUser(null);
  fixture.snippetItems.set([]);
  Object.assign(fixture.memory, {
    sources: [],
    entries: [],
    folderReads: [],
    appends: [],
    progress: [],
    commits: [],
    routeParams: {},
    permissions: 0,
    mounts: 0,
    failFolders: false,
    beforeFolders: undefined,
    beforeMkdir: undefined
  });
});
afterEach(async () => {
  for (const instance of mounted.splice(0))
    await act(async () => {
      instance.root.unmount();
      instance.host.remove();
    });
});
async function mount(Component, props = {}, strict = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const record = { host, root };
  mounted.push(record);
  const render = (value) =>
    root.render(
      strict
        ? React.createElement(React.StrictMode, null, React.createElement(Component, value))
        : React.createElement(Component, value)
    );
  await act(async () => {
    render(props);
    await pause();
  });
  return {
    host,
    async update(next) {
      await act(async () => {
        render(next);
        await pause();
      });
    }
  };
}
function button(text, host = document) {
  return [...host.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
}
async function click(node) {
  assert(node, 'button must exist');
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await pause();
  });
}
async function input(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    await pause();
  });
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await act(async () => pause(10));
  assert.ok(predicate(), description);
}
const source = (id) => ({ owner: 'owner', id, root: 'root-' + id, provider: 'google', name: id });

test('active snippets graph exports all screens and contains no Svelte component/runtime imports', () => {
  const root = join(process.cwd(), 'apps/web/src/snippets-react');
  const files = readdirSync(root).filter((name) => /\.tsx?$/.test(name));
  assert(files.length >= 14);
  for (const name of files)
    assert.doesNotMatch(
      readFileSync(join(root, name), 'utf8'),
      /(?:from\s*|import\()\s*['"][^'"]*(?:\.svelte|svelte\/)/,
      name
    );
  const entry = readFileSync(join(root, 'index.tsx'), 'utf8');
  for (const name of [
    'SnippetsScreen',
    'SnippetCapture',
    'SnippetReader',
    'SnippetEditor',
    'DestinationPicker',
    'SnippetShelf'
  ])
    assert(entry.includes(name));
});

test('real Tiptap editor owns one live instance through StrictMode and destroys it on unmount', async () => {
  const instances = [],
    changes = [];
  const props = {
    content: documentAPI.plainContent('日本語'),
    onchange: (value) => changes.push(value),
    onready: (editor) => instances.push(editor)
  };
  const ui = await mount(SnippetEditor, props, true);
  assert.equal(instances.filter((editor) => !editor.isDestroyed).length, 1);
  const editor = instances.find((editor) => !editor.isDestroyed);
  assert(ui.host.querySelector('.snippet-editable[contenteditable="true"]'));
  await act(async () => editor.commands.insertContent('学ぶ'));
  assert(changes.length > 0);
  await ui.update({ ...props, disabled: true });
  assert.equal(editor.isEditable, false);
  await act(async () => mounted[0].root.unmount());
  assert(instances.every((editor) => editor.isDestroyed));
});

test('furigana pending form preserves text through composition and commits only on Apply', async () => {
  let editor;
  const pending = [];
  await mount(SnippetEditor, {
    content: documentAPI.plainContent('日本語'),
    onchange() {},
    onready: (value) => (editor = value),
    onpendingchange: (value) => pending.push(value)
  });
  await act(async () => editor.commands.setTextSelection({ from: 1, to: 4 }));
  await click(button('Furigana'));
  assert.equal(pending.at(-1), true);
  assert.equal(editor.isEditable, false);
  const field = document.querySelector('input');
  await input(field, 'にほんご');
  await act(async () => field.dispatchEvent(new Event('compositionstart', { bubbles: true })));
  assert.equal(button('Apply').disabled, true);
  await act(async () => field.dispatchEvent(new Event('compositionend', { bubbles: true })));
  const composingEnter = new KeyboardEvent('keydown', {
    key: 'Enter',
    isComposing: true,
    bubbles: true,
    cancelable: true
  });
  await act(async () => field.dispatchEvent(composingEnter));
  assert.equal(composingEnter.defaultPrevented, true);
  await click(button('Apply'));
  assert.equal(pending.at(-1), false);
  const ruby = new DOMParser().parseFromString(editor.getHTML(), 'text/html').querySelector('ruby');
  assert.equal(ruby?.querySelector('rb')?.textContent, '日本語');
  assert.equal(ruby?.querySelector('rt')?.textContent, 'にほんご');
  assert.equal(
    editor.getJSON().content[0].content[0].marks.find((mark) => mark.type === 'rubyText').attrs.rt,
    'にほんご'
  );
});

test('link editor rejects executable URLs and Cancel keeps the saved document unchanged', async () => {
  let editor;
  await mount(SnippetEditor, {
    content: documentAPI.plainContent('本文'),
    onchange() {},
    onready: (value) => (editor = value)
  });
  await act(async () => editor.commands.setTextSelection({ from: 1, to: 3 }));
  const original = editor.getHTML();
  await click(button('Link'));
  await input(document.querySelector('input'), 'javascript:alert(1)');
  await click(button('Apply'));
  assert.match(document.querySelector('[role="alert"]').textContent, /complete HTTPS/);
  assert.equal(editor.getHTML(), original);
  await click(button('Cancel'));
  assert.equal(editor.isEditable, true);
  assert.equal(editor.getHTML(), original);
});

test('destination picker preserves loading/empty folder feedback and source-switch generation fences', async () => {
  const a = source('first'),
    b = source('second');
  fixture.memory.sources = [a, b];
  const ui = await mount(DestinationPicker, { guard() {}, choose() {} });
  assert(ui.host.querySelector('select[aria-label="Storage source"]'));
  let release;
  fixture.memory.beforeFolders = () => new Promise((resolve) => (release = resolve));
  let controller;
  await act(async () => {
    const c = createDestinationPicker({ guard() {}, choose() {} });
    c.controller.prepare();
    c.controller.start();
    controller = c;
    await pause();
  });
  const pending = controller.browse(a, a.root, a.name, true);
  await pause();
  assert.equal(controller.ready, false);
  fixture.memory.beforeFolders = undefined;
  fixture.memory.entries = [{ id: 'second-child', name: 'Second child' }];
  await controller.browse(b, b.root, b.name, true);
  release();
  await pending;
  assert.equal(controller.selected.id, b.id);
  assert.deepEqual(controller.entries, fixture.memory.entries);
  controller.controller.destroy();
});

test('the destination remember checkbox retains a deliberate click and passes it to the chosen folder', async () => {
  fixture.memory.sources = [source('remember')];
  let controller, chosen;
  const ui = await mount(DestinationPicker, {
    guard() {},
    choose(destination, remember) {
      chosen = { destination, remember };
    },
    bindings: {
      this: (value) => {
        controller = value;
      }
    }
  });
  await waitFor(
    () => ui.host.querySelector('label.remember input'),
    'remember-location checkbox mounts'
  );
  const checkbox = ui.host.querySelector('label.remember input');
  assert.equal(checkbox.checked, false);
  await click(checkbox);
  assert.equal(checkbox.checked, true);
  assert.equal(controller.remember, true);
  await click(button('Use this folder'));
  assert.equal(chosen.remember, true);
  assert.equal(chosen.destination.source.id, 'remember');
});

test('folder creation keeps the modal write fence active through navigation and releases it on teardown', async () => {
  const a = source('first'),
    busy = [];
  const c = createDestinationPicker({
    guard() {},
    choose() {},
    onwritebusy: (value) => busy.push(value)
  });
  c.controller.prepare();
  c.controller.start();
  await c.browse(a, a.root, a.name, true);
  c.newName = '日本語';
  let release;
  fixture.memory.beforeMkdir = () => new Promise((resolve) => (release = resolve));
  const pending = c.mkdir();
  assert.equal(c.writeBusy, true);
  assert.equal(busy.at(-1), true);
  c.controller.destroy();
  assert.equal(busy.at(-1), false);
  release();
  await pending;
  assert.equal(c.alive, false);
  assert.equal(c.entries.length, 0);
});

test('reader restores explicit locator, preserves source markup and persists only deliberate scroll', async () => {
  const doc = documentAPI.createSnippet(documentAPI.plainContent('日本語を読む'));
  const block = documentAPI.passages(doc.content)[0],
    locator = {
      blockId: block.blockId,
      quote: block.text,
      offset: 0,
      before: '',
      revision: doc.revision
    };
  let c;
  const ui = await mount(SnippetReader, {
    document: doc,
    selectedScope: fixture.scope(),
    locator,
    followRemotePosition: false,
    bindings: { this: (value) => (c = value) }
  });
  await act(async () => pause(20));
  assert(
    ui.host.querySelector('.snippet-reading [data-scrolled="true"]'),
    JSON.stringify({
      html: ui.host.innerHTML,
      ready: c.ready,
      incoming: c.incomingLocator,
      applied: c.appliedLocator,
      notice: c.notice,
      loc: locator,
      htmlState: c.html
    })
  );
  assert(ui.host.querySelector('.snippet-match'));
  window.dispatchEvent(new Event('scroll'));
  await pause(10);
  assert.equal(fixture.memory.progress.length, 0);
  await click(button('Vertical reading'));
  assert(ui.host.querySelector('.snippet-reading.vertical'));
  await click(button('A+'));
  assert.equal(ui.host.querySelector('article').style.fontSize, '1.375rem');
});

test('reader teardown saves the last deliberate reading position and removes listeners', async () => {
  const doc = documentAPI.createSnippet(documentAPI.plainContent('読み続ける'));
  const c = createReader({ document: doc, selectedScope: fixture.scope() });
  const host = document.createElement('article');
  host.innerHTML =
    '<p data-id="' + documentAPI.passages(doc.content)[0].blockId + '">読み続ける</p>';
  document.body.append(host);
  c.host = host;
  c.controller.prepare();
  c.controller.start();
  await pause(10);
  c.markUserScrollIntent(new KeyboardEvent('keydown', { key: 'PageDown' }));
  c.schedule();
  assert(c.pendingPosition);
  c.controller.destroy();
  assert.equal(fixture.memory.progress.length, 1);
  host.remove();
  window.dispatchEvent(new Event('scroll'));
  assert.equal(fixture.memory.progress.length, 1);
});

test('DOM controls attach, replace and retire listeners at the commit boundary', async () => {
  const delivered = [];
  let retiredButton, retiredCustom;
  function Probe({ phase }) {
    React.useLayoutEffect(() => {
      retiredButton = document.querySelector('[data-commit-control]');
      retiredCustom = document.querySelector('[data-custom-event]');
      retiredButton.click();
      retiredCustom.dispatchEvent(new Event('reader-probe-' + phase));
      if (phase === 2) retiredCustom.dispatchEvent(new Event('reader-probe-1'));
    }, [phase]);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Button,
        {
          'data-commit-control': '',
          onClick: () => delivered.push('click-' + phase)
        },
        'Save snippet'
      ),
      React.createElement(Dom, {
        'data-custom-event': '',
        events: { ['reader-probe-' + phase]: () => delivered.push('custom-' + phase) }
      })
    );
  }
  const ui = await mount(Probe, { phase: 1 });
  assert.deepEqual(delivered, ['click-1', 'custom-1']);
  await ui.update({ phase: 2 });
  assert.deepEqual(delivered, ['click-1', 'custom-1', 'click-2', 'custom-2']);
  const index = mounted.findIndex((record) => record.host === ui.host);
  const { root } = mounted.splice(index, 1)[0];
  await act(async () => root.unmount());
  ui.host.remove();
  retiredButton.click();
  retiredCustom.dispatchEvent(new Event('reader-probe-2'));
  assert.deepEqual(delivered, ['click-1', 'custom-1', 'click-2', 'custom-2']);
});

test('shelf retains filtering, card view, empty state and range selection contracts', async () => {
  const summaries = ['first', 'second', 'third'].map((title, i) => ({
    id: `id-${i}`,
    key: `key-${i}`,
    revision: 'r',
    title,
    excerpt: '本文',
    modifiedAt: 10 - i,
    createdAt: i,
    conflicts: 0,
    locations: []
  }));
  fixture.snippetItems.set(summaries);
  let selected = [];
  const props = { layout: 'grid', selecting: true, onselect: (ids) => (selected = ids) };
  const ui = await mount(Shelf, props);
  assert.equal(ui.host.querySelectorAll('[role="listitem"]').length, 3);
  assert(ui.host.querySelector('.snippet-shelf.grid'));
  await click(ui.host.querySelectorAll('.title')[0]);
  assert.deepEqual(selected, ['id-0']);
  await ui.update({ ...props, selected: new Set(selected) });
  await act(async () =>
    ui.host
      .querySelectorAll('.title')[2]
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
  );
  assert.deepEqual(selected, ['id-0', 'id-1', 'id-2']);
  await ui.update({ ...props, query: 'missing' });
  assert.match(ui.host.textContent, /No matching snippets/);
});

test('workspace retains search, recovered drafts and guarded editor navigation selectors', async () => {
  const ui = await mount(Workspace);
  await act(async () => pause(10));
  assert(ui.host.querySelector('[aria-label="Search snippets"]'));
  assert(ui.host.querySelector('[aria-label="Snippet source"]'));
  assert(ui.host.querySelector('[aria-label="Snippet view"]'));
  assert(button('Paste as Markdown', ui.host));
  assert(button('Import text or backup…', ui.host));
});

test('workspace New snippet mounts the actual dynamically loaded Tiptap editor', async () => {
  const ui = await mount(Workspace, {}, true);
  await act(async () => pause(10));
  await click(button('New snippet', ui.host));
  const deadline = Date.now() + 2000;
  while (!ui.host.querySelector('.editor-host [contenteditable="true"]') && Date.now() < deadline)
    await act(async () => pause(10));
  const editable = ui.host.querySelector('.editor-host [contenteditable="true"]');
  assert.ok(editable, 'the real editor component must be passed through DynamicComponent');
  assert.ok(button('Bold', ui.host), 'the actual editor toolbar is mounted');
  assert.equal(button('Save snippet', ui.host).disabled, false);
  await click(button('Keep draft', ui.host));
  assert.equal(ui.host.querySelector('.editor-host [contenteditable="true"]'), null);
  const returnDeadline = Date.now() + 2000;
  while (!button('New snippet', ui.host) && Date.now() < returnDeadline)
    await act(async () => pause(10));
  assert.ok(button('New snippet', ui.host));
});

test('snippet Save opens its persisted reader before Expo commits browser history', async () => {
  const { installRouter } = await import('../../apps/web/src/runtime/navigation');
  const { page } = await import('../../apps/web/src/runtime/stores');
  const paths = [];
  const stopRouter = installRouter({
    push: (path) => paths.push(path),
    replace: (path) => paths.push(path)
  });
  try {
    const ui = await mount(SnippetsRoute, {}, true);
    await act(async () => pause(20));
    await click(button('New snippet', ui.host));
    const deadline = Date.now() + 2000;
    while (!ui.host.querySelector('.editor-host [contenteditable="true"]') && Date.now() < deadline)
      await act(async () => pause(10));
    const editable = ui.host.querySelector('.editor-host [contenteditable="true"]');
    assert.ok(editable, 'the dynamically imported production editor is mounted');
    await input(ui.host.querySelector('[aria-label="Snippet title"]'), 'Scope snippet');
    // Exercise the real ProseMirror DOM observer rather than replacing editor/controller state.
    await act(async () => {
      editable.innerHTML = '<p>SCOPE_TOKEN snippet body</p>';
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(20);
    });
    await click(button('Save snippet', ui.host));
    assert.ok(button('Keep on this device only'));
    assert.equal(fixture.memory.commits.length, 0, 'choosing storage does not commit the draft');
    await click(button('Keep on this device only'));
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'save location closes');
    await click(button('Save snippet', ui.host));
    await waitFor(() => paths.length === 1, 'Save requests the committed snippet route');
    assert.equal(fixture.memory.commits.length, 1, ui.host.textContent);
    const saved = fixture.memory.commits[0];
    assert.equal(
      (await database.getRecord('local', saved.id)).document.title.text,
      'Scope snippet'
    );
    assert.equal(
      (await database.drafts('local')).some((draft) => draft.id === saved.id),
      false
    );
    assert.equal(paths.length, 1, ui.host.textContent);
    const target = new URL(paths[0], location.origin);
    assert.equal(target.searchParams.get('id'), saved.id);
    assert.equal(target.searchParams.get('returnTo'), '/reader-web/snippets');
    fixture.memory.routeParams = Object.fromEntries(target.searchParams);
    // Expo admits the new route before its history listener changes window.location.
    const reader = await mount(SnippetsRoute, {}, true);
    await waitFor(
      () => reader.host.querySelector('article[aria-label="Snippet content"]'),
      'the saved snippet reader mounts using route-local parameters'
    );
    assert.equal(location.search, '', 'the outgoing address bar is intentionally stale');
    assert.equal(
      reader.host.querySelector('article[aria-label="Snippet content"]')?.textContent,
      'SCOPE_TOKEN snippet body'
    );
    assert.equal(reader.host.querySelector('h1')?.textContent, 'Scope snippet');
    await act(async () => {
      page.set({
        url: new URL('/reader-web/manage?q=another-screen', location.origin),
        params: {},
        state: {},
        data: {}
      });
      await pause(20);
    });
    assert.equal(
      reader.host.querySelector('article[aria-label="Snippet content"]')?.textContent,
      'SCOPE_TOKEN snippet body',
      'an outgoing or retained route cannot overwrite the admitted snippet URL'
    );
    await act(async () => {
      fixture.changeUser('another-snippet-owner');
      await pause(20);
    });
    assert.equal(
      !!reader.host.querySelector('article[aria-label="Snippet content"]'),
      false,
      'route authority never bypasses the active account guard'
    );
  } finally {
    stopRouter();
  }
});

test('route-local draft recovery rotates one durable session and preserves route query values', async () => {
  const doc = documentAPI.createSnippet(documentAPI.plainContent('Recover my draft'), 'Recovery');
  const selected = fixture.scope(),
    session = crypto.randomUUID();
  const draft = {
    key: database.recordKey(selected.owner, session),
    owner: selected.owner,
    id: doc.id,
    session,
    base: null,
    document: doc,
    updatedAt: Date.now(),
    mode: 'new',
    locationChosen: true
  };
  await database.saveDraft(draft, selected.guard);
  const url = new URL('/reader-web/snippets', location.origin);
  url.searchParams.set('draft', session);
  url.searchParams.set('q', '猫');
  url.searchParams.append('note', 'one');
  url.searchParams.append('note', 'two');
  let controller;
  const props = {
    routeUrl: url.href,
    bindings: { this: (value) => (controller = value) }
  };
  const ui = await mount(Workspace, props, true);
  await waitFor(
    () => ui.host.querySelector('.editor-host [contenteditable="true"]'),
    'the selected recovery draft opens its real editor'
  );
  assert.equal(ui.host.querySelector('[aria-label="Snippet title"]').value, 'Recovery');
  assert.equal(ui.host.querySelector('.editor-host').textContent, 'Recover my draft');
  const recovered = (await database.drafts('local')).filter((item) => item.id === doc.id);
  assert.equal(recovered.length, 1);
  assert.notEqual(recovered[0].session, session);
  assert.equal(controller.draftId, recovered[0].session);
  assert.equal(new URL(location.href).searchParams.get('draft'), recovered[0].session);
  assert.deepEqual(controller.params.getAll('note'), ['one', 'two']);
  assert.equal(controller.query, '猫');
  // An unchanged parent snapshot must not undo the recovered session handoff.
  await ui.update(props);
  assert.equal(controller.draftId, recovered[0].session);
  assert.equal((await database.drafts('local')).filter((item) => item.id === doc.id).length, 1);
  assert.equal(controller.error, '');
});

test('a reused Expo snippet screen accepts newer local parameters without reading another screen', async () => {
  const selected = fixture.scope();
  const docs = ['First snippet', 'Second snippet'].map((text) =>
    documentAPI.createSnippet(documentAPI.plainContent(text), text)
  );
  for (const doc of docs)
    await database.saveDocument(selected.owner, doc, null, undefined, selected.guard);
  fixture.memory.routeParams = { id: docs[0].id };
  const ui = await mount(SnippetsRoute);
  const text = () => ui.host.querySelector('article[aria-label="Snippet content"]')?.textContent;
  await waitFor(() => text() === 'First snippet', 'the first route-local snippet is loaded');
  fixture.memory.routeParams = { id: docs[1].id };
  await ui.update({});
  await waitFor(() => text() === 'Second snippet', 'new route props select the second snippet');
  assert.equal(location.search, '', 'neither selection depends on browser history settling');
  await click(button('Edit', ui.host));
  await waitFor(
    () => ui.host.querySelector('.editor-host [contenteditable="true"]'),
    'the newer selected record is also the edit target'
  );
  assert.equal(ui.host.querySelector('[aria-label="Snippet title"]').value, 'Second snippet');
  assert.equal(ui.host.querySelector('.editor-host').textContent, 'Second snippet');
});

test('capture mounts once under StrictMode, saves before prompting, and keeps drafts when dismissed', async () => {
  const before = (await database.drafts('local')).length;
  await mount(SnippetCapture, {}, true);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent('manabi-capture-snippet', {
        detail: {
          html: '<p>捕まえた<ruby>言葉<rt>ことば</rt></ruby></p>',
          title: 'Source book',
          item: 'book:1',
          owner: null
        }
      })
    );
    await pause(30);
  });
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal((await database.drafts('local')).length, before + 1);
  assert(button('Create new snippet'));
  await click(button('Keep for later'));
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.equal((await database.drafts('local')).length, before + 1);
});

test('account changes close capture selection without exposing another account’s draft', async () => {
  await mount(SnippetCapture);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent('manabi-capture-snippet', {
        detail: { html: '<p>私の文章</p>', title: 'Local source', item: 'book:2', owner: null }
      })
    );
    await pause(30);
  });
  assert(button('Keep for later'));
  await act(async () => {
    fixture.changeUser('another-owner');
    await pause();
  });
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.equal((await database.drafts('account:another-owner')).length, 0);
});

test('workspace navigation keeps the unsaved draft and owns its before-navigation listener', async () => {
  const { goto } = await import('../../apps/web/src/runtime/navigation');
  const doc = documentAPI.createSnippet(documentAPI.plainContent('まだ保存しない'));
  const session = crypto.randomUUID(),
    s = fixture.scope();
  const draft = {
    key: database.recordKey(s.owner, session),
    owner: s.owner,
    id: doc.id,
    session,
    base: null,
    document: doc,
    updatedAt: Date.now(),
    mode: 'new'
  };
  const c = createWorkspace({});
  c.controller.prepare();
  c.editing = draft;
  c.admitted = s;
  c.content = doc.content;
  c.title = '';
  c.controller.prepare();
  const locationBefore = location.href;
  await goto('/reader-web/manage');
  assert.equal(location.href, locationBefore);
  assert.equal(c.leaveOpen, true);
  await c.leave(false);
  assert.equal(location.pathname, '/reader-web/manage');
  assert.equal(c.editing, undefined);
  assert((await database.drafts('local')).some((item) => item.session === session));
  c.controller.destroy();
  await goto('/reader-web/snippets');
  assert.equal(location.pathname, '/reader-web/snippets');
  assert.equal(c.leaveOpen, false);
});

test('native reader close waits for durable progress and permits explicit retry after failure', async () => {
  const doc = documentAPI.createSnippet(documentAPI.plainContent('保存する位置'));
  const c = createReader({ document: doc, selectedScope: fixture.scope() });
  const locator = {
    blockId: documentAPI.passages(doc.content)[0].blockId,
    quote: '保存',
    before: '',
    offset: 0,
    revision: doc.revision
  };
  let release;
  fixture.memory.beforeProgress = () => new Promise((resolve) => (release = resolve));
  c.pendingPosition = locator;
  let closed = false;
  const closing = c.flushPosition().then(() => (closed = true));
  await pause();
  assert.equal(closed, false);
  release();
  await closing;
  assert.equal(closed, true);
  fixture.memory.beforeProgress = async () => {
    throw new Error('storage unavailable');
  };
  c.pendingPosition = locator;
  await assert.rejects(c.flushPosition(), /storage unavailable/);
  fixture.memory.beforeProgress = undefined;
  const before = fixture.memory.progress.length;
  await c.flushPosition();
  assert.equal(fixture.memory.progress.length, before + 1);
  assert.deepEqual(fixture.memory.progress.at(-1)[1], locator);
  c.controller.destroy();
});
