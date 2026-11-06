"""Real first-page CacheStorage -> activated worker -> offline module import.

The authored JavaScript fixture tests cache ownership, not dictionary semantics.
No service-worker/client claiming or storage substitute is installed.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import base64
import hashlib
import json
import threading
import unittest
from playwright.sync_api import sync_playwright
from browser_launch import launch_options

SOURCE=Path(__file__).resolve().parents[2]/'apps/web/src/lib/service-worker'
ASSET=b'export const verifiedRuntime = "original verified bytes";'

class Handler(BaseHTTPRequestHandler):
    reads=0
    damaged=False
    def log_message(self,*_):pass
    def do_GET(self):
        name=self.path.rsplit('/',1)[-1]
        kind='text/javascript'
        if self.path=='/reader/':
            kind='text/html';data=b'<!doctype html><h1>Runtime cache qualification</h1>'
        elif name in ['verified-runtime-assets.mjs','reader-service-worker.mjs','offline-status.mjs']:
            data=(SOURCE/name).read_bytes()
        elif self.path=='/reader/sw.js':
            config={'build':['/reader/verified-runtime-assets.mjs','/reader/reader-service-worker.mjs','/reader/offline-status.mjs'],
                'files':[],'prerendered':['/reader/'],'version':'first-document-fixture','userFontsCacheName':'fixture-fonts',
                'optionalRuntimeAssets':['/reader/engine/tool.js']}
            data=("import {registerReaderServiceWorker} from './reader-service-worker.mjs';registerReaderServiceWorker(self,"+json.dumps(config)+");").encode()
        elif self.path=='/reader/engine/tool.js':
            type(self).reads+=1;data=b'export const verifiedRuntime="damaged";' if type(self).damaged else ASSET
        else:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

class FirstPageRuntimeCache(unittest.TestCase):
    def test_first_uncontrolled_use_remains_available_after_offline_navigation(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as playwright:
                for engine in ['chromium','webkit']:
                    with self.subTest(engine=engine):
                        Handler.reads=0;Handler.damaged=False;browser=getattr(playwright,engine).launch(**launch_options(engine));context=None
                        try:
                            context=browser.new_context();page=context.new_page();errors=[]
                            page.on('pageerror',lambda error:errors.append(str(error)));page.goto(origin+'/reader/')
                            expected={'bytes':len(ASSET),'sha256':hashlib.sha256(ASSET).hexdigest()}
                            result=page.evaluate('''async expected=>{
                              const {loadVerifiedRuntimeAsset}=await import('./verified-runtime-assets.mjs');
                              if(navigator.serviceWorker.controller)throw new Error('Fixture was already controlled');
                              await loadVerifiedRuntimeAsset(location.href,new URL('engine/tool.js',location.href),expected);
                              await navigator.serviceWorker.register('./sw.js',{type:'module'});await navigator.serviceWorker.ready;
                              return {controlled:!!navigator.serviceWorker.controller};
                            }''',expected)
                            self.assertFalse(result['controlled']);self.assertEqual(1,Handler.reads)
                            context.set_offline(True);page.reload();page.wait_for_function('navigator.serviceWorker.controller!==null')
                            imported=page.evaluate('''async()=>({online:navigator.onLine,value:(await import('./engine/tool.js')).verifiedRuntime})''')
                            self.assertEqual('original verified bytes',imported['value']);self.assertFalse(imported['online'])
                            self.assertEqual(1,Handler.reads);self.assertEqual([],errors)
                        finally:
                            if context:context.close()
                            browser.close()
        finally:server.shutdown();server.server_close();thread.join()

    def test_verified_copy_wins_over_divergent_demand_cache_for_sri_module(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as playwright:
                for engine in ['chromium','webkit']:
                    with self.subTest(engine=engine):
                        Handler.reads=0;Handler.damaged=False
                        browser=getattr(playwright,engine).launch(**launch_options(engine));context=None
                        try:
                            context=browser.new_context()
                            # Routing disables HTTP caching, so normal browser
                            # requests may carry reload without requesting repair.
                            context.route('**/*',lambda route: route.continue_())
                            page=context.new_page();page.goto(origin+'/reader/')
                            page.evaluate("async()=>{await navigator.serviceWorker.register('./sw.js',{type:'module'});await navigator.serviceWorker.ready;}")
                            page.reload();page.wait_for_function('navigator.serviceWorker.controller!==null')
                            expected={'bytes':len(ASSET),'sha256':hashlib.sha256(ASSET).hexdigest()}
                            page.evaluate("""async expected=>{
                              const {loadVerifiedRuntimeAsset}=await import('./verified-runtime-assets.mjs');
                              await loadVerifiedRuntimeAsset(location.href,new URL('engine/tool.js',location.href),expected);
                              const name=(await caches.keys()).find(name=>name.includes(':optional-runtime:'));
                              await(await caches.open(name)).put('./engine/tool.js',new Response('export const verifiedRuntime="damaged";', {headers:{'Content-Type':'text/javascript'}}));
                            }""",expected)
                            context.set_offline(True)
                            value=page.evaluate("""async integrity=>{
                              const url=new URL('engine/tool.js#verified-copy',location.href).href;
                              const script=document.createElement('script');script.type='module';script.integrity=integrity;script.crossOrigin='anonymous';script.src=url;
                              try {
                                await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(new Error('SRI module failed'));document.head.append(script);});
                                return (await import(url)).verifiedRuntime;
                              } finally {script.remove();}
                            }""",'sha256-'+base64.b64encode(hashlib.sha256(ASSET).digest()).decode())
                            self.assertEqual('original verified bytes',value)
                            self.assertEqual(1,Handler.reads)
                        finally:
                            if context:context.close()
                            browser.close()
        finally:server.shutdown();server.server_close();thread.join()

    def test_controlled_retry_repairs_bad_tool_cache_without_touching_user_storage(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as playwright:
                for engine in ['chromium','webkit']:
                    with self.subTest(engine=engine):
                        Handler.reads=0;Handler.damaged=True
                        browser=getattr(playwright,engine).launch(**launch_options(engine));context=None
                        try:
                            context=browser.new_context();page=context.new_page();page.goto(origin+'/reader/')
                            page.evaluate("async()=>{await navigator.serviceWorker.register('./sw.js',{type:'module'});await navigator.serviceWorker.ready;}")
                            page.reload();page.wait_for_function('navigator.serviceWorker.controller!==null')
                            page.evaluate("async()=>{localStorage.setItem('book-progress','keep');const c=await caches.open('unrelated-user-data');await c.put('/book',new Response('keep'));}")
                            expected={'bytes':len(ASSET),'sha256':hashlib.sha256(ASSET).hexdigest()}
                            load="""async expected=>{
                              const {loadVerifiedRuntimeAsset}=await import('./verified-runtime-assets.mjs');
                              try {return {value:new TextDecoder().decode(await loadVerifiedRuntimeAsset(location.href,new URL('engine/tool.js',location.href),expected))};}
                              catch(error){return {error:String(error)};}
                            }"""
                            self.assertIn('error',page.evaluate(load,expected))
                            Handler.damaged=False
                            self.assertEqual(ASSET.decode(),page.evaluate(load,expected)['value'])
                            self.assertEqual(2,Handler.reads)
                            context.set_offline(True)
                            self.assertEqual(ASSET.decode(),page.evaluate(load,expected)['value'])
                            preserved=page.evaluate("async()=>[localStorage.getItem('book-progress'),await(await(await caches.open('unrelated-user-data')).match('/book')).text()]")
                            self.assertEqual(['keep','keep'],preserved)
                        finally:
                            if context:context.close()
                            browser.close()
        finally:
            Handler.damaged=False;server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main(verbosity=2)
