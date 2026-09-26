#!/usr/bin/env python3
"""Real Chromium / native IndexedDB with production media modules.

No persistence or network doubles. One explicitly labelled queue-control case
uses a recognizer double; this runner does not establish speech accuracy.
The separate app-browser runner owns Svelte-shell/shared-preference acceptance.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


class Handler(http.server.SimpleHTTPRequestHandler):
    fixture = None

    def translate_path(self, path):
        if urlsplit(path).path == '/__fixture__/video.mp4':
            return str(self.fixture / 'video.mp4')
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/native-browser')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    Handler.fixture = args.fixture.resolve()
    if not (Handler.fixture / 'video.mp4').is_file():
        raise SystemExit('Generate the actual video fixture before this test.')
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []

    def check(condition, message='Assertion failed'):
        if not condition:
            raise AssertionError(message)

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1280, 'height': 900})
            page = context.new_page()
            page.set_default_timeout(10000)
            page_errors, requests = [], []
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url))
            page.goto(f'http://127.0.0.1:{server.server_port}/tests/media/browser-harness.html?fixture=/__fixture__/video.mp4')
            page.wait_for_function('window.ready === true')
            js = page.evaluate

            def case(name, body):
                start = time.monotonic()
                try:
                    body()
                    results.append({'name': name, 'status': 'passed', 'seconds': round(time.monotonic() - start, 3)})
                    print('PASS', name, flush=True)
                except Exception as error:
                    results.append({'name': name, 'status': 'failed', 'error': str(error)})
                    print('FAIL', name, str(error), flush=True)
                    page.screenshot(path=str(args.output / f'failure-{len(results)}.png'))
                finally:
                    # Independent storage cases below still run after a UI failure.
                    page.keyboard.press('Escape')

            def menu():
                page.get_by_role('button', name='Transcript options', exact=True).click()

            case('Opening local video does not prepare or download MOSS', lambda: check(
                js('generated === 0 && player.video.duration > 6') and
                not any('huggingface' in url or '/moss/' in url for url in requests)))

            def select_main():
                check(page.get_by_text('Choose your transcript', exact=True).is_visible())
                page.get_by_label('Choose existing subtitles', exact=True).select_option(js('id'))
                page.wait_for_function('player.primary.value === id && player.secondary.value === id2')
                check(page.locator('.transcript-translation').count() > 0)
                check(js('generated === 0'))
            case('Explicit main selection precedes locale translation', select_main)

            def theater():
                toggle = page.get_by_role('button', name='Theater mode', exact=True)
                toggle.click()
                check(toggle.get_attribute('aria-pressed') == 'true')
                js('player.video.currentTime = 1')
                page.wait_for_function('document.querySelectorAll(".caption-line").length === 2')
                check(page.locator('.transcript-pane').is_visible())
                check(page.get_by_role('button', name='Full screen', exact=True).count() == 0)
            case('Theater shows dual overlays without a duplicate fullscreen button', theater)

            def independent_times():
                js('player.video.currentTime = 2.5')
                page.wait_for_function('document.querySelector(".caption-line:not(.translation)").textContent.includes("次の行")')
                check(page.locator('.caption-line.translation').inner_text() == 'First translated sentence.')
                check(js('!player.root.querySelector("img") && document.querySelector(".caption-line").textContent.includes("<img")'))
            case('Independent caption timing and inert subtitle markup', independent_times)

            def caption_style():
                menu()
                page.get_by_text('Video caption style & timing', exact=True).click()
                for label, value in [('Video text color', 'yellow'), ('Video background opacity', '0.8'), ('Video text size', '1.25')]:
                    page.get_by_label(label, exact=True).select_option(value)
                check(js('document.querySelector(".caption-overlay").style.getPropertyValue("--caption-color") === "yellow"'))
                page.wait_for_function('async () => (await store.local("guest", "settings", "captions"))?.size === 1.25')
            case('Overlay preferences commit to real IndexedDB', caption_style)

            def off_and_save():
                menu()
                page.get_by_label('Translation track', exact=True).select_option('')
                page.get_by_label('Transcript track', exact=True).select_option('')
                js('player.setTracks(tracks); player.video.currentTime = 4.2')
                page.wait_for_function('!player.video.seeking && Math.abs(player.video.currentTime - 4.2) < .1')
                page.wait_for_function('async () => {const value=(await store.get("guest","video_resume",key))?.payload; return value && Math.abs(value.position - 4.2) < .1 && value.primary === null && value.secondary === null;}')
            case('Explicit Off and seek persist in native IndexedDB', off_and_save)

            def restore():
                js('mount()')
                page.wait_for_function('!player.video.seeking && Math.abs(player.video.currentTime - 4.2) < .15')
                check(js('player.primary.value === "" && player.secondary.value === ""'))
                page.wait_for_function('document.querySelector(".caption-overlay").style.getPropertyValue("--caption-color") === "yellow"')
            case('Reopening restores playback, Off and overlay preferences', restore)

            def reflow():
                page.set_viewport_size({'width': 390, 'height': 844})
                page.wait_for_function('innerWidth === 390 && document.documentElement.scrollWidth <= innerWidth + 1')
                page.screenshot(path=str(args.output / 'player-mobile.png'), full_page=True)
                page.set_viewport_size({'width': 1280, 'height': 900})
                page.screenshot(path=str(args.output / 'player-desktop.png'), full_page=True)
            case('Phone reflow stays within the viewport', reflow)
            js('player.dispose()')  # No autosave can race the direct store fault cases.

            case('Two native IDB connections reject stale compare-and-swap saves', lambda: check(js('''async () => {
                const other = new modules.MediaStore(indexedDB, store.name);
                try {
                    const before = await store.get('guest', 'video_resume', key);
                    await store.edit('guest', 'video_resume', key, key, {...before.payload, position:5}, before.localVersion);
                    try {await other.edit('guest', 'video_resume', key, key, {...before.payload, position:6}, before.localVersion); return false;}
                    catch (error) {return error.constructor.name === 'LocalConflict';}
                } finally {await other.close();}
            }''')))
            case('Account partitions do not leak native IDB records', lambda: check(js('''async () => {
                await store.edit('account:A', 'video_info', key, key, {version:1,title:'private',duration:10,width:320,height:180,addedAt:1});
                return (await store.records('account:B')).length === 0 && (await store.records('account:A')).length === 1;
            }''')))
            case('Native IDB publishes and verifies every subtitle page', lambda: check(js('''async () => {
                const track = {...tracks[0], id:crypto.randomUUID(), cues:Array.from({length:501}, (_,i) => ({id:String(i),start:i,end:i+.5,text:'line'}))};
                await store.saveTrack('account:A', track);
                return (await store.tracks('account:A', key))[0].cues.length === 501;
            }''')))
            case('Explicit enqueue prepares one engine (recognition double, real IDB)', lambda: check(js('''async () => {
                let prepared=0, called=0;
                const engine={async prepare(){prepared++;}, async transcribe(){called++;return '[0.2][S01]First sentence.[1.2][1.5][S01]Second sentence.[2.5]';}, dispose(){}};
                const queue=new modules.TranscriptionQueue(store,'account:queue',engine,async () => new Float32Array(16000*4).fill(.1));
                try {
                    if (prepared) return false;
                    const job=await queue.enqueue(key,'en','1',4);
                    const deadline=performance.now()+10000;
                    while (performance.now()<deadline) {
                        const current=await store.local('account:queue','jobs',job.id);
                        if (current.status==='complete') return prepared===1 && called===1 && (await store.tracks('account:queue',key))[0].cues.length===2;
                        if (current.status==='failed') throw Error(current.error);
                        await new Promise(resolve => setTimeout(resolve,20));
                    }
                    throw Error('Queue never completed');
                } finally {await queue.dispose();}
            }''')))
            case('Generate admission is atomic across native IDB connections', lambda: check(js('''async () => {
                const other=new modules.MediaStore(indexedDB,store.name);
                const draft=() => ({version:1,id:crypto.randomUUID(),mediaKey:key,language:'ja',audioTrack:'1',duration:4,status:'queued',nextWindow:0,cues:[],modelSha256:'a'.repeat(64),engineRevision:'native-admission-test',createdAt:Date.now()});
                try {
                    const [a,b]=await Promise.all([store.enqueueJob('account:admission',draft()),other.enqueueJob('account:admission',draft())]);
                    return a.id===b.id && (await store.listLocal('account:admission','jobs')).length===1;
                } finally {await other.close();}
            }''')))
            case('No unhandled browser or controller errors', lambda: check(
                not page_errors and not js('errors'), '; '.join(page_errors + js('errors'))))
            js('store.close()')
            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        report = {'kind': 'production media modules / native Chromium IndexedDB',
                  'notCovered': ['Svelte shell', 'speech accuracy', 'live accounts/providers', 'cross-tab suspension'],
                  'tests': results,
                  'passed': sum(item['status'] == 'passed' for item in results),
                  'failed': sum(item['status'] == 'failed' for item in results)}
        (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    if report['failed'] or not results:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
