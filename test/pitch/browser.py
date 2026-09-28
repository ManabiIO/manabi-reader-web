"""Native Web Audio/worker qualification; uses emitted production modules.
Run: node test/pitch/run.mjs --emit=test-results/pitch-modules
     python test/pitch/browser.py test-results/pitch-modules
This is a controller/worker harness, not the fully bundled Svelte application.
"""
import argparse
import functools
import http.server
import json
from pathlib import Path
import shutil
import threading
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('modules')
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
args = parser.parse_args()
root = Path(args.modules).resolve()
html = '''<!doctype html><html><head><meta charset="utf-8"><title>Pitch native harness</title></head>
<body><button id="show">Show pitch</button><button id="play">Play</button><audio controls></audio>
<script type="module">
import {createPitchController} from './browser.mjs';
import {pitchPaths} from './model.mjs';
window.workersCreated = 0; window.workerReady = 0; window.contexts = []; window.audioEvents = [];
const OriginalWorker = window.Worker;
window.Worker = class extends OriginalWorker { constructor(...args) { super(...args); this.addEventListener('error', event => console.error('Worker error:', event.message, event.filename)); this.addEventListener('message', event => { if (event.data?.type === 'ready') window.workerReady++; }); window.workersCreated++; } };
window.states = []; window.captured = []; window.routes = []; window.contextCloses = 0;
const Original = window.AudioContext;
window.AudioContext = class extends Original {
  constructor(...args) {
    super(...args); window.contexts.push(this);
    this.addEventListener('statechange', () => window.audioEvents.push('state:' + this.state));
  }
  resume() {
    window.audioEvents.push('resume:' + this.state);
    const promise = super.resume();
    promise.then(() => window.audioEvents.push('resumed:' + this.state), error => window.audioEvents.push('resume-error:' + error.message));
    return promise;
  }
  createMediaElementSource(audio) {
    const source = super.createMediaElementSource(audio); window.captured.push(source);
    const connections = new Set(); window.routes.push(connections);
    const connect = source.connect.bind(source), disconnect = source.disconnect.bind(source);
    source.connect = target => { connections.add(target); return connect(target); };
    source.disconnect = (...args) => { if (args.length) connections.delete(args[0]); else connections.clear(); return disconnect(...args); };
    return source;
  }
  close() { window.contextCloses++; return super.close(); }
};
const rate = 48000, seconds = 12, count = rate * seconds;
const buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
text(36, 'data'); view.setUint32(40, count * 2, true);
for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 220 * i / rate) * 24000, true);
const audio = document.querySelector('audio'); audio.src = URL.createObjectURL(new Blob([buffer], {type:'audio/wav'}));
window.audio = audio;
window.controller = createPitchController(state => { window.state = state; window.states.push(state.status); window.paths = pitchPaths(state.points, state.time); });
controller.setAudio(audio); controller.setVisible(true);
document.querySelector('#show').onclick = () => controller.setEnabled(true);
document.querySelector('#play').onclick = () => audio.play();
window.ready = true;
</script></body></html>'''
(root / 'index.html').write_text(html)
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
handler = functools.partial(QuietHandler, directory=str(root))
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as p:
        executable = shutil.which('chromium') if args.browser == 'chromium' else None
        browser = getattr(p, args.browser).launch(headless=True, **({'executable_path': executable} if executable else {}))
        page = browser.new_page()
        page.set_default_timeout(20000)
        page.on("console", lambda message: print("console:", message.type, message.text, flush=True))
        errors, requests = [], []
        page.on('pageerror', lambda error: (errors.append(str(error)), print('pageerror:', str(error), flush=True)))
        page.on('request', lambda request: requests.append(request.url))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.ready && audio.readyState >= 2')
        assert not any('voice-pitch.worker' in url for url in requests), 'worker fetched while disabled'
        page.click('#show')
        page.wait_for_function("['ready','error'].includes(window.state?.status)")
        diagnostics = page.evaluate('''() => ({state, workerReady, workersCreated, audioEvents,
            contexts: contexts.map(context => ({state: context.state, time: context.currentTime,
                sampleRate: context.sampleRate})), userActivation: navigator.userActivation?.hasBeenActive})''')
        (root / 'startup.json').write_text(json.dumps(diagnostics, indent=2))
        assert page.evaluate("state.status === 'ready'"), json.dumps(diagnostics)
        assert page.evaluate('workersCreated === 1')
        assert any('voice-pitch.worker' in url for url in requests), 'worker was not loaded on demand'
        assert 'loading' in page.evaluate('window.states')
        page.click('#play')
        try:
            page.wait_for_function('state.points.filter(p => p.hz > 210 && p.hz < 230).length >= 8')
        except Exception:
            sampling = page.evaluate('''() => {
              const analyser = controller.analyser;
              const samples = analyser && new Float32Array(analyser.fftSize);
              if (samples) analyser.getFloatTimeDomainData(samples);
              return {
                state, states, audioEvents, audio: {time: audio.currentTime, paused: audio.paused,
                  ended: audio.ended, readyState: audio.readyState, error: audio.error?.message},
                context: contexts.map(context => ({state: context.state, time: context.currentTime})),
                controller: {pending: controller.pending, lastAudioTime: controller.lastAudioTime,
                  lastSample: controller.lastSample, frame: controller.frame},
                waveform: samples && {min: Math.min(...samples), max: Math.max(...samples)}
              };
            }''')
            (root / 'sampling.json').write_text(json.dumps(sampling, indent=2))
            print('sampling:', json.dumps(sampling), flush=True)
            raise
        assert 'L' in page.evaluate('paths.pitch')
        before = page.evaluate('audio.currentTime')
        page.evaluate('controller.setEnabled(false)')
        page.wait_for_function('(before) => audio.currentTime > before + .15', arg=before)
        assert page.evaluate('captured.length === 1 && routes[0].size === 1 && contextCloses === 0')
        page.click('#show')
        page.wait_for_function("state.status === 'ready' && state.points.length > 3")
        assert page.evaluate('captured.length === 1'), 'same element captured twice'
        page.evaluate('controller.setVisible(false)')
        assert page.evaluate('routes[0].size === 1 && contextCloses === 0')
        page.evaluate('controller.setVisible(true)')
        page.wait_for_function("state.status === 'ready' && state.points.length > 2")
        page.evaluate('audio.currentTime = 7')
        page.wait_for_function('state.points.length > 2 && state.points.every(p => p.time > 6.8)')
        page.evaluate('audio.pause()')
        page.wait_for_timeout(120)
        count_before = page.evaluate('state.points.length')
        page.wait_for_timeout(120)
        assert page.evaluate('state.points.length') == count_before, 'analysis continued while paused'
        page.evaluate('controller.dispose()')
        assert page.evaluate('contextCloses === 1 && routes[0].size === 0')
        assert not errors, errors
        print(json.dumps({'browser': args.browser, 'transport': 'HTTP modules', 'passed': ['no eager worker', 'worker handshake/loading', 'real 220Hz contour', 'off keeps playback', 'reuse audio capture', 'hide keeps route', 'seek drops stale trace', 'pause stops samples', 'dispose closes context'], 'pageErrors': errors}))
        browser.close()
finally:
    server.shutdown()
