/** @license BSD-3-Clause */
import ts from 'typescript';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('apps/web/src/native-library');
const config = ts.getParsedCommandLineOfConfigFile(resolve('apps/web/tsconfig.json'), { noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: error => { throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n')); } });
if (!config) throw new Error('Cannot read Expo TypeScript configuration');
const roots = [...readdirSync(directory).filter(file => /\.tsx?$/.test(file)).map(file => resolve(directory, file)), resolve('apps/web/src/lib/library/organization.ts'), ...['header.tsx', 'workspace.tsx', 'observable-controller.ts'].map(file => resolve('apps/web/src/library-react', file))];
const program = ts.createProgram([...roots, ...config.fileNames.filter(file => file.endsWith('.d.ts'))], config.options);
const diagnostics = [...config.errors, ...program.getOptionsDiagnostics(), ...roots.flatMap(file => { const source = program.getSourceFile(file); return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]; })];
if (diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: path => path, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' })); process.exitCode = 1; }
else console.log('Native library: zero scoped diagnostics with strict production Expo configuration and resolved dependency types');
