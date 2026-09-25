"""Actual Rhea UI plus the complete inherited appearance/reader suite.

No UI replacements, request interception, or fake font availability. Book and
wallpaper fixtures are generated locally by the existing acceptance harness.
"""
from pathlib import Path
import io
import zipfile
import json
import os
import tempfile
import time
from test_static_reader import epub, TITLE
from test_appearance import png
import unittest
from playwright.sync_api import expect
import test_appearance_refinement as previous


def chaptered_epub():
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            value = source.read(item)
            if item.filename == 'content.opf':
                value = value.replace(b'</manifest>', b'<item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>')
                value = value.replace(b'<spine>', b'<spine toc="ncx">').replace(b'</spine>', b'<itemref idref="chapter2"/></spine>')
            target.writestr(item.filename, value)
        target.writestr('chapter2.xhtml', '<html><body><h1>A new morning</h1>' + '<p>新しい朝に、静かな道を歩きます。</p>' * 120 + '</body></html>')
        target.writestr('toc.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Reader browser acceptance</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>The journey begins</text></navLabel><content src="chapter.xhtml"/></navPoint><navPoint id="two" playOrder="2"><navLabel><text>A new morning</text></navLabel><content src="chapter2.xhtml"/></navPoint></navMap></ncx>')
    return output.getvalue()


def renamed_epub(title):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            value = source.read(item)
            if item.filename in ('content.opf', 'chapter.xhtml'):
                value = value.replace(TITLE.encode(), title.encode())
            target.writestr(item.filename, value)
    return output.getvalue()


