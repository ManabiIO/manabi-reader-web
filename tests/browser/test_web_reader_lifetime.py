"""Qualification of actual Expo web reader retirement and browser entry ownership.

Generated local EPUBs and real IndexedDB only. One case deliberately throws at
the native bookmark-write boundary to qualify storage failure, without replacing
the reader, router, history implementation or existing browser assertions.
"""
import json
from pathlib import Path
import unittest

from playwright.sync_api import expect
from reader_controls import reveal_reader_controls
from test_books_library import LibraryBase


class WebReaderLifetime(LibraryBase):
    def setUp(self):
        super().setUp()
        self.context.add_init_script('''
          localStorage.setItem('viewMode', 'continuous');
          localStorage.setItem('writingMode', 'horizontal-tb');
          localStorage.setItem('confirmClose', localStorage.getItem('confirmClose') ?? '0');
          localStorage.setItem('manualBookmark', localStorage.getItem('manualBookmark') ?? '0');
          window.readerHistoryEvidence = [];
          const record = type => {
            const content = document.querySelector('.book-content');
            window.readerHistoryEvidence.push({type, time: performance.now(),
              url: location.href, scroll: [scrollX, scrollY],
              reader: !!content, busy: content?.getAttribute('aria-busy'),
              dialog: document.querySelector('dialog[open]')?.textContent?.slice(0, 180),
              footer: document.querySelector('#ttu-page-footer')?.textContent?.slice(0, 200)});
            window.readerHistoryEvidence.splice(0, Math.max(0, window.readerHistoryEvidence.length - 50));
          };
          for (const type of ['popstate', 'scroll', 'focusin'])
            window.addEventListener(type, () => record(type), true);
          window.recordReaderHistoryEvidence = record;
          const original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function(...args) {
            if (window.failReaderBookmarkWrite && this.name === 'bookmark'
                && this.transaction.db.name === 'books')
              throw new DOMException('Qualification bookmark write failed', 'QuotaExceededError');
            return Reflect.apply(original, this, args);
          };
        ''')
        self.page.reload()
        self.body = ''.join(f'<p>READING_POINT_{index:03d} 日本語の本文を読みます。</p>' for index in range(140))

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            state = self.page.evaluate('''() => ({url: location.href,
              historyLength: history.length, state: history.state,
              events: window.readerHistoryEvidence,
              preferences: Object.fromEntries(['confirmClose','manualBookmark','autoBookmark'].map(key => [key, localStorage.getItem(key)])),
              contents: [...document.querySelectorAll('.book-content')].map(node => ({
                connected: node.isConnected, busy: node.getAttribute('aria-busy'),
                text: node.textContent.slice(0, 160)
              }))})''')
            (output / f'{self.engine}-{self._testMethodName}-history.json').write_text(json.dumps(state))
        finally:
            super().tearDown()

    def read_book(self, title):
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        self.assert_reader()
        return self.page.url

    def assert_reader(self):
        expect(self.page.locator('.book-content')).to_have_count(1)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)

    def tool(self, name):
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name=name, exact=True).click()

    def remember_reader(self):
        self.page.evaluate('window.originalReader = document.querySelector(".book-content")')

    def assert_same_reader(self):
        self.assert_reader()
        self.assertTrue(self.page.locator('.book-content').evaluate('node => node === window.originalReader'))

    def close_to_library(self):
        reveal_reader_controls(self.page)
        self.page.locator('header[aria-label="Reader toolbar"]').get_by_role('button', name='Library', exact=True).click()
        expect(self.page).to_have_url(self.origin + '/reader-web/manage')
        expect(self.page.locator('.book-content')).to_have_count(0)

    def test_close_library_same_then_different_book_has_one_current_container(self):
        self.import_book('Lifetime A', body=self.body)
        self.import_book('Lifetime B', body='<p>Only the second reader owns this content.</p>')
        self.read_book('Lifetime A')
        self.remember_reader()
        self.close_to_library()
        self.read_book('Lifetime A')
        self.assertFalse(self.page.locator('.book-content').evaluate('node => node === window.originalReader'))
        self.close_to_library()
        self.read_book('Lifetime B')
        expect(self.page.locator('.book-content')).to_contain_text('Only the second reader owns this content.')

    def test_settings_back_forward_restores_original_entry_and_back_destination(self):
        self.import_book('Settings lifetime', body=self.body)
        reader_url = self.read_book('Settings lifetime')
        self.tool('Settings')
        expect(self.page.get_by_role('heading', name='Settings', exact=True)).to_be_visible()
        expect(self.page.locator('.book-content')).to_have_count(0)
        settings_url = self.page.url
        settings_id = self.page.evaluate('history.state.id')
        self.page.go_back()
        expect(self.page).to_have_url(reader_url)
        self.assert_reader()
        self.page.go_forward()
        expect(self.page).to_have_url(settings_url)
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.assertEqual(settings_id, self.page.evaluate('history.state.id'))
        self.page.get_by_role('link', name='Back', exact=True).click()
        expect(self.page).to_have_url(reader_url)
        self.assert_reader()

    def test_failed_back_keeps_original_reader_and_retries_without_replacing_entries(self):
        self.import_book('Failure lifetime', body=self.body)
        reader_url = self.read_book('Failure lifetime')
        self.page.locator('.book-content').get_by_text('READING_POINT_060', exact=False).scroll_into_view_if_needed()
        self.page.wait_for_function('scrollY > 500')
        self.tool('Save Reading Position')
        self.wait_bookmark(1, lambda value: value.get('exploredCharCount', 0) > 0)
        baseline = self.stores('books', ['bookmark'])['bookmark']
        position = self.page.evaluate('({x: scrollX, y: scrollY})')
        identity = self.page.evaluate('history.state.id')
        length = self.page.evaluate('history.length')
        self.remember_reader()
        self.page.evaluate('window.failReaderBookmarkWrite = true')
        self.page.go_back()
        error = self.page.get_by_role('dialog', name='Error', exact=True)
        expect(error).to_contain_text('Qualification bookmark write failed')
        expect(self.page).to_have_url(reader_url)
        self.assert_same_reader()
        self.assertEqual(identity, self.page.evaluate('history.state.id'))
        self.assertEqual(length, self.page.evaluate('history.length'))
        self.assertEqual(baseline, self.stores('books', ['bookmark'])['bookmark'])
        self.page.wait_for_function('({x,y}) => Math.abs(scrollX-x) <= 2 && Math.abs(scrollY-y) <= 2', arg=position)
        self.page.evaluate('window.failReaderBookmarkWrite = false')
        error.get_by_role('button', name='Close', exact=True).click()
        self.page.go_back()
        expect(self.page).to_have_url(self.origin + '/reader-web/manage')
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.page.go_forward()
        expect(self.page).to_have_url(reader_url)
        self.assert_reader()

    def test_canceled_browser_departure_keeps_original_reader_and_resume_target(self):
        self.page.evaluate("localStorage.setItem('confirmClose','1'); localStorage.setItem('manualBookmark','1'); localStorage.setItem('autoBookmark','0');")
        self.page.reload()
        self.import_book('Confirmation lifetime', body=self.body)
        reader_url = self.read_book('Confirmation lifetime')
        saved = self.stores('books', ['bookmark'])['bookmark']
        self.page.locator('.book-content').get_by_text('READING_POINT_060', exact=False).scroll_into_view_if_needed()
        self.page.wait_for_function('scrollY > 500')
        self.remember_reader()
        resume = self.stores('books', ['lastItem'])['lastItem']
        position = self.page.evaluate('({x: scrollX, y: scrollY})')
        self.assertEqual(saved, self.stores('books', ['bookmark'])['bookmark'])
        self.page.evaluate("recordReaderHistoryEvidence('before-first-back')")
        self.page.go_back()
        dialog = self.page.get_by_role('dialog', name='Confirm Exit', exact=True)
        expect(dialog).to_be_visible()
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        expect(dialog).to_have_count(0)
        expect(self.page).to_have_url(reader_url)
        self.assert_same_reader()
        self.assertEqual(resume, self.stores('books', ['lastItem'])['lastItem'])
        self.assertEqual(saved, self.stores('books', ['bookmark'])['bookmark'])
        self.page.evaluate("recordReaderHistoryEvidence('after-cancel')")
        self.page.wait_for_function('({x,y}) => Math.abs(scrollX-x) <= 2 && Math.abs(scrollY-y) <= 2', arg=position)
        self.page.go_back()
        expect(dialog).to_be_visible()
        dialog.get_by_role('button', name='Confirm', exact=True).click()
        expect(self.page).to_have_url(self.origin + '/reader-web/manage')
        expect(self.page.locator('.book-content')).to_have_count(0)
        self.assertEqual(resume, self.stores('books', ['lastItem'])['lastItem'])

    def test_epub_fragment_keeps_its_existing_reader_navigation_without_native_hash_history(self):
        self.import_book('Fragment lifetime', body='<p><a href="#target">Jump within this book</a></p>' + self.body + '<p id="target">OWNED_FRAGMENT_TARGET</p>')
        reader_url = self.read_book('Fragment lifetime')
        self.remember_reader()
        length = self.page.evaluate('history.length')
        self.page.locator('.book-content').get_by_role('link', name='Jump within this book', exact=True).click()
        expect(self.page.locator('.book-content').get_by_text('OWNED_FRAGMENT_TARGET', exact=True)).to_be_in_viewport()
        self.assert_same_reader()
        self.assertEqual(reader_url, self.page.url)
        self.assertEqual(length, self.page.evaluate('history.length'))

    def test_raw_app_links_keep_self_reader_then_replace_book_without_document_reload(self):
        self.import_book('Raw link A', body='<p>RAW_LINK_FIRST_BOOK</p>' + self.body)
        self.import_book('Raw link B', body='<p>RAW_LINK_SECOND_BOOK</p>' + self.body)
        first_url = self.read_book('Raw link A')
        self.close_to_library()
        second_url = self.read_book('Raw link B')
        self.remember_reader()
        self.page.evaluate('window.rawLinkWitness = {}')
        identity = self.page.evaluate('history.state.id')
        length = self.page.evaluate('history.length')

        def click_raw_link(url):
            self.page.evaluate('''url => {
              const anchor = document.createElement('a');
              anchor.href = url; anchor.textContent = 'Raw reader route';
              anchor.style.cssText = 'position:fixed;top:8px;left:8px;z-index:1000;background:white;color:black';
              anchor.dataset.readerQualificationLink = ''; document.body.append(anchor);
            }''', url)
            self.page.get_by_role('link', name='Raw reader route', exact=True).click()
            self.page.evaluate("document.querySelector('[data-reader-qualification-link]')?.remove()")

        click_raw_link(second_url)
        self.assert_same_reader()
        self.assertEqual(identity, self.page.evaluate('history.state.id'))
        self.assertEqual(length, self.page.evaluate('history.length'))
        self.assertTrue(self.page.evaluate('!!window.rawLinkWitness'))
        click_raw_link(first_url)
        expect(self.page).to_have_url(first_url)
        self.assert_reader()
        expect(self.page.locator('.book-content')).to_contain_text('RAW_LINK_FIRST_BOOK')
        self.assertTrue(self.page.evaluate('!!window.rawLinkWitness'))
        self.assertFalse(self.page.evaluate('window.originalReader.isConnected'))
        self.assertEqual(length + 1, self.page.evaluate('history.length'))
        self.page.go_back()
        expect(self.page).to_have_url(second_url)
        self.assert_reader()
        expect(self.page.locator('.book-content')).to_contain_text('RAW_LINK_SECOND_BOOK')
        self.assertEqual(identity, self.page.evaluate('history.state.id'))
        self.assertTrue(self.page.evaluate('!!window.rawLinkWitness'))
        self.page.go_forward()
        expect(self.page).to_have_url(first_url)
        self.assert_reader()
        expect(self.page.locator('.book-content')).to_contain_text('RAW_LINK_FIRST_BOOK')
        self.assertTrue(self.page.evaluate('!!window.rawLinkWitness'))

    def test_unknown_fragment_fails_visibly_without_losing_live_reader_or_replacing_history(self):
        self.import_book('Unknown history lifetime', body=self.body)
        self.read_book('Unknown history lifetime')
        self.remember_reader()
        length = self.page.evaluate('history.length')
        self.page.evaluate("location.hash = 'untracked-qualification-entry'")
        expect(self.page.get_by_role('alert').filter(has_text='Navigation paused:')).to_be_visible()
        self.assert_same_reader()
        self.assertEqual(length + 1, self.page.evaluate('history.length'))
        self.assertTrue(self.page.url.endswith('#untracked-qualification-entry'))

    def test_tracked_fragment_back_forward_keeps_the_same_reader_and_expo_entry(self):
        self.import_book('Tracked fragment lifetime', body=self.body)
        reader_url = self.read_book('Tracked fragment lifetime')
        self.remember_reader()
        identity = self.page.evaluate('history.state.id')
        self.page.evaluate("history.pushState(history.state, '', location.href + '#tracked-qualification-entry')")
        self.page.go_back()
        expect(self.page).to_have_url(reader_url)
        self.assert_same_reader()
        self.assertEqual(identity, self.page.evaluate('history.state.id'))
        self.page.go_forward()
        expect(self.page).to_have_url(reader_url + '#tracked-qualification-entry')
        self.assert_same_reader()
        self.assertEqual(identity, self.page.evaluate('history.state.id'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
