/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost.test/'
});
const { window } = dom;
const { document } = window;
Object.assign(globalThis, {
  window,
  document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  ShadowRoot: window.ShadowRoot,
  IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.ResizeObserver = globalThis.ResizeObserver;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const h = React.createElement;
const expoSource = `${process.cwd()}/apps/web/node_modules/@expo/ui/src`;

// Exercise the installed universal Android adapter, modifier transformer and
// native state hook. Only the Compose/Expo module boundary is substituted here;
// this does not qualify Android rendering, accessibility or IME behavior.
const stateBoundary = `import {useRef} from 'react';
class ObservableState {
  constructor({value}){this.current=value;this.listeners=new Set();}
  getValue(){return this.current;}
  setValue({value}){queueMicrotask(()=>this.fromNative(value));}
  fromNative(value){this.current=value;for(const listener of this.listeners)listener();}
  subscribe=(listener)=>{this.listeners.add(listener);return ()=>this.listeners.delete(listener);};
}
export const requireNativeModule=()=>({ObservableState});
export const useReleasingSharedObject=(factory)=>{const ref=useRef(null);if(!ref.current)ref.current=factory();return ref.current;};`;
const nativeBoundary = `import React,{useSyncExternalStore} from 'react';
export const inspected={field:null,host:null};
export {useNativeState} from '${expoSource}/State/useNativeState.ts';
export const Host=({children,...props})=>{inspected.host=props;return <div data-host="true">{children}</div>;};
export function BasicTextField(props){
  inspected.field=props;
  const value=useSyncExternalStore(props.value.subscribe,()=>props.value.value);
  const label=props.modifiers.find(item=>item.$type==='semantics')?.contentDescription;
  return <><input aria-label={label} value={value} readOnly={props.readOnly} autoFocus={props.autoFocus}
    onInput={event=>{props.value.fromNative(event.currentTarget.value);props.onValueChange?.(event.currentTarget.value);}}
    onFocus={()=>props.onFocusChanged?.(true)} onBlur={()=>props.onFocusChanged?.(false)}/>{props.children}</>;
}
BasicTextField.DecorationBox=({children})=><div>{children}</div>;
BasicTextField.Placeholder=({children})=><span data-placeholder="true">{children}</span>;
BasicTextField.InnerTextField=()=>null;
export const Box=({children})=><div>{children}</div>;
export const Text=({children,color})=><span data-color={color}>{children}</span>;`;

async function bundle(native) {
  const built = await build({
    stdin: {
      contents: native
        ? `export {TextField} from './apps/web/src/shared-ui/TextField.tsx';
           export {TextEntry} from './apps/web/src/shared-ui/TextEntry.tsx';
           export {UiThemeProvider,createUiTheme} from './apps/web/src/shared-ui/theme';
           export {inspected} from '@expo/ui/jetpack-compose';`
        : `export {TextField} from './apps/web/src/shared-ui/TextField.web.tsx';
           export {TextEntry} from './apps/web/src/shared-ui/TextEntry.tsx';`,
      resolveDir: process.cwd()
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    conditions: ['browser'],
    resolveExtensions: native
      ? ['.android.tsx', '.tsx', '.android.ts', '.ts', '.js']
      : ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js'],
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent',
    plugins: [
      {
        name: 'text-field-platform-boundary',
        setup(b) {
          b.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path),
            external: true
          }));
          b.onResolve({ filter: /^react-native$/ }, () =>
            native
              ? { path: 'rn', namespace: 'fixture' }
              : { path: appRequire.resolve('react-native-web'), external: true }
          );
          b.onResolve({ filter: /^react-native-web$/ }, () => ({
            path: appRequire.resolve('react-native-web'),
            external: true
          }));
          if (!native) {
            b.onResolve({ filter: /^@expo\/ui$/ }, () => ({
              path: `${expoSource}/universal/index.ts`
            }));
            return;
          }
          b.onResolve({ filter: /^@expo\/ui$/ }, () => ({
            path: 'universal',
            namespace: 'fixture'
          }));
          b.onResolve({ filter: /^expo$|^@expo\/ui\/jetpack-compose$/ }, ({ path }) => ({
            path: path === 'expo' ? 'state' : 'native',
            namespace: 'fixture'
          }));
          b.onResolve({ filter: /\/optionalWorklets$/ }, () => ({
            path: 'worklets',
            namespace: 'fixture'
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'native'
                ? nativeBoundary
                : path === 'state'
                  ? stateBoundary
                  : path === 'universal'
                    ? `export {Host,useNativeState} from '@expo/ui/jetpack-compose';
                     export {TextInput} from '${expoSource}/universal/TextInput/index.android.tsx';`
                    : path === 'worklets'
                      ? 'export const worklets=undefined;'
                      : `export * from 'react-native-web';
                       export const Platform={OS:'android'};`,
            loader: 'tsx',
            resolveDir: `${process.cwd()}/apps/web`
          }));
        }
      }
    ]
  });
  const module = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
    globalThis,
    queueMicrotask,
    console,
    setTimeout,
    clearTimeout
  });
  return module.exports;
}
const native = await bundle(true);
const web = await bundle(false);

