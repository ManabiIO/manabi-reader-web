import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDeploymentManifest,
  loadDeploymentPreprocessor
} from '../../apps/web/src/lib/preprocessing/loader.mjs';
import { sha256 } from '../../apps/web/src/lib/preprocessing/contracts.mjs';
const options = { manifestURL: '/manifest.json', baseURL: 'https://reader.test/' };
const manifest = (hash) => ({
  protocol: 1,
  release: 'r1',
  entry: { path: '/p.mjs', sha256: hash },
  processingResources: []
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test('setup catalogue fetch evaluates no plugin and freezes the data snapshot', async () => {
  const calls = [];
  const result = await loadDeploymentManifest({
    ...options,
    fetcher: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(manifest('a'.repeat(64))));
    }
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(calls, ['https://reader.test/manifest.json']);
  assert.ok(Object.isFrozen(result.manifest.entry));
  assert.ok(Object.isFrozen(result.manifest.processingResources));
});
test('already canceled optional setup is not reported as successful fallback', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    loadDeploymentManifest({
      signal: c.signal,
      fetcher: () => {
        throw Error('fetch');
      }
    }),
    { name: 'AbortError' }
  );
});
test('canceling a stalled response read cancels its stream rather than hanging', async () => {
  const c = new AbortController(),
    started = deferred();
  let canceled = 0;
  const response = new Response(
    new ReadableStream({
      pull() {
        started.resolve();
        return new Promise(() => {});
      },
      cancel() {
        canceled++;
      }
    })
  );
  const task = loadDeploymentManifest({
    ...options,
    signal: c.signal,
    fetcher: async () => response
  });
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await started.promise;
  c.abort();
  await rejected;
  assert.equal(canceled, 1);
});
test('invalid private factory result is disposed and cleanup completion is awaited', async () => {
  let disposed = false;
  const hash = await sha256('x');
  await assert.rejects(
    loadDeploymentPreprocessor({
      ...options,
      fetcher: async (url) =>
        new Response(String(url).endsWith('.json') ? JSON.stringify(manifest(hash)) : 'x'),
      importer: async () => ({
        createPreprocessor: async () => ({
          protocol: 99,
          dispose: async () => {
            await Promise.resolve();
            disposed = true;
          }
        })
      })
    }),
    /Unsupported preprocessor/
  );
  assert.equal(disposed, true);
});
test('stream chunk buffer reuse cannot change already retained verified module bytes', async () => {
  const hash = await sha256('abc');
  let imported = false;
  const fetcher = async (url) => {
    if (String(url).endsWith('.json')) return new Response(JSON.stringify(manifest(hash)));
    const view = new Uint8Array(1);
    let i = 0;
    return new Response(
      new ReadableStream(
        {
          pull(controller) {
            if (i === 3) {
              controller.close();
              return;
            }
            view[0] = 97 + i++;
            controller.enqueue(view);
          }
        },
        { highWaterMark: 0 }
      )
    );
  };
  const result = await loadDeploymentPreprocessor({
    ...options,
    fetcher,
    importer: async () => ({
      createPreprocessor: () => {
        imported = true;
        return {
          protocol: 1,
          id: 'fixture',
          release: 'r1',
          fingerprint: async () => null,
          preprocess: async () => null,
          mount: () => () => {},
          dispose: () => {}
        };
      }
    })
  });
  assert.equal(imported, true);
  assert.equal(result.status, 'ready');
});
