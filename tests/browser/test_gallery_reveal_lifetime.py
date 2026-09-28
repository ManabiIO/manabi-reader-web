"""Real EPUB gallery intent/focus journeys; only a real HTTP font response is delayed."""
import io
import json
import re
import threading
import unittest
import zipfile
from pathlib import Path

from playwright.sync_api import expect
from test_books_library import LibraryBase, book, raster
from test_static_reader import StaticHandler


FONT_PATH = re.compile(r"/NotoSerifJP-Regular[^/]*\.woff2(?:\?.*)?$")


class FontResponseGate:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.paths = []
        self.expired = False


class GalleryStaticHandler(StaticHandler):
    def do_GET(self):
        gate = getattr(self.server, "font_gate", None)
        if gate is not None and FONT_PATH.search(self.path):
            gate.paths.append(self.path)
            gate.started.set()
            # A failed test cannot leave a server thread or browser request hung.
            if not gate.release.wait(20):
                gate.expired = True
                self.send_error(504, "The test did not release the font response")
                return
        super().do_GET()


def illustrated_book(title):
    source = book(title, body='<h1>挿絵のある本</h1>'
                  '<img src="../Images/cover.png" alt="First illustration"/>'
                  '<p>次の挿絵を読みます。</p>'
                  '<img src="../Images/second.png" alt="Second illustration"/>')
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source)) as original, zipfile.ZipFile(output, 'w') as target:
        for item in original.infolist():
            value = original.read(item)
            if item.filename == 'OEBPS/book.opf':
                value = value.replace(b'</manifest>', b'<item id="second" href="Images/second.png" media-type="image/png"/></manifest>')
            target.writestr(item.filename, value)
        target.writestr('OEBPS/Images/second.png', raster(180, 280, (24, 100, 146)))
    return output.getvalue()


