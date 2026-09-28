/** Native IndexedDB fixture. Used unchanged by fake-indexeddb and browser qualification. */
import { createBooksDb } from '../../apps/web/src/lib/data/database/books-db/factory.ts';

// Independent contract, deliberately not imported from the production installer.
const legacy = {
  data: ['id', true, { title: 'title' }],
  bookmark: ['dataId'],
  lastItem: [null],
  storageSource: ['name'],
  statistic: [['title', 'dateKey'], false, { dateKey: 'dateKey', completedBook: ['completedBook', 'title'] }],
  readingGoal: ['goalStartDate', false, { goalEndDate: 'goalEndDate' }],
  lastModified: [['title', 'dataType']],
  audioBook: ['title'],
  subtitle: ['title'],
  handle: [['title', 'dataType']]
};
const annotations = {
  readerLocalIdentity: ['bookId'],
  publication: ['bookId'],
  readerAnnotation: ['id', false, { bookKey: 'bookKey', kind: 'kind' }],
  readerAnnotationOutbox: ['id', false, { accountId: 'accountId', bookKey: 'bookKey' }],
  readerSyncState: ['accountId'],
  readerConflict: ['id', false, { bookKey: 'bookKey' }]
};
const personal = {
  readerBookScope: ['bookId'],
  readerAnnotationScope: ['annotationId'],
  readerPersonalRecord: ['id', false, { accountId: 'accountId', bookKey: 'bookKey' }],
  readerPersonalOutbox: ['id', false, { accountId: 'accountId', bookKey: 'bookKey' }],
  readerPersonalConflict: ['id', false, { accountId: 'accountId', bookKey: 'bookKey' }]
};
const statistics = {
  readerStatistic: [['bookKey', 'dateKey'], false, { dateKey: 'dateKey' }],
  readerStatisticMigration: ['title']
};
const localFeatures = {
  readerSearchProjection: ['bookId'],
  readerExternalSync: ['id'],
  readerImportRecord: ['id', false, { bookKey: 'bookKey' }]
};
const expected = { ...legacy, ...annotations, ...personal, ...statistics, ...localFeatures };
const prefix = (count) => Object.fromEntries(Object.entries(legacy).slice(0, count));
const histories = {
  'fresh': [0, {}],
  'v3-skips-releases': [3, prefix(3)],
  'v4-skips-releases': [4, prefix(4)],
  'v5-skips-releases': [5, prefix(7)],
  'v6-legacy-blobs': [6, legacy],
  // PR #48 / 248f1fc3: local version 7 introduced bytes, but no reader stores.
  'v7-byte-only': [7, legacy],
  'v7-annotations': [7, { ...legacy, ...annotations }],
  'v8-personal-records': [8, { ...legacy, ...annotations, ...personal }],
  'v9-content-statistics': [9, { ...legacy, ...annotations, ...personal, ...statistics }],
  'v10-local-features': [10, expected],
  'v11-complete': [11, expected],
  // Shape produced by the old <7 guard after upgrading byte-only version 7.
  'v11-already-missing-reader-stores': [11, { ...legacy, ...personal, ...statistics, ...localFeatures }],
  // Shape produced by the old version-3 switch arm, which skipped v5/v6 stores.
  'v11-already-missing-legacy-stores': [11, { ...prefix(4), ...annotations, ...personal, ...statistics, ...localFeatures }],
  'v11-missing-indexes': [11, expected]
};

