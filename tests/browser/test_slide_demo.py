"""Actual reader modules bundled in the standalone demo.

SLIDE_DEMO_URL serves the real file, with normal Blob loading. Without a URL,
load HTML in memory and inject text-only iframe fixtures: Chromium gives distinct
blob:null URLs different opaque origins on about:blank. This mode does NOT test
HTTP, file://, Blob-origin behavior, EPUB import, or the built Svelte application.
No browser policy, sandbox attribute, or assertion is disabled in either mode.
"""
import json
import os
import re
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'test-results' / 'slide-demo'
PRELUDE = r"""
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) {
  const root = attach.call(this, options);
  if (this.localName === 'foliate-paginator') window.testRoot = root;
  return root;
};
"""
FIXTURE = r"""
const blobs = new Map(), texts = new WeakMap(), NativeBlob = Blob;
window.Blob = class extends NativeBlob {
  constructor(parts, options) {
    super(parts, options);
    if (options?.type === 'text/html' && parts.every(p => typeof p === 'string'))
      texts.set(this, parts.join(''));
  }
};
const makeURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = makeURL(blob); blobs.set(url, blob); return url; };
const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
  ...descriptor,
  set(value) {
    const blob = blobs.get(value);
    if (!blob) return descriptor.set.call(this, value);
    const text = texts.get(blob);
    if (text === undefined) throw new Error('Unexpected nontext iframe fixture');
    this.addEventListener('load', () => {
      // Same-section preparation reuses document.URL. Preserve fixture identity.
      Object.defineProperty(this.contentDocument, 'URL', { value });
    }, { capture: true, once: true });
    this.srcdoc = text;
  }
});
"""
INSTRUMENT = r"""() => {
  window.turns = [];
  const p = slideDemo.paginator, prepare = p.preparePageTurn.bind(p);
  p.preparePageTurn = async direction => {
    const turn = await prepare(direction);
    if (!turn) return turn;
    const log = { direction, samples: [], committed: false, cancelled: false };
    turns.push(log);
    return {
      update(progress) { log.samples.push(progress); return turn.update(progress); },
      commit() { const ok = turn.commit(); log.committed = ok; return ok; },
      cancel() { log.cancelled = true; return turn.cancel(); }
    };
  };
}"""


