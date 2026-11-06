/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const assets = new URL('../../apps/web/static/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', assets), 'utf8'));

test('installed Reader uses an ordinary window without changing its existing launch identity', () => {
  assert.equal(manifest.display, 'standalone');
  for (const prefix of ['/', '/reader-web/', '/nested/reader/']) {
    const source = new URL(prefix + 'manifest.webmanifest', 'https://reader.example');
    const launch = new URL(manifest.start_url, source);
    assert.equal(new URL(manifest.id, source).href, launch.href);
    assert.equal(new URL(manifest.scope, source).href, launch.href);
    assert.equal(launch.pathname, prefix);
  }
});

test('install icons include actual square 192px and 512px PNG assets', () => {
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (item) => item.sizes === `${size}x${size}` && item.purpose === 'any'
    );
    assert.ok(icon);
    assert.equal(icon.type, 'image/png');
    const data = readFileSync(new URL(icon.src, assets));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
  }
});
