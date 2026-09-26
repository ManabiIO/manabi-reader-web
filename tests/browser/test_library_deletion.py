"""Production DatabaseService deletion against native IndexedDB.

The batch race uses the real progress event between committed book deletions.
Only the failure case injects a native transaction abort. No errors are suppressed.
"""
import json
import os
from pathlib import Path
import tempfile
import unittest
from test_shared_safety import SharedStorageRuntime
from test_books_library import LibraryBase
from playwright.sync_api import expect


class LibraryDeletionRuntime(SharedStorageRuntime):
    def new_context(self):
        # SharedStorageRuntime's parent is intentionally Chromium-only for OPFS.
        # This suite has no filesystem dependency: run its actual page in the
        # requested engine, not a Chromium page labeled as WebKit by CI.
        self.engine = os.environ.get('LIBRARY_BROWSER', 'chromium')
        profile = tempfile.TemporaryDirectory(prefix='reader-delete-' + self.engine + '-')
        self.addCleanup(profile.cleanup)
        context = getattr(self.playwright, self.engine).launch_persistent_context(profile.name)
        self.assertEqual(self.engine, context.browser.browser_type.name)
        return context

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            report = {'engine':self.engine, 'test':self._testMethodName,
                      'pageErrors':self.errors, 'userAgent':self.page.evaluate('navigator.userAgent')}
            (output / (self.engine + '-' + self._testMethodName + '.json')).write_text(json.dumps(report))
        finally:
            super().tearDown()

    def test_batch_deletion_rechecks_resume_and_removes_late_bookmarks(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const {replicationProgress$} = await import('/reader-web/src/lib/functions/replication/replication-progress.ts');
          const db = await database.db;
          const ids = [];
          for (const title of ['Delete first', 'Keep reading', 'Delete last'])
            ids.push(await db.add('data', {title, elementHtml:'<p>Reading.</p>', styleSheet:'', blobs:{}, sections:[]}));
          await db.put('lastItem', {dataId:ids[2]}, 0);
          let writes = [], changed = false;
          const subscription = replicationProgress$.subscribe(event => {
            if (event.progressToAdd !== 1 || changed) return;
            changed = true;
            // Another reader's writes are enqueued after the first deletion commits,
            // but before deletion of the next selected book starts.
            writes = [db.put('lastItem', {dataId:ids[1]}, 0),
              db.put('bookmark', {dataId:ids[2], progress:37, lastBookmarkModified:2})];
          });
          let outcome;
          try {
            outcome = await database.deleteData([ids[0], ids[2]], new Map([[ids[0], 'Delete first'],
              [ids[2], 'Delete last']]), new AbortController().signal, true);
            await Promise.all(writes);
          } finally { subscription.unsubscribe(); }
          return {outcome, changed, last:await db.get('lastItem',0) ?? null,
            bookmark:await db.get('bookmark',ids[2]) ?? null, remaining:await db.getAllKeys('data'), ids};
        }""")
        self.assertTrue(result['changed'])
        self.assertEqual('', result['outcome']['error'])
        self.assertEqual([result['ids'][0], result['ids'][2]], result['outcome']['deleted'])
        self.assertEqual({'dataId':result['ids'][1]}, result['last'])
        self.assertIsNone(result['bookmark'])
        self.assertEqual([result['ids'][1]], result['remaining'])

    def test_native_delete_abort_is_visible_atomic_and_retryable(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const db = await database.db;
          const title = 'Retry deletion', bookKey = 'content:'+'c'.repeat(64);
          const id = await db.add('data', {title, contentHash:'c'.repeat(64), elementHtml:'<p>Keep on abort.</p>', styleSheet:'', blobs:{}, sections:[]});
          await db.put('bookmark', {dataId:id, progress:37, lastBookmarkModified:2});
          await db.put('lastItem', {dataId:id}, 0);
          await db.put('readerStatistic', {bookKey,title,dateKey:'2026-09-26',charactersRead:35,
            readingTime:1,lastStatisticModified:2});
          await db.put('lastModified', {title:bookKey,dataType:'statistic',lastModifiedValue:2});
          await db.put('readerSearchProjection', {bookId:id, indexVersion:1, fingerprint:'failure fixture', resources:[]});
          await db.put('audioBook', {title,lastAudioBookModified:2,currentTime:8});
          const snapshot = async () => ({book:await db.get('data',id), bookmark:await db.get('bookmark',id),
            last:await db.get('lastItem',0), statistics:await db.getAll('readerStatistic'),
            timestamps:await db.getAll('lastModified'), cache:await db.getAll('readerSearchProjection'),
            audio:await db.getAll('audioBook')});
          const before = await snapshot();
          const original = IDBObjectStore.prototype.delete;
          let aborted = false, outcome;
          IDBObjectStore.prototype.delete = function(...args) {
            const request = original.apply(this,args);
            if (this.transaction.db.name === 'books' && this.name === 'data') {
              aborted = true; this.transaction.abort();
            }
            return request;
          };
          try { outcome = await database.deleteData([id], new Map([[id,title]]), new AbortController().signal, false); }
          finally { IDBObjectStore.prototype.delete = original; }
          const after = await snapshot();
          const retry = await database.deleteData([id], new Map([[id,title]]), new AbortController().signal, false);
          return {id, aborted, outcome, before, after, retry, final:await snapshot(), keys:await db.getAllKeys('data')};
        }""")
        self.assertTrue(result['aborted'])
        self.assertEqual(result['before'], result['after'])
        self.assertEqual([], result['outcome']['deleted'])
        self.assertIn('could not be deleted', result['outcome']['error'])
        self.assertEqual({'error':'', 'deleted':[result['id']]}, result['retry'])
        self.assertEqual([], result['keys'])
        self.assertEqual({'book':None, 'bookmark':None, 'last':None, 'statistics':[], 'timestamps':[], 'cache':[], 'audio':[]}, result['final'])

    def test_deletion_uses_current_book_title_not_the_selected_label(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const db = await database.db;
          const id = await db.add('data', {title:'Renamed since selection', elementHtml:'<p>Read.</p>', styleSheet:'', blobs:{}, sections:[]});
          const oldAudio = {title:'Previous label', lastAudioBookModified:1, currentTime:4};
          await db.put('audioBook', oldAudio);
          await db.put('audioBook', {title:'Renamed since selection',lastAudioBookModified:2,currentTime:8});
          const outcome = await database.deleteData([id], new Map([[id,'Previous label']]), new AbortController().signal, true);
          return {outcome, oldAudio, audio:await db.getAll('audioBook')};
        }""")
        self.assertEqual('', result['outcome']['error'])
        self.assertEqual([result['oldAudio']], result['audio'])

    def test_explicit_history_deletion_uses_identity_and_preserves_other_copies(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const db = await database.db;
          const create = (title, hash) => db.add('data', {title, contentHash:hash,
            elementHtml:'<p>History.</p>', styleSheet:'', blobs:{}, sections:[]});
          const a = await create('Shared title', 'a'.repeat(64));
          const b = await create('Shared title', 'b'.repeat(64));
          const alias = await create('Another title, identical bytes', 'a'.repeat(64));
          const local = await create('Local without source hash');
          await db.put('readerLocalIdentity', {bookId:local, uuid:'fixture-local-identity'});
          const keyA = 'content:'+'a'.repeat(64), keyB = 'content:'+'b'.repeat(64), keyL = 'local:fixture-local-identity';
          for (const [bookKey,title] of [[keyA,'Shared title'],[keyB,'Shared title'],[keyL,'Local without source hash']]) {
            await db.put('readerStatistic', {bookKey,title,dateKey:'2026-09-26',charactersRead:35,
              readingTime:1,lastStatisticModified:2});
            await db.put('lastModified', {title:bookKey,dataType:'statistic',lastModifiedValue:2});
          }
          const remove = (id,keep=false) => database.deleteData([id],new Map(),new AbortController().signal,keep);
          const outcomes = [await remove(a)];
          const afterFirst = await db.getAll('readerStatistic');
          outcomes.push(await remove(alias));
          const afterAlias = await db.getAll('readerStatistic');
          outcomes.push(await remove(b,true));
          const afterKeep = await db.getAll('readerStatistic');
          outcomes.push(await remove(local));
          return {outcomes, keyA, keyB, keyL, afterFirst, afterAlias, afterKeep,
            final:await db.getAll('readerStatistic'), timestamps:await db.getAll('lastModified')};
        }""")
        self.assertTrue(all(outcome['error'] == '' for outcome in result['outcomes']))
        self.assertEqual({result['keyA'], result['keyB'], result['keyL']}, {row['bookKey'] for row in result['afterFirst']})
        self.assertEqual({result['keyB'], result['keyL']}, {row['bookKey'] for row in result['afterAlias']})
        self.assertEqual(result['afterAlias'], result['afterKeep'])
        self.assertEqual({result['keyB']}, {row['bookKey'] for row in result['final']})
        self.assertEqual([{'title':result['keyB'], 'dataType':'statistic', 'lastModifiedValue':2}], result['timestamps'])

    def test_deliberate_batch_cancel_keeps_committed_deletion_and_stops_remaining_books(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const {replicationProgress$} = await import('/reader-web/src/lib/functions/replication/replication-progress.ts');
          const db = await database.db, ids = [];
          for (const title of ['Committed deletion', 'Cancel keeps this', 'Cancel keeps this too'])
            ids.push(await db.add('data', {title, elementHtml:'<p>Reading.</p>', styleSheet:'', blobs:{}, sections:[]}));
          const controller = new AbortController();
          const subscription = replicationProgress$.subscribe(event => {
            if (event.progressToAdd === 1) controller.abort();
          });
          let outcome;
          try {outcome = await database.deleteData(ids,new Map(),controller.signal,true);}
          finally {subscription.unsubscribe();}
          const remaining = await db.getAllKeys('data');
          const retry = await database.deleteData(remaining,new Map(),new AbortController().signal,true);
          return {ids,outcome,remaining,retry,final:await db.getAllKeys('data')};
        }""")
        self.assertEqual({'error':'', 'deleted':[result['ids'][0]]}, result['outcome'])
        self.assertEqual(result['ids'][1:], result['remaining'])
        self.assertEqual({'error':'', 'deleted':result['remaining']}, result['retry'])
        self.assertEqual([], result['final'])

    def test_same_title_copy_keeps_legacy_auxiliary_data_until_last_copy_is_deleted(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const db = await database.db, title = 'Shared legacy title';
          const create = hash => db.add('data', {title,contentHash:hash,
            elementHtml:'<p>Reading.</p>',styleSheet:'',blobs:{},sections:[]});
          const first = await create('a'.repeat(64)), second = await create('b'.repeat(64));
          const audio = {title,lastAudioBookModified:2,currentTime:8};
          const day = {title,dateKey:'2026-09-26',charactersRead:35,readingTime:1,lastStatisticModified:2};
          await db.put('audioBook',audio); await db.put('statistic',day);
          const outcome = await database.deleteData([first],new Map(),new AbortController().signal,false);
          const middle = {audio:await db.get('audioBook',title),day:await db.getAll('statistic')};
          const last = await database.deleteData([second],new Map(),new AbortController().signal,false);
          return {outcome,last,audio,day,middle,final:{audio:await db.getAll('audioBook'),days:await db.getAll('statistic')}};
        }""")
        self.assertEqual('',result['outcome']['error'])
        self.assertEqual('',result['last']['error'])
        self.assertEqual({'audio':result['audio'],'day':[result['day']]},result['middle'])
        self.assertEqual({'audio':[],'days':[]},result['final'])


