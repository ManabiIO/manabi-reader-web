import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  matchesDirectImportIdentity,
  normalizedDirectImportHash
} from '../../apps/web/src/lib/data/database/books-db/direct-import-identity.ts';

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
