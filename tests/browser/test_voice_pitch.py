"""Voice pitch in the actual production app, using real local audio and its worker.
Run after BASE_PATH=/reader-web pnpm build. No seeded database or mocked estimator.
"""
import io
import json
import math
from pathlib import Path
import struct
import threading
import unittest
import wave
from playwright.sync_api import sync_playwright, expect
from test_static_reader import ThreadingHTTPServer
import test_whispersync as existing

OUTPUT = Path('test-results/voice-pitch-app')


def voice_fixture():
    """Deterministic changing F0, amplitude and unvoiced gaps; not recorded speech."""
    rate = 16000
    phase = 0
    samples = bytearray()
    for i in range(rate * 40):
        t = i / rate
        hz = 190 + 80 * math.sin(t * math.pi / 2)
        phase += 2 * math.pi * hz / rate
        envelope = 0 if t % 3 > 2.65 else 0.25 + 0.35 * math.sin(t * 3) ** 2
        samples.extend(struct.pack('<h', round(24000 * envelope * math.sin(phase))))
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        stream.writeframes(samples)
    return output.getvalue()


class PitchHandler(existing.StaticHandler):
    analysis_requests = []

    def do_GET(self):
        if ('voice-pitch.worker-' in self.path or
                'swift-f0-0.3.0-' in self.path or
                'ort-wasm-simd-threaded-' in self.path):
            self.analysis_requests.append(self.path)
        super().do_GET()


