"""Precise local EPUB resume through actual imports, keyboard commands and IndexedDB."""
import io
import json
import unittest
import zipfile
from pathlib import Path
from playwright.sync_api import expect
from test_foliate_slide import FoliateSlide, P


def long_paragraph_epub():
    output = io.BytesIO()
    title = 'Precise long-paragraph resume'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        manifest = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(3))
        spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(3))
        archive.writestr('content.opf', f'<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">{title}</dc:title></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>')
        for index in range(3):
            paragraph = '日本語𠮷の長い段落を丁寧に読みます。' * 300
            archive.writestr(f'c{index}.xhtml', f'<html><body><h1>Chapter {index}</h1><p id="long">{paragraph}</p></body></html>')
    return title, output.getvalue()


READ_BOOKMARK = """async () => new Promise((resolve,reject) => {
  const request=indexedDB.open('books')
  request.onerror=()=>reject(request.error)
  request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('bookmark'),read=tx.objectStore('bookmark').getAll()
    tx.oncomplete=()=>{db.close();resolve(read.result[0]??null)}
    tx.onabort=()=>{db.close();reject(tx.error)}
  }
})"""


class FoliateBookmarkPosition(FoliateSlide):
    def open_precise_book(self, vertical=False):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        writing = 'vertical-rl' if vertical else 'horizontal-tb'
        self.context.add_init_script(f"""localStorage.setItem('manabi-dev-foliate-epub','true');
          localStorage.setItem('viewMode','paginated');localStorage.setItem('writingMode',{json.dumps(writing)});
          localStorage.setItem('autoBookmark','false');localStorage.setItem('selectionToBookmarkEnabled','false')""")
        self.page.emulate_media(reduced_motion='reduce')
        title, archive = long_paragraph_epub()
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({'name': 'precise.epub', 'mimeType': 'application/epub+zip', 'buffer': archive})
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        self.ready()
        self.assertEqual(self.page.evaluate(f'{P}.page'), 1)

    def ready(self):
        self.page.wait_for_function(f"() => {P}?.getContents().length && {P}.pageCounts.length===3 && {P}.pageCounts.every(Number.isFinite)")
        self.page.evaluate(f'{P}.focusView()')

    def advance(self, count=1):
        for _ in range(count):
            before = self.page.evaluate(f'{P}.page')
            self.page.keyboard.press('PageDown')
            self.page.wait_for_function(f'() => {P}.page === {before + 1}')

    def saved(self):
        return self.page.evaluate(READ_BOOKMARK)

    def save(self):
        before = self.saved()
        modified = before['lastBookmarkModified'] if before else -1
        self.page.keyboard.press('b')
        self.page.wait_for_function(f"async () => {{ const value=await ({READ_BOOKMARK})();return value?.readerPosition && value.lastBookmarkModified>{modified} }}")
        return self.saved()

    def restore(self, expected):
        self.page.evaluate(f'{P}.focusView()')
        self.page.keyboard.press('r')
        self.page.wait_for_function(f'() => {P}.page === {expected}')
        self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))

    def replace_saved(self, value):
        self.page.evaluate("""value => new Promise((resolve,reject)=>{
          const request=indexedDB.open('books');request.onerror=()=>reject(request.error)
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('bookmark','readwrite');
            tx.objectStore('bookmark').put(value)
            tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)}}
        })""", value)
        self.page.reload()
        self.ready()

    def test_keyboard_save_return_retains_mid_paragraph_ltr(self):
        self.open_precise_book()
        self.advance()
        saved = self.save()
        self.advance()
        self.restore(2)
        self.assertEqual(self.saved(), saved)

    def test_keyboard_save_return_retains_mid_paragraph_vertical(self):
        self.open_precise_book(vertical=True)
        self.advance(2)
        saved = self.save()
        self.advance()
        self.restore(3)
        self.assertEqual(self.saved(), saved)

    def test_full_page_reload_restores_the_saved_page(self):
        self.open_precise_book()
        self.advance(2)
        saved = self.save()
        self.page.reload()
        self.ready()
        self.page.wait_for_function(f'() => {P}.page === 3')
        self.assertEqual(self.saved(), saved)

    def test_reflow_reveals_the_saved_glyph_without_rewriting_legacy_progress(self):
        self.open_precise_book()
        self.advance(2)
        saved = self.save()
        self.page.set_viewport_size({'width': 310, 'height': 844})
        self.page.evaluate(f'async () => {{ await {P}.goTo({{index:0,anchor:0}}) }}')
        self.page.evaluate(f'{P}.focusView()')
        self.page.keyboard.press('r')
        # The fixture has a known h1 followed by one text node. Measure the
        # saved source glyph directly rather than accepting a nearby page count.
        self.page.wait_for_function("""point => {
          const p=document.querySelector('foliate-paginator'),doc=p.getContents()[0]?.doc
          const node=doc?.querySelector('.book-content #long')?.firstChild
          if(!node || !window.slideRoot)return false
          const offset=point.start-Array.from(doc.querySelector('h1').textContent).length-1
          if(offset<0)return false
          const chars=Array.from(node.data),start=chars.slice(0,offset).join('').length
          const range=doc.createRange();range.setStart(node,start);range.setEnd(node,start+(chars[offset]?.length??0))
          const frame=doc.defaultView.frameElement.getBoundingClientRect()
          const clip=window.slideRoot.querySelector('#top #container').getBoundingClientRect()
          return Array.from(range.getClientRects()).some(r=>r.width>0&&r.height>0&&
            frame.left+r.right>clip.left&&frame.left+r.left<clip.right&&
            frame.top+r.bottom>clip.top&&frame.top+r.top<clip.bottom)
        }""", arg=saved['readerPosition']['locator'])
        self.assertEqual(self.saved(), saved)

    def test_legacy_resume_without_precision_keeps_its_existing_fallback(self):
        self.open_precise_book()
        self.advance(2)
        saved = self.save()
        del saved['readerPosition']
        self.replace_saved(saved)
        self.page.wait_for_function(f'() => {P}.page === 1')
        self.assertEqual(self.saved(), saved)

    def test_newer_legacy_record_cannot_reuse_stale_precision(self):
        self.open_precise_book()
        self.advance(2)
        saved = self.save()
        saved.update(exploredCharCount=0, progress=0, lastBookmarkModified=saved['lastBookmarkModified']+1)
        self.replace_saved(saved)
        self.page.wait_for_function(f'() => {P}.page === 1')
        self.assertEqual(self.saved(), saved)

    def test_wrong_book_locator_is_not_its_own_identity_evidence(self):
        self.open_precise_book()
        self.advance(2)
        saved = self.save()
        saved['readerPosition']['locator']['bookKey'] = 'content:' + 'f'*64
        self.replace_saved(saved)
        self.page.wait_for_function(f'() => {P}.page === 1')
        self.assertEqual(self.saved(), saved)

    def test_unknown_resource_uses_legacy_fallback_without_guessing(self):
        self.open_precise_book()
        self.advance(2)
        saved = self.save()
        saved['readerPosition']['locator']['resource']['href'] = 'missing.xhtml'
        self.replace_saved(saved)
        self.page.wait_for_function(f'() => {P}.page === 1')
        self.assertEqual(self.saved(), saved)

    def test_newer_save_wins_over_delayed_native_digest_at_the_same_legacy_count(self):
        self.open_precise_book()
        self.advance()
        baseline = self.save()
        self.page.evaluate("""() => {
          const original=crypto.subtle.digest.bind(crypto.subtle);let hold=true
          crypto.subtle.digest=(...args)=>{
            if(!hold)return original(...args)
            hold=false;window.bookmarkDigestHeld=true
            return new Promise((resolve,reject)=>{
              window.releaseBookmarkDigest=()=>original(...args).then(resolve,reject)
            })
          }
        }""")
        self.page.keyboard.press('b')
        self.page.wait_for_function('() => window.bookmarkDigestHeld===true')
        self.advance()
        latest = self.save()
        self.assertEqual(latest['exploredCharCount'], baseline['exploredCharCount'])
        self.assertGreater(latest['readerPosition']['locator']['start'], baseline['readerPosition']['locator']['start'])
        self.page.evaluate('window.releaseBookmarkDigest()')
        # Drain the old native digest and its continuation, not an arbitrary retry.
        self.page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        self.assertEqual(self.saved(), latest)
        self.advance()
        self.restore(3)
        self.assertEqual(self.saved(), latest)

    def tearDown(self):
        try:
            folder = Path('test-results')
            folder.mkdir(exist_ok=True)
            try:
                snapshot = self.saved()
            except Exception as error:
                snapshot = {'diagnosticError': str(error)}
            (folder / (self._testMethodName + '-bookmark.json')).write_text(json.dumps(snapshot, indent=2), encoding='utf-8')
        finally:
            super().tearDown()


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(FoliateBookmarkPosition(name) for name in FoliateBookmarkPosition.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
