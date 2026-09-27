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
        page.set_content('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:var(--background,#f5f8f8)}'+(build/'media.css').read_text()+'</style><main class="manabi-media" id="root"></main>')
        page.evaluate('''async ({playerURL,sourceURL,downloadURL,fixture}) => {
            const {VideoPlayer}=await import(playerURL), {localSource}=await import(sourceURL);
            window.downloadSubtitles=(await import(downloadURL)).downloadSubtitles;
            const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0));
            window.mediaKey='content:'+'a'.repeat(64);
            window.trackId='11111111-1111-4111-8111-111111111111';
            window.trackId2='22222222-2222-4222-8222-222222222222';
            window.track=(id,language,cues)=>({version:1,id,mediaKey,label:language+' · Original captions',language,
                kind:language==='ja'?'transcription':'translation',origin:'sidecar',complete:true,forced:false,createdAt:1,cues});
            window.playback=(position,updatedAt=10)=>({version:1,mediaKey,position,duration:30,rate:1,finished:false,updatedAt,primary:trackId,secondary:trackId2,delays:{}});
            window.createPlayer=async (config={})=>{
                if(window.player)await window.player.dispose();
                window.errors=[];window.writes=[];window.locals=[];window.generated=0;window.exported=[];window.appearances=0;window.imports=0;
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
                    onError:m=>errors.push(m),preferredLanguages:['en-US'],onGenerate:()=>{generated++;return config.delayedGenerate?new Promise(resolve=>window.resolveGenerate=resolve):undefined;},onAppearance:trigger=>{appearances++;window.appearanceTrigger=trigger;},onImport:()=>imports++,onExport:track=>{exported.push(track.id);if(config.download)downloadSubtitles('fixture.mp4',track);}});
                document.querySelector('#root').replaceChildren(player.root);
                await new Promise((resolve,reject)=>{if(player.video.readyState>=1)return resolve();player.video.addEventListener('loadedmetadata',resolve,{once:true});player.video.addEventListener('error',()=>reject(Error('fixture video codec failed')),{once:true});});
                return player.video.duration;
            };
            window.select=(label,value)=>{const e=document.querySelector('[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
            window.captions=()=>{
                player.setTracks([track(trackId,'ja',[{id:'ja1',start:0,end:6,text:'こんにちは。<img src=x onerror=alert(1)>'},{id:'ja2',start:7,end:12,text:'今日は本を読みます。'}]),
                    track(trackId2,'en',[{id:'en1',start:0,end:8,text:'Hello. Today we are reading.'},{id:'en2',start:8,end:12,text:'Enjoy the story.'}])]);
                select('Transcript track',trackId);select('Translation track',trackId2);
            };
        }''', {'playerURL':module('player.js'),'sourceURL':module('sources.js'),'downloadURL':module('subtitle-download.js'),'fixture':fixture})
        def case(name, fn):
            try:
                print('RUN',name,flush=True)
                fn();results.append({'name':name,'passed':True});print('PASS',name,flush=True)
            except Exception as e:
                results.append({'name':name,'passed':False,'error':str(e)});print('FAIL',name,str(e),traceback.format_exc(),flush=True)
                page.screenshot(path=str(args.output/(f'failure-{len(results)}.png')),full_page=False)
        def menu():
            if not page.locator('.transcript-options').evaluate("e=>e.matches(':popover-open') || (!e.hasAttribute('popover')&&!e.hidden)"):
                page.get_by_role('button',name='Transcript options',exact=True).click()
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
            assert page.get_by_role('button',name='Full screen',exact=True).count()==0
            assert page.evaluate('player.video.controls && !player.video.controlsList.contains("nofullscreen")')
            assert page.get_by_role('button',name='Theater mode',exact=True).get_attribute('aria-pressed')=='true'
        case('native fullscreen remains available without a duplicate custom fullscreen control',fullscreen)
        def offon():
            page.get_by_role('button',name='Theater mode',exact=True).click()
            page.evaluate("select('Transcript track','');select('Translation track','')")
            assert page.locator('.transcript-setup').is_visible()
            page.evaluate("select('Transcript track',trackId)")
            assert page.locator('.transcript-cue').count()==2
        case('turning captions off and back on restores the transcript',offon)
        def pagination():
            page.evaluate("player.setTracks([track(trackId,'ja',Array.from({length:400},(_,i)=>({id:'c'+i,start:i,end:i+.9,text:'Line '+i}))),track(trackId2,'en',[{id:'short',start:0,end:2,text:'Short track'}])]);select('Transcript track',trackId)")
            menu();page.get_by_label('Follow playback',exact=True).uncheck();page.keyboard.press('Escape')
            page.locator('.transcript-rows').evaluate('e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event("scroll"));}')
            page.wait_for_function('player.renderedStart>0')
            assert page.locator('.transcript-cue').count()<=180
            page.evaluate("select('Transcript track',trackId2)");assert page.locator('.transcript-cue').count()==1
            assert page.get_by_role('button',name='Later captions',exact=True).count()==0
        case('continuous transcript scrolling stays bounded and switching to a short track restores its beginning',pagination)
        def style():
            page.evaluate('createPlayer({delayedStyle:true})')
            menu();page.locator('summary',has_text='Video caption style & timing').click()
            page.get_by_label('Video text size',exact=True).select_option('1.5')
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
                document.querySelector('.video-player-heading h2').textContent='A conversation at the bookshop';
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
                select('Transcript track',trackId);select('Translation track',trackId2);
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
            page.locator('.video-player-heading').click()
            page.screenshot(path=str(args.output/name),full_page=False)
        case('desktop caption layout has no horizontal overflow',lambda:screenshot(1280,900,'player-desktop.png'))
        case('phone caption layout has no horizontal overflow',lambda:screenshot(390,844,'player-phone.png'))
        def preserve_position():
            page.evaluate('player.video.currentTime=5');page.wait_for_timeout(50)
            page.get_by_role('button',name='Theater mode',exact=True).click()
            page.evaluate("select('Translation track','')")
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
            assert page.get_by_label('Transcript track',exact=True).input_value()==page.evaluate('trackId')
            assert page.get_by_label('Translation track',exact=True).input_value()==page.evaluate('trackId2')
            assert 'not available yet' in page.get_by_label('Transcript track',exact=True).inner_text()
            page.evaluate('player.video.currentTime=3')
            page.wait_for_function('writes.length>0')
            assert page.evaluate('writes.at(-1).primary===trackId && writes.at(-1).secondary===trackId2')
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'one',start:0,end:10,text:'今日は晴れです。'}])])")
            assert page.get_by_label('Transcript track',exact=True).input_value()==page.evaluate('trackId')
            assert page.get_by_label('Translation track',exact=True).input_value()==page.evaluate('trackId2')
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'one',start:0,end:10,text:'今日は晴れです。'}]),track(trackId2,'en',[{id:'two',start:0,end:10,text:'It is sunny.'}])])")
            assert 'not available yet' not in page.get_by_label('Translation track',exact=True).inner_text()
            assert 'It is sunny.' in page.locator('.transcript-rows').inner_text()
        case('saved dual-caption choices survive autosave while subtitle pages arrive independently',pending_caption_selection)
        def pending_off():
            page.evaluate('createPlayer({remote:playback(1,20)})');page.evaluate('player.bindIdentity(mediaKey)')
            page.evaluate("select('Transcript track','');select('Translation track','')")
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'one',start:0,end:10,text:'今日は晴れです。'}])])")
            assert page.get_by_label('Transcript track',exact=True).input_value()==''
            assert page.get_by_label('Translation track',exact=True).input_value()==''
            assert page.evaluate('writes.at(-1).primary===null && writes.at(-1).secondary===null')
        case('turning waiting captions off remains an explicit choice after their tracks arrive',pending_off)
        def vanished_caption():
            ready();page.evaluate('captions()')
            page.evaluate('player.setTracks([])')
            assert page.get_by_label('Transcript track',exact=True).input_value()==page.evaluate('trackId')
            assert page.get_by_label('Translation track',exact=True).input_value()==page.evaluate('trackId2')
            page.evaluate('captions()')
            assert page.get_by_label('Transcript track',exact=True).input_value()==page.evaluate('trackId')
        case('temporary track unavailability does not discard an explicit caption choice',vanished_caption)
        def invalid_offset():
            ready();page.evaluate('captions()');menu();page.locator('summary',has_text='Video caption style & timing').click()
            offset=page.get_by_label('Primary offset (seconds)',exact=True)
            offset.fill('2.5');offset.dispatch_event('change')
            offset.fill('4000');offset.dispatch_event('change')
            assert offset.input_value()=='2.5'
            assert page.evaluate('player.delays[trackId]')==2.5
        case('invalid caption offset restores the actual saved value rather than displaying a false zero',invalid_offset)
        def export_secondary():
            ready();page.evaluate('captions()');page.evaluate("select('Transcript track','');select('Translation track',trackId2)")
            menu();page.get_by_role('button',name='Download subtitles',exact=True).click()
            assert page.evaluate('exported.length===1 && exported[0]===trackId2')
        case('subtitle export works when only the translated second track is selected',export_secondary)
        def unavailable_export():
            page.evaluate('createPlayer({remote:playback(1,20)})');page.evaluate('player.bindIdentity(mediaKey)')
            menu();assert page.get_by_role('button',name='Download subtitles',exact=True).is_disabled()
            page.evaluate('captions()');menu();assert page.get_by_role('button',name='Download subtitles',exact=True).is_enabled()
            page.evaluate("select('Transcript track','');select('Translation track','')")
            menu();assert page.get_by_role('button',name='Download subtitles',exact=True).is_disabled()
        case('subtitle export is disabled for Off or tracks whose pages have not arrived',unavailable_export)
        def diarized_overlay():
            ready();page.evaluate("""() => {
                player.setTracks([track(trackId,'ja',[
                    {id:'a',start:0,end:3,text:'こんにちは。',speaker:'w0/S01'},
                    {id:'b',start:0,end:3,text:'どうも。',speaker:'w0/S02'}]),
                    track(trackId2,'en',[{id:'e',start:0,end:3,text:'Hello. Nice to see you.'}])]);
                select('Transcript track',trackId);select('Translation track',trackId2);
            }""")
            page.get_by_role('button',name='Theater mode',exact=True).click()
            assert page.locator('.caption-line').first.inner_text()=='-こんにちは。\n-どうも。'
            assert page.locator('.caption-line').nth(1).inner_text()=='Hello. Nice to see you.'
            assert page.locator('.transcript-speaker').count()==0
            assert 'Speaker' not in page.locator('.transcript-rows').inner_text()
            assert page.locator('.transcript-cue').all_text_contents()==['こんにちは。Hello. Nice to see you.','どうも。Hello. Nice to see you.']
        case('diarized voices get distinct dialogue lines while the translation stays one independent track',diarized_overlay)
        def translation_reveal():
            menu();page.get_by_role('button',name='Hide translation',exact=True).click()
            assert page.locator('.caption-line').count()==1
            assert page.locator('.transcript-cue .transcript-translation').count()==0
            assert page.evaluate('player.video.currentTime')<.01
            menu();page.get_by_role('button',name='Show translation',exact=True).click()
            assert page.locator('.caption-line').count()==2
            assert page.locator('.transcript-cue .transcript-translation').count()==2
            menu();page.get_by_role('button',name='Hide translation',exact=True).click()
            page.evaluate("select('Transcript track','');select('Translation track',trackId2)")
            assert page.locator('.caption-line').count()==1
            assert page.locator('.caption-line').first.inner_text()=='Hello. Nice to see you.'
            menu();assert page.get_by_role('button',name='Show translation',exact=True).is_disabled()
        case('translation reveal hides both study surfaces without hiding a secondary-only transcript',translation_reveal)
        def navigation():
            ready();page.evaluate("""() => {player.video.muted=true;
                player.setTracks([track(trackId,'ja',[
                {id:'a',start:1,end:2,text:'First'},
                {id:'b',start:3,end:4,text:'Second'},
                {id:'c',start:5,end:6,text:'Third'}])]);select('Transcript track',trackId);}
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
                  {id:'c',start:1.5,end:2,text:'Next line',speaker:'w0/S01'}])]);select('Transcript track',trackId);}
            """)
            assert not page.get_by_label('Pause after each line',exact=True).is_checked()
            menu();page.get_by_label('Pause after each line',exact=True).check();page.keyboard.press('Escape')
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
            assert page.locator('.transcript-cue').first.inner_text()=='Only available track'
            assert page.locator('.transcript-cue time').count()==0
            page.get_by_role('button',name='Replay line',exact=True).click()
            page.wait_for_function('!player.video.seeking && player.video.currentTime>=3')
            page.evaluate('player.video.pause()');assert page.evaluate('player.video.currentTime')<3.7
        case('a pending primary track cannot lend its offset to the available second transcript',secondary_delay)
        def empty_offset():
            ready();page.evaluate('captions()');menu();page.locator('summary',has_text='Video caption style & timing').click()
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
            for name in ['Replay line','Theater mode']:
                assert page.get_by_role('button',name=name,exact=True).bounding_box()['height']>=44
            page.evaluate("document.querySelector('#root').style.fontSize=''")
        case('short landscape and larger text retain controls without horizontal overflow',small_landscape)
        def dark_layout():
            page.evaluate("document.documentElement.style.cssText='--background:#151719;--foreground:#f4f4f4;--muted:#25292c;--muted-foreground:#b3b7bc;--border:#43484d;--card:#1c2024;--primary:#8ab4f8;--primary-foreground:#10151d'")
            screenshot(1280,900,'player-dark.png')
            assert page.evaluate('''() => {
                const row=document.querySelector('.transcript-cue.active');
                const color=getComputedStyle(row).color, background=getComputedStyle(document.querySelector('.transcript-pane')).backgroundColor;
                if(getComputedStyle(row).borderLeftWidth!=='0px'||getComputedStyle(row).boxShadow!=='none')return false;
                const luminance=text=>{
                    const values=text.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{
                        v/=255; return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
                    });
                    return values[0]*.2126+values[1]*.7152+values[2]*.0722;
                };
                const a=luminance(color),b=luminance(background);
                return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;
            }''')
            page.evaluate("document.documentElement.style.cssText=''")
        case('dark appearance inherits Reader tokens without unreadable transcript controls',dark_layout)
        case('final desktop learning layout',lambda:screenshot(1280,900,'player-desktop.png'))
        case('final phone learning layout',lambda:screenshot(390,844,'player-phone.png'))
        def setup_selection():
            ready();page.evaluate("player.setDiscovery('complete');player.setGenerationAvailable(true);player.setTracks([track(trackId,'ja',[{id:'a',start:0,end:3,text:'こんにちは。'}]),track(trackId2,'en',[{id:'b',start:0,end:3,text:'Hello.'}])])")
            assert page.locator('.transcript-setup').is_visible()
            assert page.evaluate("player.primary.value===''&&player.secondary.value===''&&generated===0")
            page.get_by_label('Choose existing subtitles',exact=True).select_option(page.evaluate('trackId'))
            assert not page.locator('.transcript-setup').is_visible()
            assert page.evaluate('player.primary.value===trackId&&player.secondary.value===trackId2')
            assert page.get_by_role('button',name='Generate transcript',exact=True).count()==0
        case('first open asks for a main transcript and only then suggests a system-language translation',setup_selection)
        def translation_off_sticks():
            page.evaluate("select('Translation track','');player.setTracks([...player.tracks,track('33333333-3333-4333-8333-333333333333','fr',[{id:'f',start:0,end:2,text:'Bonjour'}])])")
            assert page.evaluate("player.secondary.value==='' ")
        case('manual translation Off survives new track discovery',translation_off_sticks)
        def close_transcript():
            setup_selection();page.evaluate('player.video.currentTime=1');page.wait_for_function('!player.video.seeking')
            before=page.locator('.video-stage').bounding_box()['width']
            menu();page.get_by_role('button',name='Close transcript',exact=True).click()
            assert page.locator('.transcript-pane').is_hidden()
            assert page.locator('.video-stage').bounding_box()['width']>=before
            show=page.get_by_role('button',name='Show transcript',exact=True)
            theater=page.get_by_role('button',name='Theater mode',exact=True)
            assert show.bounding_box()['x']<theater.bounding_box()['x']
            assert page.locator('.caption-overlay').is_visible()
            show.click();assert page.locator('.transcript-pane').is_visible()
            assert abs(page.evaluate('player.video.currentTime')-1)<.05
            assert page.evaluate('player.primary.value===trackId&&player.secondary.value===trackId2')
        case('closing and reopening the transcript preserves time and tracks and exposes its icon beside theater',close_transcript)
        def menu_focus():
            ready();menu();page.keyboard.press('Escape')
            assert page.get_by_role('button',name='Transcript options',exact=True).evaluate('e=>e===document.activeElement')
            menu();page.get_by_role('button',name='Themes & Settings',exact=True).click()
            assert page.evaluate('appearances===1&&appearanceTrigger===player.menu.trigger')
            assert page.locator('.transcript-options').is_hidden()
            menu();page.get_by_role('button',name='Add subtitles',exact=True).click();assert page.evaluate('imports')==1
            menu();page.locator('.video-player-heading').click();assert page.locator('.transcript-options').is_hidden()
        case('ellipsis has light dismissal, keyboard focus and the shared appearance/import actions',menu_focus)
        def appearance_properties():
            setup_selection();page.evaluate("document.querySelector('#root').style.cssText='--transcript-font-family:serif;--transcript-font-size:29px;--transcript-font-weight:500;--transcript-line-height:1.8;--reader-font-color:rgb(20,30,40);--reader-background-color:rgb(250,240,220)';player.reflow()")
            assert page.locator('.transcript-text').first.evaluate('e=>getComputedStyle(e).fontSize')=='29px'
            assert page.locator('.transcript-text').first.evaluate('e=>getComputedStyle(e).fontWeight')=='500'
            assert page.locator('.transcript-text').first.evaluate('e=>getComputedStyle(e).fontFamily')=='serif'
            assert page.locator('.transcript-pane').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(250, 240, 220)'
            assert page.locator('.transcript-cue').first.evaluate('e=>getComputedStyle(e).boxShadow')=='none'
            assert page.locator('.transcript-cue').first.evaluate('e=>getComputedStyle(e).borderLeftWidth')=='0px'
            assert page.locator('.transcript-speaker, .transcript-count, .transcript-cue time').count()==0
            page.evaluate("document.querySelector('#root').style.cssText='' ")
        case('transcript consumes ebook typography and reading colors without rails, timestamps or speaker badges',appearance_properties)
        def downloading():
            page.evaluate('createPlayer({download:true})');page.evaluate('captions()');menu()
            with page.expect_download() as result:
                page.get_by_role('button',name='Download subtitles',exact=True).click()
            download=result.value
            assert download.suggested_filename=='fixture.ja.srt'
            content=pathlib.Path(download.path()).read_text()
            assert '00:00:00,000 --> 00:00:06,000' in content and 'こんにちは。' in content
            assert not content.startswith('WEBVTT')
        case('Download subtitles uses the production browser SRT download helper',downloading)
        def generation_selection():
            page.evaluate('createPlayer({delayedGenerate:true})');page.evaluate("player.setGenerationAvailable(true);player.setDiscovery('complete')")
            page.get_by_role('button',name='Generate transcript',exact=True).click()
            page.evaluate('resolveGenerate(trackId)');page.wait_for_timeout(20)
            assert page.evaluate('generated')==1
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'g',start:0,end:3,text:'生成された字幕です。'}])])")
            assert page.evaluate('player.primary.value===trackId')
            assert page.locator('.transcript-setup').is_hidden()
        case('a requested generation selects its completed track without a second installation action',generation_selection)
        def generation_stale():
            page.evaluate('createPlayer({delayedGenerate:true})');page.evaluate("player.setGenerationAvailable(true);player.setTracks([track(trackId2,'en',[{id:'e',start:0,end:3,text:'Existing'}])])")
            page.get_by_role('button',name='Generate transcript',exact=True).click()
            page.get_by_label('Choose existing subtitles',exact=True).select_option(page.evaluate('trackId2'))
            page.evaluate("resolveGenerate(trackId);player.setTracks([...player.tracks,track(trackId,'ja',[{id:'g',start:0,end:3,text:'生成された字幕です。'}])])")
            page.wait_for_timeout(40)
            assert page.evaluate('player.primary.value===trackId2 && !player.pendingGenerated')
        case('late generation cannot steal an existing transcript selected while its admission was pending',generation_stale)
        def popover_phone():
            page.set_viewport_size({'width':320,'height':568});ready();menu()
            panel=page.locator('.transcript-options').bounding_box()
            assert panel['x']>=10 and panel['x']+panel['width']<=310
            assert panel['y']>=10 and panel['y']+panel['height']<=558
            page.screenshot(path=str(args.output/'transcript-menu-phone.png'))
            page.keyboard.press('Escape');page.screenshot(path=str(args.output/'transcript-setup-phone.png'))
            page.set_viewport_size({'width':1280,'height':900})
        case('phone transcript setup and ellipsis stay within viewport bounds',popover_phone)
        def bounded_saves():
            result=page.evaluate("""async()=>{
                await createPlayer(); await player.bindIdentity(mediaKey);
                const original=store.edit.bind(store);let started,release;
                const entered=new Promise(r=>started=r),held=new Promise(r=>release=r);
                let calls=0;
                store.edit=async(...args)=>{if(++calls===1){started();await held;}return original(...args)};
                player.touched=true;player.video.currentTime=1;player.scheduleSave(true);
                await entered;
                for(let i=0;i<2000;i++){player.video.currentTime=(i%100)/10;player.scheduleSave(true);}
                player.video.currentTime=7.5;player.scheduleSave(true,true);
                const first=player.dispose(),second=player.dispose();let closed=false;
                second.then(()=>closed=true);
                try{
                    await new Promise(r=>setTimeout(r,0));
                    const before={calls,closed,same:first===second,paused:player.video.paused,hidden:!player.root.isConnected};
                    release();await Promise.all([first,second]);
                    return {before,calls,positions:writes.map(w=>w.position),last:writes.at(-1)};
                }finally{release();await first;}
            }""")
            assert result['before']==dict(calls=1,closed=False,same=True,paused=True,hidden=True),result
            assert result['calls']==2 and result['positions']==[1,7.5],result
            assert result['last']['finished'] is True,result
        case('2,000 playback updates coalesce and every Close waits for the latest saved position',bounded_saves)
        def conflict_stops_saves():
            result=page.evaluate("""async()=>{
                await createPlayer();await player.bindIdentity(mediaKey);
                let calls=0,release,started;const held=new Promise(r=>release=r),entered=new Promise(r=>started=r);
                store.edit=async()=>{calls++;started();await held;throw Error('newer playback conflict')};
                player.touched=true;player.video.currentTime=1;player.scheduleSave(true);await entered;
                player.video.currentTime=3;player.scheduleSave(true);release();await player.saving;
                player.video.currentTime=4;player.scheduleSave(true);await player.saving;
                const result={calls,stopped:!player.writes,errors:[...errors]};await player.dispose();return result;
            }""")
            assert result['calls']==1 and result['stopped'],result
            assert any('conflict' in error for error in result['errors']),result
        case('a playback conflict drops obsolete pending writes instead of overwriting another edit',conflict_stops_saves)
        def bidi_captions():
            page.evaluate("""async()=>{
                await createPlayer();player.setTracks([
                    track(trackId,'ja',[{id:'jp',start:0,end:5,text:'こんにちは。'}]),
                    track(trackId2,'ar',[{id:'ar',start:0,end:5,text:'مرحبا بالعالم'}])]);
                select('Transcript track',trackId);select('Translation track',trackId2);
            }""")
            assert page.locator('.transcript-text').first.evaluate('e=>getComputedStyle(e).direction')=='ltr'
            assert page.locator('.transcript-translation').first.evaluate('e=>getComputedStyle(e).direction')=='rtl'
            page.get_by_role('button',name='Theater mode',exact=True).click()
            assert page.locator('.caption-line').first.evaluate('e=>getComputedStyle(e).direction')=='ltr'
            assert page.locator('.caption-line.translation').first.evaluate('e=>getComputedStyle(e).direction')=='rtl'
        case('source and translated captions keep independent language and text direction',bidi_captions)
        def early_generation_status(state):
            result=page.evaluate("""async(state)=>{
                await createPlayer({delayedGenerate:true});
                player.setGenerationAvailable(true);player.setDiscovery('complete');
                const request=player.requestGenerate();
                player.generationStatus(trackId,state);
                resolveGenerate(trackId);await request;
                return {pending:player.pendingGenerated??null,disabled:player.generate.disabled,status:player.setupStatus.textContent};
            }""",state)
            assert result['pending'] is None and result['disabled'] is False,result
            assert state in result['status'].lower(),result
        case('a fast preflight failure before Generate returns restores the retry button',lambda:early_generation_status('failed'))
        case('a pause before Generate returns is not lost behind the admission promise',lambda:early_generation_status('paused'))
        def unrelated_generation_status():
            result=page.evaluate("""async()=>{
                await createPlayer({delayedGenerate:true});player.setGenerationAvailable(true);
                const request=player.requestGenerate();player.generationStatus(trackId2,'failed');
                resolveGenerate(trackId);await request;
                return {pending:player.pendingGenerated,disabled:player.generate.disabled};
            }""")
            assert result=={'pending':'11111111-1111-4111-8111-111111111111','disabled':True},result
        case('another job failure cannot cancel the pending Generate admission',unrelated_generation_status)
        def restarted_generation_status():
            result=page.evaluate("""async()=>{
                await createPlayer({delayedGenerate:true});player.setGenerationAvailable(true);
                const request=player.requestGenerate();player.generationStatus(trackId,'paused');
                player.generationStatus(trackId,'decoding');resolveGenerate(trackId);await request;
                return {pending:player.pendingGenerated,disabled:player.generate.disabled};
            }""")
            assert result=={'pending':'11111111-1111-4111-8111-111111111111','disabled':True},result
        case('a resumed job supersedes an early paused notification before admission returns',restarted_generation_status)
        # The view data is scripted; actual production selection, rendering and persistence run.
        page.evaluate("""() => {
            window.draftView=(id=trackId,cues=[{id:'w0/cue-0',start:0,end:3,text:'最初の行。'}],state='running')=>({
                track:{...track(id,'ja',cues),origin:'generated',complete:false,label:'MOSS · In progress'},
                coverage:28,duration:70,state,restartRequired:false,pending:[]
            });
            window.startDraft=async()=>{
                await createPlayer({delayedGenerate:true});await player.bindIdentity(mediaKey);
                player.setGenerationAvailable(true);player.setDiscovery('complete');
                const request=player.requestGenerate();resolveGenerate(trackId);await request;
                player.setDrafts([draftView()]);
            };
        }""")
        def first_draft():
            page.evaluate('startDraft()')
            assert page.locator('.transcript-cue').count()==1
            assert page.locator('.transcript-cue').first.inner_text()=='最初の行。'
            assert page.evaluate('player.primary.value===trackId && !player.tracks[0].complete')
            assert page.get_by_label('Transcript track',exact=True).locator(f'option[value="{page.evaluate("trackId")}"]').count()==1
            assert page.get_by_label('Translation track',exact=True).locator(f'option[value="{page.evaluate("trackId")}"]').count()==0
            assert 'processed' in page.locator('.transcription-progress-note').inner_text()
            assert page.evaluate('player.exportTrack()===undefined')
        case('a generated track is selected and readable at its first accepted checkpoint',first_draft)
        def provisional_inert():
            page.evaluate("player.generationPreview(trackId,[{id:'pending',start:3,end:5,text:'仮の行 <img src=x onerror=alert(1)>'}])")
            assert page.locator('.transcript-cue').count()==1
            assert page.get_by_label('Provisional transcript',exact=True).is_visible()
            assert '<img' in page.get_by_label('Provisional transcript',exact=True).inner_text()
            assert page.get_by_label('Provisional transcript',exact=True).locator('img,button,a').count()==0
            assert page.evaluate('player.exportTrack()===undefined && player.tracks[0].cues.length===1')
        case('within-window preview is inert text, not an accepted cue or exportable track',provisional_inert)
        def stopped_draft(state):
            page.evaluate("""state=>{
                player.generationPreview(trackId);player.setDrafts([draftView(trackId,undefined,state)]);
                player.generationStatus(trackId,state);
            }""",state)
            assert page.locator('.transcript-cue').count()==1
            assert page.get_by_label('Provisional transcript',exact=True).is_hidden()
            assert ('paused' if state=='paused' else 'retry') in page.locator('.transcription-progress-note').inner_text()
            assert page.evaluate('!player.exportTrack()')
        case('pause keeps accepted captions and clears the failed operation preview',lambda:stopped_draft('paused'))
        case('a failed later window does not erase accepted captions',lambda:stopped_draft('failed'))
        def nonretryable_draft():
            page.evaluate("""()=>{
                const draft=draftView(trackId,undefined,'failed');draft.restartRequired=true;
                player.setDrafts([draft]);player.generationStatus(trackId,'failed');
            }""")
            note=page.locator('.transcription-progress-note').inner_text()
            assert 'different window policy' in note and 'retry' not in note
            assert page.locator('.transcript-cue').count()==1
        case('a non-retryable seam keeps accepted captions without promising an identical retry',nonretryable_draft)
        def explicit_track():
            page.evaluate("""async()=>{
                await startDraft();player.setTracks([track(trackId2,'ja',[{id:'authored',start:0,end:4,text:'著者の字幕'}])]);
                select('Transcript track',trackId2);player.setDrafts([draftView()]);
                player.generationPreview(trackId,[{id:'later',start:4,end:6,text:'選択されていない仮の行'}]);
            }""")
            assert page.evaluate('player.primary.value===trackId2')
            assert page.get_by_label('Provisional transcript',exact=True).is_hidden()
            assert page.locator('.transcript-cue').first.inner_text()=='著者の字幕'
        case('late progressive updates cannot replace the user’s authored subtitle selection',explicit_track)
        def completion_handoff():
            page.evaluate("""async()=>{
                await startDraft();player.setDrafts([draftView(trackId,[],'complete')]);
            }""")
            assert page.locator('.transcript-cue').count()==1
            assert 'Finalizing' in page.locator('.transcription-progress-note').inner_text()
            assert page.evaluate('!player.exportTrack()')
            page.evaluate("player.setTracks([{...draftView().track,complete:true}])")
            assert page.locator('.transcript-cue').count()==1
            assert page.evaluate('player.exportTrack()?.id===trackId')
            assert page.locator('.transcription-progress-note').is_hidden()
        case('compacted completion keeps accepted lines until the final manifest arrives',completion_handoff)
        def local_only_choice():
            result=page.evaluate("""async()=>{
                await startDraft();player.touched=true;player.scheduleSave(true);await player.saving;
                const before=writes.at(-1);const local=locals.filter(x=>x.id.startsWith('transcript-draft/')).at(-1);
                player.setTracks([{...draftView().track,complete:true}]);await player.saving;
                return {before,after:writes.at(-1),local,last:locals.filter(x=>x.id.startsWith('transcript-draft/')).at(-1)};
            }""")
            assert result['before']['primary'] is None,result
            assert result['local']['value']=='11111111-1111-4111-8111-111111111111',result
            assert result['after']['primary']=='11111111-1111-4111-8111-111111111111',result
            assert result['last']['value'] is None,result
        case('partial track selection remains local and becomes portable only on completion',local_only_choice)
        def draft_restore():
            page.evaluate("""async()=>{
                await createPlayer();await store.putLocal('guest','settings','transcript-draft/'+mediaKey,trackId);
                await player.bindIdentity(mediaKey);player.setDrafts([draftView(trackId,undefined,'paused')]);
            }""")
            assert page.evaluate('player.primary.value===trackId && generated===0')
            assert page.locator('.transcript-cue').count()==1
            assert 'paused' in page.locator('.transcription-progress-note').inner_text()
        case('reloading a paused local draft restores captions without starting inference',draft_restore)
        def restore_race(dispose=False):
            page.evaluate("""async()=>{
                await createPlayer();store.local=async()=>await new Promise(resolve=>window.resolveDraft=resolve);
                window.bindingDraft=player.bindIdentity(mediaKey);void 0;
            }""")
            page.wait_for_function('typeof resolveDraft==="function"')
            if dispose:
                page.evaluate('player.dispose()')
            else:
                page.evaluate("player.setTracks([track(trackId2,'ja',[{id:'choice',start:0,end:4,text:'新しい選択'}])]);select('Transcript track',trackId2)")
            page.evaluate('resolveDraft(trackId);bindingDraft')
            if dispose:
                assert page.evaluate('!player.root.isConnected && !player.pendingGenerated')
            else:
                page.evaluate('player.setDrafts([draftView()])')
                assert page.evaluate('player.primary.value===trackId2 && generated===0')
        case('late local draft restoration cannot override a newer explicit selection',lambda:restore_race(False))
        case('late local draft restoration cannot revive a disposed player',lambda:restore_race(True))
        def wrong_media_draft():
            page.evaluate("""async()=>{
                await createPlayer();await player.bindIdentity(mediaKey);
                const other=draftView();other.track.mediaKey='sha256:'+'b'.repeat(64);player.setDrafts([other]);
            }""")
            assert page.evaluate('player.drafts.length===0 && player.tracks.length===0')
        case('another media item’s job cannot enter this player’s local track catalog',wrong_media_draft)
        def append_pause():
            result=page.evaluate("""async()=>{
                await startDraft();const previous=player.studyTimeline;let resets=0;
                const reset=player.linePause.reset.bind(player.linePause);player.linePause.reset=()=>{resets++;reset()};
                const next=draftView();next.track.cues.push({id:'w1/cue-0',start:4,end:6,text:'次の行。'});
                player.setDrafts([next]);player.studyTimeline;return {resets,old:previous.cues.length,current:player.studyTimeline.cues.length};
            }""")
            assert result=={'resets':0,'old':1,'current':2},result
        case('appending accepted lines preserves the existing line-pause session',append_pause)
        def initial_preview():
            page.evaluate("""async()=>{
                await createPlayer({delayedGenerate:true});await player.bindIdentity(mediaKey);
                player.setGenerationAvailable(true);const request=player.requestGenerate();resolveGenerate(trackId);await request;
                player.setDrafts([draftView(trackId,[])]);
                player.generationPreview(trackId,[{id:'w0/cue-0',start:0,end:3,text:'最初の仮の文章です。'}]);
            }""")
            assert page.locator('.transcript-cue').count()==0
            assert page.get_by_label('Provisional transcript',exact=True).is_visible()
            assert '最初の仮の文章' in page.get_by_label('Provisional transcript',exact=True).inner_text()
            assert page.evaluate('!player.exportTrack() && !!player.pendingGenerated')
        case('the first in-flight output is visible before any complete window exists',initial_preview)
        def progressive_screenshots():
            page.evaluate('startDraft()')
            page.evaluate("player.generationPreview(trackId,[{id:'pending',start:3,end:5,text:'続きの文章を認識しています。'}])")
            for width,height,name in [(1280,900,'progressive-desktop'),(390,844,'progressive-phone')]:
                page.set_viewport_size(dict(width=width,height=height));page.wait_for_timeout(50)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                assert page.get_by_label('Provisional transcript',exact=True).is_visible()
                page.screenshot(path=str(args.output/(name+'.png')),full_page=False)
            page.set_viewport_size(dict(width=1280,height=900))
        case('progressive status, accepted lines and provisional text fit desktop and phone',progressive_screenshots)
        def disappearing_draft():
            result=page.evaluate("""async()=>{
                await startDraft();await player.draftSaving;
                player.setDrafts([]);player.touched=true;player.scheduleSave(true);await player.saving;
                const missing=writes.at(-1).primary;
                player.setTracks([{...draftView().track,complete:true}]);await player.saving;await player.draftSaving;
                const completed=writes.at(-1).primary;
                player.setTracks([]);player.scheduleSave(true);await player.saving;
                return {missing,completed,unavailable:writes.at(-1).primary};
            }""")
            assert result=={'missing':None,'completed':'11111111-1111-4111-8111-111111111111','unavailable':'11111111-1111-4111-8111-111111111111'},result
        case('missing job snapshots cannot leak a draft ID into sync, while published selections remain portable',disappearing_draft)
        def bounded_draft_saves():
            result=page.evaluate("""async()=>{
                await startDraft();await player.draftSaving;
                player.setTracks([track(trackId2,'ja',[{id:'other',start:0,end:3,text:'別の字幕'}])]);
                const original=store.putLocal.bind(store);let release,entered;
                const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);const values=[];
                store.putLocal=async(...args)=>{
                    if(args[2].startsWith('transcript-draft/')){values.push(args[3]);if(values.length===1){entered();await held;}}
                    return original(...args);
                };
                player.saveDraftSelection();await started;
                for(let i=0;i<2000;i++){player.primary.value=i%2?trackId:trackId2;player.saveDraftSelection();}
                player.primary.value=trackId2;player.saveDraftSelection();
                const first=player.dispose(),second=player.dispose();let closed=false;
                first.then(()=>closed=true);await new Promise(r=>setTimeout(r,0));
                const before={writes:values.length,closed,same:first===second};
                release();await Promise.all([first,second]);return {before,values};
            }""")
            assert result=={'before':{'writes':1,'closed':False,'same':True},'values':['11111111-1111-4111-8111-111111111111',None]},result
        case('local draft selection coalesces 2,000 changes and Close waits for the newest choice',bounded_draft_saves)
        def draft_failure_drain():
            result=page.evaluate("""async()=>{
                await startDraft();await player.draftSaving;await player.saving;
                const original=store.edit.bind(store);let release,entered;
                const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
                store.edit=async(...args)=>{entered();await held;return original(...args)};
                const put=store.putLocal.bind(store);
                store.putLocal=async(...args)=>{if(args[2].startsWith('transcript-draft/'))throw Error('draft quota');return put(...args)};
                player.touched=true;player.scheduleSave(true);await started;
                player.saveDraftSelection();const closing=player.dispose();let settled=false;
                const outcome=closing.then(()=>{settled=true;return null},error=>{settled=true;return String(error)});
                await new Promise(r=>setTimeout(r,0));const before=settled;
                release();const error=await outcome;window.player=undefined;return {before,error};
            }""")
            assert result['before'] is False and 'draft quota' in result['error'],result
        case('a failed local draft save still drains portable playback before Close reports failure',draft_failure_drain)
        def invalid_draft_restore():
            page.evaluate("""async()=>{
                await createPlayer();await store.putLocal('guest','settings','transcript-draft/'+mediaKey,'------------------------------------');
                await player.bindIdentity(mediaKey);
            }""")
            assert page.evaluate('!player.pendingGenerated && generated===0')
        case('a malformed local draft identity does not become a waiting transcript selection',invalid_draft_restore)
        def draft_restore_after_generate():
            page.evaluate("""async()=>{
                await createPlayer({delayedGenerate:true});
                const original=store.local.bind(store);
                store.local=async(...args)=>args[2].startsWith('transcript-draft/')
                    ? new Promise(resolve=>window.releaseDraftRestore=resolve) : original(...args);
                window.identityBinding=player.bindIdentity(mediaKey);
            }""")
            page.wait_for_function('typeof releaseDraftRestore === "function"')
            page.evaluate("player.setGenerationAvailable(true); player.generate.click()")
            page.wait_for_function('typeof resolveGenerate === "function"')
            page.evaluate('resolveGenerate(trackId2)')
            page.wait_for_function('player.pendingGenerated === trackId2')
            page.evaluate('releaseDraftRestore(trackId); identityBinding')
            assert page.evaluate('player.pendingGenerated === trackId2 && !player.primary.value'), 'older saved draft stole the newer Generate intent'
        case('a pending saved draft cannot supersede a newer explicit Generate action',draft_restore_after_generate)
        def preview_failure_without_workspace_clear():
            page.evaluate("""async()=>{
                await startDraft();
                player.generationPreview(trackId,[{id:'preview',start:4,end:5,text:'失敗した出力'}]);
                player.generationStatus(trackId,'failed');
            }""")
            assert '失敗した出力' not in page.locator('.transcription-provisional').inner_text()
        case('a terminal job status retires its preview without depending on a later workspace callback',preview_failure_without_workspace_clear)
        def stale_preview_after_status():
            page.evaluate("""async()=>{
                await startDraft();
                player.generationStatus(trackId,'paused');
                player.generationPreview(trackId,[{id:'late',start:4,end:5,text:'中止後の出力'}]);
            }""")
            assert '中止後の出力' not in page.locator('.transcription-provisional').inner_text()
        case('a late preview cannot revive after its job was paused',stale_preview_after_status)
        def preview_resume():
            page.evaluate("""async()=>{
                await startDraft();
                player.generationStatus(trackId,'paused');
                player.generationStatus(trackId,'decoding');
                player.generationPreview(trackId,[{id:'new',start:4,end:5,text:'再開した出力'}]);
                player.generationStatus(trackId2,'failed');
                player.generationPreview(trackId2);
            }""")
            assert '再開した出力' in page.locator('.transcription-provisional').inner_text()
        case('resumed output is allowed and another job cannot clear its preview',preview_resume)
        def sparse_buffer_controls():
            page.evaluate("""async()=>{
                await createPlayer();
                await player.bindIdentity(mediaKey);
                window.sparseJob={id:trackId,mediaKey,status:'running',duration:78,
                    sparse:{policy:'overlap-sparse-v1',targetSeconds:0,
                        windows:[null,null,null],repairs:[null,null]}};
                player.generationProgress(sparseJob);
            }""")
            assert 'estimating after the first window' in page.locator('.video-viewing [role=status]').all_inner_texts()[-1]
            page.get_by_role('button',name='Wait for captions',exact=True).click()
            assert page.get_by_role('button',name='Play without captions',exact=True).is_visible()
            page.evaluate("""()=>{
                sparseJob.sparse.windows[0]={cues:[],inferenceMs:40000};
                player.generationProgress(sparseJob);
            }""")
            assert 'slower than playback' in page.locator('.video-viewing [role=status]').all_inner_texts()[-1]
            page.get_by_role('button',name='Play without captions',exact=True).click()
            assert page.get_by_role('button',name='Wait for captions',exact=True).is_visible()
        case('slow sparse inference shows a measured ETA and playback bypass',sparse_buffer_controls)
        def temporary_captions_remap():
            page.evaluate("""async()=>{
                await createPlayer();
                const cues=[{id:'a',start:0,end:2,text:'Existing subtitles'}];
                player.setTemporaryTracks([{...track(trackId,'ja',cues),
                    mediaKey:'content:'+'0'.repeat(64),label:'Early subtitles'}]);
                select('Transcript track',trackId);
                await player.bindIdentity(mediaKey);
                player.setTracks([{...track(trackId2,'ja',cues),label:'Early subtitles'}]);
            }""")
            assert page.locator('[aria-label="Transcript track"]').input_value()==page.evaluate('trackId2')
        case('early authored subtitles remap to verified portable identity',temporary_captions_remap)
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