function mount(t) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return { container, render: async (element) => act(async () => root.render(element)) };
}
function edit(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
    input,
    value
  );
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('native input accepts drafts, rejects edits, receives remote values and resets without replacing focus', async (t) => {
  const { container, render } = mount(t);
  let owner;
  const changes = [];
  function Fixture({ reject = false, editable = true }) {
    const [value, setValue] = React.useState('Original');
    owner = setValue;
    return h(native.TextField, {
      label: 'Book title',
      value,
      editable,
      onChangeText(next) {
        changes.push(next);
        if (!reject) setValue(next);
      }
    });
  }
  await render(h(Fixture));
  const input = container.querySelector('input');
  await act(async () => input.focus());
  assert.equal(input.value, 'Original');
  await act(async () => edit(input, 'New draft'));
  assert.equal(input.value, 'New draft');
  await act(async () => owner('From another reader'));
  assert.equal(input.value, 'From another reader');
  await render(h(Fixture, { reject: true }));
  await act(async () => edit(input, 'Rejected'));
  assert.equal(input.value, 'From another reader');
  await act(async () => owner('Original'));
  assert.equal(input.value, 'Original');
  await render(h(Fixture, { editable: false }));
  assert.equal(native.inspected.field.readOnly, true);
  await act(async () => edit(input, 'Late callback after disabling'));
  assert.equal(input.value, 'Original');
  assert.deepEqual(changes, ['New draft', 'Rejected']);
  assert.equal(container.querySelector('input'), input);
  assert.equal(document.activeElement, input);
});

