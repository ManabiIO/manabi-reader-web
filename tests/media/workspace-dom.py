#!/usr/bin/env python3
"""Production VideoWorkspace/VideoPlayer in Chromium with generated MP4 bytes.

Uses explicit transaction, decoder/metadata and recognition doubles, not Svelte,
IndexedDB, cloud transport or real MOSS. getRandomValues supplies the UUID shim for
this opaque in-memory test document; no browser security policy is changed.
"""
import argparse, base64, functools, json, os, pathlib, re, traceback
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'.cache/media-workspace-dom')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    build=ROOT/'.cache/media-test-build'
    @functools.cache
    def module(name):
        source=(build/name).read_text()
        source=re.sub(r'''(['"])(\./[^'"\n]+\.js)\1''',lambda m:m[1]+module(m[2][2:])+m[1],source)
        return 'data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
    def data(path):return base64.b64encode(path.read_bytes()).decode()
    results=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1280,'height':900});page.set_default_timeout(6000)
        page.set_content('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f5f8f8}'+(build/'media.css').read_text()+'</style><div id="host"></div>')
        page.evaluate('''async args=>{
            // The document is intentionally opaque, not a fake secure origin.
            // UUID generation is the only missing secure-context primitive needed by these doubles.
            if(!crypto.randomUUID)crypto.randomUUID=()=>{
                const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
                const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
            };
            window.VideoWorkspace=(await import(args.workspace)).VideoWorkspace;
            window.VideoPlayer=(await import(args.player)).VideoPlayer;
            window.MediaStore=(await import(args.store)).MediaStore;
            const doubles=await import(args.doubles);window.TransactionFactory=doubles.TransactionFactory;window.IDBKeyRange=doubles.RangeDouble;
            window.localSource=(await import(args.sources)).localSource;
            window.fixtures=args.fixtures.map(b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0)));
            window.bound=[];const bind=VideoPlayer.prototype.bindIdentity;
            VideoPlayer.prototype.bindIdentity=async function(key){bound.push({key,name:this.options.source.name});return bind.call(this,key)};
            window.makeSource=(name,which=0)=>localSource(new File([fixtures[which]],name,{type:'video/mp4'}));
            window.syntheticKey=letter=>'content:'+letter.repeat(64);
            window.info=title=>({version:1,title,duration:30,width:320,height:180,addedAt:1});
            window.resume=(key,position,finished=false)=>({version:1,mediaKey:key,position,duration:30,rate:1,finished,updatedAt:2,primary:null,secondary:null,delays:{}});
            window.testLocks={request:async(_name,options,callback)=>
                callback(options?.ifAvailable===true?{name:'manabi-moss-inference'}:{name:'manabi-moss-inference'})};
            window.reset=async (config={})=>{
                if(window.workspace)await workspace.dispose();if(window.store)await store.close();
                Object.defineProperty(navigator,'locks',{
                    configurable:true,value:config.noLocks?undefined:testLocks
                });
                window.bound=[];window.prepares=0;window.inferences=0;window.writes=[];window.aliasBlocked=false;
                window.factory=new TransactionFactory();window.store=new MediaStore(factory,'workspace-test');
                const originalPut=store.putLocal.bind(store),originalLocal=store.local.bind(store);
                const originalEnqueue=store.enqueueJob.bind(store);
                store.enqueueJob=async(...args)=>{
                    if(config.holdAdmission){
                        window.admissionBlocked=true;
                        await new Promise(resolve=>window.releaseAdmission=resolve);
                    }
                    return originalEnqueue(...args);
                };
                store.putLocal=async(scope,kind,id,value)=>{
                    if(config.holdFirstAlias&&kind==='aliases'&&value.name==='First.mp4'){
                        aliasBlocked=true;await new Promise(resolve=>window.releaseAlias=resolve);
                    }
                    writes.push({kind,id,value:structuredClone(value)});return originalPut(scope,kind,id,value);
                };
                store.local=async(scope,kind,id)=>{
                    if(config.holdSync&&kind==='settings'&&id==='sync')return await new Promise(resolve=>window.releaseSync=resolve);
                    return originalLocal(scope,kind,id);
                };
                const bunny={create(source){return {
                    async getAudioTracks(){return [
                        {id:1,getName:async()=> 'English dub',getLanguageCode:async()=> 'en',getDisposition:async()=>({default:false,primary:false,forced:false,original:false,commentary:false,hearingImpaired:false,visuallyImpaired:false}),canDecode:async()=>true},
                        {id:2,getName:async()=> 'Japanese original',getLanguageCode:async()=> 'ja',getDisposition:async()=>({default:true,primary:true,forced:false,original:true,commentary:false,hearingImpaired:false,visuallyImpaired:false}),canDecode:async()=>true}
                    ]},computeDuration:async()=>20,getPrimaryVideoTrack:async()=>null,dispose(){}
                }}};
                const engine={async prepare(){prepares++},async transcribe(){inferences++;return '[0][S01]こんにちは。[1]'},dispose(){}};
                const connection=config.account?{transport:{userId:'test',isCurrent:()=>true,async request(){return {items:[],next_cursor:0,has_more:false}}}}:{};
                window.workspace=new VideoWorkspace(document.querySelector('#host'),{
                    scope:config.account?'account:test':'guest',booksURL:'/manage',runtimeBase:'/moss',store,engine,loadBunny:async()=>bunny,...connection
                });
            };
        }''',dict(workspace=module('workspace.js'),player=module('player.js'),store=module('store.js'),sources=module('sources.js'),
                  doubles='data:text/javascript;base64,'+data(ROOT/'tests/media/transaction-double.mjs'),
                  fixtures=[data(args.fixture/'video.mp4'),data(args.fixture/'embedded.mp4')]))
        def case(name,fn):
            print('RUN',name,flush=True)
            try:fn();results.append(dict(name=name,passed=True));print('PASS',name,flush=True)
            except Exception as e:
                error=''.join(traceback.format_exception(e))
                results.append(dict(name=name,passed=False,error=error));print('FAIL',name,error,flush=True)
                page.screenshot(path=str(args.output/f'failure-{len(results)}.png'))
        def switching():
            page.evaluate('reset({holdFirstAlias:true})')
            page.evaluate("window.first=workspace.openSource(makeSource('First.mp4'));void 0")
            page.wait_for_function('aliasBlocked')
            page.evaluate("workspace.openSource(makeSource('Second.mp4',1))")
            page.wait_for_function("bound.some(b=>b.name==='Second.mp4')")
            key=page.evaluate('workspace.current.key')
            page.evaluate('releaseAlias();first')
            assert page.evaluate('workspace.current.key')==key
            assert page.evaluate("bound.every(b=>b.name==='Second.mp4' && b.key===workspace.current.key)")
            assert page.evaluate('prepares')==0
        case('late first-file storage continuation cannot bind its identity to the successor player',switching)
        def switching_pauses_sparse_job():
            page.evaluate('reset()')
            page.evaluate("workspace.openSource(makeSource('Captioned.mp4'))")
            page.wait_for_function('workspace.current && workspace.player?.generationAvailable')
            page.evaluate("""async()=>{
                window.oldKey=workspace.current.key;
                const q=workspace.queue;
                q.decode=async(_job,start,end)=>new Float32Array(Math.ceil((end-start)*16000)).fill(.1);
                window.sparseCalls=0;window.secondSparseStarted=false;
                q.engine.transcribe=async(_pcm,signal)=>{
                    sparseCalls++;
                    if(sparseCalls===1)return '[5][S01]保存された字幕です。[6]';
                    secondSparseStarted=true;
                    return await new Promise((_,reject)=>{
                        if(signal.aborted)reject(signal.reason);
                        else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
                    });
                };
                window.oldJob=await q.enqueue(oldKey,'ja','2',78,0);
                window.otherOldJob=await q.enqueue(oldKey,'en','1',78,0);
            }""")
            page.wait_for_function("secondSparseStarted && workspace.currentTranscription?.id===oldJob.id")
            page.evaluate("workspace.openSource(makeSource('Other.mp4',1))")
            page.wait_for_function("workspace.current?.key!==oldKey && workspace.current && Promise.all([store.local('guest','jobs',oldJob.id),store.local('guest','jobs',otherOldJob.id)]).then(([active,queued])=>active?.status==='paused'&&queued?.status==='queued')")
            result=page.evaluate("""async()=>{
                const saved=await store.local('guest','jobs',oldJob.id);
                const other=await store.local('guest','jobs',otherOldJob.id);
                return {windows:saved.nextWindow,cues:saved.cues.length,
                    otherWindows:other.nextWindow,published:(await store.tracks('guest',oldKey)).length,calls:sparseCalls};
            }""")
            assert result==dict(windows=1,cues=1,otherWindows=0,published=0,calls=2),result
            page.evaluate("workspace.queue.task")
            assert page.evaluate('sparseCalls')==2
            page.evaluate("""async()=>{
                workspace.queue.engine.transcribe=async()=>{
                    sparseCalls++;return '[5][S01]続きの字幕です。[6]';
                };
                await workspace.openSource(makeSource('Captioned.mp4'));
            }""")
            page.wait_for_function("store.local('guest','jobs',oldJob.id).then(j=>j?.status==='complete')")
            complete=page.evaluate("""async()=>{
                const tracks=await store.tracks('guest',oldKey);
                const original=tracks.find(track=>track.id===oldJob.id);
                return {sameVideo:workspace.current.key===oldKey,calls:sparseCalls,
                    tracks:tracks.length,complete:original?.complete,
                    otherComplete:tracks.some(track=>track.id===otherOldJob.id&&track.complete),
                    cues:original?.cues.map(c=>c.text)};
            }""")
            assert complete==dict(sameVideo=True,calls=7,tracks=2,complete=True,otherComplete=True,
                cues=['保存された字幕です。','続きの字幕です。','続きの字幕です。']),complete
        case('switching videos pauses sparse inference; reopening automatically resumes saved work',switching_pauses_sparse_job)
        def no_web_locks():
            page.evaluate('reset({noLocks:true})')
            page.evaluate("workspace.openSource(makeSource('No-locks.mp4'))")
            page.wait_for_function('workspace.current && workspace.audioChoices.length')
            assert page.get_by_role('button',name='Generate transcript',exact=True).is_disabled()
            assert 'Web Locks unavailable' in page.locator('main').inner_text()
            result=page.evaluate("""async()=>{
                try{await workspace.queue.enqueue(workspace.current.key,'ja','2',20,0)}
                catch(e){return {message:String(e),jobs:(await store.listLocal('guest','jobs')).length}}
            }
            """)
            assert 'Web Locks' in result['message'] and result['jobs']==0,result
        case('browsers without Web Locks cannot admit concurrent model inference',no_web_locks)
        def explicit_cancel_overrides_switch():
            page.evaluate('reset()')
            page.evaluate("workspace.openSource(makeSource('First.mp4'))")
            page.wait_for_function('workspace.current && workspace.player?.generationAvailable')
            page.evaluate("""async()=>{
                window.originalKey=workspace.current.key;
                const q=workspace.queue;
                q.decode=async(_job,start,end)=>new Float32Array(Math.ceil((end-start)*16000)).fill(.1);
                q.engine.transcribe=async(_pcm,signal)=>new Promise((_,reject)=>{
                    if(signal.aborted)reject(signal.reason);
                    else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
                });
                window.cancelledAfterSwitch=await q.enqueue(originalKey,'ja','2',52,0);
            }""")
            page.wait_for_function("store.local('guest','jobs',cancelledAfterSwitch.id).then(j=>j?.status==='running')")
            page.evaluate("workspace.openSource(makeSource('Second.mp4',1))")
            page.wait_for_function("store.local('guest','jobs',cancelledAfterSwitch.id).then(j=>j?.status==='paused')")
            page.evaluate("workspace.queue.cancel(cancelledAfterSwitch.id)")
            page.evaluate("workspace.openSource(makeSource('First.mp4'))")
            page.wait_for_function('workspace.current?.key===originalKey')
            result=page.evaluate("""async()=>{
                const job=await store.local('guest','jobs',cancelledAfterSwitch.id);
                return {status:job.status,reason:job.pauseReason,tracks:(await store.tracks('guest',originalKey)).length};
            }""")
            assert result==dict(status='paused',reason='user',tracks=0),result
        case('explicit Cancel after a switch prevents automatic restart',explicit_cancel_overrides_switch)
        def late_generation_after_switch():
            page.evaluate('reset({holdAdmission:true})')
            page.evaluate("workspace.openSource(makeSource('Admission.mp4'))")
            page.wait_for_function('workspace.current && workspace.player?.generationAvailable')
            page.evaluate("""()=>{
                window.departedKey=workspace.current.key;
                workspace.audio.value='2';workspace.lang.value='ja';
                const q=workspace.queue;
                q.decode=async(_job,start,end)=>new Float32Array(Math.ceil((end-start)*16000)).fill(.1);
                q.engine.transcribe=async(_pcm,signal)=>new Promise((_,reject)=>{
                    if(signal.aborted)reject(signal.reason);
                    else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
                });
                window.lateGeneration=workspace.generate();
            }""")
            page.wait_for_function('admissionBlocked')
            page.evaluate("workspace.openSource(makeSource('After-admission.mp4',1))")
            page.wait_for_function('workspace.current && workspace.current.key!==departedKey')
            result=page.evaluate("""async()=>{
                releaseAdmission();
                const returned=await lateGeneration;
                const jobs=await store.listLocal('guest','jobs');
                return {returned:returned??null,attached:workspace.currentTranscription?.mediaKey??null,
                    old:jobs.filter(j=>j.mediaKey===departedKey).map(j=>j.status),
                    published:(await store.tracks('guest',departedKey)).length};
            }""")
            assert result['returned'] is None and result['attached'] is None and result['published']==0,result
            assert result['old'][0] in ('queued','paused'),result
        case('late Generate admission after a switch cannot attach or run the old video',late_generation_after_switch)
        def play_and_sidecar_during_hash():
            page.evaluate('reset()')
            page.evaluate(r"""()=>{
                const source=makeSource('Early.mp4');
                const read=source.read.bind(source);
                window.hashGate=new Promise(resolve=>window.releaseHash=resolve);
                source.read=async(start,end,signal)=>{
                    if(end-start>32768)await hashGate;
                    return read(start,end,signal);
                };
                const text='1\n00:00:00,100 --> 00:00:01,500\n早い字幕です。';
                window.opened=workspace.openSource(source,[new File([text],'Early.ja.srt')]);
            }""")
            page.wait_for_function("document.querySelector('[aria-label=\"Choose existing subtitles\"]')?.options.length===2")
            page.wait_for_function('workspace.player.video.readyState>=1')
            assert page.evaluate('workspace.current===undefined'), 'portable hashing must still be pending'
            temp=page.evaluate("document.querySelector('[aria-label=\"Choose existing subtitles\"]').options[1].value")
            # Dispatch value and change in one browser task: embedded discovery
            # can rebuild this picker between separate automation operations.
            page.evaluate("""id=>{
                const picker=document.querySelector('[aria-label="Choose existing subtitles"]');
                if(![...picker.options].some(option=>option.value===id))throw Error('Early sidecar vanished');
                picker.value=id;picker.dispatchEvent(new Event('change',{bubbles:true}));
            }""",temp)
            assert page.locator('.transcript-cue').count()==1
            assert page.evaluate('inferences')==0
            page.evaluate('releaseHash();opened')
            page.wait_for_function('workspace.current!==undefined')
            page.wait_for_function('(old)=>workspace.player.primary.value!==old',arg=temp)
            assert page.locator('.transcript-cue').count()==1
        case('video and authored sidecar work while full identity hashing is pending',play_and_sidecar_during_hash)
        def account_replaced_at_identity_boundary():
            page.evaluate('reset()')
            page.evaluate("""async()=>{
                const source=makeSource('Account-change.mp4');
                const read=source.read.bind(source);
                let current=true;
                source.isCurrent=()=>current;
                source.read=async(start,end,signal)=>{
                    const bytes=await read(start,end,signal);
                    if(end-start>32768)current=false;
                    return bytes;
                };
                await workspace.openSource(source);
            }""")
            result=page.evaluate("""async()=>({
                current:workspace.current?.key??null,
                aliases:(await store.listLocal('guest','aliases')).length,
                bound:bound.length
            })""")
            assert result==dict(current=None,aliases=0,bound=0),result
        case('an account revoked after its last hash range cannot bind the video',account_replaced_at_identity_boundary)
        def verified_source_is_not_hashed_twice():
            page.evaluate('reset()')
            page.evaluate("workspace.openSource(makeSource('Verified.mp4'))")
            page.wait_for_function('workspace.current')
            result=page.evaluate("""async()=>{
                const key=workspace.current.key;
                const file=workspace.current.source.file;
                workspace.sources.clear();
                const local=store.local.bind(store);
                store.local=async(scope,kind,id)=>kind==='aliases'&&id===key
                    ? {key,name:file.name,handle:{getFile:async()=>file}}
                    : local(scope,kind,id);
                try{
                    const source=await workspace.resolveSource(key);
                    let release;
                    const gate=new Promise(resolve=>release=resolve);
                    const read=source.read.bind(source);
                    source.read=async(start,end,signal)=>{
                        if(end-start>32768)await gate;
                        return read(start,end,signal);
                    };
                    const opened=workspace.openSource(source,[],key);
                    const finished=await Promise.race([
                        opened.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),500))
                    ]);
                    release();await opened;
                    return {finished,sameKey:workspace.current.key===key};
                }finally{store.local=local}
            }""")
            assert result==dict(finished=True,sameKey=True),result
        case('a verified saved source is not fully hashed a second time while opening',verified_source_is_not_hashed_twice)
        def audio():
            page.wait_for_function("document.querySelector('[aria-label=\"Audio track for transcription\"]').value==='2'")
            assert page.get_by_label('Audio track for transcription',exact=True).input_value()=='2'
            assert page.evaluate('prepares')==0
        case('automatic language uses the tagged original stream rather than the first dub, without inference',audio)
        def wrong_audio():
            page.evaluate('reset()')
            page.evaluate("workspace.openSource(makeSource('Language.mp4'))")
            page.wait_for_function('workspace.current && !workspace.audio.disabled')
            page.locator('summary',has_text='Transcription and sync').click()
            page.get_by_label('Audio track for transcription',exact=True).select_option('1')
            page.get_by_label('Caption language',exact=True).fill('ja')
            error=page.evaluate('workspace.generate().then(()=>null,e=>e.message)')
            assert 'selected audio is en' in error
            assert page.evaluate('prepares')==0
            page.get_by_label('Audio track for transcription',exact=True).select_option('2')
        case('explicit generation cannot mislabel a known English stream as Japanese',wrong_audio)
        def sync_choice():
            page.evaluate('reset({account:true,holdSync:true})')
            page.locator('summary',has_text='Transcription and sync').click()
            checkbox=page.get_by_label('Sync video progress and subtitles with Manabi',exact=True)
            checkbox.check();page.wait_for_function('writes.some(w=>w.kind==="settings" && w.id==="sync")')
            page.evaluate('releaseSync(false)');page.wait_for_timeout(40)
            assert checkbox.is_checked()
        case('late preference restore cannot undo an explicit sync opt-in',sync_choice)
        def retry_cadence():
            page.evaluate('reset({account:true})')
            page.evaluate("window.requests=0;workspace.options.transport.request=async()=>{requests++;throw Error('network unavailable')};void 0")
            page.locator('summary',has_text='Transcription and sync').click()
            page.get_by_label('Sync video progress and subtitles with Manabi',exact=True).check()
            page.evaluate("store.edit('account:test','video_info',syntheticKey('a'),syntheticKey('a'),info('Pending'))")
            page.wait_for_function('requests>0')
            calls=page.evaluate('requests')
            page.wait_for_timeout(2300)
            assert page.evaluate('requests')==calls, 'failed requests must not schedule a one-second loop'
            assert page.evaluate("store.records('account:test').then(rows=>rows.some(r=>r.dirty||r.pending))")
        case('failed account requests retain edits without a tight retry loop',retry_cadence)
        def refresh_coalesces():
            page.evaluate('reset()');page.evaluate('workspace.refreshJobs()')
            result=page.evaluate("""async()=>{
                const original=store.listLocal.bind(store);let calls=0,first;
                store.listLocal=async(...args)=>{if(args[1]!=='jobs')return original(...args);calls++;if(calls===1)return new Promise(resolve=>first=resolve);return [];};
                const pending=workspace.refreshJobs();for(let i=0;i<200;i++)workspace.refreshJobs();
                first([]);await pending;store.listLocal=original;return calls;
            }""")
            assert result==2
        case('bursts of queue notifications coalesce into one active read and one latest read',refresh_coalesces)
        def delayed_job_read():
            page.evaluate('reset()');page.evaluate('workspace.refreshJobs()')
            result=page.evaluate("""async()=>{
                const original=store.listLocal.bind(store);let calls=0,first;
                store.listLocal=async(...args)=>{if(args[1]!=='jobs')return original(...args);calls++;if(calls===1)return new Promise(resolve=>first=resolve);return [];};
                const seen=[],render=workspace.renderJobs.bind(workspace);workspace.renderJobs=jobs=>{seen.push(jobs.length);render(jobs)};
                const pending=workspace.refreshJobs();workspace.refreshJobs();
                first([]);await pending;store.listLocal=original;workspace.renderJobs=render;return seen;
            }""")
            assert result==[0], 'a superseded snapshot must not render'
        case('a superseded delayed job snapshot does not flash stale queue state',delayed_job_read)
        def sidecars():
            page.evaluate('reset()')
            page.evaluate("workspace.openSource(makeSource('Lesson.mp4'))")
            page.wait_for_function('workspace.current && !workspace.audio.disabled')
            result=page.evaluate(r"""async()=>{
                const key=workspace.current.key, text='1\n00:00:00,100 --> 00:00:01,500\nこんにちは。\n\n2\n00:00:01,600 --> 00:00:03,000\n二つ目の文です。';
                const add=name=>workspace.importSubtitle(new File([text],name,{type:'text/plain'}));
                await add('Lesson.ja.forced.srt');await add('Lesson.ja.srt');await add('Lesson.ja.srt');
                return (await store.tracks('guest',key)).map(t=>({forced:t.forced,origin:t.origin}));
            }""")
            assert len(result)==2 and sorted(t['forced'] for t in result)==[False,True]
        case('identical forced and full authored subtitles remain separate, while repeated full imports deduplicate',sidecars)
        def external_caption():
            result=page.evaluate("""async()=>{
                const key=workspace.current.key;
                window.externalTrack={version:1,id:crypto.randomUUID(),mediaKey:key,label:'Another tab',language:'en',kind:'translation',origin:'sidecar',complete:true,forced:false,createdAt:3,
                    cues:[{id:'one',start:.1,end:3,text:'Published elsewhere'}]};
                await store.saveTrack('guest',externalTrack);return externalTrack.id;
            }""")
            page.wait_for_function('workspace.player.tracks.some(t=>t.id===externalTrack.id)')
            assert page.get_by_label('Translation track',exact=True).locator(f'option[value="{result}"]').count()==1
        case('a store caption publication refreshes the active player without reopening or an account poll',external_caption)
        def unrelated_checkpoint():
            page.evaluate('workspace.refreshTracks()')
            count=page.evaluate("""async()=>{
                const read=store.tracks.bind(store);let calls=0;
                store.tracks=async(...args)=>{calls++;return read(...args)};
                for(let i=0;i<4;i++)await store.putLocal('guest','device-playback','sample',{position:i});
                await new Promise(r=>setTimeout(r,50));store.tracks=read;return calls;
            }""")
            assert count==0
        case('playback and queue-only notifications do not reload caption bodies',unrelated_checkpoint)
        def delayed_caption():
            page.evaluate('workspace.refreshTracks()')
            result=page.evaluate("""async()=>{
                const read=store.tracks.bind(store),latest=await read('guest',workspace.current.key);
                let calls=0,release;store.tracks=async(...args)=>{calls++;if(calls===1)return new Promise(resolve=>release=resolve);return read(...args)};
                const seen=[],render=workspace.player.setTracks.bind(workspace.player);
                workspace.player.setTracks=tracks=>{seen.push(tracks.map(t=>t.id));render(tracks)};
                const pending=workspace.refreshTracks();for(let i=0;i<100;i++)workspace.refreshTracks();
                release([]);await pending;store.tracks=read;workspace.player.setTracks=render;
                return {calls,seen,latest:latest.map(t=>t.id)};
            }""")
            assert result['calls']==2 and result['seen']==[result['latest']]
        case('caption refreshes coalesce and discard a superseded empty snapshot',delayed_caption)
        def old_caption_failure():
            page.evaluate('workspace.refreshTracks()')
            result=page.evaluate("""async()=>{
                const read=store.tracks.bind(store);let calls=0,fail;
                store.tracks=async(...args)=>{calls++;if(calls===1)return new Promise((_,reject)=>fail=reject);return read(...args)};
                const first=workspace.refreshTracks();workspace.refreshTracks();fail(Error('superseded'));
                await first;store.tracks=read;return calls;
            }""")
            assert result==2
        case('a stale caption-read failure does not prevent the queued current refresh',old_caption_failure)
        def completion_notification():
            page.evaluate('workspace.refreshTracks()');page.evaluate('workspace.refreshJobs()')
            result=page.evaluate("""async()=>{
                const results=[];
                for(const [drain,refresh] of [['drainTrackRefresh','refreshTracks'],['drainJobRefresh','refreshJobs']]){
                    const original=workspace[drain].bind(workspace);let calls=0;
                    workspace[drain]=async()=>{await original();if(++calls===1)queueMicrotask(()=>workspace[refresh]());};
                    await workspace[refresh]();await new Promise(r=>setTimeout(r,0));workspace[drain]=original;results.push(calls);
                }return results;
            }""")
            assert result==[2,2]
        case('notifications at the drain-completion boundary cannot be stranded behind a settled promise',completion_notification)
        def populate():
            page.evaluate('reset()')
            page.evaluate('''async()=>{
                for(const [letter,title] of [['a','Watching'],['b','Finished'],['c','New']]){
                    const key=syntheticKey(letter);await store.edit('guest','video_info',key,key,info(title));
                }
                await store.edit('guest','video_resume',syntheticKey('a'),syntheticKey('a'),resume(syntheticKey('a'),4));
                await store.edit('guest','video_resume',syntheticKey('b'),syntheticKey('b'),resume(syntheticKey('b'),30,true));
            }''')
            page.wait_for_function('document.querySelectorAll(".video-card").length===3')
        def filtering():
            populate();page.get_by_label('Select New',exact=True).check()
            page.get_by_label('Filter videos',exact=True).select_option('continue')
            page.wait_for_function('document.querySelectorAll(".video-card").length===1')
            assert page.locator('.video-card-title').inner_text()=='Watching'
            assert page.evaluate('workspace.selected.size')==0
            page.get_by_label('Filter videos',exact=True).select_option('finished');page.wait_for_function('document.querySelector(".video-card-title")?.textContent==="Finished"')
            page.get_by_label('Filter videos',exact=True).select_option('unwatched');page.wait_for_function('document.querySelector(".video-card-title")?.textContent==="New"')
        case('Continue watching, Finished and Not watched share the saved progress and clear hidden selection',filtering)
        def focus():
            page.get_by_label('Filter videos',exact=True).select_option('all');page.wait_for_function('document.querySelectorAll(".video-card").length===3')
            card=page.locator('.video-card').filter(has=page.get_by_role('button',name='Watching',exact=True))
            card.locator('summary').click();card.get_by_role('button',name='Rename title',exact=True).focus()
            page.evaluate("store.edit('guest','video_resume',syntheticKey('a'),syntheticKey('a'),resume(syntheticKey('a'),5))")
            page.wait_for_function('document.querySelector(".video-card")?.textContent.includes("0:05")')
            assert '0:05 / 0:30' in card.inner_text()
            assert card.locator('details').evaluate('e=>e.open')
            assert page.evaluate("document.activeElement.textContent==='Rename title'")
        case('a playback checkpoint refresh preserves an open menu and its keyboard focus',focus)
        def queries():
            page.evaluate('window.readKinds=[];window.oldRecords=store.records.bind(store);store.records=async(...args)=>{readKinds.push(args[1]);return oldRecords(...args)};void 0')
            page.get_by_label('Search videos',exact=True).fill('Watching');page.wait_for_timeout(60)
            assert page.evaluate("readKinds.includes('video_info') && readKinds.includes('video_resume') && !readKinds.includes(undefined)")
        case('shelf refresh only reads metadata and progress, not all subtitle pages',queries)
        def screenshot():
            page.get_by_label('Search videos',exact=True).fill('');page.wait_for_timeout(60)
            page.set_viewport_size(dict(width=390,height=844));page.wait_for_timeout(60)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            page.screenshot(path=str(args.output/'library-phone.png'),full_page=True)
        case('video library controls and cards fit a phone viewport',screenshot)
        def source_cancel(stage):
            page.evaluate('reset()')
            result=page.evaluate("""async stage=>{
                const key=syntheticKey('e');let entered,release,loads=0,creates=0;
                const reached=new Promise(r=>entered=r),held=new Promise(r=>release=r);
                const local=store.local.bind(store),load=workspace.options.loadBunny;
                if(stage==='source')store.local=async(...args)=>{if(args[1]==='aliases'&&args[2]===key){entered();await held;return undefined;}return local(...args)};
                else workspace.sources.set(key,makeSource('Queued.mp4'));
                workspace.options.loadBunny=async()=>{loads++;entered();await held;return {create(){creates++;throw Error('late decoder must not start')}}};
                const job=await workspace.queue.enqueue(key,'ja','2',2);await reached;
                try{
                    await workspace.queue.cancel(job.id);
                    const deadline=performance.now()+2000;let current;
                    do{current=await local('guest','jobs',job.id);if(current.status==='paused')break;await new Promise(r=>setTimeout(r,5));}while(performance.now()<deadline);
                    const before={status:current.status,loads,creates,prepares,inferences};
                    release();await workspace.queue.task;await new Promise(r=>setTimeout(r,0));
                    return {before,loads,creates,prepares,inferences};
                }finally{release();store.local=local;workspace.options.loadBunny=load;}
            }""",stage)
            assert result['before']['status']=='paused',result
            assert result['creates']==0 and result['prepares']==0 and result['inferences']==0,result
            assert result['loads']==(1 if stage=='module' else 0),result
        case('Cancel during saved-source lookup pauses the job before that lookup settles',lambda:source_cancel('source'))
        case('Cancel during decoder-module loading cannot start a late decoder or model',lambda:source_cancel('module'))
        def queued_resume():
            page.evaluate('reset()')
            page.evaluate("""()=>{
                window.runHere=[];workspace.queue.resume=async id=>runHere.push(id);
                workspace.renderJobs([{id:'saved-queued-job',status:'queued',language:'ja',createdAt:1}]);
            }""")
            assert page.evaluate('runHere.length')==0
            page.get_by_role('button',name='Run here',exact=True).click()
            assert page.evaluate('runHere')==['saved-queued-job']
            assert page.evaluate('prepares')==0
        case('unclaimed saved queued jobs offer an explicit Run here action',queued_resume)
        def nonretryable_seam():
            page.evaluate('''()=>{
                workspace.renderJobs([{
                    id:'oversized-seam',status:'failed',language:'ja',createdAt:2,
                    error:'different window policy required',
                    progressive:{
                        policy:'pause-overlap-v2',inputSeconds:30,
                        windows:[{index:0,startSample:0,endSample:480000,coreStartSample:0,coreEndSample:448000}],
                        tail:[{id:'w0/cue-0',start:0,end:29,text:'long',speaker:'w0/S01'}],
                        failedSeam:{window:{index:1,startSample:416000,endSample:1400000,coreStartSample:448000,coreEndSample:1368000},cues:[]}
                    }
                }]);
            }''')
            assert page.get_by_text('different window policy required',exact=False).count()==1
            assert page.get_by_role('button',name='Resume',exact=True).count()==0
        case('a deterministically oversized seam does not advertise an identical Resume',nonretryable_seam)
        def teardown_failure():
            page.evaluate('reset()');page.evaluate("workspace.openSource(makeSource('Closing.mp4'))")
            page.wait_for_function('workspace.player?.video.readyState>=2')
            result=page.evaluate("""async()=>{
                const current=workspace,player=current.player;await player.video.play();
                let queueRelease,playerRelease,queueStarted=false,playerStarted=false;
                const queueHeld=new Promise((_,no)=>queueRelease=no),playerHeld=new Promise(yes=>playerRelease=yes);
                const original=player.dispose.bind(player);
                current.queue.dispose=()=>{queueStarted=true;return queueHeld};
                player.dispose=async()=>{playerStarted=true;await original();await playerHeld};
                const first=current.dispose(),second=current.dispose();let settled=false;
                const outcome=first.then(()=>{settled=true;return null},e=>{settled=true;return e.message});
                try{
                    await new Promise(r=>setTimeout(r,0));
                    const before={same:first===second,paused:player.video.paused,hidden:!current.root.isConnected,queueStarted,playerStarted,settled};
                    queueRelease(Error('shutdown fault'));await new Promise(r=>setTimeout(r,0));
                    const afterQueueFailure=settled;playerRelease();const error=await outcome;
                    return {before,afterQueueFailure,error};
                }finally{queueRelease(Error('cleanup'));playerRelease();await outcome;window.workspace=undefined;}
            }""")
            assert result['before']==dict(same=True,paused=True,hidden=True,queueStarted=True,playerStarted=True,settled=False),result
            assert result['afterQueueFailure'] is False and 'shutdown' in result['error'],result
        case('workspace hides and pauses immediately, drains both owners, and reports shutdown failure afterward',teardown_failure)
        def progressive_flow():
            page.evaluate('reset()');page.evaluate("workspace.openSource(makeSource('Progressive.mp4'))")
            page.wait_for_function('workspace.player?.generationAvailable && workspace.current')
            page.evaluate("""()=>{
                const q=workspace.queue;window.progressiveCalls=0;window.secondStarted=false;
                q.decode=async(_job,start,end)=>new Float32Array(Math.round((end-start)*16000)).fill(.1);
                q.engine.transcribe=async(_pcm,signal,preview)=>{
                    progressiveCalls++;
                    if(progressiveCalls===1){preview?.('[0][S01]仮の文章。[1][3][S01]');return '[0][S01]最初の文章。[2]'}
                    secondStarted=true;
                    return await new Promise((_,reject)=>{
                        if(signal.aborted)reject(signal.reason);
                        else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
                    });
                };
                workspace.player.options.onGenerate=async()=>{
                    window.progressiveJob=await q.enqueue(workspace.current.key,'ja','2',70);return progressiveJob.id;
                };
                void workspace.player.requestGenerate();
            }""")
            page.wait_for_function('secondStarted && document.querySelectorAll(".transcript-cue").length===1')
            assert page.locator('.transcript-cue').inner_text()=='最初の文章。'
            assert page.evaluate('!workspace.player.exportTrack() && workspace.player.primary.value===progressiveJob.id')
            assert page.evaluate("store.tracks('guest',workspace.current.key).then(tracks=>tracks.length)")==0
            page.evaluate('workspace.queue.cancel(progressiveJob.id)')
            page.evaluate('workspace.queue.task')
            page.evaluate('workspace.refreshJobs()')
            page.wait_for_function('document.querySelector(".transcription-progress-note")?.textContent.includes("paused")')
            assert page.locator('.transcript-cue').inner_text()=='最初の文章。'
            assert page.evaluate("store.local('guest','jobs',progressiveJob.id).then(job=>job.status==='paused' && job.nextWindow===1 && job.cues.length===1)")
        case('real queue checkpoints reach the active player before completion and survive Cancel',progressive_flow)
        page.evaluate('reset()')
        page.evaluate('workspace.dispose()');page.evaluate('store.close()');browser.close()
    report=dict(scope='Production workspace/player in-memory Chromium; transaction, media metadata and ASR doubles; UUID shim uses getRandomValues',
                notCovered=['Svelte/Vite integration','native IndexedDB or secure-context worker loading','Mediabunny decoding','cloud providers','real MOSS'],
                tests=results,passed=sum(r['passed'] for r in results),failed=sum(not r['passed'] for r in results))
    (args.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if report['failed']:raise SystemExit(1)
if __name__=='__main__':main()
