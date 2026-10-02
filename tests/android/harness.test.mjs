/** @license BSD-3-Clause */
// These are harness unit tests, not evidence of an Android or WebView run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { webcrypto, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { prepareAndroidQualification } from '../../scripts/prepare-android-qualification.mjs';
import { readEvidence, verifyEvidence } from './verify-evidence.mjs';

const revision = '4db879b7b5bcb749f90042a313669526ef2f57f4';
const id = 'abcdef0123456789abcdef0123456789';
const name = `manabi-android-qualification-${id}`;
const source = await fs.readFile(new URL('probe.js', import.meta.url), 'utf8');

function harness({ workerReply = 'not_open', secure = true } = {}) {
  const directories = new Map([['unrelated-user-data', new Map([['keep', 'untouched']])]]);
  const directory = (files) => ({
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name) && !create) throw new DOMException('Missing', 'NotFoundError');
      if (!files.has(name)) files.set(name, '');
      return {
        async createWritable() {
          return {
            async write(value) {
              files.set(name, value);
            },
            async close() {}
          };
        },
        async getFile() {
          return {
            async text() {
              return files.get(name);
            }
          };
        }
      };
    }
  });
  const root = {
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!directories.has(name) && !create) throw new DOMException('Missing', 'NotFoundError');
      if (!directories.has(name)) directories.set(name, new Map());
      return directory(directories.get(name));
    },
    async removeEntry(name) {
      if (!directories.delete(name)) throw new DOMException('Missing', 'NotFoundError');
    }
  };
  let locked = false;
  const locks = {
    async request(key, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      if (locked && options.ifAvailable) return callback(null);
      assert.equal(locked, false);
      locked = true;
      try {
        return await callback({ name: key });
      } finally {
        locked = false;
      }
    }
  };
  const workerBytes = Buffer.from('/* Synthetic harness-only worker */');
  const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const entry = (name, bytes) => ({
    path: name,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
  const manifest = {
    revision,
    apiVersion: 1,
    assets: [entry('web/worker.js', workerBytes), entry('lib/sqlite/sqlite3.wasm', wasmBytes)]
  };
  const calls = [];
  const window = {};
  Object.defineProperty(window, 'ReactNativeWebView', {
    value: { postMessage() {} },
    writable: false,
    configurable: false
  });
  const context = vm.createContext({
    window,
    indexedDB: new IDBFactory(),
    DOMException,
    navigator: {
      storage: {
        async getDirectory() {
          return root;
        }
      },
      locks,
      userAgent: 'harness-unit-test'
    },
    isSecureContext: secure,
    location: {
      origin: 'https://appassets.androidplatform.net',
      pathname: '/www.bundle/00000000000000000000000000000000.html',
      href: 'https://appassets.androidplatform.net/www.bundle/00000000000000000000000000000000.html'
    },
    URL,
    WebAssembly,
    crypto: webcrypto,
    Uint8Array,
    setTimeout,
    clearTimeout,
    Worker: class {
      constructor(url, options) {
        assert.equal(options.type, 'module');
        calls.push(String(url));
      }
      postMessage(value) {
        assert.deepEqual(JSON.parse(JSON.stringify(value)), {
          version: 1,
          id: 1,
          operation: 'status',
          parameters: {}
        });
        queueMicrotask(() =>
          this.onmessage({ data: { version: 1, id: 1, error: { code: workerReply } } })
        );
      }
      terminate() {
        calls.push('terminate');
      }
    },
    async fetch(url) {
      calls.push(String(url));
      if (String(url).endsWith('/manifest.json')) return Response.json(manifest);
      if (String(url).endsWith('/web/worker.js'))
        return new Response(workerBytes, { headers: { 'content-type': 'text/javascript' } });
      if (String(url).endsWith('/lib/sqlite/sqlite3.wasm'))
        return new Response(wasmBytes, { headers: { 'content-type': 'application/wasm' } });
      return new Response('Not Found', { status: 404 });
    }
  });
  return {
    invoke: (operation) =>
      vm.runInContext(source, context)({ id, dictionaryRevision: revision, operation }),
    directories,
    calls
  };
}

test('prepare is idempotent and confines additions to the generated test project', async () => {
  const android = await fs.mkdtemp(path.join(os.tmpdir(), 'manabi-android-harness-'));
  try {
    await fs.mkdir(path.join(android, 'app'));
    await fs.writeFile(
      path.join(android, 'app/build.gradle'),
      'android { defaultConfig { applicationId "io.manabi.reader" } }\n'
    );
    await prepareAndroidQualification({ androidDirectory: android });
    const first = await fs.readFile(path.join(android, 'app/build.gradle'), 'utf8');
    await prepareAndroidQualification({ androidDirectory: android });
    assert.equal(await fs.readFile(path.join(android, 'app/build.gradle'), 'utf8'), first);
    const gradle = await fs.readFile(path.join(android, 'app/reader-qualification.gradle'), 'utf8');
    assert.match(gradle, /testBuildType "release"/);
    assert.match(gradle, /androidTestImplementation "androidx.test:runner:1.7.0"/);
    assert.doesNotMatch(gradle, /^\s*(?:debuggable|signingConfig|buildTypes|implementation\()/m);
    assert.deepEqual(await fs.readdir(path.join(android, 'app/src')), ['androidTest']);
    await fs.writeFile(
      path.join(android, 'app/build.gradle'),
      'android { defaultConfig { applicationId "other.application" } }'
    );
    await assert.rejects(
      prepareAndroidQualification({ androidDirectory: android }),
      /Expected the generated/
    );
    await fs.writeFile(
      path.join(android, 'app/build.gradle'),
      'android { defaultConfig { applicationId "io.manabi.reader" } testBuildType "debug" }'
    );
    await assert.rejects(
      prepareAndroidQualification({ androidDirectory: android }),
      /different instrumentation build type/
    );
  } finally {
    await fs.rm(android, { recursive: true, force: true });
  }
});

test('probe really writes/reads its synthetic namespace and cleans only that namespace', async () => {
  const fixture = harness();
  await assert.rejects(fixture.invoke('verify'));
  const seed = await fixture.invoke('seed');
  assert.equal(seed.webLocks, 'exclusive-contention-and-reacquisition');
  assert.equal(seed.moduleWorker, 'real-packaged-worker-replied-not_open-without-storage-open');
  assert.equal(seed.wasm, 'real-packaged-sqlite-streaming-compile-only');
  assert.ok(fixture.directories.has(name));
  const verify = await fixture.invoke('verify');
  assert.equal(verify.opfs, 'read-committed-sentinel');
  assert.equal((await fixture.invoke('cleanup')).cleaned, name);
  assert.equal(fixture.directories.has(name), false);
  assert.equal(fixture.directories.get('unrelated-user-data').get('keep'), 'untouched');
  await assert.rejects(fixture.invoke('verify'));
});

test('probe fails closed for insecure context and a worker that did not execute the expected protocol', async () => {
  await assert.rejects(harness({ secure: false }).invoke('seed'), /secure context/);
  const fixture = harness({ workerReply: 'different_error' });
  await assert.rejects(fixture.invoke('seed'), /Unexpected packaged worker response/);
  assert.ok(fixture.calls.includes('terminate'));
  await fixture.invoke('cleanup');
});

test('instrumentation evidence parser rejects absent, duplicated, failed or incomplete evidence', () => {
  assert.throws(() => readEvidence('OK (1 test)'), /Expected one/);
  assert.throws(
    () => readEvidence('MANABI_ANDROID_QUALIFICATION={}\nMANABI_ANDROID_QUALIFICATION={}'),
    /Expected one/
  );
  assert.throws(
    () => verifyEvidence({ schema: 1, passed: false }, 'seed', id),
    /Instrumentation failed/
  );
  assert.throws(() => verifyEvidence({ schema: 1, passed: true, phase: 'seed', id }, 'seed', id));
  assert.deepEqual(
    readEvidence('INSTRUMENTATION_STATUS: stream=\nMANABI_ANDROID_QUALIFICATION={"passed":true}\n'),
    { passed: true }
  );
});

test('the expression injected by Java accepts the formatted probe asset', () => {
  const expression = source.trim().replace(/;$/, '');
  const invoke = vm.runInNewContext(`(${expression})`);
  assert.equal(typeof invoke, 'function');
});

test('instrumentation Java parses with JDK 21 (syntax only, not Android compilation)', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'manabi-java-syntax-'));
  try {
    const parser = path.join(temp, 'ParseJava.java');
    await fs.writeFile(
      parser,
      `import javax.tools.*;
import com.sun.source.util.JavacTask;
import java.util.List;
class ParseJava { public static void main(String[] args) throws Exception {
  JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
  DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
  try (StandardJavaFileManager files = compiler.getStandardFileManager(diagnostics, null, null)) {
    JavacTask task = (JavacTask) compiler.getTask(null, files, diagnostics,
      List.of("-proc:none"), null, files.getJavaFileObjects(args));
    task.parse();
    for (Diagnostic<?> d : diagnostics.getDiagnostics())
      if (d.getKind() == Diagnostic.Kind.ERROR) throw new AssertionError(d.toString());
  }
}}`
    );
    execFileSync(
      'java',
      [
        '--add-modules=jdk.compiler',
        parser,
        new URL('PackagedReaderTest.java', import.meta.url).pathname
      ],
      { encoding: 'utf8' }
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
