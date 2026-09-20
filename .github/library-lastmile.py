from pathlib import Path

def edit(path, old, new):
    p = Path(path)
    source = p.read_text()
    assert source.count(old) == 1, (path, old[:100], source.count(old))
    p.write_text(source.replace(old, new))

edit('apps/web/src/lib/data/storage/handler/base-handler.ts',
     "import type { ArchiveBudget } from '$lib/functions/file-loaders/utils/limited-archive';",
     "import type { ArchiveBudget } from '$lib/functions/file-loaders/utils/limited-archive';\nimport type { Section } from '$lib/data/database/books-db/versions/v4/books-db-v4';")
edit('apps/web/src/lib/data/storage/handler/browser-handler.ts',
     '        lastBookOpen: storedBookData.lastBookOpen || 0,\n        isPlaceholder:',
     '        lastBookOpen: storedBookData.lastBookOpen || 0,\n        pageDirection: storedBookData.pageDirection,\n        isPlaceholder:')
edit('apps/web/src/lib/library/library-workspace.svelte',
     "    void goto(`${resolve('/manage')}${url.search}`);",
     "    void goto(resolve(`/manage?${url.searchParams.toString()}`));")

p = Path('tests/browser/test_books_library.py')
s = p.read_text()
new_tests = '''    def test_finished_and_custom_collections_filter_the_actual_library(self):
        self.import_book('Finished selection')
        self.import_book('Still reading selection')
        self.add_collection('Still reading selection', 'Personal selection')
        self.menu('Finished selection', 'Mark as Finished')
        expect(self.tile('Finished selection').locator('.progress-label')).to_have_text('Finished')
        def choose(name):
            self.page.get_by_role('button', name='Collections', exact=True).click()
            self.page.locator('[data-slot="sheet-content"]').get_by_role('button', name=re.compile('^' + re.escape(name) + r'\\b')).click()
        choose('Finished')
        expect(self.page.get_by_role('heading', name='Finished', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_have_count(0)
        choose('Personal selection')
        expect(self.page.get_by_role('heading', name='Personal selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)
        self.page.reload()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)
        choose('Books')
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()

    def test_finished_date_and_binding_survive_real_export_migration_and_repeat(self):
        self.import_book('Portable finished book', spine='rtl')
        expect(self.tile('Portable finished book').locator('.cover-stage')).to_have_attribute('data-direction', 'rtl')
        self.menu('Portable finished book', 'Mark as Finished')
        expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
        self.menu('Portable finished book', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2024-02-29')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        before = self.stores('books', ['bookmark','statistic','data'])
        self.page.get_by_role('button', name='Select books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        self.page.get_by_role('button', name='Export', exact=True).click()
        self.page.get_by_role('button', name='Zip File', exact=True).click()
        for label in ('Book Data','Bookmark','Statistics'):
            self.page.get_by_label(label, exact=True).check()
        with self.page.expect_download(timeout=60000) as pending:
            self.page.get_by_role('button', name='Start', exact=True).click()
        raw = Path(pending.value.path()).read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            name = next(name for name in archive.namelist() if '/bookdata_' in name)
            with zipfile.ZipFile(io.BytesIO(archive.read(name))) as content:
                static = json.loads(content.read('staticdata.json'))
                self.assertEqual({'value':'rtl','source':'spine'}, static['pageDirection'])
                self.assertEqual('ja', static['language'])
        original = self.page
        with tempfile.TemporaryDirectory() as profile:
            destination = getattr(self.playwright, self.engine).launch_persistent_context(profile)
            self.page = destination.pages[0]
            self.page.on('pageerror', lambda e: self.errors.append(str(e)))
            try:
                self.page.goto(self.origin + '/Reader-Web/import-ttu')
                chooser = self.page.get_by_label('Choose Ttu export ZIPs', exact=True)
                chooser.set_input_files({'name':'library-backup.zip','mimeType':'application/zip','buffer':raw})
                expect(chooser).to_be_enabled()
                self.page.get_by_role('button', name=re.compile(r'^Import selected \\(')).click()
                imported = self.page.get_by_role('article', name='Import Portable finished book', exact=True)
                expect(imported.get_by_role('status')).to_have_text('Imported Portable finished book.', timeout=30000)
                migrated = self.stores('books', ['bookmark','statistic','data'])
                self.assertEqual(before['bookmark'][0]['completion'], migrated['bookmark'][0]['completion'])
                self.assertEqual(before['bookmark'][0]['progress'], migrated['bookmark'][0]['progress'])
                self.assertEqual(before['statistic'], migrated['statistic'])
                self.assertEqual(before['data'][0]['pageDirection'], migrated['data'][0]['pageDirection'])
                self.page.get_by_role('button', name='Select all', exact=True).click()
                self.page.get_by_role('button', name=re.compile(r'^Import selected \\(')).click()
                expect(imported.get_by_role('status')).to_contain_text('Already imported', timeout=30000)
                self.assertEqual(migrated['bookmark'], self.stores('books', ['bookmark'])['bookmark'])
                self.go_library()
                expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
                expect(self.tile('Portable finished book').locator('.cover-stage')).to_have_attribute('data-direction', 'rtl')
                self.page.reload()
                expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
                self.assertEqual('2024-02-29', self.stores('books', ['bookmark'])['bookmark'][0]['completion']['finishedOn'])
            finally:
                Path('test-results').mkdir(exist_ok=True)
                self.page.screenshot(path='test-results/' + self.engine + '-portable-completion.png', full_page=True)
                destination.close()
                self.page = original


'''
assert s.count('class BooksLibraryFilesystem(LibraryBase):') == 1
s = s.replace('class BooksLibraryFilesystem(LibraryBase):', new_tests + 'class BooksLibraryFilesystem(LibraryBase):')
s = s.replace("'Wrapper/Volumes/Nested/3.epub':book('Volume 3')", "'Wrapper/Volumes/5.epub':book('Volume 5'),'Wrapper/Volumes/Nested/3.epub':book('Volume 3')")
s = s.replace("'.series-hero .cover-stack')).to_have_attribute('data-cover-count','4')", "'.series-hero .cover-stack')).to_have_attribute('data-cover-count','5')")
p.write_text(s)
