/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const { outputText, diagnostics } = ts.transpileModule(
  readFileSync(
    new URL('../../apps/web/src/runtime/web-history-broker.ts', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true
  }
);
assert.equal(diagnostics.length, 0);
const module = { exports: {} };
compileFunction(outputText, ['module', 'exports'])(module, module.exports);
const { installWebHistoryBroker, WebHistoryBrokerError } = module.exports;
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('History condition did not settle');
}

async function realFixture(run, initial = null, options = {}) {
  const dom = new JSDOM('', { url: 'https://reader.example/reader-web/manage' });
  const window = dom.window;
  window.history.replaceState(initial, '', window.location.href);
  const originalPrototypeDescriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(window.history),
    'state'
  );
  const intents = [],
    blocked = [],
    delivered = [];
  let blocking = false;
  // Deliberately register Expo-like listeners before installing the capture listener.
  window.addEventListener('popstate', (event) => {
    delivered.push({ href: window.location.href, state: event.state });
  });
  const broker = installWebHistoryBroker(window, {
    shouldBlock: () => blocking,
    onTraversal: (intent) => intents.push(intent),
    onBlocked: (error) => blocked.push(error),
    timeoutMs: 500,
    ...options
  });
  try {
    await run({
      window,
      broker,
      intents,
      blocked,
      delivered,
      block: (value = true) => {
        blocking = value;
      },
      originalPrototypeDescriptor
    });
  } finally {
    await broker.dispose().catch(() => {});
    dom.window.close();
  }
}

test('real History restores the exact entry before offering a traversal and only replay reaches listeners', async () => {
  await realFixture(async ({ window: w, broker, intents, delivered, blocked, block }) => {
    w.history.pushState({ id: 'reader', nested: { x: 1 } }, '', '/reader-web/b?id=1');
    w.history.pushState({ id: 'settings' }, '', '/reader-web/settings');
    // Restore the reader without guarding, then exercise the retained-key Forward case.
    w.history.back();
    await until(() => delivered.length === 1);
    delivered.length = 0;
    block();
    w.history.forward();
    await until(() => intents.length === 1);
    assert.equal(w.location.pathname, '/reader-web/b');
    assert.deepEqual(w.history.state, { id: 'reader', nested: { x: 1 } });
    assert.equal(delivered.length, 0, 'both rejected Forward and its real restoration are hidden');
    assert.equal(w.history.length, 3, 'restoring never replaces or fabricates entries');
    assert.equal(intents[0].isCurrent(), true);
    await broker.waitUntilRestored();
    const first = intents[0].replay();
    assert.equal(intents[0].replay(), first, 'repeated replay shares one traversal');
    assert.equal(await first, true);
    assert.deepEqual(delivered, [
      { href: 'https://reader.example/reader-web/settings', state: { id: 'settings' } }
    ]);
    assert.equal(intents[0].isCurrent(), false);
    assert.deepEqual(blocked, []);
  });
});

test('cancel/save failure stays on the original entry; stale approval cannot replay after app navigation', async () => {
  await realFixture(async ({ window: w, broker, intents, delivered, block }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    block();
    w.history.back();
    await until(() => intents.length === 1);
    const canceled = intents[0];
    broker.invalidate();
    await broker.waitUntilRestored();
    assert.equal(await canceled.replay(), false);
    assert.equal(w.location.search, '?id=1');
    assert.equal(delivered.length, 0);
    // An app intent must revoke an outstanding save even when its account ID returns.
    w.history.back();
    await until(() => intents.length === 2);
    const oldAccount = intents[1];
    broker.invalidate();
    await broker.waitUntilRestored();
    w.history.pushState({ id: 'new-account', foo: ['bar'] }, '', '/reader-web/connections');
    assert.equal(await oldAccount.replay(), false);
    assert.equal(w.location.pathname, '/reader-web/connections');
  });
});

