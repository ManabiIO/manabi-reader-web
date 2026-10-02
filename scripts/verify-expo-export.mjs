/** @license BSD-3-Clause */
// This gate reads build products. Source manifests supply expected hashes, never proof of export.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// Resolve declared dependency edges, including under strict pnpm's non-hoisted layout.
const projectRequire = createRequire(path.join(root, 'apps/web/package.json'));
const expoRequire = createRequire(projectRequire.resolve('expo/package.json'));
const metroRequire = createRequire(expoRequire.resolve('@expo/metro-config/package.json'));
const babelRequire = createRequire(metroRequire.resolve('@babel/core/package.json'));
const { parse } = babelRequire('@babel/parser');
export const ROUTES = ['', 'manage', 'b', 'settings', 'connections', 'statistics', 'snippets', 'shared-library', 'import-ttu', 'auth', 'videos'];
const WORKERS = ['reader-search-worker', 'library-content-search-worker', 'search-worker', 'voice-pitch.worker'];
const ORIGIN = 'https://appassets.androidplatform.net';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.');
async function hashFile(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function inventory(directory, prefix = '') {
  const files = new Map();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not a packaged artifact: ${name}`);
    if (entry.isDirectory()) for (const [key, value] of await inventory(path.join(directory, entry.name), `${name}/`)) files.set(key, value);
    else if (entry.isFile()) files.set(name, { path: path.join(directory, entry.name), bytes: (await fs.stat(path.join(directory, entry.name))).size });
  }
  return files;
}
function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) visit(child, callback); return; }
  if (node.type) callback(node);
  for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens', 'extra'].includes(key)) visit(child, callback);
}
const value = node => node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' ? node.value : undefined;
const member = node => node?.type === 'MemberExpression' ? node.property.name ?? value(node.property) : undefined;
const properties = node => new Map((node?.properties ?? []).filter(p => p.type === 'ObjectProperty').map(p => [p.key.name ?? value(p.key), p.value]));
/** Read actual minified Metro __d dependency maps, including SDK 57's worker transform. */
export function inspectJavaScript(code) {
  const ast = parse(code, { sourceType: 'unambiguous', allowReturnOutsideFunction: true });
  const strings = new Set(), workers = [], moduleReferences = [], publicWorkers = [], entryModules = new Set();
  visit(ast, node => {
    if (node.type === 'StringLiteral') strings.add(node.value);
    if (node.type === 'CallExpression' && node.callee.name === '__r' && value(node.arguments[0]) !== undefined) entryModules.add(value(node.arguments[0]));
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) moduleReferences.push(node.source.value);
    if (node.type === 'CallExpression' && node.callee.type === 'Import' && typeof value(node.arguments[0]) === 'string') moduleReferences.push(value(node.arguments[0]));
    if (node.type === 'NewExpression' && node.callee.name === 'URL' && typeof value(node.arguments[0]) === 'string' && member(node.arguments[1]) === 'url' && node.arguments[1].object.type === 'MetaProperty' && /\.(?:m?js|wasm|onnx|json|css)(?:[?#]|$)/.test(value(node.arguments[0]))) moduleReferences.push(value(node.arguments[0]));
    if (node.type === 'NewExpression' && node.callee.name === 'Worker' && node.arguments[0]?.callee?.name === 'URL' && typeof value(node.arguments[0].arguments[0]) === 'string') publicWorkers.push({ reference: value(node.arguments[0].arguments[0]), module: value(properties(node.arguments[1]).get('type')) === 'module' });
  });
  visit(ast, node => {
    if (node.type !== 'CallExpression' || node.callee?.name !== '__d' || !/FunctionExpression|ArrowFunctionExpression/.test(node.arguments[0]?.type)) return;
    const factory = node.arguments[0], dependencies = properties(node.arguments[2]), paths = properties(dependencies.get('paths'));
    const depName = factory.params[6]?.name;
    visit(factory.body, candidate => {
      if (candidate.type !== 'NewExpression') return;
      let callee = candidate.callee;
      if (callee.type === 'SequenceExpression') callee = callee.expressions.at(-1);
      if (member(callee) !== 'unstable_createWorker' && callee.name !== 'Worker') return;
      const [url, options] = candidate.arguments;
      let reference, moduleId;
      if (url?.type === 'NewExpression' && url.callee?.name === 'URL') {
        const first = url.arguments[0]; reference = value(first);
        if (member(first?.callee) === 'unstable_resolve') {
          const id = first.arguments[0];
          if (id?.type === 'MemberExpression' && id.object?.name === depName) { moduleId = value(dependencies.get(value(id.property))); reference = value(paths.get(moduleId)); }
        }
      } else reference = value(url);
      // Dynamic externally supplied worker URLs (MOSS's explicit test override) are not statically provable.
      if (reference !== undefined) workers.push({ reference, module: value(properties(options).get('type')) === 'module', moduleId });
    });
  });
  return { strings, workers, moduleReferences, publicWorkers, entryModules };
}
function attributes(tag) { return new Map([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1].toLowerCase(), m[3].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')])); }

export async function verifyExport({ platform, output, app = path.join(root, 'apps/web'), base = '/reader-web', media = false }) {
  if (!['web', 'android', 'apk'].includes(platform)) throw new Error('Use --platform web, android, or apk');
  if (base !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) throw new Error('Invalid BASE_PATH');
  let temporary;
  try {
    output = path.resolve(output);
    app = path.resolve(app);
    if (platform === 'apk' && (await fs.stat(output)).isFile()) {
      // Check archive paths before extraction; never follow archive paths outside our temporary directory.
      const names = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
      if (names.some(name => !safe(name.replace(/\/$/, ''))) || new Set(names).size !== names.length) throw new Error('Unsafe or duplicate APK archive member');
      const listing = execFileSync('unzip', ['-Z', '-l', output], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (/^l[rwxstST-]{9}\s/m.test(listing)) throw new Error('APK archive must not contain symlinks');
      temporary = await fs.mkdtemp(path.join(tmpdir(), 'reader-apk-assets-'));
      execFileSync('unzip', ['-q', output, '-d', temporary]);
      output = temporary;
    }
    const files = await inventory(output), errors = [], warnings = [], evidence = {};
    const check = (condition, message) => { if (!condition) errors.push(message); return condition; };
    const read = async name => {
      if (!check(files.has(name) && files.get(name).bytes > 0, `Missing or empty artifact: ${name}`)) return undefined;
      return fs.readFile(files.get(name).path);
    };
    const json = async name => { const bytes = await read(name); if (!bytes) return; try { return JSON.parse(bytes); } catch { errors.push(`Invalid JSON: ${name}`); } };
    const browserRoot = platform === 'apk' ? 'assets/www.bundle/' : platform === 'android' ? 'www.bundle/' : '';
    const publicRoot = platform === 'apk' ? browserRoot : '';
    const documentURL = platform === 'web' ? `https://reader.invalid${base}/index.html` : `${ORIGIN}/www.bundle/reader.html`;
    const browserURLPrefix = platform === 'web' ? `${base}/` : '/www.bundle/';
    const localPath = (reference, from = documentURL) => {
      let url; try { url = new URL(reference, from); } catch { return undefined; }
      const expected = new URL(documentURL);
      if (url.origin !== expected.origin || !url.pathname.startsWith(browserURLPrefix)) return undefined;
      let relative; try { relative = decodeURIComponent(url.pathname.slice(browserURLPrefix.length)); } catch { return undefined; }
      return safe(relative) ? browserRoot + relative : undefined;
    };
    const resolveReference = (reference, from, context, updateWarning = false) => {
      const name = localPath(reference, from);
      if (!name || !files.has(name) || !files.get(name).bytes) {
        const message = `Unresolved local ${context}: ${reference}`;
        if (updateWarning && platform === 'android') warnings.push(message); else errors.push(message);
      }
      return name;
    };

    let metadata;
    if (platform === 'android') {
      metadata = await json('metadata.json');
      check(metadata?.bundler === 'metro' && metadata?.version === 0, 'Android export must have SDK 57 Metro metadata');
      const android = metadata?.fileMetadata?.android;
      check(!!android && !metadata?.fileMetadata?.ios, 'Expected Android-only export metadata');
      if (safe(android?.bundle)) await read(android.bundle); else errors.push('Missing Android native entry bundle');
      const nativeBytes = files.has(android?.bundle) ? await fs.readFile(files.get(android.bundle).path) : undefined;
      for (const asset of android?.assets ?? []) if (/^www\.bundle\/[a-f0-9]{32}\.(?:html|js|css)$/.test(asset.path) && files.has(asset.path)) {
        const bytes = await fs.readFile(files.get(asset.path).path);
        check(path.basename(asset.path, path.extname(asset.path)) === createHash('md5').update(bytes).digest('hex'), `DOM update filename is not its content MD5: ${asset.path}`);
        if (asset.ext === 'html') check(nativeBytes?.includes(Buffer.from(path.basename(asset.path))), `Native update bundle does not reference DOM HTML: ${asset.path}`);
      }
      for (const asset of android?.assets ?? []) { if (!safe(asset.path)) errors.push('Invalid Android metadata asset path'); else await read(asset.path); }
    }
    if (platform === 'apk') {
      await read('AndroidManifest.xml'); await read('assets/index.android.bundle');
      check([...files.keys()].some(name => /^classes\d*\.dex$/.test(name)), 'APK has no Android dex code');
    }

    // A stale public directory or a source-only preparation success cannot satisfy this comparison.
    const publicFiles = await inventory(path.join(app, 'static'));
    for (const [name, expected] of publicFiles) {
      if (name.startsWith('moss/') && !media) continue;
      const emitted = files.get(publicRoot + name);
      if (check(!!emitted, `Public file was not exported: ${publicRoot}${name}`)) check(await hashFile(expected.path) === await hashFile(emitted.path), `Public file bytes differ: ${publicRoot}${name}`);
    }
    if (!media) check(![...files.keys()].some(name => name.startsWith(`${publicRoot}moss/`)), 'Default-off media build unexpectedly contains MOSS public assets');
    if (media) for (const mode of ['single', 'threaded']) {
      const dir = `${publicRoot}moss/${mode}/`, manifest = await json(`${dir}build.json`);
      check(manifest?.mode === mode && manifest?.version === 1, `Invalid MOSS ${mode} build manifest`);
      for (const [name, expected] of Object.entries(manifest?.files ?? {})) {
        if (!safe(name)) { errors.push('Invalid MOSS manifest path'); continue; }
        const bytes = await read(dir + name); if (bytes) check(digest(bytes) === expected, `MOSS ${mode} checksum mismatch: ${name}`);
      }
      await read(`${dir}moss.mjs`); await read(`${dir}moss.wasm`);
    }
    const version = JSON.parse(await fs.readFile(path.join(app, 'src/lib/search/manabitan-version.json'), 'utf8'));
    const dictionaryRoot = `${publicRoot}manabitan/${version.revision}/`;
    const dictionary = await json(`${dictionaryRoot}manifest.json`);
    check(dictionary?.revision === version.revision && dictionary?.apiVersion === 1 && dictionary?.searchVersion === 1, 'Wrong pinned Manabitan runtime contract');
    const dictionaryAssets = dictionary?.assets ?? [];
    check(dictionaryAssets.some(item => /worker[^/]*\.(?:m?js)$/.test(item.path)), 'Manabitan manifest has no worker');
    check(dictionaryAssets.some(item => /sqlite[^/]*\.wasm$/.test(item.path)), 'Manabitan manifest has no SQLite WASM');
    for (const item of dictionaryAssets) {
      if (!safe(item.path)) { errors.push('Unsafe Manabitan manifest path'); continue; }
      const bytes = await read(dictionaryRoot + item.path);
      if (bytes) check(bytes.length === item.bytes && digest(bytes) === item.sha256, `Manabitan asset integrity mismatch: ${item.path}`);
    }
    for (const name of ['web/client.js', 'web/worker.js', 'web/render.js', 'web/presets.js', 'lib/sqlite/sqlite3.wasm', 'css/structured-content.css', 'data/recommended-dictionaries.json', 'LICENSE', 'SOURCE.txt', 'corresponding-source.tar.gz']) await read(dictionaryRoot + name);
    if (files.has(dictionaryRoot + 'corresponding-source.tar.gz')) {
      try {
        const names = execFileSync('tar', ['-tzf', files.get(dictionaryRoot + 'corresponding-source.tar.gz').path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n');
        check(['web/build.mjs', 'package.json', 'LICENSE'].every(name => names.includes(name)), 'Manabitan corresponding source archive lacks build inputs/license');
      } catch { errors.push('Manabitan corresponding source is not a readable tar.gz archive'); }
    }
    // Follow the emitted ESM graph from the runtime's public entry points. Public module
    // imports resolve against the module URL, unlike Metro's document-relative asset literals.
    const publicModules = new Set(), publicQueue = ['web/client.js', 'web/render.js', 'web/presets.js'];
    while (publicQueue.length) {
      const relative = publicQueue.shift(), name = dictionaryRoot + relative;
      if (publicModules.has(name) || !files.has(name)) continue;
      publicModules.add(name);
      try {
        const inspected = inspectJavaScript(await fs.readFile(files.get(name).path, 'utf8'));
        if (relative === 'web/client.js') check(inspected.publicWorkers.some(worker => worker.reference === 'worker.js' && worker.module), 'Emitted Manabitan client lacks its module-worker URL');
        for (const reference of inspected.moduleReferences) {
          const url = new URL(reference, `https://dictionary.invalid/${relative}`);
          let target; try { target = decodeURIComponent(url.pathname.slice(1)); } catch { /* Invalid URL below. */ }
          if (!check(url.origin === 'https://dictionary.invalid' && safe(target) && files.has(dictionaryRoot + target), `Unresolved public dictionary module URL in ${relative}: ${reference}`)) continue;
          if (/\.m?js$/.test(target)) publicQueue.push(target);
        }
      } catch (error) { errors.push(`Cannot inspect public dictionary module ${relative}: ${error.message}`); }
    }
    evidence.dictionaryModules = [...publicModules].sort();
    const defaultDictionary = dictionary?.defaultDictionary;
    if (check(safe(defaultDictionary?.fileName) && defaultDictionary.fileName.endsWith('.zip'), 'Missing pinned default dictionary descriptor')) {
      const bytes = await read(`${publicRoot}dictionary-archives/${defaultDictionary.fileName}`);
      if (bytes) check(bytes.length === defaultDictionary.bytes && digest(bytes) === defaultDictionary.sha256, 'Default dictionary archive integrity mismatch');
    }

    const htmlFiles = platform === 'web' ? ['index.html', '404.html', ...ROUTES.filter(Boolean).map(route => `${route}.html`)] : [...files.keys()].filter(name => name.startsWith(browserRoot) && /^\w+\.html$/.test(name.slice(browserRoot.length)));
    check(htmlFiles.length > 0, 'No DOM HTML entry was exported');
    if (platform === 'apk' && files.has('assets/index.android.bundle')) {
      const nativeBytes = await fs.readFile(files.get('assets/index.android.bundle').path);
      for (const html of htmlFiles) check(nativeBytes.includes(Buffer.from(path.basename(html))), `Packaged native entry does not reference DOM HTML: ${html}`);
    }
    const entryScripts = new Set();
    for (const name of htmlFiles) {
      const bytes = await read(name); if (!bytes) continue;
      const html = bytes.toString(), thisURL = new URL(name.slice(browserRoot.length), documentURL).href;
      check(!/<base\b/i.test(html), `Unexpected base element in ${name}`);
      const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => attributes(match[0]));
      check(scriptTags.some(tag => tag.has('src')), `${name} has no generated entry JavaScript`);
      for (const tag of scriptTags) if (tag.has('src')) entryScripts.add(resolveReference(tag.get('src'), thisURL, `${name} script`));
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0]));
      check(links.some(tag => tag.get('rel') === 'stylesheet'), `${name} has no generated CSS`);
      for (const tag of links) if (tag.has('href')) resolveReference(tag.get('href'), thisURL, `${name} link`);
      if (platform === 'web') {
        const policies = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0])).filter(tag => tag.get('http-equiv')?.toLowerCase() === 'content-security-policy');
        check(policies.length === 1, `${name} must have exactly one CSP`);
        const csp = policies[0]?.get('content') ?? '';
        const directives = new Map(csp.split(';').map(part => { const [key, ...values] = part.trim().split(/\s+/); return [key, values]; }));
        for (const [key, values] of Object.entries({ 'script-src': ["'self'", "'wasm-unsafe-eval'"], 'worker-src': ["'self'", 'blob:'], 'object-src': ["'none'"], 'base-uri': ["'none'"] })) for (const token of values) check(directives.get(key)?.includes(token), `${name} CSP missing ${key} ${token}`);
        check(!directives.get('script-src')?.some(token => ["'unsafe-inline'", "'unsafe-eval'", '*'].includes(token)), `${name} weakens executable CSP`);
        for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) check(csp.includes(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`), `${name} CSP does not authorize its inline bootstrap`);
      }
    }
    const references = new Set(), workerReferences = [], graph = new Map();
    for (const [name, item] of files) {
      const generated = name.startsWith(browserRoot) && /(?:^|\/)_expo\/.*\.(?:js|css)$/.test(name) || platform === 'android' && /^www\.bundle\/[a-f0-9]{32}\.(?:js|css)$/.test(name);
      if (!generated) continue;
      const code = await fs.readFile(item.path, 'utf8');
      if (name.endsWith('.css')) {
        for (const match of code.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) if (!match[1].startsWith('data:')) resolveReference(match[1], new URL(name.slice(browserRoot.length), documentURL), `${name} CSS URL`, true);
        continue;
      }
      const edges = new Set(), artifactWorkers = []; const artifact = { edges, workers: artifactWorkers, entryModules: new Set() }; graph.set(name, artifact);
      let inspected; try { inspected = inspectJavaScript(code); } catch (error) { errors.push(`Cannot parse generated JavaScript ${name}: ${error.message}`); continue; }
      artifact.entryModules = inspected.entryModules;
      for (const worker of inspected.workers) {
        check(worker.module, `Generated worker lost type=module: ${worker.reference}`);
        edges.add(resolveReference(worker.reference, documentURL, 'module worker', true));
        artifactWorkers.push(worker);
      }
      for (const reference of inspected.strings) {
        // Metro's path table and asset transformer emit complete literal URLs, relative to the HTML.
        if (/^(?:\/?(?:reader-web\/)?|\.\/)_(?:expo)\/.*\.(?:js|css)$/.test(reference) || /^(?:\.?\/|\/[^\s]*\/)?assets\/[^\s]+\.(?:woff2?|ttf|otf|wasm|onnx|png|svg|jpe?g)$/.test(reference) || reference.startsWith(`${base}/_expo/`) || reference.startsWith(`${base}/assets/`)) {
          edges.add(resolveReference(reference, documentURL, 'Metro asset/chunk', true));
        }
      }
    }
    const reachable = new Set(), queue = platform === 'android' ? [...graph.keys()] : [...entryScripts];
    while (queue.length) {
      const name = queue.shift(); if (!name || reachable.has(name)) continue; reachable.add(name);
      const artifact = graph.get(name); if (!artifact) continue;
      for (const worker of artifact.workers) {
        workerReferences.push(worker.reference);
        const target = localPath(worker.reference);
        const candidates = platform === 'android' ? [...graph].filter(([file]) => metadata?.fileMetadata?.android?.assets?.some(item => item.path === file && item.ext === 'js')) : [[target, graph.get(target)]];
        if (worker.moduleId !== undefined) check(candidates.some(([file, payload]) => !entryScripts.has(file) && payload?.entryModules.has(worker.moduleId)), `No emitted standalone worker starts module ${worker.moduleId}: ${worker.reference}`);
      }
      for (const edge of artifact.edges) { references.add(edge); if (graph.has(edge)) queue.push(edge); }
    }
    evidence.reachableGeneratedScripts = [...reachable].filter(name => graph.has(name)).sort();
    const workerNames = [...WORKERS, ...(media ? ['moss-worker'] : [])];
    for (const name of workerNames) check(workerReferences.some(reference => new RegExp(`(?:^|/)${name.replaceAll('.', '\\.')}[-.]`).test(reference)), `Missing emitted module-worker call/dependency: ${name}`);
    evidence.moduleWorkers = [...new Set(workerReferences)].sort();
    evidence.entryScripts = [...entryScripts].filter(Boolean).sort();

    // Verify byte identity of every prepared font and mandatory pitch model/runtime.
    const fontSource = await fs.readFile(path.join(app, 'src/runtime/font-assets.ts'), 'utf8');
    const expectedAssets = [...fontSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => path.resolve(app, 'src/runtime', match[1]));
    check(expectedAssets.length > 0, 'No prepared font import contract');
    expectedAssets.push(path.join(app, 'src/lib/features/whispersync/pitch/swift-f0-0.3.0.onnx'));
    const appRequire = createRequire(path.join(app, 'package.json'));
    expectedAssets.push(appRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
    const candidates = [...files].filter(([name]) => platform === 'android' ? /^assets\/[^/]+$/.test(name) : name.startsWith(`${browserRoot}assets/`));
    const byHash = new Map();
    for (const [name, item] of candidates) { const hash = await hashFile(item.path); if (!byHash.has(hash)) byHash.set(hash, []); byHash.get(hash).push(name); }
    evidence.bundledAssets = [];
    for (const expected of expectedAssets) {
      const matches = byHash.get(await hashFile(expected)) ?? [];
      if (check(matches.length > 0, `Expected asset bytes were not exported: ${path.basename(expected)}`)) {
        if (platform === 'android') check(matches.some(name => metadata?.fileMetadata?.android?.assets?.some(item => item.path === name && item.ext === path.extname(expected).slice(1))), `Expected asset is absent from Android update metadata: ${path.basename(expected)}`);
        else check(matches.some(name => references.has(name)), `Exported asset has no generated runtime URL: ${path.basename(expected)}`);
        evidence.bundledAssets.push({ name: path.basename(expected), paths: matches });
      }
    }

    if (platform === 'web') {
      const manifest = await json('expo-build-manifest.json');
      check(manifest?.base === base, 'Postbuild manifest has wrong web base');
      check(JSON.stringify(manifest?.routes) === JSON.stringify(ROUTES), 'Postbuild route aliases are incomplete');
      for (const reference of [...manifest?.config?.build ?? [], ...manifest?.config?.files ?? []]) resolveReference(reference, documentURL, 'precache inventory');
      for (const route of manifest?.config?.prerendered ?? []) check(ROUTES.some(name => route === `${base}/${name}`), `Unexpected precache route: ${route}`);
      const sw = await read('service-worker.js');
      if (sw) {
        try {
          const requests = []; const handlers = new Map(); let installation;
          const cache = { addAll: async values => { requests.push(...values.map(request => request.url)); throw new Error('verification-captured'); } };
          const self = { registration: { scope: `https://reader.invalid${base}/` }, caches: { keys: async () => [], open: async () => cache, delete: async () => true }, addEventListener: (name, handler) => handlers.set(name, handler) };
          vm.runInNewContext(sw.toString(), { self, URL, Request, Response, Set, console }, { timeout: 3000 });
          check(handlers.has('install'), 'Generated service worker has no install handler');
          handlers.get('install')?.({ waitUntil: value => { installation = value; } });
          await installation?.catch(error => { if (error.message !== 'verification-captured') throw error; });
          check(requests.length > 0, 'Generated service worker precaches nothing');
          for (const url of requests) {
            const relative = new URL(url).pathname.slice(base.length + 1);
            if (ROUTES.includes(relative)) continue;
            resolveReference(url, documentURL, 'actual service worker install request');
            check(!/(?:manabitan|dictionary-archives|moss)\//.test(relative) && !/\.(?:woff2?|ttf|otf|wasm|onnx)$/.test(relative) && !/voice-pitch/.test(relative), `Lazy payload is eagerly precached: ${relative}`);
          }
          for (const entry of entryScripts) check(requests.includes(new URL(entry, documentURL).href), `Entry bundle is absent from actual precache: ${entry}`);
          for (const route of ROUTES) check(requests.includes(`https://reader.invalid${base}/${route}`), `Route absent from actual precache: ${route || '/'}`);
          evidence.precacheRequests = requests;
        } catch (error) { errors.push(`Generated service worker verification failed: ${error.message}`); }
      }
    }
    if (platform === 'android') warnings.push('Android export is an EAS-update inventory, not an APK. Its relocated DOM paths are not a runnable WebView layout; EAS Update stays disabled. Run the APK gate after Gradle.');
    return { platform, passed: errors.length === 0, readiness: platform === 'apk' ? 'packaged-assets-only; device runtime acceptance still required' : platform === 'android' ? 'export-inventory-only; not APK readiness' : 'static-web-artifacts-only; browser acceptance still required', mediaEnabled: media, base: platform === 'web' ? base : './', errors, warnings: [...new Set(warnings)], evidence, artifactCount: files.size };
  } finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) { if (!['--platform', '--output', '--app', '--base', '--media', '--report'].includes(process.argv[i]) || process.argv[i + 1] === undefined) throw new Error('Usage: verify-expo-export.mjs --platform web|android|apk --output PATH [--media true|false] [--report PATH]'); args.set(process.argv[i], process.argv[i + 1]); }
  const media = args.get('--media') ?? process.env.EXPO_PUBLIC_ENABLE_VIDEO_LEARNING ?? process.env.VITE_ENABLE_VIDEO_LEARNING ?? 'false';
  if (!['true', 'false'].includes(media)) throw new Error('--media must be true or false');
  const report = await verifyExport({ platform: args.get('--platform'), output: args.get('--output') ?? `apps/web/${args.get('--platform') === 'web' ? 'build' : 'dist-android'}`, app: args.get('--app'), base: args.get('--base') ?? process.env.BASE_PATH ?? '/reader-web', media: media === 'true' });
  if (args.has('--report')) { await fs.mkdir(path.dirname(args.get('--report')), { recursive: true }); await fs.writeFile(args.get('--report'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
