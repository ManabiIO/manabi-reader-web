/* SPDX-License-Identifier: BSD-3-Clause */
// Evaluated only by Android instrumentation, from the separate test APK.
// No app bridge commands, real books/accounts, or production dictionary stores.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The test APK evaluates this function value, then invokes it with owned fixture configuration.
(async function qualifyPackagedReader(config) {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  assert(/^[a-f0-9]{32}$/.test(config.id), 'Invalid test-owned storage identifier');
  assert(/^[a-f0-9]{40}$/.test(config.dictionaryRevision), 'Invalid dictionary revision');
  assert(['seed', 'verify', 'cleanup'].includes(config.operation), 'Invalid probe operation');
  const name = `manabi-android-qualification-${config.id}`;
  const sentinel = `synthetic:${config.id}`;
  const report = { operation: config.operation, origin: location.origin, href: location.href };
  let database;
  const request = (value) =>
    new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(value.error || new Error('IndexedDB request failed'));
      value.onblocked = () => reject(new Error('Test-owned IndexedDB request was blocked'));
    });
  const open = async (create) => {
    const pending = indexedDB.open(name, 1);
    pending.onupgradeneeded = () => {
      if (!create) {
        pending.transaction.abort();
        return;
      }
      pending.result.createObjectStore('sentinel');
    };
    database = await request(pending);
    return database;
  };
  const transaction = (mode, operation) =>
    new Promise((resolve, reject) => {
      const tx = database.transaction('sentinel', mode);
      let result;
      const value = operation(tx.objectStore('sentinel'));
      value.onsuccess = () => {
        result = value.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    });
  const timeout = (promise, label, ms = 30000) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      })
    ]).finally(() => clearTimeout(timer));
  };
  const removeOwnedData = async () => {
    database?.close();
    database = undefined;
    await request(indexedDB.deleteDatabase(name));
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
    }
    report.cleaned = name;
  };
  try {
    if (config.operation === 'cleanup') {
      await removeOwnedData();
      return report;
    }
    assert(
      location.origin === 'https://appassets.androidplatform.net',
      'Reader origin is not canonical'
    );
    assert(
      /^\/www\.bundle\/[a-f0-9]{32}\.html$/.test(location.pathname),
      'Reader is not the packaged DOM entry'
    );
    assert(isSecureContext, 'Reader is not a secure context');
    assert(typeof indexedDB?.open === 'function', 'IndexedDB unavailable');
    assert(typeof navigator.storage?.getDirectory === 'function', 'OPFS unavailable');
    assert(typeof navigator.locks?.request === 'function', 'Web Locks unavailable');
    assert(
      typeof window.ReactNativeWebView?.postMessage === 'function',
      'Expo DOM message bootstrap unavailable'
    );
    const bridge = Object.getOwnPropertyDescriptor(window, 'ReactNativeWebView');
    assert(
      bridge && bridge.writable === false && bridge.configurable === false,
      'Unscoped/mutable native bridge'
    );
    assert(typeof window.ExpoDomWebViewBridge === 'undefined', 'Native evaluation bridge exposed');
    report.secureContext = true;
    report.userAgent = navigator.userAgent;
    const root = await navigator.storage.getDirectory();
    await open(config.operation === 'seed');
    if (config.operation === 'seed') {
      // Only this run's random namespace can be created or removed.
      await transaction('readwrite', (store) => store.put(sentinel, 'value'));
      const dir = await root.getDirectoryHandle(name, { create: true });
      const file = await dir.getFileHandle('sentinel.txt', { create: true });
      const writer = await file.createWritable();
      await writer.write(sentinel);
      await writer.close();
    }
    assert(
      (await transaction('readonly', (store) => store.get('value'))) === sentinel,
      'IndexedDB sentinel mismatch'
    );
    const dir = await root.getDirectoryHandle(name);
    const file = await (await dir.getFileHandle('sentinel.txt')).getFile();
    assert((await file.text()) === sentinel, 'OPFS sentinel mismatch');
    report.indexedDB = 'read-committed-sentinel';
    report.opfs = 'read-committed-sentinel';
    if (config.operation === 'verify') return report;

    let release;
    let entered;
    const acquired = new Promise((resolve) => {
      entered = resolve;
    });
    const held = navigator.locks.request(name, async () => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
    });
    await timeout(acquired, 'Web Lock acquisition');
    try {
      const contended = await navigator.locks.request(
        name,
        { ifAvailable: true },
        (lock) => lock === null
      );
      assert(contended, 'Second exclusive lock was granted while the first was held');
    } finally {
      release();
      await held;
    }
    await navigator.locks.request(name, (lock) =>
      assert(lock !== null, 'Released lock could not be acquired')
    );
    report.webLocks = 'exclusive-contention-and-reacquisition';

    const local = new URL(`./manabitan/${config.dictionaryRevision}/`, location.href);
    const manifestResponse = await fetch(new URL('manifest.json', local));
    assert(manifestResponse.status === 200, 'Packaged dictionary manifest did not load');
    const manifest = await manifestResponse.json();
    assert(
      manifest.revision === config.dictionaryRevision && manifest.apiVersion === 1,
      'Dictionary manifest mismatch'
    );
    const digest = async (bytes) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
    const packagedAsset = async (relative, mime) => {
      const entry = manifest.assets.find((item) => item.path === relative);
      assert(
        entry && /^[a-f0-9]{64}$/.test(entry.sha256),
        `Asset absent from pinned manifest: ${relative}`
      );
      const response = await fetch(new URL(relative, local));
      assert(response.status === 200, `Asset did not load: ${relative}`);
      assert(
        response.headers.get('content-type')?.split(';')[0] === mime,
        `Wrong asset MIME: ${relative}`
      );
      const bytes = await response.clone().arrayBuffer();
      assert(
        bytes.byteLength === entry.bytes && (await digest(bytes)) === entry.sha256,
        `Packaged asset bytes differ: ${relative}`
      );
      return response;
    };
    await packagedAsset('web/worker.js', 'text/javascript');
    const worker = new Worker(new URL('web/worker.js', local), { type: 'module', name });
    try {
      const reply = await timeout(
        new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = (event) =>
            reject(new Error(`Packaged module worker failed: ${event.message}`));
          worker.onmessageerror = () =>
            reject(new Error('Packaged worker returned unreadable data'));
          // This deliberately does not open the dictionary or touch its storage.
          worker.postMessage({ version: 1, id: 1, operation: 'status', parameters: {} });
        }),
        'Packaged dictionary module worker'
      );
      assert(
        reply?.version === 1 && reply.id === 1 && reply.error?.code === 'not_open',
        'Unexpected packaged worker response'
      );
      report.moduleWorker = 'real-packaged-worker-replied-not_open-without-storage-open';
    } finally {
      worker.terminate();
    }
    const wasmResponse = await packagedAsset('lib/sqlite/sqlite3.wasm', 'application/wasm');
    const module = await timeout(
      WebAssembly.compileStreaming(Promise.resolve(wasmResponse)),
      'SQLite WASM compilation',
      60000
    );
    assert(module instanceof WebAssembly.Module, 'SQLite WASM did not compile');
    report.wasm = 'real-packaged-sqlite-streaming-compile-only';

    const missing = await fetch(new URL(`./${name}-missing.wasm`, location.href));
    assert(missing.status === 404, 'Missing APK asset did not fail locally with 404');
    const escaped = await fetch(`${location.origin}/www.bundle/%252e%252e/AndroidManifest.xml`);
    assert(escaped.status === 404, 'Encoded traversal was not rejected');
    const outside = await fetch(`${location.origin}/AndroidManifest.xml`);
    assert(outside.status === 404, 'Loader exposed assets outside www.bundle');
    report.assetRejections = ['missing-404', 'encoded-traversal-404', 'outside-prefix-404'];
    return report;
  } finally {
    database?.close();
  }
});