class LibraryDeletionStatic(LibraryBase):
    def seed_history(self, title):
        return self.page.evaluate("""async title => {
          const db = await new Promise((resolve,reject) => {
            const request = indexedDB.open('books');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise((resolve,reject) => {
              const tx = db.transaction(['data','readerStatistic'],'readwrite');
              const request = tx.objectStore('data').index('title').get(title);
              let bookKey;
              request.onsuccess = () => {
                bookKey = 'content:'+request.result.contentHash;
                tx.objectStore('readerStatistic').put({bookKey,title,dateKey:'2026-09-26',
                  charactersRead:35,readingTime:1,lastStatisticModified:2});
              };
              tx.oncomplete = () => resolve(bookKey);
              tx.onabort = () => reject(tx.error || new Error('History fixture aborted'));
            });
          } finally {db.close();}
        }""", title)

    def test_built_library_honors_the_explicit_keep_history_setting(self):
        self.import_book('Kept history')
        kept_key = self.seed_history('Kept history')
        self.menu('Kept history', 'Remove from this browser…')
        expect(self.page.get_by_role('button', name='Read Kept history', exact=True)).to_have_count(0)
        before = self.stores('books',['readerStatistic'])['readerStatistic']
        self.assertEqual([kept_key], [row['bookKey'] for row in before])
        self.page.goto(self.origin + '/reader-web/settings')
        search = self.page.get_by_role('searchbox',name='Search settings',exact=True)
        search.fill('Keep Local Data on Deletion')
        keep = self.page.get_by_role('switch',name='Keep Local Data on Deletion',exact=True)
        expect(keep).to_be_checked()
        keep.click()
        expect(keep).not_to_be_checked()
        self.go_library()
        self.import_book('Discarded history')
        self.seed_history('Discarded history')
        self.menu('Discarded history', 'Remove from this browser…')
        expect(self.page.get_by_role('button',name='Read Discarded history',exact=True)).to_have_count(0)
        self.assertEqual(before,self.stores('books',['readerStatistic'])['readerStatistic'])

    def test_built_library_reports_native_delete_failure_and_allows_retry(self):
        self.import_book('Retained after failed removal')
        before = self.stores('books',['data','bookmark'])
        self.page.evaluate("""() => {
          window.originalBookDelete = IDBObjectStore.prototype.delete;
          IDBObjectStore.prototype.delete = function(...args) {
            const request = window.originalBookDelete.apply(this,args);
            if (this.transaction.db.name === 'books' && this.name === 'data')
              this.transaction.abort();
            return request;
          };
        }""")
        try:
            self.menu('Retained after failed removal','Remove from this browser…')
            expect(self.page.get_by_role('heading',name='Deletion failed',exact=True)).to_be_visible()
            expect(self.page.get_by_text('could not be deleted',exact=False)).to_be_visible()
            self.assertEqual(before,self.stores('books',['data','bookmark']))
        finally:
            self.page.evaluate('() => { IDBObjectStore.prototype.delete = window.originalBookDelete; }')
        self.page.get_by_role('dialog').locator('[data-modal-dismiss]').click()
        expect(self.page.get_by_role('dialog')).to_have_count(0)
        self.menu('Retained after failed removal','Remove from this browser…')
        expect(self.page.get_by_role('button',name='Read Retained after failed removal',exact=True)).to_have_count(0)
        self.assertEqual([],self.stores('books',['data'])['data'])


def load_tests(_loader, _tests, _pattern):
    return unittest.TestSuite(cls(name) for cls in (LibraryDeletionRuntime, LibraryDeletionStatic)
                              for name in cls.__dict__ if name.startswith('test_'))
