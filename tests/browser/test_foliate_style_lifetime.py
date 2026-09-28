"""Reader styles must precede a new chapter's layout and anchor resolution."""
import unittest
from test_foliate_slide import FoliateSlide, P


class StyleChecks:
    def check_foreground_styles(self, writing):
        self.open_numbered_book()
        result = self.page.evaluate("""async writing => {
          const p = document.querySelector('foliate-paginator');
          const snapshot = doc => {
            const style = doc.defaultView.getComputedStyle(doc.body);
            return {writing: style.writingMode, font: style.fontSize,
              marker: style.getPropertyValue('--reader-style-proof').trim()};
          };
          p.setStyles([
            'body{--reader-style-proof:before; font-size:17px}',
            `body{--reader-style-proof:after; font-size:27px; line-height:1.65; writing-mode:${writing}}`
          ]);
          let anchor, loaded;
          const onLoad = event => { loaded = { ...snapshot(event.detail.doc),
            direction: p.pageTurnDirection, index: event.detail.index }; };
          p.addEventListener('load', onLoad);
          try {
            const accepted = await p.goTo({index:1, anchor:doc => {
              anchor = snapshot(doc);
              return 0;
            }});
            return {accepted, anchor, loaded, index:p.getContents()[0].index,
              direction:p.pageTurnDirection};
          } finally { p.removeEventListener('load', onLoad); }
        }""", writing)
        expected = {'writing': writing, 'font': '27px', 'marker': 'after'}
        self.assertTrue(result['accepted'])
        self.assertEqual(result['anchor'], expected)
        self.assertEqual(result['loaded'], {
            **expected, 'direction': 'rtl' if writing == 'vertical-rl' else 'ltr', 'index': 1})
        self.assertEqual(result['direction'], result['loaded']['direction'])
        self.assertEqual(result['index'], 1)

    def test_foreground_vertical_styles_precede_anchor_and_load(self):
        self.check_foreground_styles('vertical-rl')

    def test_foreground_horizontal_styles_precede_anchor_and_load(self):
        self.check_foreground_styles('horizontal-tb')

    def test_foreground_counts_match_background_after_direction_changes(self):
        self.open_numbered_book()
        for writing in ['vertical-rl', 'horizontal-tb']:
            self.page.evaluate(f"writing => {P}.setStyles(" +
                               "`body{font-size:20px;line-height:1.65;writing-mode:${writing}}`)",
                               writing)
            self.page.wait_for_function(f"writing => {P}.pageTurnDirection === " +
                                        f"(writing === 'vertical-rl' ? 'rtl' : 'ltr') && {P}.pageCounts.length === 4 && " +
                                        f"{P}.pageCounts.every(Number.isFinite)", arg=writing)
            result = self.page.evaluate("""async () => {
              const p = document.querySelector('foliate-paginator');
              const counts = p.pageCounts;
              const visits = [];
              for (const index of [1,2,3,0]) {
                const accepted = await p.goTo({index});
                // Check the acknowledged result in this continuation, not after
                // a polling assertion allows a later animation frame to repair it.
                visits.push({index, accepted, expected:counts[index], pages:p.pages-2,
                  direction:p.pageTurnDirection});
              }
              return visits;
            }""")
            for visit in result:
                with self.subTest(writing=writing, chapter=visit['index']):
                    self.assertTrue(visit['accepted'])
                    self.assertEqual(visit['pages'], visit['expected'])
                    self.assertEqual(visit['direction'], 'rtl' if writing == 'vertical-rl' else 'ltr')

    def test_single_styles_replace_both_halves_of_a_pair(self):
        self.open_numbered_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          p.setStyles(['body{--reader-old-before:stale}', 'body{--reader-old-after:stale}']);
          p.setStyles('body{--reader-new-style:current}');
          const snapshot = doc => {
            const style = doc.defaultView.getComputedStyle(doc.body);
            return ['--reader-old-before','--reader-old-after','--reader-new-style']
              .map(name => style.getPropertyValue(name).trim());
          };
          const active = snapshot(p.getContents()[0].doc);
          const accepted = await p.goTo({index:1});
          return {active, accepted, next:snapshot(p.getContents()[0].doc)};
        }""")
        self.assertTrue(result['accepted'])
        self.assertEqual(result['active'], ['', '', 'current'])
        self.assertEqual(result['next'], result['active'])

    def test_empty_styles_remove_both_halves_of_a_pair(self):
        self.open_numbered_book()
        result = self.page.evaluate("""() => {
          const p = document.querySelector('foliate-paginator');
          p.setStyles(['body{--reader-old-before:stale}', 'body{--reader-old-after:stale}']);
          p.setStyles('');
          const style = p.getContents()[0].doc.defaultView.getComputedStyle(p.getContents()[0].doc.body);
          return ['--reader-old-before','--reader-old-after'].map(name => style.getPropertyValue(name).trim());
        }""")
        self.assertEqual(result, ['', ''])

    def test_pending_chapter_uses_latest_styles_before_anchor_resolution(self):
        self.open_numbered_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const section = p.sections[1], load = section.load;
          let release, started, anchor;
          const startedPromise = new Promise(resolve => { started = resolve; });
          const gate = new Promise(resolve => { release = resolve; });
          section.load = async (...args) => { started(); await gate; return load.apply(section,args); };
          p.setStyles('body{writing-mode:horizontal-tb;font-size:20px}');
          try {
            const navigation = p.goTo({index:1, anchor:doc => {
              const style = doc.defaultView.getComputedStyle(doc.body);
              anchor = {writing:style.writingMode, font:style.fontSize};
              return 0;
            }});
            await startedPromise;
            p.setStyles('body{writing-mode:vertical-rl;font-size:29px}');
            release();
            const accepted = await navigation;
            return {accepted, anchor, index:p.getContents()[0].index, direction:p.pageTurnDirection};
          } finally { release(); section.load = load; }
        }""")
        self.assertTrue(result['accepted'])
        self.assertEqual(result['anchor'], {'writing': 'vertical-rl', 'font': '29px'})
        self.assertEqual(result['index'], 1)
        self.assertEqual(result['direction'], 'rtl')

    def test_failed_anchor_preserves_the_visible_chapter(self):
        self.open_numbered_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const before = p.getContents()[0], pages = p.pages;
          const failure = new Error('Controlled invalid anchor');
          let rejected = false, loads = 0;
          const onLoad = () => { loads++; };
          p.addEventListener('load', onLoad);
          try {
            try { await p.goTo({index:1, anchor:() => {throw failure;}}); }
            catch (error) { rejected = error === failure; }
            return {rejected, loads, sameDocument:p.getContents()[0].doc === before.doc,
              index:p.getContents()[0].index, pages:p.pages, previousPages:pages};
          } finally { p.removeEventListener('load', onLoad); }
        }""")
        self.assertTrue(result['rejected'])
        self.assertTrue(result['sameDocument'])
        self.assertEqual(result['loads'], 0)
        self.assertEqual(result['index'], 0)
        self.assertEqual(result['pages'], result['previousPages'])

    def test_superseded_load_cannot_replace_the_newer_chapter(self):
        self.open_numbered_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const section = p.sections[1], load = section.load;
          let started, release;
          const startedPromise = new Promise(resolve => { started = resolve; });
          const gate = new Promise(resolve => { release = resolve; });
          section.load = async (...args) => { started(); await gate; return load.apply(section,args); };
          const loads = [], onLoad = event => loads.push(event.detail.index);
          p.addEventListener('load', onLoad);
          try {
            const old = p.goTo({index:1});
            await startedPromise;
            const beforeRelease = p.getContents()[0].index;
            const latest = p.goTo({index:2});
            release();
            const accepted = await Promise.all([old, latest]);
            return {accepted, loads, beforeRelease, index:p.getContents()[0].index};
          } finally {
            release(); section.load = load;
            p.removeEventListener('load', onLoad);
          }
        }""")
        self.assertEqual(result, {'accepted': [False, True], 'loads': [2],
                                 'beforeRelease': 0, 'index': 2})


class FoliateStyles(StyleChecks, FoliateSlide):
    pass


def load_tests(loader, tests, pattern):
    # The original slide suite runs separately and remains unchanged. Reuse its
    # real-app setup/import/diagnostics without rerunning its inherited methods.
    return unittest.TestSuite(FoliateStyles(name) for name in sorted(StyleChecks.__dict__)
                              if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
