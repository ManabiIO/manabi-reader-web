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

async function trashTemporary(directory) {
  await fs.mkdir(path.join(os.homedir(), '.Trash'), { recursive: true });
  const trash = await fs.realpath(path.join(os.homedir(), '.Trash'));
  await fs.rename(directory, path.join(trash, path.basename(directory)));
}

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
  const fontCaches = new Map([['unrelated-user-fonts', new Map()]]);
  const fontFaces = new Set();
  const window = {};
  Object.defineProperty(window, 'ReactNativeWebView', {
    value: { postMessage() {} },
    writable: false,
    configurable: false
  });
  const context = vm.createContext({
    window,
    document: {
      getElementById: () => ({ textContent: '@font-face{src:url("./assets/fixture.woff2")}' }),
      fonts: fontFaces
    },
    FontFace: class {
      constructor(family, source) {
        assert.match(source, /^url\("blob:/);
        this.status = 'unloaded';
      }
      async load() {
        this.status = 'loaded';
        return this;
      }
    },
    caches: {
      async open(key) {
        if (!fontCaches.has(key)) fontCaches.set(key, new Map());
        const cache = fontCaches.get(key);
        return {
          async put(key, value) {
            cache.set(key, value.clone());
          },
          async match(key) {
            return cache.get(key)?.clone();
          }
        };
      },
      async delete(key) {
        return fontCaches.delete(key);
      }
    },
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
      if (String(url).endsWith('/assets/fixture.woff2'))
        return new Response('synthetic harness font bytes');
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
    fontCaches,
    fontFaces,
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
    assert.match(gradle, /androidTestImplementation "junit:junit:4.13.2"/);
    assert.match(
      gradle,
      /testInstrumentationRunner "io.manabi.reader.qualification.PackagedReaderInstrumentation"/
    );
    assert.doesNotMatch(gradle, /androidx\.test:|proguard|keepRules/);
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
    await trashTemporary(android);
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
  assert.equal(seed.cachedFont, 'cached-packaged-face-loaded-via-blob');
  assert.equal(verify.cachedFont, seed.cachedFont);
  assert.equal(fixture.fontFaces.size, 0);
  assert.equal((await fixture.invoke('cleanup')).cleaned, name);
  assert.equal(fixture.directories.has(name), false);
  assert.equal(fixture.fontCaches.has(name), false);
  assert.ok(fixture.fontCaches.has('unrelated-user-fonts'));
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

test('runtime evidence requires an actual native roundtrip in both process phases', () => {
  const base = {
    schema: 1,
    passed: true,
    id,
    target: 'io.manabi.reader',
    targetDebuggable: false,
    nativeRoundTrip: 'snapshot-route-and-library-state-reply',
    nativeFontManager: 'shared-font-list-add-back-and-close-without-save',
    nativeChoices: 'color-mode-selection-local-save-and-restore',
    nativeFontPreferences: 'explicit-font-draft-cancel-apply-and-exact-restore',
    nativeThemeChooser: 'add-dialog-back-and-close-without-save',
    nativeDimensions: 'slider-completion-and-automatic-local-save-with-exact-restore',
    entry: 'https://appassets.androidplatform.net/www.bundle/' + 'a'.repeat(32) + '.html',
    nativeSettings: { webViewVersion: 'fixture-version', fileOriginBypass: false }
  };
  const seed = {
    ...base,
    phase: 'seed',
    initial: {
      secureContext: true,
      cachedFont: 'cached-packaged-face-loaded-via-blob',
      moduleWorker: 'real-packaged-worker-replied-not_open-without-storage-open',
      wasm: 'real-packaged-sqlite-streaming-compile-only',
      webLocks: 'exclusive-contention-and-reacquisition'
    },
    afterReload: {
      indexedDB: 'read-committed-sentinel',
      opfs: 'read-committed-sentinel',
      cachedFont: 'cached-packaged-face-loaded-via-blob'
    },
    navigation: Array.from({ length: 9 }, () => ({ rootRetained: true }))
  };
  const verify = {
    ...base,
    phase: 'verify',
    afterProcessRestart: {
      indexedDB: 'read-committed-sentinel',
      opfs: 'read-committed-sentinel',
      cachedFont: 'cached-packaged-face-loaded-via-blob'
    },
    cleanup: { cleaned: name }
  };
  for (const evidence of [seed, verify]) {
    assert.equal(verifyEvidence(evidence, evidence.phase, id), evidence);
    for (const nativeRoundTrip of [undefined, 'shim-exists', false]) {
      assert.throws(() => verifyEvidence({ ...evidence, nativeRoundTrip }, evidence.phase, id));
    }
    assert.throws(() =>
      verifyEvidence({ ...evidence, targetDebuggable: true }, evidence.phase, id)
    );
    for (const nativeFontManager of [undefined, 'component-imported', false])
      assert.throws(() => verifyEvidence({ ...evidence, nativeFontManager }, evidence.phase, id));
    for (const nativeFontPreferences of [undefined, 'component-mounted', false])
      assert.throws(() =>
        verifyEvidence({ ...evidence, nativeFontPreferences }, evidence.phase, id)
      );
    for (const nativeChoices of [undefined, 'component-mounted', false])
      assert.throws(() => verifyEvidence({ ...evidence, nativeChoices }, evidence.phase, id));
    for (const nativeThemeChooser of [undefined, 'component-mounted', false])
      assert.throws(() => verifyEvidence({ ...evidence, nativeThemeChooser }, evidence.phase, id));
    for (const nativeDimensions of [undefined, 'component-mounted', false])
      assert.throws(() => verifyEvidence({ ...evidence, nativeDimensions }, evidence.phase, id));
    for (const key of evidence.phase === 'seed'
      ? ['initial', 'afterReload']
      : ['afterProcessRestart'])
      assert.throws(() =>
        verifyEvidence(
          { ...evidence, [key]: { ...evidence[key], cachedFont: undefined } },
          evidence.phase,
          id
        )
      );
  }
});

test('the expression injected by Java accepts the formatted probe asset', () => {
  const expression = source.trim().replace(/;$/, '');
  const invoke = vm.runInNewContext(`(${expression})`);
  assert.equal(typeof invoke, 'function');
});

test('platform runner reports success only after the requested qualification completes', async () => {
  // Compile the actual runner against small platform doubles. This checks its
  // failure/argument/result boundary, not Android startup or Reader acceptance.
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'manabi-runner-contract-'));
  try {
    const sources = {
      'android/app/Activity.java': `package android.app;
public class Activity { public static final int RESULT_OK = -1, RESULT_CANCELED = 0; }`,
      'android/os/Bundle.java': `package android.os;
public class Bundle extends java.util.HashMap<String, String> {
  public Bundle() {}
  public Bundle(Bundle other) { super(other); }
  public void putString(String key, String value) { put(key, value); }
  public void putInt(String key, int value) { put(key, Integer.toString(value)); }
  public String getString(String key, String fallback) { return getOrDefault(key, fallback); }
}`,
      'android/app/Instrumentation.java': `package android.app;
import android.os.Bundle;
public class Instrumentation {
  public static final String REPORT_KEY_STREAMRESULT = "stream";
  public int code, finishes; public Bundle result;
  public String statuses = "";
  public void onCreate(Bundle args) {}
  public void onStart() {}
  public void start() { onStart(); }
  public void waitForIdleSync() {}
  public void sendStatus(int code, Bundle status) {
    if (!"1".equals(status.getString("numtests", "")) ||
        !"1".equals(status.getString("current", "")) ||
        !"packagedReaderRuntime".equals(status.getString("test", "")))
      throw new AssertionError("Incomplete test status");
    statuses += code + ",";
  }
  public void finish(int code, Bundle result) {
    this.code = code; this.result = result; finishes++;
  }
}`,
      'android/util/Log.java': `package android.util;
public class Log {
  public static String getStackTraceString(Throwable error) { return error.toString(); }
}`,
      'io/manabi/reader/qualification/PackagedReaderTest.java': `package io.manabi.reader.qualification;
import android.app.Instrumentation;
import android.os.Bundle;
public class PackagedReaderTest {
  public static int calls; public static boolean fail;
  public PackagedReaderTest(Instrumentation runner, Bundle args) {
    if (!"seed".equals(args.getString("qualificationPhase", "")) ||
        !"sentinel-id".equals(args.getString("qualificationId", "")))
      throw new AssertionError("Arguments were not forwarded");
  }
  public void packagedReaderRuntime() {
    calls++;
    if (fail) throw new AssertionError("sentinel failure");
  }
}`,
      'RunnerContract.java': `import android.os.Bundle;
import io.manabi.reader.qualification.*;
public class RunnerContract {
  public static void main(String[] args) {
    check(null, false, true, 1);
    check(PackagedReaderTest.class.getName(), false, true, 1);
    check(PackagedReaderTest.class.getName(), true, false, 1);
    check("unrelated.Test", false, false, 0);
  }
  static void check(String requested, boolean fail, boolean success, int calls) {
    Bundle args = new Bundle();
    args.putString("qualificationPhase", "seed");
    args.putString("qualificationId", "sentinel-id");
    if (requested != null) args.putString("class", requested);
    PackagedReaderTest.calls = 0; PackagedReaderTest.fail = fail;
    PackagedReaderInstrumentation runner = new PackagedReaderInstrumentation();
    runner.onCreate(args);
    String output = runner.result.getString("stream", "");
    String statuses = calls == 0 ? "" : success ? "1,0," : "1,-2,";
    if (runner.finishes != 1 || runner.code != (success ? -1 : 0) ||
        !statuses.equals(runner.statuses) ||
        PackagedReaderTest.calls != calls ||
        output.contains("OK (1 test)") != success ||
        output.contains("FAILURES!!!") == success ||
        (fail && !output.contains("sentinel failure")))
      throw new AssertionError("Invalid instrumentation outcome: " + output);
  }
}`
    };
    const files = [];
    for (const [name, content] of Object.entries(sources)) {
      const file = path.join(temp, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
      files.push(file);
    }
    files.push(new URL('PackagedReaderInstrumentation.java', import.meta.url).pathname);
    execFileSync('javac', ['--release', '21', '-d', temp, ...files], { encoding: 'utf8' });
    execFileSync('java', ['-cp', temp, 'RunnerContract'], { encoding: 'utf8' });
  } finally {
    await trashTemporary(temp);
  }
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
        new URL('PackagedReaderTest.java', import.meta.url).pathname,
        new URL('PackagedReaderInstrumentation.java', import.meta.url).pathname
      ],
      { encoding: 'utf8' }
    );
  } finally {
    await trashTemporary(temp);
  }
});
