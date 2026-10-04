/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = path.join(root, 'apps/web');
const require = createRequire(path.join(app, 'package.json'));
const expoRequire = createRequire(require.resolve('expo/package.json'));
const autolinking = path.dirname(expoRequire.resolve('expo-modules-autolinking/package.json'));

/** Match SDK 57 SettingsManager.configurePublication, which tests Gradle project names.
 * Testing only whether the npm package is listed would silently accept the unpatched AAR.
 */
export function verifyReaderDomAutolinking(resolved) {
  const modules = resolved.modules.filter((module) => module.packageName === '@expo/dom-webview');
  assert.equal(modules.length, 1, 'Exactly one patched DOM WebView must be autolinked');
  const module = modules[0];
  assert.equal(module.packageVersion, '57.0.1', 'Re-review the patch before upgrading Expo DOM');
  assert.equal(module.projects.length, 1, 'Re-review changed DOM native project layout');
  const project = module.projects[0];
  assert.equal(project.name, 'expo-dom-webview');
  assert.ok(
    resolved.configuration?.buildFromSource?.some((pattern) =>
      new RegExp(`^(?:${pattern})$`).test(project.name)
    ),
    'The patched DOM WebView must build from source, never the upstream precompiled AAR'
  );
  return project;
}
export function resolveReaderDomAutolinking() {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(autolinking, 'bin/expo-modules-autolinking.js'),
        'resolve',
        '--platform',
        'android',
        '--project-root',
        app,
        '--json'
      ],
      { cwd: app, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    )
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = verifyReaderDomAutolinking(resolveReaderDomAutolinking());
  for (const file of ['ReaderDomHost.kt', 'ReaderDomPolicy.java']) {
    assert.ok(
      readFileSync(path.join(project.sourceDir, 'src/main/java/expo/modules/webview', file), 'utf8')
        .length,
      `The linked source is missing ${file}`
    );
  }
  console.log(`Verified source-built :${project.name}; upstream precompiled AAR is excluded`);
}