function assert(value, message) {
  if (!value) throw new Error(message);
}
function same(actual, wanted, message) {
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${message}: ${JSON.stringify(actual)}`);
}
function request(operation) {
  if (typeof operation?.then === 'function') return operation;
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}
function completion(transaction) {
  if (transaction.done) return transaction.done;
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Aborted transaction'));
  });
}
function open(name, version, upgrade) {
  const operation = globalThis.indexedDB.open(name, version);
  operation.onupgradeneeded = () => upgrade?.(operation.result, operation.transaction);
  return request(operation);
}
function remove(name) {
  return request(globalThis.indexedDB.deleteDatabase(name));
}
function installFixture(db, definitions, omitIndexes = false) {
  for (const [name, [keyPath, autoIncrement = false, indexes = {}]] of Object.entries(definitions)) {
    const store = db.createObjectStore(name, { keyPath, autoIncrement });
    if (!omitIndexes) {
      for (const [index, path] of Object.entries(indexes)) store.createIndex(index, path);
    }
  }
  const extension = db.createObjectStore('extension-data', { keyPath: 'id' });
  extension.createIndex('custom-marker', 'marker');
}
async function seedRows(db, version) {
  const names = Array.from(db.objectStoreNames);
  const transaction = db.transaction(names, 'readwrite');
  const done = completion(transaction);
  for (const name of names) {
    const store = transaction.objectStore(name);
    const value = {
      id: name === 'data' ? 42 : `sentinel:${name}`,
      bookId: 42, dataId: 42, annotationId: 'note:1', bookKey: 'content:retained',
      accountId: 'account:retained', name: 'retained-source', title: 'Retained book',
      dateKey: '2026-09-20', dataType: 'book', goalStartDate: '2026-09-20',
      goalEndDate: '2026-09-27', kind: 'note', marker: name,
      revision: 7, unknownExtension: { retained: true }
    };
    if (name === 'data') {
      const bytes = new Uint8Array([0, 7, 48, 128, 255]).buffer;
      const binary = version < 7 ? new globalThis.Blob([bytes], { type: 'image/png' })
        : { format: 'reader-bytes-v1', type: 'image/png', bytes };
      Object.assign(value, { elementHtml: '<p>本</p>', blobs: { 'image.png': binary }, coverImage: binary });
    }
    store.put(value, store.keyPath === null ? 0 : undefined);
  }
  await done;
}
async function serializable(value) {
  if (value instanceof globalThis.Blob) return { blob: Array.from(new Uint8Array(await value.arrayBuffer())), type: value.type };
  if (value instanceof ArrayBuffer) return { bytes: Array.from(new Uint8Array(value)) };
  if (Array.isArray(value)) return Promise.all(value.map(serializable));
  if (value && typeof value === 'object') {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await serializable(entry)])));
  }
  return value;
}
async function snapshot(db, names = Array.from(db.objectStoreNames)) {
  const tx = db.transaction(names);
  const done = completion(tx);
  // Queue requests synchronously. Serializing legacy Blob bodies happens only
  // after commit, not inside the transaction under test.
  const rows = await Promise.all(names.map(async name => [name, await request(tx.objectStore(name).getAll())]));
  await done;
  return serializable(Object.fromEntries(rows));
}
function verifySchema(db) {
  assert(db.version === 12, `Expected repairing version 12, got ${db.version}`);
  const tx = db.transaction(Array.from(db.objectStoreNames));
  for (const [name, [path, increment = false, indexes = {}]] of Object.entries(expected)) {
    assert(db.objectStoreNames.contains(name), `Missing required store ${name}`);
    const store = tx.objectStore(name);
    same(store.keyPath, path, `${name} key path changed`);
    assert(store.autoIncrement === increment, `${name} key generator changed`);
    for (const [indexName, keyPath] of Object.entries(indexes)) {
      assert(store.indexNames.contains(indexName), `Missing required index ${name}/${indexName}`);
      const index = store.index(indexName);
      same(index.keyPath, keyPath, `${name}/${indexName} key path changed`);
      assert(!index.unique && !index.multiEntry, `${name}/${indexName} options changed`);
    }
  }
}
async function upgradeHistory(name, [version, definitions], omitIndexes = false) {
  let before, names;
  if (version) {
    const old = await open(name, version, db => installFixture(db, definitions, omitIndexes));
    try {
      await seedRows(old, version);
      names = Array.from(old.objectStoreNames);
      before = await snapshot(old, names);
    } finally { old.close(); }
  }
  const db = await createBooksDb(name);
  try {
    verifySchema(db);
    if (version) {
      same(await snapshot(db, names), before, 'Upgrade changed existing records');
      assert(db.transaction('extension-data').objectStore('extension-data').indexNames.contains('custom-marker'), 'Extension index was removed');
    }
    const tx = db.transaction('data', 'readwrite');
    const done = tx.done;
    const id = await tx.store.add({ title: 'After upgrade', elementHtml: '<p>次</p>', blobs: {} });
    await done;
    assert(id > (version ? 42 : 0), 'Existing data key generator was reset');
  } finally { db.close(); }
  const reopened = await createBooksDb(name);
  try { verifySchema(reopened); } finally { reopened.close(); }
}
async function legacyV2(name, invalid) {
  const valid = JSON.stringify({ title: 'Legacy book', elementHtml: '<p>本</p>', styleSheet: '' });
  let old = await open(name, 2, db => db.createObjectStore('keyvaluepairs'));
  const tx = old.transaction('keyvaluepairs', 'readwrite');
  const done = completion(tx);
  // '__proto__' was silently lost by the old {} migration accumulator.
  tx.objectStore('keyvaluepairs').put(valid, 'data-__proto__');
  tx.objectStore('keyvaluepairs').put('23', 'scrollX-__proto__');
  tx.objectStore('keyvaluepairs').put('__proto__', 'lastItem');
  if (invalid) tx.objectStore('keyvaluepairs').put(invalid === 'json' ? '{broken' : '{"title":7}', 'data-broken');
  await done;
  const before = await snapshot(old);
  old.close();
  if (invalid) {
    let failure;
    try {
      const unexpected = await createBooksDb(name);
      unexpected.close();
    } catch (error) { failure = error; }
    assert(failure, 'Invalid v2 conversion must reject opening');
    assert(invalid === 'json' ? failure.name === 'SyntaxError' : /legacy book record/.test(failure.message), 'Migration must retain its parsing/validation error');
    old = await open(name);
    try {
      assert(old.version === 2, 'Failed conversion committed a newer version');
      same(Array.from(old.objectStoreNames), ['keyvaluepairs'], 'Failed conversion left partial stores');
      same(await snapshot(old), before, 'Failed conversion changed original data');
      const repair = old.transaction('keyvaluepairs', 'readwrite');
      const committed = completion(repair);
      repair.objectStore('keyvaluepairs').delete('data-broken');
      await committed;
    } finally { old.close(); }
  }
  const db = await createBooksDb(name);
  try {
    verifySchema(db);
    assert(!db.objectStoreNames.contains('keyvaluepairs'), 'Successful v2 conversion did not finish');
    const books = await db.getAll('data');
    assert(books.length === 1 && books[0].title === 'Legacy book', 'Legacy book was lost');
    const bookmark = await db.get('bookmark', books[0].id);
    assert(bookmark.scrollX === 23, 'Legacy reading position was lost');
    same(await db.get('lastItem', 0), { dataId: books[0].id }, 'Legacy recent-book key was lost');
  } finally { db.close(); }
}
async function incompatible(name, kind) {
  const old = await open(name, 11, db => {
    if (kind === 'store') db.createObjectStore('data', { keyPath: 'wrong' });
    else {
      const store = db.createObjectStore('data', { keyPath: 'id', autoIncrement: true });
      store.createIndex('title', 'title', { unique: true });
    }
  });
  const tx = old.transaction('data', 'readwrite');
  const done = completion(tx);
  tx.objectStore('data').put({ id: 42, wrong: 42, title: 'Do not delete' });
  await done;
  const before = await snapshot(old);
  old.close();
  let failure;
  try {
    const unexpected = await createBooksDb(name);
    unexpected.close();
  } catch (error) { failure = error; }
  assert(/incompatible schema/.test(failure?.message ?? ''), 'Incompatible schema must fail closed');
  const restored = await open(name);
  try {
    assert(restored.version === 11, 'Schema rejection advanced the version');
    same(Array.from(restored.objectStoreNames), ['data'], 'Schema rejection committed new stores');
    same(await snapshot(restored), before, 'Schema rejection changed existing records');
  } finally { restored.close(); }
}

export const caseNames = [...Object.keys(histories), 'v2-without-blob-detection-store', 'v2-malformed-json-rollback-retry', 'v2-invalid-record-rollback-retry', 'incompatible-store-rollback', 'incompatible-index-rollback'];
export async function runCase(caseName) {
  assert(caseNames.includes(caseName), 'Unknown schema test');
  const name = `reader-schema-${caseName}`;
  await remove(name);
  try {
    if (histories[caseName]) await upgradeHistory(name, histories[caseName], caseName === 'v11-missing-indexes');
    else if (caseName.startsWith('v2')) await legacyV2(name, caseName.includes('malformed') ? 'json' : caseName.includes('invalid') ? 'record' : undefined);
    else await incompatible(name, caseName.includes('-store-') ? 'store' : 'index');
    return { name: caseName, version: 12, state: 'passed', stores: Object.keys(expected).length };
  } finally { await remove(name); }
}
