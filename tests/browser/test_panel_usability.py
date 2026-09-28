"""Custom-panel focus, occlusion, and calendar geometry in the built application."""
import unittest
from pathlib import Path
from playwright.sync_api import expect
from test_books_library import LibraryBase


class PanelUsabilityBrowser(LibraryBase):
    def frames(self):
        self.page.evaluate('''() => new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)))''')

    def seed_statistics(self):
        self.page.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('books');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction('statistic', 'readwrite');
              for (let i = 0; i < 61; i++) tx.objectStore('statistic').put({
                title: 'Panel title ' + String(i).padStart(3, '0'),
                dateKey: '2026-09-25', readingTime: 60, charactersRead: 25,
                minReadingSpeed: 1500, altMinReadingSpeed: 1500, lastReadingSpeed: 1500,
                maxReadingSpeed: 1500, lastStatisticModified: 100
              });
              tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
            });
          } finally { db.close(); }
        }''')

    def statistics(self):
        self.page.goto(self.origin + '/reader-web/statistics')
        expect(self.page.get_by_role('button', name='Filter books', exact=True)).to_be_enabled()
        self.frames()

    def heatmap(self):
        self.statistics()
        self.page.get_by_role('button', name='Heatmap', exact=True).click()
        grid = self.page.locator('.heatmap-calendar').first
        expect(grid).to_be_visible()
        return grid

    def capture(self, name):
        Path('test-results').mkdir(exist_ok=True)
        self.page.screenshot(path=f'test-results/{self.engine}-panel-{name}.png', full_page=True)

    def assert_unoccluded(self, control):
        # IntersectionObserver visibility alone accepts a control covered by
        # sticky chrome. Require the actual hit-test at its center instead.
        self.page.wait_for_function('''e => {
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight &&
            hit && (hit === e || e.contains(hit));
        }''', arg=control.element_handle())

    def test_heatmap_popup_close_has_its_own_space_and_restores_day_focus(self):
        self.seed_statistics()
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            grid = self.heatmap()
            self.page.set_viewport_size({'width': 320, 'height': 568})
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')
            day = grid.locator('[data-date="2026-09-25"]')
            day.focus()
            day.press('Enter')
            panel = self.page.get_by_role('dialog', name='Reading day details', exact=True)
            expect(panel).to_be_visible()
            close = panel.get_by_role('button', name='Close heatmap details', exact=True)
            expect(close).to_have_attribute('data-modal-dismiss', '')
            heading = panel.get_by_role('heading', name='2026-09-25', exact=True)
            self.frames()
            h, c = heading.bounding_box(), close.bounding_box()
            self.assertGreaterEqual(c['width'], 43.99)
            self.assertGreaterEqual(c['height'], 43.99)
            self.assertLessEqual(h['x'] + h['width'], c['x'] + 1)
            self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
            self.assert_unoccluded(close)
            self.capture(f'heatmap-details-{mode}-200')
            self.page.keyboard.press('Escape')
            expect(panel).to_have_count(0)
            expect(day).to_be_focused()
            day.press('Space')
            expect(panel).to_be_visible()
            close.click()
            expect(panel).to_have_count(0)
            expect(day).to_be_focused()

    def test_heatmap_arrow_navigation_has_one_tab_stop_and_native_activation(self):
        self.seed_statistics()
        grid = self.heatmap()
        day = grid.locator('[data-date="2026-09-25"]')
        day.focus()
        expect(grid.locator('button[tabindex="0"]')).to_have_count(1)
        self.page.keyboard.press('ArrowRight')
        expect(grid.locator('[data-date="2026-10-02"]')).to_be_focused()
        self.page.keyboard.press('ArrowDown')
        expect(grid.locator('[data-date="2026-10-03"]')).to_be_focused()
        self.page.keyboard.press('ArrowLeft')
        expect(grid.locator('[data-date="2026-09-26"]')).to_be_focused()
        self.page.keyboard.press('Control+End')
        expect(grid.locator('[data-date="2026-12-31"]')).to_be_focused()
        self.page.keyboard.press('ArrowDown')
        expect(grid.locator('[data-date="2026-12-31"]')).to_be_focused()
        self.page.keyboard.press('Control+Home')
        expect(grid.locator('[data-date="2026-01-01"]')).to_be_focused()
        expect(grid.locator('button[tabindex="0"]')).to_have_count(1)
        self.page.keyboard.press('Tab')
        self.assertFalse(grid.evaluate('e => e.contains(document.activeElement)'))

    def test_repeated_heatmap_activation_stays_open_and_period_change_dismisses(self):
        self.seed_statistics()
        grid = self.heatmap()
        day = grid.locator('[data-date="2026-09-25"]')
        # Same-turn activation exercises the queued-open race, using the real
        # native button handler, not a fabricated popover or reply.
        day.evaluate('e => { e.click(); e.click(); }')
        panel = self.page.get_by_role('dialog', name='Reading day details', exact=True)
        expect(panel).to_be_visible()
        expect(panel.get_by_role('heading', name='2026-09-25', exact=True)).to_be_visible()
        # This second activation happens after the popup is open. A toggle-only
        # implementation would incorrectly close it despite the same-turn fence.
        day.evaluate('e => e.click()')
        expect(panel).to_be_visible()
        other = grid.locator('[data-date="2026-09-26"]')
        other.evaluate('e => e.click()')
        expect(panel.get_by_role('heading', name='2026-09-26', exact=True)).to_be_visible()
        self.capture('heatmap-retargeted-details')
        # Exercise the real period handler while the popup is open, without
        # explicitly closing it first or relying on an outside-pointer dismissal.
        grid.evaluate('e => { e.scrollLeft = 0; }')
        previous = self.page.get_by_role('button', name='Previous heatmap period', exact=True).first
        previous.evaluate('e => e.click()')
        expect(grid.locator('[data-date="2025-01-01"]')).to_have_count(1)
        expect(panel).to_have_count(0)
        expect(grid.locator('button[tabindex="0"]')).to_have_count(1)
        # A pending day-open must not outlive the same-turn year change either.
        self.page.evaluate('''() => {
          document.querySelector('.heatmap-calendar [data-date="2025-09-25"]').click();
          document.querySelector('[aria-label="Previous heatmap period"]').click();
        }''')
        self.frames()
        expect(grid.locator('[data-date="2024-01-01"]')).to_have_count(1)
        expect(panel).to_have_count(0)

    def test_heatmap_cells_shrink_and_month_columns_follow_the_new_calendar(self):
        self.seed_statistics()
        self.page.set_viewport_size({'width': 2400, 'height': 1000})
        grid = self.heatmap()
        day = grid.locator('[data-date="2026-09-01"]')
        self.frames()
        large = day.bounding_box()['width']
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.wait_for_function('e => e.getBoundingClientRect().width <= 15.1', arg=day.element_handle())
        self.assertGreater(large, day.bounding_box()['width'])
        grid.evaluate('e => { e.scrollLeft = 0; }')
        self.page.get_by_role('button', name='Previous heatmap period', exact=True).first.click()
        expect(grid.locator('[data-date="2025-01-01"]')).to_have_count(1)
        for month, label in ((1, 'Jan'), (2, 'Feb'), (9, 'Sep'), (12, 'Dec')):
            first = grid.locator(f'[data-date="2025-{month:02d}-01"]')
            expected = first.evaluate('e => parseInt(getComputedStyle(e).gridColumnStart) + 1')
            actual = grid.get_by_text(label, exact=True).evaluate('e => parseInt(getComputedStyle(e).gridColumnStart)')
            self.assertEqual(expected, actual)

    def test_filter_page_focus_is_not_under_sticky_header_or_footer(self):
        self.seed_statistics()
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.statistics()
        self.page.get_by_role('button', name='Filter books', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        expect(panel.locator('.filter-panel')).to_have_attribute('data-sticky-chrome', 'true')
        panel.get_by_role('button', name='Next', exact=True).click()
        first = panel.get_by_role('checkbox').first
        expect(first).to_be_focused()
        self.assert_unoccluded(first)
        last = panel.get_by_role('checkbox').last
        last.focus()
        self.assert_unoccluded(last)
        self.assert_unoccluded(panel.get_by_role('button', name='Apply Filter', exact=True))
        self.capture('filter-pinned-actions')

    def test_short_enlarged_filter_uses_flow_and_keeps_controls_clickable(self):
        self.seed_statistics()
        self.statistics()
        self.page.get_by_role('button', name='Filter books', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        expect(panel.locator('.filter-panel')).to_have_attribute('data-sticky-chrome', 'false')
        first = panel.get_by_role('checkbox').first
        first.focus()
        self.assert_unoccluded(first)
        first.uncheck()
        cancel = panel.get_by_role('button', name='Cancel', exact=True)
        cancel.focus()
        self.assert_unoccluded(cancel)
        self.capture('filter-short-enlarged')
        cancel.click()
        expect(panel).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
