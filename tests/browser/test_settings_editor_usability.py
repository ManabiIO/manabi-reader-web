"""Actual Settings forms, reflow and native IndexedDB saves.

Uses harmless dummy OAuth text, never a provider or password-manager request.
Only the duplicate-submit case observes the native IDB add method; all data
is stored by the production editor and database service.
"""
import unittest
from pathlib import Path
from playwright.sync_api import expect
from test_books_library import LibraryBase


class SettingsEditorUsabilityBrowser(LibraryBase):
    def settings(self, category='library'):
        self.page.goto(self.origin + '/reader-web/settings#' + category)
        if category == 'library':
            expect(self.page.locator('[data-setting="storage-sources"]').get_by_role(
                'button', name='Add source', exact=True)).to_be_enabled()
        else:
            expect(self.page.get_by_role('navigation', name='Settings categories').get_by_role(
                'link', name='Tracking & goals', exact=True)).to_have_attribute('aria-current', 'page')

    def editor(self):
        self.page.locator('[data-setting="storage-sources"]').get_by_role(
            'button', name='Add source', exact=True).click()
        panel = self.dialog()
        expect(panel.get_by_role('heading', name='Add storage source', exact=True)).to_be_visible()
        expect(panel.locator('form')).to_have_attribute('aria-busy', 'false')
        return panel

    def fill_source(self, panel, name):
        panel.get_by_label('Name', exact=True).fill(name)
        panel.get_by_label('Client ID', exact=True).fill('ui-regression-client-not-a-credential')
        panel.get_by_label('Disable Password Encryption', exact=True).check()

    def capture(self, name):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        self.page.screenshot(path=str(output / (self.engine + '-settings-editor-' + name + '.png')))

    def assert_clickable(self, control):
        control.scroll_into_view_if_needed()
        self.page.wait_for_function('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return hit && (e===hit || e.contains(hit));
        }''', arg=control.element_handle())
        box = control.bounding_box()
        self.assertGreaterEqual(box['x'], -1)
        self.assertLessEqual(box['x'] + box['width'], self.page.viewport_size['width'] + 1)

    def test_editor_reopens_validates_and_cancels_without_writing(self):
        self.settings()
        before = self.stores('books', ['storageSource'])
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            self.page.set_viewport_size({'width': 320, 'height': 480})
            self.settings()
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')
            panel = self.editor()
            name = panel.get_by_label('Name', exact=True)
            panel.get_by_role('button', name='Save', exact=True).click()
            expect(panel).to_be_visible()
            self.assertFalse(name.evaluate('e => e.validity.valid'))
            name.fill('Private editor draft')
            panel.get_by_label('Client ID', exact=True).fill('dummy-client')
            password = panel.get_by_label('Password', exact=True)
            confirm = panel.get_by_label('Confirm Password', exact=True)
            password.fill('fixture password')
            confirm.fill('mismatch')
            confirm.press('Enter')
            expect(panel).to_be_visible()
            self.assertEqual('Password does not match', confirm.evaluate('e => e.validationMessage'))
            confirm.fill('fixture password')
            self.assertTrue(confirm.evaluate('e => e.validity.valid'))
            # Recreating the remote fields must not discard the private draft.
            storage_type = panel.get_by_label('Storage type', exact=True)
            if storage_type.locator('option[value="fs"]').count():
                storage_type.select_option('fs')
                storage_type.select_option('gdrive')
                expect(password).to_have_value('fixture password')
                expect(confirm).to_have_value('fixture password')
            self.assertLessEqual(panel.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
            self.assertEqual(panel.locator('form').evaluate('e => getComputedStyle(e).overflowY'), 'visible')
            self.assert_clickable(panel.get_by_role('button', name='Cancel', exact=True))
            self.capture('draft-' + mode)
            panel.get_by_role('button', name='Cancel', exact=True).click()
            expect(panel).to_have_count(0)
            self.assertEqual(before, self.stores('books', ['storageSource']))

    def test_pending_native_save_blocks_edit_cancel_and_duplicate_submission(self):
        self.settings()
        panel = self.editor()
        name = 'Native queued storage source'
        self.fill_source(panel, name)
        self.page.evaluate('''async name => {
          const db=await new Promise((resolve,reject)=>{
            const r=indexedDB.open('books');
            r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
          });
          const tx=db.transaction('storageSource','readwrite');
          let held=true;
          window.__releaseStorageEditor=()=>{held=false;};
          tx.oncomplete=tx.onabort=()=>db.close();
          const pump=()=>{if(held) tx.objectStore('storageSource').get(name).onsuccess=pump;};
          pump();
          window.__sourceAdds=0;
          const nativeAdd=IDBObjectStore.prototype.add;
          IDBObjectStore.prototype.add=function(...args){
            if(this.name==='storageSource' && args[0]?.name===name) window.__sourceAdds++;
            return nativeAdd.apply(this,args);
          };
        }''', name)
        try:
            panel.get_by_role('button', name='Save', exact=True).click()
            expect(panel.locator('form')).to_have_attribute('aria-busy', 'true')
            expect(panel.get_by_label('Name', exact=True)).to_be_disabled()
            expect(panel.get_by_role('button', name='Cancel', exact=True)).to_be_disabled()
            expect(panel.get_by_role('button', name='Saving…', exact=True)).to_be_disabled()
            panel.locator('form').evaluate('''e => {
              for(let i=0;i<3;i++) e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
            }''')
            self.page.keyboard.press('Escape')
            self.page.mouse.click(1, 1)
            expect(panel).to_be_visible()
            self.page.wait_for_function('window.__sourceAdds === 1')
            self.capture('pending-save')
        finally:
            self.page.evaluate('window.__releaseStorageEditor()')
        expect(panel).to_have_count(0)
        rows = self.stores('books', ['storageSource'])['storageSource']
        matches = [row for row in rows if row['name'] == name]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['data']['clientId'], 'ui-regression-client-not-a-credential')
        self.assertEqual(self.page.evaluate('window.__sourceAdds'), 1)

    def test_duplicate_name_failure_can_be_corrected_and_saved_with_enter(self):
        self.settings()
        panel = self.editor()
        self.fill_source(panel, 'Existing fixture source')
        panel.get_by_label('Name', exact=True).press('Enter')
        expect(panel).to_have_count(0)
        existing = self.stores('books', ['storageSource'])['storageSource']
        panel = self.editor()
        self.fill_source(panel, 'Existing fixture source')
        panel.get_by_label('Client ID', exact=True).fill('different-dummy-client')
        panel.get_by_label('Name', exact=True).press('Enter')
        expect(panel.get_by_role('alert')).to_be_visible()
        expect(panel.locator('form')).to_have_attribute('aria-busy', 'false')
        self.assertEqual(existing, self.stores('books', ['storageSource'])['storageSource'])
        panel.get_by_label('Name', exact=True).fill('Corrected fixture source')
        expect(panel.get_by_role('alert')).to_have_count(0)
        panel.get_by_label('Name', exact=True).press('Enter')
        expect(panel).to_have_count(0)
        rows = self.stores('books', ['storageSource'])['storageSource']
        self.assertEqual(len(rows), len(existing) + 1)
        self.assertEqual([r for r in rows if r['name'] == 'Existing fixture source'],
                         [r for r in existing if r['name'] == 'Existing fixture source'])

    def test_compact_header_preserves_full_navigation_and_readable_text(self):
        for width, scale in ((320, '200%'), (390, '100%'), (1440, '100%')):
            self.page.set_viewport_size({'width': width, 'height': 844})
            self.settings()
            self.page.evaluate('v => document.documentElement.style.fontSize=v', scale)
            header = self.page.locator('header.settings-header')
            back = header.get_by_role('link', name='Back', exact=True)
            navigate = header.get_by_role('button', name='Navigate', exact=True)
            self.assertLessEqual(self.page.locator('html').evaluate('e=>e.scrollWidth-e.clientWidth'), 1)
            self.assert_clickable(back)
            self.assert_clickable(navigate)
            if width < 640:
                self.assertLessEqual(header.bounding_box()['height'], 96)
                for control in (back, navigate):
                    self.assertAlmostEqual(control.bounding_box()['width'], 44, delta=1)
                    self.assertAlmostEqual(control.bounding_box()['height'], 44, delta=1)
                title = header.locator('.settings-title')
                if scale == '200%':
                    self.assertGreaterEqual(title.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'), 32)
                b, t, n = back.bounding_box(), title.bounding_box(), navigate.bounding_box()
                self.assertLessEqual(b['x']+b['width'], t['x'])
                self.assertLessEqual(t['x']+t['width'], n['x'])
            else:
                primary = header.get_by_role('navigation', name='Primary navigation')
                expect(primary.get_by_role('link', name='Settings', exact=True)).to_have_attribute('aria-current', 'page')
            self.capture('header-' + str(width))
            navigate.click()
            menu = self.page.get_by_role('dialog', name='Manabi Reader', exact=True)
            expect(menu.get_by_role('link', name='Accounts and libraries', exact=True)).to_be_visible()
            menu.get_by_role('button', name='Close', exact=True).click()
            expect(menu).to_have_count(0)
            expect(navigate).to_be_focused()

    def test_reader_origin_survives_settings_category_navigation(self):
        self.import_book('Settings back origin')
        self.page.get_by_role('button', name='Read Settings back origin', exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        reader_url = self.page.url

        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Settings', exact=True).click()
        expect(self.page.get_by_label('Search settings', exact=True)).to_be_visible()

        back = self.page.get_by_role('link', name='Back', exact=True)
        expected_path = reader_url.removeprefix(self.origin)
        expect(back).to_have_attribute('href', expected_path)
        typography = self.page.get_by_role('navigation', name='Settings categories').get_by_role(
            'link', name='Fonts & text', exact=True)
        typography.click()
        expect(typography).to_have_attribute('aria-current', 'page')
        expect(back).to_have_attribute('href', expected_path)
        self.capture('reader-origin-preserved')

        back.click()
        expect(self.page).to_have_url(reader_url)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')

    def test_statistics_cleanup_reflows_without_touching_history(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.settings('tracking')
        before = self.stores('books', ['statistic'])
        self.page.evaluate('document.documentElement.style.fontSize="200%"')
        field = self.page.locator('[data-setting="keep-local-statistics-on-deletion"]')
        cleanup = field.get_by_role('button', name='Clear Zombie Statistics', exact=True)
        switch = field.get_by_role('switch', name='Keep Local Data on Deletion', exact=True)
        self.assert_clickable(cleanup)
        expect(cleanup).to_have_attribute('data-variant', 'destructive')
        self.assert_clickable(switch)
        self.assertLessEqual(self.page.locator('html').evaluate('e=>e.scrollWidth-e.clientWidth'), 1)
        self.capture('cleanup-200')
        self.assertEqual(before, self.stores('books', ['statistic']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
