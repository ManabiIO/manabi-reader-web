/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createRoot } = require('react-dom/client');
const fixture = `import React,{useRef} from 'react';
const flatten=x=>Object.assign({},...(Array.isArray(x)?x.flat(Infinity):[x]).filter(Boolean));
export const StyleSheet={create:x=>x,flatten}; export const Platform={OS:'android'};
export const useColorScheme=()=>'light';
export const View=({children,style})=><div data-style={JSON.stringify(flatten(style))}>{children}</div>;
export const SafeAreaView=View,ScrollView=View;
export const Text=({children,style,accessibilityRole})=><span data-native-text="true" role={accessibilityRole==='alert'?'alert':undefined} data-style={JSON.stringify(flatten(style))}>{children}</span>;
export const Pressable=({children,style,onPress,disabled})=><button data-result="true" data-style={JSON.stringify(flatten(style))} onClick={onPress} disabled={disabled}>{children}</button>;
export const Image=({source})=><img src={source.uri}/>;
export const FlatList=({data,renderItem,ListEmptyComponent})=><div>{data.length?data.map(item=><div key={item.key}>{renderItem({item})}</div>):ListEmptyComponent}</div>;
export const Host=({children,colorScheme,seedColor})=><div data-host="true" data-mode={colorScheme} data-seed={seedColor}>{children}</div>;
export const useNativeState=value=>useRef({value}).current;
export const TextInput=({value,onChangeText})=><input value={value.value} onInput={event=>onChangeText(event.currentTarget.value)} readOnly/>;
export const ActivityIndicator=({color})=><div data-spinner={color}/>;
export const Action=({label,onPress,disabled,theme})=><button data-action="true" data-mode={theme?.mode} data-seed={theme?.seedColor} disabled={disabled} onClick={onPress}>{label}</button>;
export const AppState={addEventListener:()=>({remove(){}})};
export const router={push:()=>{}}; export const usePathname=()=>'/manage';
export const useReaderRuntime=()=>globalThis.libraryChildTheme.runtime;`;
const output = await build({
  stdin: {
    contents: `export {NativeLibraryContentSearch} from './apps/web/src/native-library/content-search';
      export {NativeEditorsPicks} from './apps/web/src/native-library/catalog';
      export {NativeBookCover} from './apps/web/src/native-library/cover';
      export {UiThemeProvider,createUiTheme} from './apps/web/src/shared-ui/theme';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  metafile: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  tsconfig: 'apps/web/tsconfig.json',
  plugins: [
    {
      name: 'native-leaves',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
          path: require.resolve(path),
          external: true
        }));
        b.onResolve(
          {
            filter:
              /^(react-native|react-native-safe-area-context|@expo\/ui|expo-router)$|\/NativeScreens$|\/RuntimeProvider\.native$/
          },
          () => ({ path: 'native', namespace: 'fixture' })
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: fixture,
          loader: 'tsx',
          resolveDir: process.cwd()
        }));
      }
    }
  ]
});
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, {
  module,
  exports: module.exports,
  require,
  globalThis,
  setTimeout,
  clearTimeout
});
const {
  NativeLibraryContentSearch,
  NativeEditorsPicks,
  NativeBookCover,
  UiThemeProvider,
  createUiTheme
} = module.exports;
const custom = {
  fontColor: '#e1f1ff',
  backgroundColor: '#111827',
  selectionFontColor: '#09121a',
  selectionBackgroundColor: '#a0d5ff',
  hintFuriganaShadowColor: '#111827',
  hintFuriganaFontColor: '#abc4d8',
  tooltipTextFontColor: '#d3e5f4'
};
const appearances = [
  { appearance: 'dark', themeId: 'manabi-theme' },
  { appearance: 'dark', themeId: 'saved-custom', customThemes: { 'saved-custom': custom } }
];
const style = (node) => JSON.parse(node.dataset.style);
async function mount(t, component, props, themeProps, command = async () => ({})) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  globalThis.libraryChildTheme = {
    runtime: { command, snapshot: { session: 'active', epoch: 1 } }
  };
  await act(async () =>
    root.render(
      React.createElement(UiThemeProvider, themeProps, React.createElement(component, props))
    )
  );
  t.after(async () => {
    await act(() => root.unmount());
    container.remove();
    delete globalThis.libraryChildTheme;
  });
  return container;
}
function assertText(container, theme) {
  for (const text of container.querySelectorAll('[data-native-text]'))
    assert.ok(
      [
        theme.colors.foreground,
        theme.colors.mutedForeground,
        theme.colors.primaryForeground
      ].includes(style(text).color),
      text.textContent
    );
}
function assertActions(container, theme) {
  const actions = container.querySelectorAll('[data-action]');
  assert.ok(actions.length);
  for (const action of actions) {
    assert.equal(action.dataset.mode, 'dark');
    assert.equal(action.dataset.seed, theme.seedColor);
  }
}
for (const themeProps of appearances) {
  const theme = createUiTheme(themeProps.themeId, 'dark', themeProps.customThemes);
  test(`${themeProps.themeId}: passage header, results, highlights, pagination and native controls follow saved dark appearance on a light OS`, async (t) => {
    const result = {
      token: 'search',
      status: 'ready',
      items: [
        {
          key: 'hit',
          bookId: 1,
          title: 'Saved book',
          section: 1,
          excerpt: 'saved passage',
          match: { start: 0, end: 5 }
        }
      ],
      total: 21,
      offset: 0,
      limit: 20
    };
    const container = await mount(
      t,
      NativeLibraryContentSearch,
      { view: { collection: 'books' }, disabled: false },
      themeProps,
      async () => result
    );
    assert.equal(style(container.firstChild).backgroundColor, theme.colors.background);
    const host = container.querySelector('[data-host]');
    assert.equal(host.dataset.mode, 'dark');
    assert.equal(host.dataset.seed, theme.seedColor);
    const input = container.querySelector('input');
    await act(() => {
      input.value = 'saved';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const search = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Search passages'
    );
    assert.equal(search.disabled, false);
    await act(async () => search.click());
    assertText(container, theme);
    assertActions(container, theme);
    const card = container.querySelector('[data-result]');
    assert.ok(card);
    assert.equal(style(card).backgroundColor, theme.colors.card);
    assert.equal(style(card).borderColor, theme.colors.border);
    const match = [...container.querySelectorAll('[data-native-text]')].find(
      (node) => node.textContent === 'saved'
    );
    assert.equal(style(match).backgroundColor, theme.colors.primary);
    assert.equal(style(match).color, theme.colors.primaryForeground);
    assert.match(container.textContent, /Previous passages.*1–1 of 21.*Next passages/);
  });
  test(`${themeProps.themeId}: catalog modal and its cards and actions inherit the saved theme`, async (t) => {
    const ready = {
      token: 'catalog',
      status: 'ready',
      items: [{ key: 'book', title: 'Public title', author: 'Writer', summary: 'Summary' }],
      total: 21,
      offset: 0,
      limit: 20
    };
    const container = await mount(
      t,
      NativeEditorsPicks,
      { close() {} },
      themeProps,
      async () => ready
    );
    assert.equal(style(container.firstChild).backgroundColor, theme.colors.background);
    assertText(container, theme);
    assertActions(container, theme);
    const title = [...container.querySelectorAll('[data-native-text]')].find(
      (node) => node.textContent === 'Public title'
    );
    assert.equal(style(title.parentElement).backgroundColor, theme.colors.card);
    assert.equal(style(title.parentElement).borderColor, theme.colors.border);
  });
  test(`${themeProps.themeId}: cover placeholder follows semantic colors with bounded book proportions`, async (t) => {
    const container = await mount(
      t,
      NativeBookCover,
      { title: 'Cover title', creators: 'Writer', blurred: false, grid: true },
      themeProps
    );
    const frame = style(container.firstChild);
    assert.equal(frame.width, '100%');
    assert.equal(frame.height, undefined);
    assert.equal(frame.aspectRatio, 2 / 3);
    assert.equal(frame.maxWidth, 200);
    assert.equal(frame.alignSelf, 'center');
    assert.equal(frame.backgroundColor, theme.colors.muted);
    assertText(container, theme);
  });
}
test('native themed child surfaces remain free of DOM, storage and dictionary owners', () => {
  assert.ok(
    !Object.keys(output.metafile.inputs).some((path) =>
      /lib\/data\/store|data\/database|\.dom\.|manabitan|yomitan/.test(path)
    )
  );
});
