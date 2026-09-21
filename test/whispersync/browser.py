"""Run isolated real-browser core tests, not the complete Svelte application.

Prepare with: node test/whispersync/run.mjs --browser-bundle=/tmp/ws-browser/bundle.js
Then: python test/whispersync/browser.py /tmp/ws-browser/bundle.js [--browser chromium]
Requires Python Playwright and a browser. Uses only a temporary loopback HTTP server.
"""
from __future__ import annotations
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('bundle', type=Path)
parser.add_argument('--browser', choices=('chromium', 'firefox', 'webkit'), default='chromium')
parser.add_argument('--executable', default=None, help='Browser executable path (engine-specific)')
parser.add_argument('--autoplay-policy', choices=('normal', 'allow'), default='normal',
                    help='Use normal browser autoplay policy, or allow media playback without a gesture')
parser.add_argument('--offline-dom', action='store_true', help='Use about:blank, with no HTTP navigation; skips origin-dependent IndexedDB tests')
args = parser.parse_args()
bundle = args.bundle.read_bytes()
tests = Path(__file__).with_name('browser-tests.js').read_bytes()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        content = {'/bundle.js': bundle, '/tests.js': tests}.get(self.path)
        if content is None:
            content = b'<!doctype html><title>Whispersync browser tests</title><script src="/bundle.js"></script><script src="/tests.js"></script>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/javascript; charset=utf-8' if self.path.endswith('.js') else 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(content)
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as p:
        options = {'headless': True}
        if args.executable:
            options['executable_path'] = args.executable
        if args.browser == 'chromium' and args.autoplay_policy == 'allow':
            options['args'] = ['--autoplay-policy=no-user-gesture-required']
        browser = getattr(p, args.browser).launch(**options)
        page = browser.new_page()
        if args.offline_dom:
            page.set_content('<!doctype html><title>Offline DOM tests</title><body></body>')
            page.add_script_tag(content=bundle.decode())
            page.add_script_tag(content=tests.decode())
        else:
            page.goto(f'http://127.0.0.1:{server.server_port}')
        results = page.evaluate('(skipStorage) => window.runWhispersyncBrowserTests({ skipStorage })', args.offline_dom)
        executed = [r for r in results if not r.get('skipped')]
        report = {'engine': args.browser, 'browser': browser.version, 'autoplay_policy': args.autoplay_policy,
                  'passed': sum(r['passed'] for r in executed), 'total': len(executed),
                  'registered': len(results), 'skipped': len(results) - len(executed),
                  'mode': 'offline DOM (no origin storage)' if args.offline_dom else 'loopback origin',
                  'tests': results}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        browser.close()
        if report['passed'] != report['total']:
            raise SystemExit(1)
finally:
    server.shutdown()
    server.server_close()
