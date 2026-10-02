/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import ts from 'typescript';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('apps/web/src/snippets-react');
const config = ts.getParsedCommandLineOfConfigFile(resolve('apps/web/tsconfig.json'), { noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: error => { throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n')); } });
if (!config) throw new Error('Cannot read Expo TypeScript configuration');
const roots = readdirSync(directory).filter(file => /\.tsx?$/.test(file)).map(file => resolve(directory, file));
const program = ts.createProgram([...roots, ...config.fileNames.filter(file => file.endsWith('.d.ts'))], config.options);
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program).filter(error => error.file?.fileName.startsWith(directory + '/'))];
if (diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: path => path, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' })); process.exitCode = 1; }
else console.log('Snippets React: zero diagnostics using the production Expo TypeScript configuration (including resolved dependencies)');
