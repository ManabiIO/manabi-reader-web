/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical,
  createSnippet,
  editSnippet,
  appendSnippet,
  displayTitle,
  encodeSnippet,
  parseSnippet,
  plainContent,
  passages,
  searchSnippet,
  resolveLocator,
  filename,
  MAX_SNIPPET_BYTES,
  validateContent
} from '../../apps/web/src/lib/snippets/document.ts';
import {
  saveDocument,
  getRecord,
  saveDraft,
  drafts,
  deleteDraft,
  recordKey,
  summaries,
  acceptRemote,
  acknowledge,
  locationKey,
  beginTransfer,
  putTransfer,
  transfers
} from '../../apps/web/src/lib/snippets/database.ts';
import { integrationDB } from '../../apps/web/src/lib/manabi/persistence.ts';
import {
  readerHTML,
  parseLocator,
  safeReturn
} from '../../apps/web/src/lib/snippets/presentation.ts';
import { scope } from '../../apps/web/src/lib/snippets/scope.ts';
import {
  flushRecord,
  flushSnippets,
  refreshSnippets,
  suggestedDestination,
  resolveConflict
} from '../../apps/web/src/lib/snippets/service.ts';
import {
  moveSnippet,
  resumeTransfer,
  currentTransfer,
  keepBoth
} from '../../apps/web/src/lib/snippets/transfers.ts';
import {
  saveProgress,
  readingKey,
  syncReading
} from '../../apps/web/src/lib/snippets/reading-state.ts';
import { memory, changeUser } from 'snippet-fixture';
const guard = () => undefined;
const owner = () => crypto.randomUUID();
const source = (id = crypto.randomUUID()) => ({
  id,
  owner: null,
  provider: 'local',
  root: '',
  name: 'Test folder'
});
const document = (text = '東京へ行きます。', title = '') =>
  createSnippet(plainContent(text), title);
function ruby() {
  return createSnippet({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: crypto.randomUUID() },
        content: [
          {
            type: 'text',
            text: '東京',
            marks: [{ type: 'rubyText', attrs: { rt: 'とうきょう' } }]
          },
          { type: 'text', text: 'へ行く。' }
        ]
      }
    ]
  });
}
async function stored(text = '元の文章', s = source()) {
  const selected = scope(),
    doc = document(text);
  await saveDocument(selected.owner, doc, null, { source: s, parent: '' }, selected.guard);
  await flushRecord(doc.id, selected);
  return { selected, doc, source: s };
}

