#!/usr/bin/env python3
"""Real IndexedDB cancellation and final-checkpoint recovery; recognition is scripted."""
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
HTML = '''<!doctype html><meta charset="utf-8"><title>Publication cancellation</title>
<script type="module">
import {MediaStore} from '/.cache/media-test-build/store.js';
import {TranscriptionQueue} from '/.cache/media-test-build/queue.js';
import {MOSS} from '/.cache/media-test-build/model-cache.js';
import {splitTrack} from '/.cache/media-test-build/replica.js';
window.modules={MediaStore,TranscriptionQueue,MOSS,splitTrack};
window.ready=true;
</script>'''


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path != '/__publication_cancel__/':
            return super().do_GET()
        body = HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


STORE_CASE = '''async ({mode,reason}) => {
    const {MediaStore,MOSS}=modules;
    const name='publication-cancel-'+crypto.randomUUID();
    const store=new MediaStore(indexedDB,name);
    const scope='guest', key='content:'+'c'.repeat(64), id=crypto.randomUUID(), owner=crypto.randomUUID();
    const cues=Array.from({length:1500},(_,n)=>({id:`w0/cue-${n}`,start:n/30,end:n/30+.02,text:`保存${n}`}));
    const job={version:1,id,mediaKey:key,language:'ja',audioTrack:'1',duration:60,status:'running',
        nextWindow:1,cues,modelSha256:MOSS.sha256,engineRevision:MOSS.engineRevision,createdAt:1,
        completedAt:2,ownerId:owner,leaseUntil:Date.now()+90000};
    const {ownerId,leaseUntil,...completed}={...job,status:'complete'};
    const track={version:1,id,mediaKey:key,language:'ja',label:'Japanese',kind:'transcription',
        origin:'sidecar',complete:true,forced:false,createdAt:1,cues};
    const controller=new AbortController(), signal=controller.signal;
    let puts=0, notifications=0, successfulPuts=0, caught=false, exactReason=false;
    const listeners=new Set(), add=signal.addEventListener.bind(signal), remove=signal.removeEventListener.bind(signal);
    signal.addEventListener=(type,fn,...args)=>{if(type==='abort')listeners.add(fn);return add(type,fn,...args)};
    signal.removeEventListener=(type,fn,...args)=>{if(type==='abort')listeners.delete(fn);return remove(type,fn,...args)};
    let off=()=>{};
    try {
        await store.putLocal(scope,'jobs',id,job);
        off=store.subscribe(captions=>{if(captions)notifications++});
        const tx=store.tx.bind(store);
        store.tx=(names,kind,work,...args)=>tx(names,kind,(records,done,fail,transaction)=>{
            if(Array.isArray(names)) {
                if(mode==='after-first-page-put' || mode==='committing-wins') {
                    const put=records.put.bind(records);
                    records.put=(...values)=>{
                        const request=put(...values); puts++;
                        if(mode==='committing-wins')request.addEventListener('success',()=>{
                            if(++successfulPuts===modules.splitTrack(track).length){
                                transaction.commit();controller.abort(reason);
                            }
                        },{once:true});
                        else controller.abort(reason);
                        return request;
                    };
                }
                if(mode==='commit-wins') transaction.addEventListener('complete',()=>controller.abort(reason),{once:true});
            }
            work(records,done,fail,transaction);
            if(Array.isArray(names) && mode==='after-requests')controller.abort(reason);
        },...args);
        if(mode==='pre-aborted')controller.abort(reason);
        try { await store.saveTrack(scope,track,{ownerId:owner,job:completed,signal}); }
        catch(error) { caught=true;exactReason=error===reason; }
        const retained=await store.local(scope,'jobs',id);
        const records=await store.records(scope), tracks=await store.tracks(scope,key);
        const result={caught,exactReason,puts,notifications,listeners:listeners.size,aborted:signal.aborted,
            unchanged:JSON.stringify(retained)===JSON.stringify(job),status:retained.status,
            records:records.length,tracks:tracks.length,cues:tracks[0]?.cues.length??0};
        await store.close();
        const reopened=new MediaStore(indexedDB,name);
        try {
            result.reopenedStatus=(await reopened.local(scope,'jobs',id)).status;
            result.reopenedTracks=(await reopened.tracks(scope,key)).length;
        } finally {await reopened.close();}
        return result;
    } finally {off();await store.close();}
}'''

