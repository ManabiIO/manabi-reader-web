#!/usr/bin/env python3
"""Native Chromium regression checks for the bounded asynchronous polling helper.

No application, inference or storage-implementation doubles are needed: these
checks establish the assertion's Promise, timeout, argument, and failure behavior.
"""
import argparse
import json
import os
from pathlib import Path
import time

from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout, Error as BrowserError
from browser_poll import wait_for_async


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                                         headless=True, args=['--no-sandbox'])
            page = browser.new_page()
            page.set_content('<!doctype html><title>Async assertion contract</title>')

            def case(name, body):
                try:
                    body()
                    results.append({'name': name, 'passed': True})
                    print('PASS', name, flush=True)
                except Exception as error:
                    results.append({'name': name, 'passed': False, 'error': str(error)})
                    print('FAIL', name, str(error), flush=True)

            def times_out(expression):
                started = time.monotonic()
                try:
                    wait_for_async(page, expression, timeout=180, interval=10)
                except BrowserTimeout:
                    assert time.monotonic() - started < 3, 'Host timeout did not bound the assertion'
                else:
                    raise AssertionError('A non-true or unresolved predicate incorrectly passed')

            for value in ['false', '1', '({truthy:true})', '"true"']:
                case(f'async {value} cannot pass as a truthy Promise',
                     lambda value=value: times_out(f'async () => {value}'))
            case('a never-resolving query is bounded by the host timeout',
                 lambda: times_out('() => new Promise(() => {})'))

            def eventual_true():
                page.evaluate('window.pollCalls = 0')
                wait_for_async(page, 'async expected => { await new Promise(r=>setTimeout(r,10)); return ++pollCalls === expected; }',
                               arg=3, interval=5, timeout=1500)
                assert page.evaluate('pollCalls') == 3
            case('a settled false retries until exactly true with the original argument', eventual_true)

            def rejection(expression):
                try:
                    wait_for_async(page, expression, timeout=1500, interval=5)
                except BrowserError as error:
                    assert 'storage rejected' in str(error)
                else:
                    raise AssertionError('Predicate rejection was swallowed')
            case('async rejection fails immediately',
                 lambda: rejection('async () => { throw Error("storage rejected"); }'))
            case('synchronous predicate errors fail immediately',
                 lambda: rejection('() => { throw Error("storage rejected"); }'))

            def no_overlap():
                page.evaluate('window.pollCalls=0;window.pollActive=0;window.pollMaximum=0')
                wait_for_async(page, '''async () => {
                    ++pollCalls; ++pollActive; pollMaximum=Math.max(pollMaximum,pollActive);
                    await new Promise(resolve => setTimeout(resolve,30)); --pollActive;
                    return pollCalls === 3;
                }''', interval=5, timeout=2000)
                assert page.evaluate('[pollCalls,pollActive,pollMaximum]') == [3, 0, 1]
            case('slow asynchronous reads never overlap', no_overlap)

            def no_retry_after_timeout():
                page.evaluate('window.pollCalls=0;window.releaseLate=undefined')
                times_out('() => { ++pollCalls; return new Promise(r => { window.releaseLate=r; }); }')
                page.evaluate('releaseLate(false)')
                # Let an erroneously retained poller demonstrate itself.
                page.wait_for_timeout(100)
                assert page.evaluate('pollCalls') == 1
            case('a late resolution after timeout cannot restart polling', no_retry_after_timeout)
            browser.close()
    finally:
        (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    if not results or any(not item['passed'] for item in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
