"""Automatic offline acceptance against the actual compiled Reader, with origin stopped."""
import argparse
import re
from pathlib import Path
import threading
import unittest
from playwright.sync_api import sync_playwright, expect
from test_static_reader import ThreadingHTTPServer, StaticHandler, ROOT, TITLE, epub

OPTIONS = None


class OfflineReader(unittest.TestCase):
    def test_import_then_reopen_without_origin_or_pwa_install(self):
        self.assertTrue((ROOT / 'service-worker.js').is_file(), 'Build the actual Reader first')
        server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = 'http://127.0.0.1:' + str(server.server_port)
        errors = []
        with sync_playwright() as playwright:
            browser = getattr(playwright, OPTIONS.browser).launch()
            context = browser.new_context()
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                page.goto(origin + '/Reader-Web/manage')
                expect(page.locator('input[type=file][webkitdirectory]')).to_be_attached()
                page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
                    'name': 'offline.epub', 'mimeType': 'application/epub+zip', 'buffer': epub()
                })
                page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
                expect(page.locator('.book-content')).to_be_visible(timeout=30000)
                reader_url = page.url
                page.evaluate('''async () => {
                  const deadline = Date.now() + 15000;
                  while (Date.now() < deadline) {
                    const r = await navigator.serviceWorker.getRegistration('/Reader-Web/');
                    if (r?.active?.state === 'activated') return;
                    await new Promise(resolve => setTimeout(resolve, 25));
                  }
                  throw new Error('Automatic Reader worker activation timed out');
                }''')
                # Visit status only AFTER automatic preparation and a real book import.
                # Viewing Settings must not be what installs the offline shell.
                page.goto(origin + '/Reader-Web/settings#library')
                expect(page.get_by_text('App ready for offline reopening', exact=True)).to_be_visible(timeout=15000)
                cache_urls = page.evaluate('''async () => {
                  const names = await caches.keys();
                  return (await Promise.all(names.map(async name =>
                    (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
                }''')
                self.assertFalse(any('/api/' in url or '/accounts/' in url for url in cache_urls))
                server.shutdown()
                server.server_close()
                thread.join()
                server = None
                # No set_offline(), network routing mocks, or still-open document.
                # A new navigation must load the app and local EPUB without HTTP.
                page.close()
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                response = page.goto(reader_url)
                self.assertTrue(response.from_service_worker)
                expect(page.locator('.book-content')).to_be_visible(timeout=30000)
                # Match the imported fixture's ruby, not whichever runtime
                # measurement/annotation node happens to precede it.
                fixture_ruby = page.locator('.book-content ruby').filter(
                    has_text=re.compile(r'^本ほん$')
                )
                expect(fixture_ruby).to_have_count(1)
                expect(fixture_ruby.locator('rt')).to_have_text('ほん')
                response = page.goto(origin + '/Reader-Web/manage')
                self.assertTrue(response.from_service_worker)
                expect(page.get_by_role('button', name='Read ' + TITLE, exact=True)).to_be_visible()
                page.goto(origin + '/Reader-Web/settings#library')
                expect(page.get_by_text('App ready for offline reopening', exact=True)).to_be_visible(timeout=15000)
                self.assertEqual(errors, [])
            finally:
                diagnostics = Path('test-results') / ('offline-' + OPTIONS.browser)
                diagnostics.mkdir(parents=True, exist_ok=True)
                try:
                    if not page.is_closed():
                        (diagnostics / 'page.html').write_text(page.content())
                        page.screenshot(path=str(diagnostics / 'page.png'), full_page=True)
                finally:
                    context.close()
                    browser.close()
                    if server:
                        server.shutdown()
                        server.server_close()
                        thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chromium', 'webkit', 'firefox'], default='chromium')
    OPTIONS, args = parser.parse_known_args()
    unittest.main(argv=[__file__, *args])