test('native input carries field semantics, search and number IME options, theme and growing layout through the real adapter', async (t) => {
  const { container, render } = mount(t);
  let submitted = 0;
  let blurred = 0;
  const show = (props = {}) =>
    render(
      h(
        native.UiThemeProvider,
        { appearance: 'dark' },
        h(native.TextField, {
          label: 'Passage',
          value: '',
          onChangeText() {},
          autoFocus: true,
          testID: 'passage-field',
          onSubmitEditing: () => submitted++,
          onBlur: () => blurred++,
          ...props
        })
      )
    );
  await show({ type: 'search', accessibilityLabel: 'Search saved text' });
  const input = container.querySelector('input');
  assert.equal(document.activeElement, input);
  assert.equal(input.getAttribute('aria-label'), 'Search saved text');
  assert.equal(native.inspected.field.keyboardOptions.imeAction, 'search');
  assert.equal(native.inspected.field.keyboardOptions.autoCorrectEnabled, false);
  assert.equal(native.inspected.field.keyboardOptions.capitalization, 'none');
  await act(async () => native.inspected.field.keyboardActions.onSearch());
  assert.equal(submitted, 1);
  const theme = native.createUiTheme('manabi-theme', 'dark');
  assert.equal(native.inspected.host.colorScheme, 'dark');
  assert.equal(native.inspected.host.seedColor, theme.seedColor);
  assert.equal(native.inspected.host.style.minHeight, 44);
  assert.equal(native.inspected.host.style.height, undefined);
  assert.equal(native.inspected.host.matchContents.vertical, true);
  assert.equal(native.inspected.field.textStyle.color, theme.colors.foreground);
  assert.ok(native.inspected.field.modifiers.some((item) => item.$type === 'fillMaxWidth'));
  assert.ok(
    native.inspected.field.modifiers.some(
      (item) => item.$type === 'testID' && item.testID === 'passage-field'
    )
  );
  await show({ type: 'number', min: 0, max: 100, step: 0.1 });
  assert.equal(native.inspected.field.keyboardOptions.keyboardType, 'decimal');
  assert.equal(native.inspected.field.keyboardOptions.imeAction, undefined);
  assert.equal(input.getAttribute('aria-label'), 'Passage');
  await show({ type: 'date' });
  assert.equal(container.querySelector('[data-placeholder]').textContent, 'YYYY-MM-DD');
  await show({ label: undefined, type: 'date', placeholder: 'Custom date format' });
  assert.equal(input.hasAttribute('aria-label'), false);
  assert.equal(container.querySelector('[data-placeholder]').textContent, 'Custom date format');
  assert.equal(container.querySelector('input'), input);
  await act(async () => input.blur());
  assert.equal(blurred, 1);
});

test('web date and number inputs retain browser constraints and update in place', async (t) => {
  const { container, render } = mount(t);
  const show = (props) =>
    render(h(web.TextField, { label: 'Reading target', onChangeText() {}, ...props }));
  await show({ type: 'number', value: '1.5', min: 1, max: 10, step: 0.5 });
  const input = container.querySelector('input');
  assert.equal(input.labels[0].textContent, 'Reading target');
  assert.equal(input.checkValidity(), true);
  await act(async () => input.focus());
  await show({ type: 'number', value: '0.5', min: 1, max: 10, step: 0.5 });
  assert.equal(input.validity.rangeUnderflow, true);
  await show({ type: 'number', value: '10.5', min: 1, max: 10, step: 0.5 });
  assert.equal(input.validity.rangeOverflow, true);
  await show({ type: 'number', value: '1.2', min: 1, max: 10, step: 0.5 });
  assert.equal(input.validity.stepMismatch, true);
  await show({ type: 'date', value: '2026-10-28', min: '2026-10-01', max: '2026-10-31' });
  assert.equal(input.type, 'date');
  assert.equal(input.checkValidity(), true);
  await show({ type: 'date', value: '2026-11-01', min: '2026-10-01', max: '2026-10-31' });
  assert.equal(input.validity.rangeOverflow, true);
  assert.equal(container.querySelector('input'), input);
  assert.equal(document.activeElement, input);
});

test('web input preserves edits, names, disabled semantics, Enter focus and default form behavior', async (t) => {
  const { container, render } = mount(t);
  const changes = [];
  let submitted = 0;
  let blurred = 0;
  let owner;
  function Fixture({ editable = true, accessibilityLabel } = {}) {
    const [value, setValue] = React.useState('Saved');
    owner = setValue;
    return h(
      'form',
      null,
      h(web.TextField, {
        label: 'Search books',
        accessibilityLabel,
        type: 'search',
        value,
        editable,
        autoFocus: true,
        testID: 'book-search',
        onChangeText(next) {
          changes.push(next);
          setValue(next);
        },
        onSubmitEditing: () => submitted++,
        onBlur: () => blurred++
      })
    );
  }
  await render(h(Fixture, { accessibilityLabel: 'Search local books' }));
  const input = container.querySelector('input');
  assert.equal(input.getAttribute('aria-label'), 'Search local books');
  assert.equal(input.dataset.testid, 'book-search');
  assert.equal(document.activeElement, input);
  await act(async () => edit(input, 'New search'));
  assert.deepEqual(changes, ['New search']);
  assert.equal(input.value, 'New search');
  const enter = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true
  });
  await act(async () => input.dispatchEvent(enter));
  assert.equal(submitted, 1);
  assert.equal(enter.defaultPrevented, false, 'the browser can still perform native submission');
  assert.equal(document.activeElement, input);
  await act(async () => owner('Remote update'));
  assert.equal(input.value, 'Remote update');
  await render(h(Fixture, { editable: false }));
  assert.equal(input.disabled, true);
  assert.equal(input.willValidate, false);
  assert.equal(input.getAttribute('aria-label'), 'Search books');
  await render(h(Fixture));
  assert.equal(container.querySelector('input'), input);
  await act(async () => input.blur());
  assert.equal(blurred, 1);
});