class VoicePitchBrowser(existing.WhispersyncBrowser):
    @classmethod
    def setUpClass(cls):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), PitchHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        launch = {'headless': True}
        if existing.BROWSER_OPTIONS.executable:
            launch['executable_path'] = existing.BROWSER_OPTIONS.executable
        cls.browser = getattr(cls.playwright, existing.BROWSER_OPTIONS.browser).launch(**launch)
        cls.wav = voice_fixture()

    def setUp(self):
        super().setUp()
        self.context.add_init_script('''(() => {
          window.__pitchQA = {created: 0, terminated: 0, results: []}
          const NativeWorker = window.Worker
          window.Worker = class extends NativeWorker {
            constructor(url, options) {
              super(url, options)
              this.pitch = String(url).includes('voice-pitch.worker-')
              if (this.pitch) {
                __pitchQA.created++
                this.addEventListener('message', ({data}) => {
                  if (data?.type === 'result') {
                    __pitchQA.results.push(data.result)
                    if (__pitchQA.results.length > 64) __pitchQA.results.shift()
                  }
                })
              }
            }
            terminate() {
              if (this.pitch) __pitchQA.terminated++
              return super.terminate()
            }
          }
        })()''')
        self.analysis_start = len(PitchHandler.analysis_requests)

    def tearDown(self):
        try:
            report = self.page.evaluate('''() => ({qa: window.__pitchQA,
              text: document.querySelector('[data-testid="voice-pitch"]')?.innerText,
              audio: [...document.querySelectorAll('audio')].map(a => ({time: a.currentTime,
                paused: a.paused, ended: a.ended, readyState: a.readyState}))})''')
            report['workerRequests'] = PitchHandler.analysis_requests[self.analysis_start:]
            (OUTPUT / (self._testMethodName + '.json')).write_text(json.dumps(report, indent=2))
        finally:
            super().tearDown()

    def prepare(self, dark=False, mobile=False):
        self.page.emulate_media(color_scheme='dark' if dark else 'light', reduced_motion='reduce')
        self.page.set_viewport_size({'width': 390 if mobile else 1280, 'height': 844 if mobile else 1000})
        self.open_fixture('continuous', 'horizontal-tb')
        self.page.locator('input[type=file][accept*=".mp3"]').set_input_files(
            {'name': 'pitch-contour.wav', 'mimeType': 'audio/wav', 'buffer': self.wav})
        expect(self.page.get_by_role('button', name='Show voice pitch', exact=True)).to_be_enabled()
        self.page.evaluate('''() => Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(Error('offline shell did not install')), 20000))
        ]).then(() => true)''')
        self.assertEqual([], PitchHandler.analysis_requests[self.analysis_start:], 'eager pitch runtime download')
        self.assertEqual(0, self.page.evaluate('__pitchQA.created'))
        self.strip = self.page.get_by_test_id('voice-pitch')
        expect(self.strip.get_by_role('button', name='Show voice pitch')).to_have_attribute('aria-expanded', 'false')
        self.strip.get_by_role('button', name='Show voice pitch').press('Enter')
        expect(self.strip.get_by_text('Ready when you press Play', exact=True)).to_be_visible(timeout=20000)
        self.assertEqual(1, self.page.evaluate('__pitchQA.created'))
        self.page.locator('.panel').get_by_role('button', name='Play', exact=True).click()
        self.page.wait_for_function('() => __pitchQA.results.filter(r => r.hz > 85 && r.hz < 520).length >= 8', timeout=20000)
        self.page.wait_for_function('() => document.querySelector("audio").currentTime > 8.1', timeout=20000)
        self.page.locator('.panel').get_by_role('button', name='Pause', exact=True).click()
        expect(self.strip.get_by_text('Paused · trace held', exact=True)).to_be_visible()
        expect(self.strip.locator('path.pitch')).to_have_attribute('d', __import__('re').compile('.*L.*'))
        requested = PitchHandler.analysis_requests[self.analysis_start:]
        self.assertTrue(any('voice-pitch.worker-' in path for path in requested))
        self.assertTrue(any('swift-f0-0.3.0-' in path for path in requested))
        self.assertTrue(any('ort-wasm-simd-threaded-' in path for path in requested))
        self.strip.scroll_into_view_if_needed()

    def capture(self, name):
        self.strip.screenshot(path=str(OUTPUT / f'{name}.png'))
        styles = self.strip.evaluate('''el => ({foreground: getComputedStyle(el).color,
          waveform: getComputedStyle(el.querySelector('.waveform')).fill,
          pitch: getComputedStyle(el.querySelector('.pitch')).stroke,
          haloOutline: getComputedStyle(el.querySelector('.pitch-halo')).outlineStyle,
          writingMode: getComputedStyle(el).writingMode,
          width: el.getBoundingClientRect().width, viewport: innerWidth,
          buttonHeight: el.querySelector('button').getBoundingClientRect().height})''')
        self.assertEqual(styles['foreground'], styles['waveform'])
        self.assertEqual('rgb(255, 216, 61)', styles['pitch'])
        self.assertEqual('none', styles['haloOutline'], 'global outline utility must not box the trace')
        self.assertEqual('horizontal-tb', styles['writingMode'])
        self.assertLessEqual(styles['width'], styles['viewport'])
        self.assertGreaterEqual(styles['buttonHeight'], 44)
        (OUTPUT / f'{name}-styles.json').write_text(json.dumps(styles, indent=2))

    def test_voice_pitch_light_playback_and_lifetime(self):
        self.prepare()
        self.capture('desktop-light')
        path = self.strip.locator('path.pitch').get_attribute('d')
        self.page.wait_for_timeout(400)
        self.assertEqual(path, self.strip.locator('path.pitch').get_attribute('d'))
        self.strip.get_by_role('button', name='Hide voice pitch').click()
        self.assertEqual(1, self.page.evaluate('__pitchQA.terminated'))
        expect(self.strip.get_by_role('img')).not_to_be_visible()
        position = self.page.locator('audio').evaluate('a => a.currentTime')
        self.page.locator('.panel').get_by_role('button', name='Play', exact=True).click()
        self.page.wait_for_function('(t) => document.querySelector("audio").currentTime > t + .3', arg=position)
        self.strip.get_by_role('button', name='Show voice pitch').click()
        expect(self.strip.locator('path.pitch')).to_have_attribute('d', __import__('re').compile('.*L.*'), timeout=10000)
        self.page.get_by_role('dialog').press('Escape')
        expect(self.page.get_by_role('dialog')).not_to_be_visible()
        self.page.wait_for_function('() => __pitchQA.created === __pitchQA.terminated')
        position = self.page.locator('audio').evaluate('a => a.currentTime')
        self.page.wait_for_function('(t) => document.querySelector("audio").currentTime > t + .3', arg=position)
        self.open_panel()
        expect(self.strip.get_by_role('button', name='Hide voice pitch')).to_be_visible()
        expect(self.strip.locator('path.pitch')).to_have_attribute('d', __import__('re').compile('.*L.*'), timeout=10000)
        self.page.locator('.panel').get_by_role('button', name='Pause', exact=True).click()
        self.page.locator('.panel').get_by_role('button', name='+10 seconds', exact=True).click()
        expect(self.strip.locator('path.pitch')).to_have_attribute('d', '')
        self.page.wait_for_timeout(200)
        expect(self.strip.locator('path.pitch')).to_have_attribute('d', '')

    def test_voice_pitch_mobile_dark_accessibility(self):
        self.prepare(dark=True, mobile=True)
        self.capture('mobile-dark')
        summary = self.strip.locator('summary')
        self.assertGreaterEqual(summary.bounding_box()['height'], 43.99)
        summary.press('Enter')
        expect(self.strip.locator('details p')).to_be_visible()
        self.strip.locator('summary').press('Enter')
        self.strip.get_by_role('button', name='Hide voice pitch').press('Space')
        expect(self.strip.get_by_role('button', name='Show voice pitch')).to_be_focused()
        expect(self.strip.get_by_role('button', name='Show voice pitch')).to_have_attribute('aria-expanded', 'false')


    def test_voice_pitch_short_enlarged_panel_keeps_chart_and_controls_bounded(self):
        self.prepare(dark=True, mobile=True)
        panel = self.page.get_by_role('dialog', name='Audiobook', exact=True)
        scroll = panel.locator('.audiobook-scroll')
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.page.wait_for_function('e => e.scrollHeight > e.clientHeight', arg=scroll.element_handle())

        toggle = self.strip.get_by_role('button', name='Hide voice pitch', exact=True)
        summary = self.strip.locator('summary')
        chart = self.strip.locator('.chart')
        for control in (toggle, summary):
            box = control.bounding_box()
            self.assertGreaterEqual(box['height'], 43.99)
            self.assertLessEqual(box['x'] + box['width'], 321)
        self.assertLessEqual(toggle.bounding_box()['height'], 72)
        self.assertLessEqual(chart.bounding_box()['height'], 161)
        self.assertLessEqual(self.strip.evaluate('e => e.scrollWidth-e.clientWidth'), 1)

        summary.focus()
        summary.press('Enter')
        expect(self.strip.locator('details p')).to_be_visible()
        self.assertLessEqual(
            self.strip.locator('details p').evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        self.assertLessEqual(self.strip.evaluate('e => e.scrollWidth-e.clientWidth'), 1)

        scroll.evaluate('e => { e.scrollTop = e.scrollHeight; }')
        self.page.wait_for_function('e => e.scrollTop > 0', arg=scroll.element_handle())
        close = panel.get_by_role('button', name='Close audiobook', exact=True)
        box = close.bounding_box()
        viewport = self.page.evaluate('''() => {
          const v=visualViewport;
          return {
            left:v?.offsetLeft ?? 0, top:v?.offsetTop ?? 0,
            right:(v?.offsetLeft ?? 0)+(v?.width ?? innerWidth),
            bottom:(v?.offsetTop ?? 0)+(v?.height ?? innerHeight)
          };
        }''')
        self.assertGreaterEqual(box['width'], 43.99)
        self.assertGreaterEqual(box['height'], 43.99)
        self.assertGreaterEqual(box['x'], viewport['left'] - 1)
        self.assertGreaterEqual(box['y'], viewport['top'] - 1)
        self.assertLessEqual(box['x'] + box['width'], viewport['right'] + 1)
        self.assertLessEqual(box['y'] + box['height'], viewport['bottom'] + 1)
        self.assertTrue(close.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))

        self.page.screenshot(
            path=str(OUTPUT / 'short-enlarged-panel.png'),
            full_page=True
        )
        close.focus()
        close.press('Enter')
        expect(panel).not_to_be_visible()
        trigger = self.page.locator('#ttu-page-footer button[aria-haspopup="dialog"]')
        expect(trigger).to_be_focused()
        self.page.evaluate('document.documentElement.style.fontSize = ""')


def load_tests(loader, tests, pattern):
    # Reuse fixtures, not all inherited Whispersync test cases.
    return unittest.TestSuite(VoicePitchBrowser(name) for name in loader.getTestCaseNames(VoicePitchBrowser)
                              if name.startswith('test_voice_pitch_'))


if __name__ == '__main__':
    unittest.main(argv=[__file__, *existing.UNITTEST_ARGS])
