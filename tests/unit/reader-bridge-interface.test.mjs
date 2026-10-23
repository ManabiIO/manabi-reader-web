/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';

const { outputFiles } = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { ReaderBridgeRecovery } from './apps/web/src/settings-react/reader-bridge-recovery';
      import { ReaderBridgeChanges } from './apps/web/src/settings-react/reader-bridge-changes';
      import { ReaderBridgeConnections } from './apps/web/src/settings-react/reader-bridge-connections';
      const root = createRoot(document.getElementById('root'));
      window.fixture = {
        connections: owner => flushSync(() => root.render(<React.StrictMode><ReaderBridgeConnections owner={owner}/></React.StrictMode>)),
        recovery: owner => flushSync(() => root.render(<React.StrictMode><ReaderBridgeRecovery owner={owner}/></React.StrictMode>)),
        changes: props => flushSync(() => root.render(<React.StrictMode><ReaderBridgeChanges {...props}/></React.StrictMode>)),
        unmount: () => root.unmount()
      };
    `,
    loader: 'tsx',
    resolveDir: fileURLToPath(new URL('../../', import.meta.url))
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'reader-bridge-interface-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/primitives$/ }, () => ({
          path: 'button',
          namespace: 'interface-fixture'
        }));
        builder.onResolve(
          { filter: /^\$lib\/manabi\/reader-bridge-(local|recovery|saved)$/ },
          ({ path }) => ({
            path: path.endsWith('recovery')
              ? 'recovery'
              : path.endsWith('saved')
                ? 'saved'
                : 'local',
            namespace: 'interface-fixture'
          })
        );
        builder.onLoad({ filter: /.*/, namespace: 'interface-fixture' }, ({ path }) => ({
          loader: 'js',
          resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
          contents:
            path === 'button'
              ? `import React from 'react'; export function Button({variant,...props}) { return React.createElement('button',props); }`
              : path === 'recovery'
                ? `
                  if(window.importFailure) throw new Error('Module unavailable');
                  export const readerBridgeRecoveryChanges = window.recoveryChanges;
                  export const readDriveReaderRecovery = (...args) => window.bridge.read(...args);
                  export const exportDriveReaderRecovery = (...args) => window.bridge.export(...args);
                  export const restoreDriveReaderRecovery = (...args) => window.bridge.restore(...args);
                  export const abandonDriveReaderDraft = (...args) => window.bridge.abandon(...args);
                `
                : path === 'saved'
                  ? `export const checkSavedDriveReaderConnection = (...args) => window.bridge.checkConnection(...args);`
                  : `
                  export const listDriveReaderConnections = (...args) => window.bridge.connections(...args);
                  export const removeDriveReaderConnection = (...args) => window.bridge.removeConnection(...args);
                  export const reviewDriveReaderChanges = (...args) => window.bridge.review(...args);
                  export const receiveDriveReaderChanges = (...args) => window.bridge.receive(...args);
                `
        }));
      }
    }
  ]
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function fixture(run, { bridge = {}, importFailure = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  virtualConsole.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://reader.example/settings',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  const downloads = [],
    revoked = [];
  Object.assign(window, { importFailure, bridge, recoveryChanges: new window.EventTarget() });
  window.URL.createObjectURL = () => `blob:fixture-${downloads.length}`;
  window.URL.revokeObjectURL = (url) => revoked.push(url);
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  window.eval(outputFiles[0].text);
  const until = async (predicate, message = 'Expected interface state') => {
    for (let attempt = 0; attempt < 80 && !predicate(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(predicate(), message);
  };
  const button = (label) =>
    [...window.document.querySelectorAll('button')].find((node) => node.textContent === label);
  const text = () => window.document.body.textContent;
  try {
    await run({ window, api: window.fixture, until, button, text, downloads, revoked });
  } finally {
    window.fixture.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'The mounted interface must not emit React or DOM errors');
}

const accepted = (title) => ({ id: title, revision: '1', phase: 'accepted', title });
const reviewed = (title) => ({
  title,
  plan: { state: 'review', conflicts: [] },
  local: { values: { resume: { progress: 0.2 } } },
  remote: { values: { resume: { progress: 0.3 } } }
});

test('recovery read failures are retryable and older failed reads do not overwrite a newer result', async () => {
  const stale = deferred(),
    recent = deferred();
  let reads = 0;
  await fixture(
    async ({ window, api, until, button, text }) => {
      api.recovery('owner-a');
      await until(() => button('Try reading sync recovery again'));
      button('Try reading sync recovery again').click();
      await until(() => reads === 2);
      window.recoveryChanges.dispatchEvent(new window.Event('change'));
      await until(() => reads === 3);
      recent.resolve([accepted('Current book')]);
      await until(() => text().includes('Current book'));
      stale.reject(new Error('Old read failed'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(button('Try reading sync recovery again'), undefined);
      assert.equal(button('Download sync recovery').disabled, false);
    },
    {
      bridge: {
        read: () => {
          reads += 1;
          if (reads === 1) throw new Error('Unavailable');
          return reads === 2 ? stale.promise : recent.promise;
        }
      }
    }
  );
});

test('recovery module-load failure is reported inline without an unhandled rejection', async () => {
  await fixture(
    async ({ api, until, text, button }) => {
      api.recovery('owner-a');
      await until(() => text().includes('Sync recovery could not be opened.'));
      assert.equal(button('Try reading sync recovery again').disabled, false);
    },
    { importFailure: true }
  );
});

test('changing recovery owner cancels a pending download without blocking the new account', async () => {
  const oldExport = deferred();
  const calls = [];
  await fixture(
    async ({ api, until, button, text, downloads, revoked }) => {
      api.recovery('owner-a');
      await until(() => button('Download sync recovery')?.disabled === false);
      button('Download sync recovery').click();
      await until(() => calls.length === 1);
      api.recovery('owner-b');
      await until(() => text().includes('owner-b'));
      assert.equal(text().includes('owner-a'), false);
      assert.equal(calls[0].signal.aborted, true);
      button('Download sync recovery').click();
      await until(() => downloads.length === 1);
      oldExport.resolve('{}');
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(downloads.length, 1);
      assert.match(text(), /Recovery download started/);
      api.unmount();
      assert.equal(revoked.length, 1);
    },
    {
      bridge: {
        read: async (owner) => [accepted(owner)],
        export: (owner, signal) => {
          calls.push({ owner, signal });
          return owner === 'owner-a' ? oldExport.promise : Promise.resolve('{}');
        }
      }
    }
  );
});

test('recovery keeps older decisions downloadable, labels restore, and explains the empty state', async () => {
  let rows = [];
  await fixture(
    async ({ window, api, until, button, text }) => {
      api.recovery('owner-a');
      await until(() => text().includes('No saved sync decisions on this device yet.'));
      rows = [{ ...accepted('Previous decision'), phase: 'superseded' }];
      window.recoveryChanges.dispatchEvent(new window.Event('change'));
      await until(() => text().includes('1 older decision is also kept'));
      assert.equal(button('Download sync recovery').disabled, false);
      assert.equal(window.document.querySelectorAll('article').length, 0);
      const input = window.document.querySelector('input[type=file]');
      assert.equal(input.labels[0].textContent, 'Restore sync recovery');
      assert.match(
        window.document.getElementById(input.getAttribute('aria-describedby')).textContent,
        /inactive evidence/
      );
    },
    { bridge: { read: async () => rows } }
  );
});

test('review results are cancelled when the selected comparison changes and focus the new heading', async () => {
  const stale = deferred();
  let firstSignal;
  const preview = {},
    comparison = {};
  await fixture(
    async ({ window, api, until, button, text }) => {
      api.changes({ preview, comparison, onSaved() {} });
      await until(() => button('Review reading changes'));
      button('Review reading changes').click();
      await until(() => firstSignal);
      api.changes({ preview: {}, comparison: {}, onSaved() {} });
      await until(() => button('Review reading changes')?.disabled === false);
      assert.equal(firstSignal.aborted, true);
      button('Review reading changes').click();
      await until(() => text().includes('Reading changes for New book'));
      stale.resolve(reviewed('Old book'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(text().includes('Old book'), false);
      assert.equal(window.document.activeElement.textContent, 'Reading changes for New book');
      assert.equal(window.document.querySelectorAll('th[scope=col]').length, 3);
      assert.equal(window.document.querySelectorAll('th[scope=row]').length, 1);
      assert.equal(window.document.querySelector('[role=region]').tabIndex, 0);
      const save = button('Use Drive reading data on this device');
      assert.match(
        window.document.getElementById(save.getAttribute('aria-describedby')).textContent,
        /replaces/
      );
    },
    {
      bridge: {
        review: (next, _comparison, signal) => {
          if (next === preview) {
            firstSignal = signal;
            return stale.promise;
          }
          return Promise.resolve(reviewed('New book'));
        }
      }
    }
  );
});

test('review and save failures have accurate inline wording and permit a retry', async () => {
  let reviews = 0;
  await fixture(
    async ({ api, until, button, text }) => {
      api.changes({
        preview: {},
        comparison: {},
        onSaved() {
          assert.fail('Save failed');
        }
      });
      await until(() => button('Review reading changes'));
      button('Review reading changes').click();
      await until(() => text().includes('Reading changes could not be checked.'));
      assert.equal(button('Review reading changes').disabled, false);
      button('Review reading changes').click();
      await until(() => button('Use Drive reading data on this device'));
      button('Use Drive reading data on this device').click();
      await until(() => text().includes('The save could not be confirmed.'));
      assert.equal(button('Use Drive reading data on this device').disabled, false);
      assert.equal(text().includes('Your existing reading data was kept'), false);
    },
    {
      bridge: {
        review: async () => {
          if (++reviews === 1) throw new Error('Offline');
          return reviewed('Book');
        },
        receive: async () => {
          throw new Error('Interrupted after commit');
        }
      }
    }
  );
});

const savedConnection = (title, state = 'linked') => ({
  id: title,
  revision: '1',
  state,
  descriptor: { title, source: { profile: 'ttu-1-8' } }
});

test('saved connections cancel a pending check and hide its book after changing accounts', async () => {
  const pending = deferred();
  let signal;
  await fixture(
    async ({ api, until, button, text }) => {
      api.connections('owner-a');
      await until(() => text().includes('Book for owner-a'));
      // Let StrictMode finish mounting the asynchronously loaded row before input.
      await new Promise((resolve) => setTimeout(resolve, 0));
      button('Check current copies').click();
      await until(() => signal);
      api.connections('owner-b');
      await until(() => text().includes('Book for owner-b'));
      assert.equal(signal.aborted, true);
      pending.reject(new Error('Previous account request failed'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(text().includes('Book for owner-a'), false);
      assert.equal(text().includes('Could not check Google Drive'), false);
    },
    {
      bridge: {
        connections: async (owner) => [savedConnection(`Book for ${owner}`)],
        checkConnection: (_owner, _id, _revision, cancellation) => {
          signal = cancellation;
          return pending.promise;
        }
      }
    }
  );
});

test('restored connections remain inactive and forgetting them only calls the guarded removal', async () => {
  let rows = [savedConnection('Recovered book', 'restored')];
  const removals = [];
  await fixture(
    async ({ window, api, until, button, text }) => {
      api.connections('owner');
      await until(() => button('Forget recovered connection'));
      assert.equal(button('Check current copies'), undefined);
      assert.match(text(), /Recovery never reconnects a book automatically/);
      // Let StrictMode finish mounting the asynchronously loaded row before input.
      await new Promise((resolve) => setTimeout(resolve, 0));
      button('Forget recovered connection').click();
      await until(() => removals.length === 1);
      assert.deepEqual(removals[0].slice(0, 3), ['owner', 'Recovered book', '1']);
      rows = [];
      window.recoveryChanges.dispatchEvent(new window.Event('change'));
      await until(() => text().includes('No saved reader connections yet'));
      assert.equal(text().includes('Recovered book'), false);
    },
    {
      bridge: {
        connections: async () => rows,
        removeConnection: async (...args) => {
          removals.push(args);
        }
      }
    }
  );
});

test('saved connection reads retry and an older failed request cannot erase newer records', async () => {
  const old = deferred();
  let reads = 0;
  await fixture(
    async ({ window, api, until, button, text }) => {
      api.connections('owner');
      await until(() => text().includes('Saved connections could not be read'));
      button('Refresh saved connections').click();
      await until(() => reads === 2);
      window.recoveryChanges.dispatchEvent(new window.Event('change'));
      await until(() => text().includes('Current book'));
      old.reject(new Error('Old read failed'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(text().includes('Saved connections could not be read'), false);
      assert.equal(button('Check current copies').disabled, false);
    },
    {
      bridge: {
        connections: () => {
          reads++;
          if (reads === 1) throw new Error('Storage busy');
          return reads === 2 ? old.promise : Promise.resolve([savedConnection('Current book')]);
        }
      }
    }
  );
});
