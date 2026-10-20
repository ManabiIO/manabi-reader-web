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
    contents: `export {NativeSettingFieldEditor} from './apps/web/src/native-settings/NativeSettingsScreen';`,
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
        b.onResolve({ filter: /screens\/NativeScreens$|shared-ui\/ScreenStatusBar$/ }, () => ({
          path: 'unused-screens',
          namespace: 'native-test'
        }));
        b.onResolve({ filter: /RuntimeProvider\.native$/ }, () => ({
          path: 'runtime',
          namespace: 'native-test'
        }));
        b.onLoad({ filter: /.*/, namespace: 'native-test' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === 'unused-screens'
              ? `export const MenuAction=()=>null,NativeScreenHeader=()=>null,ScreenStatusBar=()=>null;`
              : path === '@expo/ui/jetpack-compose/modifiers'
                ? `export const semantics=v=>v,fillMaxWidth=()=>({}),clickable=()=>({}),testID=()=>({}),weight=()=>({});`
                : path === 'expo-router'
                  ? `export const Link=()=>null,router={}; export const useFocusEffect=()=>{};`
                  : path === 'react-native-safe-area-context'
                    ? `export const SafeAreaView=({children})=>children; export const useSafeAreaInsets=()=>({bottom:0,top:0,left:0,right:0});`
                    : path === 'theme'
                      ? `export const createUiTheme=()=>({}),UiThemeProvider=({children})=>children; export const useUiTheme=()=>({colors:{primary:'#212121',primaryForeground:'#fff',foreground:'#212121',secondary:'#eee',mutedForeground:'#666'}});`
                      : path === '@expo/ui/jetpack-compose'
                        ? `import React from 'react';export const Slider=()=>null,Switch=()=>null,Checkbox=()=>null,Row=({children})=>children,Host=Row;export const Button=({children,onClick,enabled,colors})=>React.createElement('button',{onClick,disabled:!enabled,'data-compose-colors':JSON.stringify(colors)},children);export const OutlinedButton=Button,TextButton=Button;export const Text=({children,color})=>React.createElement('span',{'data-compose-text':color},children);`
                        : path === 'runtime'
                          ? `export const useReaderRuntime=()=>globalThis.__fontRuntime;`
                          : path === '@expo/ui'
                            ? `import React from 'react'; export const Icon=()=>null; export const Picker=({children,selectedValue,enabled,onValueChange})=>React.createElement('select',{value:selectedValue,disabled:!enabled,onChange:e=>onValueChange(e.target.value)},children); Picker.Item=({value,label})=>React.createElement('option',{value},label); export const Host=({children})=>React.createElement('div',{},children);export const Button=({label,onPress,disabled})=>React.createElement('button',{onClick:onPress,disabled},label); export const TextInput=({value,onChangeText,placeholder,editable})=>{const current=React.useSyncExternalStore(value.subscribe,()=>value.value);return React.createElement('input',{'aria-label':placeholder,value:current,disabled:editable===false,onInput:e=>onChangeText(e.currentTarget.value),onChange:()=>{}})};export const useNativeState=value=>{const ref=React.useRef();if(!ref.current){let current=value;const listeners=new Set();ref.current={get value(){return current},set value(next){if(next!==current){current=next;listeners.forEach(fn=>fn())}},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)}};}return ref.current;};`
                            : `import React from 'react'; export const alerts=[]; export const Alert={alert:(...args)=>alerts.push(args)};export const View=({children,accessibilityLabel,testID})=>React.createElement('div',{'aria-label':accessibilityLabel,'data-testid':testID},children);export const Text=({children,style})=>React.createElement('span',{style},children);export const ScrollView=View,Modal=View;export const Platform={OS:'android'};export const ActivityIndicator=()=>null,useColorScheme=()=> 'light',useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const StyleSheet={create:v=>v,flatten:v=>Array.isArray(v)?Object.assign({},...v.map(x=>StyleSheet.flatten(x))):v};export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState,style,ref})=>React.createElement('button',{ref,onClick:onPress,disabled,'aria-label':accessibilityLabel,'aria-pressed':accessibilityState?.selected,style:StyleSheet.flatten(typeof style==='function'?style({pressed:false}):style)},typeof children==='function'?children({pressed:false}):children);`
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
const { NativeSettingFieldEditor } = module.exports;
async function fixture(t, key = 'fontFamilyGroupOne') {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://native.test/' });
  const old = {};
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'Node']) {
    old[key] = globalThis[key];
    globalThis[key] = dom.window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  let value = key === 'fontFamilyGroupOne' ? 'YuKyokasho' : 'System Sans';
  const label = key === 'fontFamilyGroupOne' ? 'Primary / Serif font' : 'Sans-serif font';
  let pending = false,
    accept = async () => true;
  const root = createRoot(document.getElementById('root'));
  const render = () =>
    root.render(
      React.createElement(
        React.StrictMode,
        {},
        React.createElement(NativeSettingFieldEditor, {
          field: { key, kind: 'text', label, value, enabled: true, category: 'typography' },
          data: {
            fields: [],
            fonts: {
              primary: ['Klee One', 'Noto Serif JP'],
              secondary: ['System Sans', 'Noto Sans JP'],
              effectivePrimary: 'Klee One'
            }
          },
          busy: pending,
          colors: {
            mode: 'light',
            seedColor: '#933',
            card: '#fff',
            text: '#111',
            muted: '#444',
            border: '#aaa',
            error: '#900'
          },
          act: async (action) => {
            calls.push(action);
            return accept(action);
          },
          refresh() {},
          themeActions: { disabled: false, add() {}, edit() {}, remove() {} }
        })
      )
    );
  await act(async () => render());
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of Object.keys(old)) globalThis[key] = old[key];
  });
  const button = (name) =>
    [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent) === name
    );
  return {
    calls,
    label,
    button,
    input: () => document.querySelector('input'),
    picker: () => document.querySelector('select'),
    change: async (text) =>
      act(async () => {
        const input = document.querySelector('input');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(
          input,
          text
        );
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      }),
    choose: async (text) =>
      act(async () => {
        const picker = document.querySelector('select');
        picker.value = text;
        picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      }),
    update: async (next, busy = false) =>
      act(async () => {
        value = next;
        pending = busy;
        render();
      }),
    accept: (fn) => {
      accept = fn;
    }
  };
}

