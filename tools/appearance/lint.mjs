import assert from 'node:assert/strict';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const files = [
  'apps/web/src/lib/components/statistics/statistics-title-filter.svelte',
  'apps/web/src/lib/components/statistics/statistics-settings.svelte',
  'apps/web/src/lib/components/ui/input/input.svelte',
  'apps/web/src/lib/components/ui/command/command-dialog.svelte',
  'apps/web/src/lib/components/ui/input-group/input-group-button.svelte',
  'apps/web/src/lib/components/ui/close-button.svelte',
  'apps/web/src/lib/components/ui/button/button.svelte',
  'apps/web/src/lib/components/ui/dialog/dialog-content.svelte',
  'apps/web/src/lib/components/ui/dialog/dialog-footer.svelte',
  'apps/web/src/lib/components/book-reader/reader-search.svelte',
  'apps/web/src/lib/components/book-reader/reader-scrubber.svelte',
  'apps/web/src/lib/components/book-reader/reader-annotations.svelte',
  'apps/web/src/lib/library/book-cover.svelte',
  'apps/web/src/lib/library/collections-sheet.svelte',
  'apps/web/src/lib/library/cover-stack.svelte',
  'apps/web/src/lib/library/library-workspace.svelte',
  'apps/web/src/lib/library/source-icon.svelte',

  'apps/web/src/lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte',
  'apps/web/src/lib/components/ripple.svelte',
  'apps/web/src/lib/appearance/background-settings.svelte',
  'apps/web/src/lib/appearance/runtime.svelte',
  'apps/web/src/lib/appearance/settings.svelte',
  'apps/web/src/lib/components/book-reader/book-toc/book-toc.svelte',
  'apps/web/src/lib/components/button-toggle-group/button-toggle-group.svelte',
  'apps/web/src/lib/components/settings/settings-custom-theme-input.svelte',
  'apps/web/src/lib/components/settings/settings-custom-theme.svelte',
  'apps/web/src/routes/connections/+page.svelte',
  'apps/web/src/routes/shared-library/+page.svelte',
  'apps/web/src/lib/components/navigation/action-menu.svelte',
  'apps/web/src/lib/components/navigation/app-nav.svelte',
  'apps/web/src/lib/components/settings/settings-workspace.svelte',
  'apps/web/src/lib/components/settings/settings-item-group.svelte',
  'apps/web/src/lib/components/settings/settings-font-selector.svelte',
  'apps/web/src/lib/components/settings/settings-header.svelte',
  'apps/web/src/lib/components/book-card/book-card.svelte',
  'apps/web/src/lib/components/book-card/book-card-list.svelte',
  'apps/web/src/lib/components/book-card/book-manager-header.svelte',
  'apps/web/src/lib/components/book-reader/book-reader-header.svelte',
  'apps/web/src/lib/components/book-reader/reader-appearance.svelte',
  'apps/web/src/lib/components/ui/sheet/sheet-content.svelte',
  'apps/web/src/lib/components/statistics/statistics-header.svelte',
  'apps/web/src/lib/components/popover/popover.svelte',
  'apps/web/src/lib/components/dialog-template.svelte',
  'apps/web/src/lib/components/app-icon.svelte'
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
