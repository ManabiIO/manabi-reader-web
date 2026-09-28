"""Native IndexedDB historical upgrade matrix, using the production factory.

The standalone fixture is not a substitute Reader application. The existing
compiled-app suite separately qualifies service workers and offline EPUBs.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OPTIONS = None


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class BooksSchemaUpgrade(unittest.TestCase):
    def test_historical_upgrades_preserve_records_and_rollback_on_failure(self):
        fixture = ROOT / 'test-results/books-schema/fixture.js'
        self.assertTrue(fixture.is_file(), 'Run node test/reader/build-schema-fixture.mjs first')
        results = []
        with tempfile.TemporaryDirectory() as directory:
            serving = Path(directory)
            (serving / 'index.html').write_text('<!doctype html><title>Database upgrade fixture</title><script src="/fixture.js"></script>')
            (serving / 'fixture.js').write_bytes(fixture.read_bytes())
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with sync_playwright() as playwright, tempfile.TemporaryDirectory() as profile:
                    context = getattr(playwright, OPTIONS.browser).launch_persistent_context(profile)
                    try:
                        page = context.pages[0]
                        errors = []
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.goto(f'http://127.0.0.1:{server.server_port}/')
                        names = page.evaluate('BooksSchemaCases.caseNames')
                        for name in names:
                            with self.subTest(case=name):
                                outcome = page.evaluate('''async name => {
                                  let timer;
                                  try {
                                    return await Promise.race([
                                      BooksSchemaCases.runCase(name),
                                      new Promise((_, reject) => {
                                        timer = setTimeout(() => reject(new Error('Upgrade case timed out')), 10000);
                                      })
                                    ]);
                                  } catch (error) {
                                    return {name, state: 'failed', message: String(error), stack: error.stack};
                                  } finally { clearTimeout(timer); }
                                }''', name)
                                results.append(outcome)
                                self.assertEqual(outcome['state'], 'passed', outcome)
                        # Permit unhandled-rejection/page-error delivery before the final assertion.
                        page.evaluate('() => new Promise(resolve => setTimeout(resolve, 0))')
                        self.assertEqual(errors, [])
                    finally:
                        context.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
                output = ROOT / 'test-results/books-schema' / (OPTIONS.browser + '.json')
                output.write_text(json.dumps({'browser': OPTIONS.browser, 'cases': results}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    OPTIONS, args = parser.parse_known_args()
    unittest.main(argv=[__file__, *args], verbosity=2)
