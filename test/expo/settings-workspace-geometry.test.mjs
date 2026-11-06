/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { act } from 'react';
      import { createRoot } from 'react-dom/client';
      import { SettingsWorkspace } from './apps/web/src/features/settings/SettingsWorkspace';
      import * as layout from './apps/web/src/features/settings/workspace-layout';
      const root = createRoot(document.getElementById('root'));
      window.renderSettings = scale => {
        window.fontScale = scale;
        act(() => root.render(<React.StrictMode><SettingsWorkspace layout={layout}
          filter={{category:'typography',query:''}} onSearch={()=>{}} onCategory={()=>{}}
          resultText="" saveDescription="Saved locally"><div>Editor</div>
        </SettingsWorkspace></React.StrictMode>));
      };
      window.measureSettings = width => act(() => window.workspaceLayout({nativeEvent:{layout:{width}}}));
      window.disposeSettings = () => act(() => root.unmount());
    `,
    resolveDir: process.cwd(),
    loader: 'tsx'
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'native-layout-host',
      setup(b) {
        b.onResolve(
          { filter: /^react-native$|^@expo\/ui$|shared-ui\/(?:theme|ActionButton)$/ },
          ({ path }) => ({
            path,
            namespace: 'layout-host'
          })
        );
        b.onLoad({ filter: /.*/, namespace: 'layout-host' }, ({ path }) => ({
          loader: 'tsx',
          resolveDir: process.cwd(),
          contents:
            path === 'react-native'
              ? `
          import React from 'react';
          const flatten = value => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity) : [value]).filter(Boolean));
          export function View({children,style,onLayout}) {
            if (onLayout) window.workspaceLayout = onLayout;
            const s = flatten(style);
            return <div data-workspace={onLayout ? '' : undefined}
              data-direction={s.flexDirection} data-width={s.width}>{children}</div>;
          }
          export const Text = ({children}) => <span>{children}</span>;
          export const ScrollView = ({children,horizontal}) => <div data-horizontal={horizontal}>{children}</div>;
          export const StyleSheet = {create:v=>v};
          export const useWindowDimensions = () => ({width:4000,fontScale:window.fontScale});
        `
              : path === '@expo/ui'
                ? `
          import React, {useMemo} from 'react';
          export const Host = ({children}) => <div>{children}</div>;
          export const TextInput = () => <input aria-label="Search settings"/>;
          export const useNativeState = value => useMemo(()=>({value}),[]);
        `
                : path.endsWith('ActionButton')
                  ? `
          import React from 'react';
          export const ActionButton = ({children,style}) => <button data-width={style.width}>{children}</button>;
        `
                  : `export const useUiTheme = () => ({colors:{foreground:'#111',mutedForeground:'#555',muted:'#eee'}});`
        }));
      }
    }
  ]
});

test('native Settings uses measured workspace space and text scale for every navigation leaf', () => {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    window.eval(outputFiles[0].text);
    window.renderSettings(1);
    const frame = () => window.document.querySelector('[data-workspace]');
    const compact = () => {
      assert.equal(frame().getAttribute('data-direction'), null);
      assert.equal(window.document.querySelectorAll('[data-horizontal="true"]').length, 1);
      assert.equal(window.document.querySelector('button').getAttribute('data-width'), null);
    };
    compact(); // The 4000-wide window is not evidence of actual pane space.
    window.measureSettings(600);
    compact();
    window.measureSettings(968);
    assert.equal(frame().getAttribute('data-direction'), 'row');
    assert.equal(frame().firstElementChild.getAttribute('data-width'), '224');
    assert.equal(window.document.querySelectorAll('[data-horizontal="true"]').length, 0);
    assert.equal(window.document.querySelector('button').getAttribute('data-width'), '100%');
    window.renderSettings(2);
    compact();
    window.measureSettings(2000);
    assert.equal(frame().getAttribute('data-direction'), 'row');
    assert.equal(frame().firstElementChild.getAttribute('data-width'), '448');
    window.measureSettings(700);
    compact();
  } finally {
    window.disposeSettings?.();
    window.close();
  }
});
