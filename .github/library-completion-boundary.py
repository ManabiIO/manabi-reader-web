from pathlib import Path

def edit(path, before, after):
    p = Path(path)
    text = p.read_text()
    assert text.count(before) == 1, (path, text.count(before))
    p.write_text(text.replace(before, after))

edit('apps/web/src/routes/b/+page.svelte',
     "  import * as Sheet from '$lib/components/ui/sheet';",
     "  import * as Sheet from '$lib/components/ui/sheet';\n  import { setCompletion } from '$lib/library/commands';")
edit('apps/web/src/routes/b/+page.svelte',
     '''        await database.putBookmark(data);

        bookmarkData = Promise.resolve(data);''',
     '''        await database.putBookmark(data);
        // This is an explicit finish, not an autosave at 100%. It supersedes a
        // prior Still Reading decision without weakening stale-save protection.
        await setCompletion(data.dataId, 'finished');

        bookmarkData = database.getBookmark(data.dataId);''')

method = '''    def test_explicit_reader_completion_supersedes_still_reading(self):
        self.import_book('Finish once more')
        self.menu('Finish once more', 'Mark as Finished')
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')
        self.menu('Finish once more', 'Mark as Still Reading')
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('0%')
        before = self.stores('books', ['bookmark'])['bookmark'][0]
        self.assertEqual('reading', before['completion']['state'])
        self.page.get_by_role('button', name='Read Finish once more', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        toolbar = self.page.get_by_role('banner', name='Reader toolbar')
        if not toolbar.is_visible():
            self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        toolbar.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Complete Book', exact=True).click()
        self.page.get_by_role('dialog').get_by_role('button', name='Confirm', exact=True).click()
        self.page.wait_for_function(''' + '"""' + '''async id => {
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('books');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          try {const row=await new Promise((resolve,reject)=>{const r=db.transaction('bookmark').objectStore('bookmark').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return row?.completion?.state==='finished';}
          finally {db.close();}
        }''' + '"""' + ''', arg=before['dataId'], timeout=20000)
        after = self.stores('books', ['bookmark','statistic'])
        self.assertEqual('finished', after['bookmark'][0]['completion']['state'])
        self.assertGreater(after['bookmark'][0]['completion']['modifiedAt'], before['completion']['modifiedAt'])
        self.assertTrue(any(row.get('completedBook') == 1 for row in after['statistic']))
        self.go_library()
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')
        self.page.reload()
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')


'''
edit('tests/browser/test_books_library.py', 'class BooksLibraryFilesystem(LibraryBase):', method + 'class BooksLibraryFilesystem(LibraryBase):')
edit('docs/books-library.md',
     'these library actions. Sync retains the existing whole-bookmark conflict',
     "these library actions. The reader's explicit Complete Book action also publishes\na new completion decision, so it can supersede Still Reading; ordinary autosaves\ncannot. Sync retains the existing whole-bookmark conflict")
