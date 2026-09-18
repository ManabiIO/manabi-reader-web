import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLocalFontStyleSheet,
  createLocalCoverUrl
} from '../../apps/web/src/lib/functions/book-security/local-media.ts';

for (const source of [
  'https://example.invalid/cover.png',
  '//example.invalid/p',
  '/private',
  'javascript:alert(1)',
  'file:///tmp/p',
  'blob:https://reader.example/stale',
  'data:image/svg+xml,<svg onload="alert(1)"/>'
]) {
  test(`cover refuses unowned string URL ${source.split(':')[0]}`, () =>
    assert.equal(createLocalCoverUrl(source), ''));
}
test('retains legacy embedded raster cover', () =>
  assert.equal(createLocalCoverUrl('data:image/png;base64,YQ=='), 'data:image/png;base64,YQ=='));
test('wraps untyped old blob as JPEG', () => {
  let type;
  createLocalCoverUrl(new Blob(['x']), (b) => {
    type = b.type;
    return 'blob:local';
  });
  assert.equal(type, 'image/jpeg');
});
test('different same-sized image blobs are distinct URL allocations', () => {
  const values = [];
  for (const s of ['a', 'b'])
    createLocalCoverUrl(new Blob([s], { type: 'image/png' }), (b) => {
      values.push(b);
      return 'blob:local';
    });
  assert.notEqual(values[0], values[1]);
});
test('rejects non-image blob', () =>
  assert.equal(createLocalCoverUrl(new Blob(['x'], { type: 'text/html' })), ''));
test('null and malformed cover metadata fail closed', () => {
  for (const v of [null, undefined, {}, 4]) assert.equal(createLocalCoverUrl(v), '');
});
test('builds local font CSS with the existing cache paths', () => {
  const css = buildLocalFontStyleSheet([
    {
      name: '日本語',
      fileName: '私の字.woff2',
      path: '/userfonts/' + encodeURIComponent('私の字.woff2')
    }
  ]);
  assert.ok(css.includes('日本語'));
  assert.ok(css.includes('/userfonts/'));
  assert.ok(css.includes('format("woff2")'));
});
test('font family quotes cannot terminate a CSS string', () => {
  const css = buildLocalFontStyleSheet([
    { name: 'x";}body{color:red}/*', fileName: 'x.woff2', path: '/userfonts/x.woff2' }
  ]);
  assert.ok(css.includes('x\\22 ;}body'));
  assert.ok(!css.includes('x";}body'));
});
test('font family newline is escaped', () => {
  const css = buildLocalFontStyleSheet([
    { name: 'x\n', fileName: 'x.ttf', path: '/userfonts/x.ttf' }
  ]);
  assert.ok(css.includes('x\\a '));
  assert.ok(css.includes('truetype'));
});
for (const source of [
  'https://example.invalid/font.woff2',
  '//example.invalid/x',
  '/userfonts/x.woff2?redirect=1',
  '/userfonts/../private',
  '/userfonts/x.woff2#fragment'
]) {
  test(`font metadata refuses unrelated path ${source}`, () =>
    assert.equal(buildLocalFontStyleSheet([{ name: 'x', fileName: 'x.woff2', path: source }]), ''));
}
test('invalid extension and metadata do not generate CSS', () => {
  assert.equal(
    buildLocalFontStyleSheet([
      null,
      {},
      { name: 'x', fileName: 'x.css', path: '/userfonts/x.css' }
    ]),
    ''
  );
  assert.equal(buildLocalFontStyleSheet({}), '');
});

test('prototype-named font extensions are rejected', () => {
  for (const ext of ['constructor', '__proto__', 'toString'])
    assert.equal(
      buildLocalFontStyleSheet([{ name: 'x', fileName: 'x.' + ext, path: '/userfonts/x.' + ext }]),
      ''
    );
});

test('malformed Unicode font filename cannot crash startup', () => {
  assert.equal(
    buildLocalFontStyleSheet([{ name: 'x', fileName: '\ud800.woff2', path: '/userfonts/x.woff2' }]),
    ''
  );
});
