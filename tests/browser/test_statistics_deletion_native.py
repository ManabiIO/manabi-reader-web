"""Real IndexedDB qualification of the production statistics deletion method."""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'test-results/statistics-deletion'


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], required=True)
    args = parser.parse_args()
    if not (FIXTURE / 'fixture.js').is_file():
        raise RuntimeError('Build the statistics-deletion fixture first')
    (FIXTURE / 'index.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>Statistics deletion qualification</title>'
        '<script src="fixture.js"></script>', encoding='utf-8')
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(FIXTURE)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    evidence = {'engine': args.browser, 'timezone': 'Pacific/Apia', 'errors': [], 'console': []}
    try:
        with sync_playwright() as playwright:
            browser = getattr(playwright, args.browser).launch()
            try:
                context = browser.new_context(timezone_id='Pacific/Apia')
                page = context.new_page()
                page.on('pageerror', lambda error: evidence['errors'].append(error.stack or str(error)))
                page.on('console', lambda message: evidence['console'].append(message.text))
                page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                page.evaluate('''() => {
                    window.fixtureResult = null;
                    StatisticsDeletionCases.run().then(
                        result => { window.fixtureResult = result },
                        error => { window.fixtureResult = { fatal: error.stack || String(error) } }
                    );
                }''')
                page.wait_for_function('window.fixtureResult !== null', timeout=60000)
                evidence['result'] = page.evaluate('window.fixtureResult')
                evidence['sources'] = page.evaluate('StatisticsDeletionCases.provenance')
                # A separate browser task lets unhandled rejection events surface.
                page.evaluate('() => new Promise(resolve => setTimeout(resolve, 0))')
                result = evidence['result']
                assert not result.get('fatal'), result
                assert result.get('passed') == 14 and result.get('failed') == 0, result
                assert not evidence['errors'], evidence['errors']
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        (FIXTURE / f'{args.browser}.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
        print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
