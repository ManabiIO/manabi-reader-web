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
    contents: `export { createSettingsWorkspaceState } from './apps/web/src/features/settings/workspace-state'; export { SettingsWorkspace } from './apps/web/src/features/settings/SettingsWorkspace';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  metafile: true,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime']
});
const module = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require });
const { createSettingsWorkspaceState, SettingsWorkspace } = module.exports;
const h = React.createElement;
test('shared Settings filter has stable snapshots, isolated visits and read-only duplicate updates', () => {
  const one = createSettingsWorkspaceState('tracking'),
    two = createSettingsWorkspaceState('unknown');
  assert.equal(one.getSnapshot().category, 'tracking');
  assert.equal(two.getSnapshot().category, 'appearance');
  const initial = one.getSnapshot();
  let changes = 0;
  const stop = one.subscribe(() => changes++);
  one.search('');
  one.choose('tracking');
  assert.equal(one.getSnapshot(), initial);
  assert.equal(changes, 0);
  one.search('font weight');
  assert.equal(one.getSnapshot().category, 'tracking');
  assert.equal(changes, 1);
  one.choose('typography');
  assert.equal(one.getSnapshot().query, '');
  assert.equal(changes, 2);
  assert.equal(two.getSnapshot().query, '');
  stop();
  one.search('later');
  assert.equal(changes, 2);
});
test('history restoration, global search and functional updates retain the original filter contract', () => {
  const owner = createSettingsWorkspaceState('layout');
  owner.search('  vertical  text ');
  assert.equal(owner.getSnapshot().query, '  vertical  text ');
  owner.update((value) => ({ ...value, query: 'reading' }));
  assert.equal(owner.getSnapshot().category, 'layout');
  owner.set({ category: 'reading', query: '' });
  assert.equal(owner.getSnapshot().query, '');
  assert.equal(owner.getSnapshot().category, 'reading');
  owner.choose('not-a-category');
  assert.equal(owner.getSnapshot().category, 'appearance');
});
// Pure composition fixture; real HTML/Expo controls are exercised by the retained browser/native tests.
const layout = {
  WorkspaceFrame: ({ children }) => h('div', {}, children),
  WorkspaceAside: ({ children }) => h('aside', {}, children),
  WorkspaceSearch: ({ query }) =>
    h('input', { 'aria-label': 'Search settings', value: query, readOnly: true }),
  WorkspaceNavigation: ({ children }) => h('nav', {}, children),
  WorkspaceCategory: ({ id, label, selected }) =>
    h('a', { href: '#' + id, 'aria-current': selected ? 'page' : undefined }, label),
  WorkspaceMain: ({ children }) => h('main', {}, children),
  WorkspaceIntroduction: ({ title, description, saveDescription, resultText }) =>
    h(
      'header',
      {},
      h('h1', {}, title),
      h('p', {}, description),
      h('p', {}, saveDescription),
      resultText !== undefined ? h('p', { role: 'status' }, resultText) : null
    )
};
for (const query of ['', 'font'])
  test(`common Settings workspace retains all categories and specialized content with query ${JSON.stringify(query)}`, () => {
    const html = renderToStaticMarkup(
      h(
        SettingsWorkspace,
        {
          layout,
          filter: { category: 'layout', query },
          onSearch() {},
          onCategory() {},
          resultText: '3 matching settings',
          saveDescription: 'Save guidance'
        },
        h('section', { 'data-specialized': 'font-editor' }, 'Retained editor')
      )
    );
    const dom = new JSDOM(html);
    try {
      const d = dom.window.document;
      assert.equal(d.querySelectorAll('nav a').length, 7);
      assert.equal(d.querySelector('h1').textContent, query ? 'Search results' : 'Page layout');
      assert.equal(d.querySelectorAll('[aria-current="page"]').length, query ? 0 : 1);
      assert.equal(d.querySelector('[data-specialized]').textContent, 'Retained editor');
      assert.equal(
        d.querySelector('[role="status"]')?.textContent,
        query ? '3 matching settings' : undefined
      );
    } finally {
      dom.window.close();
    }
  });
test('shared Settings workspace core never reaches a platform renderer or preference owner', () => {
  const files = Object.keys(compiled.metafile.inputs);
  assert.ok(files.some((p) => p.endsWith('/workspace-state.ts')));
  assert.ok(!files.some((p) => /settings-react|native-settings|workspace-layout|\/lib\//.test(p)));
});
