/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const compiled = await build({
  stdin: {
    contents: `export {NativeFontManager} from './apps/web/src/native-settings/NativeFontManager'; export {alerts} from 'react-native';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  loader: { '.xml': 'text' },
  plugins: [
    {
      name: 'native-view-boundaries',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(react-native|react-native-safe-area-context|expo-router|@expo\/ui(?:\/jetpack-compose(?:\/modifiers)?)?)$/
          },
          (args) => ({ path: args.path, namespace: 'native-test' })
        );
        b.onResolve({ filter: /^(?:\.\/theme)$|shared-ui\/theme$/ }, () => ({
          path: 'theme',
          namespace: 'native-test'
        }));
        b.onResolve({ filter: /RuntimeProvider\.native$/ }, () => ({
          path: 'runtime',
          namespace: 'native-test'
        }));
        b.onLoad({ filter: /.*/, namespace: 'native-test' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === '@expo/ui/jetpack-compose/modifiers'
              ? `export const semantics=value=>({type:'semantics',...value});`
              : path === 'expo-router'
                ? `export const Link=()=>null;`
                : path === 'react-native-safe-area-context'
                  ? `export const useSafeAreaInsets=()=>({bottom:0,top:0,left:0,right:0});`
                  : path === 'theme'
                    ? `export const useUiTheme=()=>({colors:{primary:'#212121',primaryForeground:'#fff',foreground:'#212121',secondary:'#eee',mutedForeground:'#666'}});`
                    : path === '@expo/ui/jetpack-compose'
                      ? `import React from 'react';export const Button=({children,onClick,enabled,colors})=>React.createElement('button',{onClick,disabled:!enabled,'data-compose-colors':JSON.stringify(colors)},children);export const OutlinedButton=Button,TextButton=Button;export const Text=({children,color})=>React.createElement('span',{'data-compose-text':color},children);`
                      : path === 'runtime'
                        ? `export const useReaderRuntime=()=>globalThis.__fontRuntime;`
                        : path === '@expo/ui'
                          ? `import React from 'react'; export const Icon=()=>null; export const Host=({children})=>React.createElement('div',{},children);export const Button=({label,onPress,disabled})=>React.createElement('button',{onClick:onPress,disabled},label); export const TextInput=({value,onChangeText,placeholder,editable,modifiers})=>React.createElement('input',{'aria-label':modifiers?.find(item=>item.type==='semantics')?.contentDescription,value:value.value,disabled:editable===false,onInput:e=>onChangeText(e.currentTarget.value),onChange:()=>{}});export const useNativeState=value=>React.useRef({value}).current;`
                          : `import React from 'react'; export const alerts=[]; export const Alert={alert:(...args)=>alerts.push(args)};export const View=({children})=>React.createElement('div',{},children);export const Text=({children,style})=>React.createElement('span',{style},children);export const ScrollView=View,Modal=View;export const Platform={OS:'android'};export const StyleSheet={create:v=>v,flatten:v=>Array.isArray(v)?Object.assign({},...v.map(x=>StyleSheet.flatten(x))):v};export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState,style,ref})=>React.createElement('button',{ref,onClick:onPress,disabled,'aria-label':accessibilityLabel,'aria-pressed':accessibilityState?.selected,style:StyleSheet.flatten(typeof style==='function'?style({pressed:false}):style)},typeof children==='function'?children({pressed:false}):children);`
        }));
      }
    }
  ]
});
const module = { exports: {} };
vm.runInThisContext('(function(require,module,exports){' + compiled.outputFiles[0].text + '\n})')(
  require,
  module,
  module.exports
);
const { NativeFontManager, alerts } = module.exports;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const state = (token) => ({
  token,
  fonts: [{ key: 'font_0', name: 'Face', fileName: 'face.woff2', available: true }],
  selected: { primary: 'Built-in', secondary: 'Sans' }
});
async function fixture(t, { read, importFont } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://native.test/' });
  const old = {};
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'Node']) {
    old[key] = globalThis[key];
    globalThis[key] = dom.window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  let closeCount = 0,
    changes = 0;
  globalThis.__fontRuntime = {
    snapshot: { session: 'owner', epoch: 0 },
    command: async (method, payload) => {
      calls.push({ method, payload });
      return read ? read(method, payload) : state('token_' + calls.length);
    },
    importFont: importFont ?? (async () => false)
  };
  const root = createRoot(document.getElementById('root'));
  const colors = {
    background: '#fff',
    card: '#fff',
    text: '#111',
    muted: '#444',
    border: '#aaa',
    error: '#900',
    mode: 'light',
    seedColor: '#933'
  };
  const render = () =>
    root.render(
      React.createElement(
        React.StrictMode,
        {},
        React.createElement(NativeFontManager, {
          family: 'primary',
          colors,
          onClose: () => closeCount++,
          onChanged: () => changes++
        })
      )
    );
  await act(async () => render());
  let mounted = true;
  const unmount = async () => {
    if (mounted) {
      mounted = false;
      await act(async () => root.unmount());
      await Promise.resolve();
    }
  };
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const key of Object.keys(old)) globalThis[key] = old[key];
    delete globalThis.__fontRuntime;
    alerts.length = 0;
  });
  const button = (name) =>
    [...document.querySelectorAll('button')].find(
      (button) => (button.getAttribute('aria-label') ?? button.textContent) === name
    );
  return {
    calls,
    button,
    render,
    unmount,
    get closeCount() {
      return closeCount;
    },
    get changes() {
      return changes;
    },
    input: async (text) =>
      act(async () => {
        const input = document.querySelector('input');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(
          input,
          text
        );
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      })
  };
}
test('native font manager StrictMode owns one initial read and selection closes only after acknowledgment', async (t) => {
  const f = await fixture(t);
  assert.equal(f.calls.length, 1);
  await act(async () => f.button('Use Face').click());
  assert.equal(f.calls.filter((c) => c.method === 'settings.fonts.action').length, 1);
  assert.equal(f.changes, 1);
  assert.equal(f.closeCount, 1);
});
test('a delayed native remove confirmation cannot act for a replacement account', async (t) => {
  const f = await fixture(t);
  await act(async () => f.button('Remove Face').click());
  const confirm = alerts.at(-1)[2].find((item) => item.text === 'Remove').onPress;
  globalThis.__fontRuntime.snapshot = { session: 'owner', epoch: 2 };
  await act(async () => f.render());
  await act(async () => confirm());
  assert.equal(f.calls.filter((c) => c.method === 'settings.fonts.action').length, 0);
});
test('unmount cancels the picker/upload and ignores its late response without issuing a stale follow-up read', async (t) => {
  const pending = deferred();
  let signal;
  const f = await fixture(t, {
    importFont: async (_name, value) => {
      signal = value;
      await pending.promise;
      return true;
    }
  });
  await act(async () => f.button('Custom font views: Add font').click());
  await f.input('Custom');
  await act(async () => f.button('Choose font file and save').click());
  assert.ok(signal);
  await f.unmount();
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve());
  assert.equal(f.calls.length, 1);
  assert.equal(f.changes, 0);
});
test('failed mutations require an explicit successful refresh before a retry', async (t) => {
  const f = await fixture(t, {
    read: async (method) => {
      if (method === 'settings.fonts.action') throw new Error('Cache unavailable');
      return state('retry_token');
    }
  });
  await act(async () => f.button('Use Face').click());
  assert.equal(f.button('Use Face').disabled, true);
  assert.match(document.body.textContent, /Cache unavailable/);
  assert.equal(f.closeCount, 0);
  await act(async () => f.button('Refresh stored fonts').click());
  assert.equal(f.button('Use Face').disabled, false);
});

test('shared manager opens the import form explicitly, with a neutral Compose picker action', async (t) => {
  const f = await fixture(t);
  assert.equal(document.querySelector('input'), null);
  await act(async () => f.button('Custom font views: Add font').click());
  const picker = f.button('Choose font file and save');
  assert.ok(picker);
  assert.equal(picker.disabled, true, 'name is required before choosing a file');
  const colors = JSON.parse(picker.getAttribute('data-compose-colors'));
  assert.equal(colors.containerColor, 'transparent');
  assert.equal(colors.contentColor, '#212121');
  assert.equal(colors.disabledContentColor, '#666');
  await f.input('Qualification font 1a11e3d6df1961cc87bc906a9a7ce962');
  assert.equal(document.querySelector('input').getAttribute('aria-label'), 'Font name');
  assert.equal(
    document.querySelector('input').value,
    'Qualification font 1a11e3d6df1961cc87bc906a9a7ce962'
  );
  assert.equal(picker.disabled, false);
  assert.equal(f.calls.length, 1, 'opening and typing never saves');
});

test('missing files remain listed and removable without enabling selection', async (t) => {
  const f = await fixture(t, {
    read: async () => ({
      ...state('missing'),
      fonts: [{ ...state('missing').fonts[0], available: false }]
    })
  });
  assert.equal(f.button('Use Face').disabled, true);
  assert.equal(f.button('Remove Face').disabled, false);
  assert.match(document.body.textContent, /File unavailable/);
  await act(async () => f.button('Use Face').click());
  assert.equal(f.calls.length, 1);
});

test('a cancelled picker retains the name and Add view without selecting or refreshing', async (t) => {
  const f = await fixture(t);
  await act(async () => f.button('Custom font views: Add font').click());
  await f.input('Cancelled draft');
  await act(async () => f.button('Choose font file and save').click());
  assert.equal(document.querySelector('input').value, 'Cancelled draft');
  assert.equal(f.button('Custom font views: Add font').getAttribute('aria-pressed'), 'true');
  assert.equal(f.calls.length, 1);
  assert.equal(f.changes, 0);
});

test('an acknowledged import returns to Stored without selecting the imported font', async (t) => {
  const pending = deferred();
  let imports = 0;
  const f = await fixture(t, {
    importFont: async () => {
      imports++;
      await pending.promise;
      return true;
    }
  });
  await act(async () => f.button('Custom font views: Add font').click());
  await f.input('New font');
  await act(async () => {
    f.button('Choose font file and save').click();
    f.button('Choose font file and save').click();
  });
  assert.equal(imports, 1);
  assert.equal(f.button('Custom font views: Stored fonts').disabled, true);
  assert.equal(document.querySelector('input').disabled, true);
  await act(async () => pending.resolve());
  assert.equal(document.querySelector('input'), null);
  assert.equal(f.button('Custom font views: Stored fonts').getAttribute('aria-pressed'), 'true');
  assert.equal(f.calls.filter((call) => call.method === 'settings.fonts.action').length, 0);
  assert.equal(f.changes, 1);
  assert.equal(f.closeCount, 0);
});
