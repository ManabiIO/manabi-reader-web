"""Layered page turns in the built Reader, including real touch and wheel input."""
import os
import threading
from pathlib import Path
import unittest
from playwright.sync_api import expect, sync_playwright
from test_static_reader import ReaderBrowser, linked_epub, ThreadingHTTPServer, StaticHandler

P = "document.querySelector('foliate-paginator')"


class FoliateSlide(ReaderBrowser):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()
        cls.browser = getattr(cls.playwright, os.environ.get('SLIDE_BROWSER', 'chromium')).launch()

    def setUp(self):
        super().setUp()
        self.page.set_default_timeout(8000)
        self.context.add_init_script("""(() => {
          const attach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function(options) {
            const root = attach.call(this, options);
            if (this.localName === 'foliate-paginator') window.slideRoot = root;
            return root;
          };
        })()""")

    def open_slide(self, rtl=False, mobile=False):
        self.page.set_viewport_size({'width': 390 if mobile else 1100, 'height': 844 if mobile else 780})
        self.open_book(writing='vertical-rl' if rtl else 'horizontal-tb', foliate=True)
        self.page.wait_for_function(f"() => {P}?.page >= 1 && {P}?.pages > 3")
        self.page.evaluate(f"""() => {{
          window.turnCommits = 0;
          {P}.addEventListener('relocate', e => {{if(e.detail.reason === 'page') window.turnCommits++}});
        }}""")

    def pose(self):
        return self.page.evaluate(f"""() => {{
          const p = {P}, root = window.slideRoot;
          const top = root.querySelector('#top'), sheet = root.querySelector('.slide-sheet');
          const x = el => new DOMMatrix(getComputedStyle(el).transform).m41;
          const rect = el => {{const r=el.getBoundingClientRect();return {{x:r.x,y:r.y,width:r.width,height:r.height}}}};
          const surface = el => el && ({{
            bounds:rect(el), shade:rect(el.querySelector('.slide-shade')),
            background:rect(el.querySelector('#background')),
            shadow:getComputedStyle(el).boxShadow, filter:getComputedStyle(el).filter,
            insets:['Top','Right','Bottom','Left'].map(side => parseFloat(getComputedStyle(el)['padding'+side]))
          }});
          return {{page:p.page, index:p.getContents()[0].index, width:p.getBoundingClientRect().width,
            host:rect(p), viewport:{{width:visualViewport.width,height:visualViewport.height}},
            surfaces:sheet ? [surface(top),surface(sheet)] : [],
            progress:Number(p.dataset.turnProgress || 0), commits:window.turnCommits,
            frames:root.querySelectorAll('iframe').length,
            currentX:x(top), neighborX:sheet ? x(sheet) : null,
            currentShade:Number(top.querySelector('.slide-shade')?.style.opacity || 0),
            neighborShade:Number(sheet?.querySelector('.slide-shade')?.style.opacity || 0),
            paper:getComputedStyle(root.querySelector('#background')).backgroundColor,
            radius:getComputedStyle(top).borderRadius,
            neighborRadius:sheet ? getComputedStyle(sheet).borderRadius : null,
            currentZ:Number(getComputedStyle(top).zIndex),
            neighborZ:sheet ? Number(getComputedStyle(sheet).zIndex) : null}};
        }}""")

    def screenshot(self, name):
        folder = Path('test-results/foliate-slide')
        folder.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(folder / (os.environ.get('SLIDE_BROWSER', 'chromium') + '-' + name + '.png')))

    def assert_pose(self, p, progress, direction, rtl):
        sign = 1 if rtl else -1
        width = p['width']
        self.assertAlmostEqual(p['currentX'], sign * width * (progress if direction == 1 else -0.15 * progress), delta=1)
        self.assertAlmostEqual(p['neighborX'], sign * width * (-0.15 * (1-progress) if direction == 1 else 1-progress), delta=1)
        self.assertAlmostEqual(p['currentShade'], 0 if direction == 1 else 0.24 * progress, delta=.005)
        self.assertAlmostEqual(p['neighborShade'], .24 * (1-progress) if direction == 1 else 0, delta=.005)
        self.assertNotIn(p['paper'], ['transparent', 'rgba(0, 0, 0, 0)'])
        self.assertEqual(p['radius'], p['neighborRadius'])
        self.assertGreater(float(p['radius'].replace('px', '')), 0)
        self.assertEqual(p['frames'], 2)
        self.assertGreater(p['currentZ'] if direction == 1 else p['neighborZ'], p['neighborZ'] if direction == 1 else p['currentZ'])
        for axis in ['x', 'y']:
            self.assertAlmostEqual(p['host'][axis], 0, delta=1)
        for axis in ['width', 'height']:
            self.assertAlmostEqual(p['host'][axis], p['viewport'][axis], delta=1)
        for surface in p['surfaces']:
            self.assertEqual(surface['shadow'], 'none')
            self.assertEqual(surface['filter'], 'none')
            self.assertTrue(all(inset > 0 for inset in surface['insets']))
            for axis in ['width', 'height']:
                self.assertAlmostEqual(surface['bounds'][axis], p['viewport'][axis], delta=1)
            self.assertAlmostEqual(surface['bounds']['y'], 0, delta=1)
            for layer in ['shade', 'background']:
                for axis in ['x', 'y', 'width', 'height']:
                    self.assertAlmostEqual(surface[layer][axis], surface['bounds'][axis], delta=1,
                                           msg=f"{layer} must cover the full sheet ({axis})")

    def test_keyframes_ltr(self):
        self.check_keyframes(False)

    def test_keyframes_rtl(self):
        self.check_keyframes(True)

    def check_keyframes(self, rtl):
        self.open_slide(rtl, mobile=True)
        # Begin from an interior page so both neighbors exist.
        self.page.evaluate(f"async () => {{ await {P}.next(); }}")
        initial = self.pose()
        for direction in [1, -1]:
            self.page.evaluate(f"async dir => {{window.prepared = await {P}.preparePageTurn(dir)}}", direction)
            for fraction in [.25, .5, .75, .5, .25]:
                self.page.evaluate('p => window.prepared.update(p)', fraction)
                pose = self.pose()
                self.assert_pose(pose, fraction, direction, rtl)
                self.assertEqual(pose['page'], initial['page'])
                self.assertEqual(pose['commits'], initial['commits'])
                self.screenshot(f"{'rtl' if rtl else 'ltr'}-{'forward' if direction == 1 else 'back'}-{int(fraction*100)}")
            self.page.evaluate('window.prepared.cancel()')
            self.assertEqual(self.pose()['frames'], 1)
        self.page.evaluate(f"async () => {{const t=await {P}.preparePageTurn(1); t.update(1); t.commit();}}")
        self.assertEqual(self.pose()['page'], initial['page'] + 1)
        self.assertEqual(self.pose()['commits'], initial['commits'] + 1)

    def test_touch_hold_reverse_cancel_and_commit_rtl(self):
        self.check_touch(True)

    def test_touch_hold_reverse_cancel_and_commit_ltr(self):
        self.check_touch(False)

    def check_touch(self, rtl):
        if os.environ.get('SLIDE_BROWSER') == 'webkit':
            self.skipTest('Trusted touch dragging uses Chromium CDP; WebKit runs geometry and wheel coverage.')
        self.open_slide(rtl, mobile=True)
        session = self.context.new_cdp_session(self.page)
        session.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
        box = self.page.locator('foliate-paginator').bounding_box()
        x, y, width = box['x'] + box['width'] * (.2 if rtl else .8), box['y'] + box['height'] * .55, box['width'] * (1 if rtl else -1)
        def touch(kind, point=None):
            session.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if point is None else [{'x':point, 'y':y, 'id':1}]})
        initial = self.pose()
        touch('touchStart', x)
        touch('touchMove', x + width * .55)
        self.page.wait_for_function(f"() => Number({P}.dataset.turnProgress) > .5")
        self.assert_pose(self.pose(), .55, 1, rtl)
        self.screenshot(f'touch-{"rtl" if rtl else "ltr"}-forward-held')
        touch('touchMove', x + width * .2)
        self.page.wait_for_function(f"() => Number({P}.dataset.turnProgress) < .3")
        self.assertEqual(self.pose()['page'], initial['page'])
        touch('touchEnd')
        self.page.wait_for_function(f"() => !{P}.hasAttribute('data-turn-progress')")
        self.assertEqual(self.pose()['commits'], initial['commits'])
        touch('touchStart', x)
        touch('touchMove', x + width * .62)
        self.page.wait_for_function(f"() => Number({P}.dataset.turnProgress) > .6")
        touch('touchEnd')
        self.page.wait_for_function(f"() => {P}.page === {initial['page'] + 1}")
        touch('touchStart', x + width * .6)
        touch('touchMove', x)
        self.page.wait_for_function(f"() => Number({P}.dataset.turnProgress) < -.5")
        self.screenshot(f'touch-{"rtl" if rtl else "ltr"}-back-held')
        touch('touchEnd')
        self.page.wait_for_function(f"() => {P}.page === {initial['page']}")
        self.assertEqual(self.pose()['commits'], initial['commits'] + 2)

    def test_mouse_wheel_keyboard_selection_and_reduced_motion(self):
        self.open_slide(False)
        initial = self.pose()
        box = self.page.locator('foliate-paginator').bounding_box()
        self.page.mouse.move(box['x'] + box['width'] * .55, box['y'] + box['height'] * .55)
        self.page.mouse.wheel(box['width'] * .7, 0)
        self.page.wait_for_function(f"() => {P}.page === {initial['page'] + 1}")
        self.page.mouse.wheel(-box['width'] * .7, 0)
        self.page.wait_for_function(f"() => {P}.page === {initial['page']}")
        self.page.emulate_media(reduced_motion='reduce')
        self.page.mouse.click(box['x'] + box['width'] * .55, box['y'] + box['height'] * .55)
        self.page.keyboard.press('ArrowRight')
        self.page.wait_for_function(f"() => {P}.page === {initial['page'] + 1}")
        self.page.evaluate(f"""() => {{
          const doc={P}.getContents()[0].doc;
          const range=doc.createRange();range.selectNodeContents(doc.querySelector('p'));
          doc.getSelection().removeAllRanges();doc.getSelection().addRange(range);
        }}""")
        selected = self.pose()['page']
        self.page.mouse.wheel(0, box['width'] * .8)
        self.page.wait_for_timeout(350)
        self.assertEqual(self.pose()['page'], selected)
        self.assertTrue(self.page.evaluate(f"{P}.getContents()[0].doc.getSelection().toString().length > 0"))
        self.page.evaluate(f"{P}.getContents()[0].doc.getSelection().removeAllRanges()")
        # Genuine keyboard input focused in the active iframe.
        self.page.mouse.click(box['x'] + box['width'] * .55, box['y'] + box['height'] * .55)
        self.page.keyboard.press('ArrowLeft')
        self.page.wait_for_function(f"() => {P}.page === {selected - 1}")

    def test_rtl_horizontal_and_vertical_wheel_and_mouse_margin_drag(self):
        self.open_slide(True)
        initial = self.pose()['page']
        box = self.page.locator('foliate-paginator').bounding_box()
        self.page.mouse.move(box['x'] + box['width'] * .6, box['y'] + box['height'] * .55)
        self.page.mouse.wheel(-box['width'] * .7, 0)
        self.page.wait_for_function(f"() => {P}.page === {initial + 1}")
        self.page.mouse.wheel(box['width'] * .7, 0)
        self.page.wait_for_function(f"() => {P}.page === {initial}")
        self.page.mouse.wheel(0, box['width'] * .7)
        self.page.wait_for_function(f"() => {P}.page === {initial + 1}")
        # Start inside the engine gutter, outside the live text iframe.
        start = self.page.evaluate(f"""() => {{
          const p={P}, host=p.getBoundingClientRect(), frame=window.slideRoot.querySelector('iframe').getBoundingClientRect();
          return {{x:host.right-4,y:host.top+host.height*.5,width:host.width}};
        }}""")
        self.page.mouse.move(start['x'], start['y'])
        self.page.mouse.down()
        self.page.mouse.move(start['x'] - start['width'] * .62, start['y'], steps=6)
        self.page.wait_for_function(f"() => Number({P}.dataset.turnProgress) < -.5")
        self.screenshot('mouse-margin-rtl-back-held')
        self.page.mouse.up()
        self.page.wait_for_function(f"() => {P}.page === {initial}")

    def test_theme_update_cancels_preview_and_keeps_opaque_paper(self):
        self.open_slide(False, mobile=True)
        initial = self.pose()['page']
        self.page.evaluate(f"async () => {{window.prepared=await {P}.preparePageTurn(1);window.prepared.update(.4)}}")
        self.page.evaluate("document.documentElement.style.setProperty('--reader-background-color','rgb(24, 24, 24)');document.documentElement.style.setProperty('--reader-font-color','rgb(240, 240, 240)')")
        self.page.wait_for_function(f"() => !{P}.hasAttribute('data-turn-progress')")
        self.assertFalse(self.page.evaluate('window.prepared.commit()'))
        self.page.wait_for_function("() => getComputedStyle(window.slideRoot.querySelector('#background')).backgroundColor === 'rgb(24, 24, 24)'")
        self.assertEqual(self.pose()['page'], initial)
        self.page.evaluate(f"async () => {{window.prepared=await {P}.preparePageTurn(1);window.prepared.update(.5)}}")
        self.assert_pose(self.pose(), .5, 1, False)
        self.screenshot('dark-forward-held')
        self.page.evaluate('window.prepared.cancel()')

    def test_preparation_is_fenced_by_navigation_resize_styles_and_destroy(self):
        self.open_slide(False)
        for operation in ['navigation', 'resize', 'styles']:
            self.page.evaluate(f"async () => {{window.prepared = await {P}.preparePageTurn(1); window.prepared.update(.6)}}")
            if operation == 'navigation':
                self.page.evaluate(f"async () => {{await {P}.goTo({{index:0,anchor:1}})}}")
            elif operation == 'resize':
                self.page.set_viewport_size({'width': 960, 'height': 780})
            else:
                self.page.evaluate(f"{P}.setStyles('body {{font-size:24px; writing-mode:horizontal-tb}}')")
            self.page.wait_for_function(f"() => !{P}.hasAttribute('data-turn-progress')")
            self.assertFalse(self.page.evaluate('window.prepared.commit()'))
            self.assertEqual(self.pose()['frames'], 1)
            self.page.evaluate(f"async () => {{await {P}.goTo({{index:0,anchor:0}})}}")
        self.page.evaluate(f"async () => {{window.prepared = await {P}.preparePageTurn(1); {P}.destroy();}}")
        self.assertFalse(self.page.evaluate('window.prepared.commit()'))

    def test_chapter_seams_and_pending_neighbor_load(self):
        title, archive = linked_epub()
        self.context.add_init_script("localStorage.setItem('manabi-dev-foliate-epub','true');localStorage.setItem('viewMode','paginated');")
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({'name':'linked.epub','mimeType':'application/epub+zip','buffer':archive})
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        self.page.wait_for_function(f"() => {P}?.page === 1")
        self.assertTrue(self.page.evaluate(f"""async () => {{
          const p={P}; const t=await p.preparePageTurn(1);
          if (!t || p.getContents()[0].index !== 0) return false;
          t.update(.5); t.commit(); return p.getContents()[0].index === 1;
        }}"""))
        self.assertTrue(self.page.evaluate(f"async () => {{const t=await {P}.preparePageTurn(-1);return t.commit() && {P}.getContents()[0].index===0}}"))
        # The promoted iframe must retain the real app's chapter-link listeners
        # and distinguish identical fragment IDs in different resources.
        self.page.evaluate(f"{P}.getContents()[0].doc.querySelector('#to-second').click()")
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.index === 1")
        self.assertEqual(self.page.evaluate(f"{P}.getContents()[0].doc.querySelector('#note').textContent"), '第二章の注')
        self.page.evaluate(f"{P}.getContents()[0].doc.querySelector('#to-first').click()")
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.index === 0")
        self.assertTrue(self.page.evaluate(f"""async () => {{
          const p={P}, section=p.sections[1], load=section.load;
          let release;
          section.load=async () => {{await new Promise(r=>release=r);return load();}};
          const pending=p.preparePageTurn(1);
          await p.goTo({{index:0}});
          release();
          const stale=await pending;
          section.load=load;
          return stale===null && p.getContents()[0].index===0;
        }}"""))
        self.assertIsNone(self.page.evaluate(f"async () => await {P}.preparePageTurn(-1)"))
        self.page.evaluate(f"async () => await {P}.goTo({{index:1,anchor:1}})")
        self.assertIsNone(self.page.evaluate(f"async () => await {P}.preparePageTurn(1)"))


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(FoliateSlide(name) for name in FoliateSlide.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
