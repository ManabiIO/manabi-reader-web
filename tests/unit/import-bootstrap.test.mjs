/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { importBootstrapDocument } from '../../scripts/import-bootstrap.mjs';
const html = '<!doctype html><html><body><div id="root"></div></body></html>';
const built = await build({
  stdin: {
    contents:
      "import * as api from './apps/web/src/runtime/import-bootstrap'; window.bootstrap = api;",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url))
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: {
    'process.env.EXPO_BASE_URL': '"/reader-web"',
    'process.env.EXPO_PUBLIC_READER_BASE_PATH': '"/reader-web"'
  }
});
function fixture(path = '/reader-web/import-ttu') {
  const dom = new JSDOM(importBootstrapDocument(html, '/reader-web'), {
    url: 'https://reader.example' + path,
    runScripts: 'outside-only'
  });
  dom.window.eval(built.outputFiles[0].text);
  return dom;
}
test('static import bootstrap adds an inert native picker without replacing the Expo root or adding executable code', () => {
  const dom = fixture();
  try {
    const { document } = dom.window;
    assert.equal(document.querySelectorAll('#root').length, 1);
    const initial = document.getElementById('manabi-import-bootstrap');
    assert.equal(initial.parentElement, document.body);
    assert.equal(initial.dataset.importRoute, '/reader-web/import-ttu');
    const input = initial.querySelector('input');
    assert.equal(input.type, 'file');
    assert.equal(input.multiple, true);
    assert.equal(input.accept, '.zip,application/zip');
    assert.equal(input.disabled, false);
    assert.equal(initial.querySelector('label').textContent.trim(), 'Choose Ttu export ZIPs');
    assert.equal(document.querySelectorAll('script,form,[onchange],[onclick]').length, 0);
    assert.match(document.querySelector('style').textContent, /#manabi-import-bootstrap ~ #root/);
    assert.match(document.querySelector('style').textContent, /max-height:100dvh; overflow:auto/);
    assert.throws(() => importBootstrapDocument(html, '/bad?base'), /Invalid/);
    assert.throws(() => importBootstrapDocument('<div></div>', '/reader-web'), /root marker/);
    assert.throws(() => importBootstrapDocument(html + '<div id="root"></div>', ''), /root marker/);
  } finally {
    dom.window.close();
  }
});
test('one synchronous claim hands the original input/FileList to the existing consumer and cannot be reentered or replayed', () => {
  const dom = fixture('/reader-web/import-ttu?source=yatsu');
  try {
    const { document, bootstrap } = dom.window;
    const input = document.querySelector('input');
    const original = input.files;
    let calls = 0;
    assert.equal(
      bootstrap.consumeImportBootstrap((received) => {
        calls++;
        assert.equal(received, input);
        assert.equal(received.files, original);
        assert.equal(received.isConnected, true);
        assert.equal(
          bootstrap.consumeImportBootstrap(() => calls++),
          false
        );
      }),
      true
    );
    assert.equal(calls, 1);
    assert.equal(document.getElementById('manabi-import-bootstrap'), null);
    assert.equal(input.isConnected, false);
    assert.equal(
      bootstrap.consumeImportBootstrap(() => calls++),
      false
    );
    assert.equal(document.querySelectorAll('input').length, 0);
  } finally {
    dom.window.close();
  }
});
test('wrong or departed routes retire only the bootstrap and never consume stale selection', () => {
  const dom = fixture('/reader-web/manage');
  try {
    const { document, bootstrap } = dom.window;
    let called = false;
    assert.equal(
      bootstrap.consumeImportBootstrap(() => (called = true)),
      false
    );
    assert.equal(called, false);
    assert.equal(document.getElementById('manabi-import-bootstrap'), null);
    assert.ok(document.getElementById('root'));
  } finally {
    dom.window.close();
  }
  const active = fixture();
  try {
    active.window.bootstrap.retireImportBootstrapOutsideRoute();
    assert.ok(active.window.document.getElementById('manabi-import-bootstrap'));
    active.window.history.pushState({}, '', '/reader-web/settings');
    active.window.bootstrap.retireImportBootstrapOutsideRoute();
    assert.equal(active.window.document.getElementById('manabi-import-bootstrap'), null);
  } finally {
    active.window.close();
  }
});
test('malformed and nested lookalikes cannot supply file selection; consumer errors cannot trigger a second import', () => {
  for (const damage of [
    (root) => (root.dataset.importRoute = '/different'),
    (root) => root.querySelector('input').remove()
  ]) {
    const dom = fixture();
    try {
      damage(dom.window.document.getElementById('manabi-import-bootstrap'));
      assert.equal(
        dom.window.bootstrap.consumeImportBootstrap(() => assert.fail('must not consume')),
        false
      );
    } finally {
      dom.window.close();
    }
  }
  const dom = fixture();
  try {
    const { document, bootstrap } = dom.window;
    const root = document.getElementById('manabi-import-bootstrap');
    document.getElementById('root').append(root);
    assert.equal(
      bootstrap.consumeImportBootstrap(() => assert.fail('nested content is not the bootstrap')),
      false
    );
    assert.equal(root.isConnected, true);
    document.body.prepend(root);
    assert.throws(
      () =>
        bootstrap.consumeImportBootstrap(() => {
          throw Error('consumer failed');
        }),
      /consumer failed/
    );
    assert.equal(
      bootstrap.consumeImportBootstrap(() => assert.fail('unknown outcome must not replay')),
      false
    );
  } finally {
    dom.window.close();
  }
});

// Actual controller/consumeSelection/choose lifecycle; only ZIP inspection and
// existing-choice lookup are test doubles. The browser suite uses real ZIPs.
const controllerBundle = await build({
  stdin: {
    contents: `
    import { createImportTtuScreen } from './apps/web/src/settings-react/import-ttu-screen-controller';
    import { inspections } from '$lib/manabi/ttu-migration';
    window.createImporter = () => createImportTtuScreen({}, () => {}, undefined);
    window.inspections = inspections;
  `,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url))
  },
  tsconfig: fileURLToPath(new URL('../../apps/web/tsconfig.json', import.meta.url)),
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: { 'process.env': '{}' },
  plugins: [
    {
      name: 'import-inspection-boundary',
      setup(builder) {
        builder.onResolve({ filter: /^\$lib\/manabi\/ttu-migration$/ }, () => ({
          path: 'inspect',
          namespace: 'import-boundary'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'import-boundary' }, () => ({
          contents: `
      export const inspections=[];
      export class TtuMigration { static async inspect(file, signal) {
        inspections.push({file,signal}); throw new Error('Invalid ZIP fixture');
      } }
      export const migratedBookChoices=async()=>[];
    `,
          loader: 'js'
        }));
      }
    }
  ]
});
test('real importer consumes the early FileList once, reports its normal inspection error, then accepts a fresh retry', async () => {
  const dom = fixture();
  try {
    const { window } = dom;
    const input = window.document.querySelector('input');
    const early = new window.File(['invalid zip'], 'before-hydration.zip', {
      type: 'application/zip'
    });
    let selected = [early];
    Object.defineProperty(input, 'files', { get: () => selected });
    const value = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      get() {
        return value.get.call(this);
      },
      set(next) {
        value.set.call(this, next);
        if (next === '') selected = [];
      }
    });
    window.eval(controllerBundle.outputFiles[0].text);
    const importer = window.createImporter();
    importer.controller.prepare();
    importer.controller.start();
    // A queued native change and repeated start cannot replay the claimed input.
    importer.consumeSelection(input);
    importer.controller.start();
    for (let n = 0; n < 20; n++) await Promise.resolve();
    assert.equal(window.inspections.length, 1);
    assert.equal(window.inspections[0].file, early);
    assert.equal(input.files.length, 0);
    assert.match(importer.message, /before-hydration\.zip: Invalid ZIP fixture/);
    assert.equal(importer.busy, false);
    const retry = new window.File(['invalid again'], 'retry.zip');
    selected = [retry];
    importer.consumeSelection(input);
    for (let n = 0; n < 20; n++) await Promise.resolve();
    assert.equal(window.inspections.length, 2);
    assert.equal(window.inspections[1].file, retry);
    assert.match(importer.message, /retry\.zip: Invalid ZIP fixture/);
    assert.doesNotMatch(importer.message, /before-hydration/);
    assert.equal(importer.busy, false);
    assert.equal(input.files.length, 0);
    importer.controller.destroy();
  } finally {
    dom.window.close();
  }
});
