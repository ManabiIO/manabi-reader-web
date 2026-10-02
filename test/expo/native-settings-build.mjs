/** @license BSD-3-Clause */
// Focused checks: native render code never bundles the DOM store owner; the
// service is compiled for the owner's web target with its domain imports external.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
for (const [name, entry, platform, external] of [
  ['Android native UI', 'NativeSettingsScreen.tsx', 'neutral', ['../platform/RuntimeProvider.native']],
  ['DOM settings service', 'service.ts', 'browser', ['$lib/*']],
]) {
  const output = await build({ absWorkingDir: cwd, entryPoints: [`apps/web/src/native-settings/${entry}`], bundle: true, write: false, metafile: true, format: 'esm', platform, packages: 'external', external, jsx: 'automatic', tsconfig: 'apps/web/tsconfig.json', logLevel: 'silent' });
  const paths = Object.keys(output.metafile.inputs);
  assert.ok(paths.some(path => path.endsWith('native-settings/schema.ts')));
  assert.ok(paths.every(path => !path.endsWith('.svelte') && !path.endsWith('/lib/data/store.ts') && !path.includes('settings-react/')));
  assert.equal(output.errors.length, 0);
  console.log(`${name}: esbuild passed (${paths.length} local modules; ${output.outputFiles[0].contents.length} bytes)`);
}
