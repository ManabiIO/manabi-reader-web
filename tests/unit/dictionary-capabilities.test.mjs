/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { queryTask } from '../../apps/web/src/lib/search/query-task.mjs';
import { validateProvider } from '../../apps/web/src/lib/preprocessing/contracts.mjs';

function production(path, imports = {}) {
  const filename = new URL('../../apps/web/src/' + path, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename.pathname,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    },
    reportDiagnostics: true
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const capabilities = production('lib/search/dictionary-provider.ts');
const { validateDictionaryRuntime } = production('lib/search/validate-dictionary-provider.ts', {
  '../preprocessing/contracts.mjs': { validateProvider }
});
const observable = production('library-react/observable-controller.ts');
function runtime(metadata) {
  return {
    ...(metadata === undefined ? {} : { capabilities: metadata }),
    client: Object.fromEntries(
      [
        'status',
        'search',
        'importDictionary',
        'deleteDictionary',
        'setEnabled',
        'recordDefaultInstall',
        'close'
      ].map((name) => [name, async () => ({ dictionaries: [], preferences: { disabled: [] } })])
    ),
    render() {},
    installDefault() {},
    recommendations() {}
  };
}
function controller(selected) {
  const { DictionaryController } = production('library-react/dictionary-controller.ts', {
    '$lib/search/dictionary-provider': capabilities,
    '$lib/search/dictionary-runtime': {},
    '$lib/search/query-task.mjs': { queryTask },
    './observable-controller': observable
  });
  const result = new DictionaryController();
  result.mounted = true;
  result.full = true;
  result.lease = { get: async () => selected };
  return result;
}
const { DictionaryView } = production('library-react/dictionary.tsx', {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  './dictionary.css': {},
  './dictionary-controller': {},
  './use-controller': {},
  './primitives': { Action: () => null }
});
function markup(c) {
  return renderToStaticMarkup(React.createElement(DictionaryView, { c }));
}
function emptyResult(c) {
  c.state = {
    state: 'ready',
    value: {
      dictionaryCount: 1,
      preview: { items: [] },
      prefix: false
    }
  };
}

test('contract-v1 providers retain default-install and prefix UI without new metadata', async () => {
  const selected = runtime();
  validateDictionaryRuntime(selected);
  const c = controller(selected);
  await c.refreshStatus();
  emptyResult(c);
  const html = markup(c);
  assert.match(html, /Install Jitendex/);
  assert.match(html, /trailing \*/);
  assert.deepEqual(c.capabilities, { prefixSearch: true, defaultInstall: true });
});

test('exact-only providers hide unsupported actions and hints while retaining ZIP import', async () => {
  const selected = runtime(Object.freeze({ prefixSearch: false, defaultInstall: false }));
  validateDictionaryRuntime(selected);
  const c = controller(selected);
  await c.refreshStatus();
  emptyResult(c);
  const html = markup(c);
  assert.doesNotMatch(html, /Jitendex|trailing \*|prefix search/);
  assert.match(html, /Import dictionary ZIP/);
  assert.match(html, /Try kana or another spelling/);
});

test('default-install opt-out is enforced after opening the provider, before download or import', async () => {
  const selected = runtime({ defaultInstall: false });
  let called = 0;
  selected.installDefault = selected.client.importDictionary = () => {
    called++;
  };
  const c = controller(selected);
  await c.install();
  assert.equal(called, 0);
  assert.equal(c.message, 'Choose a dictionary ZIP to install.');
  assert.equal(c.installing, false);
});

test('unsupported default installation does not disable importing a user-selected ZIP', async () => {
  const selected = runtime({ defaultInstall: false });
  const zip = new Blob(['dictionary']);
  let imported;
  selected.installDefault = () => assert.fail('No default download');
  selected.client.importDictionary = async (blob) => {
    imported = blob;
    return { summary: { title: 'Local dictionary' }, warnings: [], cancelledAfterCommit: false };
  };
  const c = controller(selected);
  c.reopenRuntime = () => {};
  await c.install(zip);
  assert.equal(imported, zip);
  assert.match(c.message, /Installed Local dictionary/);
});

test('capabilities admit partial boolean metadata and reject malformed declarations', () => {
  validateDictionaryRuntime(runtime({ defaultInstall: false }));
  assert.deepEqual(capabilities.dictionaryCapabilities(runtime({ defaultInstall: false })), {
    prefixSearch: true,
    defaultInstall: false
  });
  for (const invalid of [null, [], 'none', { prefixSearch: 'false' }, { defaultInstall: 0 }])
    assert.throws(() => validateDictionaryRuntime(runtime(invalid)), /dictionary capabilit/);
});
