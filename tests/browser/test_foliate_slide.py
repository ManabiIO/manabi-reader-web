"""Layered page turns in the built Reader, including real touch and wheel input."""
import os
import io
import threading
import zipfile
from pathlib import Path
import unittest
from playwright.sync_api import expect, sync_playwright
from test_static_reader import ReaderBrowser, linked_epub, ThreadingHTTPServer, StaticHandler

P = "document.querySelector('foliate-paginator')"


def numbered_epub():
    output = io.BytesIO()
    title = 'Global page number acceptance'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        manifest = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(4))
        spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(4))
        archive.writestr('content.opf', f'<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">{title}</dc:title></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>')
        for i in range(4):
            body = f'<h1>Chapter {i+1}</h1>' + ''.join(f'<p>{n+1}. 日本語の本を読みます。次のページも丁寧に読みます。</p>' for n in range(24 + i * 12))
            archive.writestr(f'c{i}.xhtml', f'<html><body>{body}</body></html>')
    return title, output.getvalue()


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
        # Exercise real imports without depending on WebKit's separate native
        # IndexedDB Blob-write failure. Image/security regressions retain images.
        self.open_book(writing='vertical-rl' if rtl else 'horizontal-tb', foliate=True, include_images=False)
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
            insets:['Top','Right','Bottom','Left'].map(side => parseFloat(getComputedStyle(el)['padding'+side])),
            indicator:rect(el.querySelector('.page-indicator')),
            label:el.querySelector('.page-indicator').textContent,
            globalPage:Number(el.querySelector('.page-indicator').dataset.page)
          }});
          return {{page:p.page, index:p.getContents()[0].index, width:p.getBoundingClientRect().width,
            host:rect(p), viewport:{{width:visualViewport.width,height:visualViewport.height}},
            surfaces:sheet ? [surface(top),surface(sheet)] : [],
            progress:Number(p.dataset.turnProgress || 0), commits:window.turnCommits,
            frames:root.querySelectorAll('#top iframe, .slide-sheet iframe').length,
            measuring:root.querySelectorAll('.page-measure iframe').length,
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
        self.assertLessEqual(p['measuring'], 1)
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
            self.assertAlmostEqual(surface['indicator']['x'] + surface['indicator']['width']/2,
                                   surface['bounds']['x'] + width/2, delta=1)
            self.assertEqual(surface['label'], str(surface['globalPage']))
            for layer in ['shade', 'background']:
                for axis in ['x', 'y', 'width', 'height']:
                    self.assertAlmostEqual(surface[layer][axis], surface['bounds'][axis], delta=1,
                                           msg=f"{layer} must cover the full sheet ({axis})")
        self.assertEqual(p['surfaces'][1]['globalPage'], p['surfaces'][0]['globalPage'] + direction)

    def indicator(self):
        return self.page.evaluate("window.slideRoot.querySelector('#top .page-indicator').textContent")

    def toggle_controls(self):
        bounds = self.page.evaluate("window.slideRoot.querySelector('#top .page-indicator').getBoundingClientRect().toJSON()")
        self.page.mouse.click(bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2)

    def open_numbered_book(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        title, archive = numbered_epub()
        self.context.add_init_script("localStorage.setItem('manabi-dev-foliate-epub','true');localStorage.setItem('viewMode','paginated');localStorage.setItem('writingMode','horizontal-tb')")
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({'name':'numbered.epub','mimeType':'application/epub+zip','buffer':archive})
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        self.page.wait_for_function(f"() => {P}?.pageCounts.length === 4 && {P}.pageCounts.every(Number.isFinite)")

    def test_controls_hide_at_turn_start_and_numbers_move_with_both_pages(self):
        self.open_slide(False, mobile=True)
        self.assertEqual(self.indicator(), '1')
        self.toggle_controls()
        expect(self.page.get_by_role('banner', name='Reader toolbar')).to_be_visible()
        self.assertRegex(self.indicator(), r'^1 of \d+$')
        self.page.evaluate(f"async () => {{window.prepared = await {P}.preparePageTurn(1);window.prepared.update(.45)}}")
        expect(self.page.get_by_role('banner', name='Reader toolbar')).not_to_be_visible()
        expect(self.page.locator('.reader-controls')).not_to_be_visible()
        expect(self.page.locator('#ttu-page-footer')).not_to_be_visible()
        self.assertEqual(self.page.locator('.reader-progress').count(), 0)
        self.assert_pose(self.pose(), .45, 1, False)
        self.screenshot('page-number-forward-held')
        self.page.evaluate('window.prepared.commit()')
        self.assertEqual(self.indicator(), '2')
        self.toggle_controls()
        self.assertRegex(self.indicator(), r'^2 of \d+$')
        self.screenshot('page-number-expanded')
        self.toggle_controls()
        expect(self.page.get_by_role('banner', name='Reader toolbar')).not_to_be_visible()
        self.assertEqual(self.indicator(), '2')
        self.toggle_controls()
        expect(self.page.get_by_role('banner', name='Reader toolbar')).to_be_visible()
        self.assertRegex(self.indicator(), r'^2 of \d+$')
        bounds = self.page.evaluate("window.slideRoot.querySelector('#top .page-indicator').getBoundingClientRect().toJSON()")
        self.page.mouse.move(bounds['x']+bounds['width']/2, bounds['y']+bounds['height']/2)
        self.page.mouse.down()
        self.page.mouse.move(bounds['x']-80, bounds['y']+bounds['height']/2, steps=4)
        self.assertFalse(self.page.evaluate(f"{P}.hasAttribute('data-turn-progress')"))
        self.page.mouse.up()

    def test_global_counts_match_rendered_chapters_and_recompute_on_resize(self):
        self.open_numbered_book()
        initial = self.page.evaluate(f'{P}.pageCounts')
        for index in range(4):
            self.page.evaluate(f"async index => await {P}.goTo({{index}})", index)
            self.assertEqual(self.page.evaluate(f'{P}.pages - 2'), initial[index])
            self.assertEqual(self.indicator(), str(1 + sum(initial[:index])))
        self.page.evaluate(f"async () => {{window.prepared=await {P}.preparePageTurn(-1);window.prepared.update(.5)}}")
        self.assert_pose(self.pose(), .5, -1, False)
        self.screenshot('chapter-page-number-back-held')
        self.page.evaluate('window.prepared.cancel()')
        self.toggle_controls()
        self.assertEqual(self.indicator(), f'{1 + sum(initial[:3])} of {sum(initial)}')
        self.page.set_viewport_size({'width': 600, 'height': 600})
        self.page.wait_for_function(f"old => {P}.pageCounts.every(Number.isFinite) && JSON.stringify({P}.pageCounts)!==JSON.stringify(old)", arg=initial)
        resized = self.page.evaluate(f'{P}.pageCounts')
        self.assertEqual(self.page.evaluate(f'{P}.getContents()[0].index'), 3)
        for index in range(4):
            self.page.evaluate(f"async index => await {P}.goTo({{index}})", index)
            self.assertEqual(self.page.evaluate(f'{P}.pages - 2'), resized[index])
        self.page.get_by_role('button', name='Themes & Settings', exact=True).click()
        font_size = self.page.evaluate(f"parseFloat(getComputedStyle({P}.getContents()[0].doc.body).fontSize)")
        for _ in range(10):
            self.page.get_by_role('button', name='Increase text size', exact=True).click()
        self.page.get_by_role('button', name='Close reading appearance', exact=True).click()
        self.page.wait_for_function(f"size => parseFloat(getComputedStyle({P}.getContents()[0].doc.body).fontSize)===size", arg=font_size+10)
        self.page.wait_for_function(f"old => {P}.pageCounts.every(Number.isFinite) && JSON.stringify({P}.pageCounts)!==JSON.stringify(old)", arg=resized)
        self.assertEqual(self.page.evaluate(f'{P}.getContents()[0].index'), 3)
        restyled = self.page.evaluate(f'{P}.pageCounts')
        for index in range(4):
            self.page.evaluate(f"async index => await {P}.goTo({{index}})", index)
            self.assertEqual(self.page.evaluate(f'{P}.pages - 2'), restyled[index])

    def test_unknown_counts_progress_from_percent_to_current_to_total(self):
        self.open_numbered_book()
        self.page.evaluate(f"async () => await {P}.goTo({{index:2}})")
        self.toggle_controls()
        self.page.evaluate(f"""() => {{
          window.countGates={{}};
          for (const index of [0,3]) {{
            const section={P}.sections[index], load=section.load;
            section.load=async () => {{
              await new Promise(resolve => window.countGates[index]=resolve);
              return load();
            }};
          }}
          {P}.setStyles('body {{font-size:32px; line-height:1.7; writing-mode:horizontal-tb}}');
        }}""")
        self.page.wait_for_function('() => !!window.countGates[0]')
        self.assertRegex(self.indicator(), r'^\d+%$')
        self.screenshot('page-number-percent-pending')
        self.page.evaluate('window.countGates[0]()')
        self.page.wait_for_function('() => !!window.countGates[3]')
        self.assertRegex(self.indicator(), r'^\d+$')
        self.screenshot('page-number-current-pending')
        self.assertEqual(self.page.evaluate(f'{P}.getContents()[0].index'), 2)
        self.page.evaluate('window.countGates[3]()')
        self.page.wait_for_function(f"() => {P}.pageCounts.every(Number.isFinite)")
        counts = self.page.evaluate(f'{P}.pageCounts')
        self.assertEqual(self.indicator(), f'{1 + sum(counts[:2])} of {sum(counts)}')
        self.screenshot('page-number-total-ready')

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

    def test_repeated_keyboard_turns_keep_focus_ltr(self):
        self.check_repeated_keyboard_turns(False)

    def test_repeated_keyboard_turns_keep_focus_rtl(self):
        self.check_repeated_keyboard_turns(True)

    def check_repeated_keyboard_turns(self, rtl):
        self.open_slide(rtl, mobile=True)
        self.page.emulate_media(reduced_motion='reduce')
        self.page.mouse.click(195, 360)
        initial = self.pose()['page']
        forward, back = ('ArrowLeft', 'ArrowRight') if rtl else ('ArrowRight', 'ArrowLeft')
        for key, offset in [(forward, 1), (forward, 2), (back, 1), (back, 0), ('PageDown', 1), ('PageUp', 0)]:
            self.page.keyboard.press(key)
            self.page.wait_for_function(f"() => {P}.page === {initial + offset}")
            self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))

    def test_writing_direction_changes_keep_counts_and_turns_consistent(self):
        self.open_numbered_book()
        for writing, rtl in [('vertical-rl', True), ('horizontal-tb', False)]:
            self.page.evaluate(f"style => {P}.setStyles(style)", f'html,body {{background:white;color:black}} body {{font-size:20px;line-height:1.65;writing-mode:{writing}}}')
            direction = 'rtl' if rtl else 'ltr'
            self.page.wait_for_function(f"() => {P}.pageTurnDirection === '{direction}' && {P}.page >= 1 && {P}.pages > 3 && {P}.pageCounts.every(Number.isFinite)")
            counts = self.page.evaluate(f'{P}.pageCounts')
            self.assertEqual(self.page.evaluate(f'{P}.pages - 2'), counts[0])
            self.page.evaluate(f"async () => {{window.prepared=await {P}.preparePageTurn(1);window.prepared.update(.45)}}")
            self.assert_pose(self.pose(), .45, 1, rtl)
            self.screenshot('writing-change-' + writing)
            self.page.evaluate('window.prepared.cancel()')
            # A newly loaded chapter must agree with both the reflowed active
            # document and the background counts for the new writing direction.
            for index in [1, 2, 3, 0]:
                self.page.evaluate(f"async index => await {P}.goTo({{index}})", index)
                self.assertEqual(self.page.evaluate(f'{P}.pages - 2'), counts[index])

    def test_pending_navigation_blocks_turns_and_supersedes_stale_loads(self):
        self.open_numbered_book()
        result = self.page.evaluate(f"""async () => {{
          const p={P}, section=p.sections[1], load=section.load, unload=section.unload;
          let release, started, releases=0;
          const loading=new Promise(resolve=>started=resolve);
          section.load=async()=>{{started();await new Promise(resolve=>release=resolve);return load()}};
          section.unload=()=>{{releases++;unload()}};
          const loaded=[];p.addEventListener('load',e=>loaded.push(e.detail.index));
          const first=p.goTo({{index:1}});await loading;
          const turn=await p.preparePageTurn(1);
          const latest=p.goTo({{index:2}});
          release();
          const results=await Promise.all([first,latest]);
          section.load=load;section.unload=unload;
          return {{blocked:turn===null,results,index:p.getContents()[0].index,loaded,releases}};
        }}""")
        self.assertEqual(result, {'blocked': True, 'results': [False, True], 'index': 2, 'loaded': [2], 'releases': 1})
        # A failed navigation leaves the current location and its input usable.
        result = self.page.evaluate(f"""async () => {{
          const p={P}, section=p.sections[1], load=section.load;
          let errors=0;p.addEventListener('navigationerror',()=>errors++);
          const before={{index:p.getContents()[0].index,page:p.page}};
          section.load=async()=>{{throw new Error('chapter unavailable')}};
          const navigated=await p.goTo({{index:1}});section.load=load;
          const invalid=await Promise.all([p.goTo({{index:null}}),p.goTo({{index:1.5}})]);
          const unchanged=p.getContents()[0].index===before.index && p.page===before.page;
          const turn=await p.preparePageTurn(1);turn?.cancel();
          return {{navigated,invalid,unchanged,recovered:!!turn,errors}};
        }}""")
        self.assertEqual(result, {'navigated': False, 'invalid': [False, False], 'unchanged': True, 'recovered': True, 'errors': 1})

    def test_destroy_during_navigation_releases_late_source_without_recreating_view(self):
        self.open_numbered_book()
        result = self.page.evaluate(f"""async () => {{
          const p={P}, section=p.sections[1], load=section.load, unload=section.unload;
          let release, started, releases=0;
          const loading=new Promise(resolve=>started=resolve);
          section.load=async()=>{{started();await new Promise(resolve=>release=resolve);return load()}};
          section.unload=()=>{{releases++;unload()}};
          const nav=p.goTo({{index:1}});await loading;
          const frame=window.slideRoot.querySelector('#top iframe');
          p.destroy();release();const navigated=await nav;
          return {{navigated,releases,empty:p.getContents().length===0,
            sameFrame:frame===window.slideRoot.querySelector('#top iframe'),
            extras:window.slideRoot.querySelectorAll('.slide-sheet,.page-measure').length}};
        }}""")
        self.assertEqual(result, {'navigated': False, 'releases': 1, 'empty': True, 'sameFrame': True, 'extras': 0})

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