test('same-URL entries have distinct identities and Expo replace keeps that identity', async () => {
  await realFixture(async ({ window: w, intents, delivered, block }) => {
    w.history.pushState({ id: 'same-expo-id', point: 1 }, '', '/reader-web/b?id=1');
    w.history.pushState({ id: 'same-expo-id', point: 2 }, '', '/reader-web/b?id=1');
    w.history.replaceState(
      { id: 'expo-replacement', arbitrary: { point: 3 } },
      '',
      '/reader-web/b?id=1'
    );
    block();
    w.history.back();
    await until(() => intents.length === 1);
    const first = intents[0];
    assert.equal(first.from.href, first.to.href);
    assert.notEqual(first.from.key, first.to.key);
    assert.equal(first.from.position - first.to.position, 1);
    assert.deepEqual(w.history.state, { id: 'expo-replacement', arbitrary: { point: 3 } });
    assert.equal(await first.replay(), true);
    assert.deepEqual(delivered[0].state, { id: 'same-expo-id', point: 1 });
    w.history.forward();
    await until(() => intents.length === 2);
    assert.equal(intents[1].to.key, first.from.key);
    assert.equal(await intents[1].replay(), true);
    assert.equal(w.history.state.id, 'expo-replacement');
  });
});

test('null, primitives, arrays, reserved fields and structured state remain transparent after dispose', async () => {
  await realFixture(async ({ window: w, broker, delivered, originalPrototypeDescriptor }) => {
    assert.equal(w.history.state, null);
    const states = [
      null,
      42,
      'text',
      false,
      ['list', { id: 2 }],
      { id: 'expo', __manabi_web_history_v1__: { user: 'data' }, date: new Date(0) }
    ];
    for (const [i, value] of states.entries()) {
      w.history.pushState(value, '', `/reader-web/entry-${i}`);
      assert.deepEqual(w.history.state, value);
    }
    await broker.dispose();
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(w.history), 'state'),
      originalPrototypeDescriptor,
      'History.prototype is never modified'
    );
    assert.equal(
      typeof Object.getOwnPropertyDescriptor(w.history, 'state').get,
      'function',
      'the per-window decoder intentionally lasts for the document, including old entries'
    );
    for (let i = states.length - 2; i >= 0; i--) {
      const count = delivered.length;
      w.history.back();
      await until(() => delivered.length > count);
      assert.deepEqual(w.history.state, states[i]);
      assert.deepEqual(delivered.at(-1).state, states[i]);
    }
  });
});

test('initial untracked Back fails closed without guessing positions or changing the entry', async () => {
  const dom = new JSDOM('', { url: 'https://reader.example/older' });
  const w = dom.window;
  w.history.replaceState({ id: 'older', untouched: true }, '', '/older');
  w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  const delivered = [],
    blocked = [],
    intents = [];
  w.addEventListener('popstate', (event) => delivered.push(event));
  const broker = installWebHistoryBroker(w, {
    shouldBlock: () => true,
    onTraversal: (intent) => intents.push(intent),
    onBlocked: (error) => blocked.push(error)
  });
  try {
    w.history.back();
    await until(() => blocked.length);
    assert.equal(blocked[0].reason, 'untracked_entry');
    assert.equal(w.location.pathname, '/older');
    assert.deepEqual(w.history.state, { id: 'older', untouched: true });
    assert.equal(w.history.length, 2);
    assert.deepEqual(delivered, []);
    assert.deepEqual(intents, []);
    await assert.rejects(broker.waitUntilRestored(), /untracked/);
    assert.throws(() => w.history.pushState({}, '', '/new'), WebHistoryBrokerError);
  } finally {
    await broker.dispose().catch(() => {});
    w.close();
  }
});

