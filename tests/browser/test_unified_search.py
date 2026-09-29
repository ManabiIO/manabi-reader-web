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
        button = self.page.get_by_role('navigation', name='Search result type').get_by_role(
            'button', name=name, exact=True)
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')
        return button

    def scope(self, name):
        button = self.page.get_by_role('navigation', name='Search library scope').get_by_role(
            'button', name=name, exact=True)
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')
        expect(button).to_be_focused()
        return button

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

    def test_library_scope_switches_real_books_and_snippets_without_losing_query(self):
        self.import_book('Scope book', body='<p>SCOPE_TOKEN book body</p>')
        self.page.goto(self.origin + '/reader-web/snippets')
        create = self.page.get_by_role('button', name='New snippet', exact=True)
        expect(create).to_be_enabled()
        create.click()
        editor = self.page.locator('.editor-host [contenteditable="true"]')
        expect(editor).to_be_editable(timeout=30000)
        self.page.get_by_label('Snippet title', exact=True).fill('Scope snippet')
        editor.fill('SCOPE_TOKEN snippet body')

        save = self.page.get_by_role('button', name='Save snippet', exact=True)
        save.click()
        picker = self.page.get_by_role('dialog', name='Save location', exact=True)
        expect(picker).to_be_visible()
        picker.get_by_role('button', name='Keep on this device only', exact=True).click()
        expect(picker).to_have_count(0)
        save.click()
        snippet = self.page.get_by_role('article', name='Snippet content', exact=True)
        expect(snippet).to_contain_text('SCOPE_TOKEN snippet body')
        expect(self.page.get_by_role('heading', name='Scope snippet', exact=True)).to_be_visible()

        self.go_library()
        field = self.library_search('SCOPE_TOKEN')
        scopes = self.page.get_by_role('navigation', name='Search library scope')
        result_types = self.page.get_by_role('navigation', name='Search result type')
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

        self.scope('Books')
        expect(field).to_have_value('SCOPE_TOKEN')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_have_count(0)
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text('Book · Scope book')

        self.scope('Snippets')
        expect(field).to_have_value('SCOPE_TOKEN')
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text('Snippet · Scope snippet')

        self.scope('Everything')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_be_visible()
        expect(rows).to_have_count(2)

        self.filter('Dictionary')
        self.scope('Books')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_have_count(0)
        expect(result_types.get_by_role('button', name='All', exact=True)).to_have_attribute(
            'aria-pressed', 'true')
        expect(field).to_have_value('SCOPE_TOKEN')
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

    def test_dictionary_query_limit_counts_unicode_characters_and_recovers(self):
        field = self.library_search('𠮷' * 256)
        self.filter('Dictionary')
        # 256 supplementary-plane characters are 512 UTF-16 code units but
        # must still be accepted as 256 user-visible search characters.
        expect(self.page.get_by_text(
            'Use a dictionary query of 256 characters or fewer.', exact=False
        )).to_have_count(0)
        field.fill('𠮷' * 257)
        expect(self.page.get_by_text(
            'Use a dictionary query of 256 characters or fewer.', exact=False
        )).to_be_visible()
        field.fill('猫')
        expect(self.page.get_by_text(
            'Use a dictionary query of 256 characters or fewer.', exact=False
        )).to_have_count(0)
        self.checkpoint('dictionary-unicode-limit-recovered')

    def test_unified_search_reflows_at_200_percent_text_on_short_phone(self):
        self.import_book(
            'とても長い日本語の検索結果タイトルと読書ガイド',
            body='<p>検索対象の猫についてのとても長い本文です。</p>' * 40
        )
        self.page.set_viewport_size({'width': 320, 'height': 480})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        field = self.library_search('猫')
        self.assertGreaterEqual(field.bounding_box()['width'], 64)
        results = self.page.get_by_label('Library search results', exact=True)
        expect(results).to_be_visible()
        self.assertLessEqual(results.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        self.assertLessEqual(
            self.page.evaluate('document.documentElement.scrollWidth-innerWidth'), 1)

        controls = results.locator('.search-controls')
        self.assertEqual('static', controls.evaluate('e => getComputedStyle(e).position'))
        scopes = self.page.get_by_role('navigation', name='Search library scope')
        filters = self.page.get_by_role('navigation', name='Search result type')
        for nav, names in (
            (scopes, ('Everything', 'Books', 'Snippets')),
            (filters, ('All', 'Dictionary', 'Titles', 'Content')),
        ):
            for name in names:
                button = nav.get_by_role('button', name=name, exact=True)
                box = button.bounding_box()
                self.assertGreaterEqual(box['height'], 43.99)
                self.assertGreaterEqual(box['x'], -1)
                self.assertLessEqual(box['x'] + box['width'], 321)

        icon = results.locator('.type-icon').first
        expect(icon).to_be_visible()
        self.assertLessEqual(icon.bounding_box()['width'], 41)
        self.filter('Content')
        passages = self.page.locator('[data-search-row="content"]')
        expect(passages.first).to_be_visible()
        expect(self.page.get_by_text('Searching saved content…', exact=True)).to_have_count(
            0, timeout=30000)
        self.assertGreaterEqual(passages.count(), 10)
        passages.last.scroll_into_view_if_needed()
        self.assertTrue(passages.last.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))
        self.checkpoint('unified-200-percent-short-phone')

        # On a normal-height viewport the two control rows may stick, but must
        # act as one stack below the Library toolbar rather than overlap at top:0.
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.evaluate('document.documentElement.style.fontSize = "100%"')
        passages.last.scroll_into_view_if_needed()
        self.page.wait_for_timeout(50)
        toolbar = self.page.get_by_role('banner', name='Library toolbar', exact=True)
        control_box = controls.bounding_box()
        toolbar_box = toolbar.bounding_box()
        scope_box = scopes.bounding_box()
        filter_box = filters.bounding_box()
        self.assertGreaterEqual(
            control_box['y'], toolbar_box['y'] + toolbar_box['height'] - 1)
        self.assertLessEqual(
            scope_box['y'] + scope_box['height'], filter_box['y'] + 1)
        self.assertLessEqual(control_box['y'] + control_box['height'], 845)
        self.checkpoint('unified-sticky-control-stack')

        field.focus()
        expect(field).to_be_focused()

if __name__ == '__main__':
    unittest.main(verbosity=2)
