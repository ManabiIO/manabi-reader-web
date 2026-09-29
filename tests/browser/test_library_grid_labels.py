"""Visual identity and responsive geometry for Library grid cards."""
import json
from pathlib import Path
import unittest

from playwright.sync_api import expect
from test_books_library import LibraryBase


class LibraryGridLabels(LibraryBase):
    def setUp(self):
        super().setUp()
        self.output = Path('test-results') / 'library-grid-labels' / self.engine / self._testMethodName
        self.output.mkdir(parents=True, exist_ok=True)
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)

    def tearDown(self):
        try:
            self.page.screenshot(path=str(self.output / 'final.png'), full_page=True)
            (self.output / 'final.html').write_text(self.page.content())
            (self.output / 'page-errors.json').write_text(json.dumps(self.errors, indent=2))
            self.context.tracing.stop(path=str(self.output / 'trace.zip'))
        finally:
            super().tearDown()

    def assert_grid_geometry(self, title, author):
        button = self.page.get_by_role('button', name='Read ' + title, exact=True)
        expect(button).to_be_visible()
        title_text = button.get_by_text(title, exact=True)
        author_text = button.get_by_text(author, exact=True)
        expect(title_text).to_be_visible()
        expect(author_text).to_be_visible()
        geometry = button.evaluate('''button => {
          const cover = button.querySelector('.book-thumbnail').getBoundingClientRect();
          const title = button.querySelector('.book-copy h3').getBoundingClientRect();
          const author = button.querySelector('.book-author').getBoundingClientRect();
          const card = button.getBoundingClientRect();
          return {
            cover:{left:cover.left,right:cover.right,top:cover.top,bottom:cover.bottom},
            title:{left:title.left,right:title.right,top:title.top,bottom:title.bottom,height:title.height},
            author:{left:author.left,right:author.right,top:author.top,bottom:author.bottom},
            card:{left:card.left,right:card.right},
            pageOverflow:document.documentElement.scrollWidth-innerWidth
          };
        }''')
        self.assertGreaterEqual(geometry['title']['top'], geometry['cover']['bottom'] + 4, geometry)
        self.assertGreater(geometry['title']['height'], 0, geometry)
        self.assertGreaterEqual(geometry['title']['left'], geometry['card']['left'] - 1, geometry)
        self.assertLessEqual(geometry['title']['right'], geometry['card']['right'] + 1, geometry)
        self.assertGreaterEqual(geometry['author']['top'], geometry['title']['bottom'] - 1, geometry)
        self.assertLessEqual(geometry['pageOverflow'], 1, geometry)

    def test_same_cover_books_keep_visible_titles_authors_and_selection_identity(self):
        first = 'The Long Journey Through Japanese Reading'
        second = '日本語で読む長い本のタイトルと物語'
        self.import_book(first, creators=('Akari Tanaka',))
        self.import_book(second, creators=('Haruto Suzuki',))

        for width, height in ((390, 844), (320, 568), (1200, 900)):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.assert_grid_geometry(first, 'Akari Tanaka')
                self.assert_grid_geometry(second, 'Haruto Suzuki')
                self.page.screenshot(path=str(self.output / f'grid-{width}.png'), full_page=True)

        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        first_select = self.page.get_by_role('button', name='Select ' + first, exact=True)
        second_select = self.page.get_by_role('button', name='Select ' + second, exact=True)
        expect(first_select.get_by_text(first, exact=True)).to_be_visible()
        expect(second_select.get_by_text(second, exact=True)).to_be_visible()
        first_select.click()
        expect(first_select).to_have_attribute('aria-pressed', 'true')
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        expect(first_select.get_by_text(first, exact=True)).to_be_visible()

        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.assertLessEqual(
            self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
        expect(first_select.get_by_text(first, exact=True)).to_be_visible()
        expect(second_select.get_by_text(second, exact=True)).to_be_visible()
        self.page.screenshot(path=str(self.output / 'selection-320.png'), full_page=True)


    def test_enlarged_grid_identity_stays_readable_without_horizontal_overflow(self):
        first = 'An Extremely Long English Book Title for Enlarged Library Text'
        second = 'とても長い日本語の書名を拡大表示しても読みやすい本'
        self.import_book(first, creators=('Alexandra Longname',))
        self.import_book(second, creators=('山田 太郎',))

        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        for title, author in ((first, 'Alexandra Longname'), (second, '山田 太郎')):
            with self.subTest(title=title):
                self.assert_grid_geometry(title, author)
                button = self.page.get_by_role('button', name='Read ' + title, exact=True)
                metrics = button.evaluate('''button => {
                  const card = button.getBoundingClientRect();
                  const title = button.querySelector('.book-copy h3').getBoundingClientRect();
                  const author = button.querySelector('.book-author').getBoundingClientRect();
                  const copy = button.querySelector('.book-copy').getBoundingClientRect();
                  return {
                    card:{left:card.left,right:card.right,width:card.width},
                    title:{left:title.left,right:title.right,top:title.top,bottom:title.bottom},
                    author:{left:author.left,right:author.right,top:author.top,bottom:author.bottom},
                    copy:{left:copy.left,right:copy.right},
                    viewport:innerWidth,
                    pageOverflow:document.documentElement.scrollWidth-innerWidth
                  };
                }''')
                self.assertGreaterEqual(metrics['card']['left'], -1, metrics)
                self.assertLessEqual(metrics['card']['right'], metrics['viewport'] + 1, metrics)
                self.assertGreaterEqual(metrics['title']['left'], metrics['copy']['left'] - 1, metrics)
                self.assertLessEqual(metrics['title']['right'], metrics['copy']['right'] + 1, metrics)
                self.assertGreaterEqual(metrics['author']['top'], metrics['title']['bottom'] - 1, metrics)
                self.assertLessEqual(metrics['pageOverflow'], 1, metrics)

        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Select Books', exact=True).click()
        first_select = self.page.get_by_role('button', name='Select ' + first, exact=True)
        second_select = self.page.get_by_role('button', name='Select ' + second, exact=True)
        first_select.focus()
        expect(first_select).to_be_focused()
        first_select.press('Space')
        expect(first_select).to_have_attribute('aria-pressed', 'true')
        expect(self.page.get_by_text('1 selected', exact=True)).to_be_visible()
        expect(first_select.get_by_text(first, exact=True)).to_be_visible()
        expect(second_select.get_by_text(second, exact=True)).to_be_visible()
        self.assertLessEqual(
            self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)

        self.page.screenshot(
            path=str(self.output / 'grid-enlarged-320.png'), full_page=True)



if __name__ == '__main__':
    unittest.main(verbosity=2)
