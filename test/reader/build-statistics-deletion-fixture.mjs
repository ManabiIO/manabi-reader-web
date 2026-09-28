import { build } from 'esbuild';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const lib = new URL('apps/web/src/lib/', root);
const output = new URL('test-results/statistics-deletion/', root);
await mkdir(output, { recursive: true });
const sources = [
  'data/database/books-db/database.service.ts',
  'data/database/books-db/reader-statistics.ts',
  'data/database/books-db/commit-transaction.mjs',
  'data/storage/storage-types.ts',
  'functions/statistic-util.ts'
];
const evidence = [];
const modules = [];
for (const path of sources) {
  const source = await readFile(new URL(path, lib), 'utf8');
  evidence.push({
    path: `apps/web/src/lib/${path}`,
    sha256: createHash('sha256').update(source).digest('hex')
  });
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    // .mjs forces ES output even with module: CommonJS; these are CJS wrappers.
    fileName: path.replace(/\.mjs$/, '.js')
  }).outputText;
  modules.push(`${JSON.stringify(path)}: function(exports, require) {\n${code}\n}`);
}

// Load the complete service and production helpers. Only unrelated application
// dependencies are unavailable. An unexpected access fails, rather than silently
// replacing business logic. The service constructor's RxJS/UI state is not used.
const entry = `
import { openDB, deleteDB } from './apps/web/node_modules/idb/build/index.js';
import pLimit from './apps/web/node_modules/p-limit/index.js';
import { runCases } from './test/reader/statistics-deletion-cases.mjs';
const modules = { ${modules.join(',\n')} };
function load(path, dependencies) {
  const exports = {};
  modules[path](exports, name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return new Proxy({}, { get(_target, property) {
      if (property === '__esModule') return false;
      throw new Error('Unexpected dependency use: ' + name);
    }});
  });
  return exports;
}
const transactions = load(${JSON.stringify(sources[2])}, {});
const statistics = load(${JSON.stringify(sources[1])}, { './commit-transaction.mjs': transactions });
const storage = load(${JSON.stringify(sources[3])}, {});
const dates = load(${JSON.stringify(sources[4])}, {});
const { DatabaseService } = load(${JSON.stringify(sources[0])}, {
  './commit-transaction.mjs': transactions,
  './reader-statistics': statistics,
  '$lib/data/storage/storage-types': storage,
  '$lib/functions/statistic-util': dates,
  'p-limit': { __esModule: true, default: pLimit }
});
export const provenance = ${JSON.stringify(evidence)};
export const run = () => runCases({ DatabaseService, openDB, deleteDB });
`;
const stdin = {
  contents: entry,
  resolveDir: fileURLToPath(root),
  sourcefile: 'statistics-fixture.js'
};
await build({
  stdin,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'StatisticsDeletionCases',
  outfile: fileURLToPath(new URL('fixture.js', output))
});
await build({
  stdin: {
    ...stdin,
    contents: "import './apps/web/node_modules/fake-indexeddb/auto/index.mjs';\n" + entry
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: fileURLToPath(new URL('fixture.node.cjs', output))
});
await writeFile(new URL('sources.json', output), JSON.stringify(evidence, null, 2) + '\n');
