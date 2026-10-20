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
        nav.get_by_role('link', name=section, exact=True).click()
        expect(self.page.locator('#settings-content').get_by_role('heading', name=section, exact=True)).to_be_visible()

    def fonts(self):
        self.page.locator('[data-setting="primary-font-input"]').get_by_role('button', name='Custom fonts', exact=True).click()
        dialog = self.dialog()
        expect(dialog.get_by_role('heading', name='Custom fonts', exact=True)).to_be_visible()
        expect(dialog.get_by_role('status')).to_have_count(0)
        return dialog

    def catalog(self):
        return self.page.evaluate('JSON.parse(localStorage.getItem("userfonts") || "[]")')

    def capture(self, name, animations='allow'):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        self.page.screenshot(path=str(output / (self.engine + '-settings-' + name + '.png')), animations=animations)

    def assert_reachable(self, button):
        button.scroll_into_view_if_needed()
        box = button.bounding_box()
        self.assertGreaterEqual(box['height'], 43.99)
        self.assertGreaterEqual(box['x'], -1)
        self.assertLessEqual(box['x'] + box['width'], self.page.viewport_size['width'] + 1)
        self.assertTrue(button.evaluate('e => { const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return e===hit || e.contains(hit); }'))

    def test_workspace_reflows_with_container_width_and_text_size_without_losing_search(self):
        self.settings('Fonts & text')
        workspace = self.page.locator('.settings-workspace')
        search = self.page.get_by_role('searchbox', name='Search settings', exact=True)
        search.fill('font')
        original = search.element_handle()
        try:
            for width, scale, sidebar in (
                (1200, 100, True), (800, 100, False),
                (900, 200, False), (1200, 200, False), (1200, 100, True)
            ):
                self.page.set_viewport_size({'width': width, 'height': 900})
                self.page.evaluate('scale => document.documentElement.style.fontSize = scale + "%"', scale)
                expect(workspace).to_have_attribute('data-settings-layout', 'sidebar' if sidebar else 'compact')
                expect(search).to_have_value('font')
                expect(search).to_be_focused()
                self.assertTrue(search.evaluate('(element, original) => element === original', original))
                geometry = workspace.evaluate('''root => {
                  const a = root.querySelector('aside').getBoundingClientRect();
                  const m = root.querySelector('main').getBoundingClientRect();
                  const r = root.getBoundingClientRect();
                  return {below:m.top >= a.bottom, content:m.width, workspace:r.width,
                    overflow:document.documentElement.scrollWidth-innerWidth};
                }''')
                self.assertEqual(not sidebar, geometry['below'], geometry)
                self.assertLessEqual(geometry['overflow'], 1, geometry)
                if not sidebar:
                    self.assertAlmostEqual(geometry['workspace'], geometry['content'], delta=1)
                self.capture(f'workspace-{width}-{scale}')
            # A wide window can host a narrower pane. Container size owns layout.
            workspace.evaluate('e => e.style.maxWidth = "600px"')
            expect(workspace).to_have_attribute('data-settings-layout', 'compact')
            workspace.evaluate('e => e.style.maxWidth = ""')
            expect(workspace).to_have_attribute('data-settings-layout', 'sidebar')
            search.fill('')
            expect(self.page.get_by_role('navigation', name='Settings categories')
                   .get_by_role('link', name='Fonts & text', exact=True)).to_have_attribute('aria-current', 'page')
        finally:
            original.dispose()

    def test_expo_switch_keeps_keyboard_label_and_saved_preference_at_large_text(self):
        self.page.set_viewport_size({'width': 320, 'height': 640})
        self.settings('Reading controls', {'showPercentage': '0'})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        field = self.page.locator('[data-setting="show-percentage"]')
        switch = field.get_by_role('switch', name='Show Percentage', exact=True)
        expect(switch).not_to_be_checked()
        self.assertEqual(switch.evaluate('e => e.tagName'), 'INPUT')
        label = field.locator('[data-ui-toggle="switch"] label')
        self.assert_reachable(label)
        switch.press('Space')
        expect(switch).to_be_checked()
        expect(switch).to_be_focused()
        self.page.wait_for_function('() => localStorage.getItem("showPercentage") === "1"')
        self.capture('expo-switch-320-200', animations='disabled')
        self.assertLessEqual(self.page.locator('html').evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        # The visible state label operates the same named input exactly once.
        label.get_by_text('On', exact=True).click()
        expect(switch).not_to_be_checked()
        self.page.wait_for_function('() => localStorage.getItem("showPercentage") === "0"')
        switch.press('Space')
        self.page.wait_for_function('() => localStorage.getItem("showPercentage") === "1"')
        self.page.reload()
        self.page.get_by_role('navigation', name='Settings categories').get_by_role('link', name='Reading controls', exact=True).click()
        expect(switch).to_be_checked()
        self.page.set_viewport_size({'width': 1200, 'height': 900})
        self.assert_reachable(label)
        self.capture('expo-switch-desktop', animations='disabled')

    def test_background_expo_switches_keep_separate_labels_and_saved_values(self):
        self.settings('Appearance', {
            'manabi.background.library': json.dumps({'fade': True, 'amount': 25}),
            'manabi.background.reader': json.dumps({'fade': True, 'amount': 60})
        })
        self.page.get_by_text('Background images', exact=True).click()
        library = self.page.get_by_role('switch', name='Fade book browser background', exact=True)
        reader = self.page.get_by_role('switch', name='Fade book reader background', exact=True)
        expect(library).to_be_checked()
        expect(reader).to_be_checked()
        library.press('Space')
        expect(library).not_to_be_checked()
        expect(reader).to_be_checked()
        self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("manabi.background.library"))'), {'fade': False, 'amount': 25})
        self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("manabi.background.reader"))'), {'fade': True, 'amount': 60})
        self.page.reload()
        self.page.get_by_text('Background images', exact=True).click()
        expect(library).not_to_be_checked()
        expect(reader).to_be_checked()

    def test_shared_choices_keep_keyboard_focus_and_saved_writing_mode(self):
        self.page.set_viewport_size({'width': 320, 'height': 640})
        self.settings('Page layout', {'writingMode': 'horizontal-tb'})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        group = self.page.get_by_role('group', name='Writing mode', exact=True)
        horizontal = group.get_by_role('button', name='Horizontal', exact=True)
        vertical = group.get_by_role('button', name='Vertical', exact=True)
        expect(horizontal).to_have_attribute('aria-pressed', 'true')
        self.assert_reachable(vertical)
        vertical.press('Enter')
        expect(vertical).to_have_attribute('aria-pressed', 'true')
        expect(vertical).to_be_focused()
        expect(horizontal).to_have_attribute('aria-pressed', 'false')
        self.page.wait_for_function('() => localStorage.getItem("writingMode") === "vertical-rl"')
        self.assertLessEqual(self.page.locator('html').evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        self.capture('choices-writing-320-200', animations='disabled')
        horizontal.press('Space')
        expect(horizontal).to_have_attribute('aria-pressed', 'true')
        expect(horizontal).to_be_focused()
        self.page.wait_for_function('() => localStorage.getItem("writingMode") === "horizontal-tb"')
        self.page.reload()
        self.page.get_by_role('navigation', name='Settings categories').get_by_role('link', name='Page layout', exact=True).click()
        expect(horizontal).to_have_attribute('aria-pressed', 'true')

    def test_shared_appearance_choices_wrap_and_preserve_theme_controls(self):
        self.settings('Appearance', {'appearance': 'light'})
        group = self.page.get_by_role('group', name='Appearance mode', exact=True)
        for width, scale, mode in ((1200, 100, 'Light'), (390, 100, 'Dark'), (320, 200, 'Light'), (320, 200, 'Dark')):
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.page.evaluate('scale => document.documentElement.style.fontSize = scale + "%"', scale)
            choice = group.get_by_role('button', name=mode, exact=True)
            choice.click()
            expect(choice).to_have_attribute('aria-pressed', 'true')
            self.page.wait_for_function('mode => localStorage.getItem("appearance") === mode', arg=mode.lower())
            for name in ('System', 'Light', 'Dark'):
                self.assert_reachable(group.get_by_role('button', name=name, exact=True))
            self.assertLessEqual(self.page.locator('html').evaluate('e => e.scrollWidth-e.clientWidth'), 1)
            group.scroll_into_view_if_needed()
            self.capture(f'choices-appearance-{width}-{scale}-{mode.lower()}', animations='disabled')
        # The specialized theme editor remains alongside the common scalar controls.
        add_theme = self.page.get_by_role('button', name='Add custom theme', exact=True)
        add_theme.click()
        expect(self.dialog()).to_be_visible()
        self.dialog().get_by_role('button', name='Cancel', exact=True).click()
        expect(add_theme).to_be_focused()

    def test_shared_theme_editor_keeps_drafts_and_actions_reachable_at_enlarged_text(self):
        self.settings('Appearance', {'appearance': 'dark', 'theme': 'manabi-theme'})
        before = self.page.evaluate('localStorage.getItem("customThemes")')
        add = self.page.get_by_role('button', name='Add custom theme', exact=True)
        for width, scale in ((1200, 100), (390, 100), (320, 200)):
            self.page.set_viewport_size({'width': width, 'height': 480 if width == 320 else 640})
            self.page.evaluate('v => document.documentElement.style.fontSize = v + "%"', scale)
            add.click()
            dialog = self.dialog()
            expect(dialog.get_by_role('heading', name='New custom theme', exact=True)).to_be_visible()
            name = dialog.get_by_label('Theme name', exact=True)
            dialog.get_by_role('button', name='Save', exact=True).click()
            expect(name).to_be_focused()
            self.assertIn('Enter a theme name', name.evaluate('e => e.validationMessage'))
            name.fill('Unsaved palette')
            expect(name).to_have_attribute('aria-invalid', 'false')
            self.assertLessEqual(dialog.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
            self.assert_reachable(dialog.get_by_label('Font color', exact=True))
            self.assert_reachable(dialog.get_by_label('Footer Font opacity', exact=True))
            cancel = dialog.get_by_role('button', name='Cancel', exact=True)
            self.assert_reachable(cancel)
            self.capture(f'theme-editor-{width}-{scale}', animations='disabled')
            cancel.click()
            expect(dialog).to_have_count(0)
            expect(add).to_be_focused()
            self.assertEqual(before, self.page.evaluate('localStorage.getItem("customThemes")'))

    def test_shared_theme_editor_copies_current_appearance_and_preserves_color_alpha(self):
        self.settings('Appearance', {'appearance': 'dark', 'theme': 'manabi-theme'})
        self.page.get_by_role('button', name='Add custom theme', exact=True).click()
        dialog = self.dialog()
        copy = dialog.get_by_label('Copy colors from theme', exact=True)
        expect(copy).to_have_value('manabi-theme')
        initial = dialog.get_by_label('Background color', exact=True).input_value()
        copy.select_option('water-theme')
        dialog.get_by_role('button', name='Copy', exact=True).click()
        copy.select_option('manabi-theme')
        dialog.get_by_role('button', name='Copy', exact=True).click()
        expect(dialog.get_by_label('Background color', exact=True)).to_have_value(initial)
        opacity = dialog.get_by_label('Font opacity', exact=True)
        opacity.fill('0')
        color = dialog.get_by_label('Font color', exact=True)
        color.fill('#123456')
        expect(opacity).to_have_value('0')
        opacity.fill('0.4')
        expect(color).to_have_value('#123456')
        dialog.get_by_label('Theme name', exact=True).fill('Copied dark palette')
        dialog.get_by_role('button', name='Save', exact=True).click()
        expect(dialog).to_have_count(0)
        saved = self.page.evaluate('JSON.parse(localStorage.getItem("customThemes"))["Copied dark palette"]')
        self.assertEqual(saved['fontColor'], 'rgba(18,52,86,0.4)')
        self.page.reload()
        self.page.get_by_role('button', name='Edit Copied dark palette theme', exact=True).click()
        expect(self.page.get_by_label('Font color', exact=True)).to_have_value('#123456')
        expect(self.page.get_by_label('Font opacity', exact=True)).to_have_value('0.4')

    def test_expo_switch_checked_thumb_uses_the_current_theme_foreground(self):
        self.page.set_viewport_size({'width': 320, 'height': 640})
        for mode in ('light', 'dark'):
            self.settings('Reading controls', {'appearance': mode, 'showPercentage': '1'})
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')
            switch = self.page.get_by_role('switch', name='Show Percentage', exact=True)
            expect(switch).to_be_checked()
            switch.scroll_into_view_if_needed()
            self.capture('expo-switch-' + mode + '-200', animations='disabled')
            colors = switch.evaluate('''input => {
              const label = input.labels[0];
              const thumb = label.lastElementChild.firstElementChild;
              const probe = document.createElement('span');
              probe.style.color = 'var(--primary-foreground)';
              probe.style.position = 'fixed';
              document.body.appendChild(probe);
              try { return {actual:getComputedStyle(thumb).backgroundColor, expected:getComputedStyle(probe).color}; }
              finally { probe.remove(); }
            }''')
            self.assertEqual(colors['actual'], colors['expected'], mode)

    def test_shared_theme_swatches_keep_colors_actions_and_delete_scope_at_large_text(self):
        name = 'Evening reading palette'
        palette = {
            'fontColor': '#112233', 'backgroundColor': '#edf3ff',
            'selectionFontColor': '#ffffff', 'selectionBackgroundColor': '#24506c',
            'hintFuriganaFontColor': 'rgba(17, 34, 51, 0)',
            'hintFuriganaShadowColor': '#778899', 'tooltipTextFontColor': '#334455'
        }
        themes = {name: palette, 'Keep this palette': palette}
        self.settings('Appearance', {'appearance': 'light', 'theme': name, 'customThemes': json.dumps(themes)})
        group = self.page.get_by_role('group', name='Theme', exact=True)
        selected = group.get_by_role('button', name=name, exact=True)
        edit = group.get_by_role('button', name=f'Edit {name} theme', exact=True)
        delete = group.get_by_role('button', name=f'Delete {name} theme', exact=True)
        for width, scale in ((1200, 100), (390, 100), (320, 200)):
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.page.evaluate('scale => document.documentElement.style.fontSize = scale + "%"', scale)
            for control in (selected, edit, delete, group.get_by_role('button', name='Add custom theme', exact=True)):
                self.assert_reachable(control)
            selected.hover()
            expect(selected).to_have_attribute('aria-pressed', 'true')
            self.assertEqual(selected.evaluate('e => getComputedStyle(e).backgroundColor'), 'rgb(237, 243, 255)')
            self.assertEqual(selected.evaluate('e => getComputedStyle(e.firstElementChild).color'), 'rgb(17, 34, 51)')
            self.assertAlmostEqual(edit.bounding_box()['y'], delete.bounding_box()['y'], delta=1)
            self.assertLessEqual(self.page.locator('html').evaluate('e => e.scrollWidth-e.clientWidth'), 1)
            selected.scroll_into_view_if_needed()
            self.capture(f'theme-chooser-{width}-{scale}', animations='disabled')
        # Cancel returns to the same selected swatch action without changing its palette.
        edit.click()
        expect(self.dialog().get_by_label('Font color', exact=True)).to_have_value('#112233')
        self.dialog().get_by_role('button', name='Cancel', exact=True).click()
        expect(edit).to_be_focused()
        self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("customThemes"))'), themes)
        self.page.reload()
        expect(selected).to_have_attribute('aria-pressed', 'true')
        delete.click()
        expect(selected).to_have_count(0)
        expect(group.get_by_role('button', name='Manabi', exact=True)).to_have_attribute('aria-pressed', 'true')
        self.assertEqual(self.page.evaluate('localStorage.getItem("theme")'), 'manabi-theme')
        self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("customThemes"))'), {'Keep this palette': palette})
        expect(group.get_by_role('button', name='Edit Keep this palette theme', exact=True)).to_have_count(0)

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
        self.page.get_by_role('navigation', name='Settings categories').get_by_role('link', name='Page layout', exact=True).click()
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

    def test_size_slider_preview_cancel_resize_and_keyboard_commit_have_distinct_effects(self):
        self.page.set_viewport_size({'width': 900, 'height': 600})
        self.settings('Page layout', {'writingMode': 'horizontal-tb', 'firstDimensionMargin': '137'})
        trigger = self.page.get_by_role('button', name='Size presets for top and bottom margins', exact=True)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Size presets for top and bottom margins', exact=True)
        slider = panel.get_by_role('slider', name='Quick size for top and bottom margins', exact=True)
        slider.evaluate('''e => { e.value = '50'; e.dispatchEvent(new Event('input', {bubbles:true})); }''')
        expect(slider).to_have_attribute('aria-valuetext', '50%, 150 pixels per side')
        expect(panel).to_contain_text('Current: 137 px per side')
        self.assertEqual(self.page.evaluate('localStorage.getItem("firstDimensionMargin")'), '137')
        self.page.set_viewport_size({'width': 900, 'height': 800})
        expect(slider).to_have_attribute('aria-valuetext', '35%, 140 pixels per side')
        slider.dispatch_event('change')
        self.assertEqual(self.page.evaluate('localStorage.getItem("firstDimensionMargin")'), '137')
        slider.press('ArrowRight')
        expect(self.page.get_by_role('spinbutton', name='Reader Top/bottom margin', exact=True)).to_have_value('160')
        slider.evaluate('''e => { e.value = '25'; e.dispatchEvent(new Event('input', {bubbles:true})); }''')
        expect(slider).to_have_attribute('aria-valuetext', '25%, 100 pixels per side')
        slider.dispatch_event('pointercancel')
        slider.dispatch_event('change')
        expect(panel).to_contain_text('Current: 160 px per side')
        self.assertEqual(self.page.evaluate('localStorage.getItem("firstDimensionMargin")'), '160')
        slider.press('Escape')
        expect(trigger).to_be_focused()
        self.page.reload()
        self.page.get_by_role('navigation', name='Settings categories').get_by_role('link', name='Page layout', exact=True).click()
        expect(self.page.get_by_role('spinbutton', name='Reader Top/bottom margin', exact=True)).to_have_value('160')

    def test_size_editor_reflows_and_keeps_every_action_reachable_at_enlarged_text(self):
        for mode in ('light', 'dark'):
            self.settings('Page layout', {'appearance': mode, 'writingMode': 'vertical-rl', 'secondDimensionMaxValue': '0'})
            for width, scale in ((1200, 100), (390, 100), (320, 200)):
                self.page.set_viewport_size({'width': width, 'height': 480})
                self.page.evaluate('v => document.documentElement.style.fontSize = v + "%"', scale)
                trigger = self.page.get_by_role('button', name='Size presets for maximum page height', exact=True)
                trigger.click()
                panel = self.page.get_by_role('dialog', name='Size presets for maximum page height', exact=True)
                expect(panel).to_contain_text('Current: Automatic')
                self.assertLessEqual(panel.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
                self.assert_reachable(panel.get_by_role('slider'))
                for label in ('75%', '50%', 'Automatic'):
                    self.assert_reachable(panel.get_by_role('button', name=label, exact=True))
                self.capture(f'dimension-editor-{mode}-{width}-{scale}', animations='disabled')
                panel.get_by_role('slider').press('Escape')
                expect(panel).to_have_count(0)
                expect(trigger).to_be_focused()
                self.assertEqual(self.page.evaluate('localStorage.getItem("secondDimensionMaxValue")'), '0')

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
          window.__unlistedFontWasStored=!!(await cache.match('/userfonts/unlisted.ttf'));
          window.__fontDeleteCalls=[];
          const remove=Cache.prototype.delete;
          Cache.prototype.delete=function(request,options) {
            window.__fontDeleteCalls.push(String(request));
            return remove.call(this,request,options);
          };
          const open=CacheStorage.prototype.open; window.__denyFontCache=true;
          CacheStorage.prototype.open=function(name) {
            return name==='ttu-userfonts' && window.__denyFontCache
              ? Promise.reject(new Error('Font cache temporarily denied')) : open.call(this,name);
          };
        }''')
        dialog = self.fonts()
        expect(dialog.get_by_role('alert')).to_contain_text('Font cache temporarily denied')
        self.assertEqual(self.catalog(), [FONT])
        self.page.evaluate('window.__denyFontCache=false')
        dialog.get_by_role('button', name='Retry font storage', exact=True).click()
        expect(dialog.get_by_role('button', name='Use ' + FONT['name'], exact=True)).to_be_disabled()
        expect(dialog).to_contain_text('File unavailable.')
        self.assertEqual(self.catalog(), [FONT])
        self.assertEqual(self.page.evaluate('window.__fontDeleteCalls'), [])
        # Some WebKit builds acknowledge Cache.put but do not retain synthetic
        # entries. When the fixture is retained, verify the actual bytes too.
        if self.page.evaluate('window.__unlistedFontWasStored'):
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
        save = dialog.get_by_role('button', name='Save font', exact=True)
        save.press('Enter')
        # Disabled is set synchronously before Cache.put suspends. This proves the
        # real submit handler owns the pending operation without CSP-unsafe eval.
        expect(save).to_be_disabled()
        self.assertTrue(self.page.evaluate('() => window.__fontPutStarted === true'))
        dialog.get_by_role('button', name='Done', exact=True).click()
        expect(dialog).to_have_count(0)
        self.page.evaluate('() => window.__releaseFontPut()')
        dialog = self.fonts()
        # Reopening waits for native CacheStorage enumeration, which also gives the
        # explicit save time to publish its metadata after the held put completes.
        expect(dialog.get_by_role('button', name='Use ' + FONT['name'], exact=True)).to_be_visible()
        self.assertEqual(self.catalog(), [FONT])

    def test_stored_font_rows_reflow_and_navigation_never_changes_saved_preferences(self):
        missing = {'name': 'Missing' + 'LongName' * 16, 'fileName': 'missing' + 'file' * 30 + '.woff2', 'path': '/userfonts/missing.woff2'}
        for mode in ('light', 'dark'):
            self.settings('Fonts & text', {'appearance': mode, 'userfonts': json.dumps([missing]), 'fontFamilyGroupOne': 'System Sans'})
            before = self.page.evaluate("[localStorage.getItem('userfonts'),localStorage.getItem('fontFamilyGroupOne')]")
            for width, scale in ((1200, 100), (390, 100), (320, 200)):
                self.page.set_viewport_size({'width': width, 'height': 568})
                self.page.evaluate('v => document.documentElement.style.fontSize=v+"%"', scale)
                dialog = self.fonts()
                listing = dialog.get_by_role('list', name='Stored custom fonts', exact=True)
                expect(listing.get_by_role('listitem')).to_have_count(1)
                expect(listing.get_by_role('button', name='Use ' + missing['name'], exact=True)).to_be_disabled()
                remove = listing.get_by_role('button', name='Remove ' + missing['name'], exact=True)
                expect(remove).to_be_enabled()
                self.assert_reachable(remove)
                self.assertLessEqual(dialog.evaluate('e=>e.scrollWidth-e.clientWidth'), 1)
                self.assertLessEqual(dialog.locator('[data-dialog-scroll]').evaluate('e=>e.scrollWidth-e.clientWidth'), 1)
                self.capture(f'font-list-{mode}-{width}-{scale}')
                dialog.get_by_role('button', name='Add font', exact=True).click()
                name = dialog.get_by_label('Font name', exact=True)
                # Shared FieldFrame retains native HTML label activation.
                dialog.locator('label').filter(has_text='Font name').click()
                expect(name).to_be_focused()
                name.fill('Unsaved local font')
                dialog.get_by_role('button', name='Stored fonts', exact=True).click()
                expect(listing).to_be_visible()
                dialog.get_by_role('button', name='Done', exact=True).click()
                expect(dialog).to_have_count(0)
                self.assertEqual(before, self.page.evaluate("[localStorage.getItem('userfonts'),localStorage.getItem('fontFamilyGroupOne')]"))

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
                self.page.get_by_role('navigation', name='Settings categories').get_by_role('link', name='Page layout', exact=True).click()
                self.page.get_by_role('button', name='Size presets for', exact=False).first.click()
                panel = self.page.get_by_role('dialog', name='Size presets for', exact=False)
                self.assert_reachable(panel.get_by_role('button', name='50%', exact=True))
                self.assertLessEqual(panel.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
                self.capture(mode + '-size-presets-320-200')
                panel.get_by_role('slider').press('Escape')


if __name__ == '__main__':
    unittest.main()
