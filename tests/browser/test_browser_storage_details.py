"""Built Settings storage observations and non-destructive permission feedback.

The controlled case replaces only the three browser StorageManager observations;
IndexedDB, book import, production UI and the native offline shell remain real.
"""
import unittest
from pathlib import Path
from playwright.sync_api import expect
from test_books_library import LibraryBase
from reader_fixture import reader_fixture


class BrowserStorageDetails(LibraryBase):
    def settings(self):
        self.page.goto(self.origin + reader_fixture('/reader-web/settings#library'))
        card = self.page.locator('[data-setting="persistent-storage"]')
        expect(card.get_by_role('heading', name='Storage on this device')).to_be_visible()
        expect(card.get_by_test_id('browser-storage-details')).to_have_attribute('aria-busy', 'false')
        expect(card.get_by_role('button', name='Refresh storage details')).to_be_enabled()
        return card

    def assert_reachable(self, button):
        button.scroll_into_view_if_needed()
        box = button.bounding_box()
        self.assertGreaterEqual(box['height'], 43.99)
        self.assertGreaterEqual(box['x'], -1)
        self.assertLessEqual(box['x'] + box['width'], self.page.viewport_size['width'] + 1)
        self.assertTrue(button.evaluate('''e => {
            const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return e===hit || e.contains(hit);
        }'''))

    def test_actual_browser_status_reflows_and_refresh_preserves_local_books(self):
        self.import_book('Local storage preservation')
        before = self.stores('books', ['data', 'bookmark', 'statistic'])
        card = self.settings()
        expect(card.get_by_text('Site storage estimate', exact=True)).to_be_visible()
        expect(card.get_by_text('Includes other apps on this site.', exact=False)).to_be_visible()
        refresh = card.get_by_role('button', name='Refresh storage details', exact=True)
        for mode in ('light', 'dark'):
            self.page.emulate_media(color_scheme=mode)
            self.page.wait_for_function('mode => getComputedStyle(document.documentElement).colorScheme === mode', arg=mode)
            for width, scale in ((320, 200), (390, 100), (1200, 100), (1200, 200)):
                self.page.set_viewport_size({'width': width, 'height': 900})
                self.page.evaluate('scale => document.documentElement.style.fontSize=scale+"%"', scale)
                self.assert_reachable(refresh)
                self.assertLessEqual(card.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth-innerWidth'), 1)
                output = Path('test-results')
                output.mkdir(exist_ok=True)
                card.evaluate('e => e.scrollIntoView({block:"start"})')
                self.page.evaluate('window.scrollBy(0,-80)')
                card.screenshot(path=str(output / f'{self.engine}-storage-{mode}-{width}-{scale}.png'))
        refresh.click()
        expect(card.get_by_test_id('browser-storage-details')).to_have_attribute('aria-busy', 'false')
        expect(refresh).to_be_enabled()
        expect(refresh).to_be_focused()
        self.assertEqual(before, self.stores('books', ['data', 'bookmark', 'statistic']))

    def test_denied_then_granted_protection_is_explicit_and_preserves_data(self):
        self.import_book('Permission feedback preservation')
        before = self.stores('books', ['data', 'bookmark', 'statistic'])
        self.context.add_init_script('''(() => {
            const manager=navigator.storage;
            const fixture=window.storageFixture={requests:0,granted:false,events:[]};
            Object.defineProperties(manager, {
                persisted:{value:async()=>{fixture.events.push('persisted');return fixture.granted;},configurable:true},
                persist:{value:async()=>{
                    const f=fixture;
                    f.events.push('persist');
                    f.requests++;
                    f.granted=f.requests>1;
                    return f.granted;
                },configurable:true},
                estimate:{value:async()=>({usage:125000000,quota:1000000000}),configurable:true}
            });
        })();''')
        card = self.settings()
        expect(card.get_by_test_id('browser-storage-estimate')).to_have_text(
            '125 MB used · 1 GB browser allowance')
        expect(card.get_by_role('progressbar', name='Site storage usage')).to_have_attribute('aria-valuenow', '13')
        request = card.get_by_role('button', name='Request storage protection', exact=True)
        self.assert_reachable(request)
        request.click()
        expect(card.get_by_text('The browser hasn’t granted protection.', exact=False)).to_be_visible()
        self.assertEqual(self.page.evaluate('storageFixture.requests'), 1, self.page.evaluate('storageFixture'))
        self.assertEqual(before, self.stores('books', ['data', 'bookmark', 'statistic']))
        request.click()
        expect(card.get_by_role('status').first).to_have_text('Protected from automatic browser cleanup')
        expect(card.get_by_role('button', name='Request storage protection')).to_have_count(0)
        expect(card.get_by_role('button', name='Refresh storage details')).to_be_focused()
        self.assertEqual(self.page.evaluate('storageFixture.requests'), 2)
        refresh = card.get_by_role('button', name='Refresh storage details', exact=True)
        refresh.click()
        expect(card.get_by_test_id('browser-storage-details')).to_have_attribute('aria-busy', 'false')
        expect(refresh).to_be_enabled()
        expect(refresh).to_be_focused()
        self.assertEqual(self.page.evaluate('storageFixture.requests'), 2)
        self.assertEqual(before, self.stores('books', ['data', 'bookmark', 'statistic']))

    def test_unavailable_storage_observations_do_not_claim_data_was_lost(self):
        self.context.add_init_script('''Object.defineProperty(navigator,'storage',{
            value:undefined,configurable:true
        });''')
        card = self.settings()
        expect(card.get_by_role('status').first).to_have_text(
            'Storage protection isn’t available in this browser')
        expect(card.get_by_test_id('browser-storage-estimate')).to_have_text(
            'This browser hasn’t provided a storage estimate.')
        expect(card.get_by_role('progressbar')).to_have_count(0)
        expect(card.get_by_role('button', name='Request storage protection')).to_have_count(0)
        expect(card.get_by_role('button', name='Refresh storage details')).to_be_enabled()

    def test_pending_request_does_not_repeat_or_steal_focus_from_another_control(self):
        self.context.add_init_script('''(() => {
            window.storageFixture={requests:0};
            Object.defineProperties(navigator.storage, {
                persisted:{value:async()=>false,configurable:true},
                persist:{value:()=>{
                    storageFixture.requests++;
                    return new Promise(resolve=>storageFixture.finish=resolve);
                },configurable:true},
                estimate:{value:async()=>({}),configurable:true}
            });
        })();''')
        card = self.settings()
        request = card.get_by_role('button', name='Request storage protection', exact=True)
        request.click()
        expect(card.get_by_role('status').first).to_have_text('Requesting storage protection…')
        request.click()
        self.assertEqual(self.page.evaluate('storageFixture.requests'), 1)
        search = self.page.get_by_role('searchbox', name='Search settings', exact=True)
        search.focus()
        self.page.evaluate('storageFixture.finish(true)')
        expect(card.get_by_role('status').first).to_have_text('Protected from automatic browser cleanup')
        expect(search).to_be_focused()
        expect(request).to_have_count(0)


if __name__ == "__main__":
    unittest.main()
