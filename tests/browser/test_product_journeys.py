"""Product QA journeys through the built app, real Workers and native IndexedDB.

Only generated local books are used. No account fixture, request interception,
substitute renderer, storage seeding, forced click or browser security override.
"""
import json
from pathlib import Path
import re
import unittest
from xml.sax.saxutils import escape

from playwright.sync_api import expect
from test_books_library import LibraryBase, book


class ProductJourneys(LibraryBase):
    def setUp(self):
        try:
            super().setUp()
        except BaseException:
            if hasattr(self, 'context'):
                self.context.close()
            if hasattr(self, 'profile'):
                self.profile.cleanup()
            raise
        self.output = Path('test-results/product-journeys') / self.engine
        self.output.mkdir(parents=True, exist_ok=True)
        self.console = []
        self.checkpoints = []
        self.page.on('console', lambda message: self.console.append({
            'level': message.type, 'text': message.text
        }))
        self.context.on('page', lambda page: page.on(
            'pageerror', lambda error: self.errors.append(error.stack or str(error))))
        # The existing harness has hydrated the initial Library. Trace every
        # journey action after that point, including navigation, imports and I/O.
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)

    def tearDown(self):
        try:
            self.checkpoint('final')
            self.context.tracing.stop(path=str(self.output / (self._testMethodName + '.trace.zip')))
            (self.output / (self._testMethodName + '.json')).write_text(json.dumps({
                'engine': self.engine,
                'test': self._testMethodName,
                'checkpoints': self.checkpoints,
                'page_errors': self.errors,
                'console': self.console
            }, indent=2))
        finally:
            # Preserve the base's page-error and unsafe-resource assertions,
            # screenshots and HTML, and always close the disposable profile.
            super().tearDown()

    def checkpoint(self, label):
        name = self._testMethodName + '-' + label
        self.page.screenshot(path=str(self.output / (name + '.png')))
        (self.output / (name + '.html')).write_text(self.page.content())
        self.checkpoints.append({
            'label': label, 'url': self.page.url, 'viewport': self.page.viewport_size,
            'screenshot': name + '.png'
        })

    def read(self, title):
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('button[data-reader-controls]')).to_be_visible()

    def reader_search(self):
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Search Book', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Search Book', exact=True)
        expect(panel).to_be_visible()
        return panel, panel.get_by_role('searchbox', name='Search within book', exact=True)

    def result_buttons(self, panel):
        # The "Show more" action lives in the same region but is not a hit.
        return panel.locator('[aria-label="Search results"] button').filter(
            has=self.page.get_by_text('Section 1', exact=True))

    def library_search(self, query):
        field = self.page.get_by_role('searchbox', name='Search library', exact=True)
        if not field.is_visible():
            self.page.get_by_role('button', name='Search library', exact=True).click()
        field.fill(query)
        return field

    def pagination(self, *, width, height, writing):
        # Explicit counts come from authored paragraphs, not the worker output.
        body = ''.join(f'<p>PAGE_TOKEN passage {index:03d}. 日本語の本文。</p>' for index in range(127))
        body += '<p>ONLY_ONE_RESULT at the end.</p>'
        self.page.evaluate('(writing) => localStorage.setItem("writingMode", writing)', writing)
        self.page.set_viewport_size({'width': width, 'height': height})
        self.go_library()
        self.import_book('Pagination journey', body=body)
        self.read('Pagination journey')
        panel, field = self.reader_search()
        field.fill('PAGE_TOKEN')
        expect(panel.get_by_text('127 results', exact=True)).to_be_visible()
        hits = self.result_buttons(panel)
        expect(hits).to_have_count(50)
        self.checkpoint('first-fifty')
        more = panel.get_by_role('button', name='Show more results', exact=True)
        more.click()
        expect(hits).to_have_count(100)
        more.click()
        expect(hits).to_have_count(127)
        expect(more).to_have_count(0)
        texts = hits.all_text_contents()
        self.assertIn('passage 000', texts[0])
        self.assertIn('passage 126', texts[-1])
        self.assertEqual(127, len(set(texts)), 'Pagination repeated results')
        field.fill('ONLY_ONE_RESULT')
        expect(panel.get_by_text('1 results', exact=True)).to_be_visible()
        expect(hits).to_have_count(1)
        field.fill('PAGE_TOKEN')
        expect(panel.get_by_text('127 results', exact=True)).to_be_visible()
        expect(hits).to_have_count(50)
        expect(more).to_be_attached()
        self.checkpoint('pagination-reset')
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        # Opening Search intentionally collapses the toolbar and removes its
        # menu trigger. Dismissal must restore the surviving reveal control.
        controls = self.page.get_by_role('button', name='Show reading controls', exact=True)
        expect(controls).to_be_focused()
        self.page.keyboard.press('Enter')
        expect(self.page.get_by_role('button', name='Reading tools', exact=True)).to_be_visible()

    def test_reader_pagination_reset_horizontal_desktop(self):
        self.pagination(width=1280, height=900, writing='horizontal-tb')

    def test_reader_pagination_reset_vertical_phone(self):
        self.pagination(width=390, height=844, writing='vertical-rl')

    def test_reader_query_limit_counts_unicode_and_recovers(self):
        boundary = '𠮷' * 512  # 512 code points, 1024 UTF-16 code units.
        self.import_book('Reader query boundary', body='<p>' + boundary + '</p><p>RECOVER_ME</p>')
        self.read('Reader query boundary')
        panel, field = self.reader_search()
        field.fill(boundary)
        expect(panel.get_by_text('1 results', exact=True)).to_be_visible()
        expect(self.result_buttons(panel)).to_have_count(1)
        field.fill(boundary + '𠮷')
        expect(panel.get_by_role('alert')).to_have_text('Use a search of 512 characters or fewer.')
        expect(field).to_have_attribute('aria-invalid', 'true')
        expect(self.result_buttons(panel)).to_have_count(0)
        expect(panel.get_by_role('button', name='Retry Search', exact=True)).to_have_count(0)
        self.checkpoint('over-limit')
        field.fill('RECOVER_ME')
        expect(panel.get_by_text('1 results', exact=True)).to_be_visible()
        expect(panel.get_by_role('alert')).to_have_count(0)
        expect(field).not_to_have_attribute('aria-invalid', 'true')
        expect(self.result_buttons(panel)).to_have_count(1)

    def test_reader_literal_search_and_clear_do_not_reuse_old_hits(self):
        self.import_book('Literal search', body=(
            '<p>Find [a+b].*? here.</p><p>A regex impostor: aaab</p>'
            '<p>Astral sequence: 𠮷猫🍵</p><p>Nothing else matches.</p>'
        ))
        self.read('Literal search')
        panel, field = self.reader_search()
        for query in ('[a+b].*?', '𠮷猫🍵'):
            field.fill(query)
            expect(panel.get_by_text('1 results', exact=True)).to_be_visible()
            expect(self.result_buttons(panel)).to_have_count(1)
            expect(self.result_buttons(panel).first).to_contain_text(query)
        field.fill('NOT_PRESENT_IN_BOOK')
        expect(panel.get_by_text('0 results', exact=True)).to_be_visible()
        expect(self.result_buttons(panel)).to_have_count(0)
        field.fill('')
        expect(panel.get_by_text('Enter a word or phrase.', exact=True)).to_be_visible()
        expect(self.result_buttons(panel)).to_have_count(0)
        field.fill('[a+b].*?')
        expect(panel.get_by_text('1 results', exact=True)).to_be_visible()
        expect(self.result_buttons(panel)).to_have_count(1)
        self.checkpoint('literal-result')

    def test_library_query_limit_recovers_to_a_real_passage(self):
        boundary = '𠮷' * 512
        self.import_book('Library query boundary', body='<p>' + boundary + '</p><p>RECOVER_ME</p>')
        self.library_search(boundary)
        expect(self.page.get_by_role('button', name='Open passage in Library query boundary: ' + boundary, exact=True)).to_be_visible()
        self.library_search(boundary + '𠮷')
        results = self.page.locator('[aria-label="Library search results"]')
        expect(results.get_by_role('alert')).to_have_text('Use a search of 512 characters or fewer.')
        expect(self.page.get_by_role('button', name=re.compile('^Open passage in '))).to_have_count(0)
        self.checkpoint('library-over-limit')
        self.library_search('RECOVER_ME')
        expect(results.get_by_role('alert')).to_have_count(0)
        self.page.get_by_role('button', name='Open passage in Library query boundary: RECOVER_ME', exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('.book-content').first).to_contain_text('RECOVER_ME')
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))

    def test_library_metadata_pagination_resets_on_query_change(self):
        titles = [f'Catalog QA {index:02d}' for index in range(61)]
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files([
            {'name': title + '.epub', 'mimeType': 'application/epub+zip',
             'buffer': book(title, body='<p>' + escape(title) + ' unique body.</p>', size=(12, 18))}
            for title in titles
        ])
        # The real bulk import reloads the Library workspace. Wait for its
        # completed count and hydration before entering the post-import query;
        # typing into the old workspace exercises a different lifetime race.
        expect(self.page.get_by_role('button', name='Books 61', exact=True)).to_be_visible(timeout=60000)
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute('data-hydrated', 'true')
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute('aria-busy', 'false')
        expect(self.library_search('Catalog QA')).to_have_value('Catalog QA')
        expect(self.page.get_by_role('heading', name='Books 61', exact=True)).to_be_visible(timeout=60000)
        matches = self.page.locator('[aria-label="Library search results"]').get_by_role('button', name=re.compile('^Read Catalog QA '))
        expect(matches).to_have_count(30)
        more = self.page.get_by_role('button', name='Show more books', exact=True)
        more.click()
        expect(matches).to_have_count(60)
        more.click()
        expect(matches).to_have_count(61)
        expect(more).to_have_count(0)
        self.assertEqual(set(titles), {text.removeprefix('Read ') for text in matches.evaluate_all('nodes => nodes.map(n => n.getAttribute("aria-label"))')})
        self.library_search('Catalog QA 60')
        expect(self.page.get_by_role('heading', name='Books 1', exact=True)).to_be_visible()
        expect(matches).to_have_count(1)
        self.library_search('Catalog QA')
        expect(self.page.get_by_role('heading', name='Books 61', exact=True)).to_be_visible()
        expect(matches).to_have_count(30)
        self.checkpoint('metadata-pagination-reset')
        self.library_search('')
        self.assertEqual(61, len(self.stores('books', ['data'])['data']))
        self.page.reload()
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.library_search('Catalog QA 60')
        expect(self.page.get_by_role('button', name='Read Catalog QA 60', exact=True)).to_be_visible()

    def test_corrupt_epub_retry_keeps_existing_book_and_recovers(self):
        self.import_book('Keep existing', body='<p>Existing local book must survive.</p>')
        before = self.stores('books', ['data'])['data']
        picker = self.page.locator('input[type=file][accept*=".epub"]').first
        picker.set_input_files({'name': 'retry.epub', 'mimeType': 'application/epub+zip', 'buffer': b'not a zip archive'})
        expect(self.page.get_by_text('Bookimport failed', exact=True)).to_be_visible()
        self.checkpoint('corrupt-import')
        self.assertEqual(before, self.stores('books', ['data'])['data'])
        self.page.keyboard.press('Escape')
        expect(self.page.get_by_text('Bookimport failed', exact=True)).to_have_count(0)
        picker.set_input_files({'name': 'retry.epub', 'mimeType': 'application/epub+zip',
                                'buffer': book('Recovered import', body='<p>A corrected file now reads.</p>')})
        expect(self.page.get_by_role('button', name='Read Recovered import', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Keep existing', exact=True)).to_be_visible()
        rows = self.stores('books', ['data'])['data']
        self.assertEqual({'Keep existing', 'Recovered import'}, {row['title'] for row in rows})
        self.assertEqual(before[0], next(row for row in rows if row['title'] == 'Keep existing'))
        self.read('Recovered import')
        self.page.reload()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('.book-content').first).to_contain_text('A corrected file now reads.')

    def test_settings_return_to_reader_keeps_saved_font_size(self):
        self.import_book('Settings round trip', body='<p>日本語の読書を続けます。</p>' * 80)
        self.read('Settings round trip')
        reader_url = self.page.url
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Settings', exact=True).click()
        expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Fonts & text', exact=True).click()
        field = self.page.get_by_role('spinbutton', name='Font size', exact=True)
        field.fill('28')
        field.press('Tab')
        expect(field).to_have_value('28')
        self.checkpoint('settings-saved')
        self.page.get_by_role('link', name='Back', exact=True).click()
        expect(self.page).to_have_url(reader_url)
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('.book-content').first).to_have_css('font-size', '28px')
        self.page.reload()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('.book-content').first).to_have_css('font-size', '28px')
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))

    def test_statistics_heading_keeps_words_whole_at_large_text(self):
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Statistics', exact=True).click()
        toolbar = self.page.get_by_role('banner', name='Statistics toolbar')
        for width, height, scale in ((320, 568, '200%'), (390, 844, '100%'), (1280, 900, '100%')):
            with self.subTest(width=width, scale=scale):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.evaluate('scale => document.documentElement.style.fontSize = scale', scale)
                trigger = toolbar.get_by_role('button', name='Statistics options', exact=True)
                trigger.click()
                self.page.get_by_role('menuitem', name='Statistics Settings', exact=True).click()
                panel = self.page.get_by_role('dialog', name='Statistics options', exact=True)
                title = panel.get_by_role('heading', name='Statistics options', exact=True)
                close = panel.get_by_role('button', name='Close statistics options', exact=True)
                expect(title).to_be_in_viewport()
                expect(close).to_be_in_viewport()
                self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                # Range rectangles inspect the real word layout, not screenshot
                # pixels or a style spelling that could pass while still broken.
                rects = title.evaluate("""element => {
                  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                  let node;
                  while ((node = walker.nextNode())) {
                    const at = node.data.indexOf('Statistics');
                    if (at < 0) continue;
                    const range = document.createRange();
                    range.setStart(node, at); range.setEnd(node, at + 'Statistics'.length);
                    return [...range.getClientRects()].map(r => ({x:r.x,y:r.y,width:r.width,height:r.height}));
                  }
                  throw new Error('Statistics heading text not found');
                }""")
                self.assertEqual(1, len(rects), 'Statistics splits in the middle of the word')
                word, dismiss = rects[0], close.bounding_box()
                overlap = (min(word['x'] + word['width'], dismiss['x'] + dismiss['width']) > max(word['x'], dismiss['x']) and
                           min(word['y'] + word['height'], dismiss['y'] + dismiss['height']) > max(word['y'], dismiss['y']))
                self.assertFalse(overlap, 'Unbroken heading must not overlap dismissal')
                self.assertGreaterEqual(word['x'], 0)
                self.assertLessEqual(word['x'] + word['width'], width + 1)
                self.checkpoint(f'statistics-{width}')
                close.click()
                expect(panel).to_have_count(0)
                expect(trigger).to_be_focused()


if __name__ == '__main__':
    unittest.main(verbosity=2)
