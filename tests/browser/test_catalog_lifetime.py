"""Optional catalog requests must belong to an active mounted document."""
import threading
import unittest
from playwright.sync_api import expect
import test_editors_picks as picks


class CatalogDocumentLifetime(picks.EditorsPicksBrowser):
    def test_hidden_initial_mount_defers_catalog_until_the_document_is_visible(self):
        # Simulate lifecycle state only. HTTP, Svelte mounting and native fetch
        # are real; a renderer mock cannot exercise the queued onMount boundary.
        self.context.add_init_script("""(() => {
          window.catalogDocumentVisible = false;
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => window.catalogDocumentVisible ? 'visible' : 'hidden'
          });
          window.catalogFetches = [];
          const original = window.fetch;
          window.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : input.url;
            if (url?.includes('/static/reader/books/opds/')) window.catalogFetches.push(url);
            return original.apply(this, arguments);
          };
        })()""")
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        # Flush queued onMount callbacks, rather than checking prerendered HTML.
        self.page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        self.assertEqual([], self.page.evaluate('window.catalogFetches'))
        self.assertFalse(picks.PicksHandler.requests)
        self.page.evaluate("""() => {
          window.catalogDocumentVisible = true;
          document.dispatchEvent(new Event('visibilitychange'));
        }""")
        expect(self.page.get_by_role('region', name="Editor's Picks books")).to_be_visible()
        self.assertEqual(2, len(self.page.evaluate('window.catalogFetches')))

    def test_pagehide_aborts_catalog_and_pageshow_restarts_the_same_component(self):
        picks.PicksHandler.index_started = threading.Event()
        picks.PicksHandler.index_gate = threading.Event()
        self.page.goto(self.origin + '/reader-web/manage')
        self.assertTrue(picks.PicksHandler.index_started.wait(timeout=5))
        with self.page.expect_event('requestfailed', predicate=lambda request: request.url.endswith('/opds/index.xml')):
            self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}))")
        self.page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        self.assertEqual(1, len(picks.PicksHandler.requests))
        picks.PicksHandler.index_gate.set()
        self.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
        expect(self.page.get_by_role('region', name="Editor's Picks books")).to_be_visible()
        self.assertEqual(2, picks.PicksHandler.requests.count('/static/reader/books/opds/index.xml'))
        self.assertEqual(1, picks.PicksHandler.requests.count('/static/reader/books/opds/feeds/all.xml'))



def load_tests(loader, tests, pattern):
    return unittest.TestSuite(CatalogDocumentLifetime(name) for name in CatalogDocumentLifetime.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
