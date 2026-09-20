import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';

export async function runBackupAcceptance({ page, origin, fixtures, check, books, openBook }) {
  const title = 'E2E Backup / 日本語';
  const start = async (file) => {
    await page.goto(origin + '/manage');
    await expect(page.getByRole('button', { name: 'Add books', exact: true })).toBeVisible();
    await page
      .locator('input[type=file][accept=".zip,application/zip"]')
      .setInputFiles(path.join(fixtures, file));
  };
  const settled = async () => {
    await expect(page.getByRole('button', { name: 'Cancel operation', exact: true })).toHaveCount(
      0,
      { timeout: 60000 }
    );
    await expect(page.getByRole('button', { name: 'Add books', exact: true })).toBeVisible();
  };
  await check(
    'backup: real nested export import preserves Japanese content and literal encoded title',
    async () => {
      await start('backup-valid.zip');
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 60000 });
      await settled();
      await openBook(title);
      await expect(page.locator('.book-content')).toContainText('復元された本');
      await expect(page.locator('.book-content rt').first()).toHaveText('ねこ');
      await page.reload();
      await expect(page.locator('.book-content')).toContainText('日本語');
    }
  );
  for (const file of ['backup-invalid.zip', 'backup-traversal.zip', 'backup-nested-limit.zip']) {
    await check(`backup: ${file} fails without publishing a partial book`, async () => {
      const before = await books();
      await start(file);
      await expect(page.getByText('Import failed', { exact: true }).first()).toBeVisible({
        timeout: 60000
      });
      await settled();
      assert.equal((await books()).length, before.length);
    });
  }
  await check('backup: cancel drains active work and permits a fresh import', async () => {
    await start('backup-cancel.zip');
    const cancel = page.getByRole('button', { name: 'Cancel operation', exact: true });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await settled();
    assert.ok((await books()).filter((b) => b.title.startsWith('E2E Cancel ')).length < 40);
    await start('backup-retry.zip');
    await expect(page.getByText('E2E Backup Retry', { exact: true }).first()).toBeVisible({
      timeout: 60000
    });
    await settled();
    await openBook('E2E Backup Retry');
    await expect(page.locator('.book-content')).toContainText('復元された本');
  });
}
