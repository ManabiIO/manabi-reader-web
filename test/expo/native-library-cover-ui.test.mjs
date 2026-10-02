/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test'
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createRoot } = require('react-dom/client');
const output = mkdtempSync(join(tmpdir(), 'native-library-cover-ui-'));
const fixture = join(output, 'native.tsx');
writeFileSync(
  fixture,
  `import React from 'react'; export const View=({children,style})=><div data-style={JSON.stringify(style)}>{children}</div>; export const Text=({children})=><span>{children}</span>; export const Image=({source,blurRadius,onError,resizeMode})=><img src={source.uri} data-blur={blurRadius} data-fit={resizeMode} onError={onError}/>; export const StyleSheet={create:x=>x};`
);
const outfile = join(output, 'cover.cjs');
await build({
  entryPoints: ['apps/web/src/native-library/cover.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  jsx: 'automatic',
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'native-adapter',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve({ filter: /^react-native$/ }, () => ({ path: fixture }));
      }
    }
  ]
});
const { NativeBookCover } = require(outfile);
const rasterFile = join(output, 'raster.cjs');
await build({
  entryPoints: [resolve('apps/web/src/native-library/cover-raster.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: rasterFile,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent'
});
const { rasterizeLocalCover, NATIVE_COVER_SOURCE_LIMIT } = require(rasterFile);
process.on('exit', () => rmSync(output, { recursive: true, force: true }));
const jpeg = { uri: 'data:image/jpeg;base64,/9j/2Q==', width: 20, height: 30 };

test('native Image renders bounded raster, preserves blur and falls back to title/author on decode error', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (image, blurred = false, grid = false) =>
    act(() =>
      root.render(
        React.createElement(NativeBookCover, {
          image,
          title: '読みたい本',
          creators: '著者',
          blurred,
          grid
        })
      )
    );
  await render(jpeg, true, true);
  assert.equal(container.querySelector('img').src, jpeg.uri);
  assert.equal(container.querySelector('img').dataset.blur, '8');
  assert.equal(container.querySelector('img').dataset.fit, 'contain');
  await act(() => container.querySelector('img').dispatchEvent(new Event('error')));
  assert.equal(container.querySelector('img'), null);
  assert.match(container.textContent, /読みたい本.*著者/);
  await render({ ...jpeg, uri: 'https://provider.test/token' });
  assert.equal(container.querySelector('img'), null);
  await render({ ...jpeg, uri: 'data:image/jpeg;base64,/9j/2QAB' });
  assert.ok(container.querySelector('img'));
  await render(undefined);
  assert.equal(container.querySelector('img'), null, 'cleared view cannot keep old image mounted');
  await act(() => root.unmount());
  container.remove();
});

function rasterFixture({
  width = 600,
  height = 900,
  fail = false,
  hold = false,
  oversized = 0
} = {}) {
  const original = document.createElement.bind(document),
    originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL;
  const images = [],
    canvases = [],
    revoked = [],
    generated = [];
  URL.createObjectURL = () => {
    const url = `blob:fixture-${generated.length}`;
    generated.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  document.createElement = (name, ...args) => {
    const element = original(name, ...args);
    if (name === 'img') {
      images.push(element);
      Object.defineProperties(element, {
        naturalWidth: { value: width },
        naturalHeight: { value: height },
        src: {
          set(value) {
            element.setAttribute('src', value);
            if (!hold)
              setImmediate(() => element.dispatchEvent(new Event(fail ? 'error' : 'load')));
          },
          get() {
            return element.getAttribute('src');
          }
        }
      });
    } else if (name === 'canvas') {
      const context = {
        filter: 'none',
        fillRect() {},
        drawImage() {
          context.drawnFilter = context.filter;
        }
      };
      const record = { element, context };
      canvases.push(record);
      element.getContext = () => context;
      element.toDataURL = (mime) => {
        record.mime = mime;
        record.width = element.width;
        record.height = element.height;
        return canvases.length <= oversized
          ? 'data:image/jpeg;base64,' + 'AAAA'.repeat(20000)
          : jpeg.uri;
      };
    }
    return element;
  };
  const abort = new AbortController();
  const authority = { key: 'view', signal: abort.signal, assertCurrent() {} };
  return {
    images,
    canvases,
    revoked,
    generated,
    abort,
    authority,
    restore() {
      document.createElement = original;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  };
}
test('DOM raster path uses safe local image URL, pre-bridge blur, dimension bound and cleanup', async () => {
  const f = rasterFixture({ oversized: 1 });
  try {
    const result = await rasterizeLocalCover(
      new Blob(['local bytes'], { type: 'image/png' }),
      true,
      f.authority
    );
    assert.deepEqual(result, { ...jpeg, width: 160, height: 240 });
    assert.equal(f.images[0].referrerPolicy, 'no-referrer');
    assert.equal(f.images[0].getAttribute('src'), null);
    assert.deepEqual(f.revoked, f.generated);
    assert.equal(f.canvases.length, 2);
    for (const record of f.canvases) {
      assert.equal(record.context.drawnFilter, 'blur(12px)');
      assert.equal(record.mime, 'image/jpeg');
      assert.equal(record.element.width, 0);
    }
  } finally {
    f.restore();
  }
});
test('DOM raster rejects remote/restored/SVG strings and excess input before creating image elements', async () => {
  const f = rasterFixture();
  try {
    for (const value of [
      'https://provider.test/secret',
      'file:///private',
      'blob:old',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,AAAA',
      new Blob(['script'], { type: 'text/html' }),
      new Blob([new Uint8Array(NATIVE_COVER_SOURCE_LIMIT + 1)], { type: 'image/png' })
    ])
      assert.equal(await rasterizeLocalCover(value, false, f.authority), null);
    assert.equal(f.images.length, 0);
    assert.equal(f.generated.length, 0);
  } finally {
    f.restore();
  }
});
test('DOM raster failure, cancellation, dimensions and oversized encoding always clean up', async () => {
  for (const options of [
    { fail: true },
    { width: 9000, height: 1 },
    { width: 8192, height: 8192 },
    { oversized: 3 },
    { hold: true }
  ]) {
    const f = rasterFixture(options);
    try {
      const pending = rasterizeLocalCover(
        new Blob(['local'], { type: 'image/png' }),
        false,
        f.authority
      );
      if (options.hold) {
        f.abort.abort();
        await assert.rejects(pending);
      } else assert.equal(await pending, null);
      assert.deepEqual(f.revoked, f.generated);
      assert.equal(f.images[0].getAttribute('src'), null);
    } finally {
      f.restore();
    }
  }
});
