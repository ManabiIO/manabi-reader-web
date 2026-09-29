#!/usr/bin/env python3
"""Benchmark configured pthread counts on the exact checked-in runtime.

This is a correctness-preserving qualification sweep, not a production policy
selector. It uses the normal MossClient thread-selection path by presenting the
browser with N+1 logical processors (the client intentionally leaves one free).
No timing threshold controls pass/fail; every count must produce the same raw
transcript and satisfy the normal character-error/streaming checks.
"""
import argparse
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright
import asr

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--language', choices=['en', 'ja'], required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--max-cer', type=float, default=.35)
    args = parser.parse_args()
    asr.valid_cer(args.max_cer)
    fixture = asr.fixture_metadata(args.fixture, args.language)
    expected = ' '.join(cue['text'] for cue in fixture['cues'])
    asr.Handler.threaded = True
    asr.Handler.fixture = args.fixture.resolve()
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0),
        functools.partial(asr.Handler, directory=str(ROOT)),
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    raw_reference = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                headless=True,
                args=['--no-sandbox'],
            )
            context = browser.new_context()
            for threads in (2, 4, 8):
                page = context.new_page()
                # MossClient chooses min(8, hardwareConcurrency - 1). Shadow the
                # browser value before modules execute so this exercises the same
                # selection code as production without adding a test-only client API.
                page.add_init_script(
                    f"""Object.defineProperty(navigator, 'hardwareConcurrency', {{
                      configurable: true,
                      get: () => {threads + 1}
                    }});"""
                )
                page.goto(
                    f'http://127.0.0.1:{server.server_port}'
                    '/tests/media/asr-harness.html?fixture=/__fixture__'
                )
                page.wait_for_function('window.ready')
                observed = page.evaluate('navigator.hardwareConcurrency')
                if observed != threads + 1:
                    raise AssertionError('Browser thread override was not applied')
                attempts = []
                for _ in range(2):
                    page.evaluate('window.result = null; window.failure = null')
                    page.get_by_role(
                        'button', name='Generate transcript', exact=True
                    ).click()
                    page.wait_for_function(
                        'window.result || window.failure', timeout=30 * 60 * 1000
                    )
                    failure = page.evaluate('window.failure')
                    if failure:
                        raise RuntimeError(failure)
                    result = page.evaluate('window.result')
                    if result.get('crossOriginIsolated') is not True:
                        raise AssertionError('Thread sweep did not use pthread runtime')
                    asr.validate_streaming_metrics(result)
                    actual = ' '.join(cue['text'] for cue in result['cues'])
                    cer = asr.distance(
                        asr.normalize(expected), asr.normalize(actual)
                    ) / max(1, len(asr.normalize(expected)))
                    if cer > args.max_cer:
                        raise AssertionError(
                            'Thread sweep recognition exceeds CER threshold'
                        )
                    raw = result['raw']
                    if raw_reference is None:
                        raw_reference = raw
                    elif raw != raw_reference:
                        raise AssertionError(
                            'Configured thread count changed the raw transcript'
                        )
                    attempts.append(
                        {
                            'prepareSeconds': result['prepareSeconds'],
                            'inferenceSeconds': result['inferenceSeconds'],
                            'realTimeFactor': result['realTimeFactor'],
                            'characterErrorRate': cer,
                            'partialUpdates': result['partialUpdates'],
                            'firstOutputSeconds': result['firstOutputSeconds'],
                            'firstPreviewCueSeconds': result['firstPreviewCueSeconds'],
                        }
                    )
                results.append(
                    {
                        'configuredThreads': threads,
                        'reportedHardwareConcurrency': observed,
                        'attempts': attempts,
                    }
                )
                page.close()
            browser.close()
    finally:
        server.shutdown()

    output = {
        'kind': 'exact packaged pthread thread-count sweep; timing is evidence only',
        'runtimeVariant': 'threaded',
        'fixture': {
            'fingerprint': fixture['fingerprint'],
            'language': args.language,
            'engine': fixture['engine'],
            'speechSha256': fixture['files']['speech.wav'],
        },
        'expected': expected,
        'rawTranscriptSha256': hashlib.sha256(raw_reference.encode()).hexdigest(),
        'results': results,
        'passCriteria': {
            'rawTranscriptEqualAcrossCounts': True,
            'streamingCallbacksRequired': True,
            'maximumCharacterErrorRate': args.max_cer,
            'timingThreshold': None,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(results))


if __name__ == '__main__':
    main()
