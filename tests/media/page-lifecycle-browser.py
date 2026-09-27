#!/usr/bin/env python3
"""Native freeze/worker/Web Locks recovery using the production queue and client.

The decoder and worker's transcript are scripted, not MOSS. Worker ownership,
nested workers, page freezing (CDP), IndexedDB, and origin locks are real Chromium.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HTML = '''<!doctype html><meta charset="utf-8"><title>Queue freeze qualification</title>
<script type="module">
import {MediaStore} from '/.cache/media-test-build/store.js';
import {MossClient} from '/.cache/media-test-build/moss-client.js';
import {TranscriptionQueue} from '/.cache/media-test-build/queue.js';
window.modules = {MediaStore,MossClient,TranscriptionQueue};
window.start = (role, db) => {
  window.store = new MediaStore(indexedDB,db);
  window.client = new MossClient('/unused',new URL('/__lifecycle__/worker.js?role='+role,location.href));
  window.errors=[];
  window.queue = new TranscriptionQueue(store,'guest',client,
    async (_job,start,end) => new Float32Array(Math.ceil((end-start)*16000)).fill(0.1),
    p => { window.latest = p; }, e => errors.push(String(e)));
};
window.ready=true;
</script>'''
WORKER = '''const role = new URL(location.href).searchParams.get('role');
let calls=0;
self.onmessage=({data})=>{
  if(data.type==='prepare'){
    const child=new Worker('/__lifecycle__/child.js?role='+role);
    child.onmessage=()=>self.postMessage({id:data.id,type:'ready',value:null});
  } else if(data.type==='transcribe'){
    calls++;
    if(role==='owner' && calls>1) return;
    self.postMessage({id:data.id,type:'result',value:'[1][S01]'+(role==='owner'?'保存した字幕':'後続の字幕')+'[2]'});
  }
  // No disposal acknowledgement: freeze must not depend on a message or timer.
};'''
CHILD = '''const role = new URL(location.href).searchParams.get('role');
navigator.locks.request('moss-test-child-'+role,()=>{
  self.postMessage('ready');
  return new Promise(()=>{});
});'''


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        resource = {
            '/__lifecycle__/': ('text/html', HTML),
            '/__lifecycle__/worker.js': ('text/javascript', WORKER),
            '/__lifecycle__/child.js': ('text/javascript', CHILD)
        }.get(path)
        if not resource:
            return super().do_GET()
        content_type, source = resource
        body = source.encode()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/page-lifecycle-browser')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    browser = None
    owner_cdp = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox'])
            context = browser.new_context()
            owner = context.new_page()
            peer = context.new_page()
            for page in (owner, peer):
                page.set_default_timeout(30000)
                page.goto(f'http://127.0.0.1:{server.server_port}/__lifecycle__/')
                page.wait_for_function('window.ready===true')
            owner_cdp = context.new_cdp_session(owner)

            def record(name, condition, details=None):
                if not condition:
                    raise AssertionError(name + (": " + json.dumps(details, ensure_ascii=False) if details else ""))
                results.append({'name': name, 'passed': True})
                print('PASS', name, flush=True)

            # A control validates that CDP really freezes the page and does not
            # incidentally release all origin locks on its behalf.
            owner.evaluate('''() => {
                window.control = navigator.locks.request('moss-freeze-control', () => {
                    window.controlHeld=true;
                    return new Promise(resolve=>window.releaseControl=resolve);
                });
            }''')
            owner.wait_for_function('window.controlHeld===true')
            owner_cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
            record('control: a frozen page retains an ordinary Web Lock', peer.evaluate('''async () =>
                navigator.locks.request('moss-freeze-control',{ifAvailable:true},lock=>!lock)
            '''))
            owner_cdp.send('Page.setWebLifecycleState', {'state': 'active'})
            owner.evaluate('async () => { releaseControl(); await control; }')

            db = 'freeze-queue-native-' + str(os.getpid())
            owner.evaluate('(db)=>start("owner",db)', db)
            peer.evaluate('(db)=>start("peer",db)', db)
            job_id = owner.evaluate('''async () => {
                window.job = await queue.enqueue('content:'+'a'.repeat(64),'ja','1',15);
                return job.id;
            }''')
            owner.wait_for_function('''async () => {
                const saved=await store.local('guest','jobs',job.id);
                return saved?.nextWindow===1 && latest?.stage==='transcribing' && saved.status==='running';
            }''')
            # Ensure the held second inference has reached the real worker.
            owner.wait_for_function('client.busy && client.serial >= 3')
            before = owner.evaluate('async () => (await store.local("guest","jobs",job.id)).cues')
            peer_id = peer.evaluate('''async () => {
                window.peerJob = await queue.enqueue('content:'+'b'.repeat(64),'ja','1',2);
                return peerJob.id;
            }''')
            peer.wait_for_function('''async () => (await navigator.locks.query()).pending.some(
                lock=>lock.name==='manabi-moss-inference')''')
            owner_cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
            peer.wait_for_function('''async () =>
                (await store.local('guest','jobs',peerJob.id))?.status==='complete'
            ''')
            record('frozen owner yields inference so the waiting real tab completes', True)
            peer.wait_for_function('''async () => !(await navigator.locks.query()).held.some(
                lock=>lock.name==='manabi-moss-inference' || lock.name==='moss-test-child-owner')''')
            record('interruption terminates the nested worker as well as the owner', True)

            diagnostics = peer.evaluate('''async () => ({
                visibility:document.visibilityState, suspended:queue.suspended,
                locks:await navigator.locks.query(), errors:[...errors],
                jobs:await store.listLocal('guest','jobs')
            })''')
            (args.output / 'before-recovery.json').write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2))
            peer.evaluate('() => queue.recover()')
            saved = peer.evaluate('(id) => store.local("guest","jobs",id)', job_id)
            record('orphan recovery keeps exactly the accepted pre-freeze checkpoint',
                   saved['status'] == 'paused' and saved['nextWindow'] == 1 and saved['cues'] == before,
                   {'before': before, 'saved': saved, 'context': diagnostics})
            peer.evaluate('(id)=>queue.resume(id)', job_id)
            peer.wait_for_function('''async id =>
                (await store.local('guest','jobs',id))?.status==='complete'
            ''', arg=job_id)
            tracks = peer.evaluate('() => store.tracks("guest","content:"+"a".repeat(64))')
            record('a successor resumes the same job without replacing its accepted prefix',
                   len(tracks) == 1 and tracks[0]['id'] == job_id and
                   tracks[0]['complete'] and tracks[0]['cues'][:len(before)] == before)

            owner_cdp.send('Page.setWebLifecycleState', {'state': 'active'})
            owner.wait_for_function('queue.running===false')
            after = owner.evaluate('() => store.tracks("guest","content:"+"a".repeat(64))')
            completed = owner.evaluate('(id)=>store.local("guest","jobs",id)', job_id)
            record('thawed owner neither replays inference nor overwrites the successor',
                   after == tracks and completed['status'] == 'complete' and not owner.evaluate('client.ready'))
            for page in (owner, peer):
                page.evaluate('async () => { await queue.dispose(); await store.close(); }')
            browser.close()
            browser = None
    except Exception as error:
        results.append({'name': 'native freeze qualification', 'passed': False, 'error': str(error)})
        raise
    finally:
        # Preserve failures; a failed test is never converted into a skip or pass.
        (args.output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        server.shutdown()
    if not all(item['passed'] for item in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
