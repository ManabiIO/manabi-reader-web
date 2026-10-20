/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { verifyBundle } = require('../../apps/windows/scripts/verify-bundle.cjs');

test(
  'native debug URL serves Windows code, maps and assets through Expo Metro',
  { timeout: 120_000 },
  async () => {
    const child = spawn(process.execPath, ['apps/windows/scripts/metro.cjs', 'start'], {
      cwd: root,
      env: { ...process.env, RCT_METRO_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    let timer;
    const ready = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Metro did not become ready:\n${log}`)), 30_000);
      child.stdout.on('data', (chunk) => {
        log += chunk.toString();
        const match = log.match(/Windows Metro ready: (\{[^\n]+\})/);
        if (match) resolve(JSON.parse(match[1]));
      });
      child.stderr.on('data', (chunk) => {
        log += chunk.toString();
      });
      exited.then(() => reject(new Error(`Metro exited before readiness:\n${log}`)), reject);
    });
    try {
      const { port, bundlePath } = await ready;
      clearTimeout(timer);
      const host = await readFile(
        path.join(root, 'apps/windows/windows/ManabiReaderWindows/ManabiReaderWindows.cpp'),
        'utf8'
      );
      assert.ok(
        host.includes(`settings.DebugBundlePath(L"${bundlePath}")`),
        'C++ debug path must match Expo server root'
      );
      const base = `http://127.0.0.1:${port}/${bundlePath}`;
      const query = '?platform=windows&dev=true&minify=false';
      const response = await fetch(`${base}.bundle${query}`, {
        signal: AbortSignal.timeout(60_000)
      });
      const code = await response.text();
      assert.equal(response.status, 200, code.slice(0, 1200));
      const mapResponse = await fetch(`${base}.map${query}`, {
        signal: AbortSignal.timeout(30_000)
      });
      const mapText = await mapResponse.text();
      assert.equal(mapResponse.status, 200, mapText.slice(0, 1200));
      const report = verifyBundle(code, mapText, { dev: true });
      assert.ok(report.modules > 0);
      // LogBox ships image assets in development; the same Metro server must
      // serve the encoded node_modules path used by its asset registry.
      const match = code.match(
        /"httpServerLocation"\s*:\s*"([^"]+)"[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?"type"\s*:\s*"([^"]+)"/
      );
      assert.ok(match, 'Expected the Windows development image assets');
      const assetPath = `${match[1]}/${match[2]}.${match[3]}?platform=windows`;
      const assetResponse = await fetch(`http://127.0.0.1:${port}${assetPath}`, {
        signal: AbortSignal.timeout(10_000)
      });
      assert.equal(assetResponse.status, 200, assetPath);
      assert.ok((await assetResponse.arrayBuffer()).byteLength > 0);
      console.log(JSON.stringify({ ...report, debugBundlePath: bundlePath, httpAsset: 'pass' }));
    } finally {
      clearTimeout(timer);
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
      const result = await exited.finally(() => clearTimeout(force));
      assert.equal(
        result.code,
        0,
        `Metro did not shut down cleanly: ${JSON.stringify(result)}\n${log}`
      );
    }
  }
);
