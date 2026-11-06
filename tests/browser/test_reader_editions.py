"""Actual exported edition: local books, isolated data, responsive UI and offline reopening."""
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import unquote, urlsplit
import json
import os
import threading
import socket
import unittest
from playwright.sync_api import sync_playwright, expect
from browser_launch import launch_options
from reader_edition_output import reader_edition_output
from test_books_library import book
from test_static_reader import ThreadingHTTPServer
from test_unified_search import dictionary_archive

ROOT = reader_edition_output(Path(__file__).resolve().parents[2] / 'apps/web/build')
IDENTITY = json.loads((ROOT / 'reader-product.json').read_text()) if (ROOT / 'reader-product.json').exists() else None


class EditionHandler(SimpleHTTPRequestHandler):
    network_disabled = False

    def do_GET(self):
        if self.network_disabled:
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass  # The browser may already have canceled its offline request.
            self.connection.close()
            return
        super().do_GET()

    def translate_path(self, value):
        requested = unquote(urlsplit(value).path)
        prefix = IDENTITY['basePath'] + '/'
        if not requested.startswith(prefix):
            return str(ROOT / '__missing__')
        relative = requested[len(prefix):]
        if '..' in Path(relative).parts:
            return str(ROOT / '__missing__')
        target = ROOT / relative
        for candidate in (target, target / 'index.html', ROOT / (relative.rstrip('/') + '.html')):
            if candidate.is_file():
                return str(candidate)
        return str(ROOT / '404.html')

    def log_message(self, *args):
        pass


