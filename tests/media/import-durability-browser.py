#!/usr/bin/env python3
"""Run production import operations with native Chromium IndexedDB.

The workspace UI shell is replaced, not its import/storage methods. No ASR runs.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HTML = '''<!doctype html><meta charset="utf-8"><title>Import durability</title>
<script type="module">
import {cases, nativeCases} from '/tests/media/import-durability-cases.mjs';
window.scenarios=[...cases, ...nativeCases];
</script>'''


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path != '/__import_durability__/':
            return super().do_GET()
        body = HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/import-durability-browser')
    parser.add_argument('--profile-mode', choices=('incognito', 'persistent'), default='incognito')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    diagnostics = []
    metadata = {'profileMode': args.profile_mode}
    try:
        with tempfile.TemporaryDirectory(prefix='media-import-profile-') as profile, sync_playwright() as pw:
            options = dict(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                           headless=True, args=['--no-sandbox'])
            if args.profile_mode == 'persistent':
                context = pw.chromium.launch_persistent_context(profile, **options)
                browser = context.browser
            else:
                browser = pw.chromium.launch(**options)
                context = browser.new_context()
            metadata['browserVersion'] = browser.version
            try:
                page = context.new_page()
                page.on('console', lambda message: diagnostics.append(
                    {'event': 'console', 'text': message.text}))
                page.on('crash', lambda: diagnostics.append({'event': 'page-crash'}))
                page.on('pageerror', lambda error: diagnostics.append(
                    {'event': 'page-error', 'text': str(error)}))
                browser.on('disconnected', lambda: diagnostics.append({'event': 'browser-disconnected'}))
                page.set_default_timeout(30000)
                page.goto(f'http://127.0.0.1:{server.server_port}/__import_durability__/')
                page.wait_for_function('Array.isArray(window.scenarios)')
                names = page.evaluate('scenarios.map(scenario => scenario.name)')
                for index, name in enumerate(names):
                    try:
                        # evaluate awaits the scenario. Its own bounded reads and
                        # workflow deadline are not mistaken for synchronous polling.
                        value = page.evaluate('(index) => scenarios[index].run(indexedDB)', index)
                        results.append({'name': name, 'passed': True, 'evidence': value})
                        print('PASS', name, flush=True)
                    except Exception as error:
                        results.append({'name': name, 'passed': False, 'error': str(error)})
                        print('FAIL', name, str(error), flush=True)
                        raise
            finally:
                try:
                    context.close()
                finally:
                    browser.close()
    finally:
        (args.output / 'metadata.json').write_text(json.dumps(metadata, indent=2))
        (args.output / 'diagnostics.json').write_text(json.dumps(diagnostics, indent=2))
        (args.output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        server.shutdown()
        server.server_close()
    if not results or not all(result['passed'] for result in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
