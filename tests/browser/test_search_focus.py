"""Focus handoffs and reachable dismissal in the actual built Reader/Library.

Generated EPUB imports and real worker results. One named race uses synthetic
input events to interleave a query at the Svelte commit; no results are mocked.
"""
import re
import unittest

from playwright.sync_api import expect
from test_product_journeys import ProductJourneyBase
from search_geometry import assert_control_reachable, assert_mark_visible
from test_books_library import book


class SearchFocusQuality(ProductJourneyBase):
    def open_search_book(self, title, body):
        self.import_book(title, body=body)
        self.read(title)
        return self.reader_search()

    def test_tab_order_reveals_the_match_without_hiding_dismissal(self):
        panel, field = self.open_search_book(
            'Keyboard reading', '<p>' + '冒頭の文章。' * 20 + '猫' + '続く文章。' * 20 + '</p>')
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate("document.documentElement.style.fontSize='200%'")
        field.fill('猫')
        hits = self.result_buttons(panel)
        expect(hits).to_have_count(1)
        field.press('Tab')
        expect(panel.get_by_role('button', name='Clear search', exact=True)).to_be_focused()
        self.page.keyboard.press('Tab')
        expect(panel.get_by_label('Match case', exact=True)).to_be_focused()
        self.page.keyboard.press('Tab')
        expect(hits.first).to_be_focused()
        assert_mark_visible(self, hits.locator('mark'))
        close = panel.get_by_role('button', name='Close search', exact=True)
        assert_control_reachable(self, close)
        self.checkpoint('keyboard-visible-match')
        # A trusted pointer click must reach dismissal, not a clipped control.
        close.click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Show reading controls', exact=True)).to_be_focused()

    def test_more_results_cannot_steal_focus_from_a_new_query(self):
        panel, field = self.open_search_book('New query owns focus', '<p>猫</p>' * 51 + '<p>犬</p>')
        field.fill('猫')
        expect(panel.get_by_text('51 results', exact=True)).to_be_visible()
        more = panel.get_by_role('button', name='Show more results', exact=True)
        # Deterministically interleave a newer input between activation and
        # Svelte's commit. Only input events are synthesized; results are real.
        more.evaluate("""button => button.addEventListener('click', () => {
          queueMicrotask(() => {
            const field=document.querySelector('input[aria-label="Search within book"]');
            field.focus(); field.value='犬';
            field.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'犬'}));
          });
        }, {capture:true,once:true})""")
        more.click()
        expect(field).to_have_value('犬')
        expect(field).to_be_focused()
        expect(panel.get_by_text('1 result', exact=True)).to_be_visible()
        expect(self.result_buttons(panel).locator('mark')).to_have_text('犬')
        expect(more).to_have_count(0)
        self.checkpoint('new-query-retains-focus')

    def test_pointer_pagination_retains_focus_through_the_last_batch(self):
        panel, field = self.open_search_book('Pointer result batches', '<p>猫</p>' * 101)
        field.fill('猫')
        expect(panel.get_by_text('101 results', exact=True)).to_be_visible()
        more = panel.get_by_role('button', name='Show more results', exact=True)
        more.click()
        expect(self.result_buttons(panel)).to_have_count(100)
        expect(self.result_buttons(panel).nth(50)).to_be_focused()
        more.click()
        expect(self.result_buttons(panel)).to_have_count(101)
        expect(self.result_buttons(panel).nth(100)).to_be_focused()
        assert_mark_visible(self, self.result_buttons(panel).nth(100).locator('mark'))
        expect(more).to_have_count(0)
        self.checkpoint('last-pointer-result')

    def test_explicit_dismissal_ends_composition_without_poisoning_reopen(self):
        panel, field = self.open_search_book('Composition reopening', '<p>猫と犬</p>')
        field.fill('猫')
        expect(self.result_buttons(panel).locator('mark')).to_have_text('猫')
        field.dispatch_event('compositionstart', {'data': ''})
        expect(panel.get_by_text('Finish entering text to search.', exact=True)).to_be_visible()
        panel.get_by_role('button', name='Close search', exact=True).click()
        expect(panel).to_have_count(0)
        panel, field = self.reader_search()
        field.fill('犬')
        expect(panel.get_by_text('1 result', exact=True)).to_be_visible()
        expect(self.result_buttons(panel).locator('mark')).to_have_text('犬')
        expect(panel.get_by_text('Finish entering text to search.', exact=True)).to_have_count(0)
        self.checkpoint('reopened-after-composition')

    def test_large_title_keeps_close_control_reachable_after_scrolling(self):
        title = '長い日本語の題名・' * 10
        panel, field = self.open_search_book(title, '<p>' + '冒頭の文章。' * 20 + '猫' + '続く文章。' * 20 + '</p>')
        close = panel.get_by_role('button', name='Close search', exact=True)
        for width, height in ((320, 568), (667, 320)):
            with self.subTest(width=width, height=height):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.evaluate("document.documentElement.style.fontSize='200%'")
                field.fill('猫')
                hits = self.result_buttons(panel)
                expect(hits).to_have_count(1)
                hits.first.focus()
                expect(hits.first).to_be_focused()
                assert_mark_visible(self, hits.locator('mark'))
                close = panel.get_by_role('button', name='Close search', exact=True)
                assert_control_reachable(self, close)
                geometry = close.bounding_box()
                self.assertGreaterEqual(geometry['width'], 44)
                self.assertGreaterEqual(geometry['height'], 44)
                # Dismissal is not covered by the scrolled content or the overlay.
                self.assertTrue(close.evaluate("e => {const r=e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}"))
                self.assertTrue(panel.evaluate('e => e.scrollWidth <= e.clientWidth + 1'))
                self.checkpoint(f'large-reachable-match-{width}')
                field.focus()
                expect(field).to_be_in_viewport()
                panel.get_by_role('button', name='Clear search', exact=True).click()
                expect(field).to_have_value('')
                expect(field).to_be_focused()
        close.click()
        expect(panel).to_have_count(0)

    def test_library_keyboard_batches_focus_each_new_boundary(self):
        titles = [f'Focus collection {index:02d}' for index in range(61)]
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files([
            {'name': title + '.epub', 'mimeType': 'application/epub+zip',
             'buffer': book(title, body='<p>Local reading text.</p>', size=(12, 18))}
            for title in titles
        ])
        expect(self.page.get_by_role('button', name='Books 61', exact=True)).to_be_visible(timeout=60000)
        shelves = self.page.get_by_role('region', name='Library shelves')
        expect(shelves).to_have_attribute('data-hydrated', 'true')
        expect(shelves).to_have_attribute('aria-busy', 'false')
        self.library_search('Focus collection')
        results = self.page.get_by_label('Library search results', exact=True)
        matches = results.get_by_role('button', name=re.compile('^Read Focus collection '))
        expect(matches).to_have_count(30)
        more = results.get_by_role('button', name='Show more books', exact=True)
        more.focus()
        more.press('Enter')
        expect(matches).to_have_count(60)
        expect(matches.nth(30)).to_be_focused()
        expect(matches.nth(30)).to_be_in_viewport()
        more.focus()
        more.press('Enter')
        expect(matches).to_have_count(61)
        expect(matches.nth(60)).to_be_focused()
        expect(matches.nth(60)).to_be_in_viewport()
        expect(more).to_have_count(0)
        self.assertEqual(set(titles), {text.removeprefix('Read ') for text in matches.evaluate_all('nodes => nodes.map(n => n.getAttribute("aria-label"))')})
        self.assertEqual(61, len(self.stores('books', ['data'])['data']))
        self.checkpoint('last-library-keyboard-result')


if __name__ == '__main__':
    unittest.main(verbosity=2)