test('automatic titles exclude ruby and preserve Japanese graphemes', () => {
  const doc = ruby();
  assert.equal(displayTitle(doc), '東京へ行く。');
  const long = document('👩‍👩‍👧‍👦'.repeat(40));
  assert.equal(
    [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(displayTitle(long))].length,
    37
  );
});
test('custom titles never retitle on edit or append', () => {
  const doc = document('一行目', 'Custom title longer than an automatically generated title');
  const next = appendSnippet(doc, plainContent('二行目'), crypto.randomUUID());
  assert.equal(displayTitle(next), doc.title.text);
  assert.equal(next.id, doc.id);
});
test('automatic heading title updates and choosing automatic is explicit', () => {
  let doc = document('first', 'Custom');
  doc = editSnippet(
    doc,
    {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] }
      ]
    },
    ''
  );
  assert.equal(displayTitle(doc), '見出し');
  assert.equal(doc.title.mode, 'automatic');
});
test('append receipt makes retry exactly idempotent and keeps prior blocks', () => {
  const doc = document(),
    op = crypto.randomUUID(),
    next = appendSnippet(doc, plainContent('追加'), op);
  assert.equal(canonical(appendSnippet(next, plainContent('追加'), op)), canonical(next));
  assert.equal(next.content.content[0].attrs.id, doc.content.content[0].attrs.id);
  assert.equal(passages(next.content).length, 2);
});
test('revision ancestry survives multiple offline edits', () => {
  const a = document(),
    b = editSnippet(a, plainContent('b'), ''),
    c = editSnippet(b, plainContent('c'), '');
  assert(c.parents.includes(a.revision));
  assert(c.parents.includes(b.revision));
  assert.equal(c.id, a.id);
});
test('canonical JSON ignores object insertion order', () => {
  const doc = document();
  assert.equal(canonical(doc), canonical(Object.fromEntries(Object.entries(doc).reverse())));
  assert.equal(canonical(parseSnippet(encodeSnippet(doc))), canonical(doc));
});
test('unknown schema nodes and malformed lists fail closed', () => {
  assert.throws(() =>
    validateContent({
      type: 'doc',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }]
    })
  );
  assert.throws(() => validateContent({ type: 'doc', content: [{ type: 'secretFutureNode' }] }));
});
test('duplicate JSON keys and future formats are rejected without normalization', () => {
  assert.throws(() => parseSnippet('{"format":"a","format":"b"}'));
  const doc = document();
  assert.throws(() => parseSnippet(JSON.stringify({ ...doc, version: 2 })));
  assert.throws(() => parseSnippet(JSON.stringify({ ...doc, extra: 1 })));
});
test('unsupported links cannot become executable reader markup', () => {
  const doc = document('<img src=x onerror=alert(1)>');
  assert(!readerHTML(doc.content).includes('<img'));
  const bad = structuredClone(doc.content);
  bad.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }];
  assert.throws(() => readerHTML(bad));
});
test('ruby search includes reading but does not pollute base text', () => {
  const doc = ruby();
  assert.equal(passages(doc.content)[0].text, '東京へ行く。');
  const hit = searchSnippet(doc, 'トウキョウ')[0];
  assert.equal(hit.reading, true);
  assert.equal(hit.locator.quote, '東京');
  assert.equal(searchSnippet(doc, '東京')[0].reading, false);
});
test('width normalization maps expanded text back to original offsets', () => {
  const doc = document('㍿ＡＢＣ');
  const hit = searchSnippet(doc, '株式会社')[0];
  assert.equal(hit.locator.quote, '㍿');
  assert.equal(searchSnippet(doc, 'abc')[0].locator.quote, 'ＡＢＣ');
});
test('locator follows changed text and refuses ambiguous matches', () => {
  const doc = document('before 東京 after'),
    loc = searchSnippet(doc, '東京')[0].locator;
  const edited = editSnippet(doc, plainContent('before 東京 after updated'), '');
  assert(resolveLocator(edited, loc));
  const ambiguous = editSnippet(doc, plainContent('before 東京 after\nbefore 東京 after'), '');
  assert.equal(resolveLocator(ambiguous, { ...loc, blockId: 'missing' }), null);
});
test('portable filename has bounded UTF-8 and keeps stable identity', () => {
  const doc = document('日'.repeat(500));
  assert(new TextEncoder().encode(filename(doc)).length <= 240);
  assert(filename(doc).includes(doc.id));
  assert(!filename(document('.. / : * " < > |')).includes('/'));
});
test('document byte budget includes the newline', () => {
  const doc = document('あ'.repeat(500000));
  assert(new TextEncoder().encode(encodeSnippet(doc)).length < MAX_SNIPPET_BYTES);
  assert.throws(() => encodeSnippet(document('あ'.repeat(800000))));
});
test('malicious return links cannot leave Reader routes', () => {
  for (const raw of [
    '//evil.test',
    'https://evil.test',
    '/reader-web/../auth',
    '/reader-web/snippets\\evil',
    '/reader-web/snippets\n'
  ])
    assert.equal(safeReturn(raw, '/reader-web'), '/reader-web/snippets');
  assert.equal(
    safeReturn('/reader-web/manage?q=本', '/reader-web'),
    '/reader-web/manage?q=%E6%9C%AC'
  );
  assert.equal(parseLocator('{"offset":-1}'), undefined);
});

