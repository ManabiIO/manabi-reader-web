/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readerContentSecurityPolicy } from '../apps/web/src/platform/content-security-policy.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const dir = path.join(root, 'apps/web/build');
const base = process.env.BASE_PATH ?? '/reader-web';
const routes = ['', 'manage', 'b', 'settings', 'connections', 'statistics', 'snippets', 'shared-library', 'import-ttu', 'auth', 'videos'];
const sourceHTML = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
const scriptHashes = [...sourceHTML.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => `sha256-${createHash('sha256').update(match[1]).digest('base64')}`);
const csp = readerContentSecurityPolicy(scriptHashes).replaceAll('&', '&amp;').replaceAll('\"', '&quot;');
const html = sourceHTML.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">`);
await fs.writeFile(path.join(dir, 'index.html'), html);
await fs.writeFile(path.join(dir, '404.html'), html);
for (const route of routes.filter(Boolean)) await fs.writeFile(path.join(dir, `${route}.html`), html);
async function walk(directory, prefix = '') { const paths = []; for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const relative = `${prefix}${entry.name}`; if (entry.isDirectory()) paths.push(...await walk(path.join(directory, entry.name), `${relative}/`)); else paths.push(relative); } return paths; }
const paths = await walk(dir);
const urls = paths.map(file => `${base}/${file}`);
const config = { build: urls.filter(file => /\/(?:_expo|assets)\//.test(file)), files: urls.filter(file => !/\/(?:_expo|assets)\//.test(file)), prerendered: routes.map(route => `${base}/${route}`), version: createHash('sha256').update(html).digest('hex').slice(0, 16), userFontsCacheName: 'ttu-userfonts', lazyAssets: urls.filter(file => /voice-pitch|swift-f0|ort-wasm/.test(file)) };
const entry = `import { registerReaderServiceWorker } from './apps/web/src/lib/service-worker/reader-service-worker.mjs'; registerReaderServiceWorker(self, ${JSON.stringify(config)});`;
await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, format: 'iife', platform: 'browser', outfile: path.join(dir, 'service-worker.js'), minify: true });
await fs.writeFile(path.join(dir, 'expo-build-manifest.json'), JSON.stringify({ platforms: ['android', 'web'], base, routes, config }, null, 2));