/** History.go targets are scheduled independently to exercise interleaved traversals. */
function controlledFixture(options = {}) {
  const listeners = [];
  const scheduled = [];
  const location = { href: 'https://reader.example/reader-web/manage' };
  const stack = [{ state: null, href: location.href }];
  let position = 0;
  class ControlledHistory {
    get state() {
      return stack[position].state;
    }
    get length() {
      return stack.length;
    }
    pushState(state, unused, url) {
      const href = new URL(url ?? location.href, location.href).href;
      stack.splice(position + 1);
      stack.push({ state: structuredClone(state), href });
      position++;
      location.href = href;
    }
    replaceState(state, unused, url) {
      const href = new URL(url ?? location.href, location.href).href;
      stack[position] = { state: structuredClone(state), href };
      location.href = href;
    }
    go(delta) {
      const target = position + delta;
      if (target >= 0 && target < stack.length) scheduled.push(target);
    }
    back() {
      this.go(-1);
    }
    forward() {
      this.go(1);
    }
  }
  const history = new ControlledHistory();
  const window = {
    history,
    location,
    setTimeout,
    clearTimeout,
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    }
  };
  const delivered = [],
    intents = [],
    blocked = [];
  window.addEventListener('popstate', (event) =>
    delivered.push({ href: location.href, state: event.state })
  );
  let blocking = false;
  const broker = installWebHistoryBroker(window, {
    shouldBlock: () => blocking,
    onTraversal: (intent) => intents.push(intent),
    onBlocked: (error) => blocked.push(error),
    timeoutMs: 1000,
    ...options
  });
  const emit = (target) => {
    position = target;
    location.href = stack[position].href;
    let stopped = false;
    const event = {
      state: stack[position].state,
      stopImmediatePropagation() {
        stopped = true;
      }
    };
    for (const listener of [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if (stopped) break;
      if (listener.type === 'popstate') listener.fn(event);
    }
  };
  const flush = (index = 0) => {
    assert.ok(scheduled.length > index, 'a real traversal must have been scheduled');
    emit(scheduled.splice(index, 1)[0]);
  };
  return {
    window,
    broker,
    delivered,
    intents,
    blocked,
    scheduled,
    emit,
    flush,
    block: () => {
      blocking = true;
    }
  };
}

test('newer Back during restoration replaces the target without releasing either event', async () => {
  const f = controlledFixture();
  try {
    f.window.history.pushState({ id: 'one' }, '', '/reader-web/one');
    f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    f.block();
    f.window.history.back();
    f.flush(); // At one, restoring reader is queued.
    f.window.history.back();
    f.flush(1); // Newer Back reaches manage before restoration.
    assert.deepEqual(f.scheduled, [2]);
    assert.equal(f.intents.length, 0);
    f.flush();
    await turn();
    assert.equal(f.intents.length, 1);
    assert.equal(f.intents[0].to.position, 0);
    assert.equal(f.window.location.href, 'https://reader.example/reader-web/b?id=1');
    assert.deepEqual(f.delivered, []);
    const replay = f.intents[0].replay();
    f.flush();
    assert.equal(await replay, true);
    assert.equal(f.delivered.length, 1);
    assert.equal(f.delivered[0].href, 'https://reader.example/reader-web/manage');
  } finally {
    await f.broker.dispose();
  }
});

test('app invalidation while replay is scheduled suppresses it, restores origin, then permits push', async () => {
  const f = controlledFixture();
  try {
    f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    f.block();
    f.window.history.back();
    f.flush();
    f.flush();
    await turn();
    const replay = f.intents[0].replay();
    f.broker.invalidate();
    assert.equal(await replay, false);
    let restored = false;
    const wait = f.broker.waitUntilRestored().then(() => {
      restored = true;
    });
    assert.throws(() => f.window.history.pushState({}, '', '/new'), /Wait for/);
    f.flush();
    await turn();
    assert.equal(restored, false);
    assert.deepEqual(f.delivered, []);
    f.flush();
    await wait;
    f.window.history.pushState({ id: 'new' }, '', '/reader-web/settings');
    assert.equal(f.window.history.state.id, 'new');
    assert.equal(f.window.history.length, 3);
  } finally {
    await f.broker.dispose();
  }
});

