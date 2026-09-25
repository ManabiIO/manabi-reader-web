/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesAcknowledgedFeed,
  mergePayload,
  mergeAnnotationPayload,
  wirePayload
} from '../../apps/web/src/lib/manabi/personal-merge.ts';
import { isCompletedStatistics } from '../../apps/web/src/lib/manabi/completed-statistics.js';
import { ambiguousStatisticTitles } from '../../apps/web/src/lib/manabi/personal-identity.ts';

test('legacy title-keyed statistics never map two different books to one content identity', () => {
  const sameBytes = 'a'.repeat(64);
  const differentBytes = 'b'.repeat(64);
  assert.deepEqual(
    ambiguousStatisticTitles([
      { id: 1, title: 'Same copy', contentHash: sameBytes },
      { id: 2, title: 'Same copy', contentHash: sameBytes.toUpperCase() }
    ]),
    []
  );
  assert.deepEqual(
    ambiguousStatisticTitles([
      { id: 1, title: 'Different books', contentHash: sameBytes },
      { id: 2, title: 'Different books', contentHash: differentBytes },
      { id: 3, title: 'Unknown digest' },
      { id: 4, title: 'Unknown digest' }
    ]),
    ['Different books', 'Unknown digest']
  );
});

test('independent resume fields merge without losing either device', () => {
  assert.deepEqual(
    mergePayload(
      { progress: 0.2, scrollY: 10 },
      { progress: 0.4, scrollY: 10 },
      { progress: 0.2, scrollY: 25 }
    ),
    { value: { progress: 0.4, scrollY: 25 }, fields: [] }
  );
});

test('same-field edits preserve the local draft and name the conflict', () => {
  assert.deepEqual(mergePayload({ progress: 0.2 }, { progress: 0.4 }, { progress: 0.7 }), {
    value: { progress: 0.4 },
    fields: ['progress']
  });
});

test('annotation body and color merge while metadata revisions remain local envelope details', () => {
  const base = {
    id: 'id',
    kind: 'note',
    body: 'old',
    color: 'yellow',
    revision: 1,
    modifiedAt: 'old'
  };
  const local = { ...base, body: 'new', revision: 2, modifiedAt: 'device' };
  const remote = { ...base, color: 'blue', revision: 3, modifiedAt: 'account' };
  assert.deepEqual(mergeAnnotationPayload(base, local, remote, 'merged'), {
    value: { ...local, color: 'blue', revision: 4, modifiedAt: 'merged' },
    fields: []
  });
});

test('annotation merge keeps independent edits while preserving optional-field removal', () => {
  const base = {
    id: 'id',
    kind: 'note',
    body: 'remove me',
    color: 'yellow',
    revision: 1,
    modifiedAt: 'base'
  };
  const local = { ...base, color: 'blue', revision: 2, modifiedAt: 'local' };
  const remote = { ...base, revision: 2, modifiedAt: 'remote' };
  delete remote.body;
  const result = mergeAnnotationPayload(base, local, remote, 'merged');
  assert.deepEqual(result.fields, []);
  assert.equal(result.value.color, 'blue');
  assert.equal(Object.hasOwn(result.value, 'body'), false);
});

test('same-field notes and delete-versus-edit keep a recoverable local draft', () => {
  const base = { kind: 'note', body: 'original', revision: 1 };
  const local = { ...base, body: 'device', revision: 2 };
  const remote = { ...base, body: 'account', revision: 2 };
  assert.deepEqual(mergeAnnotationPayload(base, local, remote, 'now').fields, ['body']);
  assert.deepEqual(mergeAnnotationPayload(base, local, null, 'now'), {
    value: local,
    fields: ['deleted']
  });
  assert.deepEqual(mergeAnnotationPayload(base, null, remote, 'now'), {
    value: null,
    fields: ['deleted']
  });
});

test('lost acknowledgement matches only the exact outgoing revision and payload', () => {
  const request = {
    kind: 'annotation',
    entity_id: 'note-id',
    book_key: `content:${'a'.repeat(64)}`,
    base_revision: 2,
    operation: 'put',
    payload: { body: 'older edit' }
  };
  const record = {
    kind: request.kind,
    entity_id: request.entity_id,
    book_key: request.book_key,
    revision: 3,
    deleted: false,
    payload: request.payload
  };
  assert.equal(matchesAcknowledgedFeed(request, record), true);
  assert.equal(
    matchesAcknowledgedFeed(request, { ...record, payload: { body: 'newer edit' } }),
    false
  );
  assert.equal(matchesAcknowledgedFeed(request, { ...record, revision: 4 }), false);
  assert.equal(
    matchesAcknowledgedFeed(request, { ...record, book_key: `content:${'b'.repeat(64)}` }),
    false
  );
});

test('optional local annotation fields are omitted before comparing a server acknowledgement', () => {
  const payload = { id: 'note-id', body: 'saved', deletedAt: undefined, color: undefined };
  const request = {
    kind: 'annotation',
    entity_id: 'note-id',
    book_key: `content:${'a'.repeat(64)}`,
    base_revision: 0,
    operation: 'put',
    payload
  };
  const remote = {
    kind: 'annotation',
    entity_id: 'note-id',
    book_key: request.book_key,
    revision: 1,
    deleted: false,
    payload: { id: 'note-id', body: 'saved' }
  };
  assert.deepEqual(wirePayload(payload), remote.payload);
  assert.equal(matchesAcknowledgedFeed(request, remote), true);
});

test('current database completion snapshots remain valid personal-state payloads', () => {
  assert.equal(
    isCompletedStatistics(
      {
        dateKey: '2026-09-23',
        dbVersion: 8,
        charactersRead: 12,
        readingTime: 5,
        minReadingSpeed: 1,
        altMinReadingSpeed: 1,
        lastReadingSpeed: 1,
        maxReadingSpeed: 1
      },
      '2026-09-23'
    ),
    true
  );
});
