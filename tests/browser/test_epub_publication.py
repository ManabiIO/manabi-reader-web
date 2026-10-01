"""Resource-backed EPUB imports through the real static app, without route mocks."""
import io
import json
import os
import threading
import unittest
import zipfile
from playwright.sync_api import expect, sync_playwright
from test_static_reader import ReaderBrowser, StaticHandler, ThreadingHTTPServer

P = "document.querySelector('foliate-paginator')"
TITLE = 'Resource EPUB acceptance'


def resource_epub(malformed=False):
    output = io.BytesIO()
    container = '''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
<rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'''
    package = f'''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:resource-test</dc:identifier>
<dc:title>{TITLE}</dc:title><dc:language>ja</dc:language><dc:creator>作者</dc:creator>
<meta property="rendition:flow">paginated</meta></metadata>
<manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
<item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
<item id="css1" href="one.css" media-type="text/css"/><item id="css2" href="two.css" media-type="text/css"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav scripted"/></manifest>
<spine><itemref idref="one"/><itemref idref="two"/><itemref idref="one"/></spine></package>'''
    first = '''<html xmlns="http://www.w3.org/1999/xhtml" class="root" lang="ja"><head><title>First</title>
<link rel="stylesheet" href="one.css"/><link rel="stylesheet" href="/attack-probe-style"/>
<style>.text{font-weight:700}</style></head><body class="body-one">
<p class="text" id="same"><ruby>漢<rt>かん</rt></ruby>字𠮷</p>
<a id="cross" href="two.xhtml#same">第二章へ</a><a id="local" href="#same">現在の章</a>
<script>window.bookAttack=true</script><iframe src="/attack-probe-frame"></iframe>
<img src="/attack-probe-image" onerror="window.bookAttack=true"/>
<p style="background-image:url(/attack-probe-css)">安全な文章</p></body></html>'''
    if malformed:
        first = first.replace('<p class="text"', '<br><p class="text"')
    second = '''<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second</title>
<link rel="stylesheet" href="two.css"/></head><body><p class="text" id="same">別の章</p>
<a id="back" href="one.xhtml#same">戻る</a></body></html>'''
    nav = '''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol><li><span>Part</span>
<ol><li><a href="one.xhtml#same">第一章</a></li><li><a href="two.xhtml">第二章</a></li></ol>
</li></ol></nav>
<nav epub:type="page-list"><ol><li><a href="one.xhtml#same">1</a></li></ol></nav>
<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="one.xhtml">本文</a></li></ol></nav>
</body></html>'''
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, contents in {
            'mimetype': 'application/epub+zip', 'META-INF/container.xml': container,
            'EPUB/book.opf': package, 'EPUB/one.xhtml': first, 'EPUB/two.xhtml': second,
            'EPUB/nav.xhtml': nav,
            'EPUB/one.css': 'html body .text{color:rgb(180,0,0)}',
            'EPUB/two.css': '.text{color:rgb(0,0,180)} @import "/attack-probe-import";'
        }.items():
            archive.writestr(name, contents)
    return output.getvalue()


def rtl_language_epub():
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'EPUB/book.opf':
                data = data.replace(b'<spine>', b'<spine page-progression-direction="rtl">')
            target.writestr(entry, data)
    return output.getvalue()


def resource_semantics_epub():
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'EPUB/book.opf':
                data = data.replace(b'<dc:language>ja</dc:language>', b'<dc:language>en</dc:language>')
            elif entry.filename == 'EPUB/one.xhtml':
                data = data.replace(b'<body class="body-one">', b'<body class="body-one" dir="rtl">')
            target.writestr(entry, data)
    return output.getvalue()


def ltr_pages_rtl_content_epub():
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_semantics_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'EPUB/book.opf':
                data = data.replace(b'<spine>', b'<spine page-progression-direction="ltr">')
            target.writestr(entry, data)
    return output.getvalue()


