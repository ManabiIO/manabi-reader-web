"""Real unified search: generated EPUBs and an imported Yomitan ZIP, no result mocks.

One explicitly named test blocks the dictionary manifest to verify failure isolation.
Composition tests emulate DOM contracts; they do not claim physical IME coverage.
"""
import io
import json
import unittest
import zipfile
from playwright.sync_api import expect
from test_product_journeys import ProductJourneyBase


def dictionary_archive():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('index.json', json.dumps({'title': 'Unified search fixture', 'revision': '1', 'format': 3, 'sequenced': True}))
        archive.writestr('term_bank_1.json', json.dumps([
            ['猫', 'ねこ', '', '', 0, [{'type': 'structured-content', 'content': {'tag': 'span', 'content': [
                {'tag': 'b', 'content': 'A household cat. '}, '<script>text, not executable HTML</script> ' + 'Long definition. ' * 800]}}], 1, ''],
            ['学校', 'がっこう', '', '', 0, ['school'], 2, ''],
            ['食べる', 'たべる', '', 'v1', 0, ['to eat'], 3, '']
        ], ensure_ascii=False))
    return output.getvalue()


class UnifiedSearch(ProductJourneyBase):
    def filter(self, name):
        button = self.page.get_by_role('navigation', name='Search result type').get_by_role('button', name=name, exact=True)
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')

    def test_real_local_dictionary_uses_raw_input_and_bounded_previews(self):
        self.import_book('Neko field guide', body='<p>neko ねこ 猫</p>')
        field = self.library_search('neko')
        filters = self.page.get_by_role('navigation', name='Search result type')
        self.assertEqual(['All', 'Dictionary', 'Titles', 'Content'], filters.get_by_role('button').all_text_contents())
        expect(filters.get_by_role('button', name='All', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(self.page.get_by_role('button', name='Read Neko field guide', exact=True)).to_be_visible()
        self.filter('Dictionary')
        expect(self.page.get_by_text('No enabled local dictionary yet.', exact=False)).to_be_visible(timeout=30000)
        self.page.get_by_label('Import dictionary ZIP', exact=True).set_input_files({
            'name': 'unified-fixture.zip', 'mimeType': 'application/zip', 'buffer': dictionary_archive()})
        expect(self.page.get_by_text('Installed Unified search fixture.', exact=True)).to_be_visible(timeout=60000)
        full = self.page.locator('.full-dictionary')
        expect(full.locator('.headword')).to_contain_text('猫')
        expect(full.locator('script, iframe')).to_have_count(0)
        self.assertGreater(len(full.inner_text()), 10000)
        expect(field).to_have_value('neko')
        field.fill('gakkou')
        expect(full.locator('.headword')).to_contain_text('学校')
        expect(field).to_have_value('gakkou')
        expect(field).to_be_focused()
        field.fill('tabemashita')
        expect(full.locator('.headword')).to_contain_text('食べる')
        field.fill('neko')
        expect(full.locator('.headword')).to_contain_text('猫')
        self.filter('All')
        preview = self.page.get_by_role('list', name='Dictionary previews')
        expect(preview.get_by_role('button')).to_have_count(1)
        self.assertLess(len(preview.inner_text()), 600)
        expect(full).to_have_count(0)
        expect(field).to_have_value('neko')
        expect(self.page.get_by_role('button', name='Read Neko field guide', exact=True)).to_be_visible()
        expect(self.page.locator('button.passage')).to_have_count(1)
        self.checkpoint('unified-all-real-dictionary')
        self.page.set_viewport_size({'width': 360, 'height': 740})
        self.assertTrue(self.page.locator('.unified-search').evaluate('e => e.scrollWidth <= e.clientWidth + 1'))
        self.checkpoint('unified-mobile-preview')

    def test_dictionary_asset_failure_does_not_block_titles_or_passages(self):
        for index in range(3):
            self.import_book(f'猫 guide {index}', body=f'<p>猫 passage {index}</p>')
        self.page.route('**/manabitan/*/manifest.json', lambda route: route.abort())
        field = self.library_search('猫')
        expect(self.page.get_by_role('button', name='Retry dictionary', exact=True)).to_be_visible()
        expect(self.page.locator('[data-search-row="titles"]')).to_have_count(2)
        expect(self.page.locator('[data-search-row="content"]')).to_have_count(2)
        expect(field).to_have_value('猫')
        self.page.get_by_role('button', name='See all titles', exact=True).click()
        expect(self.page.locator('[data-search-row="titles"]')).to_have_count(3)
        expect(self.page.get_by_role('button', name='Titles', exact=True)).to_be_focused()
        self.filter('Content')
        expect(self.page.locator('[data-search-row="content"]')).to_have_count(3)
        self.page.get_by_role('button', name='Open passage in 猫 guide 2: 猫', exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('.book-content').first).to_contain_text('猫 passage 2')
        self.checkpoint('unified-independent-content-navigation')

    def test_library_scope_switches_books_and_snippets_without_losing_query(self):
        self.import_book('Scope book', body='<p>SCOPE_TOKEN book body</p>')
        self.page.goto(re.sub(r'/manage(?:[?#].*)?        self.import_book('Live search ownership', body='<p>猫</p><p>犬</p>')
        field = self.library_search('猫')
        self.filter('Content')
        expect(self.page.locator('button.passage mark')).to_have_text('猫')
        field.fill('猫')
        field.fill('犬')
        expect(self.page.locator('button.passage mark')).to_have_text('犬')
        expect(field).to_be_focused()
        expect(self.page.locator('button.passage')).to_have_count(1)
        self.checkpoint('unified-latest-query')


if __name__ == '__main__':
    unittest.main(verbosity=2)
, '/snippets', self.page.url))
        expect(self.page.get_by_role('button', name='New snippet', exact=True)).to_be_enabled()
        self.page.get_by_role('button', name='New snippet', exact=True).click()
        self.page.get_by_role('textbox', name='Snippet text', exact=True).fill(
            'SCOPE_TOKEN snippet body')
        self.page.get_by_role('textbox', name='Snippet title', exact=True).fill('Scope snippet')
        self.page.get_by_role('button', name='Save snippet', exact=True).click()
        device = self.page.get_by_role('button', name='Keep on this device only', exact=True)
        if device.is_visible():
            device.click()
            self.page.get_by_role('button', name='Save snippet', exact=True).click()
        expect(self.page.get_by_role('article', name='Snippet content')).to_be_visible()

        self.go_library()
        field = self.library_search('SCOPE_TOKEN')
        result_types = self.page.get_by_role('navigation', name='Search result type')
        scopes = self.page.get_by_role('navigation', name='Search library scope')
        self.assertEqual(
            ['Everything', 'Books', 'Snippets'],
            scopes.get_by_role('button').all_text_contents())
        expect(scopes.get_by_role('button', name='Everything', exact=True)).to_have_attribute(
            'aria-pressed', 'true')
        self.filter('Content')
        rows = self.page.locator('[data-search-row="content"] small')
        expect(rows).to_have_count(2)
        self.assertTrue(any('Book · Scope book' in value for value in rows.all_text_contents()))
        self.assertTrue(any('Snippet · Scope snippet' in value for value in rows.all_text_contents()))

        scopes.get_by_role('button', name='Books', exact=True).click()
        expect(scopes.get_by_role('button', name='Books', exact=True)).to_have_attribute(
            'aria-pressed', 'true')
        expect(field).to_have_value('SCOPE_TOKEN')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_have_count(0)
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text('Book · Scope book')

        scopes.get_by_role('button', name='Snippets', exact=True).click()
        expect(field).to_have_value('SCOPE_TOKEN')
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text('Snippet · Scope snippet')

        scopes.get_by_role('button', name='Everything', exact=True).click()
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_be_visible()
        expect(rows).to_have_count(2)
        self.checkpoint('unified-library-scope-switching')

    def test_new_query_owns_content_and_searchbox_focus(self):
        self.import_book('Live search ownership', body='<p>猫</p><p>犬</p>')
        field = self.library_search('猫')
        self.filter('Content')
        expect(self.page.locator('button.passage mark')).to_have_text('猫')
        field.fill('猫')
        field.fill('犬')
        expect(self.page.locator('button.passage mark')).to_have_text('犬')
        expect(field).to_be_focused()
        expect(self.page.locator('button.passage')).to_have_count(1)
        self.checkpoint('unified-latest-query')


if __name__ == '__main__':
    unittest.main(verbosity=2)
