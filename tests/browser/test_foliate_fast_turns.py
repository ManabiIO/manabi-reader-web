"""Additional built-application acceptance for discrete page-turn bursts."""
import unittest
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
        key = 'ArrowLeft' if rtl else 'ArrowRight'
        self.page.keyboard.down(key)
        self.page.wait_for_function('fastTurns[0]?.samples.length > 0')
        self.page.wait_for_function('turnCommits === 1')
        # Deliberately exceed the old animation time before the first repeat.
        self.page.wait_for_timeout(300)
        for _ in range(5):
            self.page.keyboard.down(key)
            self.page.wait_for_timeout(55)
        self.page.wait_for_function('fastTurns.length === 6 && turnCommits === 5')
        self.page.wait_for_timeout(200)
        logs = self.page.evaluate('fastTurns')
        self.assertTrue(logs[0]['samples'])
        self.assertTrue(all(not turn['samples'] for turn in logs[1:]))
        self.assertFalse(logs[-1]['committed'])
        self.assertLessEqual(self.pose()['frames'], 2)
        if iframe:
            self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.up(key)
        self.page.wait_for_function('turnCommits === 6')
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

    def test_square_default_and_host_corner_override(self):
        self.open_slide(False, mobile=True)
        self.assertEqual(self.pose()['radius'], '0px')
        self.page.set_viewport_size({'width': 1100, 'height': 780})
        self.page.wait_for_timeout(200)
        self.assertEqual(self.pose()['radius'], '0px')
        # Set the contract at the outer document, not on the paginator itself:
        # the Svelte page frame must not overwrite host-supplied geometry.
        self.page.evaluate("document.documentElement.style.setProperty('--reader-page-radius','0px 12px 24px 36px')")
        self.page.evaluate(f'async()=>{{window.turn=await {P}.preparePageTurn(1);turn.update(.5)}}')
        pose = self.pose()
        self.assertEqual(pose['radius'], '0px 12px 24px 36px')
        self.assertEqual(pose['neighborRadius'], pose['radius'])
        self.screenshot('host-per-corner-geometry')
        self.page.evaluate("turn.cancel();document.documentElement.style.removeProperty('--reader-page-radius')")
        self.assertEqual(self.pose()['radius'], '0px')


def load_tests(loader, tests, pattern):
    # Inherit the real application setup, not a duplicate execution of every
    # inherited test. The original Foliate suite still runs independently.
    return unittest.TestSuite(FoliateFastTurns(name) for name in FoliateFastTurns.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
