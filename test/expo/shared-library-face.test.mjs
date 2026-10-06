/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const output = await build({
  stdin: {
    contents: `
    export { LibraryBookFace } from './apps/web/src/features/library/LibraryBookFace';
    export { bookFaceLayout as web } from './apps/web/src/features/library/book-face.web';
    export { bookFaceLayout as native } from './apps/web/src/features/library/book-face';
    export { LibraryMetadataFields, libraryMetadataFields } from './apps/web/src/features/library/LibraryMetadataFields';
    export { metadataLayout } from './apps/web/src/features/library/metadata-fields.web';
    export { UiThemeProvider } from './apps/web/src/shared-ui/theme';
  `,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  metafile: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  plugins: [
    {
      name: 'native-surface-fixture',
      setup(b) {
        b.onResolve({ filter: /^react-native$/ }, () => ({ path: 'rn', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'js',
          contents: `
      import React from 'react';
      const flatten = value => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity) : [value]).filter(Boolean));
      export const StyleSheet = {create:v=>v,flatten};
      export const Platform = {OS:'android'};
      export const useColorScheme = () => 'dark';
      export const View = ({style,children}) => React.createElement('div',{'data-style':JSON.stringify(flatten(style))},children);
      export const Text = ({style,children,accessibilityLabel}) => React.createElement('span',{'data-style':JSON.stringify(flatten(style)),'aria-label':accessibilityLabel},children);
    `
        }));
      }
    }
  ]
});
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require });
const {
  LibraryBookFace,
  web,
  native,
  UiThemeProvider,
  LibraryMetadataFields,
  libraryMetadataFields,
  metadataLayout
} = module.exports;
const h = React.createElement;
function render(layout, props = {}) {
  const face = h(LibraryBookFace, {
    layout,
    title: '猫 <script>title</script>',
    author: 'Writer',
    readingLabel: 'Unread',
    cover: h('img', { 'data-cover': 'owned' }),
    ...props
  });
  return new JSDOM(renderToStaticMarkup(h(UiThemeProvider, { appearance: 'dark' }, face))).window
    .document;
}
test('shared shelf face preserves exact browser hierarchy, CSS selectors and escaped titles', () => {
  const document = render(web, { selected: true });
  assert.deepEqual(
    [...document.body.children].map((n) => n.className),
    ['book-thumbnail', 'book-copy']
  );
  assert.equal(document.querySelector('.book-thumbnail > img').dataset.cover, 'owned');
  assert.equal(document.querySelector('.selection-label').textContent, 'Selected');
  assert.equal(document.querySelector('.book-copy > h3').textContent, '猫 <script>title</script>');
  assert.equal(document.querySelectorAll('script').length, 0);
  assert.equal(document.querySelector('.book-author').textContent, 'Writer');
  assert.equal(document.querySelector('.list-detail > .new-badge').title, 'Unread');
});
for (const [name, layout] of [
  ['web', web],
  ['native', native]
]) {
  test(`${name} face retains unread, fractional-progress label, completion/date and reading-now precedence`, () => {
    for (const [props, expected] of [
      [{ readingLabel: '3%' }, '3%'],
      [
        { readingLabel: 'Finished', finishedDay: '2026-10-02', readingNow: true },
        'Finished · 2026-10-02'
      ],
      [{ readingLabel: 'Finished', readingNow: true }, 'Finished · Reading now'],
      [{ readingLabel: '0%', readingNow: true }, '0% · Reading now']
    ])
      assert.ok(render(layout, props).body.textContent.endsWith(expected));
    const empty = render(layout, { author: '', selected: false });
    assert.doesNotMatch(empty.body.textContent, /Writer|Selected/);
    assert.match(empty.body.textContent, /NEW/);
  });
}
test('native face keeps full title, semantic dark colors, list direction and full-width grid cover', () => {
  const list = render(native, { title: 'Long '.repeat(300) });
  assert.ok(list.body.textContent.includes('Long '.repeat(300)));
  assert.equal(JSON.parse(list.body.firstChild.dataset.style).flexDirection, 'row');
  const grid = render(native, { grid: true, selected: true });
  assert.equal(JSON.parse(grid.body.firstChild.dataset.style).flexDirection, 'column');
  assert.equal(JSON.parse(grid.body.firstChild.firstChild.dataset.style).width, '100%');
  const title = [...grid.querySelectorAll('span')].find(
    (n) => n.textContent === '猫 <script>title</script>'
  );
  assert.ok(JSON.parse(title.dataset.style).color);
  assert.equal(grid.querySelector('[aria-label="Unread"]').textContent, 'NEW');
});
test('common book face has no DOM store, dictionary or native storage imports', () => {
  const inputs = Object.keys(output.metafile.inputs);
  assert.ok(inputs.some((p) => p.endsWith('/LibraryBookFace.tsx')));
  assert.ok(
    !inputs.some((p) =>
      /native-library\/(service|view-model)|lib\/data\/store|manabitan|yomitan/.test(p)
    )
  );
});

test('shared metadata editor preserves complete field breadth, labels, publication grouping and original web limits', () => {
  const values = Object.fromEntries(
    libraryMetadataFields.map((field) => [field.name, `draft ${field.name}`])
  );
  const document = new JSDOM(
    renderToStaticMarkup(
      h(LibraryMetadataFields, {
        layout: metadataLayout,
        value: values,
        onChange: () => {},
        disabled: false,
        labelPrefix: 'book-editor'
      })
    )
  ).window.document;
  const controls = [...document.querySelectorAll('input,textarea')];
  assert.equal(controls.length, 8);
  assert.deepEqual(
    controls.map((input) => input.value),
    Array.from(libraryMetadataFields, (field) => values[field.name])
  );
  assert.deepEqual(
    controls.map((input) => input.maxLength),
    [1000, 16415, 16415, 128, 128, 512, 15423, 16000]
  );
  assert.equal(controls[0].required, true);
  assert.equal(controls[1].getAttribute('aria-labelledby'), 'book-editor-authors');
  assert.equal(controls[2].getAttribute('aria-labelledby'), 'book-editor-author-sort');
  assert.equal(controls[6].getAttribute('aria-labelledby'), 'book-editor-subjects');
  assert.equal(controls[4].placeholder, 'For example, 2024-03-01');
  assert.equal(document.querySelector('.sm\\:grid-cols-2').querySelectorAll('input').length, 2);
  const disabled = new JSDOM(
    renderToStaticMarkup(
      h(LibraryMetadataFields, {
        layout: metadataLayout,
        value: values,
        onChange: () => {},
        disabled: true,
        labelPrefix: 'busy-editor'
      })
    )
  ).window.document;
  assert.ok([...disabled.querySelectorAll('input,textarea')].every((input) => input.disabled));
});
