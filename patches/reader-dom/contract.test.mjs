/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../apps/web/package.json'));
const upstream = JSON.parse(await readFile(path.join(here, 'upstream.json'), 'utf8'));
const installedRoot = path.dirname(require.resolve('@expo/dom-webview/package.json'));
const installedPackage = JSON.parse(
  await readFile(path.join(installedRoot, 'package.json'), 'utf8')
);
const patch = path.join(here, 'expo-dom-webview-57.0.1.patch');
const work = await mkdtemp(path.join(tmpdir(), 'reader-dom-contract-'));
const native = 'android/src/main/java/expo/modules/webview';
// Reconstruct only the touched upstream files; accepts a clean or already-patched pnpm install.
for (const file of Object.keys(upstream.files)) {
  await mkdir(path.dirname(path.join(work, file)), { recursive: true });
  await copyFile(path.join(installedRoot, file), path.join(work, file));
}
const installedView = await readFile(path.join(work, native, 'DomWebView.kt'), 'utf8');
if (installedView.includes('var manabiReaderHost: Boolean')) {
  for (const file of [
    `${native}/ReaderDomHost.kt`,
    `${native}/ReaderDomPolicy.java`,
    'android/src/test/java/expo/modules/webview/ReaderDomPolicyTest.kt'
  ]) {
    await mkdir(path.dirname(path.join(work, file)), { recursive: true });
    await copyFile(path.join(installedRoot, file), path.join(work, file));
  }
  execFileSync('git', ['apply', '--reverse', patch], { cwd: work });
}

