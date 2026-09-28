import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  matchesDirectImportIdentity,
  normalizedDirectImportHash
} from '../../apps/web/src/lib/data/database/books-db/direct-import-identity.ts';
import { snapshotBookmarkData } from '../../apps/web/src/lib/data/database/books-db/book-records.ts';

const hash = 'a'.repeat(64);
const other = 'b'.repeat(64);

test('exact direct-import bytes match independently of title and hash casing', () => {
  assert.equal(
    matchesDirectImportIdentity(
      { id: 1, title: 'Old filename', contentHash: hash.toUpperCase() },
      { title: 'Renamed copy', contentHash: hash }
    ),
    true
  );
  assert.equal(
    matchesDirectImportIdentity(
      { id: 1, title: 'Same title', contentHash: other },
      { title: 'Same title', contentHash: hash }
    ),
    false
  );
});

test('persistent account scope is part of direct browser identity', () => {
  assert.equal(
    matchesDirectImportIdentity(
      { id: 1, title: 'Book', contentHash: hash, libraryOwner: 'alice' },
      { title: 'Book', contentHash: hash }
    ),
    false
  );
  assert.equal(
    matchesDirectImportIdentity(
      { id: 1, title: 'Book', contentHash: hash, libraryOwner: 'alice' },
      { title: 'Renamed', contentHash: hash, libraryOwner: 'alice' }
    ),
    true
  );
  assert.equal(
    matchesDirectImportIdentity(
      { id: 1, title: 'Book', contentHash: hash, libraryOwner: 'alice' },
      { title: 'Book', contentHash: hash, libraryOwner: 'bob' }
    ),
    false
  );
});

test('personal sync scope prevents another profile from adopting exact bytes', () => {
  const existing = {
    id: 1,
    title: 'Scoped copy',
    contentHash: hash,
    readerOwner: 'alice'
  };
  const incoming = { title: 'Renamed exact copy', contentHash: hash };
  assert.equal(matchesDirectImportIdentity(existing, incoming, 'alice'), true);
  assert.equal(matchesDirectImportIdentity(existing, incoming, 'bob'), false);
  assert.equal(matchesDirectImportIdentity(existing, incoming, null), false);
  assert.equal(
    matchesDirectImportIdentity(
      { id: 2, title: 'Unscoped copy', contentHash: hash },
      incoming,
      'bob'
    ),
    true
  );
});

test('legacy hashless imports retain title matching without accepting malformed hashes', () => {
  assert.equal(
    matchesDirectImportIdentity({ id: 1, title: 'Legacy' }, { title: 'Legacy' }),
    true
  );
  assert.equal(
    matchesDirectImportIdentity({ id: 1, title: 'Legacy' }, { title: 'Renamed' }),
    false
  );
  assert.equal(
    matchesDirectImportIdentity(
      { id: 1, title: 'Legacy', contentHash: 'not-a-hash' },
      { title: 'Legacy', contentHash: 'not-a-hash' }
    ),
    false
  );
  assert.equal(normalizedDirectImportHash(hash.toUpperCase()), hash);
  assert.equal(normalizedDirectImportHash('a'.repeat(63)), undefined);
});

test('bookmark snapshots own their target and nested completion metadata', () => {
  const source = {
    dataId: 1,
    progress: 0.5,
    lastBookmarkModified: 10,
    completion: { state: 'finished', finishedOn: '2026-09-20', modifiedAt: 11 }
  };
  const snapshot = snapshotBookmarkData(source, 7);
  source.dataId = 99;
  source.progress = 0.9;
  source.completion.modifiedAt = 50;
  assert.equal(snapshot.dataId, 7);
  assert.equal(snapshot.progress, 0.5);
  assert.equal(snapshot.completion.modifiedAt, 11);
  assert.notEqual(snapshot.completion, source.completion);
});

test('bookmark snapshots reject invalid retargeting IDs', () => {
  for (const id of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => snapshotBookmarkData({ dataId: 1, progress: 0 }, id), /invalid/);
});
