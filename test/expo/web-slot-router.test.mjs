/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
// The production import is Expo's public StackRouter export. Load its exact
// installed implementation without booting the unrelated React Native renderer.
const { StackRouter } = appRequire('expo-router/build/react-navigation/routers/StackRouter');
const source = readFileSync(
  new URL('../../apps/web/src/runtime/web-slot-router.ts', import.meta.url),
  'utf8'
);
const module = { exports: {} };
compileFunction(
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  ['require', 'module', 'exports']
)(
  (name) => {
    assert.equal(name, 'expo-router');
    return { StackRouter };
  },
  module,
  module.exports
);
const { WebSlotRouter } = module.exports;
const config = {
  routeNames: ['manage', 'snippets', 'settings', 'b', 'parent'],
  routeParamList: {},
  routeGetIdList: {}
};
const focused = (state) => state.routes[state.index];
const unique = (state) =>
  assert.equal(new Set(state.routes.map((route) => route.key)).size, state.routes.length);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const part of Object.values(value)) freeze(part);
  }
  return value;
}

for (const name of ['manage', 'snippets']) {
  test(`${name} query pushes preserve the live key and immutable distinct browser snapshots`, () => {
    const router = WebSlotRouter({ initialRouteName: name });
    const initial = freeze(router.getInitialState(config));
    const original = structuredClone(initial);
    const params = freeze({
      series: 'personal-series:猫%2F100%',
      q: ['one', 'two'],
      '#': 'note%25',
      state: { nested: true }
    });
    const next = freeze(
      router.getStateForAction(initial, { type: 'PUSH', payload: { name, params } }, config)
    );
    assert.equal(
      next.routes.length,
      initial.routes.length + 1,
      'Expo must observe a push, not a replacement'
    );
    assert.equal(focused(next).key, focused(initial).key);
    assert.deepEqual(
      focused(next).params,
      params,
      'already-decoded arrays, percent identities and nested params stay exact'
    );
    assert.deepEqual(initial, original, 'the stored previous browser snapshot is untouched');
    unique(next);
    const newer = freeze(
      router.getStateForAction(
        next,
        { type: 'PUSH', payload: { name, params: { collection: 'finished' } } },
        config
      )
    );
    assert.equal(newer.routes.length, next.routes.length + 1);
    assert.equal(focused(newer).key, focused(initial).key);
    unique(newer);
    // This is Expo useLinking's browser snapshot path, including a later forward.
    assert.equal(focused(router.getRehydratedState(initial, config)).key, focused(newer).key);
    assert.equal(focused(router.getRehydratedState(next, config)).key, focused(newer).key);
    assert.equal(router.getRehydratedState(newer, config), newer);
  });
  for (const type of ['GO_BACK', 'POP', 'POP_TO_TOP', 'REPLACE']) {
    test(`${name} ${type} also retains its live focused controller and unique route keys`, () => {
      const router = WebSlotRouter({ initialRouteName: name });
      const first = router.getInitialState(config);
      const second = router.getStateForAction(
        first,
        { type: 'PUSH', payload: { name, params: { collection: 'finished' } } },
        config
      );
      const before = structuredClone(second);
      freeze(second);
      const action =
        type === 'REPLACE'
          ? { type, payload: { name, params: { q: 'replacement' } } }
          : type === 'POP'
            ? { type, payload: { count: 1 } }
            : { type };
      const next = router.getStateForAction(second, action, config);
      assert.equal(focused(next).key, focused(second).key);
      assert.deepEqual(focused(next).params, type === 'REPLACE' ? { q: 'replacement' } : undefined);
      assert.deepEqual(second, before);
      unique(next);
    });
  }
}

test('reader, cross-screen, and nested route actions retain the original Stack semantics', () => {
  const router = WebSlotRouter({ initialRouteName: 'manage' });
  let state = router.getInitialState(config);
  const libraryKey = focused(state).key;
  state = router.getStateForAction(
    state,
    { type: 'PUSH', payload: { name: 'b', params: { id: '1' } } },
    config
  );
  const readerKey = focused(state).key;
  assert.notEqual(readerKey, libraryKey);
  state = router.getStateForAction(
    state,
    { type: 'PUSH', payload: { name: 'b', params: { id: '2' } } },
    config
  );
  assert.notEqual(focused(state).key, readerKey, 'each reader gets a fresh owner');
  state = router.getStateForAction(state, { type: 'GO_BACK' }, config);
  assert.equal(focused(state).key, readerKey);
  state = router.getStateForAction(state, { type: 'GO_BACK' }, config);
  assert.equal(focused(state).key, libraryKey);
  const nested = {
    screen: 'manage',
    params: { series: 'encoded%25', nested: { value: ['a', 'b'] } }
  };
  state = router.getStateForAction(
    state,
    { type: 'PUSH', payload: { name: 'parent', params: nested } },
    config
  );
  assert.deepEqual(focused(state).params, nested);
  assert.notEqual(focused(state).key, libraryKey);
  unique(state);
  assert.equal(
    router.getStateForAction(state, { type: 'PUSH', payload: { name: 'missing' } }, config),
    null
  );
});
