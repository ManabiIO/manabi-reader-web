/** @license BSD-3-Clause */
// Strict check of real RN/Expo UI types and pure local settings code. The runtime
// boundary is typed here so checking this screen does not recursively compile
// the entire embedded reader/application through its DOM owner.
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'manabi-native-settings-types-'));
const runtime = join(temp, 'runtime.d.ts');
writeFileSync(
  runtime,
  `export declare function useReaderRuntime(): { snapshot: { session: string; epoch: number }; command(method: 'settings.state' | 'settings.action', payload?: Record<string, unknown>): Promise<unknown> };`
);
const options = {
  strict: true,
  noImplicitReturns: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  allowSyntheticDefaultImports: true,
  skipLibCheck: true,
  types: ['react'],
  paths: { '$lib/*': [resolve(root, 'apps/web/src/lib/*')] }
};
try {
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containing) =>
    names.map((name) =>
      name === '../platform/RuntimeProvider.native'
        ? { resolvedFileName: runtime, extension: ts.Extension.Dts }
        : ts.resolveModuleName(name, containing, options, host).resolvedModule
    );
  const program = ts.createProgram(
    ['NativeSettingsScreen.tsx', 'schema.ts', 'contract.ts', 'service-core.ts', 'lifecycle.ts'].map(
      (file) => resolve(root, 'apps/web/src/native-settings', file)
    ),
    options,
    host
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const diagnostic of diagnostics)
    console.error(
      ts.formatDiagnostic(diagnostic, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n'
      })
    );
  console.log(
    `Native settings strict UI/contract check: ${diagnostics.length} diagnostics (runtime owner boundary declaration; real React Native and @expo/ui types)`
  );
  process.exitCode = diagnostics.length ? 1 : 0;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
