"""Reader scrubber usability and preview-lifetime journeys."""
import json
import re
from pathlib import Path
import unittest

from playwright.sync_api import expect
from reader_controls import reveal_reader_controls
from test_books_library import LibraryBase


class ScrubberQuality(LibraryBase):
    def setUp(self):
        super().setUp()
        self.output = Path('test-results') / 'scrubber-quality' / self.engine / self._testMethodName
        self.output.mkdir(parents=True, exist_ok=True)
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)

    def tearDown(self):
        try:
            self.page.screenshot(path=str(self.output / 'final.png'))
            (self.output / 'final.html').write_text(self.page.content())
            (self.output / 'page-errors.json').write_text(json.dumps(self.errors, indent=2))
            self.context.tracing.stop(path=str(self.output / 'trace.zip'))
        finally:
            super().tearDown()

    def open_reader(self):
        self.import_book('Scrubber quality')
        self.page.get_by_role('button', name='Read Scrubber quality', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute(
            'aria-busy', 'false', timeout=35000)

    def open_scrubber(self):
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Browse Book', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Browse Book', exact=True)
        expect(panel).to_be_visible()
        return panel

    def test_enlarged_short_scrubber_keeps_close_and_range_reachable(self):
        self.open_reader()
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        panel = self.open_scrubber()
        close = panel.locator('[data-modal-dismiss]')
        slider = panel.get_by_role('slider', name='Book position', exact=True)
        expect(slider).to_be_visible()
        result = panel.evaluate('''panel => {
          const close = panel.querySelector('[data-modal-dismiss]');
          const title = panel.querySelector('[data-slot="sheet-title"]');
          const slider = panel.querySelector('[role="slider"],input[type="range"]');
          const rect = e => { const r=e.getBoundingClientRect(); return {
            left:r.left, top:r.top, right:r.right, bottom:r.bottom,
            width:r.width, height:r.height
          }};
          const a=rect(title), b=rect(close), c=rect(slider);
          return {
            title:a, close:b, slider:c,
            overlapX:Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left)),
            overlapY:Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),
            overflow:panel.scrollWidth-panel.clientWidth,
            viewport:[innerWidth,innerHeight],
            hit: close.contains(document.elementFromPoint(
              b.left+b.width/2, b.top+b.height/2))
          };
        }''')
        self.assertGreaterEqual(result['close']['width'], 44, result)
        self.assertGreaterEqual(result['close']['height'], 44, result)
        self.assertTrue(result['hit'], result)
        self.assertLessEqual(result['close']['right'], result['viewport'][0], result)
        self.assertLessEqual(result['close']['bottom'], result['viewport'][1], result)
        self.assertFalse(result['overlapX'] > 1 and result['overlapY'] > 1, result)
        self.assertGreaterEqual(result['slider']['height'], 44, result)
        self.assertLessEqual(result['overflow'], 1, result)
        self.page.screenshot(path=str(self.output / 'enlarged-short.png'))

    def test_escape_from_slider_restores_surviving_reader_control(self):
        self.open_reader()
        panel = self.open_scrubber()
        slider = panel.get_by_role('slider', name='Book position', exact=True)
        slider.focus()
        expect(slider).to_be_focused()
        slider.press('Escape')
        expect(panel).to_have_count(0)
        expect(self.page.locator('button[data-reader-controls]')).to_be_focused()

    def test_preview_then_return_does_not_commit_saved_reading_position(self):
        self.open_reader()
        before = self.stores('books', ['bookmark'])['bookmark']
        url = self.page.url
        panel = self.open_scrubber()
        slider = panel.get_by_role('slider', name='Book position', exact=True)
        slider.evaluate('''e => {
          e.value = '750';
          e.dispatchEvent(new InputEvent('input', {bubbles:true}));
        }''')
        expect(slider).to_have_attribute('aria-valuetext', re.compile(r'approximately 75%'))
        panel.get_by_text(re.compile(r'approximately 75%')).wait_for(state='visible')
        slider.evaluate("e => e.dispatchEvent(new Event('change', {bubbles:true}))")
        expect(panel).to_have_count(0)
        return_button = self.page.get_by_role(
            'button', name='Return to where I was', exact=True)
        expect(return_button).to_be_visible(timeout=15000)
        self.assertEqual(url, self.page.url)
        self.assertEqual(before, self.stores('books', ['bookmark'])['bookmark'])
        self.page.screenshot(path=str(self.output / 'preview-75.png'))
        return_button.click()
        expect(return_button).to_have_count(0)
        self.assertEqual(before, self.stores('books', ['bookmark'])['bookmark'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