test('additive IndexedDB schema retains existing metadata and book stores', async () => {
  const db = await integrationDB();
  assert.equal(db.version, 3);
  for (const name of [
    'metadata',
    'localLibraries',
    'books',
    'snippets',
    'snippetDrafts',
    'snippetTransfers',
    'snippetSummaries'
  ])
    assert(db.objectStoreNames.contains(name));
  await db.put('metadata', { sentinel: 1 }, 'test-retained');
  const doc = document(),
    who = owner();
  await saveDocument(who, doc, null, undefined, guard);
  assert.deepEqual(await db.get('metadata', 'test-retained'), { sentinel: 1 });
});
test('document and lightweight searchable summary commit atomically', async () => {
  const who = owner(),
    doc = document();
  await saveDocument(who, doc, null, undefined, guard);
  const [summary] = await summaries(who);
  assert.equal(summary.id, doc.id);
  assert.equal(summary.title, displayTitle(doc));
  assert.equal(summary.document, undefined);
  assert.equal(summary.excerpt, '東京へ行きます。');
});
test('cross-tab stale save is rejected and old data stays intact', async () => {
  const who = owner(),
    doc = document();
  await saveDocument(who, doc, null, undefined, guard);
  const a = editSnippet(doc, plainContent('勝者'), ''),
    b = editSnippet(doc, plainContent('古い編集'), '');
  await saveDocument(who, a, doc.revision, undefined, guard);
  await assert.rejects(
    () => saveDocument(who, b, doc.revision, undefined, guard),
    /changed in another tab/
  );
  assert.equal((await getRecord(who, doc.id)).document.revision, a.revision);
});
test('guard failure aborts both body and summary publication', async () => {
  const who = owner(),
    doc = document();
  let count = 0;
  await assert.rejects(() =>
    saveDocument(who, doc, null, undefined, () => {
      if (++count === 2) throw new Error('account changed');
    })
  );
  assert.equal(await getRecord(who, doc.id), undefined);
  assert.deepEqual(await summaries(who), []);
});
test('drafts are private, durable, and not catalog/search members', async () => {
  const who = owner(),
    doc = document(),
    session = crypto.randomUUID(),
    draft = {
      key: recordKey(who, session),
      owner: who,
      id: doc.id,
      session,
      base: null,
      document: doc,
      updatedAt: 20
    };
  await saveDraft(draft, guard);
  await saveDraft({ ...draft, updatedAt: 10, document: document('older') }, guard).catch(
    () => undefined
  );
  assert.equal((await drafts(who))[0].document.id, doc.id);
  assert.deepEqual(await summaries(who), []);
  assert.deepEqual(await drafts(owner()), []);
  await deleteDraft(draft.key, guard);
  assert.deepEqual(await drafts(who), []);
});
test('a delayed older draft cannot replace a newer draft', async () => {
  const who = owner(),
    doc = document(),
    session = crypto.randomUUID(),
    draft = {
      key: recordKey(who, session),
      owner: who,
      id: doc.id,
      session,
      base: null,
      document: doc,
      updatedAt: 20
    };
  await saveDraft(draft, guard);
  await saveDraft(
    { ...draft, document: { ...doc, title: { mode: 'custom', text: 'stale' } }, updatedAt: 10 },
    guard
  );
  assert.equal((await drafts(who))[0].document.title.mode, 'automatic');
});
test('same UUID in another location is discovered without content-identity replacement', async () => {
  const who = owner(),
    doc = document(),
    a = { source: source(), parent: '', name: 'a.manabi-snippet.json', fileId: 'a', token: '1' },
    b = { ...a, source: source(), fileId: 'b' };
  await acceptRemote(who, doc, a, guard);
  await acceptRemote(who, doc, b, guard);
  const record = await getRecord(who, doc.id);
  assert.equal(record.locations.length, 2);
  assert.equal(record.primary, locationKey(a));
  assert.equal(record.conflicts.length, 0);
});
test('divergent remote edits are retained rather than last-write-wins', async () => {
  const who = owner(),
    doc = document(),
    location = {
      source: source(),
      parent: '',
      name: 'a.manabi-snippet.json',
      fileId: 'a',
      token: '1'
    };
  await acceptRemote(who, doc, location, guard);
  const here = editSnippet(doc, plainContent('local'), ''),
    there = editSnippet(doc, plainContent('remote'), '');
  await saveDocument(who, here, doc.revision, location, guard);
  await acceptRemote(who, there, { ...location, token: '2' }, guard);
  const record = await getRecord(who, doc.id);
  assert.equal(record.document.revision, here.revision);
  assert.equal(record.conflicts[0].revision, there.revision);
  assert.equal(record.remoteRevision, there.revision);
});
test('acknowledgement must own the exact pending snapshot', async () => {
  const who = owner(),
    doc = document();
  await saveDocument(who, doc, null, undefined, guard);
  await assert.rejects(
    () =>
      acknowledge(
        who,
        doc.id,
        doc,
        { source: source(), fileId: 'a', name: 'a.manabi-snippet.json', parent: '', token: 'x' },
        guard
      ),
    /no longer owns/
  );
});

