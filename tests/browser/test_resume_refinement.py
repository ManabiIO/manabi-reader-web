"""Continuation regressions: text reflow and late catalog operations."""
import re
import threading
import unittest
from playwright.sync_api import expect
import test_deep_control_refinement as deep
import test_editors_picks as picks


class ResumeControlsBrowser(deep.DeepControlRefinementBrowser):
    def test_immediate_menu_arrow_navigation_survives_opening_autofocus(self):
        self.import_book('Immediate keyboard menu')
        self.menu('Immediate keyboard menu', 'Add to Want to Read')
        trigger = self.page.get_by_role('button', name='Actions for Immediate keyboard menu', exact=True)
        for _ in range(12):
            trigger.focus()
            self.page.keyboard.press('Enter')
            menu = self.page.get_by_role('menu')
            first = menu.get_by_role('menuitem').first
            expect(first).to_be_focused()
            first.press('ArrowDown')
            second = menu.get_by_role('menuitem', name='Remove from Want to Read', exact=True)
            expect(second).to_be_focused()
            # Check again after deferred opening work has had time to run.
            self.frames()
            expect(second).to_be_focused()
            self.page.keyboard.press('ArrowUp')
            expect(first).to_be_focused()
            self.page.keyboard.press('Escape')
            expect(menu).to_have_count(0)
            expect(trigger).to_be_focused()

    def test_empty_library_preserves_readable_controls_at_double_text_size(self):
        self.page.set_viewport_size({'width': 320, 'height': 640})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.frames()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
        toolbar = self.page.get_by_role('banner', name='Library toolbar')
        for label in ('Search library', 'Collections', 'Library actions'):
            control = toolbar.get_by_role('button', name=label, exact=True)
            box = control.bounding_box()
            self.assertAlmostEqual(box['width'], 44, delta=0.5, msg=label)
            self.assertGreaterEqual(box['x'], 0)
            self.assertLessEqual(box['x'] + box['width'], 320)
        empty = self.page.locator('[data-slot="library-empty-state"]')
        primary = empty.get_by_role('button', name='Import File(s)', exact=True)
        self.assertGreaterEqual(primary.bounding_box()['width'], 225)
        self.assertGreaterEqual(primary.evaluate('e => parseFloat(getComputedStyle(e).fontSize)'), 28)
        self.assertLessEqual(primary.bounding_box()['height'], 2 * primary.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)') + 36)
        self.capture('empty-library-double-text')
        toolbar.get_by_role('button', name='Collections', exact=True).click()
        self.check_modal(self.page.locator('#library-collections-sheet'))


class CatalogLifetimeBrowser(picks.EditorsPicksBrowser):
    def test_catalog_cards_reflow_at_double_text_size_without_clipping_open(self):
        self.library()
        self.page.set_viewport_size({'width': 320, 'height': 640})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        region = self.page.get_by_role('region', name="Editor's Picks books")
        card = region.locator('article').first
        card.scroll_into_view_if_needed()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
        title = card.locator('h4')
        self.assertGreaterEqual(title.bounding_box()['width'], 140)
        self.assertGreaterEqual(title.evaluate('e => parseFloat(getComputedStyle(e).fontSize)'), 28)
        open_book = card.get_by_role('button', name='Open', exact=True)
        open_book.scroll_into_view_if_needed()
        expect(open_book).to_be_in_viewport()
        bounds = open_book.bounding_box()
        self.assertLessEqual(bounds['x'] + bounds['width'], 320)
        from pathlib import Path
        Path('test-results').mkdir(exist_ok=True)
        self.page.screenshot(path='test-results/' + self.engine + '-catalog-double-text.png')
        open_book.click()
        expect(self.page).to_have_url(re.compile('/Reader-Web/b\\?id='))

    def test_cancel_operation_also_cancels_the_catalog_open_and_allows_retry(self):
        self.library()
        self.page.evaluate('''() => {
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          let calls = 0;
          crypto.subtle.digest = (...args) => {
            // The first digest deduplicates; the second belongs to importData.
            if (++calls !== 2) return digest(...args);
            crypto.subtle.digest = digest;
            return new Promise((resolve, reject) => {
              window.__releaseImportDigest = async () => {
                try { resolve(await digest(...args)); } catch (error) { reject(error); }
              };
            });
          };
        }''')
        region = self.page.get_by_role('region', name="Editor's Picks books")
        region.get_by_role('button', name='Open').first.click()
        self.page.wait_for_function('() => typeof window.__releaseImportDigest === "function"')
        self.page.get_by_role('button', name='Cancel Operation', exact=True).click()
        self.page.evaluate('window.__releaseImportDigest()')
        expect(region.get_by_role('button', name='Open').first).to_be_enabled()
        expect(self.page.get_by_role('dialog')).to_have_count(0)
        expect(self.page).to_have_url(re.compile('/Reader-Web/manage'))
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(0)
        region.get_by_role('button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/Reader-Web/b\\?id='))

    def test_hard_navigation_during_catalog_load_has_no_page_error_and_can_retry(self):
        picks.PicksHandler.index_started = threading.Event()
        picks.PicksHandler.index_gate = threading.Event()
        self.page.goto(self.origin + '/Reader-Web/manage')
        self.assertTrue(picks.PicksHandler.index_started.wait(timeout=5))
        self.page.goto(self.origin + '/Reader-Web/settings')
        expect(self.page.get_by_role('heading', name='Appearance', exact=True)).to_be_visible()
        picks.PicksHandler.index_gate.set()
        self.library()
        expect(self.page.get_by_role('region', name="Editor's Picks books")).to_be_visible()

    def test_leaving_while_book_digest_is_pending_cannot_import_or_navigate_late(self):
        self.library()
        self.page.evaluate('''() => {
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          crypto.subtle.digest = (...args) => {
            crypto.subtle.digest = digest;
            return new Promise((resolve, reject) => {
              window.__releaseCatalogDigest = async () => {
                try { resolve(await digest(...args)); } catch (error) { reject(error); }
              };
            });
          };
        }''')
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role('button', name='Open').first.click()
        self.page.wait_for_function('() => typeof window.__releaseCatalogDigest === "function"')
        # A normal in-app navigation preserves the JS realm so the delayed
        # production digest can complete after its Library component is gone.
        self.page.get_by_role('button', name='Library actions', exact=True).click()
        self.page.get_by_role('menuitem', name='Settings', exact=True).click()
        expect(self.page).to_have_url(re.compile('/Reader-Web/settings'))
        self.page.evaluate('window.__releaseCatalogDigest()')
        self.page.evaluate('() => new Promise(r => setTimeout(r, 200))')
        expect(self.page).to_have_url(re.compile('/Reader-Web/settings'))
        expect(self.page.get_by_role('dialog')).to_have_count(0)
        self.library()
        expect(self.page.get_by_role('button', name='Read A Pick from Manabi')).to_have_count(0)
        # Genuinely new work after the canceled attempt still imports normally.
        self.page.get_by_role('region', name="Editor's Picks books").get_by_role('button', name='Open').first.click()
        expect(self.page).to_have_url(re.compile('/Reader-Web/b\\?id='))


if __name__ == '__main__':
    unittest.main(verbosity=2)