QUEUE_CASE = '''async ({version,action}) => {
    const {MediaStore,TranscriptionQueue}=modules;
    const store=new MediaStore(indexedDB,'queue-publication-'+crypto.randomUUID());
    const scope='guest',key='content:'+'d'.repeat(64);
    const counts={prepare:0,infer:0,decode:0,dispose:0};
    const engine={prepare:async()=>{counts.prepare++},transcribe:async()=>{counts.infer++;return '[0][S01]保存する字幕[1]'},dispose(){counts.dispose++}};
    const decode=async()=>{counts.decode++;return new Float32Array(32000).fill(.1)};
    const queue=new TranscriptionQueue(store,scope,engine,decode);
    let stopped,successor,published=false,signalReceived=false;
    const publish=store.saveTrack.bind(store);
    store.saveTrack=(...args)=>{
        signalReceived=args[2]?.signal instanceof AbortSignal;
        const pending=publish(...args);
        stopped=action==='close'?queue.dispose():queue.cancel(args[2].job.id);
        published=true;
        return pending;
    };
    const until=async check=>{for(let n=0;n<500;n++){if(await check())return;await new Promise(r=>setTimeout(r,10))}throw Error('Queue state timeout')};
    try {
        let j;
        if(version===1) {
            j={version:1,id:crypto.randomUUID(),mediaKey:key,language:'ja',audioTrack:'1',duration:2,
                status:'paused',nextWindow:0,cues:[],modelSha256:modules.MOSS.sha256,engineRevision:modules.MOSS.engineRevision,createdAt:1};
            await store.putLocal(scope,'jobs',j.id,j);await queue.resume(j.id);
        } else j=await queue.enqueue(key,'ja','1',2,version===3?0:undefined);
        await until(()=>published);await stopped;
        await until(async()=>['paused','complete'].includes((await store.local(scope,'jobs',j.id)).status));
        await queue.dispose();
        const paused=await store.local(scope,'jobs',j.id);
        const before={status:paused.status,nextWindow:paused.nextWindow,cues:paused.cues,
            completedAt:paused.completedAt,pauseReason:paused.pauseReason,tracks:(await store.tracks(scope,key)).length};
        store.saveTrack=publish;
        successor=new TranscriptionQueue(store,scope,engine,decode);
        await successor.resume(j.id);
        await until(async()=>(await store.local(scope,'jobs',j.id)).status==='complete');
        const [track]=await store.tracks(scope,key);
        return {before,signalReceived,counts,id:j.id,trackId:track.id,
            sameCues:JSON.stringify(track.cues)===JSON.stringify(before.cues),generatedAt:track.provenance.generatedAt};
    } finally {await queue.dispose();await successor?.dispose();await store.close();}
}'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/publication-cancellation')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
            try:
                page = browser.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/__publication_cancel__/')
                page.wait_for_function('window.ready===true')
                for mode, reason in [('pre-aborted', 'cancelled'), ('after-requests', False), ('after-first-page-put', None), ('commit-wins', 0), ('committing-wins', 'too late')]:
                    result = page.evaluate(STORE_CASE, dict(mode=mode, reason=reason))
                    if mode in ('commit-wins', 'committing-wins'):
                        assert not result['caught'] and result['status'] == 'complete' and result['cues'] == 1500, result
                        assert result['reopenedTracks'] == 1 and result['notifications'] == 1, result
                    else:
                        assert result['caught'] and result['exactReason'] and result['unchanged'], result
                        assert result['records'] == 0 and result['tracks'] == 0 and result['notifications'] == 0, result
                        assert result['reopenedStatus'] == 'running' and result['reopenedTracks'] == 0, result
                        if mode == 'after-first-page-put':
                            assert result['puts'] == 1, result
                    assert result['listeners'] == 0 and result['aborted'], result
                    results.append(dict(name=mode, passed=True, details=result))
                    print('PASS', mode, flush=True)
                for version in (1, 2, 3):
                    for action in ('close', 'cancel'):
                        result = page.evaluate(QUEUE_CASE, dict(version=version, action=action))
                        before = result['before']
                        assert result['signalReceived'] and before['status'] == 'paused' and before['tracks'] == 0, result
                        assert before['nextWindow'] == 1 and len(before['cues']) == 1 and before['completedAt'], result
                        if action == 'cancel':
                            assert before['pauseReason'] == 'user', result
                        assert result['sameCues'] and result['generatedAt'] == before['completedAt'] and result['trackId'] == result['id'], result
                        assert {k: result['counts'][k] for k in ('prepare', 'infer', 'decode')} == dict(prepare=1, infer=1, decode=1), result
                        name = f'version {version} {action}: final checkpoint resumes without inference'
                        results.append(dict(name=name, passed=True, details=result))
                        print('PASS', name, flush=True)
            finally:
                browser.close()
    except Exception as error:
        results.append(dict(name='native publication cancellation', passed=False, error=str(error)))
        raise
    finally:
        (args.output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        server.shutdown()


if __name__ == '__main__':
    main()