test('lost create reply plus subsequent edit replays original snapshot without duplicate create', async () => {
  const s = scope(),
    doc = document(),
    dest = { source: source(), parent: '' };
  await saveDocument(s.owner, doc, null, dest, s.guard);
  memory.dropReply = true;
  await assert.rejects(() => flushRecord(doc.id, s));
  const before = await getRecord(s.owner, doc.id),
    newer = editSnippet(doc, plainContent('newer edit'), '');
  await saveDocument(s.owner, newer, doc.revision, dest, s.guard);
  await flushRecord(doc.id, s);
  let record = await getRecord(s.owner, doc.id);
  assert.equal(record.dirty, true);
  assert(record.document.parents.includes(doc.revision));
  await flushRecord(doc.id, s);
  record = await getRecord(s.owner, doc.id);
  assert.equal(record.dirty, false);
  assert.equal(record.locations.length, 1);
  assert.equal(record.locations[0].fileId, before.upload.destination.createId);
  assert.equal(
    memory.files.get(record.locations[0].fileId).document.content.content[0].content[0].text,
    'newer edit'
  );
});
test('new edit arriving while upload is in flight remains dirty after acknowledgement', async () => {
  const s = scope(),
    doc = document(),
    dest = { source: source(), parent: '' };
  await saveDocument(s.owner, doc, null, dest, s.guard);
  memory.beforeWrite = async () => {
    memory.beforeWrite = null;
    await saveDocument(
      s.owner,
      editSnippet(doc, plainContent('later'), ''),
      doc.revision,
      dest,
      s.guard
    );
  };
  await flushRecord(doc.id, s);
  const record = await getRecord(s.owner, doc.id);
  assert(record.dirty);
  assert.equal(passages(record.document.content)[0].text, 'later');
});
test('account ABA invalidates a captured operation lifetime', () => {
  changeUser('alice');
  const old = scope();
  changeUser('bob');
  changeUser('alice');
  assert.throws(old.guard, /account_changed/);
  changeUser(null);
});
test('multiple writable providers have no arbitrary default', async () => {
  memory.sources = [source(), source()];
  assert.equal(await suggestedDestination(scope()), undefined);
  memory.sources = [source()];
  assert.equal((await suggestedDestination(scope())).source.id, memory.sources[0].id);
  memory.sources = [];
});
test('index checkpoints continue past 100 bodies without restarting completed sources', async () => {
  const s = scope(),
    src = source();
  memory.sources = [src];
  for (let i = 0; i < 125; i++) {
    const doc = document('索引' + i);
    memory.files.set(doc.id, {
      document: doc,
      location: {
        source: src,
        fileId: doc.id,
        name: doc.id + '.manabi-snippet.json',
        parent: '',
        token: '1'
      }
    });
  }
  const before = memory.readCount;
  await refreshSnippets(s, true);
  assert.equal(memory.readCount - before, 100);
  await refreshSnippets(s, false);
  assert.equal(memory.readCount - before, 125);
  memory.sources = [];
});
test('move reservation and journal are atomic, stale reservations fail', async () => {
  const who = owner(),
    doc = document();
  await saveDocument(who, doc, null, undefined, guard);
  const id = crypto.randomUUID(),
    op = {
      key: recordKey(who, id),
      owner: who,
      id,
      snippetId: doc.id,
      document: doc,
      to: { source: source(), parent: '' },
      phase: 'prepared'
    };
  await assert.rejects(() => beginTransfer(op, crypto.randomUUID(), guard));
  assert.equal((await getRecord(who, doc.id)).transfer, undefined);
  assert.equal((await transfers(who)).length, 0);
  await beginTransfer(op, doc.revision, guard);
  assert.equal((await getRecord(who, doc.id)).transfer, id);
  await assert.rejects(
    () => putTransfer({ ...op, to: { source: source(), parent: 'other' } }, guard),
    /identity changed/
  );
});
test('copy then cleanup failure preserves both and resumes without repeated upload', async () => {
  const { selected: s, doc } = await stored(),
    before = await getRecord(s.owner, doc.id),
    from = before.locations[0],
    dest = { source: source(), parent: '' };
  memory.failRemove = true;
  await assert.rejects(() => moveSnippet(doc.id, dest, doc.revision, s));
  let transfer = await currentTransfer(doc.id, s);
  assert.equal(transfer.phase, 'copied');
  assert(memory.files.has(from.fileId));
  assert(memory.files.has(transfer.copied.fileId));
  const count = memory.writes.length;
  memory.failRemove = false;
  await resumeTransfer(doc.id, s);
  assert.equal(memory.writes.length, count);
  assert(!memory.files.has(from.fileId));
  const current = await getRecord(s.owner, doc.id);
  assert.equal(current.document.id, doc.id);
  assert.equal(current.transfer, undefined);
  assert.equal(current.destination.source.id, dest.source.id);
});
test('source edit during failed transfer prevents cleanup and keeps both', async () => {
  const { selected: s, doc } = await stored(),
    from = (await getRecord(s.owner, doc.id)).locations[0];
  memory.failRemove = true;
  await assert.rejects(() =>
    moveSnippet(doc.id, { source: source(), parent: '' }, doc.revision, s)
  );
  memory.failRemove = false;
  const remote = memory.files.get(from.fileId);
  remote.document = editSnippet(doc, plainContent('external edit'), '');
  remote.location.token = 'changed';
  await assert.rejects(() => resumeTransfer(doc.id, s));
  assert(memory.files.has(from.fileId));
  await keepBoth(doc.id, s);
  assert.equal((await getRecord(s.owner, doc.id)).transfer, undefined);
  assert.equal((await getRecord(s.owner, doc.id)).locations.length, 2);
});
test('reading keys stay stable across edits and reading state travels with a move', async () => {
  const { selected: s, doc } = await stored(),
    loc = searchSnippet(doc, '文章')[0].locator;
  assert.equal(
    await readingKey(doc.id),
    await readingKey(editSnippet(doc, plainContent('changed'), '').id)
  );
  await saveProgress(doc.id, loc, s);
  await syncReading(doc.id, s);
  const dest = { source: source(), parent: '' };
  await moveSnippet(doc.id, dest, doc.revision, s);
  const state = memory.states.get(dest.source.id + (await readingKey(doc.id)));
  assert.equal(state.value.locator.blockId, loc.blockId);
  assert.equal((await getRecord(s.owner, doc.id)).progress.blockId, loc.blockId);
});

