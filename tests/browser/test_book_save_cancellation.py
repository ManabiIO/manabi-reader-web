"""Native-storage save cancellation through the production handler and database."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from test_shared_safety import SharedStorageRuntime


class BookSaveCancellation(SharedStorageRuntime):
    def new_context(self):
        self.engine = os.environ.get('LIBRARY_BROWSER', 'chromium')
        profile = tempfile.TemporaryDirectory(prefix='reader-save-' + self.engine + '-')
        self.addCleanup(profile.cleanup)
        context = getattr(self.playwright, self.engine).launch_persistent_context(profile.name)
        self.assertEqual(self.engine, context.browser.browser_type.name)
        return context

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            (output / f'{self.engine}-{self._testMethodName}.json').write_text(json.dumps({
                'engine':self.engine,'pageErrors':self.errors,
                'userAgent':self.page.evaluate('navigator.userAgent')}))
        finally:
            super().tearDown()

    def test_cancellation_during_binary_preparation_preserves_the_existing_book(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler} = await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey} = await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const {ReplicationSaveBehavior} = await import('/reader-web/src/lib/functions/replication/replication-options.ts');
          const {MergeMode} = await import('/reader-web/src/lib/data/merge-mode.ts');
          const original={title:'Prepare cancel',contentHash:'a'.repeat(64),elementHtml:'<p>Original</p>',
            styleSheet:'',blobs:{},sections:[],lastBookModified:1};
          const db=await database.db;
          const id=await db.add('data',original);
          const handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.updateSettings(window,true,ReplicationSaveBehavior.Overwrite,MergeMode.MERGE,MergeMode.MERGE);
          const controller=new AbortController();
          handler.startContext({title:original.title},controller.signal);
          let release,started;
          const entered=new Promise(resolve=>started=resolve), gate=new Promise(resolve=>release=resolve);
          class HeldBlob extends Blob {
            async arrayBuffer(){ started(); await gate; return super.arrayBuffer(); }
          }
          const pending=handler.saveBook({...original,elementHtml:'<p>Must not replace original</p>',
            blobs:{image:new HeldBlob(['bytes'],{type:'image/png'})},lastBookModified:2})
            .then(id=>({id}),error=>({error:error.name}));
          await entered;controller.abort();release();
          const outcome=await pending;
          const after=await db.get('data',id);
          handler.startContext({title:original.title},new AbortController().signal);
          const retry=await handler.saveBook({...original,elementHtml:'<p>Fresh retry</p>',lastBookModified:3});
          return {outcome,after:after.elementHtml,id,retry,final:(await db.get('data',id)).elementHtml};
        }""")
        self.assertEqual({'error':'AbortError'},result['outcome'])
        self.assertEqual('<p>Original</p>',result['after'])
        self.assertEqual(result['id'],result['retry'])
        self.assertEqual('<p>Fresh retry</p>',result['final'])

    def test_cancellation_after_native_write_is_enqueued_rolls_back_and_drains_completion(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {ReplicationSaveBehavior}=await import('/reader-web/src/lib/functions/replication/replication-options.ts');
          const db=await database.db,controller=new AbortController();
          const original=IDBObjectStore.prototype.add;
          let enqueued=false,outcome;
          IDBObjectStore.prototype.add=function(...args){
            const request=original.apply(this,args);
            if(this.transaction.db.name==='books'&&this.name==='data'){
              enqueued=true;controller.abort();
            }
            return request;
          };
          const book={title:'Commit cancel',elementHtml:'<p>Read</p>',styleSheet:'',blobs:{},sections:[]};
          try { outcome=await database.upsertData(book,ReplicationSaveBehavior.Overwrite,true,true,controller.signal)
            .then(book=>({id:book.id}),error=>({error:error.name})); }
          finally{IDBObjectStore.prototype.add=original;}
          const rows=await db.getAllKeys('data');
          const retry=await database.upsertData(book,ReplicationSaveBehavior.Overwrite,true,true,new AbortController().signal);
          return {enqueued,outcome,rows,final:await db.getAllKeys('data'),retry:retry.id};
        }""")
        self.assertTrue(result['enqueued'])
        self.assertEqual({'error':'AbortError'},result['outcome'])
        self.assertEqual([],result['rows'])
        self.assertEqual([result['retry']],result['final'])


def load_tests(_loader, _tests, _pattern):
    # The shared base also owns provider and static/offline cases. Keep those in
    # their own suites, not duplicated against this module's development server.
    return unittest.TestSuite(BookSaveCancellation(name) for name in BookSaveCancellation.__dict__
                              if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main()
