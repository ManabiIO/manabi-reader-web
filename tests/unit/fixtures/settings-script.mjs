/** Execute complete active React controllers with declared browser/storage boundaries. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import * as dimensions from '../../../apps/web/src/lib/components/settings/dimension-presets.ts';
import * as fontActions from '../../../apps/web/src/lib/components/settings/user-font-actions.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { BehaviorSubject } = require('rxjs');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot = resolve(root, 'apps/web/src');
const compiledModules = new Map();

// Keep the original scenario identifiers, but never read or evaluate their retired files.
const controllers = {
  'settings-dimension-content.svelte': 'createSettingsDimensionContent',
  'settings-user-font-add.svelte': 'createSettingsUserFontAdd',
  'settings-user-font-dialog.svelte': 'createSettingsUserFontDialog',
  'settings-sync-dialog.svelte': 'createSettingsSyncDialog',
  'settings-storage-source.svelte': 'createSettingsStorageSource',
  'settings-reading-goals-merge.svelte': 'createSettingsReadingGoalsMerge'
};

function compile(path) {
  if (!compiledModules.has(path)) {
    assert.ok(path.endsWith('.ts'), 'Only complete production TypeScript modules may execute');
    const { outputText, diagnostics } = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: path,
      reportDiagnostics: true
    });
    assert.deepEqual(diagnostics, [], `Controller transpilation failed: ${path}`);
    compiledModules.set(path, outputText);
  }
  return compiledModules.get(path);
}

export const storageTypes = (() => {
  const module = { exports: {} };
  const path = resolve(sourceRoot, 'lib/data/storage/storage-types.ts');
  compileFunction(compile(path), ['module', 'exports'], { filename: path })(module, module.exports);
  return module.exports;
})();

/**
 * Browser APIs and persistence may be controlled by a scenario. Controller logic,
 * derived effects, readerTick, store observation and teardown are production code.
 */
export function settingsScript(file, initial, bindings, expose, mutable) {
  assert.ok(Object.hasOwn(controllers, file), `Unknown settings controller: ${file}`);
  const path = resolve(sourceRoot, 'settings-react', file.replace('.svelte', '-controller.ts'));
  const events = [];
  const modules = new Map();
  const stores = Object.fromEntries(
    Object.entries({ $isOnline$: false, ...bindings })
      .filter(([name]) => name.startsWith('$') && name.endsWith('$'))
      .map(([name, value]) => [name.slice(1), new BehaviorSubject(value)])
  );
  const unavailable = (name) => () => {
    throw new Error(`Unexpected infrastructure call: ${name}`);
  };
  const dependencies = {
    react: require('react'),
    rxjs: require('rxjs'),
    '$app/environment': { browser: bindings.browser ?? false },
    '$lib/data/store': { ...stores, database: bindings.database ?? {} },
    '$lib/components/settings/dimension-presets': dimensions,
    '$lib/components/settings/user-font-actions': fontActions,
    '$lib/data/env': { gDriveRevokeEndpoint: 'https://oauth2.googleapis.com/revoke' },
    '$lib/data/storage/storage-handler-factory': {
      getStorageHandler: bindings.getStorageHandler ?? unavailable('getStorageHandler')
    },
    '$lib/data/storage/storage-oauth-manager': {
      StorageOAuthManager: bindings.StorageOAuthManager ?? {
        revokeToken: unavailable('revokeToken')
      },
      storageOAuthTokens: bindings.storageOAuthTokens ?? new Map()
    },
    '$runtime/../ui/dialogs': {},
    '$lib/data/dialog-manager': {},
    '$lib/data/logger': {},
    '$lib/data/storage/storage-view': {}
  };
  const globals = {
    window: bindings.window ?? {},
    caches: bindings.caches,
    requestAnimationFrame: bindings.requestAnimationFrame ?? ((callback) => setImmediate(callback))
  };
  function load(modulePath) {
    if (modules.has(modulePath)) return modules.get(modulePath).exports;
    const module = { exports: {} };
    modules.set(modulePath, module);
    compileFunction(
      compile(modulePath),
      ['require', 'module', 'exports', ...Object.keys(globals)],
      {
        filename: modulePath
      }
    )(
      (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        const dependencyPath = name.startsWith('$lib/')
          ? resolve(sourceRoot, 'lib', name.slice('$lib/'.length)) + '.ts'
          : name.startsWith('.')
            ? resolve(dirname(modulePath), name) + '.ts'
            : undefined;
        assert.ok(dependencyPath, `Unexpected dependency in ${modulePath}: ${name}`);
        // Reuse the same real font mutation queue across every fixture instance.
        if (dependencyPath === resolve(sourceRoot, 'lib/components/settings/user-font-actions.ts'))
          return fontActions;
        if (dependencyPath === resolve(sourceRoot, 'lib/components/settings/dimension-presets.ts'))
          return dimensions;
        return load(dependencyPath);
      },
      module,
      module.exports,
      ...Object.values(globals)
    );
    return module.exports;
  }
  const context = new Map();
  const api = load(path)[controllers[file]](
    initial,
    (name, detail) => events.push(detail === undefined ? [name] : [name, detail]),
    {
      getContext: (key) => context.get(key),
      setContext: (key, value) => {
        context.set(key, value);
        return value;
      }
    }
  );
  for (const [name, value] of Object.entries(initial)) {
    assert.ok(
      Object.getOwnPropertyDescriptor(api, name)?.set,
      `Missing controller setter: ${name}`
    );
    api[name] = value;
  }
  const read = (name) => {
    if (Object.hasOwn(api, name)) return api[name];
    // The add form intentionally reads/writes the live catalogue without subscribing.
    const store = stores[name.slice(1)];
    assert.ok(name.startsWith('$') && store, `Missing controller member: ${name}`);
    return store.getValue();
  };
  const set = Object.fromEntries(
    mutable.map((name) => [
      name,
      (value) => {
        if (name.startsWith('$') && stores[name.slice(1)]) stores[name.slice(1)].next(value);
        else {
          assert.ok(
            Object.getOwnPropertyDescriptor(api, name)?.set,
            `Missing controller setter: ${name}`
          );
          api[name] = value;
        }
      }
    ])
  );
  api.controller.prepare();
  return {
    ...Object.fromEntries(expose.map((name) => [name, () => read(name)])),
    set,
    instance: api,
    controller: api.controller,
    sourcePath: path,
    stores,
    events,
    fonts: stores.userFonts$,
    reactive: () => api.controller.prepare(),
    async mount() {
      api.controller.start();
    },
    dispose: () => api.controller.destroy()
  };
}
