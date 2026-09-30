"""Search/Return and configured shortcuts in the actual framed EPUB reader."""
import unittest
import json
from pathlib import Path
from test_foliate_slide import FoliateSlide, P
from reader_controls import reveal_reader_controls


class EpubNavigationBrowser(FoliateSlide):
    def open_slide(self, *args, **kwargs):
        super().open_slide(*args, **kwargs)
        self.page.evaluate("""() => {
          const p = document.querySelector('foliate-paginator')
          const evidence = window.readerNavigationEvidence = {events:[]}
          const point = (node, offset) => ({
            offset, type:node?.nodeType, parent:node?.parentElement?.localName,
            id:node?.parentElement?.id, text:node?.textContent?.slice(0,100)
          })
          const record = (type, detail) => {
            const range = detail?.range
            evidence.events.push({type, time:performance.now(), key:detail?.key,
              reason:detail?.reason, index:p.getContents()[0]?.index,
              page:p.getContents().length ? p.page : null,
              pages:p.getContents().length ? p.pages : null,
              start:range ? point(range.startContainer,range.startOffset) : null,
              end:range ? point(range.endContainer,range.endOffset) : null})
            if (evidence.events.length > 80) evidence.events.shift()
          }
          const bindKeys = doc => doc.addEventListener('keydown', event =>
            record('keydown', {key:event.key}), {capture:true})
          bindKeys(p.getContents()[0].doc)
          p.addEventListener('load', event => {bindKeys(event.detail.doc);record('load',event.detail)})
          p.addEventListener('relocate', event => record('relocate',event.detail))
          p.addEventListener('navigationerror', () => record('navigationerror'))
          record('initial')
        }""")

    def tearDown(self):
        try:
            evidence = self.page.evaluate("""async () => {
              const evidence = window.readerNavigationEvidence ?? {events:[]}
              const p = document.querySelector('foliate-paginator')
              evidence.final = p?.getContents().length ? {
                page:p.page,pages:p.pages,index:p.getContents()[0].index,
                focused:p.getContents()[0].doc.hasFocus()
              } : null
              evidence.bookmarks = await new Promise((resolve,reject) => {
                const request = indexedDB.open('books')
                request.onerror = () => reject(request.error)
                request.onsuccess = () => {
                  const db = request.result
                  if (!db.objectStoreNames.contains('bookmark')) {db.close();resolve([]);return}
                  const tx = db.transaction('bookmark')
                  const read = tx.objectStore('bookmark').getAll()
                  tx.oncomplete = () => {db.close();resolve(read.result)}
                  tx.onabort = () => {db.close();reject(tx.error)}
                }
              })
              return evidence
            }""")
        except Exception as error:
            evidence = {'diagnosticError': str(error)}
        try:
            folder = Path('test-results')
            folder.mkdir(parents=True, exist_ok=True)
            (folder / (self._testMethodName + '-navigation.json')).write_text(
                json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        finally:
            # Retain the original screenshot/page-error cleanup and every assertion.
            super().tearDown()

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
        reveal_reader_controls(self.page)
        self.page.get_by_role('button', name='Reading tools', exact=True).click()
        self.page.get_by_role('menuitem', name='Search Book').click()
        self.page.get_by_role('searchbox', name='Search within book').fill('本を読む')
        self.page.locator('[aria-label="Search results"] button').first.click()
        self.page.wait_for_function(f"() => {P}.page === 1")
        self.page.get_by_role('button', name='Return to where I was', exact=True).click()
        self.page.wait_for_function(f"() => {P}.page === {initial}")
        self.assertEqual(self.pose()['page'], initial)

    def test_selection_cancels_held_horizontal_turn(self):
        self.check_selection_cancels_tail(False)

    def test_selection_cancels_held_vertical_turn(self):
        self.check_selection_cancels_tail(True)

    def check_selection_cancels_tail(self, rtl):
        self.open_slide(rtl, mobile=True)
        initial = self.pose()['page']
        key = 'ArrowLeft' if rtl else 'ArrowRight'
        # Synthetic repeat controls the held-key timing; the production
        # controller, iframe, Range selection, layout and turn handles are real.
        self.page.evaluate(f"""key => {{
          const doc={P}.getContents()[0].doc;
          doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{{
            key,code:key,repeat:true,bubbles:true,cancelable:true
          }}));
        }}""", key)
        self.page.wait_for_function(f"() => {P}.hasAttribute('data-turn-progress')")
        self.page.evaluate(f"""() => {{
          const doc={P}.getContents()[0].doc;
          const range=doc.createRange(); range.selectNodeContents(doc.querySelector('.book-content p'));
          doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
        }}""")
        self.page.wait_for_function(f"() => !{P}.hasAttribute('data-turn-progress')")
        self.page.evaluate(f"""key => {{
          const doc={P}.getContents()[0].doc; doc.getSelection().removeAllRanges();
          doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keyup',{{key,code:key,bubbles:true}}));
        }}""", key)
        self.assertEqual(initial, self.pose()['page'])
        # The held-key setup dispatched directly to Document and did not focus
        # its browsing context. Give the following real key the intended owner.
        self.page.evaluate(f'{P}.getContents()[0].doc.defaultView.focus()')
        self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.press(key)
        self.page.wait_for_function(f"() => {P}.page === {initial + 1}")
        self.assertEqual([], self.errors)

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
