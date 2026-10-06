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
const compiled = await build({
  stdin: {
    contents: `export { SettingsFieldGroup } from './apps/web/src/features/settings/SettingsFieldGroup'; export * as layout from './apps/web/src/features/settings/field-layout.web'; export { settingCategories } from './apps/web/src/features/settings/categories';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  metafile: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime']
});
const module = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require });
const { SettingsFieldGroup, layout, settingCategories } = module.exports;
const h = React.createElement;
function render(props = {}) {
  const html = renderToStaticMarkup(
    h(SettingsFieldGroup, {
      layout,
      settingId: 'font-defaults',
      category: 'typography',
      title: 'Default fonts',
      headingId: 'original-heading',
      description: 'First line\nSecond line',
      wide: true,
      header: h('button', { type: 'button' }, 'Add font'),
      children: h('input', { 'aria-label': 'Font preference', defaultValue: 'Saved font' }),
      ...props
    })
  );
  return new JSDOM(html);
}

test('shared Settings card preserves released section, heading, help, header-slot and editor semantics', () => {
  const dom = render();
  try {
    const document = dom.window.document;
    const section = document.querySelector('section[data-setting="font-defaults"]');
    assert.equal(section.dataset.category, 'typography');
    assert.equal(section.getAttribute('aria-labelledby'), 'original-heading');
    assert.equal(section.querySelector('h2').textContent, 'Default fonts');
    assert.ok(section.querySelector('h2').classList.contains('font-semibold'));
    assert.match(section.className, /rounded-2xl.*p-\[16px\].*sm:p-\[20px\]/);
    assert.ok(section.classList.contains('wide'));
    assert.equal(
      section.querySelector('[data-slot="field-description"]').textContent,
      'First line\nSecond line'
    );
    assert.equal(section.querySelector('button').textContent, 'Add font');
    assert.equal(section.querySelector('input').value, 'Saved font');
    assert.equal(section.querySelectorAll('[data-slot="field"]').length, 1);
  } finally {
    dom.window.close();
  }
});

test('filter visibility hides the existing field without discarding its editor subtree', () => {
  const dom = render({ visible: false });
  try {
    const section = dom.window.document.querySelector('section');
    assert.equal(section.hidden, true);
    assert.equal(section.querySelector('input').value, 'Saved font');
  } finally {
    dom.window.close();
  }
});

test('headingless and nonemphasized field variants preserve original conditional slots', () => {
  const dom = render({ showHeading: false, description: '', wide: false });
  try {
    const section = dom.window.document.querySelector('section');
    assert.equal(section.hasAttribute('aria-labelledby'), false);
    assert.equal(section.querySelector('h2'), null);
    assert.equal(section.querySelector('button'), null);
    assert.equal(section.querySelector('[data-slot="field-description"]'), null);
    assert.equal(section.classList.contains('wide'), false);
    assert.ok(section.querySelector('input'));
  } finally {
    dom.window.close();
  }
  const plain = render({ emphasizeHeading: false });
  try {
    assert.equal(
      plain.window.document.querySelector('h2').classList.contains('font-semibold'),
      false
    );
  } finally {
    plain.window.close();
  }
});

test('web shared card composition imports no native renderer, storage owner or alternate screen', () => {
  const files = Object.keys(compiled.metafile.inputs);
  assert.ok(files.some((file) => file.endsWith('/SettingsFieldGroup.tsx')));
  assert.ok(files.some((file) => file.endsWith('/field-layout.web.tsx')));
  assert.ok(
    !files.some((file) => /field-layout\.tsx|native-settings|settings-react|\/lib\//.test(file))
  );
});

test('shared Settings categories retain every original category, order, name and description', () => {
  assert.deepEqual(
    Array.from(settingCategories, (item) => [item.id, item.label]),
    [
      ['appearance', 'Appearance'],
      ['typography', 'Fonts & text'],
      ['layout', 'Page layout'],
      ['reading', 'Reading controls'],
      ['library', 'Library & sync'],
      ['tracking', 'Tracking & goals'],
      ['all', 'All settings']
    ]
  );
  assert.ok(
    settingCategories.every(
      (item) => typeof item.description === 'string' && item.description.length > 0
    )
  );
});