def linear_epub():
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'EPUB/book.opf':
                data = data.replace(
                    b'<itemref idref="two"/>',
                    b'<itemref idref="two" linear="no"/>'
                )
            target.writestr(entry, data)
    return output.getvalue()


def fixed_layout_epub(spine_override=False):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'EPUB/book.opf':
                if spine_override:
                    data = data.replace(
                        b'<itemref idref="two"/>',
                        b'<itemref idref="two" properties="rendition:layout-pre-paginated"/>'
                    )
                else:
                    data = data.replace(
                        b'</metadata>',
                        b'<meta property="rendition:layout">pre-paginated</meta></metadata>'
                    )
            target.writestr(entry, data)
    return output.getvalue()


def numeric_epub():
    """Escaped author text must not become markup during Extended repair."""
    extra = ('<p id="literal-html">&#60;em&#62;literal&#60;/em&#62;</p>'
             '<p id="literal-entity">&#x26;#60; | &#38;lt;</p>'
             '<p id="literal-quote" title="before&#34; hidden=&#34;after">visible</p>'
             '<p id="literal-unicode">&#128; &#x20000; &#0;</p>')
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            data = source.read(entry)
            if entry.filename == 'EPUB/one.xhtml':
                data = data.replace(b'</body>', extra.encode() + b'</body>')
            target.writestr(entry, data)
    return output.getvalue()


