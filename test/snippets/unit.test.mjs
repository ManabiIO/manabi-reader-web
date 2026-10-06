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
  MAX_SNIPPET_SEARCH_CODEPOINTS,
  snippetSearchTooLong,
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
import { integrationDB, setMetadata } from '../../apps/web/src/lib/manabi/persistence.ts';
import {
  readerHTML,
  parseLocator,
  safeReturn,
  snippetSourceId
} from '../../apps/web/src/lib/snippets/presentation.ts';
import { scope } from '../../apps/web/src/lib/snippets/scope.ts';
import {
  flushRecord,
  flushSnippets,
  refreshSnippets,
  startSnippets,
  snippetStatus,
  suggestedDestination,
  rememberDestination,
  resolveConflict,
  trashSnippet,
  appendToSnippet
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
import { get, writable } from '$lib/state/store';
import { isSnippetLibraryPath } from '../../apps/web/src/lib/snippets/discovery.ts';
import { boundLibrarySource } from '../../apps/web/src/lib/library/source-binding.ts';
import { createRouteLoads } from '../../apps/web/src/lib/snippets/route-load.ts';
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
  assert.equal(hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end), '東京');
  const literal = searchSnippet(doc, '東京')[0];
  assert.equal(literal.reading, false);
  assert.equal(literal.excerpt.slice(literal.excerptMatch.start, literal.excerptMatch.end), '東京');
});
test('width normalization maps expanded text back to original offsets', () => {
  const doc = document('㍿ＡＢＣ');
  const hit = searchSnippet(doc, '株式会社')[0];
  assert.equal(hit.locator.quote, '㍿');
  assert.equal(hit.excerpt.slice(hit.excerptMatch.start, hit.excerptMatch.end), '㍿');
  const width = searchSnippet(doc, 'abc')[0];
  assert.equal(width.locator.quote, 'ＡＢＣ');
  assert.equal(width.excerpt.slice(width.excerptMatch.start, width.excerptMatch.end), 'ＡＢＣ');
});
test('snippet search limit counts Unicode code points end to end', () => {
  const accepted = '𠮷'.repeat(MAX_SNIPPET_SEARCH_CODEPOINTS);
  assert.equal(snippetSearchTooLong(accepted), false);
  assert.equal(snippetSearchTooLong(accepted + '𠮷'), true);
  const doc = document(accepted);
  const hit = searchSnippet(doc, accepted, 1);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].locator.quote, accepted);
  assert.deepEqual(searchSnippet(doc, accepted + '𠮷', 1), []);
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
test('portable snippet provenance resolves only a validated snippet UUID', () => {
  const id = crypto.randomUUID();
  assert.equal(snippetSourceId(`snippet:${id}`), id);
  for (const value of [
    undefined,
    '',
    'book:' + id,
    'snippet:not-a-uuid',
    'snippet:' + id + '/extra',
    'snippet:../../b?id=1'
  ])
    assert.equal(snippetSourceId(value), undefined);
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
test('causal descendant in another source wins independent of discovery order', async () => {
  const who = owner(),
    original = document('before'),
    newer = editSnippet(original, plainContent('after'), ''),
    staleLocation = {
      source: source('stale-source'),
      parent: '',
      name: 'stale.manabi-snippet.json',
      fileId: 'stale',
      token: 'stale-token'
    },
    newerLocation = {
      source: source('new-source'),
      parent: '',
      name: 'new.manabi-snippet.json',
      fileId: 'new',
      token: 'new-token'
    };
  // Fresh browser happens to discover the stale replica first.
  await acceptRemote(who, original, staleLocation, guard);
  await acceptRemote(who, newer, newerLocation, guard);
  let record = await getRecord(who, original.id);
  assert.equal(record.document.revision, newer.revision);
  assert.equal(record.primary, locationKey(newerLocation));
  assert.equal(record.conflicts.length, 0);
  assert.equal(passages(record.document.content)[0].text, 'after');

  // The reverse order must converge to the same logical state.
  const secondOwner = owner();
  await acceptRemote(secondOwner, newer, newerLocation, guard);
  await acceptRemote(secondOwner, original, staleLocation, guard);
  record = await getRecord(secondOwner, original.id);
  assert.equal(record.document.revision, newer.revision);
  assert.equal(record.primary, locationKey(newerLocation));
  assert.equal(record.conflicts.length, 0);
});

test('causal descendant preserves portable trash state instead of resurrecting stale copy', async () => {
  const who = owner(),
    original = document('trash me'),
    trashed = editSnippet(original, original.content, '');
  trashed.trashedAt = Date.now();
  const staleLocation = {
      source: source('old-copy'),
      parent: '',
      name: 'old.manabi-snippet.json',
      fileId: 'old',
      token: '1'
    },
    trashedLocation = {
      source: source('new-copy'),
      parent: '',
      name: 'new.manabi-snippet.json',
      fileId: 'new',
      token: '2'
    };
  await acceptRemote(who, original, staleLocation, guard);
  await acceptRemote(who, parseSnippet(encodeSnippet(trashed)), trashedLocation, guard);
  const record = await getRecord(who, original.id);
  assert.equal(record.document.trashedAt, trashed.trashedAt);
  assert.equal(record.primary, locationKey(trashedLocation));
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
test('new edit arriving while upload is in flight remains dirty without invalidating its base', async () => {
  const s = scope(),
    doc = document(),
    dest = { source: source(), parent: '' };
  let later;
  await saveDocument(s.owner, doc, null, dest, s.guard);
  memory.beforeWrite = async () => {
    memory.beforeWrite = null;
    later = editSnippet(doc, plainContent('later'), '');
    await saveDocument(s.owner, later, doc.revision, dest, s.guard);
  };
  await flushRecord(doc.id, s);
  let record = await getRecord(s.owner, doc.id);
  assert(record.dirty);
  assert.equal(passages(record.document.content)[0].text, 'later');
  assert.equal(record.document.revision, later.revision);
  const followup = editSnippet(later, plainContent('still editing'), '');
  await saveDocument(s.owner, followup, later.revision, dest, s.guard);
  record = await getRecord(s.owner, doc.id);
  assert.equal(record.document.revision, followup.revision);
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
test('bounded indexing gives each connected source a fair first-pass turn', async () => {
  const s = scope(),
    first = source(),
    second = source(),
    secondDoc = document('二つ目の保存先');
  memory.sources = [first, second];
  for (let i = 0; i < 125; i++) {
    const doc = document('大きい保存先 ' + i);
    memory.files.set(doc.id, {
      document: doc,
      location: {
        source: first,
        fileId: doc.id,
        name: doc.id + '.manabi-snippet.json',
        parent: '',
        token: '1'
      }
    });
  }
  memory.files.set(secondDoc.id, {
    document: secondDoc,
    location: {
      source: second,
      fileId: secondDoc.id,
      name: secondDoc.id + '.manabi-snippet.json',
      parent: '',
      token: '1'
    }
  });
  const before = memory.readCount;
  await refreshSnippets(s, true);
  assert((await summaries(s.owner)).some((item) => item.id === secondDoc.id));
  assert(memory.readCount - before <= 100);
  memory.sources = [];
});

test('byte budget also preserves a first-pass turn for later sources', async () => {
  const s = scope(),
    first = source(),
    second = source(),
    secondDoc = document('小さい二つ目の保存先'),
    largeText = 'x'.repeat(1_800_000);
  memory.sources = [first, second];
  for (let i = 0; i < 10; i++) {
    const doc = document(largeText + i);
    memory.files.set(doc.id, {
      document: doc,
      location: {
        source: first,
        fileId: doc.id,
        name: doc.id + '.manabi-snippet.json',
        parent: '',
        token: '1'
      }
    });
  }
  memory.files.set(secondDoc.id, {
    document: secondDoc,
    location: {
      source: second,
      fileId: secondDoc.id,
      name: secondDoc.id + '.manabi-snippet.json',
      parent: '',
      token: '1'
    }
  });
  await refreshSnippets(s, true);
  assert((await summaries(s.owner)).some((item) => item.id === secondDoc.id));
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

test('route recovery replaces its URL without starting another load', () => {
  const routes = createRouteLoads();
  const first = routes.begin('local:draft:old');
  assert(first.current());
  assert.equal(routes.begin('local:draft:old'), undefined);
  first.replace('local:draft:recovered');
  assert.equal(routes.begin('local:draft:recovered'), undefined);
  assert.doesNotThrow(first.guard);
});
test('leaving a pending draft prevents its late editor or URL publication', async () => {
  const routes = createRouteLoads();
  const first = routes.begin('local:draft:old');
  let finish;
  const waiting = new Promise((resolve) => (finish = resolve));
  let published = false;
  const load = (async () => {
    await waiting;
    first.guard();
    first.replace('local:draft:recovered');
    published = true;
  })();
  const rejected = assert.rejects(load, { name: 'AbortError' });
  const second = routes.begin('local:snippet:next');
  finish();
  await rejected;
  assert.equal(published, false);
  assert(second.current());
  assert.equal(routes.begin('local:snippet:next'), undefined);
});
test('same-route ABA never revives an earlier asynchronous load', () => {
  const routes = createRouteLoads();
  const first = routes.begin('local:draft:first');
  routes.begin('local:library');
  const returned = routes.begin('local:draft:first');
  assert.equal(first.current(), false);
  assert.throws(() => first.replace('local:draft:stale'), { name: 'AbortError' });
  assert(returned.current());
  assert.equal(routes.begin('local:draft:first'), undefined);
});
test('teardown and account resets revoke all previous route ownership', () => {
  const routes = createRouteLoads();
  const first = routes.begin('account:alice:draft:one');
  routes.reset();
  assert.throws(first.guard, { name: 'AbortError' });
  const second = routes.begin('account:alice:draft:one');
  assert(second.current());
  const third = routes.begin('account:bob:library');
  assert.throws(second.guard, { name: 'AbortError' });
  assert(third.current());
});
test('an obsolete recovery cannot change the replacement load signature', () => {
  const routes = createRouteLoads();
  const first = routes.begin('draft:one');
  const second = routes.begin('draft:two');
  assert.throws(() => first.replace('draft:late'), { name: 'AbortError' });
  second.replace('draft:restored-two');
  assert.equal(routes.begin('draft:restored-two'), undefined);
});
test('clearing a remembered destination durably restores choice across multiple sources', async () => {
  const selected = scope();
  const previousSources = memory.sources;
  const sources = [source(), source()];
  memory.sources = sources;
  try {
    const destination = { source: sources[0], parent: 'Study' };
    await rememberDestination(destination, selected);
    assert.deepEqual(await suggestedDestination(selected), destination);
    await rememberDestination(undefined, selected);
    assert.equal(await suggestedDestination(selected), undefined);
  } finally {
    memory.sources = previousSources;
  }
});

test('destination edits during reading-state transfer block original cleanup', async () => {
  const { selected, doc } = await stored();
  const from = (await getRecord(selected.owner, doc.id)).locations[0];
  const destination = { source: source(), parent: '' };
  const block = passages(doc.content)[0];
  await saveProgress(
    doc.id,
    {
      blockId: block.blockId,
      quote: block.text,
      before: '',
      offset: 0,
      revision: doc.revision
    },
    selected
  );
  memory.beforeStateWrite = async (src) => {
    if (src.id !== destination.source.id) return;
    memory.beforeStateWrite = null;
    const entry = [...memory.files.values()].find(
      (value) => value.document.id === doc.id && value.location.source.id === src.id
    );
    entry.document = editSnippet(entry.document, plainContent('External destination edit'), '');
    entry.location.token = crypto.randomUUID();
  };
  try {
    await assert.rejects(
      () => moveSnippet(doc.id, destination, doc.revision, selected),
      /destination.*changed|destination.*edited/i
    );
    assert(memory.files.has(from.fileId), 'The original must survive an edit during state I/O');
    const transfer = await currentTransfer(doc.id, selected);
    assert.equal(transfer.phase, 'copied');
    assert.equal(
      passages(memory.files.get(transfer.copied.fileId).document.content)[0].text,
      'External destination edit'
    );
    await assert.rejects(
      () => resumeTransfer(doc.id, selected),
      /destination.*changed|destination.*edited/i
    );
    assert(memory.files.has(from.fileId));
    await keepBoth(doc.id, selected);
    assert.equal((await getRecord(selected.owner, doc.id)).conflicts.length, 1);
  } finally {
    memory.beforeStateWrite = null;
  }
});

test('automatic discovery belongs to library routes, not connections or an open book', () => {
  for (const base of ['', '/reader-web']) {
    for (const suffix of ['/', '/manage', '/manage/', '/snippets', '/snippets/'])
      assert(isSnippetLibraryPath(base + suffix, base));
    for (const suffix of ['/connections', '/b', '/b/42', '/settings', '/snippets-old'])
      assert(!isSnippetLibraryPath(base + suffix, base));
  }
  assert(!isSnippetLibraryPath('/reader-web-other/snippets', '/reader-web'));
});

test('source resolution rejects changed roots, identities and owners before any I/O', async () => {
  const descriptor = { ...source(), provider: 'webdav', root: 'https://dav.invalid/Books/' };
  let reads = 0;
  const adapter = {
    ...descriptor,
    state: async () => {
      reads++;
    }
  };
  assert.equal(boundLibrarySource(descriptor, adapter), adapter);
  for (const changed of [
    { root: 'https://dav.invalid/Other/' },
    { id: 'replacement' },
    { owner: 'another-account' }
  ]) {
    await assert.rejects(
      async () => boundLibrarySource(descriptor, { ...adapter, ...changed }).state(),
      /source changed/
    );
  }
  assert.equal(reads, 0);
});

test('discovery reuses a recent finished checkpoint but explicit Refresh still scans', async () => {
  const s = { owner: owner(), guard },
    previous = memory.sources;
  memory.sources = [source()];
  try {
    const before = memory.scanCount;
    await refreshSnippets(s);
    await refreshSnippets(s, true, 60000);
    assert.equal(memory.scanCount, before + 1);
    await refreshSnippets(s, true);
    assert.equal(memory.scanCount, before + 2);
  } finally {
    memory.sources = previous;
  }
});

test('canceled discovery cannot publish a partial checkpoint or hydrate documents', async () => {
  const s = { owner: owner(), guard },
    previous = memory.sources,
    src = source(),
    controller = new AbortController();
  memory.sources = [src];
  let release, began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  memory.beforeScan = () => {
    began();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  try {
    const before = memory.readCount;
    const work = refreshSnippets(s, true, 0, controller.signal);
    await started;
    const rejection = assert.rejects(work, { name: 'AbortError' });
    controller.abort();
    release();
    await rejection;
    assert.equal(memory.readCount, before);
    const values = await (await integrationDB()).getAll('metadata');
    assert(!values.some((v) => v?.catalog?.source?.id === src.id));
  } finally {
    memory.beforeScan = null;
    memory.sources = previous;
  }
});

test('canceling a metadata write after enqueue aborts its whole IndexedDB transaction', async () => {
  const key = 'snippet-cancel-test:' + owner(),
    controller = new AbortController();
  const original = globalThis.IDBObjectStore.prototype.put;
  globalThis.IDBObjectStore.prototype.put = function (value, selectedKey) {
    const request = original.call(this, value, selectedKey);
    if (this.name === 'metadata' && selectedKey === key) controller.abort();
    return request;
  };
  try {
    await assert.rejects(setMetadata(key, { incomplete: true }, controller.signal), {
      name: 'AbortError'
    });
    assert.equal(await (await integrationDB()).get('metadata', key), undefined);
  } finally {
    globalThis.IDBObjectStore.prototype.put = original;
  }
});

test('account switch queues a successor save while an older account flush is in flight', async () => {
  const previousWindow = globalThis.window,
    navigation = writable(false);
  globalThis.window = new EventTarget();
  changeUser('alice');
  let stop = () => {},
    release;
  const blocked = new Promise((resolve) => (release = resolve));
  let started;
  const admitted = new Promise((resolve) => (started = resolve));
  memory.beforeWrite = async () => {
    memory.beforeWrite = null;
    started();
    await blocked;
  };
  const waitFor = async (condition, timeout = 3500) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) {
      if (Date.now() > deadline) assert.fail('The queued save did not settle.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    stop = startSnippets(navigation);
    const alice = scope(),
      aliceDoc = document('Alice pending'),
      aliceDest = { source: source(), parent: '' };
    await saveDocument(alice.owner, aliceDoc, null, aliceDest, alice.guard);
    await admitted;
    changeUser('bob');
    const bob = scope(),
      bobDoc = document('Bob pending'),
      bobDest = { source: source(), parent: '' };
    await saveDocument(bob.owner, bobDoc, null, bobDest, bob.guard);
    release();
    await waitFor(async () => !(await getRecord(bob.owner, bobDoc.id))?.dirty);
    assert.equal((await getRecord(bob.owner, bobDoc.id)).dirty, false);
  } finally {
    release?.();
    stop();
    memory.beforeWrite = null;
    changeUser(null);
    globalThis.window = previousWindow;
  }
});

test('runtime discovers on library entry, not on settings focus or after leaving', async () => {
  const previousWindow = globalThis.window,
    previousSources = memory.sources;
  const navigation = writable(false),
    src = source();
  globalThis.window = new EventTarget();
  memory.sources = [src];
  let stop = () => {};
  const waitFor = async (condition) => {
    const deadline = Date.now() + 1500;
    while (!condition()) {
      if (Date.now() > deadline) assert.fail('The runtime did not settle.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    const before = memory.scanCount;
    stop = startSnippets(navigation);
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(memory.scanCount, before);
    navigation.set(true);
    await waitFor(() => memory.scanCount === before + 1 && !get(snippetStatus).busy);
    navigation.set(false);
    memory.sources = [source()];
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(memory.scanCount, before + 1);
    navigation.set(true);
    await waitFor(() => memory.scanCount === before + 2 && !get(snippetStatus).busy);
  } finally {
    stop();
    memory.sources = previousSources;
    globalThis.window = previousWindow;
  }
});

test('trash after sixteen offline edits retains the last acknowledged server ancestor', async () => {
  const { selected, doc } = await stored();
  let current = await getRecord(selected.owner, doc.id);
  for (let n = 0; n < 16; n++) {
    const next = editSnippet(current.document, plainContent(`未同期の本文 ${n}`), '手動の題名');
    await saveDocument(
      selected.owner,
      next,
      current.document.revision,
      current.destination,
      selected.guard
    );
    current = await getRecord(selected.owner, doc.id);
  }
  await trashSnippet(doc.id, false, selected);
  current = await getRecord(selected.owner, doc.id);
  assert(current.document.parents.includes(doc.revision));
  assert.equal(current.document.parents.length, 16);
  await flushRecord(doc.id, selected);
  current = await getRecord(selected.owner, doc.id);
  assert.equal(current.dirty, false);
  assert.equal(current.conflicts.length, 0);
  assert.equal(passages(current.document.content)[0].text, '未同期の本文 15');
  assert.equal(current.document.title.text, '手動の題名');
});

test('repeated offline trash and restore do not create a false server conflict', async () => {
  const { selected, doc } = await stored();
  for (let n = 0; n < 22; n++) await trashSnippet(doc.id, n % 2 === 1, selected);
  await flushRecord(doc.id, selected);
  const current = await getRecord(selected.owner, doc.id);
  assert.equal(current.document.trashedAt, undefined);
  assert.equal(current.dirty, false);
  assert.equal(current.remoteRevision, current.document.revision);
});

test('many offline appends and trash share the bounded acknowledged ancestry contract', async () => {
  const { selected, doc } = await stored('原本');
  for (let n = 0; n < 20; n++)
    await appendToSnippet(doc.id, plainContent(`追記 ${n}`), crypto.randomUUID(), selected);
  await trashSnippet(doc.id, false, selected);
  await trashSnippet(doc.id, true, selected);
  await flushRecord(doc.id, selected);
  const current = await getRecord(selected.owner, doc.id);
  assert.equal(current.dirty, false);
  assert.equal(current.conflicts.length, 0);
  assert.equal(current.document.captures.length, 20);
  assert.equal(passages(current.document.content).at(-1).text, '追記 19');
  assert(current.document.parents.includes(doc.revision));
});

test('lost create reply followed by repeated trash and restore still drains one file', async () => {
  const selected = { owner: owner(), guard },
    src = source(),
    doc = document('保持する本文');
  await saveDocument(selected.owner, doc, null, { source: src, parent: '' }, guard);
  memory.dropReply = true;
  await assert.rejects(flushRecord(doc.id, selected));
  for (let n = 0; n < 20; n++) await trashSnippet(doc.id, n % 2 === 1, selected);
  const pending = await getRecord(selected.owner, doc.id);
  assert.equal(pending.upload.document.revision, doc.revision);
  await flushSnippets(selected);
  const current = await getRecord(selected.owner, doc.id);
  assert.equal(current.dirty, false);
  assert.equal(current.upload, undefined);
  assert.equal(current.conflicts.length, 0);
  assert.equal(current.document.trashedAt, undefined);
  assert.equal([...memory.files.values()].filter((x) => x.document.id === doc.id).length, 1);
});

test('restoring the same durable locator does not manufacture a newer position upload', async () => {
  const { selected, doc } = await stored('位置を保持する文章');
  const block = passages(doc.content)[0];
  const locator = {
    blockId: block.blockId,
    quote: block.text.slice(0, 80),
    before: '',
    offset: 0,
    revision: doc.revision
  };
  await saveProgress(doc.id, locator, selected);
  await syncReading(doc.id, selected);
  const before = await getRecord(selected.owner, doc.id);
  assert.equal(before.progressDirty, false);
  const changedAt = before.progressAt;
  await saveProgress(doc.id, structuredClone(locator), selected);
  const after = await getRecord(selected.owner, doc.id);
  assert.equal(after.progressAt, changedAt);
  assert.equal(after.progressDirty, false);
  assert.deepEqual(after.progress, locator);
});

test('a stale listing snapshot cannot mark a location created during that scan as missing', async () => {
  const selected = { owner: owner(), guard },
    src = source(),
    doc = document('走査中に保存される文章'),
    previousSources = memory.sources;
  memory.sources = [src];
  try {
    await saveDocument(selected.owner, doc, null, { source: src, parent: '' }, guard);
    assert.equal((await getRecord(selected.owner, doc.id)).locations.length, 0);
    memory.beforeScan = async () => {
      memory.beforeScan = null;
      await flushRecord(doc.id, selected);
      const saved = await getRecord(selected.owner, doc.id);
      assert.equal(saved.locations.length, 1);
      assert.equal(saved.locations[0].missing, false);
    };
    await refreshSnippets(selected, true);
    const after = await getRecord(selected.owner, doc.id);
    assert.equal(after.locations.length, 1);
    assert.equal(after.locations[0].missing, false);
    assert.equal(after.primary, locationKey(after.locations[0]));
  } finally {
    memory.beforeScan = null;
    memory.sources = previousSources;
  }
});
