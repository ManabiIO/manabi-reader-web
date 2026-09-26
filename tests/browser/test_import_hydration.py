"""Keep a ZIP selected before the actual static importer has hydrated.

The HTTP server holds application JavaScript, not the DOM or file input. No
Playwright routing, substitute importer, or synthetic change event is used.
"""
import os
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler, ThreadingHTTPServer


class DelayedScripts(StaticHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if '/_app/' in path and path.endswith('.js'):
            self.server.script_requested.set()
            if not self.server.release_scripts.wait(15):
                self.send_error(503, 'Test did not release hydration scripts')
                return
        super().do_GET()


class ImportHydrationBrowser(unittest.TestCase):
    def test_file_selected_before_hydration_is_consumed_once_and_reports_errors(self):
        engine = os.environ.get('LIBRARY_BROWSER', 'chromium')
        server = ThreadingHTTPServer(('127.0.0.1', 0), DelayedScripts)
        server.release_scripts = threading.Event()
        server.script_requested = threading.Event()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        errors = []
        try:
            with tempfile.TemporaryDirectory() as profile, sync_playwright() as playwright:
                context = getattr(playwright, engine).launch_persistent_context(profile)
                page = context.pages[0]
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    page.goto(f'http://127.0.0.1:{server.server_port}/reader-web/import-ttu', wait_until='commit')
                    chooser = page.get_by_label('Choose Ttu export ZIPs', exact=True)
                    expect(chooser).to_be_attached()
                    self.assertTrue(server.script_requested.wait(5), 'No app script reached the gate')
                    chooser.set_input_files({
                        'name': 'before-hydration.zip', 'mimeType': 'application/zip',
                        'buffer': b'deliberately invalid ZIP, selected before app startup'
                    })
                    self.assertEqual(chooser.evaluate('input => input.files.length'), 1)
                    server.release_scripts.set()
                    # A handled bad input must produce the normal inspection error.
                    # Silent disappearance is not acceptance, and a generic app boot
                    # assertion would miss the lost change event entirely.
                    status = page.get_by_role('status').filter(has_text='before-hydration.zip:')
                    expect(status).to_be_visible(timeout=15000)
                    self.assertEqual(status.inner_text().count('before-hydration.zip:'), 1)
                    self.assertEqual(chooser.evaluate('input => input.files.length'), 0)
                    expect(chooser).to_be_enabled()
                    # The picker remains usable after the recovered selection fails.
                    chooser.set_input_files({
                        'name': 'retry.zip', 'mimeType': 'application/zip', 'buffer': b'also invalid'
                    })
                    expect(page.get_by_role('status').filter(has_text='retry.zip:')).to_be_visible()
                    expect(page.get_by_role('status').filter(has_text='before-hydration.zip:')).to_have_count(0)
                    self.assertEqual(errors, [])
                finally:
                    server.release_scripts.set()
                    output = Path('test-results')
                    output.mkdir(exist_ok=True)
                    if not page.is_closed():
                        (output / (engine + '-import-hydration.html')).write_text(page.content())
                        page.screenshot(path=str(output / (engine + '-import-hydration.png')), full_page=True)
                    context.close()
        finally:
            server.release_scripts.set()
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main(verbosity=2)
