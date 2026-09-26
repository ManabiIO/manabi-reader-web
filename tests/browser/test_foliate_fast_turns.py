"""Additional built-application acceptance for discrete page-turn bursts."""
import unittest
from playwright.sync_api import expect
from test_foliate_slide import FoliateSlide, P


class FoliateFastTurns(FoliateSlide):
    def record_turns(self):
        self.page.evaluate(f"""() => {{
          window.fastTurns = [];
          const paginator = {P}, prepare = paginator.preparePageTurn.bind(paginator);
          paginator.preparePageTurn = async direction => {{
            const turn = await prepare(direction);
            if (!turn) return turn;
            const log = {{direction, samples: [], committed: false}};
            fastTurns.push(log);
            return {{
              update(progress) {{ log.samples.push(progress); return turn.update(progress); }},
              commit() {{ const ok = turn.commit(); log.committed = ok; return ok; }},
              cancel() {{ return turn.cancel(); }}
            }};
          }};
        }}""")

    def burst(self, rtl=False, iframe=False):
        self.open_slide(rtl)
        self.record_turns()
        if iframe:
            self.page.evaluate(f'{P}.focusView()')
        else:
            self.page.evaluate('document.activeElement?.blur(); window.focus()')
        # The outer reader uses configured PageDown/PageUp bindings; arrows are iframe controls.
        key = ('ArrowLeft' if rtl else 'ArrowRight') if iframe else 'PageDown'
        self.page.keyboard.down(key)
        self.page.wait_for_function('() => fastTurns[0]?.samples.length > 0')
        self.page.wait_for_function('() => turnCommits === 1')
        # Deliberately exceed the old animation time before the first repeat.
        self.page.wait_for_timeout(300)
        for _ in range(5):
            self.page.keyboard.down(key)
            self.page.wait_for_timeout(55)
        self.page.wait_for_function('() => fastTurns.length === 6 && turnCommits === 5')
        self.page.wait_for_timeout(200)
        logs = self.page.evaluate('fastTurns')
        self.assertTrue(logs[0]['samples'])
        self.assertTrue(all(not turn['samples'] for turn in logs[1:]))
        self.assertFalse(logs[-1]['committed'])
        self.assertLessEqual(self.pose()['frames'], 2)
        if iframe:
            self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.up(key)
        self.page.wait_for_function('() => turnCommits === 6')
        self.assertTrue(self.page.evaluate('fastTurns.at(-1).samples.length > 0'))
        self.page.wait_for_timeout(250)
        self.assertEqual(self.pose()['commits'], 6)
        self.assertEqual(self.pose()['frames'], 1)
        self.screenshot(f'fast-key-{"rtl" if rtl else "ltr"}-{"iframe" if iframe else "outer"}')

    def test_fast_key_outer_document(self):
        self.burst()

    def test_fast_key_iframe_ltr(self):
        self.burst(iframe=True)

    def test_fast_key_iframe_rtl(self):
        self.burst(rtl=True, iframe=True)

    def test_square_pages_ignore_legacy_radius(self):
        self.open_slide(False, mobile=True)
        self.assertEqual(self.pose()['radius'], '0px')
        self.page.set_viewport_size({'width': 1100, 'height': 780})
        self.page.wait_for_timeout(200)
        self.assertEqual(self.pose()['radius'], '0px')
        # The removed radius contract must not restore rounded pages.
        self.page.evaluate("document.documentElement.style.setProperty('--reader-page-radius','0px 12px 24px 36px')")
        self.page.evaluate(f'async()=>{{window.turn=await {P}.preparePageTurn(1);turn.update(.5)}}')
        pose = self.pose()
        self.assertEqual(pose['radius'], '0px')
        self.assertEqual(pose['neighborRadius'], pose['radius'])
        self.screenshot('square-pages-no-radius-contract')
        self.page.evaluate("turn.cancel();document.documentElement.style.removeProperty('--reader-page-radius')")
        self.assertEqual(self.pose()['radius'], '0px')

    def choose_effect(self, value):
        self.toggle_controls()
        self.page.get_by_role('button', name='Themes & Settings', exact=True).click()
        self.page.get_by_role('combobox', name='Page turn effect', exact=True).select_option(value)
        self.assertEqual(self.page.evaluate("localStorage.getItem('pageTurnEffect')"), value)
        self.page.get_by_role('button', name='Close reading appearance', exact=True).click()
        self.page.wait_for_function(f"() => {P}.getAttribute('page-turn-effect') === '{value}'")
        expect(self.page.locator('[data-slot="sheet-content"]')).to_have_count(0)

    def test_none_is_saved_in_both_settings_and_has_no_repeat_tail(self):
        self.open_slide(False)
        self.choose_effect('none')
        self.record_turns()
        self.page.evaluate(f'{P}.focusView()')
        for i in range(5):
            self.page.keyboard.down('ArrowRight')
            self.page.wait_for_function('n => turnCommits === n', arg=i+1)
            self.assertEqual(self.page.evaluate("getComputedStyle(slideRoot.querySelector('#top')).visibility"), 'visible')
        self.assertTrue(self.page.evaluate('fastTurns.every(t=>t.committed && t.samples.length===0)'))
        self.page.keyboard.up('ArrowRight')
        self.page.wait_for_timeout(250)
        self.assertEqual(self.pose()['commits'],5)
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.page >= 1")
        self.assertEqual(self.page.evaluate(f"{P}.getAttribute('page-turn-effect')"),'none')
        self.page.goto(self.origin + '/reader-web/settings#layout')
        setting=self.page.get_by_role('combobox', name='Page turn effect', exact=True)
        self.assertEqual(setting.input_value(),'none')
        setting.select_option('slide')
        self.assertEqual(self.page.evaluate("localStorage.getItem('pageTurnEffect')"),'slide')
        self.page.reload()
        self.assertEqual(self.page.get_by_role('combobox', name='Page turn effect', exact=True).input_value(),'slide')

    def test_running_title_stays_put_and_dark_mode_uses_white_overlay(self):
        self.open_slide(False)
        self.page.evaluate(f'{P}.goTo({{index:0,anchor:.2}})')
        self.page.evaluate("localStorage.setItem('appearance','dark')")
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.page >= 1 && {P}.pageCounts.every(Number.isFinite)")
        self.page.evaluate(f'{P}.goTo({{index:0,anchor:.2}})')
        title=self.page.locator('.reader-context')
        initial=title.bounding_box()
        for direction in [1,-1]:
            self.page.evaluate(f'async d=>{{window.turn=await {P}.preparePageTurn(d)}}',direction)
            for progress in [.25,.5,.75]:
                self.page.evaluate('p=>turn.update(p)',progress)
                self.assertEqual(title.bounding_box(),initial)
                self.assertTrue(title.is_visible())
                self.assertEqual(self.page.evaluate("[...slideRoot.querySelectorAll('.slide-shade')].map(el=>getComputedStyle(el).backgroundColor)"),['rgb(255, 255, 255)']*2)
                self.assertGreaterEqual(self.page.evaluate("Number(getComputedStyle(document.querySelector('.reader-context')).zIndex)"),10)
                self.assert_pose(self.pose(),progress,direction,False)
            self.screenshot('stationary-title-white-overlay-'+str(direction))
            self.page.evaluate('turn.cancel()')


def load_tests(loader, tests, pattern):
    # Inherit the real application setup, not a duplicate execution of every
    # inherited test. The original Foliate suite still runs independently.
    return unittest.TestSuite(FoliateFastTurns(name) for name in FoliateFastTurns.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
