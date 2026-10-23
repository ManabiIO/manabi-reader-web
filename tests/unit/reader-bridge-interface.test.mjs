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
      const root = createRoot(document.getElementById('root'));
      window.fixture = {
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
          { filter: /^\$lib\/manabi\/reader-bridge-(local|recovery)$/ },
          ({ path }) => ({
            path: path.endsWith('recovery') ? 'recovery' : 'local',
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
                : `
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