test('native font field displays the saved preference and effective fallback without saving', async (t) => {
  const f = await fixture(t);
  assert.equal(f.input().value, 'YuKyokasho');
  assert.equal(f.picker().value, 'Klee One');
  assert.equal(f.button('Apply ' + f.label).disabled, true);
  assert.deepEqual(f.calls, []);
  await f.choose('Klee One');
  assert.deepEqual(f.calls, [
    { type: 'set', key: 'fontFamilyGroupOne', value: 'Klee One', expectedValue: 'YuKyokasho' }
  ]);
});
for (const key of ['fontFamilyGroupOne', 'fontFamilyGroupTwo'])
  test(`native ${key} explicit draft applies exact CSS families and Cancel never saves`, async (t) => {
    const f = await fixture(t, key),
      original = f.input().value;
    await f.change('"Local Font", serif');
    assert.equal(f.picker().disabled, true);
    assert.equal(f.button('Manage ' + f.label + ' files').disabled, true);
    assert.deepEqual(f.calls, []);
    await act(async () => f.button('Cancel edit').click());
    assert.equal(f.input().value, original);
    assert.equal(f.picker().disabled, false);
    assert.deepEqual(f.calls, []);
    await f.change('  "Local Font", serif  ');
    await act(async () => f.button('Apply ' + f.label).click());
    assert.deepEqual(f.calls, [
      { type: 'set', key, value: '  "Local Font", serif  ', expectedValue: original }
    ]);
  });

test('native font draft retains its expected saved value after an external update and a rejected Apply', async (t) => {
  const f = await fixture(t);
  await f.change('Custom');
  await f.update('External');
  assert.equal(f.input().value, 'Custom');
  assert.match(document.body.textContent, /saved value changed/);
  f.accept(async () => false);
  await act(async () => f.button('Apply ' + f.label).click());
  assert.equal(f.calls[0].expectedValue, 'YuKyokasho');
  assert.equal(f.input().value, 'Custom');
  assert.equal(f.picker().disabled, true);
  await act(async () => f.button('Cancel edit').click());
  assert.equal(f.input().value, 'External');
});

test('pending native font save disables draft editing and does not clear a newer edit revision', async (t) => {
  const f = await fixture(t);
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  f.accept(() => result);
  await f.change('First');
  await act(async () => f.button('Apply ' + f.label).click());
  await f.update('YuKyokasho', true);
  assert.equal(f.input().disabled, true);
  assert.equal(f.picker().disabled, true);
  assert.equal(f.button('Cancel edit').disabled, true);
  // An admitted event already queued before the disabled render still advances the draft revision.
  await f.change('Later');
  await act(async () => finish(true));
  await f.update('First', false);
  assert.equal(f.input().value, 'Later');
  assert.equal(f.picker().disabled, true);
});