class EpubPublicationBrowser(ReaderBrowser):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()
        cls.browser = getattr(cls.playwright, os.environ.get('SLIDE_BROWSER', 'chromium')).launch()

    def open_resource_book(self, view='paginated', malformed=False, payload=None):
        settings = {
            'manabi-dev-foliate-epub': 'true', 'viewMode': view, 'writingMode': 'horizontal-tb',
            'hideFurigana': 'false', 'hideSpoilerImage': 'false'
        }
        self.context.add_init_script('if (location.origin === ' + json.dumps(self.origin) + ') {'
            'for (const [key,value] of Object.entries(' + json.dumps(settings) + ')) localStorage.setItem(key,value);}')
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'resources.epub', 'mimeType': 'application/epub+zip', 'buffer': resource_epub(malformed) if payload is None else payload
        })
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        if view == 'paginated':
            self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('#same')")
        else:
            expect(self.page.locator('#ttu-epub-0 .text')).to_be_visible(timeout=30000)

    def test_framed_reader_receives_imported_language_and_page_direction(self):
        self.open_resource_book(payload=rtl_language_epub())
        actual = self.page.evaluate(f"""() => {{
          const p={P}, doc=p.getContents()[0].doc, view=doc.defaultView;
          return {{lang:doc.documentElement.lang,bookDir:p.bookDir,turnDir:p.pageTurnDirection,
            hostDir:p.getAttribute('dir'),
            rootDir:view.getComputedStyle(doc.documentElement).direction,
            bodyDir:view.getComputedStyle(doc.body).direction}};
        }}""")
        self.assertEqual({
            'lang':'ja','bookDir':'rtl','turnDir':'rtl','hostDir':'rtl',
            'rootDir':'rtl','bodyDir':'ltr'
        }, actual)
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('.text')")
        again = self.page.evaluate(f"""() => {{
          const p={P}, doc=p.getContents()[0].doc, view=doc.defaultView;
          return {{lang:doc.documentElement.lang,bookDir:p.bookDir,turnDir:p.pageTurnDirection,
            hostDir:p.getAttribute('dir'),
            rootDir:view.getComputedStyle(doc.documentElement).direction,
            bodyDir:view.getComputedStyle(doc.body).direction}};
        }}""")
        self.assertEqual(actual, again)
        self.assertEqual([], self.errors)

    def test_rtl_missing_resource_keeps_current_document_direction_and_can_retry(self):
        self.open_resource_book(payload=rtl_language_epub())
        result = self.page.evaluate(f"""async () => {{
          const p={P}, section=p.sections[1], load=section.load;
          let errors=0; p.addEventListener('navigationerror',()=>errors++);
          const before={{
            index:p.getContents()[0].index,
            text:p.getContents()[0].doc.body.textContent,
            bookDir:p.bookDir,
            turnDir:p.pageTurnDirection,
            hostDir:p.getAttribute('dir')
          }};
          section.load=async()=>null;
          const failed=await p.goTo({{index:1}});
          const afterFailure={{
            index:p.getContents()[0].index,
            text:p.getContents()[0].doc.body.textContent,
            bookDir:p.bookDir,
            turnDir:p.pageTurnDirection,
            hostDir:p.getAttribute('dir')
          }};
          section.load=load;
          const retry=await p.goTo({{index:1}});
          const afterRetry={{
            index:p.getContents()[0].index,
            text:p.getContents()[0].doc.body.textContent,
            bookDir:p.bookDir,
            turnDir:p.pageTurnDirection,
            hostDir:p.getAttribute('dir')
          }};
          return {{failed,retry,errors,before,afterFailure,afterRetry}};
        }}""")
        self.assertFalse(result['failed'])
        self.assertTrue(result['retry'])
        self.assertEqual(1, result['errors'])
        self.assertEqual(result['before'], result['afterFailure'])
        self.assertEqual('rtl', result['afterRetry']['bookDir'])
        self.assertEqual('rtl', result['afterRetry']['turnDir'])
        self.assertEqual('rtl', result['afterRetry']['hostDir'])
        self.assertEqual(1, result['afterRetry']['index'])
        self.assertIn('別の章', result['afterRetry']['text'])
        self.assertEqual([], self.errors)

    def test_resource_without_language_inherits_package_language(self):
        self.open_resource_book()
        self.assertTrue(self.page.evaluate(f"async()=>await {P}.goTo({{index:1}})"))
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.index === 1")
        self.assertEqual(
            'ja',
            self.page.evaluate(f"{P}.getContents()[0].doc.documentElement.lang")
        )
        self.assertEqual([], self.errors)

    def test_resource_language_and_text_direction_override_package_fallbacks(self):
        self.open_resource_book(payload=resource_semantics_epub())
        actual = self.page.evaluate(f"""() => {{
          const p={P}, doc=p.getContents()[0].doc, view=doc.defaultView;
          return {{lang:doc.documentElement.lang,rootDir:view.getComputedStyle(doc.documentElement).direction,
            bodyDir:view.getComputedStyle(doc.body).direction}};
        }}""")
        self.assertEqual({'lang':'ja','rootDir':'rtl','bodyDir':'rtl'}, actual)
        self.assertEqual([], self.errors)

    def test_ltr_page_progression_does_not_override_rtl_chapter_text(self):
        self.open_resource_book(payload=ltr_pages_rtl_content_epub())
        actual = self.page.evaluate(f"""() => {{
          const p={P}, doc=p.getContents()[0].doc, view=doc.defaultView;
          return {{bookDir:p.bookDir,turnDir:p.pageTurnDirection,hostDir:p.getAttribute('dir'),
            rootDir:view.getComputedStyle(doc.documentElement).direction,
            bodyDir:view.getComputedStyle(doc.body).direction}};
        }}""")
        self.assertEqual({
            'bookDir':'ltr','turnDir':'ltr','hostDir':'ltr',
            'rootDir':'ltr','bodyDir':'rtl'
        }, actual)
        self.assertEqual([], self.errors)

    def test_non_linear_spine_hint_is_persisted_without_changing_current_reading_order(self):
        self.open_resource_book(payload=linear_epub())
        metadata = self.metadata()
        self.assertNotIn('linear', metadata['publication']['resources'][0])
        self.assertEqual('no', metadata['publication']['resources'][1]['linear'])
        self.assertNotIn('linear', metadata['publication']['resources'][2])

        # Reader Web has two existing sequential surfaces: Foliate pagination
        # and the legacy continuous document. Preserve the historical all-spine
        # reading order until both can adopt one explicit non-linear policy.
        self.assertTrue(self.page.evaluate(f"async()=>await {P}.goTo({{index:0,anchor:1}})"))
        self.page.evaluate(f"""async()=>{{
          const turn=await {P}.preparePageTurn(1);
          if(!turn) throw Error('Expected a next page turn');
          if(!turn.commit()) throw Error('Expected page turn commit');
        }}""")
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.index === 1")
        self.assertIn('別の章', self.page.evaluate(f"{P}.getContents()[0].doc.body.textContent"))

        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('.text')")
        self.assertEqual('no', self.metadata()['publication']['resources'][1]['linear'])
        self.assertEqual([], self.errors)

    def test_fixed_layout_epub_is_rejected_instead_of_reflowed(self):
        self.context.add_init_script(
            "localStorage.setItem('manabi-dev-foliate-epub','true');"
            "localStorage.setItem('viewMode','paginated')"
        )
        for spine_override in (False, True):
            with self.subTest(spine_override=spine_override):
                self.page.goto(self.origin + '/reader-web/manage')
                expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
                self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
                    'name': 'fixed.epub',
                    'mimeType': 'application/epub+zip',
                    'buffer': fixed_layout_epub(spine_override)
                })
                expect(
                    self.page.get_by_text(
                        'Fixed-layout EPUBs are not supported by this reader yet.',
                        exact=False
                    )
                ).to_be_visible(timeout=30000)
                expect(
                    self.page.get_by_role('button', name='Read ' + TITLE, exact=True)
                ).to_have_count(0)
                self.page.keyboard.press('Escape')
        self.assertEqual([], StaticHandler.probes)
        self.assertEqual([], self.errors)

    def test_extended_numeric_repair_preserves_paginated_author_text(self):
        self.check_numeric_repair('paginated')

    def test_extended_numeric_repair_preserves_continuous_author_text(self):
        self.check_numeric_repair('continuous')

    def check_numeric_repair(self, view):
        self.context.add_init_script("localStorage.setItem('importHTMLFixMode', 'Extended')")
        self.open_resource_book(view=view, payload=numeric_epub())
        for reload in (False, True):
            if reload:
                self.page.reload()
            selector = (f"{P}?.getContents?.()[0]?.doc" if view == 'paginated' else 'document')
            self.page.wait_for_function(f"() => {selector}?.querySelector('#literal-html')")
            actual = self.page.evaluate(f"""() => {{
              const doc={selector}, quote=doc.querySelector('#literal-quote');
              return {{text:doc.querySelector('#literal-html').textContent,
                children:doc.querySelector('#literal-html').children.length,
                entity:doc.querySelector('#literal-entity').textContent,
                title:quote.getAttribute('title'),hidden:quote.hasAttribute('hidden'),
                unicode:doc.querySelector('#literal-unicode').textContent}};
            }}""")
            self.assertEqual({
                'text':'<em>literal</em>', 'children':0, 'entity':'&#60; | &lt;',
                'title':'before" hidden="after', 'hidden':False, 'unicode':'€ 𠀀 \ufffd'
            }, actual)
            self.assertEqual([], StaticHandler.probes)
            self.assertEqual([], self.errors)

    def test_same_route_book_switch_replaces_the_publication_owner(self):
        self.open_resource_book()
        first_url = self.page.url
        other_title = 'Other resource publication'
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
            for entry in source.infolist():
                data = source.read(entry)
                if entry.filename == 'EPUB/book.opf':
                    data = data.replace(TITLE.encode(), other_title.encode())
                elif entry.filename == 'EPUB/one.xhtml':
                    data = data.replace(b'<ruby>', 'SECOND PUBLICATION <ruby>'.encode(), 1)
                target.writestr(entry, data)
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name':'second.epub','mimeType':'application/epub+zip','buffer':output.getvalue()
        })
        self.page.get_by_role('button', name='Read ' + other_title, exact=True).click(timeout=30000)
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('.text')?.textContent.includes('SECOND PUBLICATION')")
        second_url = self.page.url
        # Use a real same-origin link so SvelteKit performs same-route navigation.
        # Keep an identity witness proving this was not a full document reload.
        self.page.evaluate(f"""url => {{
          window.previousPublication={P};window.readerRouteWitness={{}};
          const a=document.createElement('a');a.href=url;a.textContent='First publication';
          document.body.append(a);a.click();a.remove();
        }}""", first_url)
        self.page.wait_for_url(first_url)
        self.page.wait_for_function(f"""() => {{
          const p={P}, text=p?.getContents?.()[0]?.doc?.querySelector('.text')?.textContent;
          return p && p!==window.previousPublication && text && !text.includes('SECOND PUBLICATION');
        }}""")
        self.assertTrue(self.page.evaluate('!!window.readerRouteWitness'))
        self.assertFalse(self.page.evaluate('window.previousPublication.isConnected'))
        self.page.evaluate(f'window.previousPublication={P}')
        self.page.go_back()
        self.page.wait_for_url(second_url)
        self.page.wait_for_function(f"""() => {{
          const p={P};return p && p!==window.previousPublication &&
            p.getContents?.()[0]?.doc?.querySelector('.text')?.textContent.includes('SECOND PUBLICATION');
        }}""")
        self.assertTrue(self.page.evaluate('!!window.readerRouteWitness'))
        self.assertFalse(self.page.evaluate('window.previousPublication.isConnected'))
        self.assertEqual([], StaticHandler.probes)
        self.assertEqual([], self.errors)

    def metadata(self):
        return self.page.evaluate('''() => new Promise((resolve,reject) => {
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result;const tx=db.transaction('data');
            const read=tx.objectStore('data').getAll();read.onerror=()=>reject(read.error);
            read.onsuccess=()=>{const b=read.result.find(b=>b.title==='Resource EPUB acceptance');db.close();
              resolve({sourceFormat:b.sourceFormat,manifest:b.publicationManifest,
                publication:b.epubPublication,html:b.elementHtml,sections:b.sections});};};
        })''')

    def color(self):
        return self.page.evaluate(f"() => {{const doc={P}.getContents()[0].doc;return doc.defaultView.getComputedStyle(doc.querySelector('.text')).color}}")

    def test_resource_styles_metadata_and_repeated_spine_survive_reload(self):
        self.open_resource_book()
        self.assertEqual('rgb(180, 0, 0)', self.color())
        before = self.metadata()
        self.assertEqual('epub', before['sourceFormat'])
        self.assertEqual(3, len(before['publication']['resources']))
        self.assertEqual(2, len(before['publication']['styleSheets']))
        self.assertEqual('paginated', before['publication']['rendition']['flow'])
        self.assertEqual('Part', before['publication']['navigation']['toc'][0]['label'])
        self.assertEqual(
            'EPUB/one.xhtml#same',
            before['publication']['navigation']['toc'][0]['subitems'][0]['href']
        )
        self.assertEqual(
            'EPUB/one.xhtml#same',
            before['publication']['navigation']['pageList'][0]['href']
        )
        self.assertEqual(
            ['bodymatter'],
            before['publication']['navigation']['landmarks'][0]['type']
        )
        self.assertEqual('第一章', before['sections'][0]['label'])
        self.assertEqual('第二章', before['sections'][1]['label'])
        self.assertEqual('EPUB/one.xhtml', before['manifest']['resources'][2]['href'])
        self.assertNotEqual(before['manifest']['resources'][0]['sectionId'], before['manifest']['resources'][2]['sectionId'])
        for resource in before['publication']['resources']:
            self.assertNotIn('html', resource)
            piece = before['html'].encode('utf-16-le')[resource['start'] * 2:resource['end'] * 2].decode('utf-16-le')
            self.assertTrue(piece.startswith('<div id=\"' + resource['sectionId'] + '\"'))
            self.assertTrue(piece.endswith('</div>'))
        self.page.evaluate(f"{P}.getContents()[0].doc.querySelector('#cross').click()")
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.index === 1 && {P}.getContents()[0]?.doc?.querySelector('#back')")
        self.assertEqual('rgb(0, 0, 180)', self.color())
        self.assertTrue(self.page.evaluate(f"async()=>await {P}.goTo({{index:2}})"))
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.doc?.querySelector('#local')")
        self.page.evaluate(f"{P}.getContents()[0].doc.querySelector('#local').click()")
        self.page.wait_for_function(f"() => {P}.getContents()[0]?.index === 2")
        self.assertEqual('rgb(180, 0, 0)', self.color())
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('.text')")
        self.assertEqual(before, self.metadata())
        self.assertEqual([], StaticHandler.probes)
        self.assertFalse(self.page.evaluate('Boolean(window.bookAttack)'))

    def test_continuous_mode_uses_the_same_safe_scoped_resources(self):
        self.open_resource_book(view='continuous')
        colors = self.page.evaluate("[0,1,2].map(i=>getComputedStyle(document.querySelector('#ttu-epub-'+i+' .text')).color)")
        self.assertEqual(['rgb(180, 0, 0)', 'rgb(0, 0, 180)', 'rgb(180, 0, 0)'], colors)
        self.assertEqual('かん', self.page.locator('#ttu-epub-0 rt').text_content())
        self.assertEqual(0, self.page.locator('.book-content script,.book-content iframe,.book-content [onerror]').count())
        self.assertEqual([], StaticHandler.probes)
        self.page.reload()
        expect(self.page.locator('#ttu-epub-0 .text')).to_be_visible(timeout=30000)
        self.assertEqual(3, len(self.metadata()['publication']['resources']))

    def test_malformed_xhtml_keeps_linked_styles_without_unsafe_fallback(self):
        self.open_resource_book(malformed=True)
        self.assertEqual('rgb(180, 0, 0)', self.color())
        self.assertEqual([], StaticHandler.probes)
        self.assertEqual(0, self.page.evaluate(f"{P}.getContents()[0].doc.querySelectorAll('script,iframe,[onerror]').length"))

    def test_legacy_record_without_resource_descriptor_keeps_its_bookmark(self):
        self.open_book(foliate=True, include_images=False)
        self.page.evaluate(f"async()=>{{const p={P};for(let i=0;i<3;i++){{const t=await p.preparePageTurn(1);if(t)t.commit();}}}}")
        self.page.keyboard.press('b')
        self.page.wait_for_function('''() => new Promise(resolve=>{
          const open=indexedDB.open('books');open.onsuccess=()=>{const db=open.result;
            const read=db.transaction('bookmark').objectStore('bookmark').getAll();
            read.onsuccess=()=>{db.close();resolve(read.result.some(b=>b.exploredCharCount>0));};};
        })''')
        saved = self.page.evaluate('''() => new Promise((resolve,reject)=>{
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);open.onsuccess=()=>{
            const db=open.result;const tx=db.transaction(['data','bookmark'],'readwrite');
            const read=tx.objectStore('data').openCursor();read.onsuccess=()=>{const c=read.result;if(!c)return;
              const value=c.value;delete value.epubPublication;c.update(value);c.continue();};
            const marks=tx.objectStore('bookmark').getAll();
            tx.oncomplete=()=>{db.close();resolve(marks.result);};tx.onabort=()=>reject(tx.error);};
        })''')
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.getContents?.()[0]?.doc?.querySelector('ruby')")
        actual = self.page.evaluate('''() => new Promise(resolve=>{const open=indexedDB.open('books');
          open.onsuccess=()=>{const db=open.result;const q=db.transaction('bookmark').objectStore('bookmark').getAll();
            q.onsuccess=()=>{db.close();resolve(q.result);};};})''')
        self.assertEqual(saved, actual)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(EpubPublicationBrowser(name) for name in EpubPublicationBrowser.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
