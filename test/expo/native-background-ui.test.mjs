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
    contents: `export {NativeBackgroundManager} from './apps/web/src/native-settings/NativeBackgroundManager'; export {NativeSavedBackground} from './apps/web/src/native-settings/NativeSavedBackground'; export {alerts} from 'react-native';`,
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
              /^(react-native|react-native-safe-area-context|expo-router|@expo\/ui(?:\/jetpack-compose)?)$/
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
            path === 'expo-router'
              ? `export const Link=()=>null;`
              : path === 'react-native-safe-area-context'
                ? `export const useSafeAreaInsets=()=>({bottom:0,top:0,left:0,right:0});`
                : path === 'theme'
                  ? `export const useUiTheme=()=>({colors:{primary:'#212121',primaryForeground:'#fff',foreground:'#212121',secondary:'#eee',mutedForeground:'#666'}});`
                  : path === '@expo/ui/jetpack-compose'
                    ? `import React from 'react';export const Button=({children,onClick,enabled,colors})=>React.createElement('button',{onClick,disabled:!enabled,'data-compose-colors':JSON.stringify(colors)},children);export const OutlinedButton=Button,TextButton=Button;export const Text=({children,color})=>React.createElement('span',{'data-compose-text':color},children);`
                    : path === 'runtime'
                      ? `export const useReaderRuntime=()=>globalThis.__backgroundRuntime;`
                      : path === '@expo/ui'
                        ? `import React from 'react'; export const Icon=()=>null; export const Host=({children})=>React.createElement('div',{},children);export const Button=({label,onPress,disabled})=>React.createElement('button',{onClick:onPress,disabled},label); export const TextInput=({value,onChangeText,placeholder,editable})=>React.createElement('input',{'aria-label':placeholder,value:value.value,disabled:editable===false,onInput:e=>onChangeText(e.currentTarget.value),onChange:()=>{}});export const useNativeState=value=>React.useRef({value}).current;`
                        : `import React from 'react'; export const alerts=[]; export const Alert={alert:(...args)=>alerts.push(args)};export const View=({children})=>React.createElement('div',{},children);export const Text=({children,style})=>React.createElement('span',{style},children);export const ScrollView=View,Modal=View;export const Image=({source,onError,testID})=>React.createElement('img',{src:source.uri,onError,'data-testid':testID});export const Platform={OS:'android'};export const StyleSheet={create:v=>v,flatten:v=>Array.isArray(v)?Object.assign({},...v.map(x=>StyleSheet.flatten(x))):v};export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState,style,ref})=>React.createElement('button',{ref,onClick:onPress,disabled,'aria-label':accessibilityLabel,'aria-pressed':accessibilityState?.selected,style:StyleSheet.flatten(typeof style==='function'?style({pressed:false}):style)},typeof children==='function'?children({pressed:false}):children);`
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
const { NativeBackgroundManager, NativeSavedBackground, alerts } = module.exports;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const state = () => ({
  slots: ['library', 'reader'].flatMap((target) =>
    ['light', 'dark'].map((mode) => ({
      target,
      mode,
      present: target === 'library' && mode === 'light',
      name: target === 'library' && mode === 'light' ? 'saved.png' : ''
    }))
  )
});
async function fixture(t, { read, importBackground, renderer = false } = {}) {
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
  globalThis.__backgroundRuntime = {
    snapshot: { session: 'owner', epoch: 0 },
    command: async (method, payload) => {
      calls.push({ method, payload });
      return read
        ? read(method, payload)
        : method === 'appearance.background.read'
          ? { ...payload, image: null, fade: 0.4 }
          : state();
    },
    importBackground: importBackground ?? (async () => false)
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
  const render = (props = {}) =>
    root.render(
      React.createElement(
        React.StrictMode,
        {},
        React.createElement(renderer ? NativeSavedBackground : NativeBackgroundManager, {
          target: 'library',
          mode: 'light',
          ...props,
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
    delete globalThis.__backgroundRuntime;
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

test('shared native background editor reads once in StrictMode and removes only the named mode', async (t) => {
  const f = await fixture(t);
  assert.equal(f.calls.filter((c) => c.method === 'settings.backgrounds.read').length, 1);
  assert.equal(f.calls.filter((c) => c.method === 'appearance.background.read').length, 4);
  assert.ok(f.button('Choose dark book reader background'));
  await act(async () => f.button('Remove light book browser background').click());
  assert.deepEqual(
    f.calls.filter((c) => c.method === 'settings.backgrounds.action').map((c) => c.payload),
    [{ type: 'remove', target: 'library', mode: 'light' }]
  );
});
test('closing native backgrounds aborts the pending picker/upload and cannot issue a stale reload', async (t) => {
  const pending = deferred();
  let captured;
  const f = await fixture(t, {
    importBackground: async (slot, signal) => {
      captured = { slot, signal };
      await pending.promise;
      return true;
    }
  });
  const before = f.calls.length;
  await act(async () => f.button('Choose dark book reader background').click());
  assert.deepEqual(captured.slot, { target: 'reader', mode: 'dark' });
  await act(async () => f.button('Close background images').click());
  assert.equal(captured.signal.aborted, true);
  await act(async () => pending.resolve());
  assert.equal(f.calls.length, before);
  assert.equal(f.closeCount, 1);
});
test('native background mutation failure requires explicit refresh without replaying the mutation', async (t) => {
  const f = await fixture(t, {
    read: async (method, payload) => {
      if (method === 'settings.backgrounds.action') throw new Error('Storage unavailable');
      return method === 'appearance.background.read'
        ? { ...payload, image: null, fade: 0.4 }
        : state();
    }
  });
  await act(async () => f.button('Remove light book browser background').click());
  assert.equal(f.button('Choose light book browser background').disabled, true);
  assert.match(document.body.textContent, /Refresh saved backgrounds before retrying/);
  await act(async () => f.button('Refresh saved backgrounds').click());
  assert.equal(f.button('Choose light book browser background').disabled, false);
  assert.equal(f.calls.filter((c) => c.method === 'settings.backgrounds.action').length, 1);
});
test('native background account replacement cancels the old upload before loading the replacement', async (t) => {
  const pending = deferred();
  let signal;
  const f = await fixture(t, {
    importBackground: async (_slot, s) => {
      signal = s;
      await pending.promise;
      return true;
    }
  });
  await act(async () => f.button('Choose light book browser background').click());
  globalThis.__backgroundRuntime.snapshot = { session: 'owner', epoch: 2 };
  await act(async () => f.render());
  assert.equal(signal.aborted, true);
  const reads = f.calls.length;
  await act(async () => pending.resolve());
  assert.equal(f.calls.length, reads);
});

const resource = (mode, uri = 'data:image/png;base64,AQID') => ({
  target: 'library',
  mode,
  fade: 0.4,
  image: { uri, width: 1, height: 1 }
});
test('native Library hides an old mode immediately and ignores its late resource response', async (t) => {
  const reads = [];
  const f = await fixture(t, {
    renderer: true,
    read: async (_method, payload) => {
      const pending = deferred();
      reads.push({ ...pending, payload });
      return pending.promise;
    }
  });
  await act(async () => f.render({ mode: 'dark' }));
  assert.equal(document.querySelector('img'), null);
  await act(async () => reads.at(-1).resolve(resource('dark')));
  assert.ok(document.querySelector('img'));
  const uri = document.querySelector('img').getAttribute('src');
  await act(async () => {
    for (const read of reads.filter((r) => r.payload.mode === 'light'))
      read.resolve(resource('light', 'data:image/png;base64,BAUG'));
  });
  assert.equal(document.querySelector('img').getAttribute('src'), uri);
  globalThis.__backgroundRuntime.snapshot = { session: 'replacement', epoch: 1 };
  await act(async () => f.render({ mode: 'dark' }));
  assert.equal(document.querySelector('img'), null, 'No old account image while replacement loads');
  await act(async () => reads.at(-1).resolve({ ...resource('dark'), image: null }));
  assert.equal(document.querySelector('img'), null);
});
test('native Library decode failure hides the image and a new revision can retry', async (t) => {
  const f = await fixture(t, {
    renderer: true,
    read: async (_method, payload) => resource(payload.mode)
  });
  await act(async () => document.querySelector('img').dispatchEvent(new window.Event('error')));
  assert.equal(document.querySelector('img'), null);
  globalThis.__backgroundRuntime.snapshot = { session: 'owner', epoch: 0, backgroundRevision: 1 };
  await act(async () => f.render());
  assert.ok(document.querySelector('img'));
  await act(async () => f.render({ active: false }));
  assert.equal(document.querySelector('img'), null);
});
