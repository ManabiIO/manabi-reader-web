"""Complete shared Expo Statistics route against the real browser data owner.

This supplements, never replaces, existing heatmap/grid, enlarged-text, sticky
filter, appearance, recovery-export and controller-ownership acceptance cases.
No request interception, substitute UI, mocked database, or mocked renderer.
"""
import json
from pathlib import Path
import re
import unittest
from playwright.sync_api import expect
from test_books_library import LibraryBase


class SharedStatisticsBrowser(LibraryBase):
    def seed(self, count=2):
        self.page.evaluate('''async count => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('books');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction('statistic', 'readwrite');
              for (const [title, seconds, characters] of [
                ['Shared Statistics Alpha', 120, 50], ['Shared Statistics Beta', 60, 25]
              ].slice(0, count)) tx.objectStore('statistic').put({
                title, dateKey: '2026-09-25', readingTime: seconds,
                charactersRead: characters, minReadingSpeed: 1000,
                altMinReadingSpeed: 1200, lastReadingSpeed: 1500,
                maxReadingSpeed: 1800, lastStatisticModified: 100
              });
              tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
            });
          } finally { db.close(); }
        }''', count)
        self.page.goto(self.origin + '/reader-web/statistics')
        expect(self.page.get_by_test_id('shared-statistics-screen')).to_be_visible()
        expect(self.page.get_by_role('button', name='Filter books', exact=True)).to_be_enabled()

    def options(self):
        self.page.get_by_role('button', name='Statistics options', exact=True).click()
        self.page.get_by_role('menuitem', name='Statistics Settings', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Statistics options', exact=True)
        expect(panel).to_be_visible()
        return panel

    def set_range(self, panel):
        start = panel.get_by_label('From', exact=True)
        start.fill('2026-01-01')
        expect(start).to_be_enabled()
        end = panel.get_by_label('To', exact=True)
        end.fill('2026-12-31')
        expect(end).to_be_enabled()

    def test_shared_composition_preserves_measurements_editor_and_real_exports(self):
        self.seed()
        panel = self.options()
        self.set_range(panel)
        aggregation = panel.get_by_label('Primary Aggregation', exact=True)
        for value in ('date', 'title', 'none'):
            aggregation.select_option(value)
            expect(aggregation).to_be_enabled()
            expect(aggregation).to_have_value(value)
        for label, values in (
            ('Time Data Source', ('readingTime', 'averageReadingTime', 'averageWeightedReadingTime')),
            ('Characters Data Source', ('charactersRead', 'averageCharactersRead', 'averageWeightedCharactersRead')),
            ('Speed Data Source', ('lastReadingSpeed', 'minReadingSpeed', 'altMinReadingSpeed', 'maxReadingSpeed')),
        ):
            field = panel.get_by_label(label, exact=True)
            for value in values:
                field.select_option(value)
                expect(field).to_be_enabled()
                expect(field).to_have_value(value)
        panel.get_by_role('button', name='Close statistics options', exact=True).click()
        self.page.get_by_role('button', name='Summary', exact=True).click()
        # A desktop date is a single readable value, and a full-title action
        # keeps its hit area even when the title occupies only one text line.
        date = self.page.get_by_test_id('statistics-summary').get_by_text('2026-09-25', exact=True).first
        self.assertLessEqual(date.bounding_box()['height'], date.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)') + 1)
        title = self.page.get_by_role('button', name='Show full title Shared Statistics Alpha', exact=True)
        self.assertGreaterEqual(title.bounding_box()['height'], 43.99)
        self.page.get_by_role('button', name='Edit row Shared Statistics Alpha', exact=True).click()
        time = self.page.get_by_label('Reading time for Shared Statistics Alpha (seconds)', exact=True)
        time.fill('210')
        characters = self.page.get_by_label('Characters read for Shared Statistics Alpha', exact=True)
        characters.fill('75')
        self.page.get_by_label('Reset Min/Max Speed', exact=True).check()
        self.page.get_by_role('button', name='Save changes', exact=True).click()
        confirmation = self.page.get_by_role('dialog', name='Update Data', exact=True)
        expect(confirmation).to_contain_text('3.5 min')
        confirmation.get_by_role('button', name='Cancel', exact=True).click()
        expect(time).to_have_value('210')
        self.page.get_by_role('button', name='Save changes', exact=True).click()
        confirmation.get_by_role('button', name='Update', exact=True).click()
        expect(confirmation).to_have_count(0)
        expect(self.page.get_by_role('button', name='Edit row Shared Statistics Alpha', exact=True)).to_be_enabled()
        panel = self.options()
        with self.page.expect_download() as download:
            panel.get_by_role('button', name='Download raw history (JSON)', exact=True).click()
        snapshot = json.loads(download.value.path().read_text())
        self.assertEqual('manabi-reader-statistics-recovery', snapshot['format'])
        for label in ('Export Selection', 'Export All'):
            expect(panel.get_by_role('button', name=label, exact=True)).to_be_enabled()
            with self.page.expect_download() as archive:
                panel.get_by_role('button', name=label, exact=True).click()
            self.assertTrue(archive.value.suggested_filename.endswith('.zip'))

    def test_shared_route_filter_calendar_and_zoom_keep_original_semantics(self):
        self.seed()
        panel = self.options()
        self.set_range(panel)
        normal_heading_size = panel.get_by_role('heading', name='Date range', exact=True).evaluate('e => parseFloat(getComputedStyle(e).fontSize)')
        panel.get_by_role('button', name='Close statistics options', exact=True).click()
        trigger = self.page.get_by_role('button', name='Filter books', exact=True)
        trigger.click()
        filter_panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        filter_panel.get_by_role('searchbox', name='Filter book titles', exact=True).fill('Beta')
        filter_panel.get_by_role('button', name='Remove matching', exact=True).click()
        filter_panel.get_by_role('button', name='Cancel', exact=True).click()
        expect(trigger).to_be_focused()
        trigger.click()
        expect(filter_panel.get_by_role('checkbox', name='Shared Statistics Beta', exact=True)).to_be_checked()
        filter_panel.get_by_role('button', name='Apply Filter', exact=True).click()
        self.page.get_by_role('button', name='Heatmap', exact=True).click()
        grid = self.page.locator('.heatmap-calendar').first
        day = grid.locator('[data-date="2026-09-25"]')
        day.focus()
        self.page.keyboard.press('ArrowRight')
        expect(grid.locator('[data-date="2026-10-02"]')).to_be_focused()
        self.assertEqual(1, grid.locator('button[tabindex="0"]').count())
        day.evaluate('e => e.setAttribute("dir", "rtl")')
        day.focus()
        self.page.keyboard.press('ArrowRight')
        expect(grid.locator('[data-date="2026-09-18"]')).to_be_focused()
        day.evaluate('e => e.removeAttribute("dir")')
        day.press('Enter')
        details = self.page.get_by_role('dialog', name='Reading day details', exact=True)
        expect(details).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(day).to_be_focused()
        # A previously opened book adds Resume reading to the toolbar. Keep
        # that real navigation state when checking enlarged text and hit areas.
        self.go_library()
        self.import_book('Statistics resume geometry')
        self.page.get_by_role('button', name='Read Statistics resume geometry', exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        self.page.goto(self.origin + '/reader-web/statistics')
        expect(self.page.get_by_role('link', name='Resume reading', exact=True)).to_be_visible()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.get_by_role('button', name='Heatmap', exact=True).click()
        streak = self.page.get_by_role('button', name=re.compile(r'^Longest Streak'))
        normal_streak_size = streak.evaluate('e => parseFloat(getComputedStyle(e.firstElementChild).fontSize)')
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        enlarged_streak_size = streak.evaluate('e => parseFloat(getComputedStyle(e.firstElementChild).fontSize)')
        self.assertAlmostEqual(enlarged_streak_size, normal_streak_size * 2, delta=0.5)
        self.page.wait_for_function('document.documentElement.scrollWidth - innerWidth <= 1')
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
        for role, name in [('link', 'Resume reading'), ('link', 'Back')]:
            control = self.page.get_by_role(role, name=name, exact=True)
            control.scroll_into_view_if_needed()
            expect(control).to_be_in_viewport()
            bounds = control.bounding_box()
            self.assertGreaterEqual(bounds['x'], -1)
            self.assertLessEqual(bounds['x'] + bounds['width'], 321)
            self.assertTrue(control.evaluate('''e => {
              const r = e.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
              return !!hit && (hit === e || e.contains(hit));
            }'''))
        panel = self.options()
        expect(panel.get_by_role('heading', name='Statistics options', exact=True)).to_be_visible()
        enlarged_heading_size = panel.get_by_role('heading', name='Date range', exact=True).evaluate('e => parseFloat(getComputedStyle(e).fontSize)')
        self.assertAlmostEqual(enlarged_heading_size, normal_heading_size * 2, delta=0.5)
        close = panel.get_by_role('button', name='Close statistics options', exact=True)
        self.assertGreaterEqual(close.bounding_box()['width'], 43.99)
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        close.click()
        expect(panel).to_have_count(0)

    def test_private_measurements_reveal_before_details_and_rehide_after_reload(self):
        # One record keeps every measurement mounted in the compact virtualized
        # list; the separate route cases exercise multiple rows and pagination.
        self.seed(count=1)
        hidden = ['readingTime', 'charactersRead', 'lastReadingSpeed']
        self.page.evaluate(
            "values => localStorage.setItem('lastBlurredTrackerItems', JSON.stringify(values))",
            hidden)
        self.page.reload()
        panel = self.options()
        self.set_range(panel)
        panel.get_by_label('Primary Aggregation', exact=True).select_option('none')
        panel.get_by_role('button', name='Close statistics options', exact=True).click()
        self.page.get_by_role('button', name='Summary', exact=True).click()
        summary = self.page.get_by_test_id('statistics-summary')
        details = self.page.get_by_role('dialog', name='Measurement details', exact=True)
        for width, height, size in [(1200, 900, '100%'), (320, 568, '200%')]:
            with self.subTest(width=width, text=size):
                self.page.reload()
                expect(summary).to_be_visible()
                self.page.set_viewport_size({'width': width, 'height': height})
                self.page.evaluate('size => document.documentElement.style.fontSize = size', size)
                private = summary.get_by_role('button', name=re.compile('value hidden.*reveal'))
                expect(private).to_have_count(3)
                for metric in private.all():
                    expect(metric).to_have_text('••••')
                    expect(metric.locator('[aria-hidden=true]')).to_have_count(1)
                    self.assertNotRegex(metric.aria_snapshot(), r'\b(?:120|1500|1800|50|25)\b')
                for label in ['Total Time', 'Characters', 'Speed']:
                    metric = summary.get_by_role(
                        'button', name=re.compile('^' + label + ' for Shared Statistics Alpha'))
                    metric.scroll_into_view_if_needed()
                    metric.focus()
                    self.page.keyboard.press('Enter')
                    expect(metric).to_be_focused()
                    expect(metric).to_have_attribute('aria-label', re.compile('Activate to view details'))
                    expect(details).to_have_count(0)
                    expect(metric).not_to_have_text('••••')
                    for dismiss in ['button', 'escape']:
                        self.page.keyboard.press('Enter')
                        expect(details).to_be_visible()
                        close = details.get_by_role('button', name='Close measurement details', exact=True)
                        expect(close).to_be_focused()
                        expect(close).to_be_in_viewport()
                        self.assertLessEqual(details.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
                        self.assertTrue(close.evaluate('''e => {
                          const r = e.getBoundingClientRect();
                          const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
                          return !!hit && (hit === e || e.contains(hit));
                        }'''))
                        if label == 'Total Time' and dismiss == 'button':
                            first = details.get_by_text('Time: 2 min', exact=True).bounding_box()
                            second = details.get_by_text('Average Time: 2 min', exact=True).bounding_box()
                            self.assertGreaterEqual(second['y'], first['y'] + first['height'] + 7)
                            heading = details.get_by_role('heading', name='Measurement details', exact=True)
                            self.assertEqual(1, heading.evaluate('''e => {
                              const text = document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode();
                              const range = document.createRange();
                              range.setStart(text, 0); range.setEnd(text, 'Measurement'.length);
                              return range.getClientRects().length;
                            }'''))
                            self.page.screenshot(path=str(Path('test-results') /
                                f'{self.engine}-private-measurement-{width}.png'))
                        if dismiss == 'button':
                            close.click()
                        else:
                            self.page.keyboard.press('Escape')
                        expect(details).to_have_count(0)
                        expect(metric).to_be_focused()
                self.assertEqual(hidden, self.page.evaluate(
                    "JSON.parse(localStorage.getItem('lastBlurredTrackerItems'))"))
                # Query refresh retires all transient reveals, including an open
                # detail surface, while retaining the saved privacy preference.
                metric.press('Enter')
                expect(details).to_be_visible()
                self.page.get_by_role('button', name='Sort by Total Time', exact=True).press('Enter')
                expect(details).to_have_count(0)
                expect(private).to_have_count(3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
