#!/usr/bin/env python3
"""Native browser experiment: keep one MOSS owner outside a frozen page.

The fast mode instantiates the exact checked-in single-thread runtime and retains a
bounded allocation. With --model/--pcm, the same SharedWorker loads the real Q5_0
weights and performs actual inference before and after ownership handoff. This is
lifecycle qualification, not a replacement for the normal ASR quality suite.
"""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import threading

ROOT = Path(__file__).resolve().parents[2]
MOSS = ROOT / 'apps/web/static/moss/single'
from playwright.sync_api import sync_playwright
from browser_poll import wait_for_async

PAGE = '''<!doctype html><title>Model custody probe</title><script>
window.events=[];
window.dedicatedEvents=[];
window.startDedicated=(label)=>{
  const worker=new Worker('/dedicated.js?label='+encodeURIComponent(label),{type:'module'});
  worker.onmessage=({data})=>dedicatedEvents.push(data);
  worker.onerror=event=>dedicatedEvents.push({type:'error',phase:'dedicated-script',message:event.message});
  window.dedicated=worker;
};
window.stopDedicated=()=>{dedicated?.terminate();window.dedicated=undefined};
window.broker=new SharedWorker('/broker.js',{name:'moss-direct-custody-probe',type:'module'});
broker.onerror=event=>events.push({type:'error',phase:'broker-script',message:event.message});
broker.port.onmessage=({data})=>{
  events.push(data);
  if(data.type==='ping')broker.port.postMessage({type:'pong',nonce:data.nonce});
};
broker.port.start();
window.acquire=()=>broker.port.postMessage({type:'acquire'});
window.release=()=>broker.port.postMessage({type:'release'});
window.shutdown=()=>broker.port.postMessage({type:'shutdown'});
window.transcribe=()=>broker.port.postMessage({type:'transcribe'});
document.addEventListener('freeze',()=>{
  events.push({type:'page-freeze'});
  if(window.dedicated){
    dedicatedEvents.push({type:'freeze-terminate'});
    window.stopDedicated();
  }
  broker.port.postMessage({type:'release'});
},{capture:true});
window.addEventListener('pagehide',()=>{
  events.push({type:'pagehide'});
  broker.port.postMessage({type:'release'});
},{capture:true});
</script>'''

DEDICATED = '''const label=new URL(location.href).searchParams.get('label')||'unknown';
navigator.locks.request('moss-probe-dedicated-resource',async()=>{
  const snapshot=await navigator.locks.query();
  if(snapshot.held.some(lock=>lock.name==='moss-probe-dedicated-child')){
    postMessage({type:'unsafe',label,reason:'prior child still holds origin resource'});
    return;
  }
  if(typeof Worker!=='function'){
    postMessage({type:'error',label,phase:'nested-worker',message:'Worker constructor unavailable'});
    return;
  }
  const child=new Worker('/dedicated-child.js',{type:'module'});
  await new Promise((resolve,reject)=>{
    child.onmessage=({data})=>{
      if(data?.type==='ready')resolve();
      else if(data?.type==='error')reject(Error(data.message));
    };
    child.onerror=event=>reject(Error(event.message||'nested worker failed'));
  });
  postMessage({type:'ready',label,worker:typeof Worker});
  await new Promise(()=>{});
}).catch(error=>postMessage({
  type:'error',label,phase:'dedicated-resource',message:String(error)
}));'''
DEDICATED_CHILD = '''navigator.locks.request('moss-probe-dedicated-child',async()=>{
  postMessage({type:'ready'});
  await new Promise(()=>{});
}).catch(error=>postMessage({type:'error',message:String(error)}));'''

