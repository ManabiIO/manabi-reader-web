import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialogComponent } from './react-component-harness.mjs';

function harness(overrides = {}) {
  const received = [],
    events = [],
    skip = [];
  let decryptCalls = 0;
  const decrypt =
    overrides.decrypt ??
    (async () =>
      new TextEncoder().encode(JSON.stringify({ clientId: 'client', clientSecret: '' })));
  const component = dialogComponent(
    'StorageUnlock',
    {
      description: 'Protected source',
      action: 'Enter the password to continue',
      requiresSecret: true,
      showCancel: false,
      forwardSecret: false,
      encryptedData: new ArrayBuffer(8),
      resolver: (value) => received.push(value),
      onClose: () => events.push(['close']),
      ...overrides.props
    },
    {
      '$lib/data/store': {
        hideExternalReadHint$: {},
        skipKeyDownListener$: { next: (value) => skip.push(value) }
      },
      '$lib/data/storage/storage-source-manager': {
        decrypt: async (...args) => {
          decryptCalls++;
          return decrypt(...args);
        }
      }
    }
  );
  const pending = () => !!component.find((node) => node.type === 'form').props['aria-busy'];
  return {
    received,
    events,
    skip,
    decryptCalls: () => decryptCalls,
    setSecret: (value) => component.change(value),
    getError: () => component.text(component.find((node) => node.props.role === 'alert')),
    getPending: pending,
    unlock: () => {
      component.submit();
      return component.waitUntil(() => !pending());
    },
    closeDialog: () => component.button('Cancel').props.onClick(),
    mount: async () => {},
    dispose: () => component.dispose(),
    strictReplay: () => component.strictReplay(),
    flush: () => component.flush()
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('successful encrypted unlock resolves and closes exactly once', async () => {
  const h = harness({ props: { forwardSecret: true } });
  h.setSecret('fixture password');
  await h.unlock();
  h.closeDialog();
  await h.dispose();
  assert.deepEqual(h.received, [
    { clientId: 'client', clientSecret: '', secret: 'fixture password' }
  ]);
  assert.deepEqual(h.events, [['close']]);
  assert.equal(h.decryptCalls(), 1);
});

test('unlock without a secret requirement publishes the continuation sentinel once', async () => {
  const h = harness({
    props: { requiresSecret: false, encryptedData: undefined }
  });
  await h.unlock();
  await h.dispose();
  assert.deepEqual(h.received, [{ clientId: '', clientSecret: '' }]);
  assert.deepEqual(h.events, [['close']]);
  assert.equal(h.decryptCalls(), 0);
});

test('decrypt failure remains open and a retry can succeed', async () => {
  let attempt = 0;
  const h = harness({
    decrypt: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Wrong password');
      return new TextEncoder().encode(JSON.stringify({ clientId: 'retry', clientSecret: '' }));
    }
  });
  h.setSecret('wrong');
  await h.unlock();
  assert.deepEqual(h.received, []);
  assert.match(h.getError(), /Wrong password/);
  assert.equal(h.getPending(), false);
  h.setSecret('correct');
  await h.unlock();
  assert.deepEqual(h.received, [{ clientId: 'retry', clientSecret: '' }]);
  assert.equal(h.decryptCalls(), 2);
});

test('repeated submit cannot start a second decrypt while the first is pending', async () => {
  const gate = deferred();
  const h = harness({
    decrypt: async () => {
      await gate.promise;
      return new TextEncoder().encode(JSON.stringify({ clientId: 'one', clientSecret: '' }));
    }
  });
  const first = h.unlock();
  const second = h.unlock();
  assert.equal(h.getPending(), true);
  assert.equal(h.decryptCalls(), 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(h.received, [{ clientId: 'one', clientSecret: '' }]);
  assert.equal(h.decryptCalls(), 1);
});

test('destroying an unresolved unlock cancels once without dispatching a late close', async () => {
  const h = harness();
  await h.dispose();
  await h.dispose();
  assert.deepEqual(h.received, [undefined]);
  assert.deepEqual(h.events, []);
});

test('mount and disposal preserve reader shortcut suppression lifetime', async () => {
  const h = harness();
  await h.mount();
  assert.deepEqual(h.skip, [true]);
  await h.dispose();
  assert.deepEqual(h.skip, [true, false]);
});

test('Strict Mode cleanup replay preserves an unresolved unlock', async () => {
  const h = harness();
  h.strictReplay();
  await h.flush();
  assert.deepEqual(h.received, []);
  h.setSecret('fixture');
  await h.unlock();
  await h.dispose();
  assert.equal(h.received.length, 1);
  assert.equal(h.received[0].clientId, 'client');
});

test('unmounting during decrypt cancels once and fences late completion', async () => {
  const gate = deferred();
  const h = harness({
    decrypt: async () => {
      await gate.promise;
      return new TextEncoder().encode(JSON.stringify({ clientId: 'late', clientSecret: '' }));
    }
  });
  void h.unlock();
  await h.dispose();
  gate.resolve();
  await h.flush();
  assert.deepEqual(h.received, [undefined]);
  assert.deepEqual(h.events, []);
});
