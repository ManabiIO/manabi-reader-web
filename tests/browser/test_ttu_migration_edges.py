"""Large-file, partial-selection and interruption tests against the real import UI."""
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zipfile
from playwright.sync_api import expect
from test_ttu_migration import MigrationBrowser, entries, zip_bytes, TITLE, OTHER


class MigrationEdges(MigrationBrowser):
    def test_large_seekable_zip_does_not_require_reading_the_whole_container(self):
        # A valid sparse ZIP with a >1 GiB gap before the central directory.
        # Its actual book bytes are small. This proves File slicing/central-directory
        # seeking beyond the old container cap, not an 8 GiB decompression benchmark.
        raw = self.source
        eocd = raw.rfind(b'PK\x05\x06')
        original = struct.unpack_from('<I', raw, eocd + 16)[0]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'large-Ttu-export.zip'
            with path.open('wb') as output:
                output.write(raw[:original])
                output.seek(1024**3 + 4096, 1)
                central = output.tell()
                output.write(raw[original:eocd])
                trailer = bytearray(raw[eocd:])
                struct.pack_into('<I', trailer, 16, central)
                output.write(trailer)
            self.assertGreater(path.stat().st_size, 1024**3)
            with zipfile.ZipFile(path) as check:
                self.assertEqual(len(self.source_entries), len(check.namelist()))
            self.page.get_by_label('Choose Ttu export ZIPs', exact=True).set_input_files(str(path))
            expect(self.page.get_by_label('Choose Ttu export ZIPs', exact=True)).to_be_enabled()
            expect(self.page.get_by_role('article')).to_have_count(2)
            self.run_import()
            self.assertEqual(2, len(self.snapshot()['data']))

    def test_paginated_preview_selects_the_correct_book_across_pages(self):
        source_name = next(name for name in self.source_entries if name.startswith(TITLE+'/bookdata_'))
        package = entries(self.source_entries[source_name])
        original = json.loads(package['staticdata.json'])
        files = {}
        for index in range(60):
            title = f'Batch book {index:03}'
            content = {**package, 'staticdata.json': json.dumps({**original, 'title':title})}
            files[title+'/'+source_name.rsplit('/',1)[1]] = zip_bytes(content)
        self.load(zip_bytes(files), 'sixty-books.zip')
        expect(self.page.get_by_role('article')).to_have_count(50)
        self.page.get_by_role('button',name='Select none',exact=True).click()
        self.page.get_by_role('button',name='Next',exact=True).click()
        expect(self.page.get_by_role('article')).to_have_count(10)
        self.row('Batch book 055').get_by_role('checkbox').check()
        self.run_import()
        self.assertEqual(['Batch book 055'], [book['title'] for book in self.snapshot()['data']])
        self.page.get_by_role('button',name='Select all',exact=True).click()
        self.run_import()
        self.assertEqual(60, len(self.snapshot()['data']))

    def test_cancel_before_first_commit_writes_nothing_and_can_retry(self):
        self.load()
        self.page.evaluate('''() => {const observer=new MutationObserver(()=>{
          if([...document.querySelectorAll('article [role=status]')].some(e=>e.textContent==='Importing…')){
            const stop=[...document.querySelectorAll('button')].find(e=>e.textContent==='Stop importing');
            if(stop){observer.disconnect();stop.click();}
          }
        });observer.observe(document.querySelector('.import-list'),{subtree:true,childList:true,characterData:true});}''')
        self.run_import()
        result = self.snapshot()
        self.assertEqual([], result['data'])
        self.assertEqual([], result['bookmark'])
        self.assertEqual([], result['statistic'])
        self.page.get_by_role('button',name='Select all',exact=True).click()
        self.run_import()
        self.assertEqual(2, len(self.snapshot()['data']))

    def test_unsupported_and_duplicate_parts_are_not_arbitrarily_selected(self):
        files = dict(self.source_entries)
        name = next(name for name in files if name.startswith(TITLE+'/progress_'))
        files[name.replace('_1_6_', '_2_6_')] = files[name]
        self.load(zip_bytes(files), 'unsupported.zip')
        expect(self.row().get_by_role('checkbox')).to_be_disabled()
        expect(self.row().get_by_role('status')).to_contain_text('Unsupported export version')
        self.run_import()
        self.assertEqual([OTHER], [book['title'] for book in self.snapshot()['data']])
        self.clear()
        files = dict(self.source_entries)
        fields = name.split('_')
        fields[-1] = '0.5.json'
        files['_'.join(fields)] = files[name]
        self.load(zip_bytes(files), 'duplicate-progress.zip')
        expect(self.row().get_by_role('checkbox')).to_be_disabled()
        expect(self.row().get_by_role('status')).to_contain_text('Multiple bookmark files')
        self.run_import()
        self.assertEqual([OTHER], [book['title'] for book in self.snapshot()['data']])

    def test_deselected_optional_data_is_not_applied_or_used_to_block_book_import(self):
        files = dict(self.source_entries)
        for name in files:
            if '/statistics_' in name:
                files[name] = '{not valid JSON'
        self.load(zip_bytes(files), 'book-only-choice.zip')
        self.page.get_by_text('Data to import', exact=True).click()
        self.page.get_by_label('Statistics', exact=True).uncheck()
        self.run_import()
        result = self.snapshot()
        self.assertEqual(2, len(result['data']))
        self.assertEqual([], result['statistic'])
        self.assertEqual(2, len(result['bookmark']))


if __name__ == '__main__':
    names = [name for name in MigrationEdges.__dict__ if name.startswith('test_')]
    suite = unittest.TestSuite(MigrationEdges(name) for name in names)
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