class GalleryRevealLifetime(LibraryBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Reuse the real static server and its security probes. Only this suite's
        # explicitly gated font response differs from the ordinary handler.
        cls.server.RequestHandlerClass = GalleryStaticHandler

    def setUp(self):
        super().setUp()
        self.output = Path('test-results') / 'gallery-reveal' / self.engine / self._testMethodName
        self.output.mkdir(parents=True, exist_ok=True)
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)
        self.context.add_init_script('''
          localStorage.setItem('hideSpoilerImage', '1');
          localStorage.setItem('hideSpoilerImageMode', 'all');
          localStorage.setItem('viewMode', 'continuous');
          localStorage.setItem('fontFamilyGroupOne', 'Klee One');
        ''')
        self.go_library()

    def tearDown(self):
        try:
            self.capture('final')
            (self.output / 'page-errors.json').write_text(json.dumps(self.errors, indent=2))
            self.context.tracing.stop(path=str(self.output / 'trace.zip'))
        finally:
            super().tearDown()

    def capture(self, stage):
        self.page.screenshot(path=str(self.output / (stage + '.png')))
        (self.output / (stage + '.html')).write_text(self.page.content())

    def open_book(self, title='Gallery intent'):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': title + '.epub', 'mimeType': 'application/epub+zip',
            'buffer': illustrated_book(title)
        })
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_visible()

    def open_gallery(self):
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Image Gallery', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Image gallery', exact=True)
        expect(panel).to_be_visible()
        expect(panel.locator('.gallery-thumbnail')).to_have_count(2)
        return panel

    def close_gallery(self, panel):
        panel.get_by_role('button', name='Close Image Gallery', exact=True).click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()

    def reveal_second(self, panel):
        panel.get_by_role('button', name='Show hidden image 2', exact=True).click()
        expect(panel.get_by_role('button', name='View image 2', exact=True)).to_be_visible()
        expect(panel.get_by_role('button', name='Show hidden image 1', exact=True)).to_be_visible()

    def test_phone_reveal_and_reopen_preserve_only_the_chosen_image(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.open_book()
        panel = self.open_gallery()
        self.reveal_second(panel)
        panel.get_by_role('button', name='View image 2', exact=True).click()
        expect(panel.locator('.gallery-viewer img')).to_have_attribute('alt', 'Book illustration 2')
        self.capture('phone-revealed')
        self.close_gallery(panel)
        panel = self.open_gallery()
        expect(panel.get_by_role('button', name='View image 2', exact=True)).to_be_visible()
        expect(panel.get_by_role('button', name='Show hidden image 1', exact=True)).to_be_visible()
        self.close_gallery(panel)

    def test_keyboard_reveal_retains_viewer_focus_and_image_navigation(self):
        self.open_book()
        panel = self.open_gallery()
        panel.get_by_role('button', name='Next', exact=True).click()
        viewer = panel.locator('.gallery-viewer')
        reveal = viewer.get_by_role('button', name='Show image · ネタバレ', exact=True)
        reveal.focus()
        reveal.press('Enter')
        expect(reveal).to_have_count(0)
        expect(viewer).to_be_focused()
        self.page.keyboard.press('ArrowLeft')
        expect(viewer.get_by_role('button', name='Show image · ネタバレ', exact=True)).to_be_visible()
        self.page.keyboard.press('ArrowRight')
        expect(viewer.locator('img')).to_have_attribute('alt', 'Book illustration 2')
        expect(viewer.locator('.spoiler-label')).to_have_count(0)
        self.capture('keyboard-revealed')
        self.close_gallery(panel)

    def test_delayed_real_font_cannot_rehide_an_explicit_gallery_reveal(self):
        self.open_book()
        gate = FontResponseGate()
        self.server.font_gate = gate
        try:
            self.page.get_by_role('button', name='Show reading controls', exact=True).click()
            self.page.get_by_role('button', name='Themes & Settings', exact=True).click()
            appearance = self.page.get_by_role('dialog', name='Themes & Settings', exact=True)
            appearance.get_by_label('Reading font', exact=True).select_option('Noto Serif JP')
            # WebKit did not intercept this font through page.route. Hold it at
            # the actual HTTP server and require evidence that the request began.
            self.assertTrue(gate.started.wait(5), 'The real font request must reach the server')
            self.page.wait_for_function('''() => [...document.fonts].some(
              f => f.family.includes('Noto Serif JP') && f.status === 'loading')''')
            self.assertFalse(gate.release.is_set())
            self.page.keyboard.press('Escape')
            expect(appearance).to_have_count(0)
            self.page.get_by_role('button', name='Hide reading controls', exact=True).click()
            panel = self.open_gallery()
            self.reveal_second(panel)
            self.close_gallery(panel)
            self.page.evaluate('''() => {
              window.galleryRebinds = 0;
              window.galleryObserver = new MutationObserver(records => {
                window.galleryRebinds += records.filter(r =>
                  r.target.parentElement?.closest('[data-ttu-spoiler-img]') ||
                  r.target.closest?.('[data-ttu-spoiler-img]')).length;
              });
              window.galleryObserver.observe(document.querySelector('.book-content'),
                {subtree: true, childList: true, characterData: true});
            }''')
            gate.release.set()
            self.page.wait_for_function('''() => [...document.fonts].some(
              f => f.family.includes('Noto Serif JP') && f.status === 'loaded')''')
            self.page.wait_for_function('window.galleryRebinds > 0')
            self.assertFalse(gate.expired, 'The server must release by user action, not expiry')
            # A negative assertion must outlive the route's 250ms observation queue.
            # This is one settlement window, not a retry-until-green loop.
            self.page.wait_for_timeout(350)
            panel = self.open_gallery()
            expect(panel.get_by_role('button', name='View image 2', exact=True)).to_be_visible()
            expect(panel.get_by_role('button', name='Show hidden image 1', exact=True)).to_be_visible()
            self.capture('after-real-font-rebind')
            self.close_gallery(panel)
        finally:
            gate.release.set()
            self.server.font_gate = None
            (self.output / 'font-response-gate.json').write_text(json.dumps({
                'paths': gate.paths, 'started': gate.started.is_set(), 'expired': gate.expired
            }, indent=2))
            self.page.evaluate('window.galleryObserver?.disconnect()')

    def test_reveal_does_not_leak_into_another_imported_book(self):
        self.open_book('Gallery first book')
        panel = self.open_gallery()
        self.reveal_second(panel)
        self.close_gallery(panel)
        self.go_library()
        self.open_book('Gallery second book')
        panel = self.open_gallery()
        expect(panel.get_by_role('button', name='Show hidden image 1', exact=True)).to_be_visible()
        expect(panel.get_by_role('button', name='Show hidden image 2', exact=True)).to_be_visible()
        expect(panel.get_by_role('button', name='View image 2', exact=True)).to_have_count(0)
        self.capture('new-book-still-hidden')
        self.close_gallery(panel)

    def test_reveal_resets_on_reload_without_changing_book_identity(self):
        self.open_book()
        url = self.page.url
        panel = self.open_gallery()
        self.reveal_second(panel)
        self.close_gallery(panel)
        self.page.reload()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.assertEqual(self.page.url, url)
        panel = self.open_gallery()
        expect(panel.get_by_role('button', name='Show hidden image 2', exact=True)).to_be_visible()
        self.close_gallery(panel)


if __name__ == '__main__':
    unittest.main(verbosity=2)
