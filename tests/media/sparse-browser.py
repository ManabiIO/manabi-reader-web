#!/usr/bin/env python3
"""Sparse draft migration and caption readiness in real Chromium/IndexedDB.

Recognition hypotheses are scripted. This does not qualify MOSS accuracy or speed,
physical iOS/Safari, OS background suspension, or the Svelte application shell.
"""
import argparse
from contextlib import ExitStack
import functools
import http.server
import json
import os
import sys
from pathlib import Path
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/browser'))
from browser_launch import launch_options
from test_static_reader import ThreadingHTTPServer


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
    server = ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    results = []
    try:
        with sync_playwright() as pw, ExitStack() as cleanup:
            browser = pw.chromium.launch(
                **launch_options(executable_path=os.environ.get('CHROMIUM'),
                                 headless=True, args=['--no-sandbox']))
            cleanup.callback(browser.close)
            context = browser.new_context()
            cleanup.callback(context.close)
            page = context.new_page()
            page.set_default_timeout(30000)
            page_errors = []
            diagnostics = []
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.on('console', lambda message: diagnostics.append({
                'kind': 'console', 'type': message.type, 'text': message.text}))
            page.on('requestfailed', lambda request: diagnostics.append({
                'kind': 'requestfailed', 'url': request.url, 'error': request.failure}))
            page.on('response', lambda response: diagnostics.append({
                'kind': 'response', 'url': response.url, 'status': response.status})
                if response.status >= 400 else None)
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
                (args.output / 'startup-diagnostics.json').write_text(json.dumps({
                    'state': state, 'page_errors': page_errors, 'requests': diagnostics
                }, indent=2))
                page.screenshot(path=str(args.output / 'startup-failure.png'))
                raise AssertionError(
                    f'Browser harness did not start: {page_errors}; {state}; {diagnostics}') from error
            page.evaluate('''async () => {
                window.sparseModule = await import('../../.cache/media-test-build/sparse-transcription.js');
                window.legacyModule = await import('../../.cache/media-test-build/sparse-legacy.js');
                window.jobsModule = await import('../../.cache/media-test-build/jobs.js');
                window.draftModule = await import('../../.cache/media-test-build/transcription-draft.js');
                const {MOSS} = await import('../../.cache/media-test-build/model-cache.js');
                const s = sparseModule.newSparseState(78);
                s.policy = 'overlap-sparse-v1'; // This fixture exercises the saved old policy.
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
            case('A reopened seek-local window remains visible but provisional under version 2', lambda: verify('''async () => {
                const sparse = sparseModule.newSparseState(78, 57);
                sparse.windows[2] = {cues:[{id:'w2/cue-0',start:56,end:58,text:'後で直せる字幕'}],inferenceMs:1000};
                const candidate = {...savedDraft,id:crypto.randomUUID(),sparse,nextWindow:1,cues:[]};
                await draftStore.putLocal('guest','jobs',candidate.id,candidate);
                await draftStore.close();
                draftStore = new modules.MediaStore(indexedDB,testDB);
                const raw = await draftStore.local('guest','jobs',candidate.id);
                const reopened = jobsModule.validateJob(raw);
                const view = draftModule.transcriptionDraft(reopened);
                return reopened.sparse.policy === 'overlap-sparse-v2' &&
                    reopened.cues.length === 0 && view.provisional &&
                    view.track.cues.length === 1 &&
                    view.track.cues[0].text === '後で直せる字幕' && !view.track.complete;
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

            def silence_eta():
                result = page.evaluate('''async () => {
                    const sparse = sparseModule.newSparseState(78);
                    sparse.windows[0] = {cues:[],inferenceMs:50,digitalSilence:true};
                    const candidate = {...savedDraft,id:crypto.randomUUID(),sparse,nextWindow:1,cues:[]};
                    await draftStore.putLocal('guest','jobs',candidate.id,candidate);
                    await draftStore.close();
                    draftStore = new modules.MediaStore(indexedDB,testDB);
                    const raw = await draftStore.local('guest','jobs',candidate.id);
                    window.silenceDraft = jobsModule.validateJob(raw);
                    const snapshot = sparseModule.sparsePlaybackSnapshot(silenceDraft.sparse,78);
                    player.video.currentTime = 4;
                    player.setDrafts([draftModule.transcriptionDraft(silenceDraft)]);
                    player.generationProgress({...silenceDraft,status:'running'});
                    return {evidence:raw.sparse.windows[0].digitalSilence,
                        lead:snapshot.lead(0),totalMs:snapshot.totalMs,
                        inputSeconds:snapshot.inputSeconds};
                }''')
                # The final two-second overlap still awaits its neighboring
                # window; silence does not bypass that publication boundary.
                assert result == {'evidence': True, 'lead': 24, 'totalMs': 0, 'inputSeconds': 0}, result
                status = page.locator('.video-viewing [role=status]').all_inner_texts()[-1]
                assert 'Caption lead: 0:20.' in status, status
                assert 'estimating after the first speech window' in status, status
                assert 'about ' not in status, status
                page.evaluate('''() => {
                    silenceDraft.sparse.windows[2] = {cues:[],inferenceMs:28000};
                    player.generationProgress({...silenceDraft,status:'running',nextWindow:2});
                }''')
                status = page.locator('.video-viewing [role=status]').all_inner_texts()[-1]
                assert 'Caption lead: 0:20.' in status, status
                assert 'about 0:30' in status, status
                assert 'estimating after the first speech window' not in status, status
            case('Reopened digital silence provides coverage without inventing recognition speed or ETA', silence_eta)
            page.evaluate('async () => { await player.dispose(); await draftStore.close(); await store.close(); }')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
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
