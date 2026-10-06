"""Selection/organization/chrome acceptance in the actual built app and native IndexedDB.

No replacement UI, storage, import pipeline, fullscreen API, or chrome timer.
The old entry helpers use keyboard reveal; these tests separately qualify the
actual mouse and content-click paths. Desktop WebKit is not physical iOS evidence.
"""
import copy
import io
import json
import re
import threading
import time
import zipfile
from urllib.parse import parse_qs, urlsplit
import unittest
from playwright.sync_api import expect, sync_playwright
from test_books_library import LibraryBase, book
from test_static_reader import StaticHandler, ThreadingHTTPServer
from test_library_cloud_relocation import CloudRelocationHandler, GOOGLE, DROPBOX
from reader_controls import reveal_reader_controls


class LibraryParityBrowser(LibraryBase):
    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.presentation_enabled = False
            StaticHandler.account_fixture = None

    def populate(self, count=5):
        for index in range(count):
            self.import_book(f'Parity {index}', creators=('Original Author',))

    def items(self):
        return self.page.locator('.shelf-item > button[data-selection-key]')

    def modifier(self):
        return 'Meta' if self.page.evaluate('/Mac|iPhone|iPad/.test(navigator.platform)') else 'Control'

    def count(self, count):
        expect(self.page.get_by_role('banner', name='Library toolbar').get_by_text(
            f'{count} selected', exact=True)).to_be_visible()

    def batch_action(self, name):
        self.page.get_by_role('button', name='Selected book actions', exact=True).click()
        self.page.get_by_role('menuitem', name=name, exact=True).click()

    def organization(self):
        rows = self.stores('manabi-reader-integrations', ['metadata'])['metadata']
        return next(row for row in rows if row.get('version') == 1 and 'collections' in row)

    def test_modifiers_ranges_and_keyboard_in_grid_and_list(self):
        self.populate()
        for layout in ('Grid', 'List'):
            with self.subTest(layout=layout):
                self.choose_view(layout)
                items = self.items()
                items.nth(1).click(modifiers=[self.modifier()])
                self.count(1)
                self.assertIn('/manage', self.page.url)
                items.nth(4).click(modifiers=['Shift'])
                self.count(4)
                items.nth(2).click(modifiers=['Shift'])
                self.count(2)
                items.nth(0).click(modifiers=[self.modifier()])
                self.count(3)
                items.nth(0).click(modifiers=[self.modifier()])
                self.count(2)
                items.nth(1).click()
                self.count(1)
                self.page.keyboard.press('Shift+ArrowRight')
                self.count(2)
                self.page.keyboard.press(self.modifier() + '+a')
                self.count(5)
                self.page.keyboard.press('Escape')
                expect(self.page.get_by_role('button', name='Select All Visible')).to_have_count(0)

    def test_menu_selection_enters_keyboard_scope_and_visible_all_respects_search(self):
        self.populate(3)
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        expect(self.page.locator('[data-selection-key]:focus')).to_have_count(1)
        self.page.keyboard.press(' ')
        self.count(1)
        search = self.page.get_by_role('searchbox', name='Search library', exact=True)
        search.fill('Parity 1')
        expect(self.items()).to_have_count(1)
        self.count(0)
        search.press(self.modifier() + '+a')
        self.assertEqual([0, 8], search.evaluate('e => [e.selectionStart,e.selectionEnd]'))
        self.count(0)
        self.page.get_by_role('button', name='Select All Visible', exact=True).click()
        self.count(1)
        self.assertEqual(1, self.items().count())

        search.fill('')
        self.count(0)
        self.assertEqual(3, self.items().count())
        expect(self.items().filter(has=self.page.get_by_text('Selected', exact=True))).to_have_count(0)

    def test_compact_selection_toolbar_reflows_at_200_percent_text(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.populate(3)
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')

        actions = self.page.get_by_role('button', name='Library actions', exact=True)
        actions.click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()

        toolbar = self.page.get_by_role('toolbar', name='Book selection', exact=True)
        expect(toolbar).to_be_visible()
        self.assertLessEqual(toolbar.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth-innerWidth'), 1)

        cancel = toolbar.get_by_role('button', name='Cancel selection', exact=True)
        select_all = toolbar.get_by_role('button', name='Select All Visible', exact=True)
        for control in (cancel, select_all):
            box = control.bounding_box()
            self.assertGreaterEqual(box['width'], 43.99)
            self.assertGreaterEqual(box['height'], 43.99)
            self.assertGreaterEqual(box['x'], -1)
            self.assertLessEqual(box['x'] + box['width'], 321)

        select_all.click()
        expect(toolbar.get_by_role('status')).to_have_text('3 selected')
        more = toolbar.get_by_role('button', name='Selected book actions', exact=True)
        more.focus()
        more.press('Enter')
        menu = self.page.get_by_role('menu')
        expect(menu).to_be_visible()
        self.assertLessEqual(menu.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        for item in menu.get_by_role('menuitem').all():
            self.assertGreaterEqual(item.bounding_box()['height'], 43.99)
        self.page.keyboard.press('Escape')
        expect(menu).to_have_count(0)
        expect(more).to_be_focused()

        cancel.focus()
        cancel.press('Enter')
        expect(toolbar).to_have_count(0)
        expect(self.page.get_by_role('button', name='Library actions', exact=True)).to_be_focused()

        actions = self.page.get_by_role('button', name='Library actions', exact=True)
        actions.press('Enter')
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        toolbar = self.page.get_by_role('toolbar', name='Book selection', exact=True)
        select_all = toolbar.get_by_role('button', name='Select All Visible', exact=True)
        select_all.focus()
        select_all.press('Escape')
        expect(toolbar).to_have_count(0)
        expect(actions).to_be_focused()

    def start_drag(self, layout):
        first, second = self.items().nth(0).bounding_box(), self.items().nth(1).bounding_box()
        if layout == 'Grid':
            gap = (first['x'] + first['width'] + second['x']) / 2
            candidates = [
                (gap, first['y'] + 8),
                (gap, first['y'] + first['height'] / 2),
                (first['x'] - 12, first['y'] + 8),
            ]
            end = (first['x'] + 5, first['y'] + first['height'] - 5)
        else:
            gap = (first['y'] + first['height'] + second['y']) / 2
            candidates = [
                (first['x'] + 8, gap),
                (first['x'] + first['width'] / 2, gap),
                (first['x'] + 8, first['y'] - 12),
                (first['x'] + first['width'] / 2, first['y'] - 12),
            ]
            end = (first['x'] + first['width'] - 5, first['y'] + 5)
        empty = '''([x,y]) => {
          const e=document.elementFromPoint(x,y);
          return !!e?.closest('.library-workspace') &&
            !e.closest('button,a,input,textarea,select');
        }'''
        self.page.wait_for_function('''points => points.some(([x,y]) => {
          const e=document.elementFromPoint(x,y);
          return !!e?.closest('.library-workspace') &&
            !e.closest('button,a,input,textarea,select');
        })''', arg=candidates)
        start = next(point for point in candidates if self.page.evaluate(empty, point))
        self.page.mouse.move(*start)
        self.page.mouse.down()
        self.page.mouse.move(*end, steps=12)
        expect(self.page.locator('.library-selection-marquee')).to_have_count(1)

    def test_marquee_implicitly_enters_selection_and_escape_cancels_in_both_layouts(self):
        self.populate(3)
        for layout in ('Grid', 'List'):
            with self.subTest(layout=layout):
                self.choose_view(layout)
                expect(self.page.get_by_role('menu')).to_have_count(0)
                self.start_drag(layout)
                self.page.keyboard.press('Escape')
                self.page.mouse.up()
                expect(self.page.locator('.library-selection-marquee')).to_have_count(0)
                expect(self.page.get_by_role('button', name='Select All Visible')).to_have_count(0)
                self.start_drag(layout)
                self.page.mouse.up()
                self.count(1)
                expect(self.page.locator('.library-selection-marquee')).to_have_count(0)
                self.assertIn('/manage', self.page.url)
                self.page.get_by_role('button', name='Cancel selection').click()

    def test_current_epub_importer_retains_dublin_core_metadata(self):
        source = zipfile.ZipFile(io.BytesIO(book('Metadata import', creators=('著者',))))
        out = io.BytesIO()
        with source, zipfile.ZipFile(out, 'w') as result:
            for name in source.namelist():
                data = source.read(name)
                if name.endswith('.opf'):
                    data = data.decode().replace('</metadata>',
                        '<dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">出版社</dc:publisher>'
                        '<dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">2024-03-01</dc:date>'
                        '<dc:description xmlns:dc="http://purl.org/dc/elements/1.1/">Plain description</dc:description>'
                        '<dc:subject xmlns:dc="http://purl.org/dc/elements/1.1/">日本語</dc:subject></metadata>').encode()
                result.writestr(name, data)
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name':'metadata.epub', 'mimeType':'application/epub+zip', 'buffer':out.getvalue()})
        expect(self.page.get_by_role('button',name='Read Metadata import',exact=True)).to_be_visible()
        self.menu('Metadata import', 'Edit Metadata…')
        for label, value in [('Authors (one per line)','著者'),('Publisher','出版社'),
                             ('Language','ja'),('Published','2024-03-01'),
                             ('Description','Plain description'),('Tags (one per line)','日本語')]:
            expect(self.dialog().get_by_label(label,exact=True)).to_have_value(value)
        metadata = self.stores('books',['data'])['data'][0]['metadata']
        self.assertEqual('出版社', metadata['publisher'])
        self.assertEqual(['日本語'], metadata['subjects'])

    def test_negotiated_metadata_sync_keeps_snippets_capability(self):
        self.populate(1)
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'reader'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        StaticHandler.presentation_enabled = True
        StaticHandler.account_requests = []
        StaticHandler.preference_revision = 0
        StaticHandler.preference_settings = {}
        self.page.goto(self.origin + '/reader-web/connections')
        self.page.get_by_label('Sync reader settings with this Manabi account', exact=True).check()
        status = self.page.get_by_role('status', name='Settings sync status')
        expect(status).to_contain_text('synced')
        self.go_library()
        self.menu('Parity 0', 'Edit Metadata…')
        self.dialog().get_by_label('Publisher', exact=True).fill('Synced publisher')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.page.goto(self.origin + '/reader-web/connections')
        self.page.get_by_role('button', name='Sync settings now', exact=True).click()
        expect(status).to_contain_text('synced')
        preferences = [request for request in StaticHandler.account_requests
                       if request['path'].endswith('/preferences/')]
        self.assertTrue(any(request['method'] == 'GET' for request in preferences))
        self.assertTrue(any(request['method'] == 'PUT' for request in preferences))
        self.assertTrue(all(request['query'] == 'book_presentation_version=1' and
                            request['library_items'] == 'snippets-v1'
                            for request in preferences))
        books = StaticHandler.preference_settings['library_organization']['books']
        self.assertIn('Synced publisher', [book.get('metadata', {}).get('publisher')
                                           for book in books.values()])
        publisher_record = next(book for book in books.values()
                                if book.get('metadata', {}).get('publisher') == 'Synced publisher')
        self.assertNotIn('title', publisher_record)

    def test_metadata_edit_keeps_source_identity_history_and_plain_text(self):
        self.populate(1)
        before = self.stores('books', ['data', 'bookmark', 'readerStatistic'])
        self.menu('Parity 0', 'Edit Metadata…')
        panel = self.dialog()
        expect(panel.get_by_label('Authors (one per line)', exact=True)).to_have_value('Original Author')
        panel.get_by_label('Title', exact=True).fill('Edited title')
        panel.get_by_label('Authors (one per line)', exact=True).fill('New Author\n\nSecond Author')
        panel.get_by_label('Publisher', exact=True).fill('My publisher')
        panel.get_by_label('Description', exact=True).fill('<script>window.metadataExecuted=true</script>\nLiteral text')
        panel.get_by_label('Tags (one per line)', exact=True).fill('Study\n日本語')
        panel.get_by_role('button', name='Save', exact=True).click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Read Edited title', exact=True)).to_be_visible()
        self.page.reload()
        expect(self.page.get_by_role('button', name='Read Edited title', exact=True)).to_be_visible()
        self.assertEqual(before, self.stores('books', ['data', 'bookmark', 'readerStatistic']))
        self.menu('Edited title', 'Edit Metadata…')
        panel = self.dialog()
        expect(panel.get_by_label('Authors (one per line)', exact=True)).to_have_value('New Author\nSecond Author')
        expect(panel.get_by_label('Publisher', exact=True)).to_have_value('My publisher')
        self.assertIsNone(self.page.evaluate('window.metadataExecuted'))
        panel.get_by_label('Authors (one per line)', exact=True).fill('')
        panel.get_by_role('button', name='Save', exact=True).click()
        expect(panel).to_have_count(0)
        self.page.reload()
        self.menu('Edited title', 'Edit Metadata…')
        expect(self.dialog().get_by_label('Authors (one per line)', exact=True)).to_have_value('')

    def test_metadata_cancel_and_concurrent_tab_edits_do_not_overwrite_each_other(self):
        self.populate(1)
        self.menu('Parity 0', 'Edit Metadata…')
        panel = self.dialog()
        panel.get_by_label('Title', exact=True).fill('Cancelled edit')
        panel.get_by_role('button', name='Cancel', exact=True).click()
        expect(self.page.get_by_role('button', name='Read Parity 0', exact=True)).to_be_visible()
        self.menu('Parity 0', 'Edit Metadata…')
        panel = self.dialog()
        panel.get_by_label('Title', exact=True).fill('Stale edit')
        other = self.context.new_page()
        other.on('pageerror', lambda error: self.errors.append(str(error)))
        try:
            other.goto(self.origin + '/reader-web/manage')
            other.get_by_role('button', name='Actions for Parity 0', exact=True).click()
            other.get_by_role('menuitem', name='Edit Metadata…', exact=True).click()
            editor = other.locator('[data-slot="dialog-content"]')
            editor.get_by_label('Title', exact=True).fill('Concurrent edit')
            editor.get_by_role('button', name='Save', exact=True).click()
            expect(editor).to_have_count(0)
            self.page.bring_to_front()
            panel.get_by_role('button', name='Save', exact=True).click()
            expect(panel.get_by_role('alert')).to_contain_text('edited elsewhere')
            self.assertIn('Concurrent edit', [item.get('title') for item in self.organization()['books'].values()])
        finally:
            other.close()

    def test_reader_library_action_restores_series_and_prior_history_entry(self):
        self.populate(2)
        self.items().nth(0).click(modifiers=[self.modifier()])
        self.page.get_by_role('button', name='Select All Visible').click()
        self.batch_action('Add to Series…')
        self.dialog().get_by_label('Series', exact=True).fill('Return series')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.page.get_by_role('button', name='Cancel selection').click()
        self.page.get_by_role('button', name='Open series Return series', exact=True).click()
        series_url = self.page.url
        self.assertIn('series=', series_url)
        prior_length = self.page.evaluate('history.length')
        self.page.get_by_role('button', name='Start Reading Parity 0', exact=True).click()
        expect(self.page).to_have_url(re.compile(r'/reader-web/b\?id='))
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        reveal_reader_controls(self.page).get_by_role('button', name='Library', exact=True).click()
        expect(self.page).to_have_url(series_url)
        expect(self.page.get_by_role('heading', name='Return series', exact=True)).to_be_visible()
        expect(self.page.get_by_role('button', name='Continue Reading Parity 0', exact=True)).to_be_visible()
        self.assertEqual(prior_length + 1, self.page.evaluate('history.length'))
        self.page.go_back()
        expect(self.page.get_by_role('button', name='Open series Return series', exact=True)).to_be_visible()
        self.assertNotIn('/b?', self.page.url)
        self.page.go_forward()
        expect(self.page).to_have_url(series_url)
        expect(self.page.get_by_role('heading', name='Return series', exact=True)).to_be_visible()
        self.page.get_by_role('button', name='Back', exact=True).click()
        expect(self.page.get_by_role('button', name='Open series Return series', exact=True)).to_be_visible()
        self.assertNotIn('/b?', self.page.url)

    def test_single_and_batch_blur_persist_in_grid_list_and_series(self):
        self.populate(2)
        before = self.stores('books', ['data'])
        self.menu('Parity 0', 'Blur Cover')
        expect(self.tile('Parity 0').locator('[data-cover-blurred]')).to_have_attribute('data-cover-blurred', 'true')
        self.items().nth(0).click(modifiers=[self.modifier()])
        self.page.get_by_role('button', name='Select All Visible').click()
        self.batch_action('Blur Covers')
        expect(self.page.locator('.shelf-item [data-cover-blurred="true"]')).to_have_count(2)
        self.page.get_by_role('button', name='Cancel selection').click()
        self.choose_view('List')
        self.page.reload()
        expect(self.page.locator('.shelf-item [data-cover-blurred="true"]')).to_have_count(2)
        self.assertEqual(before, self.stores('books', ['data']))
        self.items().nth(0).click(modifiers=[self.modifier()])
        self.page.get_by_role('button', name='Select All Visible').click()
        self.batch_action('Add to Series…')
        self.dialog().get_by_label('Series', exact=True).fill('Blurred series')
        self.dialog().get_by_role('button', name='Save', exact=True).click()
        expect(self.dialog()).to_have_count(0)
        self.page.get_by_role('button', name='Cancel selection').click()
        expect(self.page.get_by_role('button', name='Open series Blurred series')).to_be_visible()
        expect(self.page.locator('.series-item [data-cover-blurred="true"]')).to_have_count(2)

    def test_batch_collection_new_existing_and_mixed_membership(self):
        self.populate(2)
        self.add_collection('Parity 0', 'Existing collection')
        self.items().nth(0).click(modifiers=[self.modifier()])
        self.page.get_by_role('button', name='Select All Visible').click()
        self.batch_action('Add to Collection…')
        panel = self.dialog()
        checkbox = panel.get_by_role('checkbox', name='Existing collection', exact=True)
        self.assertTrue(checkbox.evaluate('e => e.indeterminate'))
        checkbox.check()
        expect(checkbox).to_be_checked()
        panel.get_by_label('New collection name', exact=True).fill('Batch collection')
        panel.get_by_role('button', name='Create', exact=True).click()
        expect(panel.get_by_label('New collection name', exact=True)).to_have_value('')
        expect(panel.get_by_role('checkbox', name='Batch collection', exact=True)).to_be_checked()
        panel.get_by_role('button', name='Done', exact=True).click()
        expect(panel).to_have_count(0)
        for collection in self.organization()['collections']:
            if collection['name'] in ('Existing collection', 'Batch collection'):
                self.assertEqual(2, len(collection['members']))

    def test_batch_deletion_requires_confirmation_and_cancel_is_non_destructive(self):
        self.populate(2)
        self.items().nth(0).click(modifiers=[self.modifier()])
        self.batch_action('Delete Selected Books')
        self.page.get_by_role('button', name='Cancel', exact=True).click()
        self.assertEqual(2, len(self.stores('books', ['data'])['data']))
        self.batch_action('Delete Selected Books')
        self.page.get_by_role('button', name='Confirm', exact=True).click()
        expect(self.items()).to_have_count(1)
        self.assertEqual(1, len(self.stores('books', ['data'])['data']))

    def open_reader(self):
        self.import_book('Chrome test')
        self.page.get_by_role('button', name='Read Chrome test', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        return self.page.locator('button[data-reader-controls]')

    def test_idle_and_mouse_reveals_timeout_but_click_reveal_stays_pinned_without_reflow(self):
        controls = self.open_reader()
        geometry = self.page.locator('.reader-page-frame').evaluate('e => {const s=getComputedStyle(e);return [s.paddingTop,s.paddingBottom]}')
        # Navigation leaves focus on the controls. Focus protects them for keyboard
        # users, so release that focus before testing the idle reading state.
        controls.evaluate('e => e.blur()')
        # Closed portal remnants must not protect transient chrome. This mirrors
        # component libraries that retain hidden role nodes between openings.
        self.page.evaluate('''() => {
          const dialog=document.createElement('div');
          dialog.id='hidden-reader-dialog-regression';
          dialog.role='dialog';
          dialog.hidden=true;
          document.body.append(dialog);
          const menu=document.createElement('div');
          menu.id='hidden-reader-menu-regression';
          menu.role='menu';
          menu.style.display='none';
          document.body.append(menu);
        }''')
        # Real elapsed-time timers, not a stub clock or replacement controller.
        expect(controls).to_have_class(re.compile(r'chrome-hidden'), timeout=10000)
        self.page.locator('#hidden-reader-dialog-regression, #hidden-reader-menu-regression').evaluate_all(
            'nodes => nodes.forEach(node => node.remove())')
        self.page.mouse.move(600, 400)
        expect(controls).not_to_have_class(re.compile(r'chrome-hidden'))
        expect(controls).to_have_class(re.compile(r'chrome-hidden'), timeout=10000)
        self.page.mouse.click(620, 420)
        expect(controls).to_have_attribute('aria-expanded', 'true')
        self.page.wait_for_timeout(3500)  # Assert absence of the 3-second idle hide after explicit reveal.
        expect(controls).not_to_have_class(re.compile(r'chrome-hidden'))
        self.page.mouse.move(640, 430)
        self.page.wait_for_timeout(3500)
        expect(controls).not_to_have_class(re.compile(r'chrome-hidden'))
        self.assertEqual(geometry, self.page.locator('.reader-page-frame').evaluate('e => {const s=getComputedStyle(e);return [s.paddingTop,s.paddingBottom]}'))
        self.page.mouse.click(640, 430)
        expect(controls).to_have_class(re.compile(r'chrome-hidden'))
        reveal_reader_controls(self.page)
        expect(controls).to_have_attribute('aria-expanded', 'true')

    def test_fullscreen_uses_browser_capability_and_restores_labels(self):
        self.open_reader()
        reveal_reader_controls(self.page)
        supported = self.page.evaluate('!!(document.fullscreenEnabled ?? document.webkitFullscreenEnabled)')
        enter = self.page.get_by_role('button', name='Enter Fullscreen', exact=True)
        if not supported:
            expect(enter).to_have_count(0)
            return
        enter.click()
        self.page.wait_for_function('() => (document.fullscreenElement ?? document.webkitFullscreenElement) === document.documentElement')
        leave = self.page.get_by_role('button', name='Exit Fullscreen', exact=True)
        expect(leave).to_be_visible()
        leave.click()
        self.page.wait_for_function('() => !(document.fullscreenElement ?? document.webkitFullscreenElement)')
        expect(enter).to_be_visible()


class LibraryTouchParityBrowser(LibraryBase):
    touch = True

    def test_touch_reveal_stays_pinned_and_touch_does_not_start_library_marquee(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.import_book('Touch parity')
        self.page.get_by_role('button', name='Read Touch parity', exact=True).tap()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        # A focused navigation control intentionally keeps chrome visible.
        self.page.evaluate('document.activeElement?.blur()')
        controls = self.page.locator('button[data-reader-controls]')
        expect(controls).to_have_class(re.compile(r'chrome-hidden'), timeout=10000)
        self.page.touchscreen.tap(195, 400)
        expect(controls).to_have_attribute('aria-expanded', 'true')
        self.page.wait_for_timeout(3500)
        expect(controls).not_to_have_class(re.compile(r'chrome-hidden'))
        self.page.touchscreen.tap(195, 400)
        expect(controls).to_have_class(re.compile(r'chrome-hidden'))
        self.go_library()
        self.page.touchscreen.tap(195, 700)
        expect(self.page.locator('.library-selection-marquee')).to_have_count(0)
        expect(self.page.get_by_role('button', name='Select All Visible')).to_have_count(0)


class LibraryPreviewParityBrowser(LibraryBase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), CloudRelocationHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    def setUp(self):
        CloudRelocationHandler.nodes = {
            GOOGLE: {'preview': {'name':'Preview.epub','kind':'file','parent':'google-root'}}, DROPBOX:{}}
        StaticHandler.account_fixture = {
            'user': {'id':'42','username':'reader'}, 'csrf_token':'c'*64, 'providers':[]}
        super().setUp()
        expect(self.page.get_by_role('button',name='Read Traveling volume',exact=True)).to_be_visible()

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            CloudRelocationHandler.nodes = {}
            StaticHandler.account_fixture = None

    def test_unopened_preview_selection_and_batch_blur_do_not_import_or_delete_originals(self):
        for layout in ('Grid','List'):
            self.choose_view(layout)
            self.page.get_by_role('button',name='Library actions',exact=True).click()
            self.page.get_by_role('menuitem',name='Select Books',exact=True).click()
            self.page.get_by_role('button',name='Select All Visible',exact=True).click()
            expect(self.page.get_by_role('banner',name='Library toolbar').get_by_text('1 selected',exact=True)).to_be_visible()
            self.page.get_by_role('button',name='Selected book actions',exact=True).click()
            expect(self.page.get_by_role('menuitem',name='Delete Selected Books',exact=True)).to_be_disabled()
            self.page.get_by_role('menuitem',name='Blur Covers' if layout == 'Grid' else 'Unblur Covers',exact=True).click()
            self.page.get_by_role('button',name='Cancel selection',exact=True).click()
            expect(self.tile('Traveling volume').locator('[data-cover-blurred]')).to_have_attribute(
                'data-cover-blurred','true' if layout == 'Grid' else 'false')
            self.assertEqual([], self.stores('books',['data'])['data'])
            self.assertIn('preview',CloudRelocationHandler.nodes[GOOGLE])


class PresentationServer(StaticHandler):
    supported = False

    def wants_extensions(self):
        return self.supported and parse_qs(urlsplit(self.path).query).get('book_presentation_version') == ['1']

    def reply(self):
        result = {'user_id':self.account_fixture['user']['id'], 'schema_version':1,
                  'revision':self.preference_revision, 'settings':self.preference_settings}
        if self.wants_extensions():
            result['book_presentation_version'] = 1
        self.api_response(result,user=result['user_id'])

    def do_GET(self):
        if urlsplit(self.path).path == '/api/reader-web/preferences/':
            self.api_request()
            self.reply()
        else:
            super().do_GET()

    def do_PUT(self):
        if urlsplit(self.path).path != '/api/reader-web/preferences/':
            return super().do_PUT()
        self.api_request()
        if self.headers.get('If-Match') != '"%d"' % self.preference_revision:
            return self.send_error(412)
        settings = type(self).account_requests[-1]['body']['settings']
        # Deliberately model the legacy/unversioned contract: additive fields are unsupported.
        if not self.wants_extensions():
            allowed = {'title','cover','direction','modifiedAt'}
            if any(not set(value) <= allowed for value in settings.get('library_organization',{}).get('books',{}).values()):
                return self.send_error(400)
        type(self).preference_settings = settings
        type(self).preference_revision += 1
        self.reply()


class LibraryPreferenceParityBrowser(LibraryBase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), PresentationServer)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()

    def setUp(self):
        PresentationServer.account_fixture = {'user':{'id':'42','username':'reader'},'csrf_token':'c'*64,'providers':[]}
        PresentationServer.preference_settings = {}
        PresentationServer.preference_revision = 0
        PresentationServer.account_requests = []
        PresentationServer.supported = False
        super().setUp()

    def test_legacy_fallback_survives_upgrade_but_versioned_remote_removal_is_authoritative(self):
        self.import_book('Preferences parity')
        self.menu('Preferences parity', 'Edit Metadata…')
        panel = self.dialog()
        panel.get_by_label('Publisher',exact=True).fill('Retain this publisher')
        panel.get_by_label('Series',exact=True).fill('Personal series')
        panel.get_by_label('Blur cover',exact=True).check()
        panel.get_by_role('button',name='Save',exact=True).click()
        expect(panel).to_have_count(0)
        self.page.goto(self.origin + '/reader-web/connections')
        self.page.get_by_label('Sync reader settings with this Manabi account',exact=True).check()
        status = self.page.get_by_role('status',name='Settings sync status')
        expect(status).to_contain_text('book metadata saved locally',timeout=15000)
        server_books = PresentationServer.preference_settings['library_organization']['books']
        # This edit contains only extension fields, so the legacy wire format
        # has no book presentation to send.
        self.assertEqual({}, server_books)
        self.assertTrue(all('metadata' not in value and 'coverBlur' not in value and 'series' not in value for value in server_books.values()))
        self.page.reload()
        expect(status).to_contain_text('book metadata saved locally',timeout=15000)
        PresentationServer.supported = True
        self.page.get_by_role('button',name='Sync settings now',exact=True).click()
        expect(status).to_have_text('Settings sync: synced',timeout=15000)
        values = list(PresentationServer.preference_settings['library_organization']['books'].values())
        self.assertEqual('Retain this publisher',values[0]['metadata']['publisher'])
        self.assertTrue(values[0]['coverBlur'])
        self.assertEqual('Personal series',values[0]['series']['name'])
        for value in PresentationServer.preference_settings['library_organization']['books'].values():
            for key in ('metadata','series','coverBlur'):
                value.pop(key,None)
            value['modifiedAt'] += 1
        PresentationServer.preference_revision += 1
        puts_before = len([request for request in PresentationServer.account_requests
                           if request['method'] == 'PUT'])
        self.page.get_by_role('button',name='Sync settings now',exact=True).click()
        expect(status).to_have_text('Settings sync: synced',timeout=15000)
        puts_after = len([request for request in PresentationServer.account_requests
                          if request['method'] == 'PUT'])
        self.assertEqual(puts_before, puts_after, 'versioned removal was uploaded back to the server')
        self.assertTrue(all('metadata' not in value and 'coverBlur' not in value and 'series' not in value
                            for value in PresentationServer.preference_settings['library_organization']['books'].values()))
        self.go_library()
        expect(self.page.get_by_role('button',name='Open series Personal series',exact=True)).to_have_count(0)
        expect(self.tile('Preferences parity').locator('[data-cover-blurred]')).to_have_attribute(
            'data-cover-blurred','false')
        self.menu('Preferences parity','Edit Metadata…')
        expect(self.dialog().get_by_label('Publisher',exact=True)).to_have_value('')
        expect(self.dialog().get_by_label('Series',exact=True)).to_have_value('')


if __name__ == '__main__':
    unittest.main()