test('a flush drains a newer edit made during its first successful upload', async () => {
  const s = scope(),
    doc = document(),
    dest = { source: source(), parent: '' };
  await saveDocument(s.owner, doc, null, dest, s.guard);
  memory.beforeWrite = async () => {
    memory.beforeWrite = null;
    await saveDocument(
      s.owner,
      editSnippet(doc, plainContent('drained edit'), ''),
      doc.revision,
      dest,
      s.guard
    );
  };
  await flushSnippets(s);
  const current = await getRecord(s.owner, doc.id);
  assert.equal(current.dirty, false);
  assert.equal(current.upload, undefined);
  assert.equal(
    passages(memory.files.get(current.locations[0].fileId).document.content)[0].text,
    'drained edit'
  );
});
test('conflict resolution makes a new revision descending from both versions', async () => {
  const who = owner(),
    selected = { owner: who, guard },
    doc = document();
  const location = {
    source: source(),
    fileId: 'conflict-doc',
    parent: '',
    name: 'a.manabi-snippet.json',
    token: '1'
  };
  await acceptRemote(who, doc, location, guard);
  const here = editSnippet(doc, plainContent('chosen local'), ''),
    there = editSnippet(doc, plainContent('remote'), '');
  await saveDocument(who, here, doc.revision, location, guard);
  await acceptRemote(who, there, { ...location, token: '2' }, guard);
  await resolveConflict(doc.id, here, here.revision, selected);
  const current = await getRecord(who, doc.id);
  assert(current.document.parents.includes(here.revision));
  assert(current.document.parents.includes(there.revision));
  assert.notEqual(current.document.revision, here.revision);
  assert.equal(current.conflicts.length, 0);
  assert.equal(current.remoteRevision, there.revision);
});