test('a newer traversal during replay wins after the stale scheduled traversal is absorbed', async () => {
  const f = controlledFixture();
  try {
    f.window.history.pushState({ id: 'one' }, '', '/reader-web/one');
    f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    f.block();
    f.window.history.back();
    f.flush();
    f.flush();
    await turn();
    const old = f.intents[0],
      oldReplay = old.replay();
    f.window.history.go(-2);
    f.flush(1); // New target manage arrives before old replay one.
    assert.equal(await oldReplay, false);
    f.flush(); // Stale replay one is suppressed, queues restoration to reader.
    f.flush();
    await turn();
    assert.deepEqual(f.delivered, []);
    assert.equal(f.intents.length, 2);
    assert.equal(old.isCurrent(), false);
    const current = f.intents[1];
    assert.equal(current.to.position, 0);
    const replay = current.replay();
    f.flush();
    assert.equal(await replay, true);
    assert.equal(f.delivered.length, 1);
  } finally {
    await f.broker.dispose();
  }
});

test('missing restoration event is bounded and cannot grant permission or silently continue', async () => {
  const f = controlledFixture({ timeoutMs: 15 });
  f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  f.block();
  f.window.history.back();
  f.flush();
  await assert.rejects(
    f.broker.waitUntilRestored(),
    (error) => error.reason === 'traversal_timeout'
  );
  assert.equal(f.intents.length, 0);
  assert.deepEqual(f.delivered, []);
  assert.equal(f.blocked.length, 1);
  await assert.rejects(f.broker.dispose(), /did not settle/);
});

test('dispose during restoration revokes callbacks and settles only on original entry', async () => {
  const f = controlledFixture();
  f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  f.block();
  f.window.history.back();
  f.flush();
  let settled = false;
  const dispose = f.broker.dispose().then(() => {
    settled = true;
  });
  await turn();
  assert.equal(settled, false);
  f.flush();
  await dispose;
  assert.deepEqual(f.intents, []);
  assert.deepEqual(f.delivered, []);
  f.window.history.back();
  f.flush();
  assert.equal(f.delivered.length, 1, 'the disposed guard no longer blocks browser navigation');
});

test('StrictMode idle disposal reinstalls synchronously without wrapping methods or listeners twice', async () => {
  await realFixture(async ({ window: w, broker, delivered }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    const push = w.history.pushState;
    const replace = w.history.replaceState;
    const stateGetter = Object.getOwnPropertyDescriptor(w.history, 'state').get;
    const oldDisposal = broker.dispose();
    const intents = [];
    const next = installWebHistoryBroker(w, {
      shouldBlock: () => true,
      onTraversal: (intent) => intents.push(intent),
      onBlocked: (error) => assert.fail(error.message)
    });
    await oldDisposal;
    try {
      assert.equal(w.history.pushState, push);
      assert.equal(w.history.replaceState, replace);
      assert.equal(Object.getOwnPropertyDescriptor(w.history, 'state').get, stateGetter);
      w.history.back();
      await until(() => intents.length === 1);
      assert.equal(delivered.length, 0);
      assert.equal(await intents[0].replay(), true);
      assert.equal(delivered.length, 1);
    } finally {
      await next.dispose();
    }
  });
});

test('pending disposal is an explicit reinstall barrier and old owner receives no late callback', async () => {
  const f = controlledFixture();
  f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  f.block();
  f.window.history.back();
  f.flush();
  const dispose = f.broker.dispose();
  const newIntents = [];
  const options = {
    shouldBlock: () => true,
    onTraversal: (intent) => newIntents.push(intent),
    onBlocked: (error) => assert.fail(error.message)
  };
  assert.throws(() => installWebHistoryBroker(f.window, options), /already installed/);
  f.flush();
  await dispose;
  const next = installWebHistoryBroker(f.window, options);
  try {
    assert.deepEqual(f.intents, []);
    f.window.history.back();
    f.flush();
    f.flush();
    await turn();
    assert.equal(newIntents.length, 1);
    const replay = newIntents[0].replay();
    f.flush();
    assert.equal(await replay, true);
    assert.equal(f.delivered.length, 1);
  } finally {
    await next.dispose();
  }
});

