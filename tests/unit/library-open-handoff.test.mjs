/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearLibraryLocation,
  queueLibraryLocation,
  takeLibraryLocation
} from '../../apps/web/src/lib/library/search-navigation.ts';

test('a failed old navigation cannot discard the newer passage handoff', () => {
  clearLibraryLocation();
  const oldPassage = { quote: 'old passage' };
  const newPassage = { quote: 'new passage' };
  const oldToken = queueLibraryLocation(1, null, oldPassage);
  const newToken = queueLibraryLocation(2, 'alice', newPassage);
  clearLibraryLocation(oldToken);
  assert.equal(takeLibraryLocation(2, 'alice', newToken), newPassage);
  assert.equal(takeLibraryLocation(2, 'alice', newToken), undefined);
});

test('explicit departure and failed current navigation still discard their handoffs', () => {
  const passage = { quote: 'private passage' };
  const token = queueLibraryLocation(1, null, passage);
  assert.ok(!token.includes(passage.quote));
  clearLibraryLocation(token);
  assert.equal(takeLibraryLocation(1, null, token), undefined);
  const next = queueLibraryLocation(1, 'alice', passage);
  clearLibraryLocation();
  assert.equal(takeLibraryLocation(1, 'alice', next), undefined);
});