BROKER = '''const ports=new Set();
let active, pending=[], serial=0, runtime, allocation=0, modelToken, modelLoads=0;
let releaseModel, modelLockTask, modelReady, draining=false;
const EXPECTED_ENGINE='190a569c13b4b247450f2fb3b2a431244e84833e+manabi-web-v7';
const EXPECTED_GGML='eced84c86f8b012c752c016f7fe789adea168e1e';
const RETAINED_BYTES=64*1024*1024;
const FULL_MODEL=__FULL_MODEL__,MODEL_BYTES=648174592;
let ctx=0,inferenceBusy=false,operation=0;
const send=(port,data)=>{try{port.postMessage(data)}catch{}};
const broadcast=data=>{for(const port of ports)send(port,data)};
const token=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():
  Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
async function ensureModel(){
  if(runtime)return;
  if(modelReady)return modelReady;
  const acquired={};
  acquired.promise=new Promise((resolve,reject)=>{acquired.resolve=resolve;acquired.reject=reject});
  const lifetime={};
  lifetime.promise=new Promise(resolve=>releaseModel=resolve);
  modelLockTask=navigator.locks.request('moss-probe-model',async()=>{
    const factory=(await import('/moss.mjs')).default;
    runtime=await factory({locateFile:name=>new URL('/'+name,location.origin).href});
    if(runtime._moss_web_abi_version?.()!==1)throw Error('Unexpected MOSS ABI');
    if(runtime.UTF8ToString(runtime._moss_web_engine_revision?.())!==EXPECTED_ENGINE)
      throw Error('Unexpected MOSS engine revision');
    if(runtime.UTF8ToString(runtime._moss_web_ggml_revision?.())!==EXPECTED_GGML)
      throw Error('Unexpected ggml revision');
    if(!(runtime.HEAP32 instanceof Int32Array) ||
       (typeof SharedArrayBuffer!=='undefined' && runtime.HEAP32.buffer instanceof SharedArrayBuffer))
      throw Error('Expected the single-thread runtime');
    if(FULL_MODEL){
      const response=await fetch('/model.gguf',{cache:'no-store'});
      if(!response.ok||Number(response.headers.get('Content-Length'))!==MODEL_BYTES)
        throw Error('Invalid shared-custody model response');
      const blob=await response.blob();
      if(blob.size!==MODEL_BYTES)throw Error('Incomplete shared-custody model');
      runtime.FS.mkdir('/models');
      runtime.FS.mount(runtime.WORKERFS,{blobs:[{name:'model.gguf',data:blob}]},'/models');
      try{
        ctx=runtime.ccall('moss_web_load','number',['string','number'],['/models/model.gguf',1]);
      }finally{
        runtime.FS.unmount('/models');
      }
      if(!ctx)throw Error('SharedWorker could not load MOSS model');
    }else{
      allocation=runtime._malloc(RETAINED_BYTES);
      if(!allocation)throw Error('Could not allocate retained WASM memory');
      const heap=runtime.HEAP32,start=allocation/4,end=start+RETAINED_BYTES/4;
      if(!Number.isSafeInteger(start)||start<0||end>heap.length)throw Error('Invalid WASM allocation');
      for(let i=start;i<end;i+=1024)heap[i]=(i-start)&0x7fffffff;
    }
    modelToken=token();modelLoads++;
    acquired.resolve();
    await lifetime.promise;
    if(ctx){runtime._moss_transcribe_capi_free(ctx);ctx=0;}
    if(allocation){runtime._free(allocation);allocation=0;}
    runtime=undefined;
  }).catch(error=>{
    acquired.reject(error);
    throw error;
  });
  const starting=acquired.promise;
  modelReady=starting;
  try{
    await starting;
  }catch(error){
    if(modelReady===starting)modelReady=undefined;
    throw error;
  }
}
async function drain(){
  if(draining||active||!pending.length)return;
  draining=true;
  const port=pending[0];
  try {
    await ensureModel();
    if(active||pending[0]!==port)return;
    pending.shift();
  } catch(error) {
    const waiters=pending.splice(0);
    for(const waiting of waiters)
      send(waiting,{type:'error',phase:'runtime-startup',message:String(error)});
    return;
  } finally {
    draining=false;
  }
  const owner={port,last:performance.now(),nonce:0,release:undefined};
  active=owner;
  navigator.locks.request('moss-probe-inference',async()=>{
    send(port,{type:'acquired',token:modelToken,loads:modelLoads,
      bytes:FULL_MODEL?MODEL_BYTES:RETAINED_BYTES,fullModel:FULL_MODEL,
      abi:runtime._moss_web_abi_version(),engine:EXPECTED_ENGINE,
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
  if(!active||active.busy)return;
  if(performance.now()-active.last>1200){active.release?.();return;}
  active.nonce=++serial;
  send(active.port,{type:'ping',nonce:active.nonce});
},100);
async function transcribe(port){
  if(!FULL_MODEL||!ctx||active?.port!==port){
    send(port,{type:'error',phase:'transcribe',message:'Real model is not owned by this port'});
    return;
  }
  if(inferenceBusy){
    send(port,{type:'error',phase:'transcribe',message:'Shared MOSS inference is already active'});
    return;
  }
  inferenceBusy=true;active.busy=true;active.last=performance.now();
  let pcmPtr=0,result=0;
  try{
    const response=await fetch('/speech.f32',{cache:'no-store'});
    if(!response.ok)throw Error('Missing shared-custody PCM');
    const bytes=await response.arrayBuffer(),pcm=new Float32Array(bytes);
    if(!pcm.length||pcm.length>16000*64||pcm.some(value=>!Number.isFinite(value)))
      throw Error('Invalid shared-custody PCM');
    runtime._moss_web_begin(++operation);
    pcmPtr=runtime._malloc(pcm.byteLength);
    if(!pcmPtr)throw Error('Not enough shared MOSS memory');
    const at=pcmPtr/4,heap=runtime.HEAPF32;
    if(!Number.isSafeInteger(at)||at<0||at+pcm.length>heap.length)
      throw Error('Invalid shared MOSS PCM allocation');
    heap.set(pcm,at);
    runtime.onMossOutput=()=>{};
    result=runtime._moss_transcribe_capi_transcribe_pcm(ctx,pcmPtr,pcm.length,16000,2048);
    if(!result)
      throw Error(runtime.UTF8ToString(runtime._moss_transcribe_capi_last_error(ctx))||'Shared MOSS failed');
    const value=runtime.UTF8ToString(result);
    if(!value||value.length>1024*1024)throw Error('Invalid shared MOSS transcript');
    send(port,{type:'transcript',value});
  }catch(error){
    send(port,{type:'error',phase:'transcribe',message:String(error)});
  }finally{
    runtime.onMossOutput=undefined;
    if(pcmPtr)runtime._free(pcmPtr);
    if(result)runtime._moss_transcribe_capi_free_string(result);
    inferenceBusy=false;
    if(active){active.busy=false;active.last=performance.now();}
  }
}
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
    if(data.type==='transcribe')void transcribe(port);
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
    model_path = None
    pcm_path = None

    def send_path(self, item, content_type):
        size = item.stat().st_size
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(size))
        self.end_headers()
        with item.open('rb') as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/':
            body = PAGE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == '/dedicated.js':
            body = DEDICATED.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == '/dedicated-child.js':
            body = DEDICATED_CHILD.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == '/broker.js':
            body = BROKER.replace('__FULL_MODEL__', 'true' if self.model_path else 'false').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path in {'/moss.mjs', '/moss.wasm'}:
            item = MOSS / path[1:]
            if not item.is_file():
                self.send_error(404)
                return
            self.send_path(item, 'text/javascript' if item.suffix == '.mjs' else 'application/wasm')
            return
        if path == '/model.gguf' and self.model_path:
            self.send_path(self.model_path, 'application/octet-stream')
            return
        if path == '/speech.f32' and self.pcm_path:
            self.send_path(self.pcm_path, 'application/octet-stream')
            return
        self.send_error(404)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path)
    parser.add_argument('--pcm', type=Path)
    parser.add_argument('--output', type=Path,
                        default=Path('test-results/media/shared-custody-probe.json'))
    args = parser.parse_args()
    if (args.model is None) != (args.pcm is None):
        parser.error('--model and --pcm must be supplied together')
    if args.model:
        if args.model.stat().st_size != 648174592:
            raise ValueError('Unexpected MOSS model size')
        if args.pcm.stat().st_size <= 0 or args.pcm.stat().st_size > 16000 * 64 * 4:
            raise ValueError('Invalid shared-custody PCM size')
    Handler.model_path = args.model
    Handler.pcm_path = args.pcm
    full_model = args.model is not None
    result = []
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    out = args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=os.environ.get('CHROMIUM') or p.chromium.executable_path,
                headless=True, args=['--no-sandbox'])
            context = browser.new_context()
            owner = context.new_page()
            peer = context.new_page()
            successor = context.new_page()
            for page in (owner, peer, successor):
                page.set_default_timeout(5 * 60 * 1000 if full_model else 15000)
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
                # A dedicated model worker can hold its own resource lock. If the
                # page freezes and terminates it synchronously, a replacement must
                # not obtain that lock while a nested worker from the old owner is
                # still alive. This is the safety property needed before production
                # may release its page-level scheduling lock on freeze.
                phase = 'dedicated-resource-freeze'
                owner.evaluate("startDedicated('first')")
                owner.wait_for_function(
                    "dedicatedEvents.some(e=>e.type==='ready'||e.type==='error'||e.type==='unsafe')")
                first_dedicated = owner.evaluate('dedicatedEvents')
                assert not [event for event in first_dedicated
                            if event['type'] in ('error', 'unsafe')], first_dedicated
                before = peer.evaluate('async()=>await navigator.locks.query()')
                before_held = {item['name'] for item in before['held']}
                assert {'moss-probe-dedicated-resource', 'moss-probe-dedicated-child'} <= before_held, before
                owner.evaluate("document.dispatchEvent(new Event('freeze'))")
                owner.wait_for_function(
                    "dedicatedEvents.some(e=>e.type==='freeze-terminate')")
                cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
                frozen = True
                successor.evaluate("startDedicated('second')")
                successor.wait_for_function(
                    "dedicatedEvents.some(e=>e.type==='ready'||e.type==='error'||e.type==='unsafe')")
                second_dedicated = successor.evaluate('dedicatedEvents')
                assert not [event for event in second_dedicated
                            if event['type'] in ('error', 'unsafe')], second_dedicated
                assert [event for event in second_dedicated if event['type'] == 'ready'], second_dedicated
                result.append({
                    'name': 'dedicated worker termination releases resource only after nested-worker custody',
                    'passed': True,
                    'worker': [event for event in second_dedicated if event['type'] == 'ready'][-1]['worker']
                })
                successor.evaluate('stopDedicated()')
                wait_for_async(successor, """async()=>!(await navigator.locks.query()).held.some(
                    lock=>lock.name==='moss-probe-dedicated-resource'||
                          lock.name==='moss-probe-dedicated-child')""")
                cdp.send('Page.setWebLifecycleState', {'state': 'active'})
                frozen = False
                owner.evaluate('dedicatedEvents.length=0')
                successor.evaluate('dedicatedEvents.length=0')

                # Queue a successor before initial model startup finishes. Only one
                # startup may run; the second port must remain queued for inference.
                owner.evaluate('acquire()')
                peer.evaluate('acquire()')
                first = acquired(owner)
                peer.wait_for_timeout(50)
                assert not [event for event in events(peer) if event['type'] == 'acquired'], events(peer)
                expected_bytes = 648174592 if full_model else 64 * 1024 * 1024
                assert first['loads'] == 1 and first['bytes'] == expected_bytes, first
                assert first['fullModel'] is full_model, first
                assert first['abi'] == 1 and first['engine'].endswith('+manabi-web-v7'), first
                result.append({
                    'name': 'SharedWorker directly owns one checked-in MOSS runtime allocation',
                    'passed': True, 'worker': first['worker'], 'token': first['token'],
                    'abi': first['abi'], 'engine': first['engine'], 'fullModel': full_model
                })
                first_transcript = None
                if full_model:
                    owner.evaluate('transcribe()')
                    owner.wait_for_function("events.some(e=>e.type==='transcript'||e.type==='error')")
                    owner_seen = events(owner)
                    errors = [event for event in owner_seen if event['type'] == 'error']
                    assert not errors, json.dumps(owner_seen)
                    first_transcript = [event['value'] for event in owner_seen
                                        if event['type'] == 'transcript'][-1]
                    result.append({
                        'name': 'SharedWorker real MOSS inference succeeds before handoff',
                        'passed': True,
                        'transcriptSha256': hashlib.sha256(first_transcript.encode()).hexdigest(),
                        'transcriptBytes': len(first_transcript.encode())
                    })

                peer.wait_for_function("events.some(e=>e.type==='capabilities')")
                phase = 'freeze-event-handoff'
                # CDP's headless lifecycle override does not dispatch a reliable
                # Page Lifecycle freeze event and, in prior evidence, the page kept
                # processing MessagePort tasks. Exercise the production listener
                # explicitly, then freeze the page before waiting on the successor.
                owner.evaluate("document.dispatchEvent(new Event('freeze'))")
                owner.wait_for_function("events.some(e=>e.type==='page-freeze')")
                cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
                frozen = True
                second = acquired(peer)
                assert second['loads'] == 1, second
                assert second['token'] == first['token'], [first, second]
                locks = peer.evaluate('async()=>await navigator.locks.query()')
                held = {item['name'] for item in locks['held']}
                assert {'moss-probe-model', 'moss-probe-inference'} <= held, locks
                result.append({
                    'name': 'freeze-event handoff lets a peer reuse the same MOSS runtime allocation',
                    'passed': True, 'loads': second['loads'], 'sameToken': True
                })
                if full_model:
                    peer.evaluate('transcribe()')
                    peer.wait_for_function("events.some(e=>e.type==='transcript'||e.type==='error')")
                    peer_seen = events(peer)
                    errors = [event for event in peer_seen if event['type'] == 'error']
                    assert not errors, json.dumps(peer_seen)
                    second_transcript = [event['value'] for event in peer_seen
                                         if event['type'] == 'transcript'][-1]
                    assert second_transcript == first_transcript
                    result.append({
                        'name': 'same loaded MOSS model transcribes identically after freeze handoff',
                        'passed': True,
                        'transcriptSha256': hashlib.sha256(second_transcript.encode()).hexdigest()
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
                    'name': 'releasing inference retains shared runtime custody without a second allocation',
                    'passed': True
                })

                cdp.send('Page.setWebLifecycleState', {'state': 'active'})
                frozen = False
                owner.wait_for_timeout(300)
                owner_events = events(owner)
                assert any(event['type'] == 'page-freeze' for event in owner_events), owner_events
                assert sum(event['type'] == 'acquired' for event in owner_events) == 1
                result.append({
                    'name': 'thaw does not replay inference or allocate another runtime',
                    'passed': True
                })

                phase = 'terminated-owner-handoff'
                peer.evaluate('events.length=0; acquire()')
                third = acquired(peer)
                assert third['loads'] == 1 and third['token'] == first['token'], third
                successor.evaluate('events.length=0; acquire()')
                peer.close()
                fourth = acquired(successor)
                assert fourth['loads'] == 1 and fourth['token'] == first['token'], fourth
                result.append({
                    'name': 'a disappeared owner is reclaimed by heartbeat without reallocating MOSS',
                    'passed': True, 'loads': fourth['loads'], 'sameToken': True
                })
                successor.evaluate('release()')
                successor.wait_for_function("events.some(e=>e.type==='retired')")
                phase = 'shutdown'
                successor.evaluate('shutdown()')
                successor.wait_for_function("events.some(e=>e.type==='shutdown-complete'||e.type==='error')")
                shutdown_events = events(successor)
                assert not [event for event in shutdown_events if event['type'] == 'error'], shutdown_events
                done = [event for event in shutdown_events if event['type'] == 'shutdown-complete'][-1]
                assert done['loads'] == 1, done
                wait_for_async(successor, """async()=>!(await navigator.locks.query()).held.some(
                    lock=>lock.name==='moss-probe-model'||lock.name==='moss-probe-inference')""")
                result.append({
                    'name': 'explicit worker shutdown releases runtime and inference origin locks',
                    'passed': True, 'loads': done['loads']
                })
            except Exception as error:
                snapshot = {
                    'name': 'direct shared custody experiment',
                    'passed': False,
                    'phase': phase,
                    'error': str(error),
                    'peer': events(peer) if not peer.is_closed() else [{'type': 'page-closed'}],
                    'successor': events(successor),
                    'locks': successor.evaluate('async()=>await navigator.locks.query()')
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
