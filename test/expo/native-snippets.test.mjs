/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import 'fake-indexeddb/auto';
const output = mkdtempSync(join(tmpdir(), 'native-snippets-'));
const require = createRequire(import.meta.url);
const outfile = join(output, 'unit.cjs');
buildSync({
  stdin: {
    contents: `export * from './apps/web/src/native-snippets/service'; export * from './apps/web/src/native-snippets/editor-model'; export * from './apps/web/src/lib/snippets/document'; export * from './apps/web/src/lib/snippets/database';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent'
});
const {
  NativeSnippetsService,
  nativeRuns,
  parsePatch,
  applyNativePatch,
  createSnippet,
  plainContent,
  canonical,
  editSnippet,
  searchSnippet,
  saveDocument,
  getRecord,
  summaries,
  saveDraft,
  drafts,
  deleteDraft,
  mutateRecord
} = require(outfile);
function fixture() {
  const owner = `test:${crypto.randomUUID()}`;
  let identity = 'session:0';
  let ticks = 1000;
  let hook;
  let writeHook;
  const abort = new AbortController();
  const source = {
    id: 'drive1',
    name: 'Writing',
    owner: null,
    root: 'https://user:secret@example.test/private',
    provider: 'webdav'
  };
  const authority = {
    key: identity,
    signal: abort.signal,
    assertCurrent() {
      if (identity !== authority.key) throw new Error('account changed');
    }
  };
  const guard = () => {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  };
  const repository = {
    async load() {
      await hook?.();
      guard();
      return {
        owner,
        items: await summaries(owner),
        drafts: await drafts(owner),
        sources: [{ source, writable: true }]
      };
    },
    async read(id) {
      await hook?.();
      guard();
      return getRecord(owner, id);
    },
    async checkpoint(draft, admitted) {
      await writeHook?.();
      admitted.assertCurrent();
      await saveDraft(draft, guard);
    },
    async discard(draft) {
      await deleteDraft(draft.key, guard);
    },
    async save(draft) {
      await writeHook?.();
      await saveDocument(owner, draft.document, draft.base, draft.destination, guard);
      await deleteDraft(draft.key, guard);
    },
    async trash(id, expected, restore) {
      await mutateRecord(owner, id, guard, (current) => {
        assert.equal(current.document.revision, expected, 'revision fence');
        const document = editSnippet(
          current.document,
          current.document.content,
          current.document.title.text
        );
        if (restore) delete document.trashedAt;
        else document.trashedAt = Date.now();
        return { ...current, document };
      });
    },
    async folders() {
      await hook?.();
      guard();
      return [{ id: source.root + '/folder', name: 'Child' }];
    },
    async search(query, items) {
      const ids = new Set();
      for (const item of items)
        if (
          searchSnippet((await getRecord(owner, item.id)).document, query, 1).length ||
          item.title.includes(query)
        )
          ids.add(item.id);
      return { ids, complete: true };
    }
  };
  const service = new NativeSnippetsService(
    repository,
    () => crypto.randomUUID(),
    () => ++ticks
  );
  return {
    service,
    authority,
    repository,
    owner,
    source,
    changeAccount() {
      identity = 'session:2';
    },
    abort() {
      abort.abort();
    },
    hook(value) {
      hook = value;
    },
    writeHook(value) {
      writeHook = value;
    },
    tick() {
      ticks += 31 * 60000;
    },
    async seed(document = createSnippet(plainContent('東京に行く。'))) {
      await saveDocument(owner, document, null, undefined, guard);
      return document;
    }
  };
}
const patchFor = (editor) => ({
  title: editor.title,
  runs: editor.runs.map(({ key, text, ruby }) => ({
    key,
    text,
    ...(ruby !== undefined ? { ruby } : {})
  })),
  source: { ...editor.source }
});
async function fresh(f) {
  const state = await f.service.state({}, f.authority);
  return f.service.action({ type: 'new', token: state.token }, f.authority);
}
async function open(f, document) {
  const state = await f.service.state({}, f.authority);
  const item =
    state.items.find((item) => item.title === (document?.title.text || '東京に行く。')) ??
    state.items[0];
  return f.service.action({ type: 'edit', token: state.token, key: item.key }, f.authority);
}
function rich() {
  return createSnippet({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [
          {
            type: 'text',
            text: '東京',
            marks: [
              { type: 'rubyText', attrs: { rt: 'とうきょう' } },
              { type: 'bold' },
              { type: 'link', attrs: { href: 'https://example.test' } }
            ]
          }
        ]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: '本文' },
                  { type: 'hardBreak' },
                  { type: 'text', text: '続く', marks: [{ type: 'italic' }] }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'js' },
        content: [{ type: 'text', text: 'const x = 1;' }]
      },
      { type: 'horizontalRule' },
      { type: 'paragraph' }
    ]
  });
}
test('native structured editing preserves rich tree, links, block IDs, ruby and source attribution', () => {
  const doc = rich();
  doc.source = { title: 'Source', url: 'https://example.test', item: 'chapter-1', quote: 'quoted' };
  const before = structuredClone(doc);
  const runs = nativeRuns(doc);
  const patch = {
    title: 'New title',
    runs: runs.map(({ key, text, ruby }) => ({
      key,
      text,
      ...(ruby !== undefined ? { ruby } : {})
    })),
    source: { title: 'Changed source', url: '' }
  };
  patch.runs[0].text = '京都';
  patch.runs[0].ruby = 'きょうと';
  const next = applyNativePatch(doc, parsePatch(patch));
  assert.equal(canonical(doc), canonical(before));
  assert.equal(next.content.content[0].attrs.id, before.content.content[0].attrs.id);
  assert.equal(next.content.content[0].attrs.level, 2);
  assert.equal(next.content.content[1].type, 'bulletList');
  assert.equal(next.content.content[1].content[0].content[0].content[1].type, 'hardBreak');
  assert.equal(
    next.content.content[0].content[0].marks.find((m) => m.type === 'link').attrs.href,
    'https://example.test'
  );
  assert.equal(
    next.content.content[0].content[0].marks.find((m) => m.type === 'rubyText').attrs.rt,
    'きょうと'
  );
  assert.equal(next.source.item, 'chapter-1');
  assert.equal(next.source.quote, 'quoted');
  assert.equal(next.source.url, undefined);
});
test('explicit text removal, append and empty paragraph editing retain nontext structure', () => {
  const doc = rich();
  const patch = {
    title: '',
    runs: nativeRuns(doc).map(({ key, text, ruby }) => ({ key, text, ruby })),
    source: { title: '', url: '' },
    append: '追加\n次'
  };
  patch.runs[1].text = '';
  patch.runs.at(-1).text = 'empty filled';
  const next = applyNativePatch(doc, parsePatch(patch));
  assert.equal(next.content.content[1].content[0].content[0].content[0].type, 'hardBreak');
  assert.equal(next.content.content[3].type, 'horizontalRule');
  assert.equal(next.content.content.at(-1).content[0].text, '次');
});
test('invalid, executable and oversized patches reject rather than strip', () => {
  const doc = rich();
  const patch = {
    title: '',
    runs: nativeRuns(doc).map(({ key, text }) => ({ key, text })),
    source: { title: '', url: '' }
  };
  for (const value of [
    { ...patch, source: { title: '', url: 'javascript:alert(1)' } },
    { ...patch, runs: [patch.runs[0], patch.runs[0]] },
    { ...patch, owner: 'foreign' },
    { ...patch, title: 'x'.repeat(1001) }
  ])
    assert.throws(() => parsePatch(value));
  assert.throws(
    () => applyNativePatch(doc, { ...patch, runs: patch.runs.slice(1) }),
    /structure changed/
  );
  assert.throws(() => nativeRuns(createSnippet(plainContent('x'.repeat(330000)))), /limit/);
});
test('new, checkpoint and save use real IndexedDB draft/revision APIs', async () => {
  const f = fixture();
  let { editor } = await fresh(f);
  assert.equal((await drafts(f.owner)).length, 1);
  let patch = patchFor(editor);
  patch.runs[0].text = '日本語';
  ({ editor } = await f.service.action(
    { type: 'checkpoint', token: editor.token, key: editor.key, patch },
    f.authority
  ));
  assert.equal((await drafts(f.owner))[0].document.content.content[0].content[0].text, '日本語');
  const result = await f.service.action(
    { type: 'save', token: editor.token, key: editor.key, patch: patchFor(editor) },
    f.authority
  );
  assert.equal(result.saved, true);
  assert.equal((await summaries(f.owner)).length, 1);
  assert.equal((await drafts(f.owner)).length, 0);
});
test('repeated clicks replay receipt without duplicate drafts or writes; changed replay rejected', async () => {
  const f = fixture();
  const state = await f.service.state({}, f.authority);
  const action = { type: 'new', token: state.token };
  const one = await f.service.action(action, f.authority);
  const two = await f.service.action(action, f.authority);
  assert.deepEqual(two, one);
  assert.equal((await drafts(f.owner)).length, 1);
  await assert.rejects(
    f.service.action({ ...action, type: 'trash', key: 'forged' }, f.authority),
    /already used/
  );
});
test('concurrent actions admit one write and own mutable caller payload', async () => {
  const f = fixture();
  const { editor } = await fresh(f);
  let release;
  f.writeHook(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const patch = patchFor(editor);
  patch.title = 'Original';
  const payload = { type: 'checkpoint', token: editor.token, key: editor.key, patch };
  const pending = f.service.action(payload, f.authority);
  patch.title = 'Changed after admission';
  await assert.rejects(f.service.action(payload, f.authority), /expired|progress/);
  release();
  const next = await pending;
  assert.equal(next.editor.title, 'Original');
});
test('stale save preserves durable draft and explicit copy keeps both documents', async () => {
  const f = fixture();
  const doc = await f.seed();
  let { editor } = await open(f, doc);
  await saveDocument(
    f.owner,
    editSnippet(doc, plainContent('New remote version'), ''),
    doc.revision,
    undefined,
    () => {}
  );
  const patch = patchFor(editor);
  patch.runs[0].text = 'My unsynced edit';
  let result = await f.service.action(
    { type: 'save', token: editor.token, key: editor.key, patch },
    f.authority
  );
  assert.equal(result.editor.hasConflict, true);
  assert.equal((await drafts(f.owner)).length, 1);
  assert.equal(
    (await getRecord(f.owner, doc.id)).document.content.content[0].content[0].text,
    'New remote version'
  );
  editor = result.editor;
  result = await f.service.action(
    { type: 'save-copy', token: editor.token, key: editor.key, patch: patchFor(editor) },
    f.authority
  );
  assert.equal(result.saved, true);
  assert.equal((await summaries(f.owner)).length, 2);
});
test('draft survives service teardown; resume leases it without duplicate draft and marks changed base', async () => {
  const f = fixture();
  const doc = await f.seed();
  const { editor } = await open(f, doc);
  f.service.dispose();
  await saveDocument(
    f.owner,
    editSnippet(doc, doc.content, 'New'),
    doc.revision,
    undefined,
    () => {}
  );
  const state = await f.service.state({}, f.authority);
  assert.equal(state.drafts.length, 1);
  const result = await f.service.action(
    { type: 'resume', token: state.token, key: state.drafts[0].key },
    f.authority
  );
  assert.equal(result.editor.hasConflict, true);
  assert.notEqual(result.editor.key, editor.key);
  assert.equal((await drafts(f.owner)).length, 1);
});
test('native account ABA and aborted reads never publish former account data', async () => {
  const f = fixture();
  await f.seed();
  const state = await f.service.state({}, f.authority);
  f.changeAccount();
  await assert.rejects(
    f.service.action(
      { type: 'duplicate', token: state.token, key: state.items[0].key },
      f.authority
    ),
    /account changed/
  );
  assert.equal((await drafts(f.owner)).length, 0);
  const g = fixture();
  g.hook(() => g.abort());
  await assert.rejects(g.service.state({}, g.authority), /abort/i);
});
test('account switch during checkpoint prevents durable write', async () => {
  const f = fixture();
  const { editor } = await fresh(f);
  f.writeHook(() => f.changeAccount());
  const patch = patchFor(editor);
  patch.title = 'Must not persist';
  await assert.rejects(
    f.service.action(
      { type: 'checkpoint', token: editor.token, key: editor.key, patch },
      f.authority
    ),
    /account changed/
  );
  assert.notEqual((await drafts(f.owner))[0].document.title.text, 'Must not persist');
});
test('dispose while reading prevents late publication and clears handles', async () => {
  const f = fixture();
  await f.seed();
  f.hook(() => f.service.dispose());
  await assert.rejects(f.service.state({}, f.authority), /session changed/);
});
test('opaque source/folder handles never expose private URLs and cannot forge destination access', async () => {
  const f = fixture();
  const state = await f.service.state({}, f.authority);
  assert.ok(!JSON.stringify(state).includes('secret'));
  assert.ok(!JSON.stringify(state).includes('/private'));
  const result = await f.service.action(
    { type: 'browse', token: state.token, key: state.sources[0].key },
    f.authority
  );
  assert.ok(!JSON.stringify(result).includes('secret'));
  await assert.rejects(
    f.service.action(
      { type: 'browse', token: state.token, key: 'https://attacker.test' },
      f.authority
    ),
    /unavailable/
  );
});
test('destination selection carries only verified source and parent to persisted draft', async () => {
  const f = fixture();
  const state = await f.service.state({}, f.authority);
  const { editor } = await f.service.action({ type: 'new', token: state.token }, f.authority);
  const patch = { ...patchFor(editor), destinationKey: state.sources[0].key };
  await f.service.action(
    { type: 'checkpoint', token: editor.token, key: editor.key, patch },
    f.authority
  );
  assert.equal((await drafts(f.owner))[0].destination.source.root, f.source.root);
});
test('existing destination cannot silently change through editor', async () => {
  const f = fixture();
  const doc = await f.seed();
  const { editor } = await open(f, doc);
  await assert.rejects(
    f.service.action(
      {
        type: 'checkpoint',
        token: editor.token,
        key: editor.key,
        patch: { ...patchFor(editor), destinationKey: null }
      },
      f.authority
    ),
    /Moving/
  );
});
test('trash is soft and restorable with a revision-checked transaction', async () => {
  const f = fixture();
  await f.seed();
  let state = await f.service.state({}, f.authority);
  await f.service.action(
    { type: 'trash', token: state.token, key: state.items[0].key },
    f.authority
  );
  assert.equal((await f.service.state({}, f.authority)).total, 0);
  state = await f.service.state({ trash: true }, f.authority);
  assert.equal(state.total, 1);
  await f.service.action(
    { type: 'restore', token: state.token, key: state.items[0].key },
    f.authority
  );
  assert.equal((await f.service.state({}, f.authority)).total, 1);
});
test('duplicate retains rich document and attribution, but starts as separately reviewable device draft', async () => {
  const f = fixture();
  const doc = rich();
  doc.source = { title: 'Original' };
  await f.seed(doc);
  const state = await f.service.state({}, f.authority);
  await f.service.action(
    { type: 'duplicate', token: state.token, key: state.items[0].key },
    f.authority
  );
  const draft = (await drafts(f.owner))[0];
  assert.notEqual(draft.id, doc.id);
  assert.equal(draft.base, null);
  assert.equal(draft.document.source.title, 'Original');
  assert.equal(draft.document.content.content[1].type, 'bulletList');
  assert.equal(draft.destination, undefined);
  assert.equal((await summaries(f.owner)).length, 1);
});
test('search matches full body and ruby; paging returns a bounded list', async () => {
  const f = fixture();
  await f.seed(rich());
  assert.equal((await f.service.state({ query: 'とうきょう' }, f.authority)).total, 1);
  for (let i = 0; i < 41; i++) await f.seed(createSnippet(plainContent(`Text ${i}`)));
  const state = await f.service.state({}, f.authority);
  assert.equal(state.items.length, 40);
  assert.equal(state.pages, 2);
  assert.equal((await f.service.state({ page: 1 }, f.authority)).items.length, 2);
});
test('invalid queries, forged selections and expired admissions fail closed', async () => {
  const f = fixture();
  for (const query of [
    { query: 'x'.repeat(513) },
    { page: -1 },
    { url: 'https://example.test' },
    { trash: 'true' }
  ])
    await assert.rejects(f.service.state(query, f.authority));
  await f.seed();
  let state = await f.service.state({}, f.authority);
  await assert.rejects(
    f.service.action({ type: 'trash', token: state.token, key: 'forged' }, f.authority),
    /outside/
  );
  state = await f.service.state({}, f.authority);
  f.tick();
  await assert.rejects(
    f.service.action({ type: 'trash', token: state.token, key: state.items[0].key }, f.authority),
    /expired/
  );
  assert.equal((await summaries(f.owner)).length, 1);
});
test('reader admission returns the exact checked document revision', async () => {
  const f = fixture();
  const document = await f.seed();
  const state = await f.service.state({}, f.authority);
  const result = await f.service.action(
    { type: 'read', token: state.token, key: state.items[0].key },
    f.authority
  );
  assert.equal(result.readerId, document.id);
  assert.equal(result.readerRevision, document.revision);
});
test('dispose during checkpoint reaches the repository transaction-time fence', async () => {
  const f = fixture();
  const { editor } = await fresh(f);
  f.writeHook(() => f.service.dispose());
  const patch = patchFor(editor);
  patch.title = 'Do not persist';
  await assert.rejects(
    f.service.action(
      { type: 'checkpoint', token: editor.token, key: editor.key, patch },
      f.authority
    ),
    /session changed/
  );
  assert.notEqual((await drafts(f.owner))[0].document.title.text, 'Do not persist');
});
test.after(() => rmSync(output, { recursive: true, force: true }));
