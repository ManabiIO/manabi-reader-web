"""Run isolated browser tests, not the complete Svelte application.

Prepare with: node test/whispersync/run.mjs --browser-bundle=/tmp/ws-browser/bundle.js
Then: python test/whispersync/browser.py /tmp/ws-browser/bundle.js
"""
from __future__ import annotations
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def make_handler(bundle: bytes, tests: bytes):
    html = b'<!doctype html><meta charset="utf-8"><title>Whispersync browser tests</title><script src="/bundle.js"></script><script src="/tests.js"></script>'
    resources = {
        '/': (html, 'text/html; charset=utf-8'),
        '/bundle.js': (bundle, 'text/javascript; charset=utf-8'),
        '/tests.js': (tests, 'text/javascript; charset=utf-8'),
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            resource = resources.get(self.path)
            if resource is None:
                self.send_error(404)
                return
            content, content_type = resource
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *_args):
            pass

    return Handler


def main():
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser()
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--chromium', default=None)
    parser.add_argument('--offline-dom', action='store_true', help='No HTTP navigation; skips origin-dependent IndexedDB tests')
    args = parser.parse_args()
    bundle = args.bundle.read_bytes()
    tests = Path(__file__).with_name('browser-tests.js').read_bytes()
    server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(bundle, tests))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            # This harness tests media mechanics, not user-gesture permission.
            options = {'headless': True, 'args': ['--autoplay-policy=no-user-gesture-required']}
            if args.chromium:
                options['executable_path'] = args.chromium
            browser = p.chromium.launch(**options)
            try:
                page = browser.new_page()
                if args.offline_dom:
                    page.set_content('<!doctype html><meta charset="utf-8"><title>Offline DOM tests</title><body></body>')
                    page.add_script_tag(content=bundle.decode('utf-8'))
                    page.add_script_tag(content=tests.decode('utf-8'))
                else:
                    page.goto(f'http://127.0.0.1:{server.server_port}')
                assert page.evaluate('document.characterSet') == 'UTF-8', 'The test transport must preserve Japanese fixture text'
                results = page.evaluate('(skipStorage) => window.runWhispersyncBrowserTests({ skipStorage })', args.offline_dom)
                report = {'browser': browser.version, 'passed': sum(r['passed'] for r in results), 'total': len(results), 'skipped': 3 if args.offline_dom else 0, 'mode': 'offline DOM (no origin storage)' if args.offline_dom else 'loopback origin', 'tests': results}
                print(json.dumps(report, ensure_ascii=False, indent=2))
                return int(report['passed'] != report['total'])
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    raise SystemExit(main())
