/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const output = mkdtempSync(join(tmpdir(), 'native-snippets-ui-'));
const fixture = join(output, 'native.tsx');
writeFileSync(
  fixture,
  `import React from 'react';export const stateListeners=new Set();export const backListeners=new Set();export const AppState={addEventListener(_,callback){stateListeners.add(callback);return{remove(){stateListeners.delete(callback)}}}};export const BackHandler={addEventListener(_,callback){backListeners.add(callback);return{remove(){backListeners.delete(callback)}}}};export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const Pressable=({children,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const ScrollView=View;export const TextInput=({value,onChangeText,editable,accessibilityLabel})=><textarea aria-label={accessibilityLabel} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>;export const FlatList=({data,ListHeaderComponent,ListEmptyComponent,ListFooterComponent,renderItem})=><div>{ListHeaderComponent}{data.length?data.map(item=><div key={item.key}>{renderItem({item})}</div>):ListEmptyComponent}{ListFooterComponent}</div>;export const Modal=({visible,children})=>visible?<div>{children}</div>:null;export const ActivityIndicator=()=> <div>Loading</div>;export const StyleSheet={create:x=>x};`
);
const outfile = join(output, 'screen.cjs');
await build({
  stdin: {
    contents: `export * from './apps/web/src/native-snippets/index';export * from 'native-ui-fixture';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: 'apps/web/tsconfig.json',
  jsx: 'automatic',
  logLevel: 'silent',
  plugins: [
    {
      name: 'native-controls-only',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
        b.onResolve({ filter: /^react-native$|^native-ui-fixture$/ }, () => ({ path: fixture }));
      }
    }
  ]
});
const { NativeSnippetsScreen, stateListeners, backListeners } = require(outfile);
const state = {
  token: 'list',
  items: [],
  total: 0,
  page: 0,
  pages: 1,
  drafts: [],
  sources: [],
  searchComplete: true,
  notices: []
};
const editor = {
  key: 'draft',
  token: 'editor-1',
  title: '',
  runs: [{ key: '0.0', block: 'Paragraph 1', text: '', marks: [], empty: true }],
  source: { title: '', url: '' },
  destination: 'This device',
  canChooseDestination: true,
  hasConflict: false,
  notice: 'Preserves rich structure'
};
function setup(override) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const calls = [];
  let serial = 1;
  const request = async (method, payload) => {
    calls.push({ method, payload });
    const value = await override?.(method, payload);
    if (value !== undefined) return value;
    if (method === 'snippets.state') return state;
    if (payload.type === 'new') return { editor: structuredClone(editor) };
    if (payload.type === 'checkpoint')
      return {
        editor: {
          ...structuredClone(editor),
          token: 'editor-' + ++serial,
          title: payload.patch.title,
          runs: payload.patch.runs.map((run) => ({ ...run, block: 'Paragraph 1', marks: [] })),
          source: payload.patch.source
        }
      };
    if (payload.type === 'discard' || payload.type === 'save') return { saved: true };
    return {};
  };
  return {
    root,
    container,
    calls,
    request,
    async render(identity = 'session:0') {
      await act(async () => {
        root.render(React.createElement(NativeSnippetsScreen, { identity, request }));
        await new Promise((r) => setTimeout(r, 220));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 220));
      });
    },
    async dispose() {
      await act(() => root.unmount());
      container.remove();
    }
  };
}
async function click(f, title) {
  const button = [...f.container.querySelectorAll('button')].find(
    (button) => button.textContent === title
  );
  assert.ok(button, `button ${title}`);
  await act(async () => button.click());
}
async function type(f, label, value) {
  const input = f.container.querySelector(`[aria-label="${label}"]`);
  assert.ok(input, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(
      input,
      value
    );
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
test('mounted RN screen fences repeated clicks and removes lifecycle listeners on close', async () => {
  let release;
  const f = setup(async (method, payload) => {
    if (payload.type === 'new')
      return new Promise((resolve) => {
        release = () => resolve({ editor: structuredClone(editor) });
      });
  });
  await f.render();
  const button = [...f.container.querySelectorAll('button')].find(
    (b) => b.textContent === 'New snippet'
  );
  await act(async () => {
    button.click();
    button.click();
  });
  assert.equal(f.calls.filter((c) => c.payload.type === 'new').length, 1);
  await act(async () => release());
  assert.match(f.container.textContent, /Draft saved/);
  assert.equal(backListeners.size, 1);
  await click(f, 'Keep draft & close');
  assert.ok(!f.container.querySelector('[aria-label="Snippet title"]'));
  await f.dispose();
  assert.equal(stateListeners.size, 0);
  assert.equal(backListeners.size, 0);
});
test('identity change clears editor and ignores an old in-flight result', async () => {
  let release;
  const f = setup(async (method, payload) => {
    if (payload.type === 'new')
      return new Promise((resolve) => {
        release = () => resolve({ editor: { ...editor, title: 'Private previous account' } });
      });
  });
  await f.render();
  await click(f, 'New snippet');
  await f.render('session:2');
  await act(async () => release());
  assert.ok(!f.container.textContent.includes('Private previous account'));
  assert.ok(!f.container.querySelector('[aria-label="Snippet title"]'));
  await f.dispose();
});
test('native textarea change autosaves and Android back checkpoints before closing', async () => {
  const f = setup();
  await f.render();
  await click(f, 'New snippet');
  await type(f, 'Snippet title', 'Typed title');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 850));
  });
  const checkpoints = f.calls.filter((c) => c.payload.type === 'checkpoint');
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].payload.patch.title, 'Typed title');
  await act(async () => {
    assert.equal([...backListeners][0](), true);
  });
  assert.ok(!f.container.querySelector('[aria-label="Snippet title"]'));
  await f.dispose();
});
test('a failed checkpoint stays visible and does not loop retries without another edit', async () => {
  const f = setup(async (method, payload) => {
    if (payload.type === 'checkpoint') throw new Error('Storage quota reached');
  });
  await f.render();
  await click(f, 'New snippet');
  await type(f, 'Snippet title', 'Keep this');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 850));
  });
  assert.match(f.container.textContent, /Storage quota/);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  assert.equal(f.calls.filter((c) => c.payload.type === 'checkpoint').length, 1);
  await f.dispose();
});
test('Back refresh retains the current search instead of a first-render closure', async () => {
  const f = setup();
  await f.render();
  await type(f, 'Search snippets including text and furigana', 'current search');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  await click(f, 'New snippet');
  await act(async () => {
    [...backListeners][0]();
  });
  assert.equal(
    f.calls.filter((call) => call.method === 'snippets.state').at(-1).payload.query,
    'current search'
  );
  await f.dispose();
});
test.after(() => {
  dom.window.close();
  rmSync(output, { recursive: true, force: true });
});