test('late timeout after disposal rejects the barrier without calling the disposed owner', async () => {
  const f = controlledFixture({ timeoutMs: 10 });
  f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  f.block();
  f.window.history.back();
  f.flush();
  await assert.rejects(f.broker.dispose(), (error) => error.reason === 'traversal_timeout');
  assert.deepEqual(f.blocked, []);
  assert.deepEqual(f.intents, []);
});

test('new branches prune only forward entries and state replacement keeps raw Expo identity', async () => {
  await realFixture(async ({ window: w, broker, delivered, originalPrototypeDescriptor }) => {
    w.history.pushState({ id: 'reader', nested: { before: true } }, '', '/reader-web/b?id=1');
    w.history.pushState({ id: 'pruned' }, '', '/reader-web/settings');
    w.history.back();
    await until(() => delivered.length === 1);
    await broker.waitUntilRestored();
    w.history.replaceState({ id: 'updated' }, '', '/reader-web/b?id=1');
    const raw = originalPrototypeDescriptor.get.call(w.history);
    assert.equal(raw.id, 'updated', 'Expo id remains at the raw record root');
    const key = raw.__manabi_web_history_v1__.key;
    w.history.replaceState({ id: 'updated-again' }, '', '/reader-web/b?id=1');
    assert.equal(
      originalPrototypeDescriptor.get.call(w.history).__manabi_web_history_v1__.key,
      key
    );
    w.history.pushState({ id: 'branch' }, '', '/reader-web/statistics');
    assert.equal(w.history.length, 3);
    const count = delivered.length;
    w.history.back();
    await until(() => delivered.length === count + 1);
    assert.equal(w.history.state.id, 'updated-again');
    w.history.forward();
    await until(() => delivered.length === count + 2);
    assert.equal(w.history.state.id, 'branch');
  });
});

test('failed state cloning or URL writes do not revoke an outstanding current intent', async () => {
  await realFixture(async ({ window: w, intents, block }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    block();
    w.history.back();
    await until(() => intents.length === 1);
    assert.throws(
      () => w.history.pushState({ fn() {} }, '', '/reader-web/new'),
      /could not be cloned/
    );
    assert.equal(intents[0].isCurrent(), true);
    assert.throws(
      () => w.history.replaceState({}, '', 'https://foreign.example/'),
      /cannot update history/
    );
    assert.equal(intents[0].isCurrent(), true);
    assert.equal(await intents[0].replay(), true);
  });
});

test('an invalidated reader can release blocking and later app navigation has no stale restoration wait', async () => {
  await realFixture(async ({ window: w, broker, intents, block, delivered }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    block();
    w.history.back();
    await until(() => intents.length === 1);
    broker.invalidate();
    block(false);
    w.history.back();
    await until(() => delivered.length === 1);
    await broker.waitUntilRestored();
    w.history.pushState({ id: 'new-owner' }, '', '/reader-web/connections');
    assert.equal(await intents[0].replay(), false);
  });
});

test('an additional origin traversal revokes the pending departure before save can replay it', async () => {
  const f = controlledFixture();
  try {
    f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    f.block();
    f.window.history.back();
    f.flush();
    f.flush();
    await turn();
    const old = f.intents[0];
    f.emit(1); // A separately observed user return to the origin.
    assert.equal(old.isCurrent(), false);
    assert.equal(await old.replay(), false);
    await f.broker.waitUntilRestored();
    assert.deepEqual(f.delivered, []);
  } finally {
    await f.broker.dispose();
  }
});

test('disposing a failed restoration cannot make stale positions safe for a new guard or push', async () => {
  const f = controlledFixture({ timeoutMs: 10 });
  f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  f.block();
  f.window.history.back();
  f.flush();
  await assert.rejects(f.broker.dispose(), /did not settle/);
  const options = {
    shouldBlock: () => true,
    onTraversal: () => assert.fail('No new traversal should be offered'),
    onBlocked: () => {}
  };
  assert.throws(() => installWebHistoryBroker(f.window, options), /not restored/);
  assert.throws(() => f.window.history.pushState({}, '', '/new'), /cannot invent/);
  f.flush(); // The previously delayed, real restoration finally arrives.
  const next = installWebHistoryBroker(f.window, options);
  await next.waitUntilRestored();
  await next.dispose();
});

