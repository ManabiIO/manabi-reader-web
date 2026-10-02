/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

for (const platform of ['web', 'android'])
  for (const enabled of [false, true])
    test(`${platform} root keeps ${platform === 'web' && enabled ? 'one active Slot' : 'the original native Stack'} when qualification is ${enabled}`, () => {
      const { outputText } = ts.transpileModule(
        readFileSync(new URL('../../apps/web/src/app/_layout.tsx', import.meta.url), 'utf8'),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX
          }
        }
      );
      const passthrough = ({ children }) => children;
      const dependencies = {
        'react/jsx-runtime': jsxRuntime,
        'react-native': { Platform: { OS: platform } },
        'react-native-safe-area-context': { SafeAreaProvider: passthrough },
        '../platform/RuntimeProvider': { RuntimeProvider: passthrough },
        '../runtime/web-reader-qualification': { qualifyWebReaderLifetime: enabled },
        'expo-router': {
          Slot: () => React.createElement('section', { 'data-navigator': 'slot' }),
          Stack: (props) => {
            assert.deepEqual(props.screenOptions, { headerShown: false, animation: 'none' });
            return React.createElement('section', { 'data-navigator': 'stack' });
          }
        }
      };
      const module = { exports: {} };
      compileFunction(outputText, ['require', 'module', 'exports'])(
        (name) => {
          if (name.endsWith('.css')) return {};
          assert.ok(Object.hasOwn(dependencies, name), name);
          return dependencies[name];
        },
        module,
        module.exports
      );
      const markup = renderToStaticMarkup(React.createElement(module.exports.default));
      assert.equal(
        markup,
        `<section data-navigator="${platform === 'web' && enabled ? 'slot' : 'stack'}"></section>`
      );
    });
