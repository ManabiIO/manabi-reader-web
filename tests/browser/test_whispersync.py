"""Whispersync acceptance against the actual built Svelte app.

No request interception, framework mocks, or pre-populated reader database.
Run after BASE_PATH=/Reader-Web pnpm build, with Python Playwright installed.
"""
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import unittest
import wave
import zipfile
from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler

TITLE = 'Whispersync two chapter acceptance'
FIRST = 'The first audiobook chapter begins here.'
SECOND = 'The second audiobook chapter continues here.'
CAPTIONS = f'1\n00:00:00,000 --> 00:00:20,000\n{FIRST}\n\n2\n00:00:20,000 --> 00:00:40,000\n{SECOND}\n'


def epub():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        archive.writestr('content.opf', f'<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">{TITLE}</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>')
        for name, text in [('one', FIRST), ('two', SECOND)]:
            archive.writestr(f'{name}.xhtml', f'<html><head><title>{name}</title></head><body><h1>{name}</h1><p>{text}</p></body></html>')
    return output.getvalue()


def audio():
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b'\0\0' * (8000 * 40))
    return output.getvalue()


class WhispersyncBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        settings = {'viewMode': 'paginated', 'writingMode': 'vertical-rl'}
        self.context.add_init_script('if (location.origin === ' + json.dumps(self.origin) + ') { for (const [key,value] of Object.entries(' + json.dumps(settings) + ')) localStorage.setItem(key,value); }')

    def tearDown(self):
        diagnostics = Path('test-results')
        diagnostics.mkdir(exist_ok=True)
        try:
            self.page.screenshot(path=str(diagnostics / (self._testMethodName + '.png')), full_page=True)
            (diagnostics / (self._testMethodName + '.html')).write_text(self.page.content())
        finally:
            self.context.close()
            self.assertEqual([], self.errors)

    def open_fixture(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name': 'whispersync.epub', 'mimeType': 'application/epub+zip', 'buffer': epub()})
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_contain_text(FIRST, timeout=30000)
        self.open_panel()
        self.page.locator('input[type=file][accept*=".srt"]').set_input_files(
            {'name': 'captions.srt', 'mimeType': 'application/x-subrip', 'buffer': CAPTIONS.encode()})
        expect(self.page.get_by_text('captions.srt · 2 cues', exact=True)).to_be_visible()

    def open_panel(self):
        self.page.locator('#ttu-page-footer button[aria-haspopup="dialog"]').click()
        expect(self.page.get_by_role('dialog')).to_be_visible()
        expect(self.page.locator('input[type=file][accept*=".srt"]')).to_be_enabled()

    def wait_for_saved_captions(self):
        self.page.wait_for_function('''expected => new Promise((resolve, reject) => {
          const request = indexedDB.open('manabi-whispersync-v1', 1)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('sessions')
            const all = transaction.objectStore('sessions').getAll()
            transaction.oncomplete = () => { db.close(); resolve(all.result.some(record => record.subtitleSource === expected)) }
            transaction.onabort = () => { db.close(); reject(transaction.error) }
          }
        })''', arg=CAPTIONS)

    def test_whispersync_cross_chapter_navigation_in_real_paginated_reader(self):
        self.open_fixture()
        self.page.locator('input[type=file][accept*=".mp3"]').set_input_files(
            {'name': 'local-audiobook.wav', 'mimeType': 'audio/wav', 'buffer': audio()})
        self.page.wait_for_function('() => document.querySelector("audio")?.duration === 40')
        self.page.get_by_role('button', name='Match book', exact=True).click()
        expect(self.page.get_by_text('2 / 2 matched', exact=True)).to_be_visible(timeout=30000)
        self.page.get_by_role('button', name='Show cue 2 in book', exact=True).click()
        expect(self.page.get_by_role('dialog')).not_to_be_visible()
        expect(self.page.locator('.book-content')).to_contain_text(SECOND, timeout=10000)
        expect(self.page.locator('.book-content')).not_to_contain_text(FIRST)
        self.page.wait_for_function('() => !!CSS.highlights?.get("manabi-whispersync")')
        self.open_panel()
        self.page.get_by_role('button', name='Show cue 1 in book', exact=True).click()
        expect(self.page.locator('.book-content')).to_contain_text(FIRST, timeout=10000)
        # The same mounted media instance survives closing/reopening the drawer.
        self.assertEqual(1, self.page.locator('audio').count())
        self.assertEqual(40, self.page.locator('audio').evaluate('audio => audio.duration'))

    def test_whispersync_captions_restore_and_reset_in_real_app(self):
        self.open_fixture()
        self.wait_for_saved_captions()
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.open_panel()
        expect(self.page.get_by_text('captions.srt · 2 cues', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Remove saved audiobook data', exact=True).click()
        self.page.get_by_role('button', name='Remove', exact=True).click()
        expect(self.page.get_by_text('captions.srt · 2 cues', exact=True)).not_to_be_visible()
        expect(self.page.get_by_role('button', name='Remove saved audiobook data', exact=True)).to_be_enabled()
        self.page.reload()
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.open_panel()
        expect(self.page.get_by_text('captions.srt · 2 cues', exact=True)).not_to_be_visible()


    def test_whispersync_reset_in_second_tab_cannot_be_undone_by_stale_autosave(self):
        self.check_stale_autosave(load_audio=True)

    def test_whispersync_conflict_warning_is_visible_without_an_audio_file(self):
        self.check_stale_autosave(load_audio=False)

    def test_whispersync_matching_retains_selection_when_drawer_hides_reader(self):
        self.open_fixture()
        self.page.get_by_role('dialog').press('Escape')
        expect(self.page.get_by_role('dialog')).not_to_be_visible()
        self.page.locator('.book-content p').filter(has_text=FIRST).evaluate('''paragraph => {
          const range = document.createRange()
          range.selectNodeContents(paragraph)
          window.getSelection().removeAllRanges()
          window.getSelection().addRange(range)
        }''')
        self.open_panel()
        expect(self.page.get_by_role('button', name='Clear starting selection', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Match book', exact=True).click()
        expect(self.page.get_by_text('2 / 2 matched', exact=True)).to_be_visible(timeout=30000)

    def check_stale_autosave(self, load_audio):
        self.open_fixture()
        self.wait_for_saved_captions()
        if load_audio:
            self.page.locator('input[type=file][accept*=".mp3"]').set_input_files(
                {'name': 'local-audiobook.wav', 'mimeType': 'audio/wav', 'buffer': audio()})
            self.page.wait_for_function('() => document.querySelector("audio")?.duration === 40')
        other = self.context.new_page()
        other.on('pageerror', lambda error: self.errors.append(str(error)))
        try:
            other.goto(self.page.url)
            expect(other.locator('.book-content')).to_be_visible(timeout=30000)
            other.locator('#ttu-page-footer button[aria-haspopup="dialog"]').click()
            expect(other.get_by_text('captions.srt · 2 cues', exact=True)).to_be_visible()
            other.get_by_role('button', name='Remove saved audiobook data', exact=True).click()
            other.get_by_role('button', name='Remove', exact=True).click()
            expect(other.get_by_role('button', name='Remove saved audiobook data', exact=True)).to_be_enabled()
            expect(other.get_by_text('captions.srt · 2 cues', exact=True)).not_to_be_visible()
            self.page.bring_to_front()
            delay = self.page.get_by_label('Subtitle delay (seconds)')
            delay.fill('1')
            delay.press('Tab')
            expect(self.page.get_by_role('status').filter(has_text='changed in another tab')).to_be_visible()
            self.page.get_by_role('dialog').press('Escape')
            expect(self.page.get_by_role('dialog')).not_to_be_visible()
            expect(self.page.get_by_role('status').filter(has_text='Audiobook changes are not being saved.')).to_be_visible()
            self.page.get_by_role('button', name='View details', exact=True).click()
            expect(self.page.get_by_role('status').filter(has_text='changed in another tab')).to_be_visible()
            self.page.reload()
            expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
            self.open_panel()
            expect(self.page.get_by_text('captions.srt · 2 cues', exact=True)).not_to_be_visible()
        finally:
            other.close()


if __name__ == '__main__':
    unittest.main()
