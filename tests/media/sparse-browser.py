#!/usr/bin/env python3
"""Sparse draft migration and caption readiness in real Chromium/IndexedDB.

Recognition hypotheses are scripted. This does not qualify MOSS accuracy or speed,
physical iOS/Safari, OS background suspension, or the Svelte application shell.
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
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/sparse-browser')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    Handler.fixture = args.fixture.resolve()
    if not (Handler.fixture / 'video.mp4').is_file():
        raise SystemExit('Generate the actual video fixture before this test.')
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox'])
            page = browser.new_page()
            page.set_default_timeout(30000)
            page_errors = []
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/tests/media/browser-harness.html?fixture=/__fixture__/video.mp4')
            try:
                page.wait_for_function('window.ready === true')
            except Exception as error:
                state = page.evaluate('''() => ({
                    modules: !!window.modules,
                    fileSize: window.file?.size,
                    player: !!window.player,
                    videoState: window.player?.video.readyState,
                    videoError: window.player?.video.error?.message
                })''')
                raise AssertionError(f'Browser harness did not start: {page_errors}; {state}') from error
            page.evaluate('''async () => {
                window.sparseModule = await import('../../.cache/media-test-build/sparse-transcription.js');
                window.legacyModule = await import('../../.cache/media-test-build/sparse-legacy.js');
                window.jobsModule = await import('../../.cache/media-test-build/jobs.js');
                window.draftModule = await import('../../.cache/media-test-build/transcription-draft.js');
                const {MOSS} = await import('../../.cache/media-test-build/model-cache.js');
                const s = sparseModule.newSparseState(78);
                s.windows[0] = {cues:[{id:'w0/cue-0',start:23,end:27,text:'境界をまたぐ長い文章です。'}],inferenceMs:1000};
                s.windows[1] = {cues:[{id:'w1/cue-0',start:24,end:27,text:'境界をまたぐ長い文章です。'}],inferenceMs:1000};
                window.savedDraft = {version:3,sparse:s,id:crypto.randomUUID(),mediaKey:key,
                    language:'ja',audioTrack:'1',duration:78,status:'paused',nextWindow:2,
                    cues:legacyModule.legacySparseCues(s,78),modelSha256:MOSS.sha256,
                    engineRevision:MOSS.engineRevision,createdAt:1};
                window.testDB = 'sparse-migration-' + crypto.randomUUID();
                window.draftStore = new modules.MediaStore(indexedDB,testDB);
            }''')

            def case(name, body):
                try:
                    body()
                    results.append({'name': name, 'passed': True})
                    print('PASS', name, flush=True)
                except Exception as error:
                    results.append({'name': name, 'passed': False, 'error': str(error)})
                    print('FAIL', name, str(error), flush=True)
                    page.screenshot(path=str(args.output / f'failure-{len(results)}.png'))

            def verify(script):
                assert page.evaluate(script)

            case('Native IndexedDB reopening derives missing whole cues without changing hypotheses', lambda: verify('''async () => {
                await draftStore.putLocal('guest','jobs',savedDraft.id,savedDraft);
                await draftStore.close();
                draftStore = new modules.MediaStore(indexedDB,testDB);
                const raw = await draftStore.local('guest','jobs',savedDraft.id);
                window.upgraded = jobsModule.validateJob(raw);
                return raw.cues.length === 0 && upgraded.cues.length === 1 &&
                    upgraded.cues[0].id === 'w0/cue-0' &&
                    JSON.stringify(upgraded.sparse) === JSON.stringify(raw.sparse);
            }'''))
            case('A failed migration transaction leaves the previous checkpoint intact', lambda: verify('''async () => {
                try {
                    await draftStore.updateLocal('guest','jobs',savedDraft.id, old => {
                        jobsModule.validateJob(old);
                        throw Error('injected failure before commit');
                    });
                    return false;
                } catch (error) {
                    const raw = await draftStore.local('guest','jobs',savedDraft.id);
                    return error.message.includes('injected failure') && raw.cues.length === 0 && raw.nextWindow === 2;
                }
            }'''))
            case('Migrated cache persists atomically and validates identically after reopening', lambda: verify('''async () => {
                await draftStore.updateLocal('guest','jobs',savedDraft.id, jobsModule.validateJob);
                await draftStore.close();
                draftStore = new modules.MediaStore(indexedDB,testDB);
                const raw = await draftStore.local('guest','jobs',savedDraft.id);
                return raw.cues.length === 1 && JSON.stringify(jobsModule.validateJob(raw)) === JSON.stringify(raw);
            }'''))

            def display():
                page.evaluate('''() => {
                    player.setTracks([]);
                    player.setDrafts([draftModule.transcriptionDraft(upgraded)]);
                    const select = player.root.querySelector('[aria-label="Transcript track"]');
                    select.value = upgraded.id;
                    select.dispatchEvent(new Event('change',{bubbles:true}));
                }''')
                assert page.locator('.transcript-cue').count() == 1
                assert '境界をまたぐ長い文章です。' in page.locator('.transcript-cue').inner_text()
            case('The actual transcript displays the joined whole cue once', display)

            def readiness():
                page.evaluate('''() => {
                    const sparse = sparseModule.newSparseState(78);
                    sparse.windows[0] = {cues:[{id:'w0/cue-0',start:20,end:27,text:'まだ確定していません'}],inferenceMs:1000};
                    player.video.currentTime = 0;
                    player.generationProgress({...upgraded,status:'running',sparse,cues:[],nextWindow:1});
                }''')
                text = page.locator('.video-viewing [role=status]').all_inner_texts()[-1]
                assert 'Caption lead: 0:20.' in text, text
                assert 'Ready to play with captions.' not in text, text
                page.get_by_role('button', name='Wait for captions', exact=True).click()
                assert page.get_by_role('button', name='Play without captions', exact=True).is_visible()
            case('Buffering holds at the omitted cue start, with playback bypass available', readiness)
            page.evaluate('async () => { await player.dispose(); await draftStore.close(); await store.close(); }')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    report = {
        'environment': 'Chromium / native IndexedDB / production media modules / scripted hypotheses',
        'tests': results,
        'passed': sum(r['passed'] for r in results),
        'failed': sum(not r['passed'] for r in results)
    }
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if report['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
