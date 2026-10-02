/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyExport, inspectJavaScript, ROUTES } from '../../scripts/verify-expo-export.mjs';
import { readerContentSecurityPolicy } from '../../apps/web/src/platform/content-security-policy.mjs';
import { registerReaderServiceWorker, isShellAsset, isRequiredPublicShellAsset, isPackagedFont } from '../../apps/web/src/lib/service-worker/reader-service-worker.mjs';
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const appRequire = createRequire(path.join(root, 'apps/web/package.json'));
const expoPackage = appRequire.resolve('expo/package.json');
const require = createRequire(expoPackage);
const cli = path.dirname(require.resolve('@expo/cli/package.json'));
const exporter = require(path.join(cli, 'build/src/export/exportDomComponents.js'));
const { createMetadataJson } = require(path.join(cli, 'build/src/export/createMetadataJson.js'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const revision = 'a'.repeat(40);
const workerNames = ['reader-search-worker', 'library-content-search-worker', 'search-worker', 'voice-pitch.worker'];
async function put(dir, name, content) { await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await fs.writeFile(path.join(dir, name), content); }
function workerCall(name, index, prefix) {
  return `__d(function(g,r,i,a,m,e,d){new (r(d[0]).unstable_createWorker)(new URL(r(d[0]).unstable_resolve(d[1],d.paths),location.href),{type:"module"});},${index},{0:99,1:${index + 100},paths:{${index + 100}:${JSON.stringify(`${prefix}_expo/static/js/web/${name}-0123456789abcdef.js`)}}});`;
}
async function fixture(t, platform = 'web', media = false) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'expo-export-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app'), output = path.join(directory, 'output');
  const publicDir = path.join(app, 'static');
  await put(app, 'package.json', '{"type":"module"}');
  await put(app, 'src/lib/search/manabitan-version.json', JSON.stringify({ repository: 'ManabiIO/manabitan', revision }));
  await put(app, 'src/runtime/font-assets.ts', "import font from '../lib/assets/fonts/TestFont.woff2';");
  const assets = [['TestFont.woff2', 'font bytes'], ['swift-f0-0.3.0.onnx', 'model bytes'], ['ort-wasm-simd-threaded.wasm', '\0asm\x01\0\0\0']];
  await put(app, 'src/lib/assets/fonts/TestFont.woff2', assets[0][1]);
  await put(app, 'src/lib/features/whispersync/pitch/swift-f0-0.3.0.onnx', assets[1][1]);
  await put(app, 'node_modules/onnxruntime-web/package.json', '{"name":"onnxruntime-web"}');
  await put(app, `node_modules/onnxruntime-web/${assets[2][0]}`, assets[2][1]);
  await put(publicDir, 'appearance-init.js', 'void 0;');
  await put(publicDir, 'manifest.webmanifest', '{"start_url":"./"}');
  await put(publicDir, 'legal/Klee-One-OFL.txt', 'license');
  const dict = `manabitan/${revision}/`;
  const dictFiles = { 'web/client.js': 'export class Client { constructor(){new Worker(new URL("worker.js",import.meta.url),{type:"module"});} }', 'web/render.js': 'export const render=1;', 'web/presets.js': 'export const presets=1;', 'web/worker.js': 'self.onmessage=()=>{};', 'lib/sqlite/sqlite3.wasm': '\0asm\x01\0\0\0', 'css/structured-content.css': '.dictionary{}', 'data/recommended-dictionaries.json': '{"ja":{}}', LICENSE: 'GPL license' };
  for (const [name, bytes] of Object.entries(dictFiles)) await put(publicDir, dict + name, bytes);
  await put(publicDir, dict + 'SOURCE.txt', 'Corresponding source and build instructions');
  const source = path.join(directory, 'source');
  for (const name of ['web/build.mjs', 'package.json', 'LICENSE']) await put(source, name, 'source');
  execFileSync('tar', ['-czf', path.join(publicDir, dict, 'corresponding-source.tar.gz'), '-C', source, 'web/build.mjs', 'package.json', 'LICENSE']);
  const archive = 'dictionary bytes'; await put(publicDir, 'dictionary-archives/default.zip', archive);
  await put(publicDir, dict + 'manifest.json', JSON.stringify({ revision, apiVersion: 1, searchVersion: 1, assets: Object.entries(dictFiles).map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })), defaultDictionary: { fileName: 'default.zip', bytes: Buffer.byteLength(archive), sha256: sha(archive) } }));
  for (const mode of ['single', 'threaded']) {
    const entries = { 'moss.mjs': 'export default 1;', 'moss.wasm': '\0asm\x01\0\0\0', 'LICENSE-MOSS.txt': 'license', 'LICENSE-GGML.txt': 'license' };
    for (const [name, bytes] of Object.entries(entries)) await put(publicDir, `moss/${mode}/${name}`, bytes);
    await put(publicDir, `moss/${mode}/build.json`, JSON.stringify({ version: 1, mode, files: Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, sha(bytes)])) }));
  }
  const browserRoot = platform === 'apk' ? 'assets/www.bundle/' : platform === 'android' ? 'www.bundle/' : '';
  await fs.mkdir(output, { recursive: true });
  await fs.cp(publicDir, path.join(output, platform === 'apk' ? browserRoot : ''), { recursive: true, filter: source => media || !source.startsWith(path.join(publicDir, 'moss')) });
  const prefix = platform === 'web' ? '/reader-web/' : './';
  const names = [...workerNames, ...(media ? ['moss-worker'] : [])];
  const entry = names.map((name, index) => workerCall(name, index, prefix)).join('\n') + assets.map(([name], index) => `var a${index}=${JSON.stringify(platform === 'android' ? md5(assets[index][1]) + path.extname(name) : `${prefix}assets/${name}`)};`).join('\n');
  const artifact = (filename, source, type = 'js', isAsync = false) => ({ filename, source, type, metadata: { isAsync } });
  const bundle = { artifacts: [artifact('_expo/static/js/web/entry-fixture.js', entry), artifact('_expo/static/css/web/app-fixture.css', 'body{color:black}', 'css'), ...names.map((name, index) => artifact(`_expo/static/js/web/${name}-0123456789abcdef.js`, `__d(function(){self.onmessage=function(){self.postMessage(${JSON.stringify(name)});};},${index + 100},[]);__r(${index + 100});`, 'js', true))], assets: [] };
  if (platform === 'web') {
    for (const item of bundle.artifacts) await put(output, item.filename, item.source);
    const bootstrap = 'window.fixture=1;';
    const csp = readerContentSecurityPolicy([`sha256-${createHash('sha256').update(bootstrap).digest('base64')}`]);
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="/reader-web/_expo/static/css/web/app-fixture.css"></head><body><script>${bootstrap}</script><script src="/reader-web/_expo/static/js/web/entry-fixture.js"></script></body></html>`;
    for (const name of ['index.html', '404.html', ...ROUTES.filter(Boolean).map(route => `${route}.html`)]) await put(output, name, html);
  } else {
    const files = new Map();
    const result = await exporter.exportDomComponentAsync({ filePath: path.join(root, 'apps/web/src/platform/reader-runtime.dom.tsx'), projectRoot: path.join(root, 'apps/web'), dev: false, isHermes: true, includeSourceMaps: false, exp: {}, files, useMd5Filename: platform === 'android', devServer: { legacySinglePageExportBundleAsync: async options => { assert.equal(options.baseUrl, './'); assert.equal(options.platform, 'web'); assert.equal(options.bytecode, false); return bundle; } } });
    if (platform === 'android') {
      const metadata = await exporter.addDomBundleToMetadataAsync(bundle);
      metadata.push(...exporter.transformDomEntryForMd5Filename({ files, htmlOutputName: result.htmlOutputName }));
      const assetMetadata = assets.map(([name, bytes]) => ({ hash: md5(bytes), fileHashes: [md5(bytes)], type: path.extname(name).slice(1) }));
      await put(output, 'metadata.json', JSON.stringify(createMetadataJson({ bundles: { android: { assets: assetMetadata } }, fileNames: { android: ['_expo/static/js/android/index.hbc'] }, domComponentAssetsMetadata: { android: metadata } })));
      await put(output, '_expo/static/js/android/index.hbc', 'Hermes bytes ' + metadata.filter(item => item.ext === 'html').map(item => path.basename(item.path)).join(' '));
    } else {
      await put(output, 'AndroidManifest.xml', 'binary manifest'); await put(output, 'classes.dex', 'dex bytes'); await put(output, 'assets/index.android.bundle', 'Hermes bytes ' + path.basename(result.htmlOutputName));
    }
    for (const [name, item] of files) await put(output, (platform === 'apk' ? 'assets/' : '') + name.replace(/^\//, ''), item.contents);
  }
  for (const [name, bytes] of assets) await put(output, platform === 'android' ? `assets/${md5(bytes)}` : `${browserRoot}assets/${name}`, bytes);
  if (platform === 'web') {
    const list = async (directory, prefix = '') => (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(async entry => entry.isDirectory() ? list(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]))).flat();
    const paths = await list(output), urls = paths.map(name => `/reader-web/${name}`);
    const config = { build: urls.filter(url => /\/(?:_expo|assets)\//.test(url)), files: urls.filter(url => !/\/(?:_expo|assets)\//.test(url)), prerendered: ROUTES.map(route => `/reader-web/${route}`), lazyAssets: urls.filter(url => /voice-pitch|swift-f0|ort-wasm/.test(url)), version: 'fixture', userFontsCacheName: 'ttu-userfonts' };
    await put(output, 'expo-build-manifest.json', JSON.stringify({ base: '/reader-web', routes: ROUTES, config }));
    await put(output, 'service-worker.js', `${isShellAsset.toString()}\n${isRequiredPublicShellAsset.toString()}\n${isPackagedFont.toString()}\n${registerReaderServiceWorker.toString()}\nregisterReaderServiceWorker(self,${JSON.stringify(config)});`);
  }
  return { directory, app, output, platform, media };
}

test('reads the real SDK 57 worker dependency-map topology', () => {
  const found = inspectJavaScript(workerCall('reader-search-worker', 0, './'));
  assert.deepEqual(found.workers, [{ reference: './_expo/static/js/web/reader-search-worker-0123456789abcdef.js', module: true, moduleId: 100 }]);
});
for (const platform of ['web', 'android', 'apk']) test(`${platform} fixture passes only its own artifact gate`, async t => {
  const options = await fixture(t, platform); const report = await verifyExport(options);
  assert.deepEqual(report.errors, []); assert.equal(report.passed, true); assert.equal(report.evidence.moduleWorkers.length, 4);
  if (platform === 'android') { assert.match(report.readiness, /not APK readiness/); assert.ok(report.warnings.some(warning => warning.includes('Unresolved local module worker'))); }
  if (platform === 'apk') {
    const zip = path.join(options.directory, 'release.apk'); execFileSync('zip', ['-qr', zip, '.'], { cwd: options.output });
    const packaged = await verifyExport({ ...options, output: zip }); assert.deepEqual(packaged.errors, []);
  }
});
test('missing exported worker fails even when its source/import exists', async t => {
  const options = await fixture(t); await fs.unlink(path.join(options.output, '_expo/static/js/web/reader-search-worker-0123456789abcdef.js'));
  assert.ok((await verifyExport(options)).errors.some(error => /Unresolved local module worker/.test(error)));
});
test('rejects stale exported font bytes', async t => {
  const options = await fixture(t); await put(options.output, 'assets/TestFont.woff2', 'wrong font');
  assert.ok((await verifyExport(options)).errors.some(error => /Expected asset bytes.*TestFont/.test(error)));
});
test('APK requires public files inside assets/www.bundle, not at archive root', async t => {
  const options = await fixture(t, 'apk'); await fs.rename(path.join(options.output, 'assets/www.bundle/manabitan'), path.join(options.output, 'manabitan'));
  assert.ok((await verifyExport(options)).errors.some(error => /Missing or empty artifact: assets\/www.bundle\/manabitan/.test(error)));
});
test('rejects CSP bootstrap mismatch and wrong-base generated asset URLs', async t => {
  const options = await fixture(t); const file = path.join(options.output, 'index.html');
  await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('window.fixture=1;', 'window.fixture=2;').replace('src="/reader-web/', 'src="/'));
  const report = await verifyExport(options);
  assert.ok(report.errors.some(error => /CSP does not authorize/.test(error))); assert.ok(report.errors.some(error => /Unresolved local index.html script/.test(error)));
});
test('checks generated service worker behavior instead of trusting manifest declarations', async t => {
  const options = await fixture(t); const file = path.join(options.output, 'service-worker.js');
  await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace(/"lazyAssets":\[[^\]]*\]/, '"lazyAssets":[]'));
  assert.ok((await verifyExport(options)).errors.some(error => /Lazy payload is eagerly precached:.*voice-pitch/.test(error)));
});
test('media-on includes and verifies both MOSS variants and worker', async t => {
  const options = await fixture(t, 'web', true); assert.deepEqual((await verifyExport(options)).errors, []);
  await put(options.output, 'moss/threaded/moss.wasm', 'bad'); assert.ok((await verifyExport(options)).errors.some(error => /MOSS threaded checksum/.test(error)));
});
test('media assets cannot silently leak into default-off builds', async t => {
  const options = await fixture(t); await put(options.output, 'moss/single/moss.wasm', 'unexpected');
  assert.ok((await verifyExport(options)).errors.some(error => /Default-off media/.test(error)));
});
test('Android update metadata cannot substitute for an APK', async t => {
  const options = await fixture(t, 'android'); const result = await verifyExport({ ...options, platform: 'apk' });
  assert.equal(result.passed, false); assert.ok(result.errors.some(error => /assets\/index.android.bundle/.test(error)));
});
test('actual installed exporter retains the expected update versus embedded topology', async () => {
  assert.equal(JSON.parse(await fs.readFile(expoPackage)).version, '57.0.26');
  const embed = await fs.readFile(path.join(cli, 'build/src/export/embed/exportEmbedAsync.js'), 'utf8');
  assert.match(embed, /options\.platform === 'android' \? _path\(\)\.default\.dirname\(options\.bundleOutput\)/);
  assert.match(embed, /copyPublicFolderAsync[\s\S]*domComponentProxyOutputDir, _DomComponentsMiddleware\.DOM_COMPONENTS_BUNDLE_DIR/);
  assert.match(embed, /httpServerLocation: _path\(\)\.default\.join\(_DomComponentsMiddleware\.DOM_COMPONENTS_BUNDLE_DIR, asset\.httpServerLocation\)/);
});

test('orphan worker-call chunks cannot satisfy reachable application dependencies', async t => {
  const options = await fixture(t);
  const entry = await fs.readFile(path.join(options.output, '_expo/static/js/web/entry-fixture.js'), 'utf8');
  await put(options.output, '_expo/static/js/web/orphan-fixture.js', entry);
  await put(options.output, '_expo/static/js/web/entry-fixture.js', 'void 0;');
  assert.ok((await verifyExport(options)).errors.some(error => /Missing emitted module-worker call/.test(error)));
});
test('broken public dictionary module imports are detected in emitted JS', async t => {
  const options = await fixture(t);
  await put(options.output, `manabitan/${revision}/web/render.js`, 'import "./missing.js";');
  assert.ok((await verifyExport(options)).errors.some(error => /Unresolved public dictionary module URL.*missing.js/.test(error)));
});

test('Android MD5 update inventory must contain standalone worker entry modules', async t => {
  const options = await fixture(t, 'android');
  const metadata = JSON.parse(await fs.readFile(path.join(options.output, 'metadata.json'), 'utf8'));
  for (const item of metadata.fileMetadata.android.assets) {
    if (item.ext !== 'js') continue;
    const source = await fs.readFile(path.join(options.output, item.path), 'utf8');
    if (!source.includes('__r(100)')) continue;
    await fs.unlink(path.join(options.output, item.path));
    metadata.fileMetadata.android.assets = metadata.fileMetadata.android.assets.filter(other => other.path !== item.path);
    break;
  }
  await put(options.output, 'metadata.json', JSON.stringify(metadata));
  assert.ok((await verifyExport(options)).errors.some(error => /No emitted standalone worker starts module 100/.test(error)));
});
