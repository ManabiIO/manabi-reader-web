/** @license MIT — native Whispersync integration tests. */
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  mkdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'apps/web/src/lib/features/whispersync');
const output = mkdtempSync(join(tmpdir(), 'manabi-whispersync-'));
const files = readdirSync(source)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => join(source, file));
let status = 0;
try {
  const program = ts.createProgram(files, {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ...(+ts.versionMajorMinor.split('.')[0] >= 6 ? { ignoreDeprecations: '6.0' } : {}),
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.es2022.intl.d.ts'],
    types: [],
    outDir: output,
    sourceMap: process.argv.includes('--coverage'),
    inlineSources: process.argv.includes('--coverage'),
    skipLibCheck: false
  });
  const emit = program.emit();
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (name) => name,
        getNewLine: () => '\n'
      })
    );
    process.exitCode = 1;
  } else {
    console.log(`Strict core typecheck passed (TypeScript ${ts.version})`);
    const testArguments = ['--test'];
    if (process.argv.includes('--coverage')) {
      testArguments.push(
        '--enable-source-maps',
        '--experimental-test-coverage',
        '--test-coverage-lines=75',
        '--test-coverage-branches=85',
        '--test-coverage-functions=85'
      );
    }
    testArguments.push(join(root, 'test/whispersync/core.test.cjs'));
    const result = spawnSync(process.execPath, testArguments, {
      stdio: 'inherit',
      env: { ...process.env, WHISPERSYNC_COMPILED: output }
    });
    status = result.status ?? 1;
    if (process.argv.includes('--svelte')) {
      const webRequire = createRequire(join(root, 'apps/web/package.json'));
      const compiler = webRequire('svelte/compiler');
      for (const file of readdirSync(source).filter((file) => file.endsWith('.svelte'))) {
        const result = compiler.compile(readFileSync(join(source, file), 'utf8'), {
          filename: file,
          generate: 'client'
        });
        console.log(`${file}: compiled (${result.warnings.length} warnings)`);
        for (const warning of result.warnings) console.warn(`${warning.code}: ${warning.message}`);
      }
    }
    const bundleArgument = process.argv.find((arg) => arg.startsWith('--browser-bundle='));
    if (bundleArgument) {
      const path = resolve(bundleArgument.slice('--browser-bundle='.length));
      const modules = readdirSync(output)
        .filter((file) => file.endsWith('.js'))
        .map((file) => {
          return `${JSON.stringify('./' + file.slice(0, -3))}: function(require, module, exports) {\n${readFileSync(join(output, file), 'utf8')}\n}`;
        });
      const bundle = `(() => { const modules = {${modules.join(',\n')}}; const cache = {}; function require(id) { if (cache[id]) return cache[id].exports; const m = { exports: {} }; cache[id] = m; modules[id](require, m, m.exports); return m.exports } window.whispersync = Object.assign({}, ...Object.keys(modules).map(require)) })()`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bundle);
      console.log(`Browser harness bundle: ${path}`);
    }
    process.exitCode = status;
  }
} finally {
  const trash = join(process.env.HOME ?? tmpdir(), '.Trash', `manabi-whispersync-${Date.now()}`);
  mkdirSync(dirname(trash), { recursive: true });
  renameSync(output, trash);
}
