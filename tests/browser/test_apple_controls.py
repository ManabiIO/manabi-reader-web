"""Actual-app Apple.com-inspired action hierarchy and theme-editor recovery.

Retains all continuation, catalog, IME, pending-write, and keyboard regressions.
No replacement components or screenshot-only UI fixtures.
"""
import json
import unittest
from playwright.sync_api import expect
import test_resume_refinement as previous
from test_books_library import book

# Keep the existing catalog cases in this combined entry point exactly once.
CatalogLifetimeBrowser = previous.CatalogLifetimeBrowser


class AppleControlsBrowser(previous.ResumeControlsBrowser):
    def style(self, button):
        return button.evaluate('''e => {
          const s = getComputedStyle(e), r = e.getBoundingClientRect();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d', {willReadFrequently:true});
          const rgba = value => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
          return {fill:rgba(s.backgroundColor), ink:rgba(s.color),
            border:rgba(s.borderTopColor), borderWidth:parseFloat(s.borderTopWidth),
            radius:parseFloat(s.borderTopLeftRadius), font:parseFloat(s.fontSize),
            weight:s.fontWeight, decoration:s.textDecorationLine, translate:s.translate,
            insets:[parseFloat(s.paddingInlineStart),parseFloat(s.paddingInlineEnd)],
            blockInset:parseFloat(s.paddingBlockStart), alignment:s.textAlign,
            box:[r.x,r.y,r.width,r.height]};
        }''')

    def settle(self, button):
        button.evaluate('''async e => {
          await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})));
        }''')

    def contrast(self, foreground, background):
        def luminance(color):
            linear = [v / 255 / 12.92 if v / 255 <= 0.04045 else
                      ((v / 255 + 0.055) / 1.055) ** 2.4 for v in color[:3]]
            return sum(a * b for a, b in zip(linear, [0.2126, 0.7152, 0.0722]))
        low, high = sorted([luminance(foreground), luminance(background)])
        return (high + 0.05) / (low + 0.05)

    def test_action_emphasis_hover_and_link_navigation_in_both_modes(self):
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            self.go_library()
            expect(self.page.locator('html')).to_have_attribute('data-appearance', mode)
            self.page.set_viewport_size({'width': 1200, 'height': 1000})
            area = self.page.locator('[data-slot="library-empty-state"]')
            primary = area.get_by_role('button', name='Import File(s)', exact=True)
            outline = area.get_by_role('button', name='Import Backup', exact=True)
            neutral = area.get_by_role('link', name='Google Drive', exact=True)
            text = area.get_by_role('link', name='Import from Ttu Ebook Reader', exact=True)
            self.page.mouse.move(1, 1)
            p, o, n, t = [self.style(e) for e in (primary, outline, neutral, text)]
            for style in (p, o, n):
                self.assertGreaterEqual(style['radius'], style['box'][3] / 2)
                self.assertEqual('none', style['translate'])
                self.assertEqual('400', style['weight'])
            self.assertGreaterEqual(p['font'], 17)
            self.assertEqual([22, 22], p['insets'])
            self.assertEqual(10, p['blockInset'])
            self.assertEqual(255, p['fill'][3])
            self.assertGreaterEqual(self.contrast(p['ink'], p['fill']), 4.5)
            self.assertEqual(0, o['fill'][3])
            self.assertEqual(1, o['borderWidth'])
            self.assertEqual(p['fill'], o['border'])
            self.assertEqual(o['ink'], o['border'])
            self.assertEqual(255, n['fill'][3])
            self.assertNotEqual(n['fill'], p['fill'])
            self.assertEqual(0, t['fill'][3])
            self.assertEqual(0, t['borderWidth'])
            self.assertEqual(0, t['radius'])
            self.assertEqual([0, 0], t['insets'])
            self.assertEqual('start', t['alignment'])
            self.assertEqual(p['fill'], t['ink'])
            expect(text.locator('svg')).to_have_attribute('aria-hidden', 'true')
            canvas = self.style(area)['fill']
            for style in (o, t):
                self.assertGreaterEqual(self.contrast(style['ink'], canvas), 4.5)
            self.capture('apple-action-hierarchy-' + mode)

            outline.hover()
            self.settle(outline)
            hovered = self.style(outline)
            self.assertEqual(p['fill'], hovered['fill'])
            self.assertEqual(p['ink'], hovered['ink'])
            self.assertEqual(o['box'], hovered['box'])
            primary.hover()
            self.settle(primary)
            hovered = self.style(primary)
            self.assertEqual(255, hovered['fill'][3])
            self.assertNotEqual(p['fill'], hovered['fill'])
            self.assertEqual(p['box'], hovered['box'])
            self.assertGreaterEqual(self.contrast(hovered['ink'], hovered['fill']), 4.5)
            text.hover()
            self.settle(text)
            self.assertIn('underline', self.style(text)['decoration'])
            self.assertEqual(t['box'], self.style(text)['box'])

        # Exercise the real import action after styling it, not just its markup.
        with self.page.expect_file_chooser() as chooser:
            primary.click()
        chooser.value.set_files({'name': 'Apple action.epub',
                                 'mimeType': 'application/epub+zip',
                                 'buffer': book('Apple action')})
        expect(self.page.get_by_role('button', name='Read Apple action', exact=True)).to_be_visible()

    def test_custom_theme_editor_reopens_validates_and_saves_after_input_migration(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.goto(self.origin + '/Reader-Web/settings')
        trigger = self.page.get_by_role('button', name='Add custom theme', exact=True)
        for _ in range(3):
            trigger.click()
            panel = self.dialog()
            self.check_modal(panel)
            name = panel.get_by_label('Theme name', exact=True)
            expect(name).to_have_value('')
            panel.get_by_role('button', name='Save', exact=True).click()
            expect(panel.get_by_role('alert')).to_have_text('Enter a theme name.')
            expect(name).to_be_focused()
            name.fill('Unsaved attempt')
            self.page.keyboard.press('Escape')
            expect(panel).to_have_count(0)
            expect(trigger).to_be_focused()
            self.assertNotIn('Unsaved attempt', self.page.evaluate('localStorage.getItem("customThemes") || ""'))
        trigger.click()
        panel = self.dialog()
        panel.get_by_label('Theme name', exact=True).fill('Apple pass custom')
        self.capture('apple-theme-editor')
        panel.get_by_role('button', name='Save', exact=True).click()
        expect(panel).to_have_count(0)
        saved = json.loads(self.page.evaluate('localStorage.getItem("customThemes")'))
        self.assertIn('Apple pass custom', saved)


if __name__ == '__main__':
    unittest.main(verbosity=2)
