import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePageTurnEffect } from '../../apps/web/src/lib/foliate-epub/page-turn-effect.ts';

test('page effects accept only slide and none; unknown saved data falls back to slide', () => {
  assert.equal(normalizePageTurnEffect('none'), 'none');
  assert.equal(normalizePageTurnEffect('slide'), 'slide');
  for (const value of [null, undefined, '', 'curl', 'NONE', 0, false, {}, ['none']])
    assert.equal(normalizePageTurnEffect(value), 'slide');
});
