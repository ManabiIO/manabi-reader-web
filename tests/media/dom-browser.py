#!/usr/bin/env python3
"""Actual Chromium media/DOM tests without a server.

Production ES modules and generated video bytes are loaded in an in-memory page.
Persistence is an explicit double; this does NOT qualify IndexedDB, Svelte routing,
OAuth, cloud transport, secure-context worker startup or inference.
"""
import argparse, base64, functools, json, os, pathlib, re, traceback
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT/'.cache/media-dom-evidence')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM','/usr/bin/chromium'))
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    build = ROOT/'.cache/media-test-build'
    @functools.cache
    def module(name):
        source = (build/name).read_text()
        def replace(match): return match[1] + module(match[2][2:]) + match[1]
        source = re.sub(r'''(['"])(\./[^'"\n]+\.js)\1''', replace, source)
        return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()
    fixture = base64.b64encode((args.fixture/'video.mp4').read_bytes()).decode()
    results=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1280,'height':900})
        page.set_default_timeout(5000)
        page.set_content('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f5f8f8}'+(build/'media.css').read_text()+'</style><main class="manabi-media" id="root"></main>')
        page.evaluate('''async ({playerURL,sourceURL,fixture}) => {
            const {VideoPlayer}=await import(playerURL), {localSource}=await import(sourceURL);
            const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0));
            window.mediaKey='content:'+'a'.repeat(64);
            window.trackId='11111111-1111-4111-8111-111111111111';
            window.trackId2='22222222-2222-4222-8222-222222222222';
            window.track=(id,language,cues)=>({version:1,id,mediaKey,label:language+' · Original captions',language,
                kind:language==='ja'?'transcription':'translation',origin:'sidecar',complete:true,forced:false,createdAt:1,cues});
            window.playback=(position,updatedAt=10)=>({version:1,mediaKey,position,duration:30,rate:1,finished:false,updatedAt,primary:trackId,secondary:trackId2,delays:{}});
            window.createPlayer=async (config={})=>{
                if(window.player)await window.player.dispose();
                window.errors=[];window.writes=[];window.locals=[];window.generated=0;window.exported=[];
                const saved=new Map();let version=config.remote?'v0':null;
                window.store={
                    async local(scope,kind,id){
                        if(kind==='device-playback')return config.device;
                        if(id==='captions'&&config.delayedStyle)return await new Promise(r=>window.resolveStyle=r);
                        return saved.get(kind+'/'+id);
                    },
                    async putLocal(scope,kind,id,value){locals.push({scope,kind,id,value:structuredClone(value)});saved.set(kind+'/'+id,structuredClone(value));},
                    async get(){if(config.delayedRemote)await new Promise(r=>window.resolveRemote=r);return config.remote?{localVersion:version,payload:config.remote}:undefined;},
                    async edit(scope,kind,id,key,payload,expected){if(expected!==version)throw Error('conflict');version='v'+writes.length;writes.push(structuredClone(payload));return {localVersion:version};}
                };
                window.player=new VideoPlayer({scope:'guest',source:localSource(new File([bytes],'fixture.mp4',{type:'video/mp4'})),store,
                    onError:m=>errors.push(m),onGenerate:()=>generated++,onImport:()=>{},onExport:track=>exported.push(track.id)});
                document.querySelector('#root').replaceChildren(player.root);
                await new Promise((resolve,reject)=>{if(player.video.readyState>=1)return resolve();player.video.addEventListener('loadedmetadata',resolve,{once:true});player.video.addEventListener('error',()=>reject(Error('fixture video codec failed')),{once:true});});
                return player.video.duration;
            };
            window.select=(label,value)=>{const e=document.querySelector('[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
            window.captions=()=>{
                player.setTracks([track(trackId,'ja',[{id:'ja1',start:0,end:6,text:'こんにちは。<img src=x onerror=alert(1)>'},{id:'ja2',start:7,end:12,text:'今日は本を読みます。'}]),
                    track(trackId2,'en',[{id:'en1',start:0,end:8,text:'Hello. Today we are reading.'},{id:'en2',start:8,end:12,text:'Enjoy the story.'}])]);
                select('Secondary captions',trackId2);
            };
        }''', {'playerURL':module('player.js'),'sourceURL':module('sources.js'),'fixture':fixture})
        def case(name, fn):
            try:
                print('RUN',name,flush=True)
                fn();results.append({'name':name,'passed':True});print('PASS',name,flush=True)
            except Exception as e:
                results.append({'name':name,'passed':False,'error':str(e)});print('FAIL',name,str(e),traceback.format_exc(),flush=True)
                page.screenshot(path=str(args.output/(f'failure-{len(results)}.png')),full_page=False)
        def ready():
            duration=page.evaluate('createPlayer()');assert duration>5
        case('generated MP4 loads in Chromium and opening never generates a transcript',lambda:(ready(),assertion(page.evaluate('generated===0'))))
        def dual():
            page.evaluate('captions()');page.get_by_role('button',name='Theater mode',exact=True).click()
            assert page.locator('.caption-line').count()==2
            assert '<img' in page.locator('.caption-line').first.inner_text()
            assert page.locator('.caption-overlay img').count()==0
        case('dual theater captions are stacked, timed and rendered as inert text',dual)
        def fullscreen():
            page.get_by_role('button',name='Full screen',exact=True).click()
            page.wait_for_function('document.fullscreenElement === player.root')
            assert page.evaluate('document.fullscreenElement.contains(document.querySelector(".caption-overlay"))')
            assert page.locator('.caption-line').count()==2
            page.locator('.caption-overlay').wait_for(state='visible')
            page.get_by_role('button',name='Exit full screen',exact=True).click()
            page.wait_for_function('document.fullscreenElement === null')
            page.get_by_role('button',name='Full screen',exact=True).wait_for(state='visible')
        case('full screen owns the player and both caption lines and exposes an explicit exit control',fullscreen)
        def offon():
            page.get_by_role('button',name='Exit theater',exact=True).click()
            page.evaluate("select('Primary captions','');select('Secondary captions','')")
            assert 'No transcript selected' in page.locator('.transcript-rows').inner_text()
            page.evaluate("select('Primary captions',trackId)")
            assert page.locator('.transcript-cue').count()==2
        case('turning captions off and back on restores the transcript',offon)
        def pagination():
            page.evaluate("player.setTracks([track(trackId,'ja',Array.from({length:125},(_,i)=>({id:'c'+i,start:i,end:i+.9,text:'Line '+i}))),track(trackId2,'en',[{id:'short',start:0,end:2,text:'Short track'}])]);select('Primary captions',trackId)")
            page.get_by_role('button',name='Later captions',exact=True).click();assert page.locator('.transcript-cue').count()==60
            page.evaluate("select('Primary captions',trackId2)");assert page.locator('.transcript-cue').count()==1
        case('switching from a later transcript page to a short track does not show an empty page',pagination)
        def style():
            page.evaluate('createPlayer({delayedStyle:true})')
            page.locator('summary',has_text='Caption settings').click()
            page.get_by_label('Text size',exact=True).select_option('1.5')
            page.evaluate("resolveStyle({size:.75,color:'white',background:.5,edge:'shadow'})")
            page.wait_for_timeout(30)
            assert page.locator('.caption-overlay').evaluate("e=>e.style.getPropertyValue('--caption-scale')")=='1.5'
        case('a late style restore cannot undo the user’s new text-size choice',style)
        def device_resume():
            page.evaluate("createPlayer({device:{version:1,position:4,duration:30,rate:1,finished:false,updatedAt:20}})")
            page.evaluate("player.bindDeviceCheckpoint('sampled-v1:'+'a'.repeat(64))")
            page.wait_for_function('Math.abs(player.video.currentTime-4)<.05')
            page.evaluate('player.video.currentTime=6');page.wait_for_function('Math.abs(player.video.currentTime-6)<.05')
            page.evaluate('player.dispose()')
            assert page.evaluate("locals.some(r=>r.kind==='device-playback'&&Math.abs(r.value.position-6)<.05)")
            assert page.evaluate('writes.length')==0
        case('playback resumes and closes durably before a portable hash exists',device_resume)
        def seek_before():
            page.evaluate("createPlayer({device:{version:1,position:3,duration:30,rate:1,finished:false,updatedAt:20}})")
            page.evaluate('player.video.currentTime=7');page.wait_for_timeout(50)
            page.evaluate("player.bindDeviceCheckpoint('sampled-v1:'+'a'.repeat(64))")
            assert abs(page.evaluate('player.video.currentTime')-7)<.05
        case('late device restore cannot jump over an explicit seek',seek_before)
        def canonical_newer():
            page.evaluate("createPlayer({device:{version:1,position:3,duration:30,rate:1,finished:false,updatedAt:10},remote:playback(6,20)})")
            page.evaluate("player.bindDeviceCheckpoint('sampled-v1:'+'a'.repeat(64))")
            page.wait_for_timeout(60)
            page.evaluate('player.bindIdentity(mediaKey)')
            page.wait_for_function('Math.abs(player.video.currentTime-6)<.05')
            assert page.evaluate('locals.length')==0
        case('passive local resume does not become a fresh edit that defeats newer account progress',canonical_newer)
        def remote_race():
            page.evaluate('createPlayer({remote:playback(2),delayedRemote:true})')
            page.evaluate('window.binding=player.bindIdentity(mediaKey);void 0')
            page.evaluate('player.video.currentTime=8');page.wait_for_timeout(50)
            page.evaluate('resolveRemote();binding')
            assert abs(page.evaluate('player.video.currentTime')-8)<.05
            page.evaluate('player.dispose()');assert page.evaluate('writes.at(-1).position')==8
        case('late account progress restore preserves a seek made during loading',remote_race)
        def screenshot(width,height,name):
            page.set_viewport_size({'width':width,'height':height});page.evaluate('createPlayer()');page.evaluate("""() => {
                document.querySelector('.video-player-title h2').textContent='A conversation at the bookshop';
                player.setTracks([track(trackId,'ja',[
                    {id:'ja1',start:0,end:3,text:'こんにちは。何かお探しですか。',speaker:'w0/S01'},
                    {id:'ja2',start:3,end:6,text:'はい。日本語の小説を探しています。',speaker:'w0/S02'},
                    {id:'ja3',start:7,end:10,text:'こちらの本はいかがですか。',speaker:'w0/S01'},
                    {id:'ja4',start:10,end:13,text:'おもしろそうですね。',speaker:'w0/S02'}]),
                    track(trackId2,'en',[
                    {id:'en1',start:0,end:3,text:'Hello. Are you looking for something?'},
                    {id:'en2',start:3,end:6,text:'Yes, I’m looking for a Japanese novel.'},
                    {id:'en3',start:7,end:10,text:'How about this book?'},
                    {id:'en4',start:10,end:13,text:'That looks interesting.'}])]);
                select('Secondary captions',trackId2);
            }""")
            page.wait_for_function('player.video.readyState >= 2')
            page.evaluate('player.video.currentTime=1')
            page.wait_for_function('!player.video.seeking')
            # Decode actual frames, not only metadata, before visual inspection.
            page.evaluate('player.video.muted=true;player.video.play()')
            page.wait_for_function('player.video.currentTime>1.15')
            page.evaluate('player.video.pause()')
            page.wait_for_timeout(600)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            assert page.locator('.transcript-pane').bounding_box()['height']>=150
            page.screenshot(path=str(args.output/name),full_page=False)
        case('desktop caption layout has no horizontal overflow',lambda:screenshot(1280,900,'player-desktop.png'))
        case('phone caption layout has no horizontal overflow',lambda:screenshot(390,844,'player-phone.png'))
        def preserve_position():
            page.evaluate('player.video.currentTime=5');page.wait_for_timeout(50)
            page.get_by_role('button',name='Theater mode',exact=True).click()
            page.evaluate("select('Secondary captions','')")
            assert abs(page.evaluate('player.video.currentTime')-5)<.05
            assert page.evaluate('errors.length')==0
        case('theater and track controls never reset playback position',preserve_position)
        page.evaluate('player.dispose()')
        page.evaluate('async url=>{window.chooseCloudVideo=(await import(url)).chooseCloudVideo}', module('cloud-browser.js'))
        def cloud_listing():
            page.evaluate("""() => {
                window.closedPicker=false; window.cloudRequests=[];
                window.cloudTransport={userId:'u',isCurrent:()=>true,async request(path){
                    cloudRequests.push(path);
                    return path==='connections/' ? {items:[{id:'a0000000-0000-4000-8000-000000000001',provider:'dropbox',roots:['selected'],needs_reconnect:false}]} : {items:[{id:'video1',name:'Example.mp4',kind:'file',size:100}],cursor:''};
                }};
                window.picker=chooseCloudVideo(cloudTransport,async()=>{}).then(()=>closedPicker=true);
            }""")
            dialog=page.get_by_role('dialog',name='Cloud videos')
            dialog.get_by_role('button',name='dropbox · selected',exact=True).click()
            dialog.get_by_role('button',name='Example.mp4',exact=True).wait_for()
            dialog.get_by_role('button',name='Close',exact=True).click()
            page.wait_for_function('closedPicker')
            assert page.evaluate("cloudRequests[0] === 'connections/' && cloudRequests[1].includes('/media-files/?')")
        case('cloud picker renders the real backend envelope through production DOM code',cloud_listing)
        def cloud_cancel():
            page.evaluate("""() => {
                window.cloudLifetime=new AbortController();window.closedPicker=false;
                window.picker=chooseCloudVideo({userId:'u',isCurrent:()=>true,request(){return new Promise(resolve=>window.lateConnections=resolve)}},async()=>{throw Error('must not open')},cloudLifetime.signal).then(()=>closedPicker=true);
            }""")
            page.get_by_role('dialog',name='Cloud videos').wait_for()
            page.evaluate('cloudLifetime.abort()');page.wait_for_function('closedPicker')
            page.evaluate('lateConnections({items:[]})');page.wait_for_timeout(20)
            assert page.get_by_role('dialog',name='Cloud videos').count()==0
        case('account/workspace cancellation closes cloud picker and discards late data',cloud_cancel)
        def pending_caption_selection():
            page.evaluate('createPlayer({remote:playback(1,20)})')
            page.evaluate('player.bindIdentity(mediaKey)')
            assert page.get_by_label('Primary captions',exact=True).input_value()==page.evaluate('trackId')
            assert page.get_by_label('Secondary captions',exact=True).input_value()==page.evaluate('trackId2')
            assert 'not available yet' in page.get_by_label('Primary captions',exact=True).inner_text()
            page.evaluate('player.video.currentTime=3')
            page.wait_for_function('writes.length>0')
            assert page.evaluate('writes.at(-1).primary===trackId && writes.at(-1).secondary===trackId2')
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'one',start:0,end:10,text:'今日は晴れです。'}])])")
            assert page.get_by_label('Primary captions',exact=True).input_value()==page.evaluate('trackId')
            assert page.get_by_label('Secondary captions',exact=True).input_value()==page.evaluate('trackId2')
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'one',start:0,end:10,text:'今日は晴れです。'}]),track(trackId2,'en',[{id:'two',start:0,end:10,text:'It is sunny.'}])])")
            assert 'not available yet' not in page.get_by_label('Secondary captions',exact=True).inner_text()
            assert 'It is sunny.' in page.locator('.transcript-rows').inner_text()
        case('saved dual-caption choices survive autosave while subtitle pages arrive independently',pending_caption_selection)
        def pending_off():
            page.evaluate('createPlayer({remote:playback(1,20)})');page.evaluate('player.bindIdentity(mediaKey)')
            page.evaluate("select('Primary captions','');select('Secondary captions','')")
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'one',start:0,end:10,text:'今日は晴れです。'}])])")
            assert page.get_by_label('Primary captions',exact=True).input_value()==''
            assert page.get_by_label('Secondary captions',exact=True).input_value()==''
            assert page.evaluate('writes.at(-1).primary===null && writes.at(-1).secondary===null')
        case('turning waiting captions off remains an explicit choice after their tracks arrive',pending_off)
        def vanished_caption():
            ready();page.evaluate('captions()')
            page.evaluate('player.setTracks([])')
            assert page.get_by_label('Primary captions',exact=True).input_value()==page.evaluate('trackId')
            assert page.get_by_label('Secondary captions',exact=True).input_value()==page.evaluate('trackId2')
            page.evaluate('captions()')
            assert page.get_by_label('Primary captions',exact=True).input_value()==page.evaluate('trackId')
        case('temporary track unavailability does not discard an explicit caption choice',vanished_caption)
        def invalid_offset():
            ready();page.evaluate('captions()');page.locator('summary',has_text='Caption settings').click()
            offset=page.get_by_label('Primary offset (seconds)',exact=True)
            offset.fill('2.5');offset.dispatch_event('change')
            offset.fill('4000');offset.dispatch_event('change')
            assert offset.input_value()=='2.5'
            assert page.evaluate('player.delays[trackId]')==2.5
        case('invalid caption offset restores the actual saved value rather than displaying a false zero',invalid_offset)
        def export_secondary():
            ready();page.evaluate('captions()');page.evaluate("select('Primary captions','')")
            page.get_by_role('button',name='Export subtitles',exact=True).click()
            assert page.evaluate('exported.length===1 && exported[0]===trackId2')
        case('subtitle export works when only the translated second track is selected',export_secondary)
        def unavailable_export():
            page.evaluate('createPlayer({remote:playback(1,20)})');page.evaluate('player.bindIdentity(mediaKey)')
            assert page.get_by_role('button',name='Export subtitles',exact=True).is_disabled()
            page.evaluate('captions()');assert page.get_by_role('button',name='Export subtitles',exact=True).is_enabled()
            page.evaluate("select('Primary captions','');select('Secondary captions','')")
            assert page.get_by_role('button',name='Export subtitles',exact=True).is_disabled()
        case('subtitle export is disabled for Off or tracks whose pages have not arrived',unavailable_export)
        def diarized_overlay():
            ready();page.evaluate("""() => {
                player.setTracks([track(trackId,'ja',[
                    {id:'a',start:0,end:3,text:'こんにちは。',speaker:'w0/S01'},
                    {id:'b',start:0,end:3,text:'どうも。',speaker:'w0/S02'}]),
                    track(trackId2,'en',[{id:'e',start:0,end:3,text:'Hello. Nice to see you.'}])]);
                select('Secondary captions',trackId2);
            }""")
            page.get_by_role('button',name='Theater mode',exact=True).click()
            assert page.locator('.caption-line').first.inner_text()=='-こんにちは。\n-どうも。'
            assert page.locator('.caption-line').nth(1).inner_text()=='Hello. Nice to see you.'
            assert page.locator('.transcript-speaker').all_text_contents()==['Speaker 1 · window 1','Speaker 2 · window 1']
        case('diarized voices get distinct dialogue lines while the translation stays one independent track',diarized_overlay)
        def translation_reveal():
            page.get_by_role('button',name='Hide translation',exact=True).click()
            assert page.locator('.caption-line').count()==1
            assert page.locator('.transcript-cue .transcript-translation').count()==0
            assert page.evaluate('player.video.currentTime')<.01
            page.get_by_role('button',name='Reveal translation',exact=True).click()
            assert page.locator('.caption-line').count()==2
            assert page.locator('.transcript-cue .transcript-translation').count()==2
            page.get_by_role('button',name='Hide translation',exact=True).click()
            page.evaluate("select('Primary captions','')")
            assert page.locator('.caption-line').count()==1
            assert page.locator('.caption-line').first.inner_text()=='Hello. Nice to see you.'
            assert page.get_by_role('button',name='Reveal translation',exact=True).is_disabled()
        case('translation reveal hides both study surfaces without hiding a secondary-only transcript',translation_reveal)
        def navigation():
            ready();page.evaluate("""() => {player.video.muted=true;
                player.setTracks([track(trackId,'ja',[
                {id:'a',start:1,end:2,text:'First'},
                {id:'b',start:3,end:4,text:'Second'},
                {id:'c',start:5,end:6,text:'Third'}])]);}
            """)
            page.get_by_role('button',name='Next line',exact=True).click()
            page.wait_for_function('player.video.currentTime>=1 && !player.video.seeking')
            page.evaluate('player.video.pause()');assert page.evaluate('player.video.currentTime')<1.7
            page.get_by_role('button',name='Next line',exact=True).click()
            page.wait_for_function('player.video.currentTime>=3 && !player.video.seeking')
            page.evaluate('player.video.pause()');assert page.evaluate('player.video.currentTime')<3.7
            page.get_by_role('button',name='Replay line',exact=True).click()
            page.wait_for_function('!player.video.paused && !player.video.seeking')
            page.evaluate('player.video.pause()');assert 3<=page.evaluate('player.video.currentTime')<3.7
            page.get_by_role('button',name='Previous line',exact=True).click()
            page.wait_for_function('!player.video.seeking && player.video.currentTime<2')
            page.evaluate('player.video.pause()')
        case('line controls seek and replay real media instead of paging the transcript',navigation)
        def pause_line():
            ready();page.evaluate("""() => {player.video.muted=true;
                player.setTracks([track(trackId,'ja',[
                  {id:'a',start:0,end:.35,text:'First voice',speaker:'w0/S01'},
                  {id:'b',start:.15,end:.8,text:'Second voice',speaker:'w0/S02'},
                  {id:'c',start:1.5,end:2,text:'Next line',speaker:'w0/S01'}])]);}
            """)
            assert not page.get_by_label('Pause after each line',exact=True).is_checked()
            page.get_by_label('Pause after each line',exact=True).check()
            page.evaluate('player.video.play()')
            page.wait_for_function('player.video.currentTime>=.8 && player.video.paused')
            assert page.evaluate('player.video.currentTime')<1.4
            assert page.evaluate('player.linePause.held.cues.length')==2
            page.evaluate('player.video.play()')
            page.wait_for_function('player.video.currentTime>=2 && player.video.paused')
            assert page.evaluate('player.video.currentTime')<2.6
            assert page.evaluate('player.linePause.held.cues[0].id')=='c'
        case('pause-after-line waits for overlapping speakers and resumes without immediately pausing again',pause_line)
        def seeking_pause():
            page.evaluate('player.video.currentTime=1.6')
            page.wait_for_function('!player.video.seeking')
            page.evaluate('player.video.play()')
            page.wait_for_function('player.video.currentTime>=2 && player.video.paused')
            assert page.evaluate('player.linePause.held.cues[0].id')=='c'
        case('a seek resets automatic pause ownership to the new line',seeking_pause)
        def shortcut_scope():
            navigation()
            page.evaluate("player.root.focus(); player.video.currentTime=3.3")
            page.wait_for_function('!player.video.seeking')
            page.keyboard.press('s')
            page.wait_for_function('!player.video.paused && !player.video.seeking')
            page.evaluate('player.video.pause()');assert 3<=page.evaluate('player.video.currentTime')<3.3
            prevented=page.evaluate("""() => {let result=[];
              for(const target of [player.primary,player.video,document.body]){
                const event=new KeyboardEvent('keydown',{key:'d',bubbles:true,cancelable:true});
                target.dispatchEvent(event);result.push(event.defaultPrevented);
              }
              for(const extra of [{repeat:true},{isComposing:true},{ctrlKey:true},{shiftKey:true}]){
                const event=new KeyboardEvent('keydown',{key:'d',bubbles:true,cancelable:true,...extra});
                player.root.dispatchEvent(event);result.push(event.defaultPrevented);
              }return result;}""")
            assert prevented==[False]*7
        case('learning shortcuts are scoped to the player and never hijack forms, native media or composition',shortcut_scope)
        def secondary_delay():
            page.evaluate("createPlayer({remote:{...playback(0,20),delays:{[trackId]:10,[trackId2]:2}}})")
            page.evaluate('player.bindIdentity(mediaKey)')
            page.evaluate("player.setTracks([track(trackId2,'en',[{id:'e',start:1,end:3,text:'Only available track'}])])")
            assert page.locator('.transcript-cue').first.locator('time').inner_text()=='0:03'
            page.get_by_role('button',name='Replay line',exact=True).click()
            page.wait_for_function('!player.video.seeking && player.video.currentTime>=3')
            page.evaluate('player.video.pause()');assert page.evaluate('player.video.currentTime')<3.7
        case('a pending primary track cannot lend its offset to the available second transcript',secondary_delay)
        def empty_offset():
            ready();page.evaluate('captions()');page.locator('summary',has_text='Caption settings').click()
            offset=page.get_by_label('Primary offset (seconds)',exact=True)
            offset.fill('2.5');offset.dispatch_event('change')
            offset.fill('');offset.dispatch_event('change')
            assert offset.input_value()=='2.5'
            assert page.evaluate('player.delays[trackId]')==2.5
        case('clearing an offset field does not silently overwrite its saved value with zero',empty_offset)
        def small_landscape():
            screenshot(667,375,'player-landscape.png')
            page.evaluate("document.querySelector('#root').style.fontSize='150%'")
            page.wait_for_timeout(60)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            for name in ['Replay line','Theater mode','Full screen']:
                assert page.get_by_role('button',name=name,exact=True).bounding_box()['height']>=44
            page.evaluate("document.querySelector('#root').style.fontSize=''")
        case('short landscape and larger text retain controls without horizontal overflow',small_landscape)
        def dark_layout():
            page.evaluate("document.documentElement.style.cssText='--background:#151719;--foreground:#f4f4f4;--muted:#25292c;--muted-foreground:#b3b7bc;--border:#43484d;--card:#1c2024;--primary:#8ab4f8;--primary-foreground:#10151d'")
            screenshot(1280,900,'player-dark.png')
            page.evaluate("document.documentElement.style.cssText=''")
        case('dark appearance inherits Reader tokens without unreadable transcript controls',dark_layout)
        case('final desktop learning layout',lambda:screenshot(1280,900,'player-desktop.png'))
        case('final phone learning layout',lambda:screenshot(390,844,'player-phone.png'))
        def csp_policy(allow_wasm):
            csp_page=browser.new_page()
            policy="script-src 'nonce-media-test'" + (" 'wasm-unsafe-eval'" if allow_wasm else "")
            # The code under test is a nonce-authorized ordinary page script, not
            # DevTools evaluation (which would not prove the policy's eval checks).
            csp_page.set_content('<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'"><script nonce="media-test">'+"""
                (async()=>{const result={wasm:false,eval:false};
                try {await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));result.wasm=true;}catch{}
                try {Function('return 1')();result.eval=true;}catch{}
                window.policyResult=result;})();
            """+'</script>')
            csp_page.wait_for_function('window.policyResult')
            result=csp_page.evaluate('policyResult');csp_page.close()
            assert result=={'wasm':allow_wasm,'eval':False}
        case('CSP permits minimal WASM while blocking JavaScript eval',lambda:csp_policy(True))
        case('CSP without the WASM permission rejects minimal WASM',lambda:csp_policy(False))
        browser.close()
    report={'environment':'Chromium / in-memory production modules / generated MP4 / persistence double',
            'notCovered':['Svelte application','IndexedDB','secure-context worker loading','live cloud providers (picker uses a transport double)','MOSS inference'],
            'tests':results,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results)}
    (args.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if report['failed']:raise SystemExit(1)

def assertion(value):
    assert value
if __name__=='__main__': main()
