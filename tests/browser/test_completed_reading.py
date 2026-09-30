"""Complete a real book, then export and migrate its completion.

Only the local-folder capability is initialized as a fixture. Completion rows,
ZIPs, and migration receipts are produced by the actual static application's UI.
"""
from reader_controls import reveal_reader_controls
import io
import json
from pathlib import Path
import re
import sys
import time
import unittest
import zipfile
from playwright.sync_api import expect
from test_local_library import LocalLibraryBrowser, CONTENT


class CompletedReadingBrowser(LocalLibraryBrowser):
    def assert_target(self, control):
        box = control.bounding_box()
        self.assertGreaterEqual(box['width'], 43.99)
        self.assertGreaterEqual(box['height'], 43.99)
        self.assertTrue(control.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))

    def statistics(self, page):
        return page.evaluate('''() => new Promise((resolve,reject) => {
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result,tx=db.transaction('readerStatistic');
            const rows=tx.objectStore('readerStatistic').getAll();
            tx.oncomplete=()=>{resolve(rows.result);db.close();};tx.onerror=()=>reject(tx.error);};
        })''')

    def test_completion_dialog_reflows_and_reduced_motion_skips_confetti(self):
        self.seed(True)
        self.import_book()
        self.page.emulate_media(reduced_motion='reduce')
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.page.get_by_role('link', name='Read local-book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute(
            'aria-busy', 'false', timeout=35000
        )

        def open_completion():
            reveal_reader_controls(self.page)
            self.page.get_by_role('button', name='Reading tools', exact=True).click()
            self.page.get_by_role('menuitem', name='Complete Book', exact=True).click()
            dialog = self.page.get_by_role('dialog').last
            expect(dialog.get_by_text('Complete Book', exact=True)).to_be_visible()
            self.assertLessEqual(dialog.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
            scroll = dialog.locator('[data-dialog-scroll]')
            self.assertTrue(scroll.evaluate('e => e.scrollHeight > e.clientHeight'))
            scroll.evaluate('e => { e.scrollTop = e.scrollHeight; }')
            self.page.wait_for_function('e => e.scrollTop > 0', arg=scroll.element_handle())
            for name in ('Cancel', 'Confirm'):
                self.assert_target(dialog.get_by_role('button', name=name, exact=True))
            return dialog

        panel = open_completion()
        Path('test-results').mkdir(exist_ok=True)
        self.page.screenshot(
            path='test-results/completion-reduced-motion-confirmation.png',
            full_page=True,
        )
        panel.get_by_role('button', name='Cancel', exact=True).click()
        expect(panel).to_have_count(0)
        expect(self.page.locator('button[data-reader-controls]')).to_be_focused()

        panel = open_completion()
        panel.get_by_role('button', name='Confirm', exact=True).click()
        deadline = time.monotonic() + 20
        while True:
            rows = self.statistics(self.page)
            if any(row.get('completedBook') == 1 for row in rows):
                break
            self.assertLess(time.monotonic(), deadline, 'Completion statistic did not commit')
            self.page.wait_for_timeout(25)

        expect(self.page.locator('[data-book-completion-confetti]')).to_have_count(0)
        expect(self.page.get_by_role('button', name='Confirm', exact=True)).to_have_count(0)
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_active_celebration_restarts_after_reduced_motion_is_cleared(self):
        self.seed(True)
        self.import_book()
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.get_by_role('link', name='Read local-book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute(
            'aria-busy', 'false', timeout=35000
        )
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Complete Book', exact=True).click()
        self.page.get_by_role('button', name='Confirm', exact=True).click()

        canvas = self.page.locator('[data-book-completion-confetti]')
        expect(canvas).to_be_visible()
        self.page.emulate_media(reduced_motion='reduce')
        expect(canvas).to_be_hidden()
        self.page.emulate_media(reduced_motion='no-preference')
        expect(canvas).to_be_visible()
        self.page.wait_for_function('''() => {
          const canvas = document.querySelector('[data-book-completion-confetti]');
          if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
          const pixels = canvas.getContext('2d').getImageData(
            0, 0, canvas.width, canvas.height).data;
          for (let index = 3; index < pixels.length; index += 4)
            if (pixels[index] !== 0) return true;
          return false;
        }''', timeout=5000)

    def test_finished_book_survives_export_migration_and_retry(self):
        self.seed(True)
        self.import_book()
        self.page.get_by_role('link', name='Read local-book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy','false',timeout=35000)
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Complete Book', exact=True).click()
        self.page.get_by_role('button', name='Confirm', exact=True).click()
        # Playwright's wait_for_function can treat a returned Promise as truthy
        # before its IndexedDB result settles. Poll committed rows instead.
        deadline = time.monotonic() + 20
        while True:
            before = self.statistics(self.page)
            if any(row.get('completedBook') == 1 for row in before):
                break
            self.assertLess(time.monotonic(), deadline, 'Completion statistic did not commit')
            self.page.wait_for_timeout(25)
        expect(self.page.get_by_role('button', name='Confirm', exact=True)).to_have_count(0)
        finished=next(row for row in before if row.get('completedBook')==1)
        completion=finished['completedData']
        self.assertEqual(1,completion['exporterVersion'])
        self.assertEqual(8,completion['dbVersion'])
        self.assertIn('averageWeightedRedingTime',completion)
        self.assertIn('averageWeightedCharatersRead',completion)
        self.page.goto(self.origin+'/reader-web/connections')
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()
        self.assertEqual([], self.documents())
        self.assertEqual(CONTENT,self.original())
        self.assertEqual(before,self.statistics(self.page))

        self.page.goto(self.origin+'/reader-web/manage')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select All Visible', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Export', exact=True).click()
        self.page.get_by_role('button',name='Zip File',exact=True).click()
        for label in ('Book data','Reading position','Statistics'):
            self.page.get_by_label(label,exact=True).check()
        with self.page.expect_download(timeout=60000) as pending:
            self.page.get_by_role('button',name='Start export',exact=True).click()
        raw=Path(pending.value.path()).read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            name=next(name for name in archive.namelist() if '/statistics_' in name)
            exported=json.loads(archive.read(name))
        self.assertEqual(completion,next(row['completedData'] for row in exported if row.get('completedBook')))

        destination=self.new_context()
        try:
            page=destination.new_page()
            page.on('pageerror',lambda error:self.errors.append(str(error)))
            page.goto(self.origin+'/reader-web/import-ttu')
            chooser=page.get_by_label('Choose Ttu export ZIPs',exact=True)
            expect(chooser).to_be_enabled()
            chooser.set_input_files({'name':'completed-books.zip','mimeType':'application/zip','buffer':raw})
            expect(chooser).to_be_enabled()
            page.get_by_role('button',name=re.compile(r'^Import selected \(')).click()
            expect(chooser).to_be_enabled(timeout=30000)
            imported=page.get_by_role('article',name='Import local-book',exact=True)
            expect(imported.get_by_role('status')).to_have_text('Imported local-book.')
            migrated=self.statistics(page)
            self.assertEqual(completion,next(row['completedData'] for row in migrated if row.get('completedBook')))
            page.get_by_role('button',name='Select all',exact=True).click()
            page.get_by_role('button',name=re.compile(r'^Import selected \(')).click()
            expect(chooser).to_be_enabled(timeout=30000)
            expect(imported.get_by_role('status')).to_contain_text('Already imported')
            self.assertEqual(migrated,self.statistics(page))
            page.reload()
            self.assertEqual(migrated,self.statistics(page))
        finally:
            Path('test-results').mkdir(exist_ok=True)
            page.screenshot(path='test-results/completed-book-migration.png',full_page=True)


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(CompletedReadingBrowser)
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
