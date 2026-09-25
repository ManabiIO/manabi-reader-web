"""Compiled Reader offline acceptance with a durable profile and a stopped origin."""
import argparse
import hashlib
import io
import json
import re
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect
from test_static_reader import ThreadingHTTPServer, StaticHandler, ROOT, TITLE, epub

OPTIONS = None
SCOPE = '/Reader-Web/'


class OfflineStaticHandler(StaticHandler):
    def end_headers(self):
        # A browser restart must not be rescued by its ordinary HTTP cache.
        # Explicit Cache Storage writes by the real service worker remain allowed.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def decoded_local_image(page):
    return page.locator('.book-content #safe-image').evaluate('''async image => {
      const url = image.currentSrc || image.src;
      if (!url.startsWith('blob:')) throw new Error('Expected an imported local image');
      await image.decode();
      const bytes = await (await fetch(url)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return {
        width: image.naturalWidth, height: image.naturalHeight,
        sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
      };
    }''')


class OfflineReader(unittest.TestCase):
    def test_import_then_restart_browser_without_origin_or_pwa_install(self):
        self.run_offline_case(import_book=True)

    def test_manifest_launch_without_a_recent_book_reopens_library_offline(self):
        self.run_offline_case(import_book=False)

    def test_aborted_import_rolls_back_and_a_retry_survives_offline_restart(self):
        self.run_offline_case(import_book=True, abort_once=True)

    def run_offline_case(self, *, import_book, abort_once=False):
        self.assertTrue((ROOT / 'service-worker.js').is_file(), 'Build the actual Reader first')
        manifest = json.loads((ROOT / 'manifest.webmanifest').read_text())
        server = ThreadingHTTPServer(('127.0.0.1', 0), OfflineStaticHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = 'http://127.0.0.1:' + str(server.server_port)
        launch_url = urljoin(origin + SCOPE + 'manifest.webmanifest', manifest['start_url'])
        self.assertTrue(launch_url.startswith(origin + SCOPE))
        book_bytes = epub() if import_book else None
        expected_image = None
        decoded_image = None
        if book_bytes:
            with zipfile.ZipFile(io.BytesIO(book_bytes)) as archive:
                expected_image = {
                    'width': 1, 'height': 1,
                    'sha256': hashlib.sha256(archive.read('絵.png')).hexdigest()
                }
        errors = []
        console = []
        failed_requests = []
        stage = 'initial navigation'
        context = None
        page = None
        # browser.new_context() is deliberately non-persistent. WebKit's private
        # storage can reject image Blobs even when plain-text IndexedDB works.
        # Durable offline qualification needs a real profile, including restart.
        with tempfile.TemporaryDirectory(prefix='reader-offline-profile-') as profile:
            with sync_playwright() as playwright:
                engine = getattr(playwright, OPTIONS.browser)

                def observe(document):
                    document.on('pageerror', lambda error: errors.append({
                        'message': str(error), 'stack': getattr(error, 'stack', None)
                    }))
                    document.on('console', lambda message: console.append({
                        'type': message.type, 'text': message.text
                    }))
                    document.on('requestfailed', lambda request: failed_requests.append({
                        'url': request.url, 'failure': request.failure
                    }))

                try:
                    context = engine.launch_persistent_context(profile)
                    if abort_once:
                        # Fault injection at the real native IndexedDB request,
                        # not a replacement database or mocked network response.
                        context.add_init_script("""(() => {
                          const add = IDBObjectStore.prototype.add;
                          IDBObjectStore.prototype.add = function(...args) {
                            const request = add.apply(this, args);
                            if (this.name === 'data' && args[0]?.title === 'Reader browser acceptance') {
                              IDBObjectStore.prototype.add = add;
                              window.__readerAbortedDatabase = this.transaction.db;
                              window.__readerAbortedWrites = 1;
                              this.transaction.abort();
                            }
                            return request;
                          };
                        })();""")
                    page = context.pages[0] if context.pages else context.new_page()
                    observe(page)
                    initial = page.goto(origin + SCOPE + 'manage')
                    self.assertEqual(initial.headers.get('cache-control'), 'no-store')
                    expect(page.locator('input[type=file][webkitdirectory]')).to_be_attached()
                    reader_url = None
                    if import_book:
                        stage = 'EPUB import'
                        page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
                            'name': 'offline.epub', 'mimeType': 'application/epub+zip', 'buffer': book_bytes
                        })
                        if abort_once:
                            stage = 'failed import rollback and retry'
                            expect(page.get_by_text('Bookimport failed', exact=True)).to_be_visible(timeout=15000)
                            expect(page.get_by_text(re.compile(
                                r'The book could not be saved because its local storage transaction was aborted'
                            ))).to_be_visible()
                            self.assertEqual(page.evaluate('window.__readerAbortedWrites'), 1)
                            self.assertEqual(page.evaluate("""() => new Promise((resolve, reject) => {
                              const tx = window.__readerAbortedDatabase.transaction('data');
                              const count = tx.objectStore('data').count();
                              count.onerror = () => reject(count.error);
                              tx.onabort = () => reject(tx.error);
                              tx.oncomplete = () => resolve(count.result);
                            })"""), 0)
                            self.assertEqual(errors, [])
                            expect(page.get_by_role('button', name='Read ' + TITLE, exact=True)).to_have_count(0)
                            page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).first.click()
                            page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
                                'name': 'offline.epub', 'mimeType': 'application/epub+zip', 'buffer': book_bytes
                            })
                        page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
                        expect(page.locator('.book-content')).to_be_visible(timeout=30000)
                        reader_url = page.url
                        stage = 'online image decoding'
                        self.assertEqual(decoded_local_image(page), expected_image)
                    stage = 'automatic preparation'
                    page.evaluate('''async scope => {
                      const deadline = Date.now() + 15000;
                      while (Date.now() < deadline) {
                        const r = await navigator.serviceWorker.getRegistration(scope);
                        if (r?.active?.state === 'activated') return;
                        await new Promise(resolve => setTimeout(resolve, 25));
                      }
                      throw new Error('Automatic Reader worker activation timed out');
                    }''', SCOPE)
                    # Viewing Settings must not be what installs the shell.
                    page.goto(origin + SCOPE + 'settings#library')
                    expect(page.get_by_text('App ready for offline reopening', exact=True)).to_be_visible(timeout=15000)
                    cache_urls = page.evaluate('''async () => {
                      const names = await caches.keys();
                      return (await Promise.all(names.map(async name =>
                        (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
                    }''')
                    self.assertFalse(any('/api/' in url or '/accounts/' in url for url in cache_urls))
                    # A complete shell must include the actual manifest launch
                    # URL, not only deep links to Library and individual books.
                    self.assertIn(launch_url, cache_urls)
                    stage = 'browser shutdown'
                    context.close()
                    context = None
                    server.shutdown()
                    server.server_close()
                    thread.join()
                    server = None
                    stage = 'offline manifest launch after browser restart'
                    # Neither set_offline(), request interception, nor a live
                    # old browser process may supply the offline content.
                    context = engine.launch_persistent_context(profile)
                    page = context.pages[0] if context.pages else context.new_page()
                    observe(page)
                    response = page.goto(launch_url, wait_until='commit')
                    self.assertTrue(response.from_service_worker)
                    if import_book:
                        expect(page.locator('.book-content')).to_be_visible(timeout=30000)
                        self.assertEqual(page.url, reader_url)
                        fixture_ruby = page.locator('.book-content ruby').filter(
                            has_text=re.compile(r'^本ほん$')
                        )
                        expect(fixture_ruby).to_have_count(1)
                        expect(fixture_ruby.locator('rt')).to_have_text('ほん')
                        # The same image-bearing EPUB that exposed the WebKit
                        # failure must still contain its real local image.
                        decoded_image = decoded_local_image(page)
                        self.assertEqual(decoded_image, expected_image)
                    else:
                        expect(page).to_have_url(origin + SCOPE + 'manage')
                        expect(page.locator('input[type=file][webkitdirectory]')).to_be_attached()
                    stage = 'offline library and settings'
                    response = page.goto(origin + SCOPE + 'manage')
                    self.assertTrue(response.from_service_worker)
                    if import_book:
                        expect(page.get_by_role('button', name='Read ' + TITLE, exact=True)).to_be_visible()
                    page.goto(origin + SCOPE + 'settings#library')
                    expect(page.get_by_text('App ready for offline reopening', exact=True)).to_be_visible(timeout=15000)
                    self.assertEqual(errors, [])
                    stage = 'complete'
                finally:
                    variant = 'recovered-import' if abort_once else ('book' if import_book else 'empty-library')
                    diagnostics = Path('test-results') / ('offline-' + OPTIONS.browser) / variant
                    diagnostics.mkdir(parents=True, exist_ok=True)
                    report = {
                        'stage': stage, 'url': page.url if page else None, 'page_errors': errors,
                        'console': console[-80:], 'failed_requests': failed_requests[-80:],
                        'decoded_local_image': decoded_image
                    }
                    try:
                        if page and not page.is_closed():
                            report['visible_text'] = page.locator('body').inner_text(timeout=3000)
                            (diagnostics / 'page.html').write_text(page.content())
                            page.screenshot(path=str(diagnostics / 'page.png'), full_page=True, timeout=5000)
                    except Exception as error:
                        report['diagnostics_error'] = str(error)
                    finally:
                        (diagnostics / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
                        if stage != 'complete':
                            print('OFFLINE FAILURE DIAGNOSTICS: ' + json.dumps(report, ensure_ascii=False), flush=True)
                        try:
                            if context:
                                context.close()
                        finally:
                            if server:
                                server.shutdown()
                                server.server_close()
                                thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chromium', 'webkit', 'firefox'], default='chromium')
    OPTIONS, args = parser.parse_known_args()
    unittest.main(argv=[__file__, *args])
