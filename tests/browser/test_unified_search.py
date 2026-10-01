"""Real unified search: generated EPUBs and an imported Yomitan ZIP, no result mocks.

One explicitly named test blocks the dictionary manifest to verify failure isolation.
Composition tests emulate DOM contracts; they do not claim physical IME coverage.
"""
import io
import json
import re
import unittest
import zipfile
from playwright.sync_api import expect
from test_product_journeys import ProductJourneyBase


def dictionary_archive():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('index.json', json.dumps({'title': 'Unified search fixture', 'revision': '1', 'format': 3, 'sequenced': True}))
        archive.writestr('term_bank_1.json', json.dumps([
            ['猫', 'ねこ', '', '', 0, [{'type': 'structured-content', 'content': {'tag': 'span', 'content': [
                {'tag': 'b', 'content': 'A household cat. '}, '<script>text, not executable HTML</script> ' + 'Long definition. ' * 800]}}], 1, ''],
            ['学校', 'がっこう', '', '', 0, ['school'], 2, ''],
            ['食べる', 'たべる', '', 'v1', 0, ['to eat'], 3, '']
        ], ensure_ascii=False))
    return output.getvalue()


class UnifiedSearch(ProductJourneyBase):
    def seed_video_search(self, title='Searchable video', cues=None, delay=2.5):
        cues = cues or [
            {'id': 'cue-one', 'start': 12, 'end': 14, 'text': '字幕検索 first result'},
            {'id': 'cue-two', 'start': 30, 'end': 32, 'text': '別の字幕 second result'}
        ]
        return self.page.evaluate("""async ({title,cues,delay}) => {
          const mediaKey='content:'+'a'.repeat(64);
          const trackId='00000000-0000-4000-8000-000000000123';
          const canonical=value=>{
            if(value===null||typeof value!=='object')return JSON.stringify(value);
            if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
            return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
          };
          const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest(
            'SHA-256',new TextEncoder().encode(canonical(value)))))
            .map(n=>n.toString(16).padStart(2,'0')).join('');
          const cueDigest=await digest(cues);
          const info={version:1,title,duration:120,width:1280,height:720,addedAt:Date.now()};
          const resume={version:1,mediaKey,position:0,duration:120,rate:1,finished:false,
            updatedAt:Date.now(),primary:trackId,secondary:null,delays:{[trackId]:delay}};
          const metadata={version:1,id:trackId,mediaKey,label:'Japanese captions',language:'ja',
            kind:'transcription',origin:'sidecar',complete:true,forced:false,createdAt:Date.now()};
          const manifest={version:1,track:metadata,pages:[{id:trackId+'/p/0',digest:cueDigest}],
            count:cues.length,digest:cueDigest};
          const chunk={version:1,trackId,index:0,cues};
          const rows=[
            ['video_info',mediaKey,info],
            ['video_resume',mediaKey,resume],
            ['video_track',trackId,manifest],
            ['video_chunk',trackId+'/p/0',chunk]
          ];
          const request=indexedDB.open('manabi-media-v1',1);
          const db=await new Promise((yes,no)=>{
            request.onupgradeneeded=()=>{
              for(const name of ['local','records'])
                if(!request.result.objectStoreNames.contains(name))
                  request.result.createObjectStore(name);
            };
            request.onsuccess=()=>yes(request.result);request.onerror=()=>no(request.error);
          });
          await new Promise((yes,no)=>{
            const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
            for(const [kind,id,payload] of rows){
              const replica={scope:'guest',kind,id,mediaKey,payload,base:payload,revision:1,
                localVersion:crypto.randomUUID(),dirty:false};
              store.put(replica,JSON.stringify(['guest',kind,id]));
            }
            tx.oncomplete=yes;tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);
          });
          db.close();
          return {mediaKey,trackId};
        }""", {'title': title, 'cues': cues, 'delay': delay})

    def replace_video_cues(self, identity, cues):
        self.page.evaluate("""async ({identity,cues}) => {
          const canonical=value=>{
            if(value===null||typeof value!=='object')return JSON.stringify(value);
            if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
            return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
          };
          const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest(
            'SHA-256',new TextEncoder().encode(canonical(value)))))
            .map(n=>n.toString(16).padStart(2,'0')).join('');
          const db=await new Promise((yes,no)=>{
            const r=indexedDB.open('manabi-media-v1');r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);
          });
          const manifestKey=JSON.stringify(['guest','video_track',identity.trackId]);
          const pageKey=JSON.stringify(['guest','video_chunk',identity.trackId+'/p/0']);
          const old=await new Promise((yes,no)=>{
            const tx=db.transaction('records','readonly'),q=tx.objectStore('records').get(manifestKey);
            q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error);
          });
          const d=await digest(cues);
          const manifest={...old,payload:{...old.payload,pages:[{id:identity.trackId+'/p/0',digest:d}],
            count:cues.length,digest:d},base:{...old.base,pages:[{id:identity.trackId+'/p/0',digest:d}],
            count:cues.length,digest:d},localVersion:crypto.randomUUID()};
          const chunkPayload={version:1,trackId:identity.trackId,index:0,cues};
          const chunk={scope:'guest',kind:'video_chunk',id:identity.trackId+'/p/0',
            mediaKey:identity.mediaKey,payload:chunkPayload,base:chunkPayload,revision:1,
            localVersion:crypto.randomUUID(),dirty:false};
          await new Promise((yes,no)=>{
            const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
            store.put(manifest,manifestKey);store.put(chunk,pageKey);
            tx.oncomplete=yes;tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);
          });
          db.close();
          const channel=new BroadcastChannel('manabi-media-v1');
          channel.postMessage({type:'media-change',captions:true});channel.close();
        }""", {'identity': identity, 'cues': cues})

    def assert_no_document_horizontal_overflow(self):
        diagnostic = self.page.evaluate(r"""() => {
          const root = document.documentElement;
          const overflow = root.scrollWidth - innerWidth;
          if (overflow <= 1) return {overflow, active: null, offenders: []};
          const describe = (node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              tag: node.tagName.toLowerCase(),
              id: node.id,
              className: typeof node.className === 'string' ? node.className : '',
              role: node.getAttribute('role'),
              ariaLabel: node.getAttribute('aria-label'),
              text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
              left: rect.left,
              right: rect.right,
              width: rect.width,
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              overflowX: style.overflowX,
              outlineWidth: style.outlineWidth,
              outlineOffset: style.outlineOffset,
              boxShadow: style.boxShadow
            };
          };
          const offenders = [...document.querySelectorAll('body *')]
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.left < -1 ||
                rect.right > innerWidth + 1 ||
                node.scrollWidth > node.clientWidth + 1
              );
            })
            .slice(0, 20)
            .map(describe);
          return {
            overflow,
            active: document.activeElement instanceof Element ? describe(document.activeElement) : null,
            offenders
          };
        }""")
        self.assertLessEqual(
            diagnostic['overflow'],
            1,
            f"document horizontal overflow: {json.dumps(diagnostic, ensure_ascii=False)}",
        )

    def filter(self, name):
        button = self.page.get_by_role('group', name='Show').get_by_role(
            'button', name=name, exact=True)
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')
        return button

    def scope(self, name):
        button = self.page.get_by_role('group', name='Search in').get_by_role(
            'button', name=name, exact=True)
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')
        expect(button).to_be_focused()
        return button

    def test_library_section_switch_is_reachable_and_clear_of_desktop_sidebar(self):
        for width, text_size in ((1200, '100%'), (320, '200%')):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 900})
                self.page.evaluate('size => document.documentElement.style.fontSize = size', text_size)
                nav = self.page.get_by_role('navigation', name='Library sections', exact=True)
                expect(nav).to_be_visible()
                if width >= 1024:
                    rail = self.page.get_by_role('complementary', name='Collections', exact=True)
                    self.assertGreaterEqual(nav.bounding_box()['x'],
                                            rail.bounding_box()['x'] + rail.bounding_box()['width'])
                else:
                    # Stress wider platform fonts without depending on a font
                    # that is installed on only one development/CI machine.
                    nav.evaluate("e => {e.style.fontFamily = 'monospace'; e.style.letterSpacing = '.15em'}")
                self.assertLessEqual(nav.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
                self.assert_no_document_horizontal_overflow()
                for name in ('Books', 'Videos'):
                    link = nav.get_by_role('link', name=name, exact=True)
                    self.assertGreaterEqual(link.bounding_box()['height'], 43.99)
                self.checkpoint('library-sections-' + str(width))
                videos = nav.get_by_role('link', name='Videos', exact=True)
                if width == 320:
                    videos.focus()
                    self.page.keyboard.press('Enter')
                else:
                    videos.click()
                expect(self.page).to_have_url(re.compile(r'/reader-web/videos$'))
                self.page.get_by_role('navigation', name='Library sections', exact=True).get_by_role(
                    'link', name='Books', exact=True).click()
                expect(self.page).to_have_url(re.compile(r'/reader-web/manage$'))
                expect(self.page.get_by_role('region', name='Library shelves')).to_have_attribute(
                    'data-hydrated', 'true')

    def test_title_results_prioritize_relevance_across_source_types(self):
        self.seed_video_search(title='cat')
        self.import_book('Dog guide', body='<p>Unrelated body text.</p>', creators=('cat',))
        for title in ('Copycat notes', 'A cat story', 'Cat guide'):
            self.import_book(title, body='<p>Unrelated body text.</p>')
        self.library_search('cat')
        self.filter('Titles')
        titles = self.page.locator('[data-search-row="titles"] strong')
        expect(titles).to_have_count(5)
        self.assertEqual(
            ['cat', 'Cat guide', 'A cat story', 'Copycat notes', 'Dog guide'],
            titles.all_text_contents(),
        )
        rows = self.page.locator('[data-search-row="titles"]')
        kinds = rows.locator('small')
        expect(kinds).to_have_count(5)
        self.assertTrue(kinds.nth(0).inner_text().startswith('Video'))
        self.assertEqual('Book · Author · cat', kinds.nth(4).inner_text())
        self.assertTrue(all(kinds.nth(index).inner_text().startswith('Book') for index in range(1, 5)))
        expect(rows.nth(4)).to_have_accessible_name('Read Dog guide')
        expect(rows.nth(4)).to_have_accessible_description('Book · Author · cat')
        expect(rows.nth(0).locator('mark')).to_have_text('cat')
        expect(rows.nth(4).locator('strong mark')).to_have_count(0)
        expect(rows.nth(4).locator('small mark')).to_have_text('cat')
        self.checkpoint('unified-title-relevance')

    def test_title_ranking_keeps_creator_only_metadata_matches(self):
        self.seed_video_search(title='cat author')
        self.import_book(
            'Completely Different Book',
            body='<p>Unrelated body text.</p>',
            creators=('Cat Author',),
        )
        self.library_search('cat author')
        self.filter('Titles')
        titles = self.page.locator('[data-search-row="titles"] strong')
        expect(titles).to_have_count(2)
        self.assertEqual(
            ['cat author', 'Completely Different Book'],
            titles.all_text_contents(),
        )
        kinds = self.page.locator('[data-search-row="titles"] small')
        self.assertTrue(kinds.nth(0).inner_text().startswith('Video'))
        self.assertIn('Cat Author', kinds.nth(1).inner_text())
        self.checkpoint('unified-title-creator-match-retained')

    def test_local_dictionary_management_disable_enable_and_delete(self):
        field = self.library_search('neko')
        self.filter('Dictionary')
        expect(self.page.get_by_text('No enabled local dictionary yet.', exact=False)).to_be_visible(
            timeout=30000
        )
        self.page.get_by_label('Import dictionary ZIP', exact=True).set_input_files({
            'name': 'managed-fixture.zip',
            'mimeType': 'application/zip',
            'buffer': dictionary_archive(),
        })
        expect(
            self.page.get_by_text('Installed Unified search fixture.', exact=True)
        ).to_be_visible(timeout=60000)
        expect(self.page.locator('.full-dictionary .headword')).to_contain_text('猫')

        setup = self.page.get_by_text('Local dictionaries', exact=True)
        setup.click()
        installed = self.page.get_by_role('list', name='Installed local dictionaries', exact=True)
        expect(installed).to_be_visible()
        row = installed.get_by_role('listitem').filter(has_text='Unified search fixture')
        expect(row).to_contain_text('Enabled')
        row.get_by_role('button', name='Disable', exact=True).click()
        expect(self.page.get_by_text('Disabled Unified search fixture.', exact=True)).to_be_visible()
        expect(row).to_contain_text('Disabled')
        expect(self.page.get_by_text('No enabled local dictionary yet.', exact=False)).to_be_visible(
            timeout=30000
        )

        row.get_by_role('button', name='Enable', exact=True).click()
        expect(self.page.get_by_text('Enabled Unified search fixture.', exact=True)).to_be_visible()
        expect(row).to_contain_text('Enabled')
        expect(self.page.locator('.full-dictionary .headword')).to_contain_text('猫', timeout=30000)
        expect(field).to_have_value('neko')

        row.get_by_role('button', name='Delete…', exact=True).click()
        expect(row.get_by_text('Delete this dictionary?', exact=True)).to_be_visible()
        row.get_by_role('button', name='Cancel', exact=True).click()
        expect(row.get_by_text('Delete this dictionary?', exact=True)).to_have_count(0)
        row.get_by_role('button', name='Delete…', exact=True).click()
        row.get_by_role('button', name='Delete', exact=True).click()
        expect(self.page.get_by_text('Deleted Unified search fixture.', exact=True)).to_be_visible(
            timeout=30000
        )
        expect(self.page.get_by_text('No local dictionaries are installed.', exact=True)).to_be_visible()
        expect(self.page.get_by_text('No enabled local dictionary yet.', exact=False)).to_be_visible(
            timeout=30000
        )
        self.checkpoint('dictionary-local-management')

    def test_real_local_dictionary_uses_raw_input_and_bounded_previews(self):
        self.import_book('Neko field guide', body='<p>neko ねこ 猫</p>')
        field = self.library_search('neko')
        filters = self.page.get_by_role('group', name='Show')
        self.assertEqual(['All', 'Dictionary', 'Titles', 'Content'], filters.get_by_role('button').all_text_contents())
        expect(filters.get_by_role('button', name='All', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(self.page.get_by_role('button', name='Read Neko field guide', exact=True)).to_be_visible()
        self.filter('Dictionary')
        expect(self.page.get_by_text('No enabled local dictionary yet.', exact=False)).to_be_visible(timeout=30000)
        self.page.get_by_label('Import dictionary ZIP', exact=True).set_input_files({
            'name': 'unified-fixture.zip', 'mimeType': 'application/zip', 'buffer': dictionary_archive()})
        expect(self.page.get_by_text('Installed Unified search fixture.', exact=True)).to_be_visible(timeout=60000)
        full = self.page.locator('.full-dictionary')
        expect(full.locator('.headword')).to_contain_text('猫')
        expect(full.locator('script, iframe')).to_have_count(0)
        self.assertGreater(len(full.inner_text()), 10000)

        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.assertLessEqual(full.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        self.assert_no_document_horizontal_overflow()
        controls = self.page.locator('.search-controls')
        self.assertEqual('static', controls.evaluate('e => getComputedStyle(e).position'))
        setup = self.page.get_by_text('Local dictionaries', exact=True)
        setup.scroll_into_view_if_needed()
        self.assertGreaterEqual(setup.bounding_box()['height'], 43.99)
        setup.click()
        install = self.page.get_by_role('button', name='Install Jitendex', exact=True)
        expect(install).to_be_visible()
        self.assertGreaterEqual(install.bounding_box()['height'], 43.99)
        self.checkpoint('unified-full-dictionary-200-percent')
        self.page.evaluate('document.documentElement.style.fontSize = "100%"')
        self.page.set_viewport_size({'width': 1280, 'height': 800})

        expect(field).to_have_value('neko')
        field.fill('gakko')
        expect(
            self.page.get_by_text('Showing prefix matches for がっこ', exact=True)
        ).to_be_visible(timeout=30000)
        expect(full.locator('.headword')).to_contain_text('学校')
        field.fill('がっこ')
        expect(
            self.page.get_by_text('Showing prefix matches for がっこ', exact=True)
        ).to_be_visible(timeout=30000)
        expect(full.locator('.headword')).to_contain_text('学校')

        field.fill('gakkou')
        expect(
            self.page.get_by_text('Showing prefix matches for', exact=False)
        ).to_have_count(0)
        expect(full.locator('.headword')).to_contain_text('学校')
        expect(field).to_have_value('gakkou')
        expect(field).to_be_focused()
        field.fill('tabemashita')
        expect(full.locator('.headword')).to_contain_text('食べる')
        field.fill('neko')
        expect(full.locator('.headword')).to_contain_text('猫')
        self.filter('All')
        preview = self.page.get_by_role('list', name='Dictionary previews')
        expect(preview.get_by_role('button')).to_have_count(1)
        self.assertLess(len(preview.inner_text()), 600)
        expect(full).to_have_count(0)
        expect(field).to_have_value('neko')
        expect(self.page.get_by_role('button', name='Read Neko field guide', exact=True)).to_be_visible()
        expect(self.page.locator('button.passage')).to_have_count(1)
        self.checkpoint('unified-all-real-dictionary')
        self.page.set_viewport_size({'width': 360, 'height': 740})
        self.page.wait_for_function(
            'e => e.scrollWidth <= e.clientWidth + 1',
            arg=self.page.locator('.unified-search').element_handle())
        self.checkpoint('unified-mobile-preview')

    def test_dictionary_asset_failure_does_not_block_titles_or_passages(self):
        for index in range(3):
            self.import_book(f'猫 guide {index}', body=f'<p>猫 passage {index}</p>')
        self.page.route('**/manabitan/*/manifest.json', lambda route: route.abort())
        field = self.library_search('猫')
        expect(self.page.get_by_role('button', name='Retry dictionary', exact=True)).to_be_visible()
        expect(self.page.locator('[data-search-row="titles"]')).to_have_count(2)
        expect(self.page.locator('[data-search-row="content"]')).to_have_count(2)
        expect(field).to_have_value('猫')
        self.page.get_by_role('button', name='See all titles', exact=True).click()
        expect(self.page.locator('[data-search-row="titles"]')).to_have_count(3)
        expect(self.page.get_by_role('button', name='Titles', exact=True)).to_be_focused()
        self.filter('Content')
        expect(self.page.locator('[data-search-row="content"]')).to_have_count(3)
        self.page.get_by_role('button', name='Open passage in 猫 guide 2: 猫', exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('.book-content').first).to_contain_text('猫 passage 2')
        self.checkpoint('unified-independent-content-navigation')

    def test_library_scope_switches_real_books_and_snippets_without_losing_query(self):
        self.import_book('Scope book', body='<p>SCOPE_TOKEN book body</p>')
        self.page.goto(self.origin + '/reader-web/snippets')
        create = self.page.get_by_role('button', name='New snippet', exact=True)
        expect(create).to_be_enabled()
        create.click()
        editor = self.page.locator('.editor-host [contenteditable="true"]')
        expect(editor).to_be_editable(timeout=30000)
        self.page.get_by_label('Snippet title', exact=True).fill('Scope snippet')
        editor.fill('SCOPE_TOKEN snippet body')

        save = self.page.get_by_role('button', name='Save snippet', exact=True)
        save.click()
        picker = self.page.get_by_role('dialog', name='Save location', exact=True)
        expect(picker).to_be_visible()
        picker.get_by_role('button', name='Keep on this device only', exact=True).click()
        expect(picker).to_have_count(0)
        save.click()
        snippet = self.page.get_by_role('article', name='Snippet content', exact=True)
        expect(snippet).to_contain_text('SCOPE_TOKEN snippet body')
        expect(self.page.get_by_role('heading', name='Scope snippet', exact=True)).to_be_visible()

        self.go_library()
        field = self.library_search('SCOPE_TOKEN')
        scopes = self.page.get_by_role('group', name='Search in')
        result_types = self.page.get_by_role('group', name='Show')
        self.assertEqual(
            ['Everything', 'Books', 'Snippets'],
            scopes.get_by_role('button').all_text_contents())
        expect(scopes.get_by_role('button', name='Everything', exact=True)).to_have_attribute(
            'aria-pressed', 'true')

        self.filter('Content')
        rows = self.page.locator('[data-search-row="content"] small')
        expect(rows).to_have_count(2, timeout=30000)
        self.assertTrue(any('Book · Scope book' in value for value in rows.all_text_contents()))
        self.assertTrue(any('Snippet · Scope snippet' in value for value in rows.all_text_contents()))

        self.scope('Books')
        expect(field).to_have_value('SCOPE_TOKEN')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_have_count(0)
        expect(rows).to_have_count(1, timeout=30000)
        expect(rows).to_contain_text('Book · Scope book')

        self.scope('Snippets')
        expect(field).to_have_value('SCOPE_TOKEN')
        expect(rows).to_have_count(1, timeout=30000)
        expect(rows).to_contain_text('Snippet · Scope snippet')
        snippet_match = self.page.get_by_role(
            'button', name='Open passage in Scope snippet: SCOPE_TOKEN', exact=True)
        expect(snippet_match.locator('mark')).to_have_text('SCOPE_TOKEN')
        self.assertIn('scope=snippets', self.page.url)

        # Scope belongs to navigation state, not an ephemeral child component.
        self.page.reload()
        expect(self.page.get_by_role('group', name='Search in').get_by_role(
            'button', name='Snippets', exact=True
        )).to_have_attribute('aria-pressed', 'true')
        expect(self.page.get_by_role('searchbox', name='Search library', exact=True)).to_have_value(
            'SCOPE_TOKEN'
        )
        rows = self.page.locator('[data-search-row="content"] small')
        expect(rows).to_have_count(1, timeout=30000)
        expect(rows).to_contain_text('Snippet · Scope snippet')

        self.scope('Everything')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_be_visible()
        expect(rows).to_have_count(2, timeout=30000)
        self.assertNotIn('scope=', self.page.url)

        self.filter('Dictionary')
        self.scope('Books')
        expect(result_types.get_by_role('button', name='Dictionary', exact=True)).to_have_count(0)
        expect(result_types.get_by_role('button', name='All', exact=True)).to_have_attribute(
            'aria-pressed', 'true')
        expect(field).to_have_value('SCOPE_TOKEN')
        self.checkpoint('unified-library-scope-switching')

    def test_content_search_updates_book_name_after_rename_in_another_tab(self):
        self.import_book('Original book name', body='<p>UNIQUE_BODY_TOKEN</p>')
        self.library_search('UNIQUE_BODY_TOKEN')
        self.filter('Content')
        passage = self.page.locator('[data-search-row="content"]')
        expect(passage).to_have_count(1)
        expect(passage).to_have_accessible_name('Open passage in Original book name: UNIQUE_BODY_TOKEN')
        editor = self.context.new_page()
        editor.on('pageerror', lambda error: self.errors.append(error.stack or str(error)))
        try:
            editor.goto(self.origin + '/reader-web/manage')
            expect(editor.get_by_role('region', name='Library shelves')).to_have_attribute(
                'data-hydrated', 'true')
            editor.get_by_role('button', name='Actions for Original book name', exact=True).click()
            editor.get_by_role('menuitem', name='Rename…', exact=True).click()
            dialog = editor.get_by_role('dialog', name='Rename book', exact=True)
            dialog.get_by_label('Name', exact=True).fill('Renamed book')
            dialog.get_by_role('button', name='Save', exact=True).click()
            expect(editor.get_by_role('button', name='Read Renamed book', exact=True)).to_be_visible()
            expect(passage.locator('small')).to_contain_text('Renamed book')
            expect(passage).to_have_accessible_name('Open passage in Renamed book: UNIQUE_BODY_TOKEN')
            self.checkpoint('content-search-renamed-book')
        finally:
            editor.close()

    def test_new_query_owns_content_and_searchbox_focus(self):
        self.import_book('Live search ownership', body='<p>猫</p><p>犬</p>')
        field = self.library_search('猫')
        self.filter('Content')
        expect(self.page.locator('button.passage mark')).to_have_text('猫')
        field.fill('猫')
        field.fill('犬')
        expect(self.page.locator('button.passage mark')).to_have_text('犬')
        expect(field).to_be_focused()
        expect(self.page.locator('button.passage')).to_have_count(1)
        self.checkpoint('unified-latest-query')

    def test_video_titles_and_published_transcripts_join_unified_search_without_media_io(self):
        identity = self.seed_video_search()
        field = self.library_search('Searchable')
        expect(self.page.get_by_role('button', name='Open video Searchable video', exact=True)).to_be_visible()
        title = self.page.get_by_role('button', name='Open video Searchable video', exact=True)
        expect(title).to_contain_text('Video')
        self.scope('Books')
        expect(title).to_have_count(0)
        self.scope('Snippets')
        expect(title).to_have_count(0)
        self.scope('Everything')
        expect(title).to_be_visible()

        field.fill('字幕検索')
        transcript = self.page.get_by_role(
            'button', name='Open transcript in Searchable video at 0:14: 字幕検索 first result',
            exact=True)
        expect(transcript).to_be_visible(timeout=30000)
        expect(transcript).to_contain_text('Video · Searchable video · 0:14 · Japanese captions')
        expect(transcript.locator('mark')).to_have_text('字幕検索')
        self.scope('Books')
        expect(transcript).to_have_count(0)
        self.scope('Everything')
        expect(transcript).to_be_visible()

        # Search operates only on published local records. It neither resolves a
        # File/cloud alias nor creates source state merely because a hit exists.
        local_count = self.page.evaluate("""async () => {
          const db=await new Promise((yes,no)=>{const r=indexedDB.open('manabi-media-v1');
            r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error)});
          const count=await new Promise((yes,no)=>{const tx=db.transaction('local','readonly');
            const q=tx.objectStore('local').count();q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error)});
          db.close();return count;
        }""")
        self.assertEqual(0, local_count)

        transcript.click()
        expect(self.page).to_have_url(__import__('re').compile(r'/videos\?'))
        params = self.page.evaluate("""() => Object.fromEntries(new URL(location.href).searchParams)""")
        self.assertEqual(identity['mediaKey'], params['media'])
        self.assertEqual('14.5', params['time'])
        self.assertEqual(identity['trackId'], params['track'])

        # This fixture intentionally publishes durable metadata/captions without
        # a reconnectable local/cloud alias. The receiver must keep the Videos
        # library usable, explain the reconnect requirement, and never invent a
        # source merely because the global search result was actionable.
        expect(self.page.get_by_role('heading', name='Videos', exact=True)).to_be_visible()
        expect(self.page.get_by_role('status')).to_contain_text(
            'Reopen this video to reconnect its local file, or sign in to reconnect its cloud folder.',
            timeout=30000,
        )
        expect(self.page.get_by_role('button', name='Searchable video', exact=True)).to_be_visible()
        expect(self.page.locator('.manabi-video-player')).to_have_count(0)
        local_count_after = self.page.evaluate("""async () => {
          const db=await new Promise((yes,no)=>{const r=indexedDB.open('manabi-media-v1');
            r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error)});
          const count=await new Promise((yes,no)=>{const tx=db.transaction('local','readonly');
            const q=tx.objectStore('local').count();q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error)});
          db.close();return count;
        }""")
        self.assertEqual(0, local_count_after)
        self.checkpoint('unified-video-transcript-deep-link')

    def test_video_transcript_search_refreshes_after_published_track_change_and_latest_query_wins(self):
        identity = self.seed_video_search()
        field = self.library_search('字幕検索')
        expect(self.page.get_by_text('字幕検索 first result', exact=True)).to_be_visible(timeout=30000)

        field.fill('別の字幕')
        expect(self.page.get_by_text('別の字幕 second result', exact=True)).to_be_visible()
        expect(self.page.get_by_text('字幕検索 first result', exact=True)).to_have_count(0)

        replacement = [
            {'id': 'cue-three', 'start': 44, 'end': 46, 'text': '更新字幕 refreshed result'}
        ]
        self.replace_video_cues(identity, replacement)
        field.fill('更新字幕')
        expect(self.page.get_by_text('更新字幕 refreshed result', exact=True)).to_be_visible(timeout=30000)
        expect(self.page.get_by_text('別の字幕 second result', exact=True)).to_have_count(0)
        self.checkpoint('unified-video-transcript-refresh')

    def test_dictionary_query_limit_counts_unicode_characters_and_recovers(self):
        field = self.library_search('𠮷' * 256)
        self.filter('Dictionary')
        # 256 supplementary-plane characters are 512 UTF-16 code units but
        # must still be accepted as 256 user-visible search characters all the
        # way through the pinned runtime. A generic runtime/protocol failure is
        # not an acceptable substitute for passing host validation.
        expect(self.page.get_by_text(
            'Use a dictionary query of 256 characters or fewer.', exact=False
        )).to_have_count(0)
        expect(self.page.get_by_role('button', name='Retry dictionary', exact=True)).to_have_count(
            0, timeout=30000)
        expect(self.page.get_by_text(
            'No enabled local dictionary yet.', exact=False
        )).to_be_visible(timeout=30000)

        field.fill('𠮷' * 257)
        expect(self.page.get_by_text(
            'Use a dictionary query of 256 characters or fewer.', exact=False
        )).to_be_visible()
        expect(self.page.get_by_role('button', name='Retry dictionary', exact=True)).to_have_count(0)

        field.fill('猫')
        expect(self.page.get_by_text(
            'Use a dictionary query of 256 characters or fewer.', exact=False
        )).to_have_count(0)
        expect(self.page.get_by_role('button', name='Retry dictionary', exact=True)).to_have_count(
            0, timeout=30000)
        expect(self.page.get_by_text(
            'No enabled local dictionary yet.', exact=False
        )).to_be_visible(timeout=30000)
        self.checkpoint('dictionary-unicode-limit-recovered')


    def test_unified_search_reflows_at_200_percent_text_on_short_phone(self):
        self.import_book(
            'とても長い日本語の検索結果タイトルと読書ガイド',
            body='<p>検索対象の猫についてのとても長い本文です。</p>' * 40
        )
        self.page.set_viewport_size({'width': 320, 'height': 480})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        field = self.library_search('猫')
        self.assertGreaterEqual(field.bounding_box()['width'], 64)
        results = self.page.get_by_label('Library search results', exact=True)
        expect(results).to_be_visible()
        self.assertLessEqual(results.evaluate('e => e.scrollWidth-e.clientWidth'), 1)
        self.assert_no_document_horizontal_overflow()

        controls = results.locator('.search-controls')
        self.assertEqual('static', controls.evaluate('e => getComputedStyle(e).position'))
        scopes = self.page.get_by_role('group', name='Search in')
        filters = self.page.get_by_role('group', name='Show')
        for nav, names in (
            (scopes, ('Everything', 'Books', 'Snippets')),
            (filters, ('All', 'Dictionary', 'Titles', 'Content')),
        ):
            for name in names:
                button = nav.get_by_role('button', name=name, exact=True)
                box = button.bounding_box()
                self.assertGreaterEqual(box['height'], 43.99)
                self.assertGreaterEqual(box['x'], -1)
                self.assertLessEqual(box['x'] + box['width'], 321)

        icon = results.locator('.type-icon').first
        expect(icon).to_be_visible()
        self.assertLessEqual(icon.bounding_box()['width'], 41)
        self.filter('Content')
        passages = self.page.locator('[data-search-row="content"]')
        expect(passages.first).to_be_visible()
        expect(self.page.get_by_text('Searching saved content…', exact=True)).to_have_count(
            0, timeout=30000)
        self.assertGreaterEqual(passages.count(), 10)
        passages.last.scroll_into_view_if_needed()
        self.assertTrue(passages.last.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))
        self.checkpoint('unified-200-percent-short-phone')

        # On a normal-height viewport the two control rows may stick, but must
        # act as one stack below the Library toolbar rather than overlap at top:0.
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.evaluate('document.documentElement.style.fontSize = "100%"')
        passages.last.scroll_into_view_if_needed()
        self.page.wait_for_function('''controls => {
          const style = getComputedStyle(controls);
          const box = controls.getBoundingClientRect();
          return style.position === 'sticky' && box.top >= 0;
        }''', arg=controls.element_handle())
        toolbar = self.page.get_by_role('banner', name='Library toolbar', exact=True)
        control_box = controls.bounding_box()
        toolbar_box = toolbar.bounding_box()
        scope_box = scopes.bounding_box()
        filter_box = filters.bounding_box()
        self.assertGreaterEqual(
            control_box['y'], toolbar_box['y'] + toolbar_box['height'] - 1)
        self.assertLessEqual(
            scope_box['y'] + scope_box['height'], filter_box['y'] + 1)
        self.assertLessEqual(control_box['y'] + control_box['height'], 845)
        self.checkpoint('unified-sticky-control-stack')

        field.focus()
        expect(field).to_be_focused()

if __name__ == '__main__':
    unittest.main(verbosity=2)