class SlideDemo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        options = {'headless': True}
        if os.environ.get('CHROMIUM_PATH'):
            options['executable_path'] = os.environ['CHROMIUM_PATH']
        cls.browser = cls.playwright.chromium.launch(**options)
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'environment.json').write_text(json.dumps({
            'browser': cls.browser.version,
            'mode': 'served HTML / real Blob URLs' if os.environ.get('SLIDE_DEMO_URL') else 'in-memory HTML / text-only iframe fixture adapter',
            'physicalAppleDevice': False
        }, indent=2))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1100, 'height': 780}, has_touch=True)
        self.page = self.context.new_page()
        self.page.set_default_timeout(5000)
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(re.sub(r'data:text/javascript;base64,[A-Za-z0-9+/=]+', 'BUNDLED_MODULE', e.stack)))
        if os.environ.get('SLIDE_DEMO_URL'):
            self.context.add_init_script(PRELUDE)
            self.page.goto(os.environ['SLIDE_DEMO_URL'])
        else:
            html = (ROOT / 'demos/apple-books-slide-poc/index.html').read_text()
            self.page.set_content(html.replace('<head>', '<head><script>' + PRELUDE + FIXTURE + '</script>', 1))
        self.page.wait_for_function('window.slideDemo?.paginator?.page === 1 && slideDemo.paginator.pageCounts.every(n => n > 0)')
        self.page.evaluate(INSTRUMENT)

    def tearDown(self):
        self.page.screenshot(path=str(OUTPUT / (self._testMethodName + '.png')))
        error_text = self.page.locator('#error').inner_text()
        self.context.close()
        self.assertEqual(error_text, '')
        self.assertEqual(self.errors, [])

    def state(self):
        return self.page.evaluate('slideDemo.getState()')

    def wait_commits(self, count):
        self.page.wait_for_function('n => slideDemo.getState().commits === n', arg=count)

    def test_square_default_and_explicit_per_corner_geometry(self):
        for width, height in [(1100, 780), (390, 844), (844, 390)]:
            self.page.set_viewport_size({'width': width, 'height': height})
            self.page.wait_for_timeout(180)
            self.assertEqual(self.state()['radius'], '0px')
        self.page.evaluate("document.querySelector('#mount').style.setProperty('--reader-page-radius','0px 12px 24px 36px')")
        self.page.evaluate('async()=>{window.held=await slideDemo.paginator.preparePageTurn(1);held.update(.5)}')
        radii = self.page.evaluate("[testRoot.querySelector('#top'),testRoot.querySelector('.slide-sheet')].map(el=>getComputedStyle(el).borderRadius)")
        self.assertEqual(radii, ['0px 12px 24px 36px'] * 2)
        self.page.evaluate("held.cancel();document.querySelector('#mount').style.removeProperty('--reader-page-radius')")
        self.assertEqual(self.state()['radius'], '0px')

    def fast_keys(self, rtl=False, iframe=False):
        if rtl:
            self.page.evaluate("async()=>{document.querySelector('#language').value='ja';document.querySelector('#language').dispatchEvent(new Event('change'));}")
            self.page.wait_for_function('slideDemo.getState().rtl && slideDemo.paginator.page === 1 && slideDemo.paginator.pageCounts.every(n=>n>0)')
            self.page.evaluate(INSTRUMENT)
        if iframe:
            self.page.evaluate('slideDemo.paginator.focusView()')
        key = 'ArrowLeft' if rtl else 'ArrowRight'
        self.page.keyboard.down(key)
        self.page.wait_for_function('turns[0]?.samples.length > 0')
        self.wait_commits(1)
        self.page.wait_for_timeout(220)  # First repeat may arrive long after the first turn.
        for _ in range(5):
            self.page.keyboard.down(key)
            self.page.wait_for_timeout(55)
        self.page.wait_for_function('turns.length === 6')
        self.wait_commits(5)
        self.page.wait_for_timeout(200)  # Holding still must not animate the reserved tail.
        logs = self.page.evaluate('turns')
        self.assertTrue(logs[0]['samples'])
        self.assertTrue(all(not t['samples'] for t in logs[1:]))
        self.assertFalse(logs[-1]['committed'])
        if iframe:
            self.assertTrue(self.page.evaluate('slideDemo.paginator.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.up(key)
        self.wait_commits(6)
        self.assertTrue(self.page.evaluate('turns.at(-1).samples.length > 0'))
        self.page.wait_for_timeout(220)
        self.assertEqual(self.state()['commits'], 6)
        self.assertEqual(self.page.evaluate("testRoot.querySelectorAll('#top iframe,.slide-sheet iframe').length"), 1)

    def test_held_key_outer_document(self):
        self.fast_keys()

    def test_held_key_iframe_ltr(self):
        self.fast_keys(iframe=True)

    def test_held_key_iframe_vertical_rtl(self):
        self.fast_keys(rtl=True, iframe=True)

    def test_button_burst_has_instant_middle_and_quiet_tail(self):
        self.page.evaluate('slideDemo.turn(1)')
        self.page.wait_for_function('turns[0]?.samples.length > 0')
        for _ in range(4):
            self.page.evaluate('slideDemo.turn(1)')
            self.page.wait_for_timeout(30)
        self.wait_commits(4)
        logs = self.page.evaluate('turns')
        self.assertTrue(all(not t['samples'] for t in logs[1:]))
        self.wait_commits(5)
        self.assertTrue(self.page.evaluate('turns.at(-1).samples.length > 0'))

    def test_cross_chapter_repeat_promotes_real_content_once_per_command(self):
        self.page.evaluate('slideDemo.paginator.goTo({index:0,anchor:1})')
        start = self.state()['page']
        self.assertGreater(start, 1)
        self.page.keyboard.down('ArrowRight')
        self.wait_commits(1)
        for _ in range(4):
            self.page.keyboard.down('ArrowRight')
            self.page.wait_for_timeout(45)
        self.page.keyboard.up('ArrowRight')
        self.wait_commits(5)
        self.assertEqual(self.state()['index'], 1)
        self.assertEqual(self.state()['page'], 5)
        self.assertIn('Chapter 2', self.page.evaluate('slideDemo.paginator.getContents()[0].doc.body.textContent'))
        self.assertEqual(self.page.evaluate("testRoot.querySelectorAll('#top iframe,.slide-sheet iframe').length"), 1)

    def test_reversal_and_edge_do_not_lose_intents(self):
        self.page.evaluate('slideDemo.turn(-1)')  # First-page no-op.
        self.page.wait_for_timeout(30)
        for direction in [1, 1, -1, 1]:
            self.page.evaluate('d=>slideDemo.turn(d)', direction)
            self.page.wait_for_timeout(25)
        self.wait_commits(4)
        self.assertEqual(self.state()['page'], 3)

    def test_resize_cancels_reserved_tail_without_ghost_turn(self):
        self.page.keyboard.down('ArrowRight')
        self.wait_commits(1)
        self.page.keyboard.down('ArrowRight')
        self.page.wait_for_function('turns.length === 2')
        self.page.set_viewport_size({'width': 1050, 'height': 780})
        self.page.keyboard.up('ArrowRight')
        self.page.wait_for_timeout(500)
        self.assertEqual(self.state()['commits'], 1)
        self.assertFalse(self.page.evaluate("slideDemo.paginator.hasAttribute('data-turn-progress')"))

    def test_reduced_motion_no_animation_no_reserved_tail(self):
        self.page.emulate_media(reduced_motion='reduce')
        for _ in range(5):
            self.page.keyboard.down('ArrowRight')
            self.page.wait_for_timeout(40)
        self.wait_commits(5)
        self.page.keyboard.up('ArrowRight')
        self.assertTrue(self.page.evaluate('turns.every(t=>t.samples.length===0)'))

    def test_mouse_margin_drag_holds_and_reverses(self):
        self.page.mouse.move(1080, 350)
        self.page.mouse.down()
        self.page.mouse.move(700, 350, steps=8)
        self.page.wait_for_function('Number(slideDemo.paginator.dataset.turnProgress) > .3')
        before = self.state()['progress']
        self.page.wait_for_timeout(180)
        self.assertAlmostEqual(self.state()['progress'], before, places=3)
        self.page.mouse.move(900, 350, steps=6)
        self.page.wait_for_function('Number(slideDemo.paginator.dataset.turnProgress) < .2')
        self.page.mouse.up()
        self.page.wait_for_function("!slideDemo.paginator.hasAttribute('data-turn-progress')")
        self.assertEqual(self.state()['commits'], 0)

    def test_trusted_touch_holds_reverses_and_finishes(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.wait_for_timeout(300)
        session = self.context.new_cdp_session(self.page)
        def touch(kind, x=None):
            session.send('Input.dispatchTouchEvent', {'type':kind, 'touchPoints':[] if x is None else [{'x':x,'y':380,'id':1}]})
        touch('touchStart', 330)
        touch('touchMove', 100)
        self.page.wait_for_function('Number(slideDemo.paginator.dataset.turnProgress) > .5')
        touch('touchMove', 250)
        self.page.wait_for_function('Number(slideDemo.paginator.dataset.turnProgress) < .3')
        touch('touchEnd')
        self.page.wait_for_function("!slideDemo.paginator.hasAttribute('data-turn-progress')")
        self.assertEqual(self.state()['commits'], 0)
        touch('touchStart', 330)
        touch('touchMove', 90)
        self.page.wait_for_function('Number(slideDemo.paginator.dataset.turnProgress) > .5')
        touch('touchEnd')
        self.wait_commits(1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
