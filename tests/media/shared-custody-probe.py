#!/usr/bin/env python3
"""Native browser experiment: keep one model owner outside a frozen page.

This is an ownership/lifecycle probe, not MOSS inference. The SharedWorker owns a
bounded in-memory model surrogate directly because the tested Chromium SharedWorker
does not expose a nested Worker constructor. A separate real-runtime qualification
is required before this architecture can replace production ownership.
"""
import http.server
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

PAGE = '''<!doctype html><title>Model custody probe</title><script>
window.events=[];
window.broker=new SharedWorker('/broker.js',{name:'moss-direct-custody-probe'});
broker.onerror=event=>events.push({type:'error',phase:'broker-script',message:event.message});
broker.port.onmessage=({data})=>{
  events.push(data);
  if(data.type==='ping')broker.port.postMessage({type:'pong',nonce:data.nonce});
};
broker.port.start();
window.acquire=()=>broker.port.postMessage({type:'acquire'});
window.release=()=>broker.port.postMessage({type:'release'});
window.shutdown=()=>broker.port.postMessage({type:'shutdown'});
</script>'''

BROKER = '''const ports=new Set();
let active, pending=[], serial=0, model, modelToken, modelLoads=0;
let releaseModel, modelLockTask;
const send=(port,data)=>{try{port.postMessage(data)}catch{}};
const broadcast=data=>{for(const port of ports)send(port,data)};
const token=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():
  Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
async function ensureModel(){
  if(model)return;
  const acquired={};
  acquired.promise=new Promise(resolve=>acquired.resolve=resolve);
  const lifetime={};
  lifetime.promise=new Promise(resolve=>releaseModel=resolve);
  modelLockTask=navigator.locks.request('moss-probe-model',async()=>{
    model=new Uint8Array(64*1024*1024);
    // Commit representative pages and retain the allocation in worker-owned state.
    for(let i=0;i<model.length;i+=4096)model[i]=(i/4096)&255;
    modelToken=token();modelLoads++;
    acquired.resolve();
    await lifetime.promise;
    model=undefined;
  });
  await acquired.promise;
}
async function drain(){
  if(active||!pending.length)return;
  const port=pending.shift();
  await ensureModel();
  const owner={port,last:performance.now(),nonce:0,release:undefined};
  active=owner;
  navigator.locks.request('moss-probe-inference',async()=>{
    send(port,{type:'acquired',token:modelToken,loads:modelLoads,bytes:model.byteLength,
      worker:typeof Worker,locks:typeof navigator.locks?.request});
    await new Promise(resolve=>owner.release=resolve);
  }).then(()=>{
    send(port,{type:'retired',token:modelToken});
    if(active===owner)active=undefined;
    void drain();
  },error=>{
    send(port,{type:'error',phase:'inference-lock',message:String(error)});
    if(active===owner)active=undefined;
    void drain();
  });
}
setInterval(()=>{
  if(!active)return;
  if(performance.now()-active.last>1200){active.release?.();return;}
  active.nonce=++serial;
  send(active.port,{type:'ping',nonce:active.nonce});
},100);
onconnect=({ports:[port]})=>{
  ports.add(port);
  port.start();
  send(port,{type:'capabilities',sharedWorker:typeof SharedWorker,worker:typeof Worker,
    locks:typeof navigator.locks?.request});
  port.onmessage=({data})=>{
    if(data.type==='pong'&&active?.port===port&&data.nonce===active.nonce)
      active.last=performance.now();
    if(data.type==='acquire'){
      if(active?.port===port||pending.includes(port))return;
      pending.push(port);void drain();
    }
    if(data.type==='release'&&active?.port===port)active.release?.();
    if(data.type==='shutdown'){
      if(active||pending.length){
        send(port,{type:'error',phase:'shutdown',message:'Ownership is still active'});
        return;
      }
      const closing=modelLockTask;
      releaseModel?.();
      Promise.resolve(closing).then(()=>{
        broadcast({type:'shutdown-complete',loads:modelLoads});
        close();
      },error=>send(port,{type:'error',phase:'model-lock',message:String(error)}));
    }
  };
  port.onmessageerror=()=>ports.delete(port);
};'''


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        data = {'/': PAGE, '/broker.js': BROKER}.get(self.path)
        if data is None:
            self.send_error(404)
            return
        body = data.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html' if self.path == '/' else 'text/javascript')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    result = []
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    out = Path('test-results/media/shared-custody-probe.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=os.environ.get('CHROMIUM') or p.chromium.executable_path,
                headless=True, args=['--no-sandbox'])
            context = browser.new_context()
            owner = context.new_page()
            peer = context.new_page()
            for page in (owner, peer):
                page.set_default_timeout(15000)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.wait_for_function("events.some(e=>e.type==='capabilities'||e.type==='error')")
            cdp = context.new_cdp_session(owner)
            phase = 'initial-acquisition'
            frozen = False

            def events(page):
                return page.evaluate('events')

            def acquired(page):
                page.wait_for_function("events.some(e=>e.type==='acquired'||e.type==='error')")
                seen = events(page)
                errors = [event for event in seen if event['type'] == 'error']
                assert not errors, json.dumps(seen)
                grants = [event for event in seen if event['type'] == 'acquired']
                assert grants, seen
                return grants[-1]

            try:
                owner.evaluate('acquire()')
                first = acquired(owner)
                assert first['loads'] == 1 and first['bytes'] == 64 * 1024 * 1024, first
                result.append({
                    'name': 'SharedWorker directly owns exactly one bounded model allocation',
                    'passed': True, 'worker': first['worker'], 'token': first['token']
                })

                peer.evaluate('acquire()')
                peer.wait_for_function("events.some(e=>e.type==='capabilities')")
                phase = 'freeze-handoff'
                cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
                frozen = True
                second = acquired(peer)
                assert second['loads'] == 1, second
                assert second['token'] == first['token'], [first, second]
                locks = peer.evaluate('async()=>await navigator.locks.query()')
                held = {item['name'] for item in locks['held']}
                assert {'moss-probe-model', 'moss-probe-inference'} <= held, locks
                result.append({
                    'name': 'frozen page loses inference ownership while peer reuses the same model',
                    'passed': True, 'loads': second['loads'], 'sameToken': True
                })

                phase = 'peer-release'
                peer.evaluate('release()')
                peer.wait_for_function("events.some(e=>e.type==='retired'&&e.token===events.find(x=>x.type==='acquired').token)")
                # The model remains worker-owned between inference owners.
                between = peer.evaluate('async()=>await navigator.locks.query()')
                between_held = {item['name'] for item in between['held']}
                assert 'moss-probe-model' in between_held, between
                assert 'moss-probe-inference' not in between_held, between
                result.append({
                    'name': 'releasing inference retains shared model custody without a second allocation',
                    'passed': True
                })

                phase = 'shutdown'
                peer.evaluate('shutdown()')
                peer.wait_for_function("events.some(e=>e.type==='shutdown-complete'||e.type==='error')")
                shutdown_events = events(peer)
                assert not [event for event in shutdown_events if event['type'] == 'error'], shutdown_events
                done = [event for event in shutdown_events if event['type'] == 'shutdown-complete'][-1]
                assert done['loads'] == 1, done
                peer.wait_for_function("""async()=>!(await navigator.locks.query()).held.some(
                    lock=>lock.name==='moss-probe-model'||lock.name==='moss-probe-inference')""")
                result.append({
                    'name': 'explicit worker shutdown releases model and inference origin locks',
                    'passed': True, 'loads': done['loads']
                })

                cdp.send('Page.setWebLifecycleState', {'state': 'active'})
                frozen = False
                owner.wait_for_timeout(300)
                assert sum(event['type'] == 'acquired' for event in events(owner)) == 1
                result.append({
                    'name': 'thaw does not replay acquisition or allocate another model',
                    'passed': True
                })
            except Exception as error:
                snapshot = {
                    'name': 'direct shared custody experiment',
                    'passed': False,
                    'phase': phase,
                    'error': str(error),
                    'peer': events(peer),
                    'locks': peer.evaluate('async()=>await navigator.locks.query()')
                }
                if frozen:
                    cdp.send('Page.setWebLifecycleState', {'state': 'active'})
                snapshot['owner'] = events(owner)
                result.append(snapshot)
                raise
            finally:
                browser.close()
    finally:
        out.write_text(json.dumps(result, indent=2))
        server.shutdown()
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
