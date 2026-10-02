/** Execute production React components with deterministic hook lifetimes.
 * Native layout/focus remains the responsibility of the compiled-browser suite. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = new URL('../../apps/web/src/ui/dialogs.tsx', import.meta.url);
const source = readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'dialogs.tsx',
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX
  },
  reportDiagnostics: true
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);

export function dialogComponent(name, props, overrides = {}) {
  const hooks = [];
  const pendingEffects = [];
  const watchers = new Set();
  let cursor = 0;
  let disposed = false;
  let tree;
  let Component;
  const react = {
    useRef(initial) {
      const index = cursor++;
      return (hooks[index] ??= { current: initial });
    },
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [
        hooks[index].value,
        (value) => {
          if (disposed) return;
          hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;
          render();
        }
      ];
    },
    useEffect(setup, dependencies) {
      const index = cursor++;
      const previous = hooks[index];
      const same =
        previous &&
        dependencies &&
        previous.dependencies &&
        dependencies.length === previous.dependencies.length &&
        dependencies.every((value, at) => Object.is(value, previous.dependencies[at]));
      if (same) return;
      const entry = { setup, dependencies, cleanup: undefined };
      hooks[index] = entry;
      pendingEffects.push(() => {
        previous?.cleanup?.();
        entry.cleanup = setup();
      });
    }
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol.for('react.fragment') },
    '$lib/data/dialog-manager': { dialogManager: { dialogs$: {} } },
    '$lib/functions/book-security/dialog-content-security': {
      sanitizeDialogHtml: (value) => value
    },
    '$lib/data/logger': { logger: { history: [] } },
    '../runtime/use-store': { useStore: () => false },
    '$lib/data/store': { hideExternalReadHint$: {}, skipKeyDownListener$: { next() {} } },
    '$lib/data/storage/storage-source-manager': { decrypt: async () => new Uint8Array() },
    ...overrides
  };
  const module = { exports: {} };
  compileFunction(compiled.outputText, ['require', 'module', 'exports', 'window'])(
    (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Mock the external dependency ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
    {}
  );
  Component = module.exports[name];
  assert.equal(typeof Component, 'function');
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  function render() {
    cursor = 0;
    tree = expand(Component(props));
    for (const effect of pendingEffects.splice(0)) effect();
    for (const watcher of [...watchers]) watcher();
  }
  function find(predicate, node) {
    if (arguments.length === 1) node = tree;
    if (Array.isArray(node)) {
      for (const child of node) {
        const result = find(predicate, child);
        if (result) return result;
      }
      return undefined;
    }
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    return find(predicate, node.props.children);
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    return text(node.props.children);
  }
  render();
  return {
    find,
    text,
    get tree() {
      return tree;
    },
    button(label) {
      const node = find((node) => node.type === 'button' && text(node) === label);
      assert.ok(node, `Button ${label} exists`);
      return node;
    },
    input() {
      const node = find((node) => node.type === 'input' && node.props.type !== 'checkbox');
      assert.ok(node);
      return node;
    },
    change(value) {
      const input = this.input();
      input.props.onChange({ target: { value }, currentTarget: { value } });
    },
    submit() {
      const form = find((node) => node.type === 'form');
      assert.ok(form);
      return form.props.onSubmit({ preventDefault() {} });
    },
    waitUntil(predicate) {
      if (predicate()) return Promise.resolve();
      return new Promise((resolve) => {
        const check = () => {
          if (!predicate()) return;
          watchers.delete(check);
          resolve();
        };
        watchers.add(check);
      });
    },
    strictReplay() {
      for (const hook of hooks) hook?.cleanup?.();
      for (const hook of hooks) if (hook?.setup) hook.cleanup = hook.setup();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const hook of hooks) hook?.cleanup?.();
      await Promise.resolve();
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}
