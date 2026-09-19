import assert from 'node:assert/strict';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const files = [
  'apps/web/src/lib/appearance/background-settings.svelte',
  'apps/web/src/lib/appearance/runtime.svelte',
  'apps/web/src/lib/appearance/settings.svelte',
  'apps/web/src/lib/components/book-reader/book-toc/book-toc.svelte',
  'apps/web/src/lib/components/button-toggle-group/button-toggle-group.svelte',
  'apps/web/src/lib/components/settings/settings-custom-theme-input.svelte',
  'apps/web/src/lib/components/settings/settings-custom-theme.svelte',
  'apps/web/src/routes/connections/+page.svelte',
  'apps/web/src/routes/shared-library/+page.svelte'
];
const eslint = new ESLint({
  overrideConfigFile: fileURLToPath(new URL('./eslint.config.mjs', import.meta.url))
});
for (const file of files) {
  assert.equal(await eslint.isPathIgnored(file), false, `${file} must not be skipped`);
  const config = await eslint.calculateConfigForFile(file);
  assert.ok(
    config?.languageOptions?.parser?.meta?.name?.includes('svelte'),
    `${file} needs the Svelte parser`
  );
}
const results = await eslint.lintFiles(files);
process.stdout.write((await eslint.loadFormatter('stylish')).format(results));
assert.equal(results.length, files.length);
if (results.some((result) => result.errorCount || result.warningCount)) process.exitCode = 1;
else
  process.stdout.write(
    `Checked all ${files.length} appearance components with the Svelte recommended rules.\n`
  );
