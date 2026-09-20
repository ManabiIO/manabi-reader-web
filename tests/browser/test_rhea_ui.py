"""Actual Rhea UI plus the complete inherited appearance/reader suite.

No UI replacements, request interception, or fake font availability. Book and
wallpaper fixtures are generated locally by the existing acceptance harness.
"""
from pathlib import Path
import unittest
from playwright.sync_api import expect
import test_appearance_refinement as previous


class RheaReader(previous.RefinedAppearance):
    def category(self, name):
        self.page.get_by_role('navigation', name='Settings categories').get_by_role(
            'button', name=name, exact=True).click()

    def test_navigation_sheet_is_labeled_keyboard_operable_and_mobile_sized(self):
        self.page.set_viewport_size({'width':390, 'height':844})
        self.page.goto(self.origin + '/Reader-Web/manage')
        trigger = self.page.get_by_role('button', name='Navigate', exact=True)
        trigger.focus()
        trigger.press('Enter')
        navigation = self.page.get_by_role('navigation', name='Main navigation')
        expect(navigation).to_be_visible()
        for name in ['Library','Statistics','Settings','Accounts and libraries','Shared libraries','Import from Ttu Ebook Reader']:
            expect(navigation.get_by_role('link', name=name, exact=True)).to_be_visible()
        expect(navigation.get_by_role('link', name='Library', exact=True)).to_have_attribute('aria-current', 'page')
        self.page.keyboard.press('Escape')
        expect(navigation).to_have_count(0)
        expect(trigger).to_be_focused()
        trigger.click()
        navigation.get_by_role('link', name='Settings', exact=True).click()
        expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)
        self.page.screenshot(path='test-results/rhea-mobile-settings.png', full_page=True)

    def test_settings_categories_global_search_and_persistent_values(self):
        self.settings()
        font = self.page.get_by_label('Font size', exact=True)
        expect(font).to_be_hidden()
        self.category('Fonts & text')
        expect(font).to_be_visible()
        font.fill('24')
        font.press('Tab')
        self.assertEqual('24', self.page.evaluate('localStorage.getItem("fontSize")'))
        self.category('Reading controls')
        search = self.page.get_by_label('Search settings', exact=True)
        search.fill('font size')
        expect(font).to_be_visible()
        expect(self.page.get_by_role('status').filter(has_text='matching settings')).to_be_visible()
        search.fill('nothingmatches-this-query')
        expect(self.page.get_by_role('status').filter(has_text='No matching settings')).to_be_visible()
        search.fill('')
        self.category('All settings')
        for name in ['Primary / Serif font','Sans-serif font','Font size','Line Height']:
            expect(self.page.get_by_label(name, exact=True)).to_be_visible()
        self.page.reload()
        self.category('Fonts & text')
        expect(font).to_have_value('24')

    def test_font_menu_keyboard_and_explicit_user_choice(self):
        self.settings()
        self.category('Fonts & text')
        trigger = self.page.get_by_role('button', name='Show available primary / serif fonts', exact=True)
        trigger.focus()
        trigger.press('Enter')
        choice = self.page.get_by_role('menuitemradio', name='Noto Serif JP', exact=True)
        expect(choice).to_be_visible()
        choice.focus()
        choice.press('Enter')
        expect(self.page.get_by_label('Primary / Serif font', exact=True)).to_have_value('Noto Serif JP')
        self.assertEqual('Noto Serif JP', self.page.evaluate('localStorage.getItem("fontFamilyGroupOne")'))
        expect(trigger).to_be_focused()

    def test_dialog_traps_focus_and_escape_preserves_custom_theme(self):
        self.settings()
        trigger = self.page.get_by_role('button', name='Add custom theme', exact=True)
        trigger.click()
        dialog = self.page.locator('[data-slot="dialog-content"]')
        expect(dialog).to_be_visible()
        self.page.get_by_label('Theme name', exact=True).fill('Not saved')
        for _ in range(18):
            self.page.keyboard.press('Tab')
            self.assertTrue(dialog.evaluate('e => e.contains(document.activeElement)'))
        self.page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)
        expect(trigger).to_be_focused()
        self.assertNotIn('Not saved', self.page.evaluate('localStorage.getItem("customThemes") || ""'))

    def test_reader_tools_do_not_turn_pages_and_keep_ttu_commands(self):
        self.open_book(font='Klee One')
        self.wait_for_fonts()
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        toolbar = self.page.get_by_role('banner', name='Reader toolbar')
        expect(toolbar.get_by_role('button', name='Library', exact=True)).to_be_visible()
        expect(toolbar.get_by_role('button', name='Bookmark', exact=True)).to_be_visible()
        tools = toolbar.get_by_role('button', name='Reading tools', exact=True)
        tools.click()
        menu = self.page.get_by_role('menu')
        expect(menu).to_be_visible()
        for name in ['Jump to Position','Complete Book','Set Point','Settings','Statistics']:
            expect(menu.get_by_role('menuitem', name=name, exact=True)).to_be_visible()
        before = self.page.locator('.book-content').evaluate('e => [e.getBoundingClientRect().x,e.getBoundingClientRect().y,window.scrollX,window.scrollY]')
        for key in ['ArrowDown','ArrowDown','End','Home','ArrowUp']:
            self.page.keyboard.press(key)
        after = self.page.locator('.book-content').evaluate('e => [e.getBoundingClientRect().x,e.getBoundingClientRect().y,window.scrollX,window.scrollY]')
        self.assertEqual(before, after)
        self.page.keyboard.press('Escape')
        expect(menu).to_have_count(0)
        expect(tools).to_be_focused()
        self.page.screenshot(path='test-results/rhea-reader-toolbar.png', full_page=True)

    def test_library_sort_and_export_preserve_all_export_parts(self):
        self.open_book(font='Klee One')
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Select Sort Options', exact=True).click()
        menu = self.page.get_by_role('menu')
        for name in ['Added','Title','Characters','Last Update','Last Read','Progress','Bookmarked','Ascending','Descending']:
            expect(menu.get_by_role('menuitemradio', name=name, exact=True)).to_be_visible()
        menu.get_by_role('menuitemradio', name='Title', exact=True).click()
        self.page.get_by_role('button', name='Select books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        self.page.get_by_role('button', name='Export', exact=True).click()
        dialog = self.page.locator('[data-slot="dialog-content"]')
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role('button', name='Zip File', exact=True)).to_be_visible()
        for name in ['Book Data','Bookmark','Statistics','Audiobook','Subtitles']:
            expect(dialog.get_by_label(name, exact=True)).to_be_visible()
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        expect(dialog).to_have_count(0)
        expect(self.page.get_by_role('button', name='Export', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Cancel selection', exact=True).click()
        self.page.get_by_role('button', name='Add books', exact=True).click()
        for name in ['Import File(s)','Import Folder(s)','Import Backup','Import from Ttu Ebook Reader']:
            expect(self.page.get_by_role('menuitem', name=name, exact=True)).to_be_visible()
        self.page.keyboard.press('Escape')

    def test_statistics_navigation_and_options_sheet(self):
        self.page.goto(self.origin + '/Reader-Web/statistics')
        self.page.get_by_role('button', name='Heatmap', exact=True).click()
        expect(self.page.get_by_role('button', name='Heatmap', exact=True)).to_have_attribute('aria-pressed','true')
        self.page.get_by_role('button', name='Summary', exact=True).click()
        self.page.get_by_role('button', name='Statistics options', exact=True).click()
        self.page.get_by_role('menuitem', name='Statistics Settings', exact=True).click()
        panel = self.page.locator('[data-slot="sheet-content"]')
        expect(panel).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)


if __name__ == '__main__':
    Path('test-results').mkdir(exist_ok=True)
    unittest.main(verbosity=2)
