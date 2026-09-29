#!/usr/bin/env python3
"""Run shared identity/intent handoff scenarios against real Chromium IndexedDB.

Production queue/sync/store and native Web Locks are used; recognition and transport are scripted.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HTML = '''<!doctype html><meta charset="utf-8"><title>Identity handoff</title>
<script type="module">
import {cases} from '/tests/media/identity-handoff-cases.mjs';
import {cases as syncCases} from '/tests/media/sync-write-authority-cases.mjs';
window.scenarios=[...cases,...syncCases];
</script>'''


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path != '/__identity_handoff__/':
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
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/identity-handoff-browser')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox'])
            try:
                page = browser.new_page()
                page.set_default_timeout(30000)
                page.goto(f'http://127.0.0.1:{server.server_port}/__identity_handoff__/')
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
                browser.close()
    finally:
        (args.output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        server.shutdown()
        server.server_close()
    if not results or not all(result['passed'] for result in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
