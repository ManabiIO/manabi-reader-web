"""Real TTU package/progress/statistics files through the actual browser reader.

The fixture supplies a real filesystem capability at the persisted-handle boundary;
no browser method, HTTP request, storage adapter or serializer is replaced.
"""
import base64
import io
import json
from pathlib import Path
import sys
import time
import unittest
import zipfile
from playwright.sync_api import expect
import test_static_reader as static


class SharedTtuBrowser(static.ReaderBrowser):
    def seed_shared_source(self):
        # Opening an absent IndexedDB database from a fixture creates a version-1
        # empty DB and races the real app's initial migrations. Observe readiness
        # without opening/creating anything, then insert the fixture capability.
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            ready = self.page.evaluate('''async () => (await indexedDB.databases()).some(
              database => database.name === 'books' && database.version >= 6)''')
            if ready:
                break
            self.page.wait_for_timeout(50)
        else:
            self.fail('The actual Reader did not initialize its books database')
        self.page.evaluate('''async () => {
          const opfs = await navigator.storage.getDirectory();
          const root = await opfs.getDirectoryHandle('ttu-reader-data', {create:true});
          await new Promise((resolve,reject) => {
            const open = indexedDB.open('books');
            open.onerror=()=>reject(open.error);
            open.onsuccess=()=> {
              const db=open.result, tx=db.transaction('storageSource','readwrite');
              tx.objectStore('storageSource').put({name:'Shared fixture',type:'fs',storedInManager:false,
                encryptionDisabled:false,data:{directoryHandle:root,fsPath:'ttu-reader-data'},lastSourceModified:Date.now()});
              tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>reject(tx.error);
            };
          });
        }''')

    def read_shared_files(self):
        return self.page.evaluate('''async () => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('ttu-reader-data');
          const output={};
          for await (const [title,dir] of root.entries()) {
            if(dir.kind!=='directory')continue;
            output[title]={};
            for await (const [name,handle] of dir.entries()) {
              if(handle.kind!=='file')continue;
              const bytes=new Uint8Array(await (await handle.getFile()).arrayBuffer());
              let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
              output[title][name]=btoa(binary);
            }
          }
          return output;
        }''')

    def test_shared_library_export_and_native_format_progress_import(self):
        self.open_book()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.seed_shared_source()
        self.page.goto(self.origin + '/reader-web/shared-library')
        self.page.get_by_role('heading', name='Publish browser books').wait_for()
        self.page.get_by_label(static.TITLE, exact=True).check()
        self.page.get_by_role('button', name='Publish selected browser books').click()
        expect(self.page.get_by_role('status')).to_contain_text('published in Ttu Ebook Reader format', timeout=30000)
        files = self.read_shared_files()
        self.assertEqual([static.TITLE], list(files))
        book_name = next(name for name in files[static.TITLE] if name.startswith('bookdata_'))
        self.assertTrue(book_name.startswith('bookdata_1_6_'))
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(files[static.TITLE][book_name]))) as package:
            data = json.loads(package.read('staticdata.json'))
            self.assertEqual(static.TITLE, data['title'])
            self.assertIn('<ruby>', data['elementHtml'])
        self.assertFalse(any('book_' in name and name.endswith('.json') for name in files[static.TITLE]))
        chars = int(book_name.split('_')[3])
        now = self.page.evaluate('Date.now() + 10000')
        progress = {'dataId':777,'exploredCharCount':30,'progress':30/chars,'lastBookmarkModified':now}
        day = {'title':static.TITLE,'dateKey':'2026-09-19','charactersRead':60,'readingTime':300,
               'minReadingSpeed':720,'altMinReadingSpeed':720,'lastReadingSpeed':720,
               'maxReadingSpeed':720,'lastStatisticModified':now}
        external = {
            f'progress_1_6_{now}_{30/chars}.json': json.dumps(progress),
            f'statistics_1_6_{now}_60_300_720_720_720_720_300_300_60_60_720_720_na.json': json.dumps([day])
        }
        self.page.evaluate('''async ({title,files}) => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('ttu-reader-data');
          const dir=await root.getDirectoryHandle(title);
          for await (const [name] of dir.entries()) if(name.startsWith('progress_')||name.startsWith('statistics_')) await dir.removeEntry(name);
          for(const [name,body] of Object.entries(files)) {const writer=await (await dir.getFileHandle(name,{create:true})).createWritable();await writer.write(body);await writer.close();}
        }''', {'title':static.TITLE,'files':external})
        self.page.get_by_role('button', name='Refresh shared library').click()
        self.page.get_by_role('heading', name='Shared books', exact=True).wait_for()
        self.page.get_by_label(static.TITLE, exact=True).check()
        self.page.get_by_role('button', name='Import selected shared books').click()
        expect(self.page.get_by_role('status')).to_contain_text('bookmarks and statistics imported', timeout=30000)
        result = self.page.evaluate('''() => new Promise(resolve => {
          const open=indexedDB.open('books');open.onsuccess=()=>{const db=open.result,tx=db.transaction(['bookmark','statistic']);
          const p=tx.objectStore('bookmark').getAll(),s=tx.objectStore('statistic').getAll();
          tx.oncomplete=()=>{resolve({progress:p.result,statistics:s.result});db.close();};};
        })''')
        self.assertEqual(30, result['progress'][0]['exploredCharCount'])
        self.assertNotEqual(777, result['progress'][0]['dataId'])
        imported_day = next(row for row in result['statistics'] if row['dateKey']=='2026-09-19')
        self.assertEqual(300, imported_day['readingTime'])
        self.assertEqual(60, imported_day['charactersRead'])
        expect(self.page.get_by_role('button', name='Import selected shared books')).to_be_disabled()
        # Book ZIP is actually exported by Reader; progress/statistics above are
        # intentional native-format inputs, not output from executing Swift.
        output=Path('test-results');output.mkdir(exist_ok=True)
        (output/'shared-ttu-wire-fixture.json').write_text(json.dumps({'files':self.read_shared_files(),'progress':progress,'statistics':[day]},ensure_ascii=False))

    def test_shared_duplicate_progress_is_a_repair_case_not_last_file_wins(self):
        self.page.goto(self.origin + '/reader-web/manage')
        self.seed_shared_source()
        self.page.evaluate('''async () => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('ttu-reader-data');
          const dir=await root.getDirectoryHandle('Conflicted book',{create:true});
          for(const name of ['bookdata_1_6_10_1_0.zip','progress_1_6_1_0.1.json','progress_1_6_2_0.2.json']) {
            const writer=await (await dir.getFileHandle(name,{create:true})).createWritable();await writer.write('{}');await writer.close();
          }
        }''')
        self.page.goto(self.origin + '/reader-web/shared-library')
        expect(self.page.get_by_role('status')).to_contain_text('Conflicting progress_', timeout=15000)
        self.assertEqual(3, len(self.read_shared_files()['Conflicted book']))


if __name__ == '__main__':
    suite=unittest.TestSuite(SharedTtuBrowser(name) for name in (
        'test_shared_library_export_and_native_format_progress_import',
        'test_shared_duplicate_progress_is_a_repair_case_not_last_file_wins'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