class RheaReader(previous.RefinedAppearance):
    def open_reading_appearance(self):
        # Reload can finish before the hydrated reader mounts its controls.
        # Wait for the real ready page before inspecting expanded state.
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('button[data-reader-controls]')).to_be_visible()
        toolbar = self.page.get_by_role('banner', name='Reader toolbar')
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        toolbar.get_by_role('button', name='Themes & Settings', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Themes & Settings', exact=True)
        expect(panel).to_be_visible()
        return panel

    def test_reading_frame_and_controls_fit_compact_tablet_and_desktop(self):
        self.open_book(font='Klee One')
        self.wait_for_fonts()
        for width, height in [(320, 740), (390, 844), (768, 1024), (1024, 768), (1440, 1000), (1728, 1117)]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
                trigger = self.page.get_by_role('button', name='Show reading controls', exact=True)
                box = trigger.bounding_box()
                self.assertGreaterEqual(box['width'], 44)
                self.assertGreaterEqual(box['height'], 44)
                self.assertLessEqual(box['x'] + box['width'], width)
                self.assertLessEqual(box['y'] + box['height'], height)
                frame = self.page.locator('.reader-page-frame').evaluate('(e) => { const s = getComputedStyle(e); return [s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight].map(parseFloat); }')
                self.assertGreaterEqual(frame[0], 64)
                self.assertGreaterEqual(frame[1], 72)
                content = self.page.locator('.book-content').bounding_box()
                self.assertGreaterEqual(content['y'], 64)
                self.assertLessEqual(content['y'] + content['height'], box['y'])
                footer = self.page.locator('#ttu-page-footer').bounding_box()
                self.assertLessEqual(box['y'] + box['height'], footer['y'] + 1)
                trigger.click()
                toolbar = self.page.get_by_role('banner', name='Reader toolbar')
                for name in ['Library', 'Bookmarks and Notes', 'Themes & Settings', 'Reading tools']:
                    bounds = toolbar.get_by_role('button', name=name, exact=True).bounding_box()
                    self.assertGreaterEqual(bounds['x'], 0)
                    self.assertLessEqual(bounds['x'] + bounds['width'], width)
                    self.assertGreaterEqual(bounds['height'], 43.99)
                progress = self.page.locator('button[title="Copy Progress"]')
                progress_bounds = progress.bounding_box()
                self.assertLessEqual(content['y'] + content['height'], progress_bounds['y'])
                self.page.get_by_role('button', name='Hide reading controls', exact=True).click()
                expect(toolbar).to_have_count(0)

    def test_in_book_appearance_persists_and_owns_keys_vertical_phone(self):
        self.verify_reading_appearance('vertical-rl', 390)

    def test_in_book_appearance_persists_and_owns_keys_horizontal_desktop(self):
        self.verify_reading_appearance('horizontal-tb', 1440)

    def verify_reading_appearance(self, writing, width):
        self.open_book(writing=writing, font='Klee One')
        reader_url = self.page.url
        self.wait_for_fonts()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.page.set_viewport_size({'width': width, 'height': 844})
        panel = self.open_reading_appearance()
        expect(panel.get_by_role('button', name='Ecru theme', exact=True)).to_be_visible()
        before = self.page.locator('.book-content').evaluate('e => [e.scrollLeft,e.scrollTop,window.scrollX,window.scrollY]')
        panel.get_by_role('button', name='Increase text size', exact=True).focus()
        for key in ['ArrowDown', 'ArrowRight', 'PageDown']:
            self.page.keyboard.press(key)
        self.assertEqual(before, self.page.locator('.book-content').evaluate('e => [e.scrollLeft,e.scrollTop,window.scrollX,window.scrollY]'))
        panel.get_by_role('button', name='Increase text size', exact=True).click()
        panel.get_by_label('Reading line spacing', exact=True).select_option('1.9')
        panel.get_by_label('Reading font', exact=True).select_option('Noto Serif JP')
        panel.get_by_role('button', name='Ecru theme', exact=True).click()
        panel.get_by_role('button', name='dark', exact=True).click()
        expect(self.page.locator('html')).to_have_attribute('data-theme', 'ecru-theme')
        expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
        self.assertEqual(reader_url, self.page.url)
        for _ in range(18):
            self.page.keyboard.press('Tab')
            expect(panel.locator(':focus')).to_have_count(1)
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Themes & Settings', exact=True)).to_be_focused()
        self.page.reload()
        panel = self.open_reading_appearance()
        expect(panel.get_by_label('Reading font', exact=True)).to_have_value('Noto Serif JP')
        expect(panel.get_by_label('Reading line spacing', exact=True)).to_have_value('1.9')
        expect(panel.get_by_role('button', name='Ecru theme', exact=True)).to_have_attribute('aria-pressed', 'true')
        self.assertGreater(int(self.page.evaluate('localStorage.getItem("fontSize")')), 20)
        self.page.keyboard.press('Escape')
        self.page.get_by_role('button', name='Hide reading controls', exact=True).click()
        expect(self.page.get_by_role('banner', name='Reader toolbar')).to_have_count(0)

    def test_in_book_layout_controls_and_advanced_settings_remain_reachable(self):
        self.open_book(font='Klee One')
        panel = self.open_reading_appearance()
        panel.get_by_role('button', name='Scroll', exact=True).click()
        expect(panel.get_by_role('button', name='Scroll', exact=True)).to_have_attribute('aria-pressed', 'true')
        self.page.wait_for_function('localStorage.getItem("viewMode") === "continuous"')
        expect(self.page.locator('.book-content')).to_be_visible()
        panel.get_by_role('button', name='Pages', exact=True).click()
        self.page.wait_for_function('localStorage.getItem("viewMode") === "paginated"')
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        panel.get_by_role('button', name='All Settings…', exact=True).click()
        expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()

    def test_touch_reading_appearance_fits_and_outside_dismissal_restores_controls(self):
        original_context, original_page = self.context, self.page
        profile = tempfile.TemporaryDirectory(prefix='reader-touch-')
        if os.environ.get('APPEARANCE_BROWSER', 'chromium') == 'webkit':
            touch = self.playwright.webkit.launch_persistent_context(profile.name, has_touch=True, viewport={'width': 390, 'height': 844})
        else:
            touch = self.browser.new_context(has_touch=True, viewport={'width': 390, 'height': 844})
        self.context = touch
        self.page = touch.pages[0] if touch.pages else touch.new_page()
        self.page.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        try:
            self.open_book(font='Klee One')
            self.page.get_by_role('button', name='Show reading controls', exact=True).tap()
            self.page.get_by_role('button', name='Themes & Settings', exact=True).tap()
            panel = self.page.get_by_role('dialog', name='Themes & Settings', exact=True)
            expect(panel).to_be_visible()
            self.assertEqual('horizontal-tb', panel.evaluate('e => getComputedStyle(e).writingMode'))
            box = panel.bounding_box()
            self.assertGreaterEqual(box['x'], 0)
            self.assertLessEqual(box['x'] + box['width'], 390)
            panel.get_by_role('button', name='Increase text size', exact=True).tap()
            self.page.wait_for_function('localStorage.getItem("fontSize") === "21"')
            self.page.touchscreen.tap(20, 20)
            expect(panel).to_have_count(0)
            expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()
            self.page.get_by_role('button', name='Show reading controls', exact=True).tap()
            self.page.get_by_role('button', name='Themes & Settings', exact=True).tap()
            close = panel.get_by_role('button', name='Close reading appearance', exact=True)
            expect(close).to_have_attribute('data-modal-dismiss', '')
            expect(close).to_have_attribute('data-shape', 'circle')
            close.tap()
            expect(panel).to_have_count(0)
            expect(self.page.get_by_role('button', name='Themes & Settings', exact=True)).to_be_focused()
        finally:
            touch.close()
            profile.cleanup()
            self.context, self.page = original_context, original_page

    def test_contents_navigation_reflows_and_returns_focus_at_phone_and_desktop(self):
        self.context.add_init_script("if (location.pathname.endsWith('/manage')) { localStorage.setItem('fontFamilyGroupOne', 'Klee One'); localStorage.setItem('viewMode', 'paginated'); }")
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'chapters.epub', 'mimeType': 'application/epub+zip', 'buffer': chaptered_epub()})
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.wait_for_fonts()
        for width in (320, 390, 1440):
            self.page.set_viewport_size({'width': width, 'height': 844})
            self.page.get_by_role('button', name='Show reading controls', exact=True).click()
            self.page.get_by_role('button', name='Contents', exact=True).click()
            panel = self.page.get_by_role('dialog', name='Table of contents', exact=True)
            expect(panel).to_be_visible()
            expect(panel.get_by_role('heading', name='Contents', exact=True)).to_be_visible()
            expect(panel.get_by_role('progressbar', name='Chapter progress')).to_be_visible()
            box = panel.bounding_box()
            self.assertLessEqual(box['width'], width)
            for name in ('Previous Chapter', 'Next Chapter', 'Close Table of Contents'):
                bounds = panel.get_by_role('button', name=name, exact=True).bounding_box()
                self.assertGreaterEqual(bounds['x'], 0)
                self.assertLessEqual(bounds['x'] + bounds['width'], width)
                self.assertGreaterEqual(bounds['height'], 43.99)
            close = panel.get_by_role('button', name='Close Table of Contents', exact=True)
            expect(close).to_have_attribute('data-modal-dismiss', '')
            expect(close).to_have_attribute('data-shape', 'circle')
            chapters = panel.get_by_role('navigation', name='Chapters')
            expect(chapters.get_by_role('button', name='A new morning', exact=True)).to_be_visible()
            chapters.get_by_role('button', name='A new morning', exact=True).click()
            expect(panel).to_have_count(0)
            expect(self.page.locator('.book-content')).to_contain_text('A new morning')
            expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()
            panel = self.open_reading_appearance()
            panel.get_by_role('button', name='Increase text size', exact=True).click()
            self.page.keyboard.press('Escape')
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
            expect(self.page.locator('.book-content')).to_contain_text('A new morning')
            started = self.page.evaluate('Date.now()')
            self.page.get_by_role('button', name='Reading tools', exact=True).click()
            self.page.get_by_role('menuitem', name='Save Reading Position', exact=True).click()
            # Bookmark persistence is asynchronous. Reload only after the real
            # IndexedDB transaction commits the explicit save.
            deadline = time.monotonic() + 20
            while not self.page.evaluate('''async started => {
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('books');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                const id = Number(new URL(location.href).searchParams.get('id'));
                const saved = await new Promise((resolve, reject) => {
                  const request = db.transaction('bookmark').objectStore('bookmark').get(id);
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });
                return saved?.lastBookmarkModified >= started && saved.exploredCharCount > 0;
              } finally { db.close(); }
            }''', started):
                self.assertLess(time.monotonic(), deadline, 'Explicit bookmark did not commit')
                self.page.wait_for_timeout(25)
            self.page.reload()
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
            expect(self.page.locator('.book-content')).to_contain_text('A new morning')

    def test_vertical_reader_menu_remains_horizontal_and_inside_mobile_and_desktop(self):
        self.open_book(font='Klee One')
        reader_url = self.page.url
        self.assertEqual('vertical-rl', self.page.locator('.book-content').evaluate(
            'element => getComputedStyle(element).writingMode'))
        for width in (390, 1440):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 844})
                toolbar = self.page.get_by_role('banner', name='Reader toolbar')
                if not toolbar.is_visible():
                    self.page.get_by_role('button', name='Show reading controls', exact=True).click()
                tools = toolbar.get_by_role('button', name='Reading tools', exact=True)
                tools.click()
                menu = self.page.get_by_role('menu')
                expect(menu).to_be_visible()
                self.assertEqual('horizontal-tb', menu.evaluate('e => getComputedStyle(e).writingMode'))
                box = menu.bounding_box()
                self.assertGreaterEqual(box['x'], 0)
                self.assertLessEqual(box['x'] + box['width'], width)
                settings = menu.get_by_role('menuitem', name='Settings', exact=True)
                # WebKit's IntersectionObserver can report zero intersection
                # for this visible horizontal popup in a vertical document.
                # Assert its actual bounds and exercise a normal click below.
                box = settings.bounding_box()
                self.assertGreaterEqual(box['x'], 0)
                self.assertGreaterEqual(box['y'], 0)
                self.assertLessEqual(box['x'] + box['width'], width)
                self.assertLessEqual(box['y'] + box['height'], 844)
                self.page.keyboard.press('Escape')
                expect(menu).to_have_count(0)
                expect(tools).to_be_focused()
                tools.click()
                menu.get_by_role('menuitem', name='Settings', exact=True).click()
                expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()
                self.page.goto(reader_url)
                expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')

    def category(self, name):
        self.page.get_by_role('navigation', name='Settings categories').get_by_role(
            'button', name=name, exact=True).click()

    def test_empty_library_has_keyboard_import_action(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        action = self.page.get_by_role('button', name='Import File(s)', exact=True)
        expect(action).to_be_visible()
        expect(self.page.locator('input[type=file][accept*=".epub"]')).to_be_hidden()
        action.focus()
        expect(action).to_be_focused()
        with self.page.expect_file_chooser():
            action.press('Enter')

    def test_library_workspace_import_collection_search_and_completion(self):
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.page.locator('input[type=file][accept*=".epub"]').set_input_files({
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

        compact_search = self.page.get_by_role('button', name='Search library', exact=True)
        expect(compact_search).to_be_visible()
        self.assertGreaterEqual(compact_search.bounding_box()['height'], 44)
        compact_search.click()
        search = self.page.get_by_role('searchbox', name='Search library', exact=True)
        expect(search).to_be_focused()
        search.fill('not-this-book')
        expect(self.page.get_by_role('heading', name='No matching books', exact=True)).to_be_visible()
        search.fill('reader browser')
        self.page.keyboard.press('Escape')
        expect(compact_search).to_be_focused()
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
        expect(trigger).to_have_attribute('data-variant', 'outline')
        expect(trigger).to_have_attribute('data-size', 'lg')
        geometry = trigger.evaluate('''e => {
          const rect = e.getBoundingClientRect();
          return {height: rect.height, radius: parseFloat(getComputedStyle(e).borderTopLeftRadius)};
        }''')
        self.assertGreaterEqual(geometry['height'], 43.99)
        self.assertGreaterEqual(geometry['radius'], geometry['height'] / 2)
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
        expect(toolbar.get_by_role('button', name='Bookmarks and Notes', exact=True)).to_be_visible()
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
        self.page.mouse.click(viewport['width'] / 2, viewport['height'] / 2)
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

    def test_book_details_match_persisted_metadata_in_grid_and_list(self):
        self.open_book(font='Klee One')
        book_id = int(self.page.evaluate('new URL(location.href).searchParams.get("id")'))
        toolbar = self.page.get_by_role('banner', name='Reader toolbar')
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        toolbar.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Save Reading Position', exact=True).click()

        # Read the real IndexedDB records after the reader's bookmark transaction
        # completes; these provide the expected values and the immutability check.
        def read_records(identifier=book_id):
            return self.page.evaluate('''async id => {
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('books');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                const tx = db.transaction(['data', 'bookmark']);
                const [book, bookmark] = await Promise.all(['data', 'bookmark'].map(name =>
                  new Promise((resolve, reject) => {
                    const request = tx.objectStore(name).get(id);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                  })
                ));
                return { book, bookmark };
              } finally { db.close(); }
            }''', identifier)

        deadline = time.monotonic() + 20
        while True:
            records = read_records()
            if records['book'] and records['bookmark'] and records['bookmark'].get('lastBookmarkModified', 0):
                break
            self.assertLess(time.monotonic(), deadline, 'Imported book bookmark did not persist')
            self.page.wait_for_timeout(25)

        book = records['book']
        bookmark = records['bookmark']
        expected = {
            'Characters': str(book['characters']),
            'Last read': self.page.evaluate('value => value ? new Date(value).toLocaleString() : "No data"', book.get('lastBookOpen', 0)),
            'Bookmarked': self.page.evaluate('value => value ? new Date(value).toLocaleString() : "No data"', bookmark.get('lastBookmarkModified', 0)),
            'Last update': self.page.evaluate('value => value ? new Date(value).toLocaleString() : "No data"', book.get('lastBookModified', 0))
        }
        self.assertGreater(book['characters'], 0)
        self.assertGreater(book.get('lastBookOpen', 0), 0)
        self.assertGreater(bookmark.get('lastBookmarkModified', 0), 0)

        screenshot_dir = os.environ.get('BOOK_DETAILS_SCREENSHOT_DIR')
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.goto(self.origin + '/Reader-Web/manage')
        expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute('aria-busy', 'false')
        for width, height, view in ((390, 844, 'Grid'), (390, 844, 'List'), (1440, 900, 'Grid'), (1440, 900, 'List')):
            with self.subTest(width=width, view=view):
                self.page.set_viewport_size({'width': width, 'height': height})
                is_list = self.page.locator('.shelf-list').count() > 0
                if is_list != (view == 'List'):
                    self.page.get_by_role('button', name='Library actions', exact=True).click()
                    self.page.get_by_role('menuitem', name='View Options', exact=True).hover()
                    self.page.get_by_role('menuitemradio', name=view, exact=True).click()
                    expect(self.page.get_by_role('menu')).to_have_count(0)

                action = self.page.get_by_role('button', name='Actions for ' + TITLE, exact=True)
                action.click()
                self.page.get_by_role('menuitem', name='Book Details', exact=True).click()
                dialog = self.page.get_by_role('dialog', name='Book details', exact=True)
                expect(dialog).to_be_visible()
                expect(dialog.get_by_text(TITLE, exact=True)).to_be_visible()
                details = dialog.locator('dl').evaluate('''dl => {
                  const values = {};
                  for (const dt of dl.querySelectorAll('dt')) values[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim();
                  return values;
                }''')
                self.assertEqual(expected, details)
                if screenshot_dir and width == 390 and view == 'Grid':
                    engine = os.environ.get('APPEARANCE_BROWSER', 'chromium')
                    self.page.screenshot(path=str(Path(screenshot_dir) / f'book-details-phone-{engine}.png'), full_page=True)
                if screenshot_dir and width == 1440 and view == 'Grid':
                    engine = os.environ.get('APPEARANCE_BROWSER', 'chromium')
                    self.page.screenshot(path=str(Path(screenshot_dir) / f'book-details-desktop-{engine}.png'), full_page=True)
                self.page.keyboard.press('Escape')
                expect(dialog).to_have_count(0)
                expect(action).to_be_focused()
                after = read_records()
                self.assertEqual(records, after, 'Opening and dismissing Book Details must not edit book or progress data')

        # A second imported book has no reader history. Its unknown activity
        # dates must stay explicitly unknown in the details dialog.
        unstarted_title = 'Unstarted acceptance'
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': unstarted_title + '.epub',
            'mimeType': 'application/epub+zip',
            'buffer': renamed_epub(unstarted_title)
        })
        self.page.get_by_role('button', name='Read ' + unstarted_title, exact=True).wait_for()
        unstarted_id = self.page.evaluate('''async title => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('books');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const rows = await new Promise((resolve, reject) => {
              const request = db.transaction('data').objectStore('data').getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return rows.find(row => row.title === title)?.id;
          } finally { db.close(); }
        }''', unstarted_title)
        self.assertIsNotNone(unstarted_id)
        self.page.get_by_role('button', name='Actions for ' + unstarted_title, exact=True).click()
        self.page.get_by_role('menuitem', name='Book Details', exact=True).click()
        unstarted_dialog = self.page.get_by_role('dialog', name='Book details', exact=True)
        expect(unstarted_dialog).to_be_visible()
        unknown_dates = unstarted_dialog.locator('dl').evaluate('''dl => {
          const values = {};
          for (const dt of dl.querySelectorAll('dt')) values[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim();
          return values;
        }''')
        self.assertEqual('No data', unknown_dates['Last read'])
        self.assertEqual('No data', unknown_dates['Bookmarked'])
        self.page.keyboard.press('Escape')
        expect(unstarted_dialog).to_have_count(0)

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

    def test_statistics_raw_recovery_download_preserves_ambiguous_days(self):
        self.page.goto(self.origin + '/Reader-Web/statistics')
        expect(self.page.get_by_role('button', name='Statistics options', exact=True)).to_be_visible()
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const open = indexedDB.open('books');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(['statistic', 'readerStatistic', 'readerStatisticMigration'], 'readwrite');
            const title = 'Two copies';
            const common = {title, readingTime: 60, charactersRead: 25, minReadingSpeed: 1,
              altMinReadingSpeed: 1, lastReadingSpeed: 1, maxReadingSpeed: 1,
              lastStatisticModified: 100};
            tx.objectStore('statistic').put({...common, dateKey: '2026-09-20'});
            tx.objectStore('readerStatistic').put({...common, dateKey: '2026-09-21',
              bookKey: 'content:' + 'a'.repeat(64)});
            tx.objectStore('readerStatisticMigration').put({title, state: 'ambiguous'});
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        })''')
        self.page.reload()
        self.page.get_by_role('button', name='Statistics options', exact=True).click()
        self.page.get_by_role('menuitem', name='Statistics Settings', exact=True).click()
        panel = self.page.locator('[data-slot="sheet-content"]')
        expect(panel.get_by_role('button', name='Download raw history (JSON)')).to_be_visible()
        self.page.evaluate('''() => {
          const original = URL.createObjectURL.bind(URL);
          URL.createObjectURL = blob => {
            const url = original(blob);
            window.__statisticsRecoveryDownload = {url, blob};
            return url;
          };
        }''')
        with self.page.expect_download() as download:
            panel.get_by_role('button', name='Download raw history (JSON)').click()
        self.assertTrue(download.value.suggested_filename.startswith('manabi-reader-statistics-recovery-'))
        self.assertGreater(self.page.evaluate('() => window.__statisticsRecoveryDownload?.blob?.size ?? 0'), 0)
        snapshot = self.page.evaluate('''async () => JSON.parse(
          await window.__statisticsRecoveryDownload.blob.text())''')
        self.assertEqual('manabi-reader-statistics-recovery', snapshot['format'])
        self.assertEqual('content:' + 'a' * 64, snapshot['contentRows'][0]['bookKey'])
        self.assertEqual('2026-09-20', snapshot['legacyRows'][0]['dateKey'])
        self.assertEqual('ambiguous', snapshot['migrationReceipts'][0]['state'])
        panel.get_by_role('button', name='Export All', exact=True).click()
        expect(self.page.get_by_text('The TTU ZIP cannot safely identify all days')).to_be_visible()


if __name__ == '__main__':
    Path('test-results').mkdir(exist_ok=True)
    unittest.main(verbosity=2)
