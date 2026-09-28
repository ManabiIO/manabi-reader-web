"""Built-app local move recovery with Chromium's native OPFS, IndexedDB and Web Locks.

The initial copied journal and concurrent source removal are explicit fixtures.
The actual Rename, Resume and Move actions execute the production application.
"""
import hashlib
import time
import unittest

from playwright.sync_api import expect
import test_books_library as library


class LocalMoveRecoveryBrowser(library.LibraryBase):
    seed_files = library.BooksLibraryFilesystem.seed_files
    disk = library.BooksLibraryFilesystem.disk

    def test_pending_move_rejects_rename_then_resumes_with_unchanged_bytes(self):
        first, second = library.book('Move first'), library.book('Move second')
        operation_id = '11111111-1111-4111-8111-111111111111'
        self.seed_files({
            'First.epub': first,
            'Second.epub': second,
            'Pending/First.epub': first,
            'Pending/Second.epub': second,
            'Pending/.manabi-reader.yaml': b'name: "Pending"\n',
            'Pending/.manabi-reader-operation-' + operation_id: operation_id.encode()
        })
        plan = {
            'version': 1, 'id': operation_id, 'sourceId': self.source_id,
            'parent': '', 'folder': 'Pending', 'name': 'Pending', 'phase': 'copied',
            'files': [
                {'from': name, 'to': 'Pending/' + name, 'hash': hashlib.sha256(data).hexdigest()}
                for name, data in [('First.epub', first), ('Second.epub', second)]
            ]
        }
        self.page.evaluate('''async plan => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('manabi-reader-integrations');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('metadata', 'readwrite');
          tx.objectStore('metadata').put(plan, 'library-file-operation:' + plan.sourceId);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
        }''', plan)
        self.go_library()
        expect(self.page.get_by_role('button', name='Resume Folder Change', exact=True)).to_be_visible()
        before = self.disk()
        self.page.get_by_role('button', name='Actions for series Pending', exact=True).click()
        self.page.get_by_role('menuitem', name='Rename Series…', exact=True).click()
        self.dialog().get_by_label('Name', exact=True).fill('Different name')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog().get_by_role('alert')).to_contain_text(
            'Resume the unfinished folder change')
        self.assertEqual(before, self.disk())
        self.page.keyboard.press('Escape')
        expect(self.dialog()).to_have_count(0)
        self.page.get_by_role('button', name='Resume Folder Change', exact=True).click()
        expect(self.page.get_by_role('button', name='Resume Folder Change', exact=True)).to_have_count(
            0, timeout=30000)
        after = self.disk()
        self.assertEqual(before['First.epub'], after['Pending/First.epub'])
        self.assertEqual(before['Second.epub'], after['Pending/Second.epub'])
        self.assertNotIn('First.epub', after)
        self.assertNotIn('Second.epub', after)
        self.assertFalse(any('operation-' in path for path in after))
        self.go_library()
        expect(self.page.get_by_role('button', name='Open series Pending', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Resume Folder Change', exact=True)).to_have_count(0)

    def test_queued_move_cannot_use_a_source_removed_before_lock_admission(self):
        self.seed_files({'First.epub': library.book('Move first'), 'Second.epub': library.book('Move second')})
        before = self.disk()
        self.page.evaluate('''() => {
          window.moveLockHeld = false;
          window.moveLockTask = navigator.locks.request('manabi-reader:import-library-book', async () => {
            window.moveLockHeld = true;
            await new Promise(resolve => window.releaseMoveLock = resolve);
          });
        }''')
        self.page.wait_for_function('window.moveLockHeld === true')
        self.open_organize_menu()
        self.page.get_by_role('menuitem', name='Create Series from Books…', exact=True).click()
        self.dialog().get_by_label('Name', exact=True).fill('Should not exist')
        checkboxes = self.dialog().get_by_role('checkbox')
        expect(checkboxes).to_have_count(2)
        for checkbox in checkboxes.all():
            checkbox.check()
        self.dialog().get_by_role('button', name='Move into Series', exact=True).click()
        # Admission is blocked by a real origin lock, not a mocked importer.
        deadline = time.monotonic() + 20
        while not self.page.evaluate("""async () => (await navigator.locks.query()).pending.some(
                lock => lock.name === 'manabi-reader:import-library-book')"""):
            self.assertLess(time.monotonic(), deadline, 'Move never requested its admission lock')
            self.page.wait_for_timeout(25)
        self.page.evaluate('''async sourceId => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('manabi-reader-integrations');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('localLibraries', 'readwrite');
          tx.objectStore('localLibraries').delete(sourceId);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          });
          db.close();
          window.releaseMoveLock();
          await window.moveLockTask;
        }''', self.source_id)
        expect(self.dialog().get_by_role('alert')).to_contain_text(
            'local folder was disconnected or replaced')
        self.assertEqual(before, self.disk())
        self.assertFalse(any(row.get('sourceId') == self.source_id and 'phase' in row
                             for row in self.stores('manabi-reader-integrations', ['metadata'])['metadata']
                             if isinstance(row, dict)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
