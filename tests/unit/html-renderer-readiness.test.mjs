import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compileFunction } from 'node:vm';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import ts from 'typescript';

// Execute the complete production component script with explicit Svelte
// lifecycle/flush boundaries. Native parent binding is qualified in the app.
const path = 'apps/web/src/lib/components/html-renderer.svelte';
const root = new URL('../../', import.meta.url);
const source = process.env.HTML_RENDERER_BASELINE
  ? execFileSync('git', ['show', `${process.env.HTML_RENDERER_BASELINE}:${path}`], {
      cwd: fileURLToPath(root),
      encoding: 'utf8'
    })
  : readFileSync(new URL(path, root), 'utf8');
const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];

function fixture() {
  let update;
  let destroy = () => {};
  const waiting = [];
  const loads = [];
  const { outputText, diagnostics } = ts.transpileModule(script, {
    fileName: 'html-renderer.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.equal(name, 'svelte');
      return {
        afterUpdate: (callback) => {
          update = callback;
        },
        onDestroy: (callback) => {
          destroy = callback;
        },
        tick: () => new Promise((resolve) => waiting.push(resolve)),
        createEventDispatcher: () => (type) => {
          loads.push({ type, html: module.exports.html });
        }
      };
    },
    module,
    module.exports
  );
  return {
    update(html) {
      module.exports.html = html;
      update();
    },
    destroy: () => destroy(),
    flush: async () => {
      waiting.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
    },
    loads
  };
}

test('HTML readiness does not publish before the parent binding flush', async () => {
  const h = fixture();
  h.update('<p>First</p>');
  assert.deepEqual(h.loads, []);
  await h.flush();
  assert.deepEqual(h.loads, [{ type: 'load', html: '<p>First</p>' }]);
});

test('superseded markup cannot initialize the geometry owner', async () => {
  const h = fixture();
  h.update('<p>Old</p>');
  h.update('<p>Current</p>');
  await h.flush();
  assert.deepEqual(h.loads, [{ type: 'load', html: '<p>Current</p>' }]);
});

test('unchanged markup still emits once across binding and font updates', async () => {
  const h = fixture();
  h.update('<p>Same</p>');
  await h.flush();
  for (let i = 0; i < 5; i++) {
    h.update('<p>Same</p>');
    await h.flush();
  }
  assert.equal(h.loads.length, 1);
});

test('destruction cancels an already queued ready notification', async () => {
  const h = fixture();
  h.update('<p>Gone</p>');
  h.destroy();
  await h.flush();
  assert.deepEqual(h.loads, []);
});

test('later genuine markup changes continue publishing once each', async () => {
  const h = fixture();
  for (const html of ['', '<p>A</p>', '<p>B</p>', '']) {
    h.update(html);
    await h.flush();
  }
  assert.deepEqual(
    h.loads.map((event) => event.html),
    ['', '<p>A</p>', '<p>B</p>', '']
  );
});

test('rapid return to previous markup publishes only its current lifetime', async () => {
  const h = fixture();
  h.update('<p>A</p>');
  h.update('<p>B</p>');
  h.update('<p>A</p>');
  await h.flush();
  assert.deepEqual(h.loads, [{ type: 'load', html: '<p>A</p>' }]);
});
