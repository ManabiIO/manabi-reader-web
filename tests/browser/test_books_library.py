"""Real static Library UI, EPUB parsing, IndexedDB and browser filesystem acceptance.

No mocked storage, replaced picker, imported substitute UI or request interception.
Filesystem cases run on Chromium; the browser-only cases also run on WebKit.
"""
import base64
import hashlib
import io
import json
import os
import re
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
import zipfile
import zlib
from xml.sax.saxutils import escape
from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler, ThreadingHTTPServer


def raster(width=240, height=360, color=(155, 75, 45)):
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)
    pixels = bytearray()
    accent = tuple(min(255, channel + 55) for channel in color)
    dark = tuple(max(0, channel - 45) for channel in color)
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            value = color
            if width // 7 < x < width * 6 // 7 and height // 5 < y < height * 3 // 5:
                value = accent if (x + y) // max(8, width // 10) % 2 else dark
            elif (x * 2 + y) % max(12, width // 5) < max(5, width // 18):
                value = dark
            pixels.extend(value)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(bytes(pixels))) + chunk(b'IEND', b''))


def book(title, spine='', style='body{writing-mode:horizontal-tb}', body=None, size=(240, 360), creators=(), color=(155, 75, 45)):
    output = io.BytesIO()
    if body is None:
        body = '<h1>' + escape(title) + '</h1>' + '<p>日本語の本を読みます。文章を丁寧に読み進めます。</p>' * 180
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>')
        creator_xml = ''.join('<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">' + escape(value) + '</dc:creator>' for value in creators)
        archive.writestr('OEBPS/book.opf', '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">' + escape(title) + '</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">ja</dc:language>' + creator_xml + '</metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="style" href="Styles/book.css" media-type="text/css"/><item id="cover" href="Images/cover.png" media-type="image/png" properties="cover-image"/></manifest><spine' + (' page-progression-direction="' + spine + '"' if spine else '') + '><itemref idref="chapter"/></spine></package>')
        archive.writestr('OEBPS/Text/chapter.xhtml', '<html><head><link rel="stylesheet" href="../Styles/book.css"/></head><body>' + body + '</body></html>')
        archive.writestr('OEBPS/Styles/book.css', style)
        archive.writestr('OEBPS/Images/cover.png', raster(*size, color=color))
    return output.getvalue()


def cross_resource_book():
    """Two real spine resources with a nonzero origin and an offscreen search hit."""
    output = io.BytesIO()
    chapter_one = (
        '<h1>Origin Chapter</h1>'
        + ''.join('<p>Opening passage %04d. ここでは猫と本を読みます。</p>' % i for i in range(60))
        + '<p>ORIGIN_LEAD_IN. The exact passage is ORIGIN_ANCHOR_𠮷猫_終点. Continue reading here.</p>'
        + ''.join('<p>Later passage %04d. さらに読書を続けています。</p>' % i for i in range(55))
    )
    chapter_two = (
        '<h1>Destination Chapter</h1>'
        + ''.join('<p>Destination passage %04d. 遠くまで進みます。</p>' % i for i in range(35))
        + '<p>DESTINATION_UNIQUE_𠮷猫_終端. Search across resources.</p>'
    )
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        archive.writestr('META-INF/container.xml',
                         '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        archive.writestr('OEBPS/content.opf',
                         '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
                         '<metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Cross Resource Return</dc:title>'
                         '<dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">ja</dc:language></metadata>'
                         '<manifest><item id="first" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>'
                         '<item id="second" href="chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest>'
                         '<spine><itemref idref="first"/><itemref idref="second"/></spine></package>')
        archive.writestr('OEBPS/chapter-1.xhtml', '<html><body>' + chapter_one + '</body></html>')
        archive.writestr('OEBPS/chapter-2.xhtml', '<html><body>' + chapter_two + '</body></html>')
    return output.getvalue()


def macos_browser_package_handoff(title):
    source = zipfile.ZipFile(io.BytesIO(book(title)))
    output = io.BytesIO()
    try:
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for info in source.infolist():
                if info.is_dir():
                    continue
                archive.writestr(title + '.epub/' + info.filename, source.read(info))
    finally:
        source.close()
    return output.getvalue()


class LibraryBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.profile = tempfile.TemporaryDirectory()
        self.engine = os.environ.get('LIBRARY_BROWSER', 'chromium')
        self.context = getattr(self.playwright, self.engine).launch_persistent_context(
            self.profile.name, viewport={'width': 1200, 'height': 900})
        self.context.add_init_script(
            "try { localStorage.setItem('manabi-reader-dictionary-setup-v1', 'skip') } catch {}")
        self.page = self.context.pages[0]
        self.page.set_default_timeout(20000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        StaticHandler.probes.clear()
        self.go_library()

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            self.page.screenshot(path=str(output / (self.engine + '-' + self._testMethodName + '.png')), full_page=True)
            (output / (self.engine + '-' + self._testMethodName + '.html')).write_text(self.page.content())
        finally:
            self.context.close()
            self.profile.cleanup()
        self.assertEqual([], self.errors)
        self.assertEqual([], StaticHandler.probes)

    def go_library(self):
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        shelf = self.page.get_by_role('region', name='Library shelves')
        expect(shelf).to_have_attribute('data-hydrated', 'true', timeout=30000)
        expect(shelf).to_have_attribute('aria-busy', 'false', timeout=30000)

    def import_book(self, title='Library test', **options):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name': title + '.epub', 'mimeType': 'application/epub+zip', 'buffer': book(title, **options)})
        expect(self.page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible(timeout=30000)

    def tile(self, title):
        return self.page.locator('.shelf-item').filter(has=self.page.get_by_role('button', name='Read ' + title, exact=True))

    def menu(self, title, action):
        self.page.get_by_role('button', name='Actions for ' + title, exact=True).click()
        self.page.get_by_role('menuitem', name=action, exact=True).click()

    def dialog(self):
        return self.page.locator('[data-slot="dialog-content"]')

    def stores(self, database, names):
        return self.page.evaluate('''async ({database,names}) => {
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(database);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          try {const tx=db.transaction(names),result={};
            await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result;resolve();};r.onerror=()=>reject(r.error);})));return result;
          } finally {db.close();}
        }''', {'database': database, 'names': names})

    def wait_bookmark(self, data_id, predicate):
        # Playwright 1.63 wait_for_function treats a predicate Promise as truthy
        # before its eventual boolean result. Read committed rows and poll the
        # actual value with a bounded deadline, never a fixed settling sleep.
        deadline = time.monotonic() + 20
        while True:
            rows = self.stores('books', ['bookmark'])['bookmark']
            row = next((value for value in rows if value['dataId'] == data_id), None)
            if row is not None and predicate(row):
                return row
            self.assertLess(time.monotonic(), deadline, 'Bookmark condition not met: ' + repr(row))
            self.page.wait_for_timeout(25)

    def add_collection(self, title, name):
        self.menu(title, 'Add to Collection…')
        dialog = self.dialog()
        name_input = dialog.get_by_label('New collection name', exact=True)
        expect(dialog).to_be_visible()
        expect(self.page.get_by_role('menu')).to_have_count(0)
        # The menu hands focus to the dialog in a portal. Wait for that handoff
        # to finish before typing into its input; the first mounted node can
        # be replaced during the transition.
        self.page.evaluate('''() => new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)))''')
        expect(name_input).to_be_visible()
        self.page.evaluate('''() => {
          const form = document.querySelector('[data-slot="dialog-content"] form');
          const input = form?.querySelector('input[placeholder="New collection name"]');
          window.__collectionEvents = [];
          for (const [target, kind] of [[input,'input'],[input,'invalid'],[form,'submit']]) {
            target?.addEventListener(kind, () => window.__collectionEvents.push({
              kind, value: input?.value, time: performance.now()
            }), {capture:true});
          }
        }''')
        # Type through the actual input events after the portal settles.
        name_input.press_sequentially(name)
        try:
            expect(name_input).to_have_value(name)
        except AssertionError as failure:
            events = self.page.evaluate('window.__collectionEvents || []')
            raise AssertionError(f'Collection input changed while typing: {events!r}') from failure
        dialog.get_by_role('button', name='Create', exact=True).click()
        # The create action clears the field only after the IndexedDB
        # transaction publishes the updated organization. Waiting on that
        # state transition avoids racing the collection checkbox render.
        expect(name_input).to_have_value('')
        try:
            expect(dialog.get_by_role('checkbox', name=name, exact=True)).to_be_checked()
        except AssertionError as failure:
            rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
            saved = next((row for row in rows if row.get('version') == 1 and 'collections' in row), {})
            names = [collection.get('name') for collection in saved.get('collections', [])]
            alerts = dialog.get_by_role('alert').all_text_contents()
            events = self.page.evaluate('window.__collectionEvents || []')
            raise AssertionError(
                f'Collection {name!r} was not shown after creation; persisted={names!r}; alerts={alerts!r}; events={events!r}'
            ) from failure
        dialog.get_by_role('button', name='Done', exact=True).click()
        # Do not fill the previous dialog's still-mounted exit transition when
        # the next collection is opened immediately after this one.
        expect(self.dialog()).to_have_count(0)

    def choose_view(self, name):
        self.open_view_menu()
        choice = self.page.get_by_role('menuitemradio', name=name, exact=True)
        if choice.count() == 0:
            self.page.get_by_role('menuitem', name='Sort by…', exact=True).hover()
        self.page.get_by_role('menuitemradio', name=name, exact=True).click()
        # Wait for the closing portal to unmount before resizing the viewport.
        # Its exit animation still occupies the previous menu position.
        expect(self.page.get_by_role('menu')).to_have_count(0)

    def open_view_menu(self):
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='View Options', exact=True).hover()

    def open_organize_menu(self):
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Organize Library', exact=True).hover()

    def choose_collection(self, name):
        compact_button = self.page.get_by_role('button', name='Collections', exact=True)
        if compact_button.is_visible():
            compact_button.click()
            navigation = self.page.locator('#library-collections-sheet')
        else:
            navigation = self.page.get_by_role('complementary', name='Collections', exact=True)
        navigation.get_by_role(
            'button', name=re.compile('^' + re.escape(name) + r'\b')).click()


class BooksLibraryBrowser(LibraryBase):
    def test_yatsu_backup_collection_is_visible_on_phone_and_desktop(self):
        fixture = Path(__file__).resolve().parents[1] / 'fixtures' / 'yatsu' / 'complete-local-backup-v11.zip'
        self.page.goto(self.origin + '/reader-web/import-ttu?source=yatsu')
        picker = self.page.get_by_label('Choose Yatsu backup ZIPs', exact=True)
        picker.set_input_files(str(fixture))
        self.page.get_by_role('button', name='Import selected (1)', exact=True).click()
        expect(self.page.get_by_role('article', name='Import Manabi Yatsu Portability Fixture')
               .get_by_role('status')).to_have_text('Imported Manabi Yatsu Portability Fixture.', timeout=60000)
        for width in (390, 1200):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.go_library()
                if width < 1024:
                    self.page.get_by_role('button', name='Collections', exact=True).click()
                    self.page.locator('#library-collections-sheet').get_by_role(
                        'button', name=re.compile(r'^Portable Shelf\s+1$')).click()
                else:
                    self.page.get_by_role('complementary', name='Collections').get_by_role(
                        'button', name=re.compile(r'^Portable Shelf\s+1$')).click()
                expect(self.page.get_by_role('button', name='Read Manabi Yatsu Portability Fixture')).to_be_visible()
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)

    def _cross_resource_return(self, viewport, writing_mode=None):
        self.page.set_viewport_size(viewport)
        if writing_mode:
            self.page.evaluate('(mode) => localStorage.setItem("writingMode", mode)', writing_mode)
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'cross-resource-return.epub',
            'mimeType': 'application/epub+zip',
            'buffer': cross_resource_book()
        })
        self.page.get_by_role('button', name='Read Cross Resource Return', exact=True).click(timeout=30000)
        content = self.page.locator('.book-content').first
        expect(content).to_be_visible(timeout=30000)
        expect(content).to_have_attribute('aria-busy', 'false', timeout=30000)
        origin = content.get_by_text('ORIGIN_ANCHOR_𠮷猫_終点', exact=False)
        expect(origin).to_be_attached(timeout=30000)

        def passage_geometry(phrase):
            return content.evaluate('''(host, phrase) => {
              for (const section of host.children) {
                const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                  const offset = node.data.indexOf(phrase);
                  if (offset < 0) continue;
                  const range = document.createRange();
                  range.setStart(node, offset);
                  range.setEnd(node, offset + phrase.length);
                  const ink = range.getBoundingClientRect();
                  const port = host.getBoundingClientRect();
                  return {
                    spine: Number(section.dataset.manabiSpineIndex),
                    visible: ink.right > port.left && ink.left < port.right &&
                      ink.bottom > port.top && ink.top < port.bottom,
                    scroll: Math.max(Math.abs(host.scrollTop), Math.abs(host.scrollLeft)),
                    ink: { x: ink.x, y: ink.y, width: ink.width, height: ink.height },
                    port: { x: port.x, y: port.y, width: port.width, height: port.height },
                    scrollHeight: host.scrollHeight
                  };
                }
              }
              return null;
            }''', phrase)

        content.click(position={'x': 25, 'y': 100}, force=True)
        for _ in range(20):
            before = passage_geometry('ORIGIN_ANCHOR_𠮷猫_終点')
            if before and before['visible'] and before['scroll'] > 0:
                break
            self.page.keyboard.press('PageDown')
        else:
            self.fail('A nonzero origin passage never entered the reading viewport')
        visible_samples = content.evaluate('''host => {
          const port = host.getBoundingClientRect();
          const walker = document.createTreeWalker(host.firstElementChild, NodeFilter.SHOW_TEXT);
          const found = [];
          let node;
          while ((node = walker.nextNode()) && found.length < 8) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const boxes = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0 &&
              box.right > port.left && box.left < port.right && box.bottom > port.top && box.top < port.bottom);
            if (boxes.length) found.push({ text: node.data.slice(0, 80), x: boxes[0].x, y: boxes[0].y });
          }
          return found;
        }''')
        self.assertTrue(before and before['visible'])
        self.assertEqual(0, before['spine'])
        self.assertGreater(before['scroll'], 0, 'Origin must be beyond the first page')
        self.assertTrue(visible_samples, 'A visible source run is needed for exact Return')
        origin_run = visible_samples[0]['text']

        controls = self.page.locator('button[data-reader-controls]')

        def tool(name):
            if controls.get_attribute('aria-expanded') != 'true':
                controls.click()
            self.page.get_by_role('button', name='Reading tools').click()
            self.page.get_by_role('menuitem', name=name, exact=True).click()

        book_id = self.stores('books', ['data'])['data'][0]['id']
        previous = self.stores('books', ['bookmark'])['bookmark']
        previous_modified = previous[0]['lastBookmarkModified'] if previous else 0
        tool('Save Reading Position')
        self.wait_bookmark(book_id, lambda row: row['exploredCharCount'] > 0 and
                           row['lastBookmarkModified'] > previous_modified)
        baseline = self.stores('books', ['bookmark', 'readerStatistic'])
        self.assertTrue(baseline['readerStatistic'], 'The preview must preserve real reading statistics')

        tool('Search Book')
        self.page.get_by_role('searchbox', name='Search within book').fill('DESTINATION_UNIQUE_𠮷猫_終端')
        result = self.page.get_by_role('button').filter(has_text='DESTINATION_UNIQUE_𠮷猫_終端').first
        expect(result).to_be_visible(timeout=30000)
        result.click()
        return_button = self.page.get_by_role('button', name='Return to where I was')
        expect(return_button).to_be_visible(timeout=30000)
        expect(content.locator('[data-manabi-spine-index="1"]')).to_be_attached(timeout=30000)
        self.assertEqual(baseline, self.stores('books', ['bookmark', 'readerStatistic']))

        controls.click()
        self.page.get_by_role('button', name='Themes & Settings').click()
        self.page.get_by_role('button', name='Increase text size').click()
        self.page.get_by_role('button', name='Close reading appearance').click()
        expect(content.locator('[data-manabi-spine-index="1"]')).to_be_attached()
        self.assertEqual(baseline, self.stores('books', ['bookmark', 'readerStatistic']))

        return_button.click()
        expect(return_button).to_have_count(0)
        expect(content.locator('[data-manabi-spine-index="0"]')).to_be_attached(timeout=30000)
        after = passage_geometry(origin_run)
        self.assertTrue(after and after['visible'],
                        'Return must reveal the captured source run: before=%r after=%r run=%r' %
                        (before, after, origin_run))
        self.assertEqual(0, after['spine'])
        self.assertGreater(after['scroll'], 0, 'Return must not jump to offset zero')
        self.assertEqual(baseline, self.stores('books', ['bookmark', 'readerStatistic']))

    def test_cross_resource_return_after_reflow_phone(self):
        self._cross_resource_return({'width': 390, 'height': 844})

    def test_cross_resource_return_after_reflow_desktop(self):
        self._cross_resource_return({'width': 1200, 'height': 900})

    def test_cross_resource_return_after_reflow_vertical_webkit(self):
        self._cross_resource_return({'width': 960, 'height': 700}, 'vertical-rl')

    def test_search_uses_source_text_not_ruby_readings_or_hidden_blocks(self):
        body = ('<div>alpha</div><div>beta</div>'
                '<p><ruby>漢<rt>かん</rt></ruby>字と𠮷。</p>'
                '<p>か\u3099くしき。</p>'
                '<p hidden="hidden">HIDDEN_SENTINEL</p>'
                '<p style="display:none!important">STYLE_HIDDEN_SENTINEL</p>'
                + '<p>本文を読みます。</p>' * 60)
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'projection.epub', 'mimeType': 'application/epub+zip',
            'buffer': book('Projection checks', body=body)
        })
        self.page.get_by_role('button', name='Read Projection checks', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Reading tools').click()
        self.page.get_by_role('menuitem', name='Search Book', exact=True).click()
        search = self.page.get_by_role('searchbox', name='Search within book')
        for query, count in [('alpha', 1), ('alphabeta', 0), ('漢', 1),
                             ('かん', 0), ('が', 1), ('𠮷', 1),
                             ('HIDDEN_SENTINEL', 0), ('STYLE_HIDDEN_SENTINEL', 0)]:
            search.fill(query)
            expect(self.page.get_by_text(f'{count} results', exact=True)).to_be_visible(timeout=15000)

    def test_touch_menus_and_dark_reflow_keep_actions_accessible(self):
        profile = tempfile.TemporaryDirectory()
        # WebKit's ephemeral profiles do not support the real Blob-backed book
        # store. Match LibraryBase's regular-profile storage in touch mode too.
        touch = getattr(self.playwright, self.engine).launch_persistent_context(
            profile.name,
            viewport={'width': 390, 'height': 844}, device_scale_factor=3,
            is_mobile=True, has_touch=True, color_scheme='dark', reduced_motion='reduce')
        original = self.page
        self.page = touch.pages[0]
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        try:
            self.go_library()
            self.import_book('Touch layout')
            self.assertEqual('dark', self.page.locator('html').evaluate(
                'element => getComputedStyle(element).colorScheme'))
            trigger = self.page.get_by_role('button', name='Library actions', exact=True)
            trigger.tap()
            self.page.get_by_role('menuitem', name='View Options', exact=True).tap()
            submenu = self.page.locator('[data-slot="dropdown-menu-sub-content"]')
            expect(submenu).to_be_visible()
            box = submenu.bounding_box()
            self.assertGreaterEqual(box['x'], 0)
            self.assertLessEqual(box['x'] + box['width'], 390)
            self.page.get_by_role('menuitem', name='Sort by…', exact=True).tap()
            for surface in self.page.locator('[data-slot="dropdown-menu-sub-content"]').all():
                bounds = surface.bounding_box()
                self.assertGreaterEqual(bounds['x'], 0)
                self.assertLessEqual(bounds['x'] + bounds['width'], 390)
                self.assertLessEqual(bounds['y'] + bounds['height'], 844)
            self.page.get_by_role('menuitemradio', name='Title', exact=True).tap()
            expect(self.page.get_by_role('menu')).to_have_count(0)
            trigger.tap()
            self.page.get_by_role('menuitem', name='View Options', exact=True).tap()
            self.page.get_by_role('menuitemradio', name='List', exact=True).tap()
            expect(self.page.locator('.shelf-list')).to_be_visible()
            self.page.get_by_role('button', name='Actions for Touch layout', exact=True).tap()
            menu = self.page.get_by_role('menu')
            expect(menu).to_be_visible()
            sizes = menu.get_by_role('menuitem').evaluate_all(
                'items => items.map(item => item.getBoundingClientRect().height)')
            self.assertTrue(all(height >= 44 for height in sizes), sizes)
            self.page.get_by_role('menuitem', name='Mark as Finished', exact=True).tap()
            expect(self.tile('Touch layout').locator('.list-detail')).to_contain_text('Finished')
            # A 1280px desktop zoomed to 200% has a 640 CSS-pixel layout viewport.
            for width in (844, 640, 320):
                self.page.set_viewport_size({'width': width, 'height': 600})
                trigger.tap()
                menu = self.page.get_by_role('menu')
                expect(menu).to_be_visible()
                box = menu.bounding_box()
                self.assertGreaterEqual(box['x'], -1)
                self.assertLessEqual(box['x'] + box['width'], width + 1)
                self.assertLessEqual(box['y'] + box['height'], 601)
                self.page.keyboard.press('Escape')
                expect(trigger).to_be_focused()
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
        finally:
            touch.close()
            profile.cleanup()
            self.page = original

    def test_responsive_shelf_grows_then_adds_columns_without_clipping_covers(self):
        # Exercise intrinsic artwork geometry, not only square placeholder boxes.
        for index, size in enumerate([(240, 360), (180, 380), (360, 240), (240, 240)] * 3):
            self.import_book('Responsive ' + str(index), size=size)
        self.page.locator('.shelf-grid img').evaluate_all('''images => Promise.all(images.map(image => {
            image.loading = 'eager';
            return image.decode();
        }))''')
        measurements = {}
        for width in (320, 390, 430, 768, 1023, 1024, 1200, 1300, 1400, 1440, 1728):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 900})
                geometry = self.page.locator('.shelf-grid').evaluate('''grid => {
                    const stages = [...grid.querySelectorAll('.book-thumbnail')];
                    return {
                        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
                        width: stages[0].getBoundingClientRect().width,
                        covers: stages.map(stage => {
                            const cover = stage.querySelector('.cover-surface').getBoundingClientRect();
                            const box = stage.getBoundingClientRect();
                            return {width: cover.width, height: cover.height,
                                maxWidth: box.width, maxHeight: box.height, bottom: cover.bottom - box.bottom};
                        }),
                        statuses: [...grid.querySelectorAll('.book-status')].map(e => e.getBoundingClientRect().top)
                    };
                }''')
                measurements[width] = geometry
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
                if width <= 430:
                    self.assertEqual(2, geometry['columns'])
                if width == 768:
                    self.assertEqual(4, geometry['columns'])
                if width == 1440:
                    self.assertEqual(6, geometry['columns'])
                for cover in geometry['covers']:
                    self.assertLessEqual(cover['width'], cover['maxWidth'] + 1)
                    self.assertLessEqual(cover['height'], cover['maxHeight'] + 1)
                    self.assertAlmostEqual(0, cover['bottom'], delta=1)
                first_row = geometry['statuses'][:geometry['columns']]
                self.assertLessEqual(max(first_row) - min(first_row), 1)
        self.assertEqual(measurements[1200]['columns'], measurements[1300]['columns'])
        self.assertGreater(measurements[1300]['width'], measurements[1200]['width'])
        self.assertGreater(measurements[1400]['columns'], measurements[1300]['columns'])
        self.assertLess(measurements[1400]['width'], measurements[1300]['width'])
        self.assertGreater(measurements[1728]['columns'], measurements[1400]['columns'])
        # Selection adds a row to the floating header. The sidebar stays in
        # its own full-height panel through both header sizes.
        self.page.set_viewport_size({'width': 1440, 'height': 700})
        header = self.page.get_by_role('banner', name='Library toolbar')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.evaluate('window.scrollTo(0, 600)')
        rail = self.page.get_by_role('complementary', name='Collections', exact=True)
        self.page.wait_for_function('''() => {
            const rail = document.querySelector('.library-rail').getBoundingClientRect();
            const shell = document.querySelector('.library-nav-shell');
            return Math.abs(rail.top - 16) < 2 && rail.bottom <= innerHeight - 14 &&
              shell.classList.contains('scrolled') &&
              getComputedStyle(shell, '::before').backdropFilter !== 'none';
        }''')
        expect(rail.get_by_role('button', name=re.compile('^Books'))).to_be_in_viewport()
        header.get_by_role('button', name='Cancel selection', exact=True).click()
        self.page.wait_for_function('''() => {
            return Math.abs(document.querySelector('.library-rail').getBoundingClientRect().top - 16) < 2;
        }''')

    def test_library_responsive_search_geometry_and_touch_targets(self):
        self.import_book('Responsive search book', size=(180, 380))
        self.import_book('Standard cover', size=(240, 360))
        self.page.locator('.shelf-grid img').evaluate_all(
            'images => Promise.all(images.map(image => image.decode()))')
        for width in (320, 390, 768, 1024, 1440, 1920):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
                brand = self.page.get_by_role('banner', name='Library toolbar').get_by_role(
                    'heading', name='Manabi Reader for Web', exact=True).bounding_box()
                shelf = self.page.locator('.shelf-heading').first.bounding_box()
                self.assertAlmostEqual(brand['x'], shelf['x'], delta=1)
                if width < 1024:
                    trigger = self.page.get_by_role('button', name='Search library', exact=True)
                    expect(trigger).to_be_visible()
                    actions = self.page.get_by_role('button', name='Library actions', exact=True).bounding_box()
                    collections = self.page.get_by_role('button', name='Collections', exact=True).bounding_box()
                    box = trigger.bounding_box()
                    self.assertGreaterEqual(box['width'], 44)
                    self.assertGreaterEqual(box['height'], 44)
                    self.assertLess(box['x'] + box['width'], collections['x'] + 1)
                    self.assertLess(collections['x'] + collections['width'], actions['x'] + 1)
                    trigger.click()
                    search = self.page.get_by_role('searchbox', name='Search library', exact=True)
                    expect(search).to_be_focused()
                    search.fill('Responsive')
                    expect(self.page.get_by_role('button', name='Read Responsive search book', exact=True)).to_be_visible()
                    expect(self.page.get_by_role('button', name='Read Standard cover', exact=True)).to_have_count(0)
                    search.press('Escape')
                    expect(trigger).to_be_focused()
                    expect(self.page.get_by_role('searchbox', name='Search library', exact=True)).to_have_count(0)
                    expect(self.page.get_by_role('button', name='Read Standard cover', exact=True)).to_be_visible()
                    trigger.click()
                    self.page.get_by_role('searchbox', name='Search library', exact=True).fill('No matching title')
                    expect(self.page.get_by_role('heading', name='No matching books', exact=True)).to_be_visible()
                    self.page.get_by_role('button', name='Cancel', exact=True).click()
                    expect(trigger).to_be_focused()
                else:
                    search = self.page.get_by_role('searchbox', name='Search library', exact=True)
                    expect(search).to_be_visible()
                    expect(self.page.get_by_role('button', name='Search library', exact=True)).not_to_be_visible()
                    self.assertEqual(1, self.page.get_by_role('banner', name='Library toolbar')
                                     .get_by_role('searchbox', name='Search library').count())
                    self.assertGreater(search.bounding_box()['x'], self.page.get_by_role(
                        'button', name='Library actions', exact=True).bounding_box()['x'])
                    self.assertEqual(0, self.page.get_by_role('region', name='Library shelves')
                                     .get_by_role('searchbox').count())
                    rail_text = self.page.get_by_role('complementary', name='Collections')
                    rail_font = rail_text.get_by_text('Want to Read', exact=True).evaluate('''element => {
                        const style = getComputedStyle(element);
                        return {family: style.fontFamily, stretch: style.fontStretch,
                            spacing: style.letterSpacing};
                    }''')
                    self.assertIn('system-ui', rail_font['family'])
                    self.assertIn(rail_font['stretch'], ('normal', '100%'))
                    self.assertEqual('normal', rail_font['spacing'])
                # Measure painted glyph bounds, including intrinsic narrow artwork.
                for title in ('Responsive search book', 'Standard cover'):
                    tile = self.tile(title)
                    expect(tile.locator('.progress-label')).to_have_text('NEW')
                    self.page.wait_for_function('''title => {
                        const tile = [...document.querySelectorAll('.shelf-item')].find(item =>
                            item.querySelector('.book-open')?.getAttribute('aria-label') === 'Read ' + title);
                        const image = tile?.querySelector('img');
                        return image?.complete && image.naturalWidth > 0;
                    }''', arg=title)
                    geometry = tile.evaluate('''tile => {
                        const cover = tile.querySelector('.cover-surface').getBoundingClientRect();
                        const button = tile.querySelector('.book-status button');
                        const svg = button.querySelector('svg');
                        // Phosphor includes an unpainted full-viewBox rect; measure
                        // its painted path rather than that invisible spacer.
                        const ink = svg.querySelector('path').getBBox(), matrix = svg.getScreenCTM();
                        const edge = new DOMPoint(ink.x + ink.width, ink.y + ink.height / 2).matrixTransform(matrix);
                        const target = button.getBoundingClientRect();
                        const label = tile.querySelector('.progress-label').getBoundingClientRect();
                        return {edge: edge.x - cover.right, center: edge.y - cover.bottom,
                            labelCenter: label.top + label.height / 2 - cover.bottom,
                            targetWidth: target.width, targetHeight: target.height};
                    }''')
                    self.assertAlmostEqual(0, geometry['edge'], delta=2)
                    self.assertGreaterEqual(geometry['center'], 12)
                    self.assertLessEqual(geometry['center'], 20)
                    self.assertAlmostEqual(geometry['center'], geometry['labelCenter'], delta=2)
                    self.assertGreaterEqual(geometry['targetWidth'], 44)
                    self.assertGreaterEqual(geometry['targetHeight'], 44)
                header = self.page.get_by_role('banner', name='Library toolbar')
                icons = header.locator('button:visible svg').evaluate_all(
                    'icons => icons.map(icon => icon.getBoundingClientRect().width)')
                self.assertTrue(icons)
                self.assertTrue(all(size >= 24 for size in icons), icons)
                if width == 390:
                    proportion = self.page.locator('.shelf-grid').evaluate('''grid =>
                        parseFloat(getComputedStyle(grid).columnGap) /
                        grid.querySelector('.book-thumbnail').getBoundingClientRect().width''')
                    self.assertGreaterEqual(proportion, 0.13)
                    self.assertLessEqual(proportion, 0.19)

        # A resize keeps the same query and only one active search field.
        search = self.page.get_by_role('searchbox', name='Search library', exact=True)
        search.fill('Responsive')
        self.page.set_viewport_size({'width': 390, 'height': 844})
        expect(search).to_have_count(1)
        expect(search).to_have_value('Responsive')
        self.page.get_by_role('button', name='Cancel', exact=True).click()
        expect(self.page.get_by_role('button', name='Read Standard cover', exact=True)).to_be_visible()

        self.page.set_viewport_size({'width': 320, 'height': 360})
        self.menu('Responsive search book', 'Add to Collection…')
        dialog = self.dialog()
        expect(dialog).to_be_visible()
        bounds = dialog.bounding_box()
        self.assertGreaterEqual(bounds['y'], 0)
        self.assertLessEqual(bounds['y'] + bounds['height'], 360)
        self.assertLessEqual(dialog.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        close = dialog.get_by_role('button', name='Close', exact=True)
        self.assertGreaterEqual(close.bounding_box()['width'], 44)
        self.assertGreaterEqual(close.bounding_box()['height'], 44)
        done = dialog.get_by_role('button', name='Done', exact=True)
        done.scroll_into_view_if_needed()
        expect(done).to_be_in_viewport()
        self.assertGreaterEqual(done.bounding_box()['height'], 44)
        done.click()
        expect(dialog).to_have_count(0)

    def test_collection_buttons_use_neutral_system_gray_in_both_appearances(self):
        self.import_book('Neutral collection controls')
        for mode, background, foreground in (
            ('light', 'rgb(229, 229, 234)', 'rgb(33, 31, 28)'),
            ('dark', 'rgb(44, 44, 46)', 'rgb(238, 238, 238)'),
        ):
            with self.subTest(mode=mode):
                self.page.evaluate('mode => localStorage.setItem("appearance", mode)', mode)
                self.go_library()
                expect(self.page.locator('html')).to_have_attribute('data-appearance', mode)
                self.menu('Neutral collection controls', 'Add to Collection…')
                dialog = self.dialog()
                create = dialog.get_by_role('button', name='Create', exact=True)
                done = dialog.get_by_role('button', name='Done', exact=True)
                for button in (create, done):
                    self.assertEqual(background, button.evaluate('e => getComputedStyle(e).backgroundColor'))
                    self.assertEqual(foreground, button.evaluate('e => getComputedStyle(e).color'))
                Path('test-results').mkdir(exist_ok=True)
                self.page.screenshot(path=f'test-results/{self.engine}-neutral-collection-{mode}.png')
                done.click()

    def test_narrow_collection_editing_and_selection_stay_inside_viewport(self):
        self.import_book('Small screen book')
        self.add_collection('Small screen book', 'A long collection name 日本語の読書コレクション')
        for width in (320, 390, 1023, 1024, 1440, 390):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 844})
                header = self.page.get_by_role('banner', name='Library toolbar')
                expect(header.get_by_role('button', name='Main menu', exact=True)).to_have_count(0)
                rail = self.page.get_by_role('complementary', name='Collections', exact=True)
                if width < 1024:
                    expect(rail).not_to_be_visible()
                    trigger = header.get_by_role('button', name='Collections', exact=True)
                    trigger.click()
                else:
                    expect(rail).to_be_visible()
                    trigger = rail.get_by_role('button', name='New Collection…', exact=True)
                    trigger.click()
                sheet = self.page.locator('#library-collections-sheet')
                sheet.get_by_role('button', name='Edit', exact=True).click()
                bounds = sheet.bounding_box()
                self.assertGreaterEqual(bounds['x'], -1)
                self.assertLessEqual(bounds['x'] + bounds['width'], width + 1)
                self.assertLessEqual(sheet.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
                # Title and Edit/Close must not overlap at narrow sizes.
                title = sheet.get_by_role('heading', name='Collections', exact=True).bounding_box()
                done = sheet.get_by_role('button', name='Done', exact=True).bounding_box()
                self.assertLessEqual(title['x'] + title['width'], done['x'])
                rename = sheet.get_by_role('button', name=re.compile('^Rename collection'))
                expect(rename).to_be_visible()
                rename.click()
                dialog = self.dialog()
                expect(dialog.get_by_role('heading', name='Rename collection', exact=True)).to_be_visible()
                expect(self.page.locator('[role="dialog"][aria-modal="true"]')).to_have_count(1)
                expect(sheet).to_have_count(0)
                dialog.get_by_role('button', name='Cancel', exact=True).click()
                expect(sheet).to_be_visible()
                expect(sheet.locator(':focus')).to_have_count(1)
                sheet.get_by_role('button', name='Close collections', exact=True).click()
                expect(sheet).to_have_count(0)
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
        header.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        header.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        expect(header.get_by_role('button', name='Export', exact=True)).to_be_visible()
        expect(header.get_by_role('button', name='Cancel selection', exact=True)).to_be_visible()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 321)

    def test_continue_search_and_list_reflow_preserve_reading_state(self):
        title = 'A very long book title 日本語の読書と旅の長い物語'
        self.import_book(title, creators=('A long author name 日本語',))
        self.import_book('Second reading book', size=(360, 240))
        for name in (title, 'Second reading book'):
            self.page.get_by_role('button', name='Read ' + name, exact=True).click()
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
            self.go_library()
        before = self.stores('books', ['bookmark', 'statistic'])
        for width in (320, 390, 1440):
            self.page.set_viewport_size({'width': width, 'height': 844})
            expect(self.page.get_by_role('heading', name='Continue', exact=True)).to_be_visible()
            expect(self.page.get_by_role('heading', name='Books', exact=True)).to_be_visible()
            spacing = self.page.locator('.library-workspace').evaluate('''workspace => {
                const rect = selector => workspace.querySelector(selector).getBoundingClientRect();
                return {
                    continueGap: rect('.continue-card').top - rect('#continue-heading').bottom,
                    sectionGap: rect('#books-heading').top - rect('.continue-section').bottom,
                    booksGap: rect('.shelf-grid .book-thumbnail').top - rect('#books-heading').bottom
                };
            }''')
            # The track reserves 4px for focus outlines above the 16px section margin.
            self.assertAlmostEqual(spacing['continueGap'], 20, delta=2)
            self.assertAlmostEqual(spacing['sectionGap'], 28, delta=2)
            self.assertGreaterEqual(spacing['booksGap'], 12)
            self.assertLessEqual(spacing['booksGap'], 28)
            track = self.page.locator('.continue-track')
            shelves = self.page.get_by_role('region', name='Library shelves').bounding_box()
            track_box = track.bounding_box()
            self.assertAlmostEqual(track_box['x'], shelves['x'], delta=1)
            self.assertAlmostEqual(track_box['x'] + track_box['width'], shelves['x'] + shelves['width'], delta=1)
            if width < 1024:
                self.assertAlmostEqual(track_box['x'], 0, delta=1)
                self.assertAlmostEqual(track_box['width'], width, delta=1)
                track.evaluate('e => e.scrollTo({left: 0, behavior: "instant"})')
                first = self.page.locator('.continue-card').first.bounding_box()
                heading = self.page.get_by_role('heading', name='Continue', exact=True).bounding_box()
                self.assertAlmostEqual(first['x'], heading['x'], delta=1)
                self.page.mouse.move(width / 2, track_box['y'] + track_box['height'] / 2)
                self.page.mouse.wheel(2000, 0)
                self.page.wait_for_function('''() => {
                    const e = document.querySelector('.continue-track');
                    return e.scrollLeft >= e.scrollWidth - e.clientWidth - 1;
                }''')
                last = self.page.locator('.continue-card').last.bounding_box()
                self.assertAlmostEqual(width - last['x'] - last['width'], heading['x'], delta=1)
            self.page.get_by_role('button', name='Continue ' + title, exact=True).focus()
            expect(self.page.get_by_role('button', name='Continue ' + title, exact=True)).to_be_in_viewport()
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
            for card in self.page.locator('.continue-card').all():
                box = card.bounding_box()
                cover = card.locator('.cover-surface').bounding_box()
                self.assertGreaterEqual(cover['y'] - box['y'], 12)
                self.assertGreaterEqual(box['y'] + box['height'] - cover['y'] - cover['height'], 12)
        self.choose_view('List')
        for width in (320, 390, 1440):
            self.page.set_viewport_size({'width': width, 'height': 844})
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
            expect(self.tile(title).get_by_role('heading', name=title, exact=True)).to_be_visible()
        search = self.page.get_by_role('searchbox', name='Search library', exact=True)
        search.fill('missing book')
        expect(self.page.get_by_role('heading', name='No matching books', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Clear Search', exact=True).click()
        expect(self.page.get_by_role('heading', name='Continue', exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['bookmark', 'statistic']))

    def test_scoped_selection_clears_when_collection_or_search_changes(self):
        for title in ('Alpha scope', 'Beta scope', 'Gamma scope'):
            self.import_book(title)
        self.add_collection('Beta scope', 'One book only')
        self.choose_collection('One book only')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        self.page.get_by_placeholder('Search library').fill('no result')
        expect(self.page.get_by_text('0 selected', exact=True)).to_be_visible()
        expect(self.page.get_by_role('heading', name='No matching books', exact=True)).to_be_visible()
        self.page.get_by_placeholder('Search library').fill('Beta')
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        self.choose_collection('Books')
        expect(self.page.get_by_text('0 selected', exact=True)).to_be_visible()

    def test_continue_finished_timeline_and_author_search_are_distinct_destinations(self):
        self.import_book('Started book', creators=('Author One',))
        self.import_book('Untouched book', creators=('Author Two',))
        self.import_book('Finished book', creators=('Author Three',))
        self.page.get_by_role('button', name='Read Started book', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        self.go_library()
        expect(self.page.get_by_role('heading', name='Continue', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Continue Started book', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Continue Untouched book', exact=True)).to_have_count(0)
        expect(self.tile('Untouched book').locator('.progress-label')).to_have_text('NEW')

        self.choose_view('List')
        expect(self.tile('Started book').locator('.book-author')).to_have_text('Author One')
        self.page.get_by_placeholder('Search library').fill('Author Two')
        expect(self.page.get_by_role('button', name='Read Untouched book', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Started book', exact=True)).to_have_count(0)
        self.page.get_by_placeholder('Search library').fill('')

        self.menu('Finished book', 'Mark as Finished')
        self.menu('Finished book', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2024-02-29')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        self.menu('Untouched book', 'Mark as Finished')
        self.menu('Untouched book', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2023-01-15')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        self.choose_collection('Finished')
        expect(self.page.get_by_role('list', name='Finished books', exact=True)).to_be_visible()
        expect(self.page.locator('.finished-day').first).to_contain_text(re.compile(r'Feb.*29.*2024|29.*Feb.*2024'))
        expect(self.page.locator('.finished-author').first).to_have_text('Author Three')
        self.open_view_menu()
        expect(self.page.get_by_role('menuitemradio', name='Not Finished', exact=True)).to_have_count(0)
        self.page.get_by_role('menuitem', name='Sort by…', exact=True).hover()
        self.page.get_by_role('menuitemradio', name='Oldest first', exact=True).click()
        expect(self.page.locator('.finished-day').first).to_contain_text(re.compile(r'Jan.*15.*2023|15.*Jan.*2023'))
        self.open_view_menu()
        self.page.get_by_role('menuitemradio', name='Grid', exact=True).click()
        expect(self.page.locator('.shelf-grid')).to_be_visible()

    def test_macos_package_file_picker_handoff_and_directory_fallback(self):
        # Chromium and WebKit turn a selected macOS package into an application/zip
        # File named <original package>.zip before JavaScript sees it. CI cannot run
        # the native macOS picker, so this feeds that documented post-picker File
        # shape through the real app input and import pipeline.
        wrapper_title = 'Mac Package EPUB'
        file_input = self.page.locator('input[type=file][accept*=".epub"]').first
        expect(file_input).to_have_attribute('accept', re.compile(r'\.epub\.zip'))
        file_input.set_input_files({
            'name': wrapper_title + '.epub.zip',
            'mimeType': 'application/zip',
            'buffer': macos_browser_package_handoff(wrapper_title)
        })
        expect(self.page.get_by_role(
            'button', name='Read ' + wrapper_title, exact=True)).to_be_visible(timeout=30000)

        folder_title = 'Package EPUB Fallback'
        with tempfile.TemporaryDirectory() as directory:
            package_dir = Path(directory) / (folder_title + '.epub')
            package_dir.mkdir()
            with zipfile.ZipFile(io.BytesIO(book(folder_title))) as archive:
                archive.extractall(package_dir)
            self.page.locator('input[type=file][webkitdirectory]').set_input_files(str(package_dir))
            expect(self.page.get_by_role(
                'button', name='Read ' + folder_title, exact=True)).to_be_visible(timeout=30000)

    def test_mobile_grid_list_fitted_covers_and_authored_binding(self):
        self.import_book('Left binding', spine='ltr', style='body{writing-mode:vertical-rl}')
        self.import_book('Right binding', spine='rtl', size=(180, 380))
        self.page.set_viewport_size({'width':390, 'height':844})
        for title, direction in [('Left binding', 'ltr'), ('Right binding', 'rtl')]:
            tile = self.tile(title)
            expect(tile.locator('.cover-stage')).to_have_attribute('data-direction', direction)
            tile.locator('img').evaluate('img => img.decode()')
            geometry = tile.locator('.book-thumbnail').evaluate('e => {const c=e.querySelector(".cover-surface");return [e.clientWidth,e.clientHeight,c.clientWidth,c.clientHeight];}')
            self.assertLessEqual(geometry[2], geometry[0] + 1)
            self.assertLessEqual(geometry[3], geometry[1] + 1)
            expect(tile.locator('.progress-label')).to_have_text('NEW')
            expect(tile.get_by_role('img')).to_have_count(0)
        self.choose_view('List')
        expect(self.page.locator('.shelf-list')).to_be_visible()
        expect(self.tile('Right binding').get_by_role('heading', name='Right binding')).to_be_visible()
        self.page.reload()
        expect(self.page.locator('.shelf-list')).to_be_visible()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)
        self.choose_view('Grid')
        expect(self.page.locator('.shelf-grid')).to_be_visible()

    def test_compact_library_header_preserves_management_actions(self):
        self.import_book('Header book')
        self.page.set_viewport_size({'width':390, 'height':844})
        header = self.page.get_by_role('banner', name='Library toolbar')
        expect(self.page).to_have_title(re.compile(r'Library'))
        heading = header.get_by_role('heading', name='Manabi Reader for Web', exact=True)
        expect(heading).to_be_visible()
        title_width = heading.evaluate('element => [element.scrollWidth, element.clientWidth]')
        self.assertLessEqual(title_width[0], title_width[1] + 1)
        expect(header.get_by_role('button', name='Main menu', exact=True)).to_have_count(0)
        expect(header.get_by_role('button', name='Collections', exact=True)).to_be_visible()
        expect(header.get_by_role('button', name='Library actions', exact=True)).to_be_visible()
        expect(self.page.get_by_role('complementary', name='Collections', exact=True)).not_to_be_visible()
        for obsolete in ('Add books', 'Browser', 'Select books', 'Help', 'Navigate'):
            expect(header.get_by_role('button', name=obsolete, exact=True)).to_have_count(0)

        header.get_by_role('button', name='Library actions', exact=True).click()
        expect(self.page.get_by_role('menuitem', name='Select Books', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Add Books', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Accounts and Libraries', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='User guide', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Statistics', exact=True)).to_be_visible()
        expect(self.page.get_by_role('menuitem', name='Settings', exact=True)).to_be_visible()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        expect(header.get_by_role('button', name='Cancel selection', exact=True)).to_be_visible()
        header.get_by_role('button', name='Cancel selection', exact=True).click()

        header.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('#library-collections-sheet')
        expect(sheet.get_by_role('heading', name='Collections', exact=True)).to_be_visible()
        expect(sheet.get_by_role('button', name='Edit', exact=True)).to_be_visible()
        expect(sheet.get_by_role('button', name='Close collections', exact=True)).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('[data-slot="sheet-content"]')).to_have_count(0)
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)

    def test_horizontal_size_class_swaps_compact_controls_and_persistent_library_rail(self):
        self.import_book('Rail book')
        self.page.set_viewport_size({'width':1440, 'height':900})
        header = self.page.get_by_role('banner', name='Library toolbar')
        rail = self.page.get_by_role('complementary', name='Collections', exact=True)
        expect(rail).to_be_visible()
        panel = rail.evaluate('''element => {
            const box = element.getBoundingClientRect(), style = getComputedStyle(element);
            return {top: box.top, bottom: box.bottom, radius: parseFloat(style.borderTopLeftRadius),
                rightBorder: parseFloat(style.borderRightWidth)};
        }''')
        self.assertAlmostEqual(16, panel['top'], delta=2)
        self.assertAlmostEqual(884, panel['bottom'], delta=2)
        self.assertGreaterEqual(panel['radius'], 20)
        self.assertGreater(panel['rightBorder'], 0)
        scroll_y = self.page.evaluate('''() => {
            const spacer = document.createElement('div');
            spacer.id = 'rail-scroll-fixture';
            spacer.style.height = '1200px';
            document.body.append(spacer);
            window.scrollTo(0, 80);
            return window.scrollY;
        }''')
        self.assertGreater(scroll_y, 0)
        scrolled = rail.bounding_box()
        self.assertAlmostEqual(16, scrolled['y'], delta=2)
        self.assertAlmostEqual(884, scrolled['y'] + scrolled['height'], delta=2)
        self.page.evaluate("document.getElementById('rail-scroll-fixture').remove(); window.scrollTo(0, 0)")
        header_style = header.evaluate('''element => {
            const style = getComputedStyle(element);
            return {background: style.backgroundColor, border: parseFloat(style.borderBottomWidth)};
        }''')
        self.assertIn(header_style['background'], ('rgba(0, 0, 0, 0)', 'transparent'))
        self.assertEqual(0, header_style['border'])
        expect(header.get_by_role('button', name='Main menu', exact=True)).not_to_be_visible()
        expect(header.get_by_role('button', name='Collections', exact=True)).not_to_be_visible()
        expect(self.tile('Rail book')).to_be_visible()
        workspace = self.page.get_by_role('region', name='Library shelves', exact=True)
        self.assertGreater(workspace.bounding_box()['width'], 800)
        rail.get_by_role('button', name=re.compile(r'^Finished\b')).click()
        expect(self.page.get_by_role('heading', name='Finished', exact=True)).to_be_visible()
        expect(rail).to_be_visible()
        self.page.reload()
        expect(rail).to_be_visible()
        self.page.set_viewport_size({'width':1023, 'height':900})
        expect(rail).not_to_be_visible()
        expect(header.get_by_role('button', name='Main menu', exact=True)).to_have_count(0)
        expect(header.get_by_role('button', name='Collections', exact=True)).to_be_visible()
        self.page.set_viewport_size({'width':1024, 'height':900})
        expect(rail).to_be_visible()
        expect(header.get_by_role('button', name='Main menu', exact=True)).not_to_be_visible()
        expect(header.get_by_role('button', name='Collections', exact=True)).not_to_be_visible()

    def test_book_menu_uses_concise_actions_and_persistent_cover_override(self):
        self.import_book('Cover override')
        self.page.get_by_role('button', name='Actions for Cover override', exact=True).click()
        expect(self.page.get_by_role('menuitem', name='Read', exact=True)).to_have_count(0)
        expect(self.page.get_by_text('Book Binding', exact=True)).to_have_count(0)
        expect(self.page.get_by_role(
            'menuitem', name='Remove from this browser…', exact=True)).to_be_visible()
        with self.page.expect_file_chooser() as chooser:
            self.page.get_by_role('menuitem', name='Change Cover…', exact=True).click()
        chooser.value.set_files({
            'name': 'replacement.png',
            'mimeType': 'image/png',
            'buffer': raster(120, 180, (40, 120, 180))
        })
        cover = self.tile('Cover override').locator('img')
        expect(cover).to_have_attribute('src', re.compile(r'^data:image/(?:png|webp);base64,'))
        self.page.reload()
        cover = self.tile('Cover override').locator('img')
        expect(cover).to_have_attribute(
            'src', re.compile(r'^data:image/(?:png|webp);base64,'), timeout=30000)

    def test_direction_uses_css_cascade_not_language_and_ignores_hidden_text(self):
        self.import_book('Japanese horizontal')
        self.import_book('Japanese vertical', style='body{writing-mode:horizontal-tb} main.story{writing-mode:vertical-rl}', body='<main class="story">' + '<p>縦書きの文章を読みます。</p>' * 50 + '</main>')
        self.import_book('Hidden vertical', style='.hidden{display:none;writing-mode:vertical-rl}', body='<div class="hidden"><p>' + '隠された文章。' * 1000 + '</p></div><p>' + '横書きの本文。' * 100 + '</p>')
        self.import_book('Unresolved style', style='@import url(/attack-probe); body{writing-mode:vertical-rl}')
        self.import_book('Mixed directions', style='', body='<div style="writing-mode:vertical-rl">' + '文章。' * 100 + '</div><div style="writing-mode:horizontal-tb">' + '文章。' * 100 + '</div>')
        for title, expected in [('Japanese horizontal','ltr'),('Japanese vertical','rtl'),('Hidden vertical','ltr'),('Unresolved style','unknown'),('Mixed directions','unknown')]:
            expect(self.tile(title).locator('.cover-stage')).to_have_attribute('data-direction', expected)

    def test_finish_date_and_still_reading_preserve_progress_and_statistics(self):
        self.import_book()
        before = self.stores('books', ['bookmark','statistic'])
        self.menu('Library test', 'Mark as Finished')
        expect(self.tile('Library test').locator('.progress-label')).to_have_text('Finished')
        completed = self.stores('books', ['bookmark','statistic'])
        self.assertEqual(before['statistic'], completed['statistic'])
        self.assertEqual(0, completed['bookmark'][0]['progress'])
        self.menu('Library test', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2024-02-29')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.assertEqual('2024-02-29', self.stores('books',['bookmark'])['bookmark'][0]['completion']['finishedOn'])
        self.page.reload()
        expect(self.tile('Library test').locator('.progress-label')).to_have_text('Finished')
        self.menu('Library test', 'Mark as Still Reading')
        expect(self.tile('Library test').locator('.progress-label')).to_have_text('NEW')
        still = self.stores('books', ['bookmark','statistic'])
        self.assertEqual(completed['statistic'], still['statistic'])
        self.assertEqual(0, still['bookmark'][0]['progress'])
        self.assertEqual('reading', still['bookmark'][0]['completion']['state'])
        self.assertNotIn('finishedOn', still['bookmark'][0]['completion'])

    def test_collections_are_many_to_many_and_deletion_does_not_delete_books(self):
        self.import_book('Collection book')
        self.add_collection('Collection book', 'Favorites')
        self.add_collection('Collection book', 'Japanese')
        self.page.reload()
        self.menu('Collection book', 'Add to Collection…')
        expect(self.dialog().get_by_role('checkbox', name='Favorites')).to_be_checked()
        expect(self.dialog().get_by_role('checkbox', name='Japanese')).to_be_checked()
        self.dialog().get_by_role('checkbox', name='Favorites').uncheck()
        expect(self.dialog().get_by_role('checkbox', name='Japanese')).to_be_checked()
        self.dialog().get_by_role('button', name='Done').click()
        self.page.set_viewport_size({'width':390, 'height':844})
        self.page.get_by_role('button', name='Collections', exact=True).click()
        sheet = self.page.locator('#library-collections-sheet')
        sheet.get_by_role('button', name='Edit', exact=True).click()
        sheet.get_by_role('button', name='Rename collection Japanese', exact=True).click()
        self.dialog().get_by_label('Name', exact=True).fill('Reading in Japanese')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(sheet.get_by_role('button', name='Rename collection Reading in Japanese', exact=True)).to_be_visible()
        sheet.get_by_role('button', name='Delete collection Reading in Japanese', exact=True).click()
        self.dialog().get_by_role('button', name='Delete Collection', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.page.keyboard.press('Escape')
        expect(self.page.get_by_role('button', name='Read Collection book', exact=True)).to_be_visible()
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))

    def test_existing_reader_autosaves_cannot_erase_library_finish_decision(self):
        self.import_book('Open reader')
        self.page.get_by_role('button', name='Read Open reader', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        reader = self.page
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.go_library()
        self.menu('Open reader', 'Mark as Finished')
        expect(self.tile('Open reader').locator('.progress-label')).to_have_text('Finished')
        before = self.stores('books', ['bookmark'])['bookmark'][0]
        reader.bring_to_front()
        reader.keyboard.press('PageDown')
        # Let the existing three-second reader autosave actually persist. Do not
        # replace it with a direct database write or merely check unchanged data.
        after = self.wait_bookmark(before['dataId'],
            lambda row: row.get('lastBookmarkModified', 0) > before['lastBookmarkModified'])
        self.assertGreater(after['lastBookmarkModified'], before['lastBookmarkModified'])
        self.page.bring_to_front()
        self.assertEqual(before['completion'], after['completion'])
        self.menu('Open reader', 'Mark as Still Reading')
        expect(self.tile('Open reader').locator('.progress-label')).not_to_have_text('Finished')
        reader.close()


    def test_finished_and_custom_collections_filter_the_actual_library(self):
        self.import_book('Finished selection')
        self.import_book('Still reading selection')
        self.add_collection('Still reading selection', 'Personal selection')
        self.menu('Finished selection', 'Mark as Finished')
        expect(self.tile('Finished selection').locator('.progress-label')).to_have_text('Finished')
        self.choose_collection('Finished')
        expect(self.page.get_by_role('heading', name='Finished', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_have_count(0)
        self.choose_collection('Personal selection')
        expect(self.page.get_by_role('heading', name='Personal selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)
        self.page.reload()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_have_count(0)
        self.choose_collection('Books')
        expect(self.page.get_by_role('button', name='Read Finished selection', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Still reading selection', exact=True)).to_be_visible()

    def test_finished_date_and_binding_survive_real_export_migration_and_repeat(self):
        self.import_book('Portable finished book', spine='rtl', creators=('Portable Author',))
        expect(self.tile('Portable finished book').locator('.cover-stage')).to_have_attribute('data-direction', 'rtl')
        self.menu('Portable finished book', 'Mark as Finished')
        expect(self.tile('Portable finished book').locator('.progress-label')).to_have_text('Finished')
        self.menu('Portable finished book', 'Edit Finished Date…')
        self.dialog().get_by_label('Finished on', exact=True).fill('2024-02-29')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        before = self.stores('books', ['bookmark','statistic','data'])
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
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
                self.assertEqual([{'name':'Portable Author'}], static['creators'])
        original = self.page
        with tempfile.TemporaryDirectory() as profile:
            destination = getattr(self.playwright, self.engine).launch_persistent_context(profile)
            self.page = destination.pages[0]
            self.page.on('pageerror', lambda e: self.errors.append(str(e)))
            try:
                self.page.goto(self.origin + '/reader-web/import-ttu')
                chooser = self.page.get_by_label('Choose Ttu export ZIPs', exact=True)
                expect(chooser).to_be_enabled()
                chooser.set_input_files({'name':'library-backup.zip','mimeType':'application/zip','buffer':raw})
                import_selected = self.page.get_by_role(
                    'button', name=re.compile(r'^Import selected \('))
                expect(import_selected).to_be_visible(timeout=60000)
                imported = self.page.get_by_role('article', name='Import Portable finished book', exact=True)
                expect(imported).to_be_visible(timeout=60000)
                expect(import_selected).to_be_enabled(timeout=30000)
                import_selected.click()
                expect(imported.get_by_role('status')).to_have_text('Imported Portable finished book.', timeout=30000)
                migrated = self.stores('books', ['bookmark','statistic','data'])
                self.assertEqual(before['bookmark'][0]['completion'], migrated['bookmark'][0]['completion'])
                self.assertEqual(before['bookmark'][0]['progress'], migrated['bookmark'][0]['progress'])
                self.assertEqual(before['statistic'], migrated['statistic'])
                self.assertEqual(before['data'][0]['pageDirection'], migrated['data'][0]['pageDirection'])
                self.assertEqual(before['data'][0]['creators'], migrated['data'][0]['creators'])
                self.assertEqual(before['data'][0]['contentHash'], migrated['data'][0]['contentHash'])
                self.page.get_by_role('button', name='Select all', exact=True).click()
                import_selected.click()
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


    def test_explicit_reader_completion_supersedes_still_reading(self):
        self.import_book('Finish once more')
        self.menu('Finish once more', 'Mark as Finished')
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')
        self.menu('Finish once more', 'Mark as Still Reading')
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('NEW')
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
        self.wait_bookmark(before['dataId'],
            lambda row: row.get('completion', {}).get('state') == 'finished')
        after = self.stores('books', ['bookmark','readerStatistic'])
        self.assertEqual('finished', after['bookmark'][0]['completion']['state'])
        self.assertGreater(after['bookmark'][0]['completion']['modifiedAt'], before['completion']['modifiedAt'])
        self.assertTrue(any(row.get('completedBook') == 1 for row in after['readerStatistic']))
        self.go_library()
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')
        self.page.reload()
        expect(self.tile('Finish once more').locator('.progress-label')).to_have_text('Finished')


class BooksLibraryFilesystem(LibraryBase):
    def test_external_relocation_rebinds_content_identity_and_presentation(self):
        original = book('Relocation original')
        self.seed_files({'Old/Volume.epub': original})
        expect(self.page.get_by_role('button', name='Read Relocation original', exact=True)).to_be_visible(
            timeout=30000)
        # These actions start on a preview-only source book. They must first
        # establish a content identity, rather than saving a mutable file path.
        self.add_collection('Relocation original', 'Relocation collection')
        self.menu('Relocation original', 'Rename…')
        self.dialog().get_by_label('Name', exact=True).fill('My relocated volume')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.page.get_by_role('button', name='Read My relocated volume', exact=True)).to_be_visible()
        self.assertEqual([], self.stores('manabi-reader-integrations', ['books'])['books'])
        metadata = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        organization = next(row for row in metadata if row.get('version') == 1 and 'collections' in row)
        member = next(collection['members'][0] for collection in organization['collections']
                      if collection['name'] == 'Relocation collection')
        self.assertRegex(member, r'^content:[a-f0-9]{64}$')
        self.assertEqual('My relocated volume', organization['books'][member]['title'])
        with self.page.expect_file_chooser() as chooser:
            self.menu('My relocated volume', 'Change Cover…')
        chooser.value.set_files({
            'name': 'replacement.png', 'mimeType': 'image/png',
            'buffer': raster(120, 180, (40, 120, 180))
        })
        cover = self.tile('My relocated volume').locator('img')
        expect(cover).to_have_attribute('src', re.compile(r'^data:image/(?:png|webp);base64,'))
        override = cover.get_attribute('src')
        links_before = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertEqual(1, len(links_before))
        book_id = links_before[0]['bookId']
        reading_before = self.stores('books', ['bookmark', 'statistic'])
        self.page.evaluate('''async () => {
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture');
          const old = await root.getDirectoryHandle('Old');
          const file = await (await old.getFileHandle('Volume.epub')).getFile();
          const nested = await (await root.getDirectoryHandle('New',{create:true})).getDirectoryHandle('Nested',{create:true});
          const writer = await (await nested.getFileHandle('Moved.epub',{create:true})).createWritable();
          await writer.write(file); await writer.close();
          await old.removeEntry('Volume.epub');
        }''')
        self.open_organize_menu()
        self.page.get_by_role('menuitem', name='Refresh Connected Folders', exact=True).click()
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
            'aria-busy', 'false', timeout=30000)
        expect(self.page.get_by_role('button', name='Read My relocated volume', exact=True)).to_have_count(
            1, timeout=30000)
        expect(self.tile('My relocated volume').locator('img')).to_have_attribute('src', override)
        self.choose_collection('Relocation collection')
        expect(self.page.get_by_role('button', name='Read My relocated volume', exact=True)).to_have_count(1)
        self.menu('My relocated volume', 'Add to Collection…')
        expect(self.dialog().get_by_role('checkbox', name='Relocation collection')).to_be_checked()
        self.dialog().get_by_role('button', name='Done').click()
        self.assertEqual(reading_before, self.stores('books', ['bookmark', 'statistic']))
        self.page.get_by_role('button', name='Read My relocated volume', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=30000)
        links_after = self.stores('manabi-reader-integrations', ['books'])['books']
        self.assertIn('New/Nested/Moved.epub', [link['fileId'] for link in links_after])
        self.assertEqual({book_id}, {link['bookId'] for link in links_after})
        self.assertEqual(hashlib.sha256(original).hexdigest(), self.disk()['New/Nested/Moved.epub'])

    def test_series_geometry_uses_available_column_width_and_keeps_status_baselines(self):
        self.seed_files({
            'Volumes/1.epub': book('First volume'),
            'Volumes/2.epub': book('Second volume'),
            'Standalone.epub': book('Standalone')
        })
        series = self.page.get_by_role('button', name='Open series Volumes', exact=True)
        expect(series).to_be_visible()
        for width in (320, 390, 1024, 1440):
            self.page.set_viewport_size({'width': width, 'height': 900})
            tile = self.page.locator('.shelf-item').filter(has=series)
            front = tile.locator('.stack-item.front').bounding_box()
            rear = tile.locator('.stack-item:not(.front)').bounding_box()
            self.assertGreater(front['x'], rear['x'])
            self.assertGreater(front['y'], rear['y'])
            expect(tile.locator('.series-copy')).not_to_be_visible()
            self.assertAlmostEqual(tile.locator('.book-status').bounding_box()['y'],
                self.tile('Standalone').locator('.book-status').bounding_box()['y'], delta=1)
        series.click()
        hero = self.page.locator('.series-hero')
        for detail in self.page.locator('.shelf-list .list-detail').all():
            expect(detail).not_to_contain_text('Reading now')
        for width in (390, 768, 1024, 1440, 1023):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 900})
                art = hero.locator('.series-hero-art').bounding_box()
                copy = hero.locator('.series-hero-copy').bounding_box()
                if width == 1440:
                    self.assertGreater(copy['x'], art['x'] + art['width'])
                elif width in (390, 768, 1024):
                    self.assertGreaterEqual(copy['y'], art['y'] + art['height'] - 1)
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
                expect(hero.get_by_role('button', name=re.compile('^Start Reading'))).to_be_visible()

    def seed_files(self, files):
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.get_by_role('button', name='Refresh connections')).to_be_enabled()
        self.source_id = self.page.evaluate('''async files => {
          const handle=await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture',{create:true});
          for(const [path,data] of Object.entries(files)) {const parts=path.split('/'),name=parts.pop();let dir=handle;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const file=await dir.getFileHandle(name,{create:true});const w=await file.createWritable();await w.write(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await w.close();}
          const id='local-'+crypto.randomUUID();
          await new Promise((resolve,reject)=>{const r=indexedDB.open('manabi-reader-integrations',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('localLibraries','readwrite');tx.objectStore('localLibraries').put({id,name:'Library fixture',handle,writable:true});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)});
          return id;
        }''', {path: base64.b64encode(data).decode() for path,data in files.items()})
        self.go_library()

    def disk(self):
        return self.page.evaluate('''async () => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture'),result={};
          async function visit(dir,prefix='') {for await(const [name,item] of dir.entries()){const path=prefix+name;if(item.kind==='directory')await visit(item,path+'/');else {const file=await item.getFile();result[path]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');}}}
          await visit(root);return result;
        }''')

    def test_recursive_series_covers_filters_and_readonly_scanning(self):
        self.seed_files({'Wrapper/Volumes/1.epub':book('Volume 1'), 'Wrapper/Volumes/2.epub':book('Volume 2'),
            'Wrapper/Volumes/.manabi-reader.yaml':b'name: "Named series"\n',
            'Wrapper/Volumes/5.epub':book('Volume 5'),'Wrapper/Volumes/Nested/3.epub':book('Volume 3'),'Wrapper/Volumes/Nested/4.epub':book('Volume 4'),
            'Singleton/Deep/Only.epub':book('Single book')})
        before = self.disk()
        expect(self.page.get_by_role('button',name='Open series Named series',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button',name='Read Single book',exact=True)).to_be_visible(timeout=30000)
        self.menu('Single book','Mark as Finished')
        expect(self.tile('Single book').locator('.progress-label')).to_have_text('Finished')
        expect(self.page.get_by_role('button',name='Open series Wrapper',exact=True)).to_have_count(0)
        tile = self.page.locator('.shelf-item').filter(has=self.page.get_by_role('button',name='Open series Named series',exact=True))
        expect(tile.locator('.cover-stack')).to_have_attribute('data-cover-count','2')
        expect(tile.get_by_role('img',name='Local folder: Library fixture',exact=True)).to_be_visible()
        self.page.get_by_role('button',name='Open series Named series',exact=True).click()
        expect(self.page.locator('.series-hero .cover-stack')).to_have_attribute('data-cover-count','5')
        expect(self.page.get_by_role('button',name='Open series Nested',exact=True)).to_be_visible()
        expect(self.page.locator('.shelf-item').first).to_have_class(re.compile(r'\bseries-item\b'))
        self.choose_view('Descending')
        expect(self.page.locator('.shelf-item').first).to_have_class(re.compile(r'\bseries-item\b'))
        self.page.get_by_role('button',name='Open series Nested',exact=True).click()
        expect(self.page.get_by_role('button',name='Read Volume 3',exact=True)).to_be_visible(timeout=30000)
        self.menu('Volume 3','Mark as Finished')
        expect(self.tile('Volume 3').locator('.progress-label')).to_have_text('Finished')
        series_url = self.page.url
        self.page.goto(series_url + '&collection=finished')
        expect(self.page.locator('.series-hero')).to_contain_text('Series · 1 Book')
        expect(self.page.locator('.series-hero')).to_contain_text('All books finished')
        expect(self.page.get_by_role('button',name='Read Volume 3',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button',name='Read Volume 4',exact=True)).to_have_count(0)
        expect(self.page.get_by_role('button',name='Read Single book',exact=True)).to_have_count(0)
        self.page.goto(series_url)
        self.choose_view('Not Finished')
        expect(self.page.get_by_role('button',name='Read Volume 3',exact=True)).to_have_count(0)
        expect(self.page.get_by_role('button',name='Read Volume 4',exact=True)).to_be_visible()
        expect(self.page.get_by_role('heading',name='Nested',exact=True)).to_be_visible()
        self.assertEqual(before,self.disk())

    def test_combine_moves_actual_files_preserving_import_progress_membership_and_name(self):
        self.seed_files({'A/First.epub':book('First book'),'B/Second.epub':book('Second book')})
        expect(self.page.get_by_role('button',name='Read First book',exact=True)).to_be_visible(timeout=30000)
        self.menu('First book','Mark as Finished')
        expect(self.tile('First book').locator('.progress-label')).to_have_text('Finished')
        self.add_collection('First book','Kept collection')
        self.menu('First book', 'Rename…')
        self.dialog().get_by_label('Name', exact=True).fill('Personal First')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.page.get_by_role('button', name='Read Personal First', exact=True)).to_be_visible()
        with self.page.expect_file_chooser() as chooser:
            self.menu('Personal First', 'Change Cover…')
        chooser.value.set_files({
            'name': 'replacement.png', 'mimeType': 'image/png',
            'buffer': raster(120, 180, (40, 120, 180))
        })
        cover = self.tile('Personal First').locator('img')
        expect(cover).to_have_attribute('src', re.compile(r'^data:image/(?:png|webp);base64,'))
        override = cover.get_attribute('src')
        old_reading=self.stores('books',['bookmark','statistic'])
        old_links=self.stores('manabi-reader-integrations',['books'])['books']
        before=self.disk()
        self.open_organize_menu()
        self.page.get_by_role('menuitem',name='Create Series from Books…',exact=True).click()
        self.dialog().get_by_label('Name',exact=True).fill('Combined')
        for checkbox in self.dialog().get_by_role('checkbox').all(): checkbox.check()
        self.dialog().get_by_role('button',name='Move into Series',exact=True).click()
        expect(self.dialog()).to_have_count(0,timeout=30000)
        expect(self.page.get_by_role('button',name='Open series Combined',exact=True)).to_be_visible()
        after=self.disk()
        self.assertEqual(before['A/First.epub'],after['Combined/First.epub'])
        self.assertEqual(before['B/Second.epub'],after['Combined/Second.epub'])
        self.assertNotIn('A/First.epub',after);self.assertNotIn('B/Second.epub',after)
        self.assertIn('Combined/.manabi-reader.yaml',after)
        self.assertFalse(any('operation-' in key for key in after))
        self.assertEqual(old_reading,self.stores('books',['bookmark','statistic']))
        new_links=self.stores('manabi-reader-integrations',['books'])['books']
        self.assertEqual(old_links[0]['id'],new_links[0]['id'])
        self.assertEqual(old_links[0]['bookId'],new_links[0]['bookId'])
        self.assertEqual('Combined/First.epub',new_links[0]['fileId'])
        self.page.get_by_role('button',name='Open series Combined',exact=True).click()
        expect(self.page.get_by_role('button', name='Read Personal First', exact=True)).to_be_visible()
        expect(self.tile('Personal First').locator('img')).to_have_attribute('src', override)
        self.menu('Personal First','Add to Collection…')
        expect(self.dialog().get_by_role('checkbox',name='Kept collection',exact=True)).to_be_checked()
        self.dialog().get_by_role('button',name='Done',exact=True).click()
        self.page.get_by_role('button',name='Actions for series Combined',exact=True).click()
        self.page.get_by_role('menuitem',name='Rename Series…',exact=True).click()
        self.dialog().get_by_label('Name',exact=True).fill('シリーズ')
        self.dialog().get_by_role('button',name='Save',exact=True).click()
        expect(self.page.get_by_role('heading',name='シリーズ',exact=True)).to_be_visible()
        self.page.reload()
        expect(self.page.get_by_role('heading',name='シリーズ',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Read Personal First', exact=True)).to_be_visible()
        expect(self.tile('Personal First').locator('img')).to_have_attribute('src', override)
        self.assertEqual(after['Combined/First.epub'],self.disk()['Combined/First.epub'])

    def test_resume_durable_copied_journal_through_actual_library_button(self):
        self.seed_files({'One.epub':book('Recovery one'),'Two.epub':book('Recovery two')})
        before=self.disk()
        self.page.evaluate('''async sourceId => {
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('Library fixture');
          const folder=await root.getDirectoryHandle('Recovered',{create:true});const id=crypto.randomUUID(),files=[];
          for(const name of ['One.epub','Two.epub']) {const original=await(await root.getFileHandle(name)).getFile();const w=await(await folder.getFileHandle(name,{create:true})).createWritable();await w.write(original);await w.close();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');files.push({from:name,to:'Recovered/'+name,hash});}
          for(const [name,text] of [['.manabi-reader-operation-'+id,id],['.Manabi-Reader.yaml','name: "Recovered"\\n']]) {const w=await(await folder.getFileHandle(name,{create:true})).createWritable();await w.write(text);await w.close();}
          await root.removeEntry('One.epub');
          await new Promise((resolve,reject)=>{const r=indexedDB.open('manabi-reader-integrations',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('metadata','readwrite');tx.objectStore('metadata').put({version:1,id,sourceId,parent:'',folder:'Recovered',name:'Recovered',files,phase:'copied'},'library-file-operation:'+sourceId);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
        }''',self.source_id)
        self.page.reload()
        self.page.get_by_role('button',name='Resume Folder Change',exact=True).click()
        expect(self.page.get_by_role('button',name='Resume Folder Change',exact=True)).to_have_count(0,timeout=30000)
        expect(self.page.get_by_role('button',name='Open series Recovered',exact=True)).to_be_visible()
        after=self.disk()
        self.assertEqual(before['One.epub'],after['Recovered/One.epub'])
        self.assertEqual(before['Two.epub'],after['Recovered/Two.epub'])
        self.assertNotIn('One.epub',after);self.assertNotIn('Two.epub',after)
        self.page.reload()
        expect(self.page.get_by_role('button',name='Resume Folder Change',exact=True)).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
