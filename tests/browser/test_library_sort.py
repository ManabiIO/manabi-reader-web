"""Direct shelf sorting in the actual export, using existing local preferences."""
import json
from pathlib import Path
import re
import socket
import threading
import unittest
from playwright.sync_api import expect
from test_books_library import LibraryBase
from test_static_reader import StaticHandler, ThreadingHTTPServer
from offline_shell import enter_offline_shell


class LibrarySortBrowser(LibraryBase):
    touch = True

    def trigger(self):
        return self.page.get_by_role('button', name=re.compile(r'^Sort books:'))

    def choose_sort(self, label):
        self.trigger().click()
        self.page.get_by_role('menu', name='Sort books', exact=True).get_by_role(
            'menuitemradio', name=label, exact=True).click()
        expect(self.page.get_by_role('menu')).to_have_count(0)
        expect(self.trigger()).to_be_focused()

    def saved_sort(self):
        return self.page.evaluate('localStorage.getItem("booklistSortOptions")')

    def test_direct_sort_keyboard_order_and_offline_reload_preserve_reading_data(self):
        # Use a dedicated real origin so it can be stopped without affecting
        # later tests. Playwright WebKit's offline flag rejects SW navigation;
        # qualify offline edits, then cached reloads with the origin shut down.
        server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        stopped = False

        def stop_origin():
            nonlocal stopped
            if not stopped:
                server.shutdown()
                server.server_close()
                thread.join()
                stopped = True

        self.addCleanup(stop_origin)
        self.origin = 'http://127.0.0.1:' + str(server.server_port)
        self.go_library()
        self.import_book('Zulu sort', creators=('Amy',))
        self.import_book('Alpha sort', creators=('Zed',))
        before = self.stores('books', ['bookmark', 'statistic'])
        trigger = self.trigger()
        expect(trigger).to_have_count(1)
        trigger.focus()
        trigger.press('ArrowDown')
        menu = self.page.get_by_role('menu', name='Sort books', exact=True)
        expected_choices = ['Recent', 'Title', 'Author', 'Added', 'Progress', 'Characters',
                            'Last Update', 'Bookmarked', 'Ascending', 'Descending']
        expect(menu.get_by_role('menuitemradio')).to_have_count(len(expected_choices))
        for index, label in enumerate(expected_choices):
            expect(menu.get_by_role('menuitemradio').nth(index)).to_have_accessible_name(label)
        expect(menu.get_by_role('menuitem')).to_have_count(0)
        expect(menu.get_by_role('menuitemradio', name='Recent', exact=True)).to_be_focused()
        self.page.keyboard.press('ArrowDown')
        self.page.keyboard.press('Enter')
        expect(trigger).to_have_accessible_name('Sort books: Title, descending')
        expect(trigger).to_be_focused()
        trigger.press('ArrowDown')
        self.page.keyboard.press('End')
        self.page.keyboard.press('ArrowUp')
        expect(menu.get_by_role('menuitemradio', name='Ascending', exact=True)).to_be_focused()
        self.page.keyboard.press('Enter')
        expect(trigger).to_have_accessible_name('Sort books: Title, ascending')
        titles = self.page.locator('.shelf-item .book-copy h3')
        expect(titles).to_have_text(['Alpha sort', 'Zulu sort'])
        saved = json.loads(self.saved_sort())
        self.choose_sort('Author')
        expect(trigger).to_have_accessible_name('Sort books: Author, ascending')
        expect(titles).to_have_text(['Zulu sort', 'Alpha sort'])
        expected = {**saved, 'browser': {'property': 'author', 'direction': 'asc'}}
        self.assertEqual(json.loads(self.saved_sort()), expected)
        # The retained header menu reads the same preference; it owns no copy.
        self.open_view_menu()
        self.page.get_by_role('menuitem', name='Sort by…', exact=True).click()
        expect(self.page.get_by_role('menuitemradio', name='Author', exact=True)).to_have_attribute('aria-checked', 'true')
        self.page.keyboard.press('Escape')
        enter_offline_shell(self.page, self.origin + '/reader-web/')
        self.context.set_offline(True)
        try:
            expect(self.trigger()).to_have_accessible_name('Sort books: Author, ascending')
            expect(titles).to_have_text(['Zulu sort', 'Alpha sort'])
            self.assertFalse(self.page.evaluate('navigator.onLine'))
            self.choose_sort('Descending')
            expect(self.trigger()).to_have_accessible_name('Sort books: Author, descending')
            expect(titles).to_have_text(['Alpha sort', 'Zulu sort'])
            expected['browser']['direction'] = 'desc'
            self.assertEqual(json.loads(self.saved_sort()), expected)
        finally:
            self.context.set_offline(False)
        stop_origin()
        with self.assertRaises(ConnectionRefusedError):
            with socket.create_connection(('127.0.0.1', server.server_port), timeout=2):
                pass
        response = self.page.reload()
        self.assertTrue(response.from_service_worker, 'The stopped server cannot supply this document')
        expect(self.trigger()).to_have_accessible_name('Sort books: Author, descending')
        expect(titles).to_have_text(['Alpha sort', 'Zulu sort'])
        self.assertEqual(json.loads(self.saved_sort()), expected)
        self.assertEqual(before, self.stores('books', ['bookmark', 'statistic']))

    def test_finished_sort_is_separate_and_persists_without_changing_book_sort(self):
        for title, day in [('Earlier finish', '2023-01-15'), ('Later finish', '2024-02-29')]:
            self.import_book(title)
            self.menu(title, 'Mark as Finished')
            self.menu(title, 'Edit Finished Date…')
            self.dialog().get_by_label('Finished on', exact=True).fill(day)
            self.dialog().get_by_role('button', name='Save', exact=True).click()
        self.choose_sort('Title')
        self.choose_sort('Ascending')
        original = self.saved_sort()
        before = self.stores('books', ['bookmark', 'statistic'])
        self.choose_collection('Finished')
        expect(self.trigger()).to_have_accessible_name('Sort books: Finished date, newest first')
        self.trigger().click()
        menu = self.page.get_by_role('menu', name='Sort books', exact=True)
        expect(menu.get_by_role('menuitemradio')).to_have_count(2)
        expect(menu.get_by_role('menuitemradio').nth(0)).to_have_accessible_name('Newest first')
        expect(menu.get_by_role('menuitemradio').nth(1)).to_have_accessible_name('Oldest first')
        menu.get_by_role('menuitemradio', name='Oldest first', exact=True).click()
        expect(self.trigger()).to_be_focused()
        expect(self.page.locator('.finished-title')).to_have_text(['Earlier finish', 'Later finish'])
        self.page.reload()
        expect(self.trigger()).to_have_accessible_name('Sort books: Finished date, oldest first')
        expect(self.page.locator('.finished-title')).to_have_text(['Earlier finish', 'Later finish'])
        self.assertEqual(original, self.saved_sort())
        self.assertEqual('asc', self.page.evaluate('localStorage.getItem("manabi-finished-order")'))
        self.choose_collection('Books')
        expect(self.trigger()).to_have_accessible_name('Sort books: Title, ascending')
        self.assertEqual(before, self.stores('books', ['bookmark', 'statistic']))

    def test_direct_sort_reflows_and_all_choices_remain_reachable_at_large_text(self):
        self.import_book('Shelf controls', creators=('A reader',))
        self.choose_sort('Last Update')
        for width, scale, mode in [(1200, 100, 'light'), (390, 100, 'dark'),
                                   (320, 200, 'light'), (320, 200, 'dark')]:
            with self.subTest(width=width, scale=scale, mode=mode):
                self.page.evaluate('mode => localStorage.setItem("appearance", mode)', mode)
                self.page.reload()
                self.page.set_viewport_size({'width': width, 'height': 700})
                self.page.evaluate('scale => document.documentElement.style.fontSize=scale+"%"', scale)
                trigger = self.trigger()
                expect(trigger).to_be_enabled()
                trigger.scroll_into_view_if_needed()
                box = trigger.bounding_box()
                self.assertGreaterEqual(box['height'], 44)
                self.assertGreaterEqual(box['x'], 0)
                self.assertLessEqual(box['x'] + box['width'], width)
                self.assertLessEqual(trigger.evaluate('e=>e.scrollWidth-e.clientWidth'), 1)
                output = Path('test-results')
                output.mkdir(exist_ok=True)
                stem = f'sort-shelf-{self.engine}-{width}-{scale}-{mode}'
                self.page.screenshot(path=str(output / (stem + '.png')), animations='disabled')
                saved = self.saved_sort()
                trigger.tap()
                menu = self.page.get_by_role('menu', name='Sort books', exact=True)
                expect(menu.get_by_role('menuitemradio')).to_have_count(10)
                self.assertLessEqual(menu.evaluate('e=>e.scrollWidth-e.clientWidth'), 1)
                self.page.keyboard.press('End')
                expect(menu.get_by_role('menuitemradio', name='Descending', exact=True)).to_be_in_viewport()
                self.page.keyboard.press('Home')
                expect(menu.get_by_role('menuitemradio', name='Recent', exact=True)).to_be_in_viewport()
                self.page.screenshot(path=str(output / (stem + '-menu.png')), animations='disabled')
                self.page.keyboard.press('Escape')
                expect(trigger).to_be_focused()
                expect(self.page.get_by_role('menu')).to_have_count(0)
                self.assertEqual(saved, self.saved_sort(), 'Opening and dismissing cannot save')
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth-innerWidth'), 1)


if __name__ == '__main__':
    unittest.main()
