"""Offline and sync status stays inside navigation in the real web app."""
from pathlib import Path
import unittest
from playwright.sync_api import expect
from test_books_library import LibraryBase
from test_static_reader import StaticHandler


class LibraryNoticesBrowser(LibraryBase):
    touch = True

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            StaticHandler.account_fixture = None
            StaticHandler.account_requests = []
            StaticHandler.personal_enabled = False
            StaticHandler.personal_mutations = []

    def test_offline_and_sync_notices_reflow_without_hiding_text_or_actions(self):
        # Real imports with ambiguous legacy history make the existing sync
        # service publish attention. No runtime-store or DOM status injection.
        self.import_book('Ambiguous history', color=(100, 55, 45))
        self.import_book('Ambiguous history', color=(45, 100, 55))
        expect(self.page.get_by_role('button', name='Read Ambiguous history', exact=True)).to_have_count(2)
        for row in self.stores('books', ['data'])['data']:
            self.page.goto(self.origin + '/reader-web/b?id=' + str(row['id']))
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.page.evaluate('''() => new Promise((resolve, reject) => {
          const request = indexedDB.open('books');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('statistic', 'readwrite');
            tx.objectStore('statistic').put({title: 'Ambiguous history', dateKey: '2026-09-19',
              charactersRead: 9, readingTime: 100, minReadingSpeed: 1, altMinReadingSpeed: 1,
              lastReadingSpeed: 1, maxReadingSpeed: 1, lastStatisticModified: 100});
            tx.oncomplete = () => {db.close(); resolve();};
            tx.onabort = () => {db.close(); reject(tx.error);};
          };
        })''')
        StaticHandler.personal_enabled = True
        StaticHandler.account_fixture = {
            'user': {'id': '42', 'username': 'notice-reader'},
            'csrf_token': 'c' * 64, 'providers': []
        }
        self.page.goto(self.origin + '/reader-web/connections')
        expect(self.page.locator('section[aria-labelledby="reading-sync-heading"] [role="status"]')).to_contain_text(
            'older same-title statistics record', timeout=15000)
        self.go_library()
        sync = self.page.get_by_role('link', name='Review accounts and libraries', exact=True)
        review = self.page.get_by_role('button', name='Review sync. Connection details', exact=True)
        notice = self.page.get_by_role('button', name='Offline. Connection details', exact=True)
        expect(review).to_be_visible()
        expect(sync).to_have_count(0)
        expect(notice).to_have_count(0)
        before = self.stores('books', ['data', 'statistic', 'bookmark'])
        self.context.set_offline(True)
        expect(notice).to_be_visible()
        for width, height, scale, mode in [(1200, 900, 100, 'light'), (390, 700, 100, 'dark'),
                                           (320, 568, 200, 'light'), (320, 320, 200, 'dark')]:
            with self.subTest(width=width, height=height, scale=scale, mode=mode):
                self.page.get_by_role('heading', name='Manabi Reader', exact=True).click()
                self.page.mouse.move(0, height - 1)
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.emulate_media(color_scheme=mode)
                self.page.evaluate('scale => document.documentElement.style.fontSize = scale + "%"', scale)
                # Status belongs to the toolbar; no floating notice or separate warning.
                self.assertTrue(notice.evaluate("e => !!e.closest('header[aria-label=\"Library toolbar\"]')"))
                expect(self.page.locator('.connection-notice-dock')).to_have_count(0)
                expect(review).to_have_count(0)
                expect(sync).to_have_count(0)
                notice.scroll_into_view_if_needed()
                box = notice.bounding_box()
                self.assertGreaterEqual(box['height'], 44)
                self.assertGreaterEqual(box['x'], 0)
                self.assertGreaterEqual(box['y'], 0)
                self.assertLessEqual(box['x'] + box['width'], width + 1)
                self.assertLessEqual(box['y'] + box['height'], height + 1)
                self.assertTrue(notice.evaluate('''e => {
                  const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                  return !!hit && (e === hit || e.contains(hit));
                }'''))
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
                output = Path('test-results'); output.mkdir(exist_ok=True)
                self.page.screenshot(path=str(output / f'connection-notices-{self.engine}-{width}-{height}-{scale}-{mode}.png'))
                notice.tap()
                dialog = self.page.get_by_role('dialog', name='Reading on this device', exact=True)
                expect(dialog).to_be_visible()
                expect(dialog).to_contain_text('Reading progress is saved on this device')
                expect(dialog).to_contain_text('Reading sync needs attention')
                expect(sync).to_be_visible()
                self.page.keyboard.press('Escape')
                expect(dialog).to_have_count(0)
                expect(notice).to_be_focused()
        self.assertEqual(before, self.stores('books', ['data', 'statistic', 'bookmark']))
        self.page.set_viewport_size({'width': 390, 'height': 700})
        self.page.evaluate('document.documentElement.style.fontSize = "100%"')
        self.context.set_offline(False)
        expect(review).to_be_visible()
        review.click()
        expect(sync).to_be_visible()
        sync.focus()
        sync.press('Enter')
        expect(self.page.get_by_role('heading', name='Accounts and libraries', exact=True)).to_be_visible()
        expect(sync).to_have_count(0)
        expect(notice).to_have_count(0)
        self.assertEqual(before, self.stores('books', ['data', 'statistic', 'bookmark']))
        # Reader status stays inside the toolbar, including enlarged text.
        self.go_library()
        self.page.get_by_role('button', name='Read Ambiguous history', exact=True).first.click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false', timeout=35000)
        self.context.set_offline(True)
        for width, scale in [(390, 100), (320, 200)]:
            self.page.set_viewport_size({'width': width, 'height': 700})
            self.page.evaluate('scale => document.documentElement.style.fontSize = scale + "%"', scale)
            expect(notice).to_be_visible()
            self.assertTrue(notice.evaluate("e => !!e.closest('header[aria-label=\"Reader toolbar\"]')"))
            self.assertTrue(notice.evaluate("e => {const r=e.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.height >= 44}"))
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
            self.page.screenshot(path=str(Path('test-results') / f'connection-reader-{self.engine}-{width}-{scale}.png'))
            notice.tap()
            expect(self.page.get_by_role('dialog', name='Reading on this device', exact=True)).to_be_visible()
            self.page.keyboard.press('Escape')
            expect(notice).to_be_focused()
        self.page.set_viewport_size({'width': 320, 'height': 700})
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Settings', exact=True).click()
        settings_title = self.page.get_by_role('heading', name='Settings', exact=True)
        expect(settings_title).to_be_visible()
        self.assertEqual(settings_title.evaluate('e => { const r=document.createRange(); r.selectNodeContents(e); return r.getClientRects().length; }'), 1)
        expect(notice).to_be_visible()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
        self.page.screenshot(path=str(Path('test-results') / f'connection-settings-{self.engine}-320-200.png'))



if __name__ == '__main__':
    unittest.main()
