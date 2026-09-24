"""Round-trip a Manabi export through the unmodified upstream TTU app.

Set TTU_BASE_URL to an upstream Ttu Ebook Reader dev server. This exercises its
real ZIP importer, IndexedDB storage, exporter, and the Manabi migration UI in a
separate browser origin. Only the initial reading-history values are seeded at
the Manabi persistence boundary by the shared migration fixture.
"""
import io
import os
from pathlib import Path
import unittest
import zipfile

from playwright.sync_api import expect

from test_ttu_migration import MigrationBrowser, OTHER, TITLE, entries


class UpstreamTtuRoundTrip(MigrationBrowser):
    def setUp(self):
        # Keep the Manabi tab unopened while TTU runs. This makes the second
        # application a clean, separate origin/profile until its export exists.
        self.context = self.browser.new_context(accept_downloads=True)
        self.page = self.context.new_page()
        self.page.set_default_timeout(30000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def test_manabi_book_progress_and_statistics_survive_actual_ttu_roundtrip(self):
        ttu_base_url = os.environ.get('TTU_BASE_URL')
        if not ttu_base_url:
            self.skipTest('Set TTU_BASE_URL to an unmodified upstream Ttu Ebook Reader instance')

        ttu_context = self.browser.new_context(accept_downloads=True)
        ttu_page = ttu_context.new_page()
        ttu_page.set_default_timeout(30000)
        ttu_errors = []
        ttu_page.on('pageerror', lambda error: ttu_errors.append(str(error)))

        try:
            ttu_page.goto(ttu_base_url.rstrip('/') + '/manage')
            ttu_page.wait_for_load_state('networkidle')
            # The input is server-rendered before Svelte attaches its change
            # action. Wait for TTU's client database/bootstrap before sending
            # the file so a fast CI browser cannot drop the change event.
            ttu_page.wait_for_function('''() => indexedDB.databases().then(databases =>
              databases.some(database => database.name === 'books' && database.version >= 6))''',
              timeout=30000)
            # The upstream app receives the ZIP created by Manabi's actual export
            # controls. It imports through its hidden user-facing backup input.
            ttu_page.locator('input[accept=".zip,application/zip"]').set_input_files(
                {'name': 'manabi-export.zip', 'mimeType': 'application/zip', 'buffer': self.source}
            )
            try:
                expect(ttu_page.get_by_role('banner')).to_have_count(2, timeout=60000)
            except AssertionError:
                state = ttu_page.evaluate('''() => new Promise((resolve, reject) => {
                  const request = indexedDB.open('books');
                  request.onerror = () => reject(request.error);
                  request.onsuccess = () => {
                    const db = request.result;
                    const count = db.transaction('data').objectStore('data').count();
                    count.onsuccess = () => {
                      db.close();
                      resolve({books: count.result,
                        unhandledFile: document.querySelector('input[accept=".zip,application/zip"]')?.files?.length,
                        body: document.body.innerText.slice(0, 1200)});
                    };
                    count.onerror = () => reject(count.error);
                  };
                })''')
                self.fail(f'Upstream TTU did not show imported books: {state}; page errors: {ttu_errors}')
            expect(ttu_page.get_by_text(TITLE, exact=True)).to_be_visible()
            expect(ttu_page.get_by_text(OTHER, exact=True)).to_be_visible()
            expect(ttu_page.locator('[title="Cancel Operation"]')).to_have_count(0, timeout=60000)

            ttu_page.locator('[title="Enable Book Selection"]').click()
            for index in range(ttu_page.get_by_role('banner').count()):
                ttu_page.get_by_role('banner').nth(index).locator('[role="button"]').first.click()
            expect(ttu_page.locator('[title="Book selected"]')).to_have_count(2, timeout=15000)
            expect(ttu_page.locator('[title="Open Export Menu"]')).to_be_visible()
            ttu_page.locator('[title="Open Export Menu"]').click()
            ttu_page.get_by_role('button', name='Zip File', exact=True).click()
            for label in ('Book Data', 'Bookmark', 'Statistics', 'Audiobook', 'Subtitles'):
                ttu_page.get_by_label(label, exact=True).check()

            with ttu_page.expect_download(timeout=60000) as pending:
                ttu_page.get_by_role('button', name='Start', exact=True).click()
            upstream_export = Path(pending.value.path()).read_bytes()
            ttu_files = entries(upstream_export)
            self.assertEqual(2, len([name for name in ttu_files if '/bookdata_' in name]))
            self.assertEqual(2, len([name for name in ttu_files if '/statistics_' in name]))
            self.assertTrue(all(name.endswith('.json') or name.endswith('.zip') for name in ttu_files))
            first_book_zip = next(
                body for name, body in ttu_files.items() if '/bookdata_' in name
            )
            with zipfile.ZipFile(io.BytesIO(first_book_zip)) as archive:
                self.assertIn('staticdata.json', archive.namelist())

            # Feed the bytes exported by actual upstream TTU into Manabi's actual
            # migration form, then verify records and rendered book content.
            self.page.goto(self.origin + '/Reader-Web/import-ttu')
            expect(
                self.page.get_by_role('heading', name='Import from Ttu Ebook Reader', exact=True)
            ).to_be_visible(timeout=30000)
            self.load(upstream_export, 'upstream-ttu-export.zip')
            self.run_import()
            data = self.snapshot()
            self.assertCountEqual([TITLE, OTHER], [book['title'] for book in data['data']])
            titles_by_id = {book['id']: book['title'] for book in data['data']}
            self.assertCountEqual(
                [TITLE, OTHER], [titles_by_id[row['dataId']] for row in data['bookmark']]
            )
            self.assertCountEqual([TITLE, OTHER], [row['title'] for row in data['statistic']])
            for row in data['statistic']:
                self.assertEqual(300, row['readingTime'])
                self.assertEqual(60, row['charactersRead'])
            for row in data['bookmark']:
                self.assertEqual(30, row['exploredCharCount'])
            self.assertEqual([], data['storageSource'])

            self.row().get_by_role('link', name='Read ' + TITLE, exact=True).click()
            expect(self.page.locator('.book-content')).to_have_attribute(
                'aria-busy', 'false', timeout=45000
            )
            expect(self.page.locator('.book-content ruby rt').first).to_have_text('ほん')
            self.page.wait_for_function('() => document.querySelector("#safe-image")?.naturalWidth > 0')
            self.assertEqual([], ttu_errors)
        finally:
            output = Path('test-results')
            output.mkdir(exist_ok=True)
            ttu_page.screenshot(path=str(output / 'actual-upstream-ttu-roundtrip.png'), full_page=True)
            (output / 'actual-upstream-ttu-roundtrip.html').write_text(ttu_page.content())
            ttu_context.close()


if __name__ == '__main__':
    suite = unittest.TestSuite(
        UpstreamTtuRoundTrip(name)
        for name in ('test_manabi_book_progress_and_statistics_survive_actual_ttu_roundtrip',)
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
