"""Actual Rhea UI plus the complete inherited appearance/reader suite.

No UI replacements, request interception, or fake font availability. Book and
wallpaper fixtures are generated locally by the existing acceptance harness.
"""
from pathlib import Path
import io
import zipfile
import json
from test_static_reader import epub, TITLE
from test_appearance import png
import unittest
from playwright.sync_api import expect
import test_appearance_refinement as previous


class RheaReader(previous.RefinedAppearance):
    def category(self, name):
        self.page.get_by_role('navigation', name='Settings categories').get_by_role(
            'button', name=name, exact=True).click()

    def test_empty_library_has_one_polished_keyboard_import_action(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        action = self.page.get_by_role('button', name='Add your first book', exact=True)
        expect(action).to_be_visible()
        expect(self.page.locator('#first-book-file')).to_be_hidden()
        action.focus()
        expect(action).to_be_focused()

    def test_library_workspace_import_collection_search_and_completion(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.locator('#first-book-file').set_input_files({
            'name': 'acceptance.epub',
            'mimeType': 'application/epub+zip',
            'buffer': epub()
        })
        read = self.page.get_by_role('button', name=f'Read {TITLE}', exact=True)
        expect(read).to_be_visible(timeout=30000)

        self.page.get_by_role('button', name=f'Actions for {TITLE}', exact=True).click()
        self.page.get_by_role('menuitem', name='Add to Collection…', exact=True).click()
        self.page.get_by_role('textbox', name='New collection name', exact=True).fill('Study')
        self.page.get_by_role('button', name='Create', exact=True).click()
        membership = self.page.get_by_role('checkbox', name='Study', exact=True)
        expect(membership).to_be_checked()
        self.page.get_by_role('button', name='Done', exact=True).click()

        self.page.set_viewport_size({'width':390, 'height':844})
        self.page.get_by_role('button', name='Collections', exact=True).click()
        self.page.locator('#library-collections-sheet').get_by_role(
            'button', name='Study', exact=False).click()
        expect(self.page.get_by_role('heading', name='Study', exact=True)).to_be_visible()
        read = self.page.get_by_role('button', name=f'Read {TITLE}', exact=True)
        expect(read).to_be_visible()

        self.page.get_by_role('button', name=f'Actions for {TITLE}', exact=True).click()
        self.page.get_by_role('menuitem', name='Mark as Finished', exact=True).click()
        expect(self.page.locator('.progress-label', has_text='Finished')).to_be_visible()

        search = self.page.get_by_role('searchbox', name='Search library', exact=True)
        search.fill('not-this-book')
        expect(self.page.get_by_role('heading', name='No matching books', exact=True)).to_be_visible()
        search.fill('reader browser')
        expect(read).to_be_visible()

    def test_library_overflow_is_labeled_keyboard_operable_and_mobile_sized(self):
        self.page.set_viewport_size({'width':390, 'height':844})
        self.page.goto(self.origin + '/Reader-Web/manage')
        trigger = self.page.get_by_role('button', name='Library actions', exact=True)
        trigger.focus()
        trigger.press('Enter')
        menu = self.page.get_by_role('menu')
        expect(menu).to_be_visible()
        for name in ['Select Books','Add Books','Accounts and Libraries','Statistics','Settings','Shared Libraries','Report an Issue']:
            expect(menu.get_by_role('menuitem', name=name, exact=True)).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(menu).to_have_count(0)
        expect(trigger).to_be_focused()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)
        trigger.click()
        self.page.get_by_role('menuitem', name='Settings', exact=True).click()
        expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)
        self.page.screenshot(path='test-results/rhea-mobile-settings.png', full_page=True)

    def test_settings_categories_global_search_and_persistent_values(self):
        self.settings()
        font = self.page.get_by_role('spinbutton', name='Font size', exact=True)
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
        for role, name in [('textbox','Primary / Serif font'),('textbox','Sans-serif font'),('spinbutton','Font size'),('spinbutton','Line Height')]:
            expect(self.page.get_by_role(role, name=name, exact=True)).to_be_visible()
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
        expect(self.page.get_by_role('textbox', name='Primary / Serif font', exact=True)).to_have_value('Noto Serif JP')
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
            expect(dialog.locator(':focus')).to_have_count(1)
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
            expect(toolbar).to_be_visible()
        after = self.page.locator('.book-content').evaluate('e => [e.getBoundingClientRect().x,e.getBoundingClientRect().y,window.scrollX,window.scrollY]')
        self.assertEqual(before, after)
        self.page.keyboard.press('Escape')
        expect(menu).to_have_count(0)
        expect(tools).to_be_focused()
        self.page.screenshot(path='test-results/rhea-reader-toolbar.png', full_page=True)

    def test_real_outside_pointer_dismisses_toolbar_after_menu_escape(self):
        self.open_book(font='Klee One')
        self.wait_for_fonts()
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        toolbar = self.page.get_by_role('banner', name='Reader toolbar')
        toolbar.get_by_role('button', name='Reading tools', exact=True).click()
        expect(self.page.get_by_role('menu')).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(toolbar).to_be_visible()
        expect(toolbar.get_by_role('button', name='Reading tools', exact=True)).to_be_focused()
        viewport = self.page.viewport_size
        self.page.mouse.click(viewport['width'] / 2, viewport['height'] - 100)
        expect(toolbar).to_have_count(0)
        expect(self.page.locator('.book-content')).to_be_visible()
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        expect(toolbar).to_be_visible()

    def test_autobookmark_does_not_dismiss_an_open_reader_menu(self):
        self.context.add_init_script("localStorage.setItem('autoBookmarkTime', '2');")
        self.open_book(font='Klee One')
        self.wait_for_fonts()
        started = self.page.evaluate('Date.now()')
        self.page.keyboard.press('PageDown')
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        tools = self.page.get_by_role('button', name='Reading tools', exact=True)
        tools.click()
        menu = self.page.get_by_role('menu')
        expect(menu).to_be_visible()
        self.page.keyboard.press('ArrowDown')
        # Observe the actual scheduled bookmark commit; no synthetic bookmark or
        # timeout used to suppress an autosave. The menu must survive that commit.
        self.page.wait_for_function('''async (started) => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('books');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const data = await new Promise((resolve, reject) => {
              const id = Number(new URL(location.href).searchParams.get('id'));
              const request = db.transaction('bookmark').objectStore('bookmark').get(id);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return data?.lastBookmarkModified >= started && data.exploredCharCount > 0;
          } finally { db.close(); }
        }''', arg=started, timeout=15000)
        expect(menu).to_be_visible()
        self.assertTrue(menu.evaluate('e => e.contains(document.activeElement)'))
        self.page.keyboard.press('Escape')
        expect(menu).to_have_count(0)
        expect(tools).to_be_focused()

    def test_settings_search_counts_newly_available_tracking_controls(self):
        self.settings()
        self.page.get_by_label('Search settings', exact=True).fill('statistics')
        enable = self.page.get_by_role('switch', name='Enable Statistics', exact=True)
        expect(enable).to_be_visible()
        before = self.page.locator('[data-setting]:not([hidden])').count()
        enable.check()
        self.page.wait_for_function('(before) => document.querySelectorAll("[data-setting]:not([hidden])").length > before', arg=before)
        count = self.page.locator('[data-setting]:not([hidden])').count()
        expect(self.page.get_by_role('status').filter(has_text='matching settings')).to_have_text(
            f'{count} matching settings')
        enable.uncheck()
        expect(self.page.get_by_role('status').filter(has_text='matching settings')).to_have_text(
            f'{before} matching settings')

    def test_library_sort_and_export_preserve_all_export_parts(self):
        self.open_book(font='Klee One')
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='View Options', exact=True).hover()
        self.page.get_by_role('menuitem', name='Sort by…', exact=True).hover()
        menu = self.page.get_by_role('menu').last
        for name in ['Added','Title','Author','Recent','Ascending','Descending']:
            expect(menu.get_by_role('menuitemradio', name=name, exact=True)).to_be_visible()
        menu.get_by_role('menuitemradio', name='Title', exact=True).click()
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='View Options', exact=True).hover()
        self.page.get_by_role('menuitem', name='Sort by…', exact=True).hover()
        self.page.get_by_role('menuitem', name='More Sort Options', exact=True).hover()
        more = self.page.get_by_role('menu').last
        for name in ['Characters','Last Update','Progress','Bookmarked']:
            expect(more.get_by_role('menuitemradio', name=name, exact=True)).to_be_visible()
        self.page.keyboard.press('Escape')
        self.page.keyboard.press('Escape')
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        self.page.get_by_role('button', name='Select all', exact=True).click()
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
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
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Add Books', exact=True).click()
        for name in ['Import File(s)','Import Folder(s)','Import Backup','Import from Ttu Ebook Reader']:
            expect(self.page.get_by_role('menuitem', name=name, exact=True)).to_be_visible()
        self.page.keyboard.press('Escape')

    def test_statistics_filter_is_one_focus_managed_sheet(self):
        self.page.goto(self.origin + '/Reader-Web/statistics')
        trigger = self.page.get_by_role('button', name='Filter books', exact=True)
        trigger.click()
        sheet = self.page.get_by_role('dialog', name='Filter books', exact=True)
        expect(sheet).to_be_visible()
        expect(self.page.get_by_role('dialog')).to_have_count(1)
        field = sheet.get_by_role('searchbox', name='Filter book titles', exact=True)
        field.fill('A title that is not present')
        expect(sheet.get_by_text('No Titles to filter', exact=True)).to_be_visible()
        for _ in range(8):
            self.page.keyboard.press('Tab')
            expect(sheet.locator(':focus')).to_have_count(1)
        self.page.keyboard.press('Escape')
        expect(sheet).to_have_count(0)
        expect(trigger).to_be_focused()

    def test_dismissing_jump_and_completion_settles_without_blocking_reader(self):
        self.open_book()
        for action in ['Jump to Position', 'Complete Book']:
            toolbar = self.page.get_by_role('banner', name='Reader toolbar')
            if not toolbar.is_visible():
                self.page.get_by_role('button', name='Show reading controls', exact=True).click()
            self.page.get_by_role('button', name='Reading tools', exact=True).click()
            self.page.get_by_role('menuitem', name=action, exact=True).click()
            dialog = self.page.get_by_role('dialog')
            expect(dialog).to_be_visible()
            expect(dialog.get_by_role('button', name='Confirm', exact=True)).to_be_visible()
            self.page.keyboard.press('Escape')
            expect(dialog).to_have_count(0)
            expect(self.page.locator('.book-content')).to_be_visible()
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        expect(self.page.get_by_role('banner', name='Reader toolbar')).to_be_visible()

    def test_tracking_panel_owns_focus_and_preserves_controls(self):
        self.settings()
        self.category('Tracking & goals')
        self.page.get_by_role('switch', name='Enable Statistics', exact=True).check()
        self.assertEqual('1', self.page.evaluate('localStorage.getItem("statisticsEnabled")'))
        self.open_book(font='Klee One')
        trigger = self.page.get_by_role('button', name='Open reading tracker', exact=True)
        expect(trigger).to_be_visible(timeout=30000)
        trigger.click()
        sheet = self.page.get_by_role('dialog', name='Reading tracker', exact=True)
        expect(sheet).to_be_visible()
        expect(self.page.get_by_role('dialog')).to_have_count(1)
        for label in ['Toggle Tracker', 'Update Position', 'Toggle Freeze Position', 'Save']:
            expect(sheet.get_by_role('button', name=label, exact=True)).to_be_visible()
        expect(sheet.get_by_role('button', name='Save', exact=True)).to_be_disabled()
        for _ in range(12):
            self.page.keyboard.press('Tab')
            expect(sheet.locator(':focus')).to_have_count(1)
        self.page.keyboard.press('Escape')
        expect(sheet).to_have_count(0)
        expect(trigger).to_be_focused()

    def open_illustrated_book(self, hide_spoilers=False):
        # Actual EPUB entries and actual raster data through the normal importer.
        source = zipfile.ZipFile(io.BytesIO(epub()))
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
            for name in source.namelist():
                value = source.read(name)
                if name == 'content.opf':
                    value = value.replace(b'</manifest>', b'<item id="second-image" href="second.png" media-type="image/png"/></manifest>')
                elif name == 'chapter.xhtml':
                    value = value.replace(b'</body>', b'<img src="second.png" alt="Second illustration"/></body>')
                elif name == '絵.png':
                    value = png([184,77,113], 600, 400)
                target.writestr(name, value)
            target.writestr('second.png', png([24,100,146], 500, 700))
        values = {'fontFamilyGroupOne':'Klee One', 'hideSpoilerImage': '1' if hide_spoilers else '0'}
        self.context.add_init_script('for (const [key, value] of Object.entries(' + json.dumps(values) + ')) localStorage.setItem(key, value);')
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name':'gallery.epub', 'mimeType':'application/epub+zip', 'buffer':output.getvalue()
        })
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_be_visible(timeout=30000)
        self.wait_for_fonts()

    def open_gallery(self):
        self.page.get_by_role('button', name='Show reading controls', exact=True).click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Image Gallery', exact=True).click()
        gallery = self.page.get_by_role('dialog', name='Image gallery', exact=True)
        expect(gallery).to_be_visible()
        return gallery

    def test_gallery_is_focus_managed_and_preserves_images_keys_and_wheel(self):
        self.page.set_viewport_size({'width':1400, 'height':900})
        self.open_illustrated_book()
        before = self.page.locator('.book-content').evaluate('e => e.getBoundingClientRect().x')
        gallery = self.open_gallery()
        expect(gallery.get_by_role('button', name='Previous', exact=True)).to_be_disabled()
        gallery.get_by_role('button', name='View image 1', exact=True).click()
        self.page.keyboard.press('ArrowRight')
        expect(gallery.locator('.gallery-viewer img')).to_have_attribute('alt', 'Book illustration 2')
        expect(gallery.get_by_role('button', name='Next', exact=True)).to_be_disabled()
        viewer = gallery.locator('.gallery-viewer')
        viewer.focus()
        viewer.hover()
        self.page.mouse.wheel(0, -200)
        expect(gallery.locator('.gallery-viewer img')).to_have_attribute('alt', 'Book illustration 1')
        self.page.wait_for_function('() => document.querySelector(".gallery-viewer img")?.naturalWidth === 600')
        for _ in range(9):
            self.page.keyboard.press('Tab')
            expect(gallery.locator(':focus')).to_have_count(1)
        self.assertEqual(before, self.page.locator('.book-content').evaluate('e => e.getBoundingClientRect().x'))
        self.page.screenshot(path='test-results/rhea-image-gallery-desktop.png', full_page=True)
        self.page.keyboard.press('Escape')
        expect(gallery).to_have_count(0)
        expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()

    def test_gallery_mobile_image_view_and_return_to_list(self):
        self.page.set_viewport_size({'width':390, 'height':844})
        self.open_illustrated_book()
        gallery = self.open_gallery()
        gallery.get_by_role('button', name='View image 2', exact=True).click()
        expect(gallery.locator('.gallery-viewer img')).to_have_attribute('alt', 'Book illustration 2')
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 391)
        self.assertLessEqual(gallery.evaluate('e => e.scrollWidth'), 391)
        self.page.screenshot(path='test-results/rhea-image-gallery-mobile.png', full_page=True)
        gallery.get_by_role('button', name='All images', exact=True).click()
        expect(gallery.get_by_role('button', name='View image 2', exact=True)).to_be_focused()
        gallery.get_by_role('button', name='Close Image Gallery', exact=True).click()
        expect(gallery).to_have_count(0)

    def test_gallery_spoiler_reveal_is_a_real_keyboard_button(self):
        self.page.set_viewport_size({'width':1400, 'height':900})
        self.open_illustrated_book(hide_spoilers=True)
        gallery = self.open_gallery()
        gallery.get_by_role('button', name='Next', exact=True).click()
        reveal = gallery.locator('.gallery-viewer').get_by_role('button', name='Show image · ネタバレ', exact=True)
        expect(reveal).to_be_visible()
        reveal.focus()
        reveal.press('Enter')
        expect(reveal).to_have_count(0)
        expect(gallery.locator('.gallery-viewer img')).to_have_attribute('alt', 'Book illustration 2')
        self.page.keyboard.press('Escape')
        gallery = self.open_gallery()
        gallery.get_by_role('button', name='View image 2', exact=True).click()
        expect(gallery.locator('.gallery-viewer .spoiler-label')).to_have_count(0)
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
