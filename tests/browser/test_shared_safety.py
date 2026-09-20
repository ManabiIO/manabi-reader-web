"""Static-app E2E and actual storage-adapter integration with native browser handles.

No request interception, replacement filesystem methods, mocked adapters, or
substitute book reader. The adapter cases load the production modules through
Vite, outside the production build, to retain one instance across external edits.
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import URLError
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect
from test_shared_ttu import SharedTtuBrowser
import test_static_reader as static

REPOSITORY = Path(__file__).resolve().parents[2]


def reading_snapshot(page):
    return page.evaluate('''() => new Promise((resolve, reject) => {
      const open = indexedDB.open('books');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['data', 'bookmark', 'statistic']);
        const data = tx.objectStore('data').getAll();
        const progress = tx.objectStore('bookmark').getAll();
        const statistics = tx.objectStore('statistic').getAll();
        tx.oncomplete = () => {
          resolve({books: data.result.map(({id, title, storageSource, elementHtml, characters}) =>
            ({id, title, storageSource, elementHtml, characters})),
            progress: progress.result, statistics: statistics.result});
          db.close();
        };
        tx.onerror = () => reject(tx.error);
      };
    })''')


class SharedSafetyStatic(SharedTtuBrowser):
    def test_opening_same_title_from_another_source_preserves_local_book_and_history(self):
        self.open_book()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.seed_shared_source()
        self.page.goto(self.origin + '/Reader-Web/shared-library')
        self.page.get_by_label(static.TITLE, exact=True).check()
        self.page.get_by_role('button', name='Publish selected browser books').click()
        expect(self.page.get_by_role('status')).to_contain_text('published in Ttu Ebook Reader format', timeout=30000)
        # A pre-existing local book from a different library with the same title.
        # Persist fixture state at the real DB boundary, not in an in-memory mock.
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const open = indexedDB.open('books');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result, tx = db.transaction('data', 'readwrite');
            const store = tx.objectStore('data'), all = store.getAll();
            all.onsuccess = () => { for (const book of all.result)
              store.put({...book, storageSource: 'Different source', elementHtml: '<p>Local copy must survive.</p>'}); };
            tx.oncomplete = () => {db.close(); resolve();};
            tx.onerror = () => reject(tx.error);
          };
        })''')
        before = reading_snapshot(self.page)
        remote_before = self.read_shared_files()
        self.page.get_by_role('button', name='Open shared library', exact=True).click()
        self.page.get_by_text(static.TITLE, exact=True).click(timeout=30000)
        expect(self.page.get_by_text('A different local copy already uses this title.', exact=False)).to_be_visible()
        self.assertEqual(before, reading_snapshot(self.page))
        self.assertEqual(remote_before, self.read_shared_files())
        self.assertIn('/manage', self.page.url)

    def test_repeated_native_format_imports_do_not_double_count_statistics(self):
        self.test_shared_library_export_and_native_format_progress_import()
        before = reading_snapshot(self.page)
        for _ in range(3):
            self.page.get_by_label(static.TITLE, exact=True).check()
            self.page.get_by_role('button', name='Import selected shared books').click()
            expect(self.page.get_by_role('status')).to_contain_text('bookmarks and statistics imported', timeout=30000)
            expect(self.page.get_by_role('button', name='Import selected shared books')).to_be_disabled()
            self.assertEqual(before, reading_snapshot(self.page))


class SharedStorageRuntime(static.ReaderBrowser):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        cls.origin = 'http://127.0.0.1:' + str(port)
        output = REPOSITORY / 'test-results'
        output.mkdir(exist_ok=True)
        cls.log = (output / 'shared-runtime-vite.log').open('w')
        environment = dict(os.environ, BASE_PATH='/Reader-Web')
        cls.process = subprocess.Popen(
            ['pnpm', '--dir', 'apps/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
            cwd=REPOSITORY, env=environment, stdout=cls.log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if cls.process.poll() is not None:
                    raise RuntimeError('Vite exited; see shared-runtime-vite.log')
                try:
                    with urlopen(cls.origin + '/Reader-Web/manage', timeout=2) as response:
                        if response.status == 200:
                            break
                except (URLError, TimeoutError):
                    pass
                time.sleep(0.2)
            else:
                raise RuntimeError('Vite did not become ready; see shared-runtime-vite.log')
            cls.playwright = sync_playwright().start()
            cls.browser = cls.playwright.chromium.launch()
        except BaseException:
            cls.stop_server()
            raise

    @classmethod
    def stop_server(cls):
        if cls.process.poll() is None:
            os.killpg(cls.process.pid, signal.SIGTERM)
            try:
                cls.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(cls.process.pid, signal.SIGKILL)
                cls.process.wait()
        cls.log.close()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.browser.close()
            cls.playwright.stop()
        finally:
            cls.stop_server()

    def test_directory_selection_does_not_create_a_nested_library_in_a_book_folder(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Library actions', exact=True).wait_for()
        result = self.page.evaluate('''async () => {
          const {resolveTtuRoot} = await import('/Reader-Web/src/lib/manabi/ttu-folder-contract.ts');
          const disk = await navigator.storage.getDirectory();
          const parent = await disk.getDirectoryHandle('library-parent', {create:true});
          let missingError = '';
          try {await resolveTtuRoot(parent);} catch (error) {missingError = error.message;}
          const unchanged = [];
          for await (const name of parent.keys()) unchanged.push(name);
          const root = await resolveTtuRoot(parent, true);
          const sameRoot = await (await resolveTtuRoot(root, true)).isSameEntry(root);
          const sameParent = await (await resolveTtuRoot(parent)).isSameEntry(root);
          const book = await root.getDirectoryHandle('A book', {create:true});
          const writer = await (await book.getFileHandle('progress_1_6_1_0.1.json', {create:true})).createWritable();
          await writer.write('original reading data'); await writer.close();
          let bookError = '';
          try {await resolveTtuRoot(book, true);} catch (error) {bookError = error.message;}
          const after = [];
          for await (const name of book.keys()) after.push(name);
          const text = await (await (await book.getFileHandle('progress_1_6_1_0.1.json')).getFile()).text();
          return {missingError, unchanged, sameRoot, sameParent, bookError, after, text};
        }''')
        self.assertIn('Select the existing', result['missingError'])
        self.assertEqual([], result['unchanged'])
        self.assertTrue(result['sameRoot'])
        self.assertTrue(result['sameParent'])
        self.assertIn('book folder, not the library root', result['bookError'])
        self.assertEqual(['progress_1_6_1_0.1.json'], result['after'])
        self.assertEqual('original reading data', result['text'])

    def test_uncached_provider_observes_replacement_and_disappearance_without_losing_local_data(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Library actions', exact=True).wait_for()
        result = self.page.evaluate('''async () => {
          const {FilesystemStorageHandler} = await import('/Reader-Web/src/lib/data/storage/handler/filesystem-handler.ts');
          const {database} = await import('/Reader-Web/src/lib/data/store.ts');
          const {StorageKey} = await import('/Reader-Web/src/lib/data/storage/storage-types.ts');
          const {MergeMode} = await import('/Reader-Web/src/lib/data/merge-mode.ts');
          const {ReplicationSaveBehavior} = await import('/Reader-Web/src/lib/functions/replication/replication-options.ts');
          const disk = await navigator.storage.getDirectory();
          const root = await disk.getDirectoryHandle('ttu-reader-data', {create:true});
          const title = 'Native shared book';
          const directory = await root.getDirectoryHandle(title, {create:true});
          async function write(name, value) {
            const writer = await (await directory.getFileHandle(name, {create:true})).createWritable();
            await writer.write(JSON.stringify(value)); await writer.close();
          }
          await write('progress_1_6_100_0.1.json', {dataId:777, exploredCharCount:10, progress:0.1, lastBookmarkModified:100});
          const db = await database.db;
          await db.put('storageSource', {name:'Runtime fixture', type:StorageKey.FS, storedInManager:false,
            encryptionDisabled:false, data:{directoryHandle:root, fsPath:root.name}, lastSourceModified:1});
          const localID = await db.put('data', {title, storageSource:'Runtime fixture', elementHtml:'<p>Keep the local copy</p>',
            styleSheet:'', blobs:{}, coverImage:'', hasThumb:false, characters:100, sections:[], lastBookModified:1, lastBookOpen:0});
          await db.put('bookmark', {dataId:localID, exploredCharCount:42, progress:0.42, lastBookmarkModified:999});
          const localBefore = await db.get('bookmark', localID);
          const handler = new FilesystemStorageHandler(window, StorageKey.FS);
          handler.updateSettings(window, true, ReplicationSaveBehavior.NewOnly, MergeMode.MERGE, MergeMode.MERGE, false, false, 'Runtime fixture');
          handler.startContext({title});
          // Publish a genuine TTU archive using the production serializer.
          await handler.saveBook(await db.get('data', localID), true);
          await handler.getBookList();
          const first = await handler.getProgress();
          await directory.removeEntry('progress_1_6_100_0.1.json');
          await write('progress_1_6_200_0.3.json', {dataId:777, exploredCharCount:30, progress:0.3, lastBookmarkModified:200});
          const replaced = await handler.getProgress();
          await write('progress_1_6_300_0.4.json', {dataId:777, exploredCharCount:40, progress:0.4, lastBookmarkModified:300});
          let conflict = '';
          try {await handler.getProgress();} catch(error) {conflict = error.message;}
          const retained = [];
          for await (const name of directory.keys()) retained.push(name);
          await directory.removeEntry('progress_1_6_200_0.3.json');
          await directory.removeEntry('progress_1_6_300_0.4.json');
          await directory.removeEntry('bookdata_1_6_100_1_0.zip');
          const empty = (await handler.getProgress()) ?? null;
          await root.removeEntry(title);
          const missing = (await handler.getProgress()) ?? null;
          const localAfter = await db.get('bookmark', localID);
          const localBook = await db.get('data', localID);
          return {first, replaced, conflict, retained, empty, missing, localBefore, localAfter, localBook};
        }''')
        self.assertEqual(10, result['first']['exploredCharCount'])
        self.assertEqual(30, result['replaced']['exploredCharCount'])
        self.assertIn('Conflicting progress_', result['conflict'])
        self.assertEqual(3, len(result['retained']))
        self.assertIsNone(result['empty'])
        self.assertIsNone(result['missing'])
        self.assertEqual(result['localBefore'], result['localAfter'])
        self.assertEqual('<p>Keep the local copy</p>', result['localBook']['elementHtml'])

    def test_google_and_onedrive_open_paths_reject_unrelated_local_title_before_authorization(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Library actions', exact=True).wait_for()
        result = self.page.evaluate('''async () => {
          const {getStorageHandler} = await import('/Reader-Web/src/lib/data/storage/storage-handler-factory.ts');
          const {StorageKey} = await import('/Reader-Web/src/lib/data/storage/storage-types.ts');
          const {database} = await import('/Reader-Web/src/lib/data/store.ts');
          const {MergeMode} = await import('/Reader-Web/src/lib/data/merge-mode.ts');
          const {ReplicationSaveBehavior} = await import('/Reader-Web/src/lib/functions/replication/replication-options.ts');
          const db = await database.db;
          const title = 'Same title, different source';
          const id = await db.put('data', {title, storageSource:'local-original', elementHtml:'<p>Original</p>',
            styleSheet:'', blobs:{}, coverImage:'', hasThumb:false, characters:8, sections:[], lastBookModified:1, lastBookOpen:0});
          const errors = [];
          for (const storageType of [StorageKey.GDRIVE, StorageKey.ONEDRIVE]) {
            const handler = getStorageHandler(window, storageType, 'unrelated-cloud', true, false,
              ReplicationSaveBehavior.NewOnly, MergeMode.MERGE, MergeMode.MERGE, false);
            handler.startContext({title});
            for (const operation of ['hasLocalBookData', 'prepareBookForReading']) {
              try {await handler[operation](); errors.push('did not reject');}
              catch (error) {errors.push(error.message);}
            }
          }
          return {errors, book:await db.get('data', id)};
        }''')
        self.assertEqual(4, len(result['errors']))
        for message in result['errors']:
            self.assertIn('A different local copy already uses this title', message)
        self.assertEqual('local-original', result['book']['storageSource'])
        self.assertEqual('<p>Original</p>', result['book']['elementHtml'])


if __name__ == '__main__':
    suite = unittest.TestSuite([
        SharedSafetyStatic('test_opening_same_title_from_another_source_preserves_local_book_and_history'),
        SharedSafetyStatic('test_repeated_native_format_imports_do_not_double_count_statistics'),
        SharedStorageRuntime('test_directory_selection_does_not_create_a_nested_library_in_a_book_folder'),
        SharedStorageRuntime('test_uncached_provider_observes_replacement_and_disappearance_without_losing_local_data'),
        SharedStorageRuntime('test_google_and_onedrive_open_paths_reject_unrelated_local_title_before_authorization'),
    ])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
