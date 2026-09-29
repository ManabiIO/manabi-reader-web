#!/usr/bin/env python3
"""App-independent native FSA/IndexedDB probe in normal and private profiles.

No MediaStore, workspace, transaction double, model or app module is imported.
Both profiles are hard gates: an Incognito crash is recorded and still fails.
Persistent mode additionally verifies the handle after a whole-browser restart.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright

SCRIPT = r'''async ({stage, name}) => {
    const phase = value => console.info('native-handle-probe: ' + value);
    const request = value => new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error);
        value.onblocked = () => reject(Error('Unexpected blocked probe database'));
    });
    const completed = tx => new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error ?? Error('Probe transaction aborted'));
    });
    phase('get-directory');
    const root = await navigator.storage.getDirectory();
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('aliases');
    const db = await request(opening);
    try {
        const bytes = 'native handle roundtrip';
        if (stage === 'write') {
            phase('create-file');
            const handle = await root.getFileHandle(name, {create: true});
            const writer = await handle.createWritable();
            await writer.write(bytes);
            await writer.close();
            const tx = db.transaction('aliases', 'readwrite'), done = completed(tx);
            tx.objectStore('aliases').put({key: name, name, handle}, 'saved');
            await done;
            phase('write-committed');
            return {written: true};
        }
        phase('read-admitted');
        const tx = db.transaction('aliases', 'readonly'), done = completed(tx);
        const read = tx.objectStore('aliases').get('saved');
        let row;
        read.onsuccess = () => { phase('read-callback'); row = read.result; };
        await done;
        const expected = await root.getFileHandle(name);
        if (!row?.handle || !(await row.handle.isSameEntry(expected)))
            throw Error('Native handle identity was not preserved');
        if (await (await row.handle.getFile()).text() !== bytes)
            throw Error('Native handle bytes changed');
        // Independently exercise the read/write callback used by alias refresh.
        phase('rewrite-admitted');
        const update = db.transaction('aliases', 'readwrite'), updated = completed(update);
        const old = update.objectStore('aliases').get('saved');
        old.onsuccess = () => {
            phase('rewrite-callback');
            update.objectStore('aliases').put({...old.result, name: 'renamed'}, 'saved');
        };
        await updated;
        phase('verified');
        return {read: true, sameEntry: true, sameBytes: true, rewritten: true};
    } finally {
        db.close();
    }
}'''


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'<!doctype html><meta charset="utf-8"><title>Native handle probe</title>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def probe(pw, url, mode, report=lambda _result: None):
    result = {'profileMode': mode, 'passed': False, 'events': []}
    events = result['events']

    def record_event(event):
        events.append(event)
        report(result)

    report(result)
    options = dict(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                   headless=True, args=['--no-sandbox'])
    with tempfile.TemporaryDirectory(prefix='native-handle-profile-') as profile:
        browser = context = None

        def launch():
            nonlocal browser, context
            if mode == 'persistent':
                context = pw.chromium.launch_persistent_context(profile, **options)
                browser = context.browser
            else:
                browser = pw.chromium.launch(**options)
                context = browser.new_context()
            result['browserVersion'] = browser.version
            browser.on('disconnected', lambda: record_event({'event': 'browser-disconnected'}))
            page = context.new_page()
            page.on('console', lambda m: record_event({'event': 'console', 'text': m.text}))
            page.on('crash', lambda: record_event({'event': 'page-crash'}))
            page.on('pageerror', lambda e: record_event({'event': 'page-error', 'text': str(e)}))
            page.goto(url, timeout=30000)
            return page

        def close():
            nonlocal browser, context
            try:
                if context:
                    context.close()
            finally:
                if browser:
                    browser.close()
                context = browser = None

        try:
            page = launch()
            name = 'native-profile-roundtrip'
            result['write'] = page.evaluate(SCRIPT, {'stage': 'write', 'name': name})
            result['read'] = page.evaluate(SCRIPT, {'stage': 'read', 'name': name})
            page.reload()
            result['reload'] = page.evaluate(SCRIPT, {'stage': 'read', 'name': name})
            if mode == 'persistent':
                record_event({'event': 'intentional-browser-restart'})
                close()
                page = launch()
                result['restart'] = page.evaluate(SCRIPT, {'stage': 'read', 'name': name})
            result['passed'] = True
        except Exception as error:
            result['error'] = str(error)
        finally:
            try:
                close()
            except Exception as error:
                result['passed'] = False
                result['cleanupError'] = str(error)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profile-mode', choices=('both', 'persistent', 'incognito'), default='both')
    args = parser.parse_args()
    modes = ('persistent', 'incognito') if args.profile_mode == 'both' else (args.profile_mode,)
    args.output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as pw:
            for mode in modes:
                result = probe(
                    pw, f'http://127.0.0.1:{server.server_port}/', mode,
                    lambda partial: (args.output / 'results.json').write_text(
                        json.dumps([*results, partial], indent=2)))
                results.append(result)
                (args.output / 'results.json').write_text(json.dumps(results, indent=2))
                print('PASS' if result['passed'] else 'FAIL', mode, result.get('error', ''), flush=True)
    finally:
        server.shutdown()
        server.server_close()
    if len(results) != len(modes) or not all(result['passed'] for result in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
