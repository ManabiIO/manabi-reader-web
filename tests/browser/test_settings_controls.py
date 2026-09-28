"""Built Settings UI with native CacheStorage and localStorage.

Font fixtures are synthetic storage bytes, never selected as rendering fonts.
Only the cache-error/held-save cases wrap the named native operation. They do
not replace the UI or weaken the inherited page-error/resource checks.
"""
import json
from pathlib import Path
import unittest
from playwright.sync_api import expect
from test_books_library import LibraryBase

FONT = {'name': 'Review custom font', 'fileName': 'review.WOFF2', 'path': '/userfonts/review.WOFF2'}
FONT_BYTES = b'synthetic font-storage fixture, not a rendering font'


class SettingsControlsBrowser(LibraryBase):
    def settings(self, section, values=None):
        if values:
            self.page.evaluate('values => { for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value); }', values)
        self.page.goto(self.origin + '/reader-web/settings')
        nav = self.page.get_by_role('navigation', name='Settings categories', exact=True)
        nav.get_by_role('button', name=section, exact=True).click()
        expect(self.page.locator('#settings-content').get_by_role('heading', name=section, exact=True)).to_be_visible()

    def fonts(self):
        self.page.locator('[data-setting="primary-font-input"]').get_by_role('button', name='Custom fonts', exact=True).click()
        dialog = self.dialog()
        expect(dialog.get_by_role('heading', name='Custom fonts', exact=True)).to_be_visible()
        expect(dialog.get_by_role('status')).to_have_count(0)
        return dialog

    def catalog(self):
        return self.page.evaluate('JSON.parse(localStorage.getItem("userfonts") || "[]")')

    def capture(self, name):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        self.page.screenshot(path=str(output / (self.engine + '-settings-' + name + '.png')))

    def assert_reachable(self, button):
        button.scroll_into_view_if_needed()
        box = button.bounding_box()
        self.assertGreaterEqual(box['height'], 43.99)
        self.assertGreaterEqual(box['x'], -1)
        self.assertLessEqual(box['x'] + box['width'], self.page.viewport_size['width'] + 1)
        self.assertTrue(button.evaluate('e => { const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return e===hit || e.contains(hit); }'))

    def test_size_inspection_retains_exact_pixels_and_automatic(self):
        self.settings('Page layout', {'writingMode': 'horizontal-tb', 'firstDimensionMargin': '137', 'secondDimensionMaxValue': '0'})
        margin = self.page.get_by_role('spinbutton', name='Reader Top/bottom margin', exact=True)
        maximum = self.page.get_by_role('spinbutton', name='Reader Max width', exact=True)
        trigger = self.page.get_by_role('button', name='Size presets for top and bottom margins', exact=True)
        trigger.press('Enter')
        panel = self.page.get_by_role('dialog', name='Size presets for top and bottom margins', exact=True)
        expect(panel).to_contain_text('Current: 137 px per side')
        expect(margin).to_have_value('137')
        panel.get_by_role('slider').press('Escape')
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()
        self.page.get_by_role('button', name='Size presets for maximum page width', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Size presets for maximum page width', exact=True)
        expect(panel).to_contain_text('Current: Automatic')
        expect(maximum).to_have_value('0')
        panel.get_by_role('slider').press('Escape')
        self.page.reload()
        self.page.get_by_role('navigation', name='Settings categories').get_by_role('button', name='Page layout', exact=True).click()
        expect(margin).to_have_value('137')
        expect(maximum).to_have_value('0')

    def test_size_choice_uses_current_axis_and_retains_automatic_reset(self):
        self.settings('Page layout', {'writingMode': 'horizontal-tb', 'firstDimensionMargin': '137'})
        self.page.get_by_role('button', name='Size presets for top and bottom margins', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Size presets for top and bottom margins', exact=True)
        self.page.set_viewport_size({'width': 900, 'height': 600})
        panel.get_by_role('button', name='50%', exact=True).click()
        expect(self.page.get_by_role('spinbutton', name='Reader Top/bottom margin', exact=True)).to_have_value('150')
        panel.get_by_role('slider').press('Escape')
        self.page.get_by_role('button', name='Size presets for maximum page width', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Size presets for maximum page width', exact=True)
        panel.get_by_role('button', name='50%', exact=True).click()
        expect(self.page.get_by_role('spinbutton', name='Reader Max width', exact=True)).to_have_value('450')
        panel.get_by_role('button', name='Automatic', exact=True).click()
        expect(self.page.get_by_role('spinbutton', name='Reader Max width', exact=True)).to_have_value('0')
        panel.get_by_role('slider').press('Escape')
        self.settings('Page layout', {'writingMode': 'vertical-rl', 'firstDimensionMargin': '137'})
        self.page.get_by_role('button', name='Size presets for left and right margins', exact=True).click()
        self.page.get_by_role('dialog', name='Size presets for left and right margins', exact=True).get_by_role('button', name='50%', exact=True).click()
        expect(self.page.get_by_role('spinbutton', name='Reader Left/right margin', exact=True)).to_have_value('225')

    def test_native_keyboard_save_reload_and_remove_preserve_builtin_choice(self):
        self.settings('Fonts & text', {'fontFamilyGroupOne': 'System Sans'})
        dialog = self.fonts()
        dialog.get_by_role('button', name='Add font', exact=True).press('Enter')
        dialog.get_by_label('Font name', exact=True).fill(FONT['name'])
        dialog.get_by_label('Font file', exact=True).set_input_files({'name': FONT['fileName'], 'mimeType': 'font/woff2', 'buffer': FONT_BYTES})
        dialog.get_by_label('Font name', exact=True).press('Enter')
        expect(dialog.get_by_role('button', name='Use ' + FONT['name'], exact=True)).to_be_visible()
        self.assertEqual(self.catalog(), [FONT])
        actual = self.page.evaluate('''async path => { const cache=await caches.open('ttu-userfonts'); const response=await cache.match(path); return {text:await response.text(),mime:response.headers.get('Content-Type')}; }''', FONT['path'])
        self.assertEqual(actual, {'text': FONT_BYTES.decode(), 'mime': 'font/woff2'})
        dialog.get_by_role('button', name='Done', exact=True).click()
        expect(dialog).to_have_count(0)
        self.settings('Fonts & text')
        dialog = self.fonts()
        expect(dialog.get_by_role('button', name='Use ' + FONT['name'], exact=True)).to_be_enabled()
        dialog.get_by_role('button', name='Remove ' + FONT['name'], exact=True).click()
        expect(dialog).to_contain_text('No custom fonts yet.')
        self.assertEqual(self.catalog(), [])
        self.assertEqual(self.page.evaluate('localStorage.getItem("fontFamilyGroupOne")'), 'System Sans')
        self.assertFalse(self.page.evaluate('''async path => !!(await (await caches.open('ttu-userfonts')).match(path))''', FONT['path']))

    def test_opening_cache_failure_and_retry_never_prune_saved_or_unlisted_fonts(self):
        self.settings('Fonts & text', {'userfonts': json.dumps([FONT]), 'fontFamilyGroupOne': 'System Sans'})
        self.page.evaluate('''async () => {
          const cache=await caches.open('ttu-userfonts');
          await cache.put('/userfonts/unlisted.ttf',new Response('synthetic unlisted bytes'));
          const open=caches.open.bind(caches); window.__denyFontCache=true;
          caches.open=(name)=>name==='ttu-userfonts' && window.__denyFontCache ? Promise.reject(new Error('Font cache temporarily denied')) : open(name);
        }''')
        dialog = self.fonts()
        expect(dialog.get_by_role('alert')).to_contain_text('Font cache temporarily denied')
        self.assertEqual(self.catalog(), [FONT])
        self.page.evaluate('window.__denyFontCache=false')
        dialog.get_by_role('button', name='Retry font storage', exact=True).click()
        expect(dialog.get_by_role('button', name='Use ' + FONT['name'], exact=True)).to_be_disabled()
        expect(dialog).to_contain_text('File unavailable.')
        self.assertEqual(self.catalog(), [FONT])
        self.assertTrue(self.page.evaluate("async () => !!(await (await caches.open('ttu-userfonts')).match('/userfonts/unlisted.ttf'))"))

    def test_font_submission_validation_and_close_during_native_save(self):
        self.settings('Fonts & text')
        dialog = self.fonts()
        dialog.get_by_role('button', name='Add font', exact=True).click()
        dialog.get_by_label('Font name', exact=True).fill('Klee One')
        dialog.get_by_label('Font file', exact=True).set_input_files({'name': FONT['fileName'], 'mimeType': 'font/woff2', 'buffer': FONT_BYTES})
        dialog.get_by_label('Font name', exact=True).press('Enter')
        expect(dialog.get_by_role('alert')).to_contain_text('reserved for a built-in font')
        self.assertEqual(self.catalog(), [])
        dialog.get_by_label('Font name', exact=True).fill(FONT['name'])
        self.page.evaluate('''() => {
          const put=Cache.prototype.put;
          Cache.prototype.put=async function(request,response) {
            if (String(request).includes('/userfonts/review.WOFF2')) {
              window.__fontPutStarted=true;
              await new Promise(resolve=>{window.__releaseFontPut=resolve;});
            }
            return put.call(this,request,response);
          };
        }''')
        dialog.get_by_role('button', name='Save font', exact=True).press('Enter')
        self.page.wait_for_function('window.__fontPutStarted === true')
        expect(dialog.get_by_role('button', name='Save font', exact=True)).to_be_disabled()
        dialog.get_by_role('button', name='Done', exact=True).click()
        expect(dialog).to_have_count(0)
        self.page.evaluate('window.__releaseFontPut()')
        self.page.wait_for_function('JSON.parse(localStorage.getItem("userfonts") || "[]").length === 1')
        self.assertEqual(self.catalog(), [FONT])
        dialog = self.fonts()
        expect(dialog.get_by_role('button', name='Use ' + FONT['name'], exact=True)).to_be_visible()

    def test_compact_large_text_panels_keep_targets_and_labels_reachable(self):
        for mode in ('light', 'dark'):
            with self.subTest(mode=mode):
                self.page.set_viewport_size({'width': 320, 'height': 568})
                self.settings('Fonts & text', {'appearance': mode})
                self.page.evaluate('document.documentElement.style.fontSize="200%"')
                dialog = self.fonts()
                dialog.get_by_role('button', name='Add font', exact=True).click()
                expect(dialog.get_by_label('Font name', exact=True)).to_be_visible()
                self.assert_reachable(dialog.get_by_role('button', name='Save font', exact=True))
                self.capture(mode + '-font-form-320-200')
                self.assert_reachable(dialog.get_by_role('button', name='Done', exact=True))
                dialog.get_by_role('button', name='Done', exact=True).click()
                expect(dialog).to_have_count(0)
                self.page.get_by_role('navigation', name='Settings categories').get_by_role('button', name='Page layout', exact=True).click()
                self.page.get_by_role('button', name='Size presets for', exact=False).first.click()
                panel = self.page.get_by_role('dialog', name='Size presets for', exact=False)
                self.assert_reachable(panel.get_by_role('button', name='50%', exact=True))
                self.assertLessEqual(panel.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
                self.capture(mode + '-size-presets-320-200')
                panel.get_by_role('slider').press('Escape')


if __name__ == '__main__':
    unittest.main()
