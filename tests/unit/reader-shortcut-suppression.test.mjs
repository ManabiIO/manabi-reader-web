/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BehaviorSubject } from 'rxjs';
import { suppressReaderShortcuts } from '../../apps/web/src/reader-react/shortcut-suppression.ts';

for (const initial of [false, true]) {
  test(`temporary shortcut suppression restores the prior ${initial} state once`, () => {
    const state = new BehaviorSubject(initial);
    const release = suppressReaderShortcuts(state);
    assert.equal(state.getValue(), true);
    release();
    assert.equal(state.getValue(), initial);
    state.next(true);
    release();
    assert.equal(state.getValue(), true, 'duplicate cleanup cannot rewrite newer state');
    assert.equal(state.observers.length, 0);
  });
}
for (const first of ['outer', 'inner']) {
  test(`overlapping reader operations restore the original state when ${first} releases first`, () => {
    const state = new BehaviorSubject(false);
    const releases = {
      outer: suppressReaderShortcuts(state),
      inner: suppressReaderShortcuts(state)
    };
    releases[first]();
    assert.equal(state.getValue(), true);
    releases[first === 'outer' ? 'inner' : 'outer']();
    assert.equal(state.getValue(), false);
    assert.equal(state.observers.length, 0);
  });
}
for (const next of [false, true]) {
  test(`an unrelated dialog's newer ${next} publication survives old reader cleanup`, () => {
    const state = new BehaviorSubject(false);
    const release = suppressReaderShortcuts(state);
    state.next(next);
    release();
    assert.equal(state.getValue(), next);
    assert.equal(state.observers.length, 0);
  });
}