try {
  await test('patch is limited to exactly reviewed Expo DOM WebView 57.0.1 sources', async () => {
    assert.equal(installedPackage.version, upstream.version);
    for (const [file, hash] of Object.entries(upstream.files)) {
      assert.equal(
        createHash('sha256')
          .update(await readFile(path.join(work, file)))
          .digest('hex'),
        hash,
        file
      );
    }
    execFileSync('git', ['apply', '--check', patch], { cwd: work });
  });
  execFileSync('git', ['apply', patch], { cwd: work });
  const host = await readFile(path.join(work, native, 'ReaderDomHost.kt'), 'utf8');
  const view = await readFile(path.join(work, native, 'DomWebView.kt'), 'utf8');
  await test('execute exact native URL policy on the JVM, including hostile origins and paths', async () => {
    const classes = path.join(work, 'classes');
    await mkdir(classes);
    execFileSync(
      'java',
      [
        '--add-modules=jdk.compiler',
        'com.sun.tools.javac.Main',
        '-d',
        classes,
        path.join(work, native, 'ReaderDomPolicy.java'),
        path.join(here, 'tests/ReaderDomPolicyContractTest.java')
      ],
      { encoding: 'utf8' }
    );
    const output = execFileSync(
      'java',
      ['-cp', classes, 'expo.modules.webview.ReaderDomPolicyContractTest'],
      { encoding: 'utf8' }
    );
    assert.match(output, /\d+ executable assertions passed/);
    process.stdout.write(output);
  });
  await test('native adapter fails closed and never exposes unscoped interfaces or native eval in secure mode', () => {
    for (const required of [
      'allowFileAccess = false',
      'allowContentAccess = false',
      'allowFileAccessFromFileURLs = false',
      'allowUniversalAccessFromFileURLs = false',
      'WebSettings.MIXED_CONTENT_NEVER_ALLOW',
      'domStorageEnabled = true',
      'WebViewFeature.WEB_MESSAGE_LISTENER',
      'WebViewFeature.DOCUMENT_START_SCRIPT',
      'currentPolicy.acceptsMessage(sourceOrigin.toString(), isMainFrame, view.url)',
      'request.isForMainFrame && request.hasGesture() && request.method == "GET" && current.isExternal(url)',
      'assetLoader.shouldInterceptRequest(request.url) ?: errorResponse(404, "Not Found")',
      'if (current.isAssetHost(url) || request.url.host',
      'webView.removeJavascriptInterface("ReactNativeWebView")',
      'webView.removeJavascriptInterface("ExpoDomWebViewBridge")'
    ])
      assert.ok(host.includes(required), required);
    assert.ok(view.includes('if (manabiReaderHost || !useExpoModulesBridge)'));
    assert.ok(view.includes('if (!manabiReaderHost && this@DomWebView.useExpoModulesBridge)'));
    assert.ok(view.includes('if (manabiReaderHost && sourceUri == null) return'));
    assert.ok(!host.includes('addJavascriptInterface('));
    assert.ok(!host.includes('"*"'));
  });
  await test('actual document-start bootstrap creates the Expo shim only in the exact trusted main frame', () => {
    const pathname = '/www.bundle/0123456789abcdef0123456789abcdef.html';
    const initial = JSON.stringify({
      initialProps: { names: ['onReply'], props: { hostile: '"</script>\\n' } }
    });
    const template = host
      .match(/val bootstrap = """([\s\S]*?)"""\.trimIndent\(\)/)[1]
      .replace('${JSONObject.quote(entry.rawPath)}', JSON.stringify(pathname))
      .replace('${JSONObject.quote(entry.rawQuery?.let { "?$it" } ?: "")}', JSON.stringify(''))
      .replace('${JSONObject.quote(injectedObject)}', JSON.stringify(initial));
    const evaluate = ({ child = false, pathname: actualPath = pathname, search = '' } = {}) => {
      const sent = [];
      const window = { ManabiReaderPort: { postMessage: (data) => sent.push(data) } };
      window.top = child ? {} : window;
      vm.runInNewContext(template, { window, location: { pathname: actualPath, search } });
      return { window, sent };
    };
    const { window, sent } = evaluate();
    assert.equal(window.ReactNativeWebView.injectedObjectJson(), initial);
    window.ReactNativeWebView.postMessage('hello');
    window.ReactNativeWebView.postMessage({ bad: true });
    window.ReactNativeWebView.postMessage('x'.repeat(1048577));
    assert.deepEqual(sent, ['hello']);
    assert.equal(Object.getOwnPropertyDescriptor(window, 'ReactNativeWebView').writable, false);
    for (const input of [
      { child: true },
      { pathname: '/www.bundle/other.html' },
      { search: '?other' }
    ]) {
      assert.equal(evaluate(input).window.ReactNativeWebView, undefined);
    }
  });
  await test('SDK 57 exporter preserves the packaged HTML, JS, worker, public and WASM directory topology', async () => {
    const expoRoot = path.dirname(require.resolve('expo/package.json'));
    const expoRequire = createRequire(path.join(expoRoot, 'package.json'));
    const cliRoot = path.dirname(expoRequire.resolve('@expo/cli/package.json'));
    const exporter = await readFile(
      path.join(cliRoot, 'build/src/export/exportDomComponents.js'),
      'utf8'
    );
    const embedder = await readFile(
      path.join(cliRoot, 'build/src/export/embed/exportEmbedAsync.js'),
      'utf8'
    );
    assert.ok(
      exporter.includes('const baseUrl = `/${_DomComponentsMiddleware.DOM_COMPONENTS_BUNDLE_DIR}`')
    );
    assert.ok(exporter.includes("baseUrl: './'"));
    assert.ok(
      embedder.includes(
        '_path().default.join(domComponentProxyOutputDir, _DomComponentsMiddleware.DOM_COMPONENTS_BUNDLE_DIR)'
      )
    );
    assert.ok(embedder.includes('copyPublicFolderAsync'));
    const entry =
      'https://appassets.androidplatform.net/www.bundle/0123456789abcdef0123456789abcdef.html';
    for (const asset of [
      './_expo/static/js/web/worker-123.js',
      './manabitan/revision/worker.mjs',
      './manabitan/revision/sqlite.wasm',
      './manabitan/revision/corresponding-source.tar.gz'
    ]) {
      assert.equal(new URL(asset, entry).pathname, '/www.bundle/' + asset.slice(2));
    }
    assert.ok(host.includes('"wasm" -> "application/wasm"'));
    assert.ok(host.includes('"js", "mjs" -> "text/javascript"'));
  });
} finally {
  await rm(work, { recursive: true, force: true });
}
