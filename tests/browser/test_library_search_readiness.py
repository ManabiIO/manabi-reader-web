"""Genuine server-rendered and hydrated Library search controls."""
from playwright.sync_api import expect
from test_books_library import LibraryBase


class LibrarySearchReadiness(LibraryBase):
    def test_unhydrated_search_is_disabled_and_hydrated_input_keeps_the_query(self):
        # No interception or substitute application: disable JavaScript only in
        # this separate context to inspect the actual server-rendered control.
        static_context = self.context.browser.new_context(java_script_enabled=False)
        try:
            static_page = static_context.new_page()
            static_page.goto(self.origin + '/reader-web/manage')
            expect(static_page.get_by_role('searchbox', name='Search library', exact=True)).to_be_disabled()
        finally:
            static_context.close()
        self.import_book('Hydration search')
        field = self.page.get_by_role('searchbox', name='Search library', exact=True)
        field.fill('Hydration')
        expect(field).to_have_value('Hydration')
        expect(self.page.get_by_role('button', name='Read Hydration search', exact=True)).to_be_visible()
