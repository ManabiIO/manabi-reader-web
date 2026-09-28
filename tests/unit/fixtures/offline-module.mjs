import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Load complete production modules; replace only explicitly supplied I/O boundaries.
 * This is a component fixture, not a substitute for browser/Svelte acceptance.
 */
export function loadOfflineModule(entry, { modules = {}, globals = {} } = {}) {
  const context = vm.createContext({
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    Blob: globalThis.Blob,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    TextDecoder: globalThis.TextDecoder,
    TextEncoder: globalThis.TextEncoder,
    ArrayBuffer: globalThis.ArrayBuffer,
    Uint8Array: globalThis.Uint8Array,
    DOMException: globalThis.DOMException,
    URL: globalThis.URL,
    structuredClone: globalThis.structuredClone,
    crypto: globalThis.crypto,
    ...globals
  });
  const cache = new Map();
  function load(filename) {
    let target = filename;
    if (!existsSync(target)) {
      target = [filename + '.ts', filename + '.mjs', filename.replace(/\.js$/, '.ts')].find(
        existsSync
      );
    }
    if (!target) throw new Error(`Missing source module: ${filename}`);
    if (cache.has(target)) return cache.get(target).exports;
    const module = { exports: {} };
    cache.set(target, module);
    const source = readFileSync(target, 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
      // The fixture executes CJS; do not let .mjs force preserved ESM output.
      fileName: target.replace(/\.[cm]js$/, '.js')
    });
    if (diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error))
      throw new Error(`Could not compile ${target}`);
    const require = (specifier) => {
      if (Object.hasOwn(modules, specifier)) return modules[specifier];
      if (specifier.startsWith('$lib/'))
        return load(resolve(root, 'apps/web/src/lib', specifier.slice(5)));
      if (specifier.startsWith('.')) return load(resolve(dirname(target), specifier));
      throw new Error(`Unconfigured fixture dependency: ${specifier}`);
    };
    vm.runInContext(`(function(require, module, exports) {\n${outputText}\n})`, context, {
      filename: target
    })(require, module, module.exports);
    return module.exports;
  }
  return { api: load(resolve(root, entry)), context };
}

/** Only the synchronous store surface used at these I/O boundaries is doubled. */
export function storeBoundary() {
  const writable = (initial) => {
    let value = initial;
    const subscribers = new Set();
    const store = {
      subscribe(fn) {
        subscribers.add(fn);
        fn(value);
        return () => subscribers.delete(fn);
      },
      set(next) {
        value = next;
        for (const subscriber of [...subscribers]) subscriber(value);
      },
      update(fn) {
        store.set(fn(value));
      }
    };
    return store;
  };
  const get = (store) => {
    let value;
    const stop = store.subscribe((current) => (value = current));
    stop();
    return value;
  };
  const derived = (sources, fn) => ({
    subscribe(run) {
      const refresh = () => run(fn(sources.map(get)));
      const stop = sources.map((source) => source.subscribe(refresh));
      return () => stop.forEach((unsubscribe) => unsubscribe());
    }
  });
  return { writable, get, derived };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
