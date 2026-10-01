"""Custom-panel focus, occlusion, and calendar geometry in the built application."""
import re
import unittest
from pathlib import Path
from playwright.sync_api import expect
from reader_controls import reveal_reader_controls
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

    def settle_calendar(self, grid):
        # Keep production motion enabled. Geometry must be measured after the
        # entrance transform, not after an arbitrary number of frames.
        grid.evaluate('''async e => {
          await Promise.all(e.getAnimations({subtree:true})
            .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
            .map(a => a.finished.catch(() => {})));
        }''')
        self.page.wait_for_function('''e => {
          const day = e.querySelector('button[data-date]:not(:disabled)');
          const expected = Math.max(15, Math.floor((e.clientWidth - 56) / 57));
          return day && parseFloat(getComputedStyle(day).width) === expected;
        }''', arg=grid.element_handle())
        self.frames()

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

    def test_tracker_reflows_and_privacy_toggle_is_accessible_at_200_percent_text(self):
        self.page.goto(self.origin + '/reader-web/settings#tracking')
        self.page.get_by_role('switch', name='Enable Statistics', exact=True).check()
        title = 'Tracker panel large text'
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][accept*=".epub"]').first).to_be_attached()
        self.import_book(title)
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        trigger = self.page.get_by_role('button', name='Open reading tracker', exact=True)
        expect(trigger).to_be_visible(timeout=30000)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Reading tracker', exact=True)
        expect(panel).to_be_visible()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.frames()
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)

        metric = panel.locator('[data-tracker-metric]').first
        metric.scroll_into_view_if_needed()
        self.assert_unoccluded(metric)
        self.assertGreaterEqual(metric.bounding_box()['height'], 43.99)
        before = metric.get_attribute('aria-pressed')
        label = metric.get_attribute('aria-label')
        if before == 'true':
            self.assertIn('value hidden', label)
        else:
            self.assertIn('Activate to hide', label)
        metric.click()
        expect(metric).to_have_attribute('aria-pressed', 'false' if before == 'true' else 'true')
        value = metric.locator('[data-tracker-value]')
        if before == 'true':
            expect(value).to_have_attribute('aria-hidden', 'false')
        else:
            expect(value).to_have_attribute('aria-hidden', 'true')

        close = panel.get_by_role('button', name='Close reading tracker', exact=True)
        self.assert_unoccluded(close)
        self.assertGreaterEqual(close.bounding_box()['height'], 43.99)
        self.capture('tracker-large-text')
        close.click()
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_tracker_history_paginates_without_stranding_keyboard_focus(self):
        self.page.goto(self.origin + '/reader-web/settings#tracking')
        self.page.get_by_role('switch', name='Enable Statistics', exact=True).check()
        title = 'Tracker history pagination'
        self.page.goto(self.origin + '/reader-web/manage')
        self.import_book(title)
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')

        trigger = self.page.get_by_role('button', name='Open reading tracker', exact=True)
        expect(trigger).to_be_visible(timeout=30000)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Reading tracker', exact=True)
        expect(panel).to_be_visible()
        # Reader entry starts paused. Toggle the desired post-menu state, then
        # dismiss through the real control so the route resumes the production timer.
        panel.get_by_role('button', name='Resume tracking after closing', exact=True).click()
        panel.get_by_role('button', name='Close reading tracker', exact=True).click()
        expect(panel).to_have_count(0)

        # History is intentionally a real-time runtime feature. Accumulate just
        # over one 15-item page rather than injecting component state or records.
        self.page.wait_for_timeout(18000)

        reveal_reader_controls(self.page)
        trigger = self.page.get_by_role('button', name='Open reading tracker', exact=True)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Reading tracker', exact=True)
        expect(panel).to_be_visible()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.frames()
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth-e.clientWidth'), 1)

        history = panel.get_by_text('Recent History', exact=True)
        history.click()
        rows = panel.locator('[data-tracker-history-item]')
        expect(rows).to_have_count(15)
        first = rows.first
        first.scroll_into_view_if_needed()
        self.assertLessEqual(first.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        expect(first.get_by_text('Time change:', exact=True)).to_be_visible()
        expect(first.get_by_text('Character change:', exact=True)).to_be_visible()
        revert = first.get_by_role('button', name='Revert history item', exact=True)
        self.assertGreaterEqual(revert.bounding_box()['height'], 43.99)
        self.assert_unoccluded(revert)
        state_text = first.locator('.sr-only').all_text_contents()
        self.assertTrue(
            any(value in ('Saved to database', 'Not saved yet') for value in state_text),
            state_text
        )

        previous = panel.get_by_role('button', name='Previous history page', exact=True)
        next_page = panel.get_by_role('button', name='Next history page', exact=True)
        expect(previous).to_be_disabled()
        expect(next_page).to_be_enabled()
        expect(panel.get_by_role('status').filter(has_text='Page 1 of 2')).to_be_visible()
        next_page.focus()
        next_page.press('Enter')
        expect(next_page).to_be_disabled()
        expect(previous).to_be_focused()
        expect(panel.get_by_role('status').filter(has_text='Page 2 of 2')).to_be_visible()
        remaining = rows.count()
        self.assertGreater(remaining, 0)
        self.assertLess(remaining, 15)
        self.assertGreaterEqual(previous.bounding_box()['height'], 43.99)
        self.assert_unoccluded(previous)
        close = panel.get_by_role('button', name='Close reading tracker', exact=True)
        self.assert_unoccluded(close)
        self.assertGreaterEqual(close.bounding_box()['height'], 43.99)
        self.capture('tracker-history-final-page')

        previous.press('Enter')
        expect(previous).to_be_disabled()
        expect(next_page).to_be_focused()
        expect(panel.get_by_role('status').filter(has_text='Page 1 of 2')).to_be_visible()
        expect(rows).to_have_count(15)

        panel.get_by_role('button', name='Close reading tracker', exact=True).click()
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_summary_privacy_targets_and_paging_hold_at_200_percent_text(self):
        self.seed_statistics()
        self.page.evaluate('''() => {
          localStorage.setItem('lastStatisticsTab', 'Summary');
          localStorage.setItem('lastStatisticsRangeTemplate', 'This Year');
          localStorage.setItem('lastPrimaryReadingDataAggregationMode', 'None');
          localStorage.setItem('lastBlurredTrackerItems', '["readingTime"]');
        }''')
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.statistics()
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        summary = self.page.get_by_role('group', name='Statistics view').get_by_role(
            'button', name='Summary', exact=True)
        expect(summary).to_have_attribute('aria-pressed', 'true')

        page_trigger = self.page.get_by_role('button', name=re.compile(r'^PAGE 1 / 61        self.seed_statistics()
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
            expect(day).to_have_attribute('aria-expanded', 'true')
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
            expect(day).to_have_attribute('aria-expanded', 'false')
            expect(day).to_be_focused()
            day.press('Space')
            expect(panel).to_be_visible()
            close.click()
            expect(panel).to_have_count(0)
            expect(day).to_have_attribute('aria-expanded', 'false')
            expect(day).to_be_focused()

    def test_heatmap_outside_pointer_dismissal_keeps_the_new_focus(self):
        self.seed_statistics()
        grid = self.heatmap()
        day = grid.locator('[data-date="2026-09-25"]')
        day.focus()
        day.press('Enter')
        panel = self.page.get_by_role('dialog', name='Reading day details', exact=True)
        expect(panel).to_be_visible()
        # The streak toggle can sit behind the positioned popup. Use a visible
        # toolbar target so this is a real outside pointer interaction.
        target = self.page.get_by_role('button', name='Filter books', exact=True)
        target.click()
        expect(panel).to_have_count(0)
        # Safari does not focus buttons on pointer click. It must at least not
        # restore the dismissed day and steal the user's new destination.
        expect(day).not_to_be_focused()
        expect(day).to_have_attribute('aria-expanded', 'false')

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
        self.settle_calendar(grid)
        large = day.bounding_box()['width']
        self.assertGreater(large, 15)
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.wait_for_function('e => e.getBoundingClientRect().width <= 15.1', arg=day.element_handle())
        self.settle_calendar(grid)
        self.assertGreater(large, day.bounding_box()['width'])
        grid.evaluate('e => { e.scrollLeft = 0; }')
        self.page.get_by_role('button', name='Previous heatmap period', exact=True).first.click()
        expect(grid.locator('[data-date="2025-01-01"]')).to_have_count(1)
        for month, label in ((1, 'Jan'), (2, 'Feb'), (9, 'Sep'), (12, 'Dec')):
            first = grid.locator(f'[data-date="2025-{month:02d}-01"]')
            expected = first.evaluate('e => parseInt(getComputedStyle(e).gridColumnStart) + 1')
            actual = grid.get_by_text(label, exact=True).evaluate('e => parseInt(getComputedStyle(e).gridColumnStart)')
            self.assertEqual(expected, actual)

    def test_enlarged_heatmap_toolbar_does_not_crush_the_year_between_buttons(self):
        self.seed_statistics()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        grid = self.heatmap()
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.settle_calendar(grid)
        heading = self.page.locator('.heatmap-toolbar-label').first
        year = heading.locator('.heatmap-year')
        lines = heading.evaluate('e => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)')
        self.assertLessEqual(lines, 3.1)
        self.assertEqual('nowrap', year.evaluate('e => getComputedStyle(e).whiteSpace'))
        tools = self.page.locator('.heatmap-toolbar-actions').first
        bounds = tools.bounding_box()
        self.assertGreaterEqual(bounds['x'], 0)
        self.assertLessEqual(bounds['x'] + bounds['width'], 321)
        label = heading.bounding_box()
        self.assertGreaterEqual(bounds['y'], label['y'] + label['height'] - 1)
        self.capture('heatmap-enlarged-toolbar')

    def test_filter_page_focus_is_not_under_sticky_header_or_footer(self):
        self.seed_statistics()
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.statistics()
        self.page.get_by_role('button', name='Filter books', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        expect(panel.locator('.filter-panel')).to_have_attribute('data-sticky-chrome', 'true')
        for bar in ('[data-sticky-header]', '[data-sticky-footer]'):
            self.assertEqual('sticky', panel.locator(bar).evaluate('e => getComputedStyle(e).position'))
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
        for bar in ('[data-sticky-header]', '[data-sticky-footer]'):
            self.assertEqual('static', panel.locator(bar).evaluate('e => getComputedStyle(e).position'))
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
))
        expect(page_trigger).to_be_visible()
        self.assertGreaterEqual(page_trigger.bounding_box()['height'], 43.99)
        self.assertLessEqual(
            self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)

        for control in (
            self.page.get_by_role('button', name='Delete row Panel title 000', exact=True),
            self.page.get_by_role('button', name='Edit row Panel title 000', exact=True),
            self.page.get_by_role('button', name='View details for Panel title 000', exact=True),
            self.page.get_by_role('button', name='Sort by Total Time', exact=True),
        ):
            control.scroll_into_view_if_needed()
            self.assertGreaterEqual(control.bounding_box()['height'], 43.99)
            self.assert_unoccluded(control)

        metric = self.page.locator('[data-summary-metric="readingTime"]').first
        metric.scroll_into_view_if_needed()
        self.assertGreaterEqual(metric.bounding_box()['height'], 43.99)
        self.assert_unoccluded(metric)
        expect(metric).to_have_attribute('aria-pressed', 'true')
        hidden_label = metric.get_attribute('aria-label')
        self.assertIn('value hidden', hidden_label)
        self.assertNotIn('1 min', hidden_label)

        # The first activation explicitly reveals the private value instead of
        # leaking it through the detail popover or accessible name.
        metric.focus()
        metric.press('Enter')
        expect(metric).to_have_attribute('aria-pressed', 'false')
        expect(metric).to_have_attribute(
            'aria-label', re.compile(r'Reading time: 1 min\. Activate for details\.'))
        expect(self.page.get_by_role('dialog', name='Statistic details')).to_have_count(0)

        metric.press('Enter')
        details = self.page.get_by_role('dialog', name='Statistic details')
        expect(details).to_be_visible()
        expect(details).to_contain_text('Time: 1 min')
        close = details.get_by_role('button', name='Close statistic details', exact=True)
        self.assertGreaterEqual(close.bounding_box()['height'], 43.99)
        self.assert_unoccluded(close)
        close.press('Enter')
        expect(details).to_have_count(0)
        expect(metric).to_be_focused()

        previous = self.page.get_by_role('button', name='Previous statistics page', exact=True)
        next_page = self.page.get_by_role('button', name='Next statistics page', exact=True)
        expect(previous).to_be_disabled()
        expect(next_page).to_be_enabled()
        self.assertGreaterEqual(previous.bounding_box()['height'], 43.99)
        self.assertGreaterEqual(next_page.bounding_box()['height'], 43.99)

        next_page.focus()
        next_page.press('Enter')
        expect(self.page.get_by_role('button', name='PAGE 2 / 61', exact=True)).to_be_visible()
        expect(next_page).to_be_focused()

        self.page.get_by_role('button', name='PAGE 2 / 61', exact=True).click()
        page_60 = self.page.get_by_role('button', name='60', exact=True)
        page_60.scroll_into_view_if_needed()
        self.assertGreaterEqual(page_60.bounding_box()['height'], 43.99)
        page_60.click()
        expect(self.page.get_by_role('button', name='PAGE 60 / 61', exact=True)).to_be_visible()

        next_page.focus()
        next_page.press('Enter')
        expect(self.page.get_by_role('button', name='PAGE 61 / 61', exact=True)).to_be_visible()
        expect(next_page).to_be_disabled()
        expect(previous).to_be_focused()

        self.page.get_by_role('button', name='PAGE 61 / 61', exact=True).click()
        page_2 = self.page.get_by_role('button', name='2', exact=True)
        page_2.scroll_into_view_if_needed()
        page_2.click()
        expect(self.page.get_by_role('button', name='PAGE 2 / 61', exact=True)).to_be_visible()
        previous.focus()
        previous.press('Enter')
        expect(self.page.get_by_role('button', name='PAGE 1 / 61', exact=True)).to_be_visible()
        expect(previous).to_be_disabled()
        expect(next_page).to_be_focused()

        self.capture('summary-privacy-paging-200')
        self.page.evaluate('document.documentElement.style.fontSize = ""')

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
            expect(day).to_have_attribute('aria-expanded', 'true')
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
            expect(day).to_have_attribute('aria-expanded', 'false')
            expect(day).to_be_focused()
            day.press('Space')
            expect(panel).to_be_visible()
            close.click()
            expect(panel).to_have_count(0)
            expect(day).to_have_attribute('aria-expanded', 'false')
            expect(day).to_be_focused()

    def test_heatmap_outside_pointer_dismissal_keeps_the_new_focus(self):
        self.seed_statistics()
        grid = self.heatmap()
        day = grid.locator('[data-date="2026-09-25"]')
        day.focus()
        day.press('Enter')
        panel = self.page.get_by_role('dialog', name='Reading day details', exact=True)
        expect(panel).to_be_visible()
        # The streak toggle can sit behind the positioned popup. Use a visible
        # toolbar target so this is a real outside pointer interaction.
        target = self.page.get_by_role('button', name='Filter books', exact=True)
        target.click()
        expect(panel).to_have_count(0)
        # Safari does not focus buttons on pointer click. It must at least not
        # restore the dismissed day and steal the user's new destination.
        expect(day).not_to_be_focused()
        expect(day).to_have_attribute('aria-expanded', 'false')

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
        self.settle_calendar(grid)
        large = day.bounding_box()['width']
        self.assertGreater(large, 15)
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.wait_for_function('e => e.getBoundingClientRect().width <= 15.1', arg=day.element_handle())
        self.settle_calendar(grid)
        self.assertGreater(large, day.bounding_box()['width'])
        grid.evaluate('e => { e.scrollLeft = 0; }')
        self.page.get_by_role('button', name='Previous heatmap period', exact=True).first.click()
        expect(grid.locator('[data-date="2025-01-01"]')).to_have_count(1)
        for month, label in ((1, 'Jan'), (2, 'Feb'), (9, 'Sep'), (12, 'Dec')):
            first = grid.locator(f'[data-date="2025-{month:02d}-01"]')
            expected = first.evaluate('e => parseInt(getComputedStyle(e).gridColumnStart) + 1')
            actual = grid.get_by_text(label, exact=True).evaluate('e => parseInt(getComputedStyle(e).gridColumnStart)')
            self.assertEqual(expected, actual)

    def test_enlarged_heatmap_toolbar_does_not_crush_the_year_between_buttons(self):
        self.seed_statistics()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        grid = self.heatmap()
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.settle_calendar(grid)
        heading = self.page.locator('.heatmap-toolbar-label').first
        year = heading.locator('.heatmap-year')
        lines = heading.evaluate('e => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)')
        self.assertLessEqual(lines, 3.1)
        self.assertEqual('nowrap', year.evaluate('e => getComputedStyle(e).whiteSpace'))
        tools = self.page.locator('.heatmap-toolbar-actions').first
        bounds = tools.bounding_box()
        self.assertGreaterEqual(bounds['x'], 0)
        self.assertLessEqual(bounds['x'] + bounds['width'], 321)
        label = heading.bounding_box()
        self.assertGreaterEqual(bounds['y'], label['y'] + label['height'] - 1)
        self.capture('heatmap-enlarged-toolbar')

    def test_filter_page_focus_is_not_under_sticky_header_or_footer(self):
        self.seed_statistics()
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.statistics()
        self.page.get_by_role('button', name='Filter books', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        expect(panel.locator('.filter-panel')).to_have_attribute('data-sticky-chrome', 'true')
        for bar in ('[data-sticky-header]', '[data-sticky-footer]'):
            self.assertEqual('sticky', panel.locator(bar).evaluate('e => getComputedStyle(e).position'))
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
        for bar in ('[data-sticky-header]', '[data-sticky-footer]'):
            self.assertEqual('static', panel.locator(bar).evaluate('e => getComputedStyle(e).position'))
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
