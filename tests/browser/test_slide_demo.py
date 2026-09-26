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

    def test_square_pages_ignore_legacy_radius(self):
        for width, height in [(1100, 780), (390, 844), (844, 390)]:
            self.page.set_viewport_size({'width': width, 'height': height})
            self.page.wait_for_timeout(180)
            self.assertEqual(self.state()['radius'], '0px')
        self.page.evaluate("document.querySelector('#mount').style.setProperty('--reader-page-radius','0px 12px 24px 36px')")
        self.page.evaluate('async()=>{window.held=await slideDemo.paginator.preparePageTurn(1);held.update(.5)}')
        radii = self.page.evaluate("[testRoot.querySelector('#top'),testRoot.querySelector('.slide-sheet')].map(el=>getComputedStyle(el).borderRadius)")
        self.assertEqual(radii, ['0px'] * 2)
        self.assertEqual(self.page.locator('#corners,#radius').count(), 0)
        self.page.evaluate("held.cancel();document.querySelector('#mount').style.removeProperty('--reader-page-radius')")
        self.assertEqual(self.state()['radius'], '0px')

    def set_effect(self, effect):
        self.page.evaluate("value => { const select = document.querySelector('#effect'); select.value = value; select.dispatchEvent(new Event('change')); }", effect)
        self.assertEqual(self.state()['effect'], effect)

    def test_stationary_title_and_theme_correct_overlay(self):
        self.page.evaluate('slideDemo.paginator.goTo({index:0,anchor:.2})')
        for night in [False, True]:
            # The in-app theme, not the OS preference, owns the overlay color.
            self.page.emulate_media(color_scheme='light' if night else 'dark')
            self.page.evaluate("night => {const box=document.querySelector('#night');box.checked=night;box.dispatchEvent(new Event('change'))}", night)
            for direction in [1, -1]:
                initial = self.page.locator('#book-title').bounding_box()
                self.page.evaluate('async d=>{window.held=await slideDemo.paginator.preparePageTurn(d)}', direction)
                for progress in [.25, .5, .75]:
                    self.page.evaluate('p=>held.update(p)', progress)
                    pose = self.page.evaluate("""() => {
                      const top=testRoot.querySelector('#top'), next=testRoot.querySelector('.slide-sheet')
                      return [top, next].map(el => ({
                        shade:getComputedStyle(el.querySelector('.slide-shade')).backgroundColor,
                        opacity:Number(el.querySelector('.slide-shade').style.opacity),
                        x:new DOMMatrix(getComputedStyle(el).transform).m41,
                        number:el.querySelector('.page-indicator').getBoundingClientRect().x,
                        radius:getComputedStyle(el).borderRadius
                      }))
                    }""")
                    self.assertEqual([item['shade'] for item in pose], ['rgb(255, 255, 255)' if night else 'rgb(0, 0, 0)'] * 2)
                    self.assertAlmostEqual(pose[0]['opacity'], .24*progress if direction == -1 else 0, places=5)
                    self.assertAlmostEqual(pose[1]['opacity'], .24*(1-progress) if direction == 1 else 0, places=5)
                    self.assertEqual(self.page.locator('#book-title').bounding_box(), initial)
                    self.assertTrue(self.page.locator('#book-title').is_visible())
                    self.assertNotEqual(pose[0]['x'], 0)
                    # Each folio has the same local geometry; its difference follows the sheets.
                    self.assertAlmostEqual(pose[1]['number']-pose[0]['number'], pose[1]['x']-pose[0]['x'], delta=1)
                self.page.evaluate('held.cancel()')

    def test_none_has_no_frames_or_tail_for_repeating_keys(self):
        self.set_effect('none')
        self.page.evaluate('slideDemo.paginator.focusView()')
        for i in range(6):
            self.page.keyboard.down('ArrowRight')
            self.wait_commits(i+1)
            self.assertEqual(self.page.evaluate("getComputedStyle(testRoot.querySelector('#top')).visibility"), 'visible')
            self.assertTrue(self.page.evaluate("testRoot.querySelector('#top iframe').checkVisibility()"))
        self.assertTrue(self.page.evaluate('turns.every(t=>t.samples.length===0 && t.committed)'))
        self.assertFalse(self.page.evaluate("slideDemo.paginator.hasAttribute('data-turn-progress')"))
        self.page.keyboard.up('ArrowRight')
        self.page.wait_for_timeout(250)
        self.assertEqual(self.state()['commits'], 6)

    def test_none_rtl_forward_back_and_cross_chapter(self):
        self.page.evaluate("document.querySelector('#language').value='ja';document.querySelector('#language').dispatchEvent(new Event('change'))")
        self.page.wait_for_function('() => slideDemo.getState().rtl && slideDemo.paginator.pageCounts.every(n=>n>0)')
        self.set_effect('none')
        self.page.evaluate(INSTRUMENT)
        self.page.evaluate('slideDemo.paginator.goTo({index:0,anchor:1})')
        self.page.evaluate('slideDemo.paginator.focusView()')
        for i in range(3):
            self.page.keyboard.down('ArrowLeft')
            self.wait_commits(i+1)
        self.page.keyboard.up('ArrowLeft')
        self.assertEqual((self.state()['index'], self.state()['page']), (1, 3))
        self.page.keyboard.press('ArrowRight')
        self.wait_commits(4)
        self.assertEqual(self.state()['page'], 2)
        self.assertTrue(self.page.evaluate('turns.every(t=>t.samples.length===0)'))

    def test_none_does_not_reveal_direct_half_pose(self):
        self.set_effect('none')
        self.assertTrue(self.page.locator('#half').is_disabled())
        self.page.evaluate('async()=>{window.held=await slideDemo.paginator.preparePageTurn(1);held.update(.5)}')
        visual = self.page.evaluate("""() => ({
          transform: getComputedStyle(testRoot.querySelector('#top')).transform,
          neighbor: getComputedStyle(testRoot.querySelector('.slide-sheet')).visibility,
          shade: getComputedStyle(testRoot.querySelector('#top .slide-shade')).opacity
        })""")
        self.assertEqual(visual, {'transform':'none','neighbor':'hidden','shade':'0'})
        self.page.evaluate('held.cancel()')
        self.assertEqual(self.state()['commits'], 0)

    def test_none_mouse_drag_waits_for_release_and_short_drag_cancels(self):
        self.set_effect('none')
        for distance, expected in [(300,0),(750,1)]:
            self.page.mouse.move(1080,350)
            self.page.mouse.down()
            self.page.mouse.move(1080-distance,350,steps=10)
            self.page.wait_for_timeout(180)
            self.assertEqual(self.state()['commits'], 0)
            self.assertEqual(self.state()['progress'], 0)
            self.assertEqual(self.page.evaluate("testRoot.querySelectorAll('.slide-sheet').length"),0)
            self.page.mouse.up()
            if expected: self.wait_commits(expected)
            else: self.page.wait_for_timeout(200)
        self.assertTrue(self.page.evaluate('turns.every(t=>t.samples.length===0)'))

    def test_none_trusted_touch_release_and_wheel(self):
        self.set_effect('none')
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.wait_for_timeout(200)
        session=self.context.new_cdp_session(self.page)
        for kind,x in [('touchStart',330),('touchMove',90)]:
            session.send('Input.dispatchTouchEvent', {'type':kind,'touchPoints':[{'x':x,'y':380,'id':1}]})
        self.page.wait_for_timeout(180)
        self.assertEqual(self.state()['commits'],0)
        self.assertEqual(self.state()['progress'],0)
        session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        self.wait_commits(1)
        self.page.mouse.move(370,350)
        self.page.mouse.wheel(0,300)
        self.wait_commits(2)
        self.assertTrue(self.page.evaluate('turns.every(t=>t.samples.length===0)'))

    def test_changing_effect_cancels_reserved_tail_then_slide_can_resume(self):
        self.page.keyboard.down('ArrowRight')
        self.wait_commits(1)
        self.page.keyboard.down('ArrowRight')
        self.page.wait_for_function('() => turns.length === 2')
        self.set_effect('none')
        self.page.keyboard.up('ArrowRight')
        self.page.wait_for_timeout(300)
        self.assertEqual(self.state()['commits'], 1)
        self.assertFalse(self.page.evaluate("slideDemo.paginator.hasAttribute('data-turn-progress')"))
        self.set_effect('slide')
        self.page.keyboard.press('ArrowRight')
        self.wait_commits(2)
        self.assertTrue(self.page.evaluate('turns.at(-1).samples.length > 0'))

    def test_effect_change_fences_pending_chapter_load(self):
        self.page.evaluate('slideDemo.paginator.goTo({index:0,anchor:1})')
        self.page.evaluate("""() => {
          const section=slideDemo.paginator.sections[1], original=section.load.bind(section)
          section.load=async()=>{await new Promise(resolve=>window.releaseChapter=resolve);return original()}
        }""")
        self.page.keyboard.down('ArrowRight')
        self.page.wait_for_function('() => !!window.releaseChapter')
        self.set_effect('none')
        self.page.evaluate('releaseChapter()')
        self.page.keyboard.up('ArrowRight')
        self.page.wait_for_timeout(300)
        self.assertEqual(self.state()['index'],0)
        self.assertEqual(self.state()['commits'],0)
        self.assertEqual(self.page.evaluate("testRoot.querySelectorAll('.slide-sheet').length"),0)

    @unittest.skipUnless(os.environ.get('SLIDE_DEMO_URL'), 'Persistence requires a real origin; covered in served CI')
    def test_effect_persists_across_actual_reload(self):
        self.page.locator('#settings-open').click()
        self.page.locator('#effect').select_option('none')
        self.assertEqual(self.page.evaluate("localStorage.getItem('pageTurnEffect')"),'none')
        self.page.reload()
        self.page.wait_for_function("() => window.slideDemo?.paginator?.page === 1")
        self.assertEqual(self.state()['effect'],'none')
        self.assertEqual(self.page.locator('#effect').input_value(),'none')

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
