"""Search/Return and configured shortcuts in the actual framed EPUB reader."""
import unittest
from test_foliate_slide import FoliateSlide, P


class EpubNavigationBrowser(FoliateSlide):
    def test_search_return_restores_later_horizontal_page(self):
        self.check_search_return(False)

    def test_search_return_restores_later_vertical_page(self):
        self.check_search_return(True)

    def check_search_return(self, rtl):
        self.open_slide(rtl, mobile=True)
        self.page.evaluate(f"""async () => {{
          const p={P};
          for(let i=0;i<4;i++) {{ const turn=await p.preparePageTurn(1); if(!turn) throw Error('Missing test page'); turn.commit(); }}
        }}""")
        initial = self.pose()['page']
        self.assertGreater(initial, 1)
        self.toggle_controls()
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Search Book').click()
        self.page.get_by_role('searchbox', name='Search within book').fill('本を読む')
        self.page.locator('[aria-label="Search results"] button').first.click()
        self.page.wait_for_function(f"() => {P}.page === 1")
        self.page.get_by_role('button', name='Return to where I was', exact=True).click()
        self.page.wait_for_function(f"() => {P}.page === {initial}")
        self.assertEqual(self.pose()['page'], initial)

    def test_focused_iframe_bookmark_shortcut_and_return_keep_the_saved_page(self):
        self.context.add_init_script("localStorage.setItem('autoBookmark', 'false')")
        self.open_slide(False, mobile=True)
        self.page.emulate_media(reduced_motion='reduce')
        self.page.mouse.click(195, 360)
        self.page.keyboard.press('PageDown')
        self.page.wait_for_function(f"() => {P}.page === 2")
        self.page.keyboard.press('b')
        self.page.wait_for_function("""() => new Promise((resolve,reject) => {
          const open=indexedDB.open('books');
          open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result,r=db.transaction('bookmark').objectStore('bookmark').getAll();
            r.onerror=()=>{db.close();reject(r.error)};
            r.onsuccess=()=>{db.close();resolve(r.result.some(b=>b.exploredCharCount>0))};};
        })""")
        self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.press('PageDown')
        self.page.wait_for_function(f"() => {P}.page === 3")
        self.page.keyboard.press('r')
        self.page.wait_for_function(f"() => {P}.page === 2")
        self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(EpubNavigationBrowser(name) for name in EpubNavigationBrowser.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
