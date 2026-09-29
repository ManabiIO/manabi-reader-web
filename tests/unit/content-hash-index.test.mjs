import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentHashPrimaryKeys,
  normalizedIndexedContentHash
} from '../../apps/web/src/lib/data/database/books-db/content-hash-index.ts';

function index(entries) {
  return {
    async openKeyCursor() {
      const cursor = (position) =>
        position >= entries.length
          ? null
          : {
              key: entries[position][0],
              primaryKey: entries[position][1],
              continue: async () => cursor(position + 1)
            };
      return cursor(0);
    }
  };
}

test('content identity key scan is case-insensitive and returns only valid numeric primary keys', async () => {
  const hash = 'a'.repeat(64);
  const result = await contentHashPrimaryKeys(
    index([
      [hash.toUpperCase(), 4],
      ['b'.repeat(64), 5],
      [hash, 'not-a-number'],
      [hash, 6]
    ]),
    hash
  );
  assert.deepEqual(result, [4, 6]);
  assert.equal(normalizedIndexedContentHash(hash.toUpperCase()), hash);
});

test('content identity key scan rejects malformed requested hashes without opening the cursor', async () => {
  let opened = false;
  const result = await contentHashPrimaryKeys(
    {
      async openKeyCursor() {
        opened = true;
        return null;
      }
    },
    'not-a-hash'
  );
  assert.deepEqual(result, []);
  assert.equal(opened, false);
});

test('content identity key scan observes authority and cancellation between cursor steps', async () => {
  const hash = 'c'.repeat(64);
  let assertions = 0;
  const controller = new AbortController();
  const source = index([
    [hash, 1],
    [hash, 2]
  ]);
  await assert.rejects(
    contentHashPrimaryKeys(
      source,
      hash,
      () => {
        assertions += 1;
        if (assertions === 2) controller.abort();
      },
      controller.signal
    ),
    { name: 'AbortError' }
  );
  assert.equal(assertions, 2);
});