test('universal secure and multiline entry preserves controlled edits and real web input semantics', async (t) => {
  const { container, render } = mount(t);
  let owner;
  const changes = [];
  function Fixture({ secure = true, multiline = false, reject = false, editable = true }) {
    const [value, setValue] = React.useState('Saved');
    owner = setValue;
    return h(web.TextEntry, {
      label: 'Note contents',
      value,
      secure,
      multiline,
      editable,
      maxLength: 64,
      onChangeText(next) {
        changes.push(next);
        if (!reject) setValue(next);
      }
    });
  }
  await render(h(Fixture));
  let input = container.querySelector('input');
  assert.equal(input.type, 'password');
  assert.equal(input.maxLength, 64);
  assert.equal(
    document.getElementById(input.getAttribute('aria-labelledby')).textContent,
    'Note contents'
  );
  await act(async () => input.focus());
  await act(async () => edit(input, 'Accepted'));
  assert.equal(input.value, 'Accepted');
  await render(h(Fixture, { reject: true }));
  await act(async () => edit(input, 'Rejected'));
  assert.equal(input.value, 'Accepted');
  assert.equal(document.activeElement, input);
  await act(async () => owner('Remote update'));
  assert.equal(input.value, 'Remote update');
  await render(h(Fixture, { editable: false }));
  assert.equal(input.readOnly, true);
  await act(async () => edit(input, 'Late event'));
  assert.equal(input.value, 'Remote update');
  assert.deepEqual(changes, ['Accepted', 'Rejected']);
  await render(h(Fixture, { secure: false, multiline: true }));
  input = container.querySelector('textarea');
  assert.ok(input);
  assert.equal(input.rows, 4);
  assert.equal(
    document.getElementById(input.getAttribute('aria-labelledby')).textContent,
    'Note contents'
  );
  await act(async () => owner('Line one\nLine two'));
  assert.equal(input.value, 'Line one\nLine two');
});

test('universal Android entry uses actual Compose password transformation, multiline and disabled semantics', async (t) => {
  const { render } = mount(t);
  const show = (props) =>
    render(
      h(native.TextEntry, {
        label: 'Anki API key',
        value: 'secret',
        onChangeText() {},
        ...props
      })
    );
  await show({ secure: true, multiline: true });
  assert.equal(native.inspected.field.visualTransformation, 'password');
  assert.equal(native.inspected.field.singleLine, true);
  assert.equal(native.inspected.field.keyboardOptions.autoCorrectEnabled, false);
  assert.ok(
    native.inspected.field.modifiers.some(
      (item) => item.$type === 'semantics' && item.contentDescription === 'Anki API key'
    )
  );
  await show({ multiline: true, editable: false, maxLength: 256 });
  assert.equal(native.inspected.field.visualTransformation, undefined);
  assert.equal(native.inspected.field.readOnly, true);
  assert.equal(native.inspected.field.singleLine, false);
  assert.equal(native.inspected.field.minLines, 4);
  assert.equal(native.inspected.field.maxLength, 256);
});

test.after(() => dom.window.close());
