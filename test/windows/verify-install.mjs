/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// An exit code alone did not prove installation on the first Windows runner:
// its pnpm shim silently returned without creating node_modules.
for (const relative of ['../../package.json', '../../apps/windows/package.json']) {
  const manifestUrl = new URL(relative, import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const require = createRequire(manifestUrl);
  const expected = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const name of [
    'expo',
    'react',
    'react-native',
    'react-native-windows',
    'typescript',
    'eslint'
  ]) {
    if (!expected[name]) continue;
    const installed = require(`${name}/package.json`);
    assert.equal(installed.version, expected[name], `${manifest.name}: ${name} version`);
    console.log(`${manifest.name}: ${name}@${installed.version}`);
  }
}