class ReaderEditionBrowser(unittest.TestCase):
    def lookup_selected_word(self, page, engine, evidence, offline):
        expect(page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        page.wait_for_function("document.querySelector('[data-reader-dictionary-attached]') !== null")
        page.evaluate("""() => {
          const root = document.querySelector('[data-reader-dictionary-attached]');
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const start = node.textContent.indexOf('猫');
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start); range.setEnd(node, start + 1);
            const selection = document.getSelection();
            selection.removeAllRanges(); selection.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            return;
          }
          throw new Error('Missing real book word');
        }""")
        page.get_by_role('button', name='Look up selected text', exact=True).click()
        popup = page.get_by_test_id('reader-dictionary-lookup')
        expect(popup).to_be_visible()
        self.assertEqual('horizontal-tb', popup.evaluate('node => getComputedStyle(node).writingMode'))
        expect(popup.locator('.full-dictionary .headword')).to_contain_text('猫', timeout=30000)
        expect(popup.locator('script, iframe')).to_have_count(0)
        geometry = popup.evaluate("""node => {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
            width:rect.width,style:{position:style.position,left:style.left,right:style.right,
              width:style.width,transform:style.transform,margin:style.margin},
            scrollX,innerWidth,html:getComputedStyle(document.documentElement).cssText,
            body:{width:document.body.getBoundingClientRect().width,writingMode:getComputedStyle(document.body).writingMode}};
        }""")
        self.assertGreaterEqual(geometry['left'], 7, str(geometry))
        self.assertGreaterEqual(geometry['top'], 7, str(geometry))
        self.assertLessEqual(geometry['bottom'], page.viewport_size['height'] - 7, str(geometry))
        self.assertLessEqual(geometry['right'], page.viewport_size['width'] - 7, str(geometry))
        page.screenshot(path=str(evidence / f'{engine}-chapter-lookup-{page.viewport_size["width"]}-{"offline" if offline else "online"}.png'))
        page.get_by_role('button', name='Close dictionary', exact=True).click()
        expect(popup).to_have_count(0)
        expect(page.get_by_role('button', name='Look up selected text', exact=True)).to_be_focused()

    def test_real_edition_keeps_books_offline_and_other_app_data_untouched(self):
        self.assertIsNotNone(IDENTITY, 'Build and postbuild the selected edition first.')
        server = ThreadingHTTPServer(('127.0.0.1', 0), EditionHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        base = origin + IDENTITY['basePath']
        namespace = IDENTITY['storageNamespace']
        evidence = Path(os.environ.get('READER_EDITION_EVIDENCE', 'test-results'))
        evidence.mkdir(parents=True, exist_ok=True)
        try:
            with sync_playwright() as playwright:
                for engine in ('chromium', 'webkit'):
                    with self.subTest(browser=engine), TemporaryDirectory(prefix='reader-edition-profile-') as profile:
                        context = getattr(playwright, engine).launch_persistent_context(
                            profile, **launch_options(engine, viewport={'width': 1200, 'height': 900}))
                        try:
                            page = context.pages[0]
                            page.set_default_timeout(25000)
                            errors = []
                            failed_requests = []
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            page.on('requestfailed', lambda request: failed_requests.append({
                                'url': request.url, 'failure': request.failure}))
                            page.goto(base + '/reader-product.json')
                            page.evaluate('''async namespace => {
                              localStorage.setItem('fontSize', '91');
                              localStorage.setItem('manabi-flashcards:sentinel', 'keep');
                              localStorage.setItem('manabi-reader-v1:sentinel', 'keep');
                              localStorage.setItem(namespace + ':manabi-reader-dictionary-setup-v1', 'skip');
                              const request = indexedDB.open('books', 1);
                              const db = await new Promise((resolve, reject) => {
                                request.onupgradeneeded = () => request.result.createObjectStore('sentinel');
                                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                              });
                              await new Promise((resolve, reject) => {
                                const tx = db.transaction('sentinel', 'readwrite');
                                tx.objectStore('sentinel').put('keep', 'old-development');
                                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
                              }); db.close();
                            }''', namespace)
                            page.goto(base + '/manage')
                            expect(page.get_by_role('heading', name=IDENTITY['name'], exact=True)).to_be_visible()
                            page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
                                'name': 'Edition acceptance.epub', 'mimeType': 'application/epub+zip',
                                'buffer': book('Edition acceptance', body='<p>猫と学校で日本語を読みます。</p>')})
                            read = page.get_by_role('button', name='Read Edition acceptance', exact=True)
                            expect(read).to_be_visible()
                            for width, height, scale in ((1200, 900, '100%'), (390, 780, '100%'), (320, 568, '200%')):
                                page.set_viewport_size({'width': width, 'height': height})
                                page.evaluate('value => document.documentElement.style.fontSize = value', scale)
                                page.wait_for_function('document.documentElement.scrollWidth <= innerWidth + 1')
                                page.evaluate('window.scrollTo(0, 0)')
                                heading = page.get_by_role('heading', name='Books', exact=True)
                                expect(heading).to_be_in_viewport()
                                toolbar = page.get_by_role('banner', name='Library toolbar', exact=True)
                                heading_box = heading.bounding_box()
                                toolbar_box = toolbar.bounding_box()
                                self.assertGreaterEqual(heading_box['y'], toolbar_box['y'] + toolbar_box['height'] - 1)
                                page.screenshot(path=str(evidence / f'{engine}-library-{width}.png'))
                                read.scroll_into_view_if_needed()
                                expect(read).to_be_in_viewport()
                            read.click()
                            expect(page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
                            page.goto(base + '/manage')
                            page.set_viewport_size({'width': 1200, 'height': 900})
                            page.evaluate('document.documentElement.style.fontSize = "100%"')
                            if IDENTITY['provider'] == 'manabitan':
                                # An authored three-entry archive exercises the
                                # actual external engine, storage and renderer.
                                # No dictionary result or worker is substituted.
                                field = page.get_by_role('searchbox', name='Search library', exact=True)
                                field.fill('neko')
                                page.get_by_role('group', name='Show', exact=True).get_by_role('button', name='Dictionary', exact=True).click()
                                expect(page.get_by_text('No enabled local dictionary yet.', exact=False)).to_be_visible(timeout=30000)
                                page.get_by_label('Import dictionary ZIP', exact=True).set_input_files({
                                    'name': 'edition-dictionary.zip', 'mimeType': 'application/zip',
                                    'buffer': dictionary_archive()})
                                expect(page.get_by_text('Installed Unified search fixture.', exact=True)).to_be_visible(timeout=60000)
                                expect(page.locator('.full-dictionary .headword')).to_contain_text('猫')
                                expect(page.locator('.full-dictionary script, .full-dictionary iframe')).to_have_count(0)
                                page.goto(base + '/manage')
                                read.click()
                                for lookup_width, lookup_height, lookup_scale in ((1200, 900, '100%'), (390, 780, '100%'), (320, 568, '200%')):
                                    page.set_viewport_size({'width': lookup_width, 'height': lookup_height})
                                    page.evaluate('value => document.documentElement.style.fontSize = value', lookup_scale)
                                    self.lookup_selected_word(page, engine, evidence, offline=False)
                                page.set_viewport_size({'width': 1200, 'height': 900})
                                page.evaluate('document.documentElement.style.fontSize = "100%"')
                                page.goto(base + '/manage')
                            page.evaluate('''() => Promise.race([
                              navigator.serviceWorker.ready,
                              new Promise((_, reject) => setTimeout(() => reject(new Error('Offline shell did not activate')), 30000))
                            ]).then(() => true)''')
                            # First installation deliberately does not claim the
                            # existing page. A fresh online navigation admits it
                            # under the completed worker before testing offline.
                            page.reload()
                            page.wait_for_function('navigator.serviceWorker.controller !== null')
                            # WebKit's automation offline toggle can abort a
                            # worker-served navigation internally. Disconnect
                            # the actual task-owned server in both engines;
                            # Chromium also exercises navigator's offline state.
                            EditionHandler.network_disabled = True
                            if engine == 'chromium':
                                context.set_offline(True)
                            page.reload()
                            expect(read).to_be_visible()
                            read.click()
                            expect(page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
                            if IDENTITY['provider'] == 'manabitan':
                                self.lookup_selected_word(page, engine, evidence, offline=True)
                                page.goto(base + '/manage')
                                page.get_by_role('searchbox', name='Search library', exact=True).fill('neko')
                                page.get_by_role('group', name='Show', exact=True).get_by_role('button', name='Dictionary', exact=True).click()
                                expect(page.locator('.full-dictionary .headword')).to_contain_text('猫', timeout=30000)
                            saved = page.evaluate('''async () => {
                              const request = indexedDB.open('books');
                              const db = await new Promise(resolve => request.onsuccess = () => resolve(request.result));
                              const value = await new Promise(resolve => {
                                const get = db.transaction('sentinel').objectStore('sentinel').get('old-development');
                                get.onsuccess = () => resolve(get.result);
                              }); db.close();
                              return [value, localStorage.getItem('fontSize'),
                                localStorage.getItem('manabi-flashcards:sentinel'),
                                localStorage.getItem('manabi-reader-v1:sentinel')];
                            }''')
                            self.assertEqual(['keep', '91', 'keep', 'keep'], saved)
                            self.assertEqual([], errors)
                        except Exception as error:
                            error.add_note(json.dumps({'pageErrors': errors, 'failedRequests': failed_requests}))
                            raise
                        finally:
                            EditionHandler.network_disabled = False
                            context.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main(verbosity=2)
