"""Search interaction and presentation against the compiled app.

Native imports, Workers, DOM, focus and IndexedDB; generated books only.
Composition events emulate the DOM contract, not a physical Japanese IME.
One explicitly named test injects a Worker-construction failure, never results.
"""
import json
import re
import unittest
from xml.sax.saxutils import escape

from playwright.sync_api import expect
from test_product_journeys import ProductJourneyBase
from search_geometry import assert_mark_visible


class SearchQuality(ProductJourneyBase):
    def open_search_book(self, title, body):
        self.import_book(title, body=body)
        self.read(title)
        return self.reader_search()

    def test_reader_marks_the_exact_occurrence_in_original_text(self):
        original = 'É e\u0301 É / が か\u3099 / 👩‍💻 👩‍💻 / <script> & [a+b].*?'
        panel, field = self.open_search_book('Exact matches', '<p>' + escape(original) + '</p>')
        cases = [('é', ['É', 'e\u0301', 'É']), ('が', ['が', 'か\u3099']),
                 ('👩‍💻', ['👩‍💻', '👩‍💻']), ('[a+b].*?', ['[a+b].*?'])]
        for query, expected in cases:
            with self.subTest(query=query):
                field.fill(query)
                hits = self.result_buttons(panel)
                expect(hits).to_have_count(len(expected))
                expect(hits.locator('mark')).to_have_count(len(expected))
                self.assertEqual(expected, hits.locator('mark').all_text_contents())
                # Each row describes its own occurrence, not every identical
                # substring in the overlapping context. The author's bytes stay.
                prefixes = hits.evaluate_all("nodes => nodes.map(n => { const m=n.querySelector('mark'); return m.previousSibling?.textContent ?? '' })")
                self.assertEqual(len(expected), len(set(prefixes)))
                for hit in hits.all():
                    expect(hit.locator('[data-search-excerpt]')).to_have_text(original)
                    expect(hit.locator('script, img, iframe')).to_have_count(0)
        self.checkpoint('literal-safe-highlight')
        field.fill('é')
        expect(self.result_buttons(panel).locator('mark')).to_have_count(3)
        panel.get_by_label('Match case', exact=True).check()
        expect(self.result_buttons(panel)).to_have_count(0)
        field.fill('É')
        expect(self.result_buttons(panel).locator('mark')).to_have_count(2)
        self.assertEqual(['É', 'É'], self.result_buttons(panel).locator('mark').all_text_contents())
        self.checkpoint('case-sensitive-matches')

    def test_library_marks_compatibility_matches_without_rewriting_quotes(self):
        self.import_book('Original spelling', body='<p>ﬁ / fi / ＦＩ / ｶﾞ / ガ / &lt;b&gt; &amp;</p>')
        self.library_search('fi')
        self.page.get_by_role('button', name='Content', exact=True).click()
        passages = self.page.locator('button.passage')
        expect(passages).to_have_count(3)
        expect(passages.locator('mark')).to_have_count(3)
        self.assertEqual(['ﬁ', 'fi', 'ＦＩ'], passages.locator('mark').all_text_contents())
        self.checkpoint('library-ligatures')
        self.library_search('ガ')
        expect(passages).to_have_count(2)
        expect(passages.locator('mark')).to_have_count(2)
        self.assertEqual(['ｶﾞ', 'ガ'], passages.locator('mark').all_text_contents())
        self.page.get_by_role('button', name='Open passage in Original spelling: ｶﾞ', exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        rows = self.stores('books', ['data'])['data']
        self.assertEqual(1, len(rows))
        self.assertIn('ﬁ / fi / ＦＩ / ｶﾞ / ガ', rows[0]['elementHtml'])

    def test_composing_escape_does_not_dismiss_or_search_provisional_text(self):
        panel, field = self.open_search_book('Composition', '<p>猫と犬。ねこといぬ。</p>')
        field.fill('犬')
        expect(self.result_buttons(panel)).to_have_count(1)
        field.dispatch_event('compositionstart', {'data': ''})
        field.evaluate("element => { element.value='ね'; element.dispatchEvent(new InputEvent('input', {bubbles:true, data:'ね', inputType:'insertCompositionText', isComposing:true})) }")
        expect(panel.get_by_text('Finish entering text to search.', exact=True)).to_be_visible()
        expect(self.result_buttons(panel)).to_have_count(0)
        field.press('Escape')
        expect(panel).to_be_visible()
        expect(field).to_be_focused()
        # Commit a genuine source word through the composition contract.
        field.evaluate("element => { element.value='猫'; element.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data:'猫'})); element.dispatchEvent(new InputEvent('input', {bubbles:true, data:'猫', inputType:'insertText'})) }")
        expect(self.result_buttons(panel)).to_have_count(1)
        expect(panel.get_by_text('1 result', exact=True)).to_be_visible()
        expect(self.result_buttons(panel).locator('mark')).to_have_text('猫')
        self.checkpoint('committed-japanese')
        field.press('Escape')
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()

    def test_clear_search_returns_focus_and_resets_results(self):
        panel, field = self.open_search_book('Clear search', '<p>猫と犬の本。</p>' * 60)
        field.fill('猫')
        expect(panel.get_by_text('60 results', exact=True)).to_be_visible()
        clear = panel.get_by_role('button', name='Clear search', exact=True)
        expect(clear).to_be_visible()
        box = clear.bounding_box()
        self.assertGreaterEqual(box['width'], 44)
        self.assertGreaterEqual(box['height'], 44)
        clear.click()
        expect(field).to_have_value('')
        expect(field).to_be_focused()
        expect(self.result_buttons(panel)).to_have_count(0)
        expect(panel.get_by_text('Enter a word or phrase.', exact=True)).to_be_visible()
        expect(clear).to_have_count(0)
        field.fill('missing word')
        expect(panel.get_by_text('0 results', exact=True)).to_be_visible()
        expect(panel.get_by_text('Try another spelling or a shorter phrase.', exact=True)).to_be_visible()
        self.checkpoint('useful-empty-state')
        clear.click()
        field.fill('犬')
        expect(panel.get_by_text('60 results', exact=True)).to_be_visible()
        expect(self.result_buttons(panel)).to_have_count(50)
        self.assertEqual({'犬'}, set(self.result_buttons(panel).locator('mark').all_text_contents()))

    def test_keyboard_pagination_focuses_first_new_result(self):
        body = ''.join(f'<p>猫 {n:03d} 番目の文章です。</p>' for n in range(127))
        panel, field = self.open_search_book('Keyboard results', body)
        field.fill('猫')
        expect(panel.get_by_text('127 results', exact=True)).to_be_visible()
        hits = self.result_buttons(panel)
        more = panel.get_by_role('button', name='Show more results', exact=True)
        more.focus()
        more.press('Enter')
        expect(hits).to_have_count(100)
        expect(hits.nth(50)).to_be_focused()
        expect(hits.nth(50)).to_be_in_viewport()
        expect(hits.nth(50)).to_contain_text('Match 51')
        self.checkpoint('first-new-keyboard-result')
        more.focus()
        more.press('Enter')
        expect(hits).to_have_count(127)
        expect(hits.nth(100)).to_be_focused()
        expect(hits.nth(100)).to_be_in_viewport()
        expect(more).to_have_count(0)
        # Text-editing arrows remain native; they cannot turn the book page.
        field.focus()
        field.press('ArrowLeft')
        expect(field).to_be_focused()
        expect(panel).to_be_visible()

    def test_enlarged_short_search_keeps_controls_and_matches_reachable(self):
        title = '長い日本語の題名・' * 10
        panel, field = self.open_search_book(title, '<p>' + '冒頭の文章。' * 20 + '猫' + '続く文章。' * 20 + '</p>')
        for width, height in ((320, 568), (667, 320)):
            with self.subTest(width=width, height=height):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.evaluate("document.documentElement.style.fontSize='200%'")
                field.fill('猫')
                hits = self.result_buttons(panel)
                expect(hits).to_have_count(1)
                expect(hits.locator('mark')).to_have_text('猫')
                # There is one vertical scroll owner. Long titles or large
                # text must not collapse the result into a zero-height scroller.
                hits.first.scroll_into_view_if_needed()
                hits.first.focus()
                expect(hits.first).to_be_focused()
                assert_mark_visible(self, hits.locator('mark'))
                self.assertTrue(panel.evaluate('e => e.scrollWidth <= e.clientWidth + 1'))
                self.assertTrue(hits.first.evaluate('e => e.scrollWidth <= e.clientWidth + 1'))
                field.focus()
                expect(field).to_be_in_viewport()
                clear = panel.get_by_role('button', name='Clear search', exact=True)
                clear.scroll_into_view_if_needed()
                rect = clear.bounding_box()
                self.assertGreaterEqual(rect['width'], 44)
                self.assertGreaterEqual(rect['height'], 44)
                self.checkpoint(f'large-search-{width}')
                clear.click()
                expect(field).to_be_focused()
                expect(field).to_have_value('')

    def test_search_highlight_contrast_in_all_presets_and_modes(self):
        panel, field = self.open_search_book('Search contrast', '<p>読みやすい猫の文章。</p>')
        field.fill('猫')
        mark = self.result_buttons(panel).locator('mark')
        expect(mark).to_have_count(1)
        measurements = []
        settings = self.context.new_page()
        settings.goto(self.origin + '/reader-web/settings')
        expect(settings.get_by_label('Search settings', exact=True)).to_be_visible()
        settings.get_by_role('button', name='All settings', exact=True).click()
        for theme in ('manabi-theme', 'light-theme', 'ecru-theme', 'water-theme', 'gray-theme', 'dark-theme', 'black-theme'):
            for mode in ('light', 'dark'):
                with self.subTest(theme=theme, mode=mode):
                    # The app owns inline palette variables. A data-theme
                    # attribute alone does not select a different real palette.
                    # Use real settings controls in a second tab and require
                    # native storage-event propagation into the open Reader.
                    settings.bring_to_front()
                    settings.locator('button[title="' + theme + '"]').click()
                    settings.get_by_role('group', name='Appearance mode').get_by_role(
                        'button', name=mode.capitalize(), exact=True).click()
                    expect(settings.locator('html')).to_have_attribute('data-theme', theme)
                    expect(settings.locator('html')).to_have_attribute('data-appearance', mode)
                    expect(self.page.locator('html')).to_have_attribute('data-theme', theme)
                    expect(self.page.locator('html')).to_have_attribute('data-appearance', mode)
                    self.page.bring_to_front()
                    # Measure the settled surface, not an intermediate color
                    # transition. Wait for actual finite animations, not sleep.
                    panel.evaluate('''async element => {
                      getComputedStyle(element).backgroundColor;
                      await Promise.all(element.getAnimations({subtree:true})
                        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
                        .map(a => a.finished.catch(() => {})));
                    }''')
                    colors = mark.evaluate("""element => {
                      const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
                      const context=canvas.getContext('2d', {willReadFrequently:true});
                      const rgb=color => { context.clearRect(0,0,1,1); context.fillStyle=color; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data] };
                      const style=getComputedStyle(element);
                      const panel=element.closest('[role="dialog"]');
                      const surface=getComputedStyle(panel);
                      const status=getComputedStyle(panel.querySelector('[role="status"]'));
                      return {foreground:rgb(style.color),background:rgb(style.backgroundColor),weight:style.fontWeight,
                        panelForeground:rgb(surface.color),panelBackground:rgb(surface.backgroundColor),
                        statusForeground:rgb(status.color)};
                    }""")
                    self.assertEqual(255, colors['foreground'][3])
                    self.assertEqual(255, colors['background'][3])
                    def luminance(rgb):
                        channels = [c / 255 for c in rgb[:3]]
                        linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
                        return sum(c * w for c, w in zip(linear, (0.2126, 0.7152, 0.0722)))
                    a, b = luminance(colors['foreground']), luminance(colors['background'])
                    ratio = (max(a, b) + .05) / (min(a, b) + .05)
                    self.assertGreaterEqual(ratio, 4.5, colors)
                    self.assertEqual(255, colors['panelBackground'][3])
                    for text_color in ('panelForeground', 'statusForeground'):
                        self.assertEqual(255, colors[text_color][3])
                        text_lum, surface_lum = luminance(colors[text_color]), luminance(colors['panelBackground'])
                        text_ratio = (max(text_lum, surface_lum) + .05) / (min(text_lum, surface_lum) + .05)
                        self.assertGreaterEqual(text_ratio, 4.5, (text_color, colors))
                    self.assertGreaterEqual(int(colors['weight']), 600)
                    measurements.append(dict(theme=theme, mode=mode, contrast=ratio, **colors))
        (self.output / (self._testMethodName + '-contrast.json')).write_text(json.dumps(measurements, indent=2))
        # Guard the test itself against measuring one inline palette fourteen
        # times while only labels or attributes change.
        palette_pairs = {(tuple(row['foreground']), tuple(row['background'])) for row in measurements}
        self.assertGreaterEqual(len(palette_pairs), 5, measurements)
        settings.close()
        self.page.bring_to_front()
        expect(panel).to_be_visible()
        expect(mark).to_have_text('猫')
        self.checkpoint('dark-highlight')

    def test_search_worker_start_failure_has_a_real_retry(self):
        panel, field = self.open_search_book('Search retry', '<p>猫が見つかります。</p>')
        self.page.evaluate("""() => {
          const NativeWorker=window.Worker;
          window.Worker=class extends NativeWorker {
            constructor(url, options) {
              if (String(url).includes('reader-search-worker')) {
                window.Worker=NativeWorker;
                throw new DOMException('Injected worker construction failure', 'SecurityError');
              }
              super(url, options);
            }
          };
        }""")
        field.fill('猫')
        expect(panel.get_by_role('alert')).to_have_text('Search could not finish. Please try again.')
        expect(self.result_buttons(panel)).to_have_count(0)
        panel.get_by_role('button', name='Retry Search', exact=True).click()
        expect(panel.get_by_role('alert')).to_have_count(0)
        expect(self.result_buttons(panel).locator('mark')).to_have_text('猫')
        self.checkpoint('worker-recovered')


if __name__ == '__main__':
    unittest.main(verbosity=2)
