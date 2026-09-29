import test from 'node:test';
import assert from 'node:assert/strict';
import { remapTemporaryTrackDelays } from '../../.cache/media-test-build/authored-track.js';

const replacements = new Map([
  ['first', 'saved'],
  ['second', 'saved']
]);
for (const reversed of [false, true])
  test(`Selected offset does not depend on duplicate insertion order (${reversed})`, () => {
    const source = { first: 0.4, second: 0.9 };
    assert.deepEqual(
      remapTemporaryTrackDelays(
        source,
        new Map(reversed ? [...replacements].reverse() : replacements),
        ['first', '']
      ),
      { saved: 0.4 }
    );
    assert.deepEqual(source, { first: 0.4, second: 0.9 });
  });
test('A selected saved offset outranks discarded temporary offsets', () => {
  assert.deepEqual(
    remapTemporaryTrackDelays({ first: 0.4, saved: 0.9 }, replacements, ['saved', '']),
    { saved: 0.9 }
  );
});
test('The selected default-zero offset outranks an unselected duplicate', () => {
  assert.deepEqual(remapTemporaryTrackDelays({ second: 0.9 }, replacements, ['first', '']), {
    saved: 0
  });
});
test('Unselected conflicting offsets do not choose an arbitrary value', () => {
  assert.deepEqual(
    remapTemporaryTrackDelays({ first: 0.4, second: 0.9 }, replacements, ['', '']),
    {}
  );
});
test('Identical unselected offsets can be retained for later selection', () => {
  assert.deepEqual(
    remapTemporaryTrackDelays({ first: -0.4, second: -0.4 }, replacements, ['', '']),
    { saved: -0.4 }
  );
});
test('Unselected handoff preserves an existing saved offset including zero', () => {
  assert.deepEqual(remapTemporaryTrackDelays({ first: 0.4, saved: 0 }, replacements, ['', '']), {
    saved: 0
  });
});
test('Translation offset can migrate independently while the main track is Off', () => {
  assert.deepEqual(remapTemporaryTrackDelays({ second: -0.6 }, replacements, ['', 'second']), {
    saved: -0.6
  });
});
test('An exact existing identity is a no-op', () => {
  const source = { saved: 0.9 };
  assert.equal(remapTemporaryTrackDelays(source, new Map([['saved', 'saved']]), ['saved']), source);
});
test('No stored or selected temporary offset requires no persistence', () => {
  const source = { unrelated: 0.2 };
  assert.equal(remapTemporaryTrackDelays(source, replacements, ['', '']), source);
});
