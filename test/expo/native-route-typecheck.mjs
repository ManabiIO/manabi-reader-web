/** @license BSD-3-Clause */
import ts from 'typescript';
import { resolve } from 'node:path';
const config = ts.getParsedCommandLineOfConfigFile(resolve('apps/web/tsconfig.json'), { noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: error => { throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n')); } });
if (!config) throw new Error('Cannot read Expo TypeScript configuration');
const roots = ['apps/web/src/platform/bridge-client.ts', 'apps/web/src/platform/native-reader-navigation.ts', 'apps/web/src/platform/RuntimeProvider.native.tsx', 'apps/web/src/app/b.tsx', 'apps/web/src/screens/routes/b.tsx'].map(file => resolve(file));
const program = ts.createProgram([...roots, ...config.fileNames.filter(file => file.endsWith('.d.ts'))], config.options);
const diagnostics = [...config.errors, ...program.getOptionsDiagnostics(), ...roots.flatMap(file => { const source = program.getSourceFile(file); return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]; })];
if (diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: path => path, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' })); process.exitCode = 1; }
else console.log('Native reader navigation: zero scoped diagnostics under strict production Expo configuration');
