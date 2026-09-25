#!/usr/bin/env python3
"""Real Chromium + production DOM/IDB tests. Not a full Svelte app or ASR test."""
import argparse, functools, http.server, json, os, pathlib, threading, time
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True,type=pathlib.Path);parser.add_argument('--output',type=pathlib.Path,default=ROOT/'.cache/browser-results');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    results=[]
    def record(name,fn):
        t=time.monotonic()
        try:fn();results.append({'name':name,'status':'passed','seconds':round(time.monotonic()-t,3)});print('PASS',name,flush=True)
        except Exception as e:results.append({'name':name,'status':'failed','error':str(e)});print('FAIL',name,str(e),flush=True);raise
    try:
      with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required']);context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();page_errors=[];page.on('pageerror',lambda e:page_errors.append(str(e)));requests=[];page.on('request',lambda r:requests.append(r.url))
        url=f'http://127.0.0.1:{server.server_port}/tests/media/browser-harness.html?fixture=/'+str(args.fixture.resolve().relative_to(ROOT))+'/video.mp4';page.goto(url);page.wait_for_function('window.ready === true')
        def js(script):return page.evaluate(script)
        def check(condition,message='Assertion failed'):
            if not condition:raise AssertionError(message)
        record('Opening a real local MP4 does not trigger model downloads or generation',lambda:check(js('generated===0 && player.video.duration>6') and not any('huggingface' in u or '/moss/' in u for u in requests)))
        record('Both native and translation tracks can be selected',lambda:(page.get_by_label('Secondary captions').select_option(js('id2')),check(page.locator('.transcript-translation').count()>0)))
        record('Theater mode keeps two caption lines together',lambda:(page.get_by_role('button',name='Theater mode',exact=True).click(),js('player.video.currentTime=1'),page.wait_for_function('document.querySelectorAll(".caption-line").length===2'),check(page.locator('.transcript-pane').is_hidden())))
        record('Theater toggle does not rename the Full screen control',lambda:check(page.get_by_role('button',name='Full screen',exact=True).count()==1 and page.get_by_role('button',name='Exit theater',exact=True).count()==1))
        record('Independent translation cues follow intervals instead of indices',lambda:(js('player.video.currentTime=2.5'),page.wait_for_function('document.querySelector(".caption-line:not(.translation)").textContent.includes("次の行")'),check(page.locator('.caption-line.translation').inner_text()=='First translated sentence.')))
        record('Subtitle markup is shown as text and never injected',lambda:check(js('!player.root.querySelector("img") && document.querySelector(".caption-line").textContent.includes("<img")')))
        record('Caption settings controls apply color, background and text size',lambda:(page.get_by_text('Caption settings',exact=True).click(),page.get_by_label('Text color',exact=True).select_option('yellow'),page.get_by_label('Background opacity',exact=True).select_option('0.8'),page.get_by_label('Text size',exact=True).select_option('1.25'),check(js('document.querySelector(".caption-overlay").style.getPropertyValue("--caption-color")==="yellow"'))))
        record('Turning captions off survives a track refresh',lambda:(page.get_by_label('Primary captions',exact=True).select_option(''),page.get_by_label('Secondary captions',exact=True).select_option(''),js('player.setTracks(tracks)'),check(js('document.querySelector("select[aria-label=\"Primary captions\"]").value===""'))))
        record('Pause/seek checkpoint persists to actual IndexedDB',lambda:(js('player.video.currentTime=4.2;player.video.dispatchEvent(new Event("seeked"))'),page.wait_for_function('async()=>Math.abs((await store.get("guest","video_resume",key))?.payload.position-4.2)<.1')))
        record('Reopening restores playback and does not reenable disabled captions',lambda:(js('mount()'),check(abs(js('player.video.currentTime')-4.2)<.15),check(page.get_by_label('Primary captions',exact=True).input_value()=='')))
        record('Appearance preferences survive remount',lambda:page.wait_for_function('document.querySelector(".caption-overlay").style.getPropertyValue("--caption-color")==="yellow"'))
        record('Mobile layout keeps video and controls within the viewport',lambda:(page.set_viewport_size({'width':390,'height':844}),page.wait_for_timeout(100),check(js('document.documentElement.scrollWidth<=window.innerWidth+1'))))
        page.screenshot(path=str(args.output/'player-mobile.png'),full_page=True);page.set_viewport_size({'width':1280,'height':900});page.screenshot(path=str(args.output/'player-desktop.png'),full_page=True)
        record('Two real IDB clients reject stale compare-and-swap saves',lambda:check(js('''async()=>{const other=new modules.MediaStore(indexedDB,store.name);const before=await store.get('guest','video_resume',key);await store.edit('guest','video_resume',key,key,{...before.payload,position:5},before.localVersion);try{await other.edit('guest','video_resume',key,key,{...before.payload,position:6},before.localVersion);return false;}catch(e){return e.constructor.name==='LocalConflict';}finally{await other.close();}}''')))
        record('Account-scoped IDB records are not visible to another account',lambda:check(js('''async()=>{await store.edit('account:A','video_info',key,key,{version:1,title:'private',duration:10,width:320,height:180,addedAt:1});return (await store.records('account:B')).length===0 && (await store.records('account:A')).length===1;}''')))
        record('Large transcript publication verifies every persisted chunk',lambda:check(js('''async()=>{const t={...tracks[0],id:crypto.randomUUID(),cues:Array.from({length:501},(_,i)=>({id:String(i),start:i,end:i+.5,text:'line'}))};await store.saveTrack('account:A',t);return (await store.tracks('account:A',key))[0].cues.length===501;}''')))
        record('Queue prepares its engine only after explicit enqueue (control test double)',lambda:check(js('''async()=>{let prepared=0,called=0;const engine={async prepare(){prepared++},async transcribe(){called++;return '[0.2][S01]First sentence.[1.2][1.5][S01]Second sentence.[2.5]'},dispose(){}};const q=new modules.TranscriptionQueue(store,'account:queue',engine,async()=>new Float32Array(16000*4).fill(.1));if(prepared)return false;const job=await q.enqueue(key,'en','1',4);for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,20));const j=await store.local('account:queue','jobs',job.id);if(j.status==='complete'){await q.dispose();return prepared===1&&called===1&&(await store.tracks('account:queue',key))[0].cues.length===2;}if(j.status==='failed')throw Error(j.error);}await q.dispose();return false;}''')))
        record('Concurrent Generate admission is atomic across two native IndexedDB connections',lambda:check(js('''async()=>{
            const other=new modules.MediaStore(indexedDB,store.name);
            const draft=()=>({version:1,id:crypto.randomUUID(),mediaKey:key,language:'ja',audioTrack:'1',duration:4,status:'queued',nextWindow:0,cues:[],modelSha256:'a'.repeat(64),engineRevision:'native-admission-test',createdAt:Date.now()});
            try{const [a,b]=await Promise.all([store.enqueueJob('account:admission',draft()),other.enqueueJob('account:admission',draft())]);return a.id===b.id&&(await store.listLocal('account:admission','jobs')).length===1;}finally{await other.close();}
        }''')))
        record('No unhandled browser exceptions',lambda:check(not page_errors,'; '.join(page_errors)))
        context.close();browser.close()
    finally:
      server.shutdown();(args.output/'results.json').write_text(json.dumps({'kind':'production-media-module Chromium tests; not full-app or real ASR','tests':results},indent=2))
    print(f'{len(results)} browser cases passed',flush=True)
if __name__=='__main__':main()