test('unmarked native hash assignment fails closed instead of inventing a history position', async () => {
  await realFixture(async ({ window: w, block, blocked, delivered, intents, broker }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    block();
    w.location.hash = '#chapter-two';
    await until(() => blocked.length === 1);
    assert.equal(blocked[0].reason, 'untracked_entry');
    assert.equal(w.location.hash, '#chapter-two');
    assert.equal(w.history.length, 3);
    assert.deepEqual(delivered, []);
    assert.deepEqual(intents, []);
    await assert.rejects(broker.waitUntilRestored(), /untracked/);
  });
});

test('raw EPUB-style anchors have the same explicit untracked-entry boundary', async () => {
  await realFixture(async ({ window: w, block, blocked, delivered, intents }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    const anchor = w.document.createElement('a');
    anchor.href = '#epub-chapter';
    w.document.body.append(anchor);
    block();
    anchor.click();
    await until(() => blocked.length === 1);
    assert.equal(blocked[0].reason, 'untracked_entry');
    assert.equal(w.location.hash, '#epub-chapter');
    assert.equal(w.history.length, 3);
    assert.deepEqual(delivered, []);
    assert.deepEqual(intents, []);
  });
});

test('real native hash Back/Forward can match a new hash branch in state and history length', async () => {
  // Characterize the platform boundary directly: no broker or fake popstate.
  const dom = new JSDOM('<a id="anchor" href="#four">Chapter four</a>', {
    url: 'https://reader.example/reader-web/b?id=1'
  });
  const w = dom.window;
  const events = [];
  w.history.replaceState({ id: 'reader' }, '', w.location.href);
  w.addEventListener('popstate', (event) => {
    events.push({ href: w.location.href, state: event.state, length: w.history.length });
  });
  const perform = async (operation) => {
    const count = events.length;
    operation();
    await until(() => events.length === count + 1);
    return events.at(-1);
  };
  try {
    await perform(() => {
      w.location.hash = '#one';
    });
    await perform(() => {
      w.location.hash = '#two';
    });
    const back = await perform(() => w.history.back());
    const newBranch = await perform(() => {
      w.location.hash = '#three';
    });
    assert.equal(
      back.length,
      newBranch.length,
      'a native fragment push can replace the one forward entry without length growth'
    );
    assert.equal(
      back.state,
      newBranch.state,
      'state does not distinguish traversal from creation of an unmarked fragment entry'
    );
    assert.ok(back.state == null, 'JSDOM exposes an unmarked native fragment entry');
    const backAgain = await perform(() => w.history.back());
    assert.equal(new URL(backAgain.href).hash, '#one');
    const forward = await perform(() => w.history.forward());
    assert.equal(new URL(forward.href).hash, '#three');
    await perform(() => w.document.getElementById('anchor').click());
    assert.equal(w.location.hash, '#four');
    await perform(() => w.history.back());
    assert.equal(w.location.hash, '#three');
    await perform(() => w.history.forward());
    assert.equal(w.location.hash, '#four');
  } finally {
    w.close();
  }
});

test('tracked fragment writes retain exact Back/Forward identities and remain safe to replay', async () => {
  await realFixture(async ({ window: w, block, intents, delivered }) => {
    w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    w.history.pushState(w.history.state, '', '#one');
    w.history.pushState(w.history.state, '', '#two');
    block();
    w.history.back();
    await until(() => intents.length === 1);
    assert.equal(new URL(intents[0].to.href).hash, '#one');
    assert.equal(w.location.hash, '#two');
    assert.equal(await intents[0].replay(), true);
    w.history.forward();
    await until(() => intents.length === 2);
    assert.equal(new URL(intents[1].to.href).hash, '#two');
    assert.equal(w.location.hash, '#one');
    assert.equal(await intents[1].replay(), true);
    assert.equal(delivered.length, 2);
    assert.ok(delivered.every((event) => event.state.id === 'reader'));
  });
});

