/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const generatedPrefixes = [
  '.cache/dictionary-build/',
  'apps/web/static/dictionary-runtime/',
  'apps/web/static/dictionary-archives/',
  'apps/web/static/manabitan/'
];

const generated = tracked.filter((file) =>
  generatedPrefixes.some((prefix) => file.startsWith(prefix))
);
if (generated.length) {
  throw new Error(
    `Generated dictionary/provider artifacts must not be tracked:\n${generated.join('\n')}`
  );
}

const protectedRoots = ['apps/web/src/lib/search/', 'apps/web/src/lib/dictionary-setup/'];

const providerSpecific = new Set([
  'apps/web/src/lib/search/dictionary-provider-selection.ts',
  'apps/web/src/lib/search/dictionary-providers/manabitan/adapter.ts',
  'apps/web/src/lib/search/dictionary-providers/manabitan/version.json'
]);
const buildProviderSpecific = new Set([
  'scripts/dictionary-provider-selection.mjs',
  'scripts/dictionary-providers/manabitan.mjs'
]);

const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte|json)$/;
const providerTokens =
  /\b(?:ManabiTan|Manabitan|Yomitan|Yomichan)\b|\/manabitan\/|web\/(?:client|render|presets)\.js/i;
const providerImplementationTokens =
  /\b(?:ManabiTanWebClient|Manabitan|Yomitan|Yomichan)\b|\/manabitan\/|web\/(?:client|render|presets)\.js|dictionary-providers\/manabitan/i;
const gplSourceHeader =
  /(?:SPDX-License-Identifier|@license)\s*:?\s*(?:A?GPL|LGPL)(?:-|\b)|GNU (?:AFFERO )?(?:LESSER )?GENERAL PUBLIC LICENSE/i;

const leaks = [];
for (const file of tracked) {
  if (
    providerSpecific.has(file) ||
    !sourceExtensions.test(file) ||
    !protectedRoots.some((root) => file.startsWith(root))
  )
    continue;

  const content = await fs.readFile(file, 'utf8');
  if (providerTokens.test(content)) leaks.push(file);
}

if (leaks.length) {
  throw new Error(
    [
      'Provider-specific implementation references crossed the Reader dictionary boundary:',
      ...leaks,
      '',
      'Keep provider-neutral Reader code on dictionary-provider.ts and move runtime-specific loading',
      'to dictionary-providers/manabitan/adapter.ts or the provider-selection module.'
    ].join('\n')
  );
}

const implementationLeaks = [];
const gplSources = [];
const executableSource = /\.(?:[cm]?[jt]sx?|svelte|[ch](?:pp)?|py|sh)$/;
for (const file of tracked) {
  if (!executableSource.test(file)) continue;

  const source = await fs.readFile(file, 'utf8');
  if (
    file.startsWith('apps/') &&
    !providerSpecific.has(file) &&
    providerImplementationTokens.test(source)
  )
    implementationLeaks.push(file);
  if (gplSourceHeader.test(source)) gplSources.push(file);
}

if (implementationLeaks.length) {
  throw new Error(
    `Manabitan implementation coupling exists outside the provider seam:\n${implementationLeaks.join('\n')}`
  );
}

const genericBuildLeaks = [];
for (const file of ['scripts/prepare-dictionary.mjs', 'scripts/dictionary-source.mjs']) {
  const source = await fs.readFile(file, 'utf8');
  if (providerTokens.test(source) || providerImplementationTokens.test(source))
    genericBuildLeaks.push(file);
}
if (genericBuildLeaks.length) {
  throw new Error(
    `Provider-specific implementation details crossed into generic dictionary build code:\n${genericBuildLeaks.join('\n')}`
  );
}

for (const file of buildProviderSpecific) {
  if (!tracked.includes(file))
    throw new Error(`Missing provider-owned dictionary build module: ${file}`);
}
if (gplSources.length) {
  throw new Error(
    `GPL-licensed source must not be committed as tracked Reader code:\n${gplSources.join('\n')}`
  );
}

if (tracked.includes('.gitmodules')) {
  const gitmodules = await fs.readFile('.gitmodules', 'utf8');
  if (/\b(?:Manabitan|Yomitan|Yomichan)\b/i.test(gitmodules))
    throw new Error('Do not vendor the GPL dictionary provider as a Reader Git submodule.');
}

const dependencyManifests = tracked.filter(
  (file) =>
    file === 'package.json' ||
    /^apps\/[^/]+\/package\.json$/.test(file) ||
    /^packages\/[^/]+\/package\.json$/.test(file)
);
for (const file of dependencyManifests) {
  const packageJson = JSON.parse(await fs.readFile(file, 'utf8'));
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {})
  };
  const prohibited = Object.entries(dependencies)
    .filter(
      ([name, spec]) =>
        /(?:^|[-_/])(?:manabitan|yomitan|yomichan)(?:$|[-_/])/i.test(name) ||
        /(?:ManabiIO\/manabitan|yomidevs\/yomitan|FooSoft\/yomichan)/i.test(String(spec))
    )
    .map(([name]) => name);
  if (prohibited.length)
    throw new Error(
      `Do not add the GPL dictionary provider as a Reader package dependency (${file}): ${prohibited.join(', ')}`
    );
}

const contract = await fs.readFile('apps/web/src/lib/search/dictionary-provider.ts', 'utf8');
if (providerTokens.test(contract)) {
  throw new Error('The Reader-owned dictionary provider contract must remain provider-neutral.');
}

console.log('Dictionary provider/source-license boundary is intact.');
