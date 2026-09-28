#!/usr/bin/env python3
"""Qualify real encoded video, production decoding/queue, and committed MOSS.

The local range endpoint is synthetic, not a connected cloud-provider acceptance
claim. Failures retain checkpoints and diagnostics; no failed case becomes a skip.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright
from asr import distance, normalize, valid_cer
from browser_poll import wait_for_async
from encoded_asr_fixture import build_fixture

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT = '/api/reader-web/connections/11111111-1111-4111-8111-111111111111/media/'
HTML = b'''<!doctype html><meta charset="utf-8"><title>Encoded MOSS qualification</title>
<script type="module" src="/tests/media/encoded-asr-harness.mjs"></script>'''


def byte_range(header, size):
    match = re.fullmatch(r'bytes=(\d+)-(\d+)', header or '')
    if not match:
        raise ValueError('One explicit byte range is required')
    start, last = map(int, match.groups())
    if not 0 <= start <= last < size or last - start + 1 > 4 * 1024 * 1024:
        raise ValueError('Range is outside the fixture or exceeds its budget')
    return start, last + 1


def assess(result, expected, threshold):
    valid_cer(threshold)
    if not isinstance(result, dict) or result.get('phase') != 'complete':
        raise ValueError('Encoded queue did not complete')
    cues = result.get('track', {}).get('cues')
    if not isinstance(cues, list) or not cues:
        raise ValueError('Missing completed encoded transcript')
    actual = ' '.join(cue['text'] for cue in cues)
    reference = normalize(expected)
    if not reference:
        raise ValueError('Empty encoded fixture reference')
    edits = distance(reference, normalize(actual))
    cer = edits / len(reference)
    if cer > threshold:
        raise AssertionError(f'Encoded-video character error {cer:.4f} exceeds {threshold:.4f}')
    return {'edits': edits, 'referenceCharacters': len(reference), 'characterErrorRate': cer}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--language', choices=['en', 'ja'], required=True)
    parser.add_argument('--threaded', action='store_true')
    parser.add_argument('--source', choices=['file', 'range'], required=True)
    parser.add_argument('--max-cer', type=float, default=0.35)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    valid_cer(args.max_cer)
    args.output.mkdir(parents=True, exist_ok=True)
    fixture_dir = ROOT / '.cache/media-fixtures/encoded' / args.language
    manifest = build_fixture(args.fixture, fixture_dir, args.language)
    mode = 'threaded' if args.threaded else 'single'
    for path in [ROOT / f'apps/web/static/moss/{mode}/moss.wasm',
                 ROOT / f'apps/web/static/moss/{mode}/moss.mjs',
                 ROOT / '.cache/media-test-build/encoded-media-adapter.js']:
        if not path.is_file():
            raise FileNotFoundError('Missing real runtime or production adapter: ' + str(path))
    ranges = []
    range_lock = threading.Lock()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def end_headers(self):
            if args.threaded:
                self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
                self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            super().end_headers()

        def do_GET(self):
            parsed = urlsplit(self.path)
            if parsed.path == '/__encoded__/':
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(HTML)))
                self.end_headers()
                self.wfile.write(HTML)
                return
            if parsed.path == '/__encoded__/video.webm':
                self.path = '/' + (fixture_dir / 'video.webm').relative_to(ROOT).as_posix()
                return super().do_GET()
            if parsed.path != ENDPOINT:
                return super().do_GET()
            expected = {'id': ['fixture'], 'root': ['fixture-root'], 'user': ['fixture-user'],
                        'version': [manifest['videoSha256']]}
            if parse_qs(parsed.query) != expected or self.headers.get('X-Manabi-User') != 'fixture-user':
                self.send_error(403)
                return
            try:
                start, end = byte_range(self.headers.get('Range'), manifest['videoBytes'])
            except ValueError:
                self.send_error(416)
                return
            with (fixture_dir / 'video.webm').open('rb') as stream:
                stream.seek(start)
                body = stream.read(end - start)
            with range_lock:
                ranges.append({'start': start, 'end': end, 'bytes': len(body)})
            self.send_response(206)
            self.send_header('Content-Type', 'video/webm')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Range', f'bytes {start}-{end - 1}/{manifest["videoBytes"]}')
            self.send_header('X-Manabi-User', 'fixture-user')
            self.send_header('ETag', '"' + manifest['videoSha256'] + '"')
            self.end_headers()
            self.wfile.write(body)

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    evidence = {'fixture': manifest, 'mode': mode, 'source': args.source, 'passed': False}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM') or pw.chromium.executable_path,
                                         headless=True, args=['--no-sandbox'])
            page = browser.new_page()
            page.set_default_timeout(30000)
            page_errors = []
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            try:
                page.goto(f'http://127.0.0.1:{server.server_port}/__encoded__/')
                page.wait_for_function('globalThis.encodedReady === true')
                if page.evaluate('crossOriginIsolated') is not args.threaded:
                    raise AssertionError('Wrong actual runtime isolation')
                page.evaluate('config => encodedASR.start(config)', {**manifest, 'source': args.source})
                wait_for_async(page, """async () => {
                    const state = await encodedASR.state();
                    if (state.errors.length || state.job?.status === 'failed')
                        throw Error(JSON.stringify(state));
                    return state.job?.status === 'paused';
                }""", timeout=10 * 60 * 1000)
                evidence['paused'] = page.evaluate('() => encodedASR.state()')
                page.evaluate('() => encodedASR.reopen()')
                wait_for_async(page, """async () => {
                    const state = await encodedASR.state();
                    if (state.errors.length || ['failed', 'paused'].includes(state.job?.status))
                        throw Error(JSON.stringify(state));
                    return state.job?.status === 'complete';
                }""", timeout=15 * 60 * 1000)
                result = page.evaluate('() => encodedASR.finish()')
                evidence['result'] = result
                evidence['quality'] = assess(result, ' '.join(cue['text'] for cue in manifest['cues']), args.max_cer)
                if args.source == 'range' and len(ranges) < 2:
                    raise AssertionError('Range-backed decoding was not exercised')
                if page_errors:
                    raise AssertionError('Unhandled page/worker error: ' + repr(page_errors))
                evidence['passed'] = True
            except Exception as error:
                evidence['error'] = str(error)
                try:
                    evidence['failureState'] = page.evaluate('() => globalThis.encodedASR?.diagnostics()')
                except Exception as diagnostic_error:
                    evidence['diagnosticError'] = str(diagnostic_error)
                raise
            finally:
                evidence['pageErrors'] = page_errors
                browser.close()
    finally:
        server.shutdown()
        evidence['ranges'] = ranges
        (args.output / 'results.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'passed': evidence['passed'], 'mode': mode, 'source': args.source,
                      'quality': evidence['quality'], 'decodes': evidence['result']['decodeCalls']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