test('currentEntry seeds existing context and entry notifications follow successful write bookkeeping', async () => {
  const changes = [];
  let active;
  await realFixture(
    async ({ window: w, broker }) => {
      active = broker;
      const initial = broker.currentEntry;
      assert.equal(initial.href, w.location.href);
      assert.deepEqual(initial.state, { id: 'initial', arrival: 'reader' });
      assert.deepEqual(changes, [], 'install exposes a getter without inventing an arrival event');
      w.history.pushState({ id: 'settings' }, '', '/reader-web/settings');
      const pushed = broker.currentEntry;
      assert.notEqual(pushed.key, initial.key);
      assert.deepEqual(changes[0], { entry: pushed, previous: initial, kind: 'push' });
      w.history.replaceState({ id: 'settings-new', arbitrary: 1 }, '', '#fonts');
      const replaced = broker.currentEntry;
      assert.equal(replaced.key, pushed.key);
      assert.notEqual(replaced, pushed);
      assert.equal(replaced.href, 'https://reader.example/reader-web/settings#fonts');
      assert.deepEqual(changes[1], { entry: replaced, previous: pushed, kind: 'replace' });
      assert.throws(() => w.history.pushState({ bad() {} }, '', '/reader-web/nope'));
      assert.throws(() => w.history.replaceState({}, '', 'https://foreign.example/nope'));
      assert.equal(broker.currentEntry, replaced);
      assert.equal(changes.length, 2, 'failed writes do not notify');
    },
    { id: 'initial', arrival: 'reader' },
    {
      onEntry(entry, previous, kind) {
        assert.equal(
          active.currentEntry,
          entry,
          'accepted-entry bookkeeping precedes notification'
        );
        changes.push({ entry, previous, kind });
      }
    }
  );
});

test('Settings arrival context is restored before Forward reaches Expo, without restoration notifications', async () => {
  const origins = new Map();
  const changes = [],
    order = [];
  let context, active;
  await realFixture(
    async ({ window: w, broker, intents, delivered, block }) => {
      active = broker;
      w.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=7');
      const readerEntry = broker.currentEntry;
      w.history.pushState({ id: 'settings' }, '', '/reader-web/settings');
      const settingsKey = broker.currentEntry.key;
      w.history.replaceState({ id: 'settings-replaced' }, '', '#fonts');
      assert.equal(broker.currentEntry.key, settingsKey);
      assert.equal(origins.get(settingsKey), readerEntry.href);
      w.history.back();
      await until(() => delivered.length === 1);
      assert.equal(broker.currentEntry.key, readerEntry.key);
      changes.length = 0;
      order.length = 0;
      const consumed = [];
      w.addEventListener('popstate', () => {
        order.push('expo');
        consumed.push({ context, key: broker.currentEntry.key });
      });
      block();
      w.history.forward();
      await until(() => intents.length === 1);
      assert.equal(broker.currentEntry.key, readerEntry.key);
      assert.deepEqual(changes, [], 'vetoed Forward and its origin restoration are both silent');
      assert.deepEqual(order, []);
      assert.equal(await intents[0].replay(), true);
      assert.deepEqual(order, ['entry', 'expo']);
      assert.deepEqual(
        consumed,
        [{ context: readerEntry.href, key: settingsKey }],
        'the consumer sees original Settings origin synchronously'
      );
      assert.equal(changes.length, 1);
      assert.equal(changes[0].kind, 'traverse');
      assert.equal(changes[0].entry.key, settingsKey);
      assert.equal(changes[0].previous.key, readerEntry.key);
      assert.equal(changes[0].entry.state.id, 'settings-replaced');
    },
    null,
    {
      onEntry(entry, previous, kind) {
        assert.equal(active.currentEntry, entry);
        if (kind === 'push' && new URL(entry.href).pathname.endsWith('/settings'))
          origins.set(entry.key, previous.href);
        if (kind === 'traverse') context = origins.get(entry.key);
        changes.push({ entry, previous, kind });
        order.push('entry');
      }
    }
  );
});

