#!/usr/bin/env python3
"""Codec-independent Videos route acceptance in Chromium/WebKit.

Uses the built Svelte app and native browser storage. It deliberately does not
open media so Linux codec availability cannot turn a route/UI regression into a
false browser-compatibility failure.
"""
import argparse
import json
from pathlib import Path
import sys
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/browser'))
from test_static_reader import StaticHandler, ThreadingHTTPServer


def inside_viewport(locator, width, height):
    box = locator.bounding_box()
    assert box, locator
    assert box['width'] >= 43.5 and box['height'] >= 43.5, box
    assert box['x'] >= -1 and box['y'] >= -1, box
    assert box['x'] + box['width'] <= width + 1, box
    assert box['y'] + box['height'] <= height + 1, box
    assert locator.evaluate("""node => {
      const r=node.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return !!hit && (hit===node || node.contains(hit));
    }"""), box


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('chromium', 'webkit'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    errors = []
    checks = []

    with sync_playwright() as playwright:
        browser = getattr(playwright, args.engine).launch()
        context = browser.new_context(locale='en-CA', viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)
        try:
            page.goto(origin + '/reader-web/videos')
            expect(page.get_by_role('heading', name='Videos', exact=True)).to_be_visible()
            media = page.locator('.manabi-media')
            expect(media).to_be_visible()
            nav = page.get_by_role('navigation', name='Library sections', exact=True)
            expect(nav).to_be_visible()
            expect(nav.locator('[aria-current="page"]')).to_have_text('Videos')

            # Empty-library controls are the first-run product surface.
            controls = [
                page.get_by_role('button', name='Add videos', exact=True),
                page.get_by_role('button', name='Open local folder', exact=True),
                page.get_by_role('searchbox', name='Search videos', exact=True),
                page.get_by_label('Sort videos', exact=True),
                page.get_by_label('Filter videos', exact=True),
                page.get_by_role('button', name='Select visible videos', exact=True),
                page.get_by_role('button', name='Clear selection', exact=True),
                page.get_by_role('button', name='Generate missing transcripts', exact=True),
            ]
            for control in controls:
                expect(control).to_be_visible()
                assert control.bounding_box()['height'] >= 43.5
            page.get_by_role('button', name='Add videos', exact=True).click(trial=True)
            page.get_by_role('button', name='Select visible videos', exact=True).click()
            expect(page.get_by_role('status')).to_contain_text('0 videos selected')
            checks.append('empty video library actions are reachable and native-hit-testable')

            # Disclosure/settings controls must remain usable even without media.
            summary = page.get_by_text('Transcription and sync', exact=True)
            assert summary.bounding_box()['height'] >= 43.5
            summary.click()
            sync = page.get_by_label(
                'Sign in to sync; everything remains local otherwise', exact=True
            )
            expect(sync).to_be_disabled()
            remove_model = page.get_by_role(
                'button', name='Remove cached transcription model', exact=True
            )
            expect(remove_model).to_be_visible()
            assert remove_model.bounding_box()['height'] >= 43.5
            checks.append('transcription disclosure exposes bounded offline-first controls')

            # Stress actual app chrome at Dynamic Type-like scaling.
            page.set_viewport_size({'width': 320, 'height': 568})
            page.evaluate("document.documentElement.style.fontSize='200%'")
            expect(media).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth-innerWidth') <= 1
            assert media.evaluate('node => node.scrollWidth-node.clientWidth') <= 1
            for control in controls:
                control.scroll_into_view_if_needed()
                inside_viewport(control, 320, 568)
            summary.scroll_into_view_if_needed()
            inside_viewport(summary, 320, 568)
            remove_model.scroll_into_view_if_needed()
            inside_viewport(remove_model, 320, 568)
            for item in nav.locator('a, [aria-current]').all():
                item.scroll_into_view_if_needed()
                inside_viewport(item, 320, 568)
            page.screenshot(path=str(args.output / f'{args.engine}-videos-shell-200.png'), full_page=True)
            checks.append('Videos route reflows at 320px / 200% text without horizontal overflow')

            # Keyboard navigation across the real Books/Videos route boundary.
            books = nav.get_by_role('link', name='Books', exact=True)
            books.focus()
            expect(books).to_be_focused()
            books.press('Enter')
            expect(page).to_have_url(origin + '/reader-web/manage')
            library_nav = page.get_by_role('navigation', name='Library sections', exact=True)
            expect(library_nav).to_be_visible()
            expect(library_nav.get_by_role('link', name='Books', exact=True)).to_have_attribute(
                'aria-current', 'page'
            )
            videos = library_nav.get_by_role('link', name='Videos', exact=True)
            inside_viewport(videos, 320, 568)
            videos.focus()
            videos.press('Enter')
            expect(page).to_have_url(origin + '/reader-web/videos')
            expect(page.get_by_role('heading', name='Videos', exact=True)).to_be_visible()
            checks.append('Books/Videos route switcher works by keyboard in enlarged mobile layout')

            assert not errors, errors
        except Exception:
            page.screenshot(path=str(args.output / f'{args.engine}-failure.png'), full_page=True)
            (args.output / f'{args.engine}-failure.html').write_text(page.content())
            raise
        finally:
            (args.output / f'{args.engine}-results.json').write_text(
                json.dumps(
                    {
                        'engine': args.engine,
                        'checks': checks,
                        'passed': len(checks),
                        'pageErrors': errors,
                        'boundary': (
                            'built Svelte app + native browser storage; '
                            'codec/playback/providers/ASR intentionally excluded'
                        ),
                    },
                    indent=2,
                )
                + '\n'
            )
            browser.close()
    server.shutdown()
    server.server_close()
    thread.join()


if __name__ == '__main__':
    main()
