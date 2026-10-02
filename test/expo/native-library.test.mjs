/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
const output = mkdtempSync(join(tmpdir(), 'native-library-'));
const require = createRequire(import.meta.url);
function bundle(name) { const outfile = join(output, `${name}.cjs`); buildSync({ entryPoints: [resolve(`apps/web/src/native-library/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile, tsconfig: 'apps/web/tsconfig.json', logLevel: 'silent' }); return require(outfile); }
const { NativeLibraryService } = bundle('service');
const { parseLibraryQuery, libraryNodes, reconcileNativeSelection, nativeOwnedCards } = bundle('view-model');
const { commitNativeCompletion } = bundle('completion');
const org = () => ({ version: 1, collections: [], books: {} });
function book(id = 1, extra = {}) { return { key: `book:${id}`, bookId: id, organizationKey: `content:${String(id).repeat(64).slice(0,64)}`, organizationAliases: [`book:${id}`, `content:${String(id).repeat(64).slice(0,64)}`], title: `Book ${id}`, canonicalTitle: `Book ${id}`, imagePath: '', characters: 1000, lastBookModified: 10, lastBookOpen: id, progress: .3, lastBookmarkModified: 1, isPlaceholder: false, direction: 'unknown', contentHash: String(id).repeat(64).slice(0,64), ...extra }; }
const tree = books => books.map(book => ({ kind: 'book', id: book.key, book }));
function setup(books = [book()]) {
  let data = { tree: tree(books), organization: org(), sources: [] }; let scope = 'session:0'; const abort = new AbortController(); let serial = 0; let now = 100; const writes = []; let loadHook;
  const authority = { key: scope, signal: abort.signal, assertCurrent() { if (authority.key !== scope) throw new Error('account changed'); } };
  const service = new NativeLibraryService({ async load() { await loadHook?.(); return structuredClone(data); }, async write(...args) { args[3].assertCurrent(); args[3].signal.throwIfAborted(); writes.push(args); } }, () => `opaque_${++serial}`, () => now);
  return { service, authority, writes, get data() { return data; }, set data(value) { data = value; }, changeScope(value) { scope = value; }, tick(value) { now += value; }, cancel() { abort.abort(); }, hook(fn) { loadHook = fn; } };
}
test('queries and actions are bounded and reject arbitrary network/file capabilities', async () => {
  for (const query of [{ limit: 61 }, { offset: -1 }, { query: 'x'.repeat(501) }, { detail: 'x'.repeat(129) }, { url: 'https://example.org' }, { sort: 'contentHash' }, { unfinished: 'yes' }]) assert.throws(() => parseLibraryQuery(query));
  const f = setup(); const state = await f.service.state({}, f.authority);
  await assert.rejects(f.service.action({ token: state.token, type: 'fetch', url: 'https://example.org' }, f.authority), /Unsupported/);
  await assert.rejects(f.service.action({ token: state.token, type: 'presentation', keys: [state.items[0].key], change: { cover: 'file:///secret' } }, f.authority), /Invalid metadata/);
  assert.equal(f.writes.length, 0);
});
test('state pages, opaque source handles, series navigation and detail are portable', async () => {
  const f = setup(Array.from({ length: 63 }, (_, i) => book(i + 1))); const source = { id: 'source', root: 'https://user:secret@private/path', owner: null, provider: 'webdav', name: 'My shelf' };
  f.data.sources = [source]; f.data.tree[0].book.source = source;
  const page = await f.service.state({ sort: 'id', direction: 'asc' }, f.authority); assert.equal(page.items.length, 60); assert.equal(page.total, 63); assert.equal(page.items[0].progress, .3); assert.ok(!JSON.stringify(page).includes('secret')); assert.ok(!JSON.stringify(page).includes('private/path'));
  const detail = await f.service.state({ detail: page.items[0].key }, f.authority); assert.equal(detail.detail.title, 'Book 1');
  const next = await f.service.state({ offset: 60, sort: 'id', direction: 'asc' }, f.authority); assert.equal(next.items.length, 3);
  const nested = book(5, { series: { name: 'Set', index: 1 } }); f.data.tree = [{ kind: 'series', id: 'physical:private/path', directoryId: 'private/path', name: 'Set', books: [nested], children: tree([nested]) }];
  const folders = await f.service.state({}, f.authority); assert.ok(!JSON.stringify(folders).includes('private/path'));
  const inside = await f.service.state({ series: folders.items[0].key }, f.authority); assert.equal(inside.items[0].title, 'Book 5'); assert.equal(inside.trail[0].name, 'Set');
});
test('filters preserve aliases, Unicode search, finished semantics and volume order', () => {
  const one = book(1, { title: 'Ｃａｆé', creators: [{ name: 'Alice' }], series: { name: 'Set', index: 3 } }); const two = book(2, { series: { name: 'Set', index: 1 }, progress: 1 }); const organization = org(); organization.collections.push({ id: 'want-to-read', name: 'Want to Read', members: ['book:1'] });
  assert.equal(libraryNodes(tree([one, two]), organization, parseLibraryQuery({ query: 'café' })).nodes.length, 1);
  assert.equal(libraryNodes(tree([one, two]), organization, parseLibraryQuery({ query: 'alice' })).nodes.length, 1);
  assert.equal(libraryNodes(tree([one, two]), organization, parseLibraryQuery({ collection: 'want-to-read' })).nodes[0].book.bookId, 1);
  assert.equal(libraryNodes(tree([one, two]), organization, parseLibraryQuery({ collection: 'finished' })).nodes[0].book.bookId, 2);
  const grouped = [{ kind: 'series', id: 'series', directoryId: '', name: 'Set', personal: true, books: [one, two], children: tree([one, two]) }];
  assert.equal(libraryNodes(grouped, organization, parseLibraryQuery({ sort: 'title' }), 'series').nodes[0].book.bookId, 2);
  assert.deepEqual(reconcileNativeSelection(['a', 'b', 'a'], [{ kind: 'book', key: 'a' }, { kind: 'series', key: 'b' }]), ['a']);
});
test('forged selection, expired admission and built-in collection mutations fail closed', async () => {
  const f = setup(); let state = await f.service.state({}, f.authority);
  await assert.rejects(f.service.action({ token: state.token, type: 'membership', keys: ['forged'], collection: 'want-to-read', included: true }, f.authority), /outside/);
  await assert.rejects(f.service.action({ token: state.token, type: 'collection.remove', collection: 'want-to-read' }, f.authority), /built-in/);
  f.tick(600001); await assert.rejects(f.service.action({ token: state.token, type: 'completion', keys: [state.items[0].key], state: 'finished' }, f.authority), /expired/); assert.equal(f.writes.length, 0);
});
test('profile ABA and cancellation during reads cannot publish state or mutate', async () => {
  const f = setup(); const state = await f.service.state({}, f.authority); f.changeScope('session:2');
  await assert.rejects(f.service.action({ token: state.token, type: 'completion', keys: [state.items[0].key], state: 'reading' }, f.authority), /account changed/);
  const g = setup(); g.hook(() => g.cancel()); await assert.rejects(g.service.state({}, g.authority), /abort/i); assert.equal(g.writes.length, 0);
});
test('a replaced numeric book identity rejects an old selection and consumes admission', async () => {
  const f = setup(); const state = await f.service.state({}, f.authority); f.data.tree[0].book.contentHash = 'f'.repeat(64);
  const payload = { token: state.token, type: 'completion', keys: [state.items[0].key], state: 'reading' };
  await assert.rejects(f.service.action(payload, f.authority), /book changed/); await assert.rejects(f.service.action(payload, f.authority), /expired/); assert.equal(f.writes.length, 0);
});
test('action owns caller payload before suspension and allows only one admitted write', async () => {
  const f = setup(); const state = await f.service.state({}, f.authority); let release; f.hook(() => new Promise(resolve => { release = resolve; }));
  const payload = { token: state.token, type: 'presentation', keys: [state.items[0].key], change: { title: 'New title' } };
  const pending = f.service.action(payload, f.authority); payload.change.title = 'Changed after admission'; release(); await pending;
  assert.equal(f.writes[0][0].change.title, 'New title'); await assert.rejects(f.service.action(payload, f.authority), /expired/);
});
test('unverified source previews cannot write locator-only organization', async () => {
  const f = setup([book(1, { bookId: undefined, organizationKey: 'source:private-path', contentHash: undefined })]); const state = await f.service.state({}, f.authority);
  await assert.rejects(f.service.action({ token: state.token, type: 'membership', keys: [state.items[0].key], collection: 'want-to-read', included: true }, f.authority), /identity is not verified/);
  assert.equal(f.writes.length, 0);
});
async function database() { return openDB(`native-library-${crypto.randomUUID()}`, 1, { upgrade(db) { db.createObjectStore('data', { keyPath: 'id' }); db.createObjectStore('bookmark', { keyPath: 'dataId' }); db.createObjectStore('readerBookScope', { keyPath: 'bookId' }); } }); }
const guard = (signal = new AbortController().signal, assertCurrent = () => {}) => ({ key: 'session:0', signal, assertCurrent });
async function seed(db, target, owner) { await db.put('data', { id: target.bookId, title: target.canonicalTitle, lastBookModified: target.lastBookModified, contentHash: target.contentHash, ...(owner ? { libraryOwner: owner } : {}) }); await db.put('bookmark', { dataId: target.bookId, progress: 'anchor-27', exploredCharCount: 300, lastBookmarkModified: 11 }); }
test('completion transaction preserves position and statistics-independent state', async () => {
  const db = await database(); const target = book(); await seed(db, target);
  await commitNativeCompletion(db, [target], 'finished', '2026-01-02', null, guard());
  const mark = await db.get('bookmark', 1); assert.equal(mark.progress, 'anchor-27'); assert.equal(mark.exploredCharCount, 300); assert.equal(mark.completion.finishedOn, '2026-01-02');
  await commitNativeCompletion(db, [target], 'reading', undefined, null, guard()); assert.equal((await db.get('bookmark', 1)).completion.state, 'reading'); db.close();
});
test('completion ownership and content checks roll back the entire selected batch', async () => {
  const db = await database(); const one = book(1), two = book(2); await seed(db, one); await seed(db, two, 'other-profile');
  await assert.rejects(commitNativeCompletion(db, [one, two], 'finished', '2026-01-02', null, guard()), /another account/);
  assert.equal((await db.get('bookmark', 1)).completion, undefined);
  await assert.rejects(commitNativeCompletion(db, [book(1, { contentHash: 'f'.repeat(64) })], 'reading', undefined, null, guard()), /book changed/); db.close();
});
test('cancellation after first completion put aborts every write', async () => {
  const db = await database(); const one = book(1), two = book(2); await seed(db, one); await seed(db, two); const controller = new AbortController(); let checks = 0;
  await assert.rejects(commitNativeCompletion(db, [one, two], 'finished', '2026-01-02', null, guard(controller.signal, () => { if (++checks === 4) controller.abort(); })), /abort/i);
  assert.equal((await db.get('bookmark', 1)).completion, undefined); assert.equal((await db.get('bookmark', 2)).completion, undefined); db.close();
});

test('DOM projection protects account visibility and foreign personal progress independently', () => {
  const summaries = [book(1), book(2, { libraryOwner: 'other', lastBookOpen: 99 }), book(3, { lastBookOpen: 88 })].map(value => ({ ...value, id: value.bookId }));
  const projected = nativeOwnedCards(summaries, [], [{ dataId: 1, progress: '75%', lastBookmarkModified: 15 }, { dataId: 3, progress: 1, lastBookmarkModified: 100, completion: { state: 'finished', finishedOn: '2026-01-01', modifiedAt: 100 } }], [{ bookId: 3, accountId: 'other' }], null);
  assert.deepEqual(projected.cards.map(card => card.id), [1, 3]); assert.equal(projected.cards[0].progress, .75);
  assert.equal(projected.cards[1].progress, 0); assert.equal(projected.cards[1].lastBookOpen, 0); assert.equal(projected.cards[1].completion, undefined); assert.equal(projected.cards[1].lastBookmarkModified, 0);
});

test('native access admission owns exact identities, rejects replacements and consumes its token', async () => {
  const f = setup(); const state = await f.service.state({}, f.authority);
  const request = { token: state.token, keys: [state.items[0].key], operation: 'open' };
  const identities = await f.service.admitAccess(request, f.authority);
  assert.deepEqual(identities, [{ bookId: 1, contentHash: '1'.repeat(64), title: 'Book 1', lastBookModified: 10 }]);
  await assert.rejects(f.service.admitAccess(request, f.authority), /expired/);
  const second = await f.service.state({}, f.authority); f.data.tree[0].book.contentHash = 'e'.repeat(64);
  await assert.rejects(f.service.admitAccess({ token: second.token, keys: [second.items[0].key], operation: 'delete' }, f.authority), /book changed/);
});
test('native access never opens source-only or placeholder books and cannot target unseen rows', async () => {
  const f = setup([book(1, { isPlaceholder: true })]); const state = await f.service.state({}, f.authority);
  await assert.rejects(f.service.admitAccess({ token: state.token, keys: [state.items[0].key], operation: 'open' }, f.authority), /available imported copy/);
  await assert.rejects(f.service.admitAccess({ token: state.token, keys: ['forged'], operation: 'delete' }, f.authority), /available imported copy/);
});
test('two physical copies of one saved book have distinct opaque row handles', async () => {
  const source = { id: 'source', root: 'private-path', owner: null, provider: 'local', name: 'Folder' };
  const first = book(1, { source, file: { id: 'one', name: 'one.epub', kind: 'file', parent: '' } });
  const second = book(1, { source, file: { id: 'two', name: 'two.epub', kind: 'file', parent: '' } });
  const f = setup([first, second]); const state = await f.service.state({}, f.authority);
  assert.notEqual(state.items[0].key, state.items[1].key);
  const detail = await f.service.state({ detail: state.items[1].key }, f.authority); assert.equal(detail.detail.title, 'Book 1');
  await f.service.action({ token: detail.token, type: 'presentation', keys: [detail.detail.key], change: { coverBlur: true } }, f.authority); assert.equal(f.writes[0][1][0].file.id, 'two');
});