test('superseded intermediate traversals never notify entry observers', async () => {
  const changes = [];
  const f = controlledFixture({
    onEntry: (entry, previous, kind) => changes.push({ entry, previous, kind })
  });
  try {
    f.window.history.pushState({ id: 'one' }, '', '/reader-web/one');
    f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
    const origin = f.broker.currentEntry;
    changes.length = 0;
    f.block();
    f.window.history.back();
    f.flush();
    f.window.history.back();
    f.flush(1);
    assert.equal(f.broker.currentEntry, origin);
    assert.deepEqual(changes, []);
    f.flush();
    await turn();
    assert.deepEqual(changes, []);
    const replay = f.intents[0].replay();
    f.flush();
    assert.equal(await replay, true);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].previous, origin);
    assert.equal(changes[0].entry.position, 0);
    assert.equal(changes[0].kind, 'traverse');
  } finally {
    await f.broker.dispose();
  }
});

test('only the installed undisposed owner observes entries across disposal and reinstallation', async () => {
  const oldChanges = [],
    newChanges = [];
  const f = controlledFixture({ onEntry: (entry) => oldChanges.push(entry) });
  f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1');
  f.block();
  f.window.history.back();
  f.flush();
  const dispose = f.broker.dispose();
  f.flush();
  await dispose;
  assert.equal(oldChanges.length, 1, 'a draining disposed owner observes no restoration');
  f.window.history.replaceState({ id: 'unowned' }, '', '/reader-web/b?id=1');
  assert.equal(oldChanges.length, 1);
  const next = installWebHistoryBroker(f.window, {
    shouldBlock: () => false,
    onTraversal: () => assert.fail('No guard should run'),
    onBlocked: () => assert.fail('No fault is expected'),
    onEntry: (entry, previous, kind) => newChanges.push({ entry, previous, kind })
  });
  try {
    const seed = next.currentEntry;
    assert.equal(seed.state.id, 'unowned');
    assert.deepEqual(newChanges, []);
    f.window.history.back();
    f.flush();
    assert.equal(newChanges.length, 1);
    assert.equal(newChanges[0].previous, seed);
    assert.equal(newChanges[0].kind, 'traverse');
    assert.equal(oldChanges.length, 1);
  } finally {
    await next.dispose();
  }
});

test('entry observer failure cannot corrupt bookkeeping or suppress an allowed real popstate', async () => {
  const logged = [],
    observed = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  const f = controlledFixture({
    onEntry(entry, previous, kind) {
      observed.push({ entry, previous, kind });
      throw new Error('Observer test failure');
    }
  });
  try {
    const initial = f.broker.currentEntry;
    assert.doesNotThrow(() =>
      f.window.history.pushState({ id: 'reader' }, '', '/reader-web/b?id=1')
    );
    const pushed = f.broker.currentEntry;
    assert.notEqual(pushed.key, initial.key);
    assert.doesNotThrow(() => f.window.history.replaceState({ id: 'replaced' }, '', '#fonts'));
    assert.equal(f.broker.currentEntry.key, pushed.key);
    assert.equal(f.window.history.state.id, 'replaced');
    f.window.history.back();
    f.flush();
    assert.equal(f.broker.currentEntry.key, initial.key);
    assert.equal(f.delivered.length, 1);
    assert.equal(f.delivered[0].href, initial.href);
    assert.deepEqual(
      observed.map((item) => item.kind),
      ['push', 'replace', 'traverse']
    );
    assert.equal(logged.length, 3);
    assert.deepEqual(f.blocked, []);
    await f.broker.waitUntilRestored();
  } finally {
    console.error = originalError;
    await f.broker.dispose();
  }
});
