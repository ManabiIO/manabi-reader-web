#!/usr/bin/env python3
"""Native browser experiment: model custody outside a frozen page, not production ASR."""
import http.server
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

PAGE = '''<!doctype html><title>Model custody probe</title><script>
window.events=[];
window.broker=new SharedWorker('/broker.js',{name:'moss-custody-probe'});
broker.port.onmessage=({data})=>{
  events.push(data);
  if(data.type==='ping')broker.port.postMessage({type:'pong',nonce:data.nonce});
};
window.acquire=()=>broker.port.postMessage({type:'acquire'});
window.release=()=>broker.port.postMessage({type:'release'});
</script>'''
BROKER = '''let active, pending=[], serial=0;
const send=(p,data)=>p.postMessage(data);
function drain(){
  if(active||!pending.length)return;
  const port=pending.shift(), owner={port,last:performance.now(),nonce:0};
  active=owner;
  navigator.locks.request('moss-probe-inference',async()=>{
    const worker=new Worker('/model.js');
    owner.worker=worker;
    await new Promise(resolve=>{
      worker.onmessage=()=>{send(port,{type:'acquired'});resolve();};
    });
    await new Promise(resolve=>owner.release=resolve);
    worker.terminate();
    // The worker-owned lock is released by browser teardown, not a page ack.
    await navigator.locks.request('moss-probe-resource',()=>{});
    send(port,{type:'retired'});
  }).then(()=>{active=undefined;drain();});
}
setInterval(()=>{
  if(!active)return;
  if(performance.now()-active.last>1500){active.release?.();return;}
  active.nonce=++serial;
  send(active.port,{type:'ping',nonce:active.nonce});
},100);
onconnect=({ports:[port]})=>{
  port.onmessage=({data})=>{
    if(data.type==='pong'&&active?.port===port&&data.nonce===active.nonce)active.last=performance.now();
    if(data.type==='acquire'){pending.push(port);drain();}
    if(data.type==='release'&&active?.port===port)active.release?.();
  };
};'''
MODEL = '''const child=new Worker('/nested.js');
child.onmessage=()=>navigator.locks.request('moss-probe-resource',()=>{
  postMessage('ready');return new Promise(()=>{});
});'''
NESTED = '''navigator.locks.request('moss-probe-nested',()=>{
  postMessage('ready');return new Promise(()=>{});
});'''


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        data={'/':PAGE,'/broker.js':BROKER,'/model.js':MODEL,'/nested.js':NESTED}.get(self.path)
        if data is None:
            self.send_error(404)
            return
        body=data.encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html' if self.path=='/' else 'text/javascript')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args):
        pass


def main():
    result=[]
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    out=Path('test-results/media/shared-custody-probe.json')
    out.parent.mkdir(parents=True,exist_ok=True)
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or p.chromium.executable_path,headless=True,args=['--no-sandbox'])
            context=browser.new_context()
            owner=context.new_page()
            peer=context.new_page()
            for page in (owner,peer):
                page.set_default_timeout(15000)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
            owner.evaluate('acquire()')
            owner.wait_for_function("events.some(e=>e.type==='acquired')")
            peer.evaluate('acquire()')
            cdp=context.new_cdp_session(owner)
            cdp.send('Page.setWebLifecycleState',{'state':'frozen'})
            peer.wait_for_function("events.some(e=>e.type==='acquired')")
            result.append({'name':'shared owner survives page freeze and grants successor','passed':True})
            peer.evaluate('release()')
            peer.wait_for_function("events.some(e=>e.type==='retired')")
            locks=peer.evaluate('async()=>await navigator.locks.query()')
            assert not any(x['name'].startswith('moss-probe-') for x in locks['held']),locks
            result.append({'name':'native model and nested-worker locks are retired','passed':True})
            cdp.send('Page.setWebLifecycleState',{'state':'active'})
            owner.wait_for_function("events.some(e=>e.type==='retired')")
            assert sum(e['type']=='acquired' for e in owner.evaluate('events'))==1
            result.append({'name':'thaw does not replay acquisition','passed':True})
            browser.close()
    except Exception as error:
        result.append({'name':'shared custody experiment','passed':False,'error':str(error)})
        raise
    finally:
        out.write_text(json.dumps(result,indent=2))
        server.shutdown()
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
