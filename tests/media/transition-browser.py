#!/usr/bin/env python3
"""Real player/workspace transitions with real MP4 and explicit storage/ASR doubles.

In-memory page; no native-origin, IndexedDB, provider, or model qualification.
"""
import argparse
import base64
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/media-transitions')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    build = ROOT / '.cache/media-test-build'

    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
            headless=True, args=['--no-sandbox'])
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            page.set_default_timeout(10000)
            page.set_content('<!doctype html><meta charset="utf-8"><style>' +
                             (build / 'media.css').read_text() + '</style><div id="host"></div>')
            page.evaluate(r'''async args => {
                if (!crypto.randomUUID) crypto.randomUUID=()=>{
                    const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
                    const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
                    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
                };
                const urls=new Map();
                const module=(name)=>{
                    if(urls.has(name))return urls.get(name);
                    const source=args.modules[name].replace(/(['"])(\.\/[^'"\n]+\.js)\1/g,
                        (_,quote,path)=>quote+module(path.slice(2))+quote);
                    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
                    urls.set(name,url);return url;
                };
                const {VideoPlayer}=await import(module('player.js')),{VideoWorkspace}=await import(module('workspace.js')),
                    {MediaStore}=await import(module('store.js')),{localSource}=await import(module('sources.js')),
                    {TransactionFactory,RangeDouble}=await import(module('transaction-double.mjs'));
                window.IDBKeyRange=RangeDouble;
                const bytes=Uint8Array.from(atob(args.video),c=>c.charCodeAt(0));
                window.key='content:'+'a'.repeat(64);
                window.check=(condition,message)=>{if(!condition)throw Error(message)};
                window.defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise}};
                window.source=name=>localSource(new File([bytes],name,{type:'video/mp4'}));
                window.select=(picker,id)=>{picker.value=id;picker.dispatchEvent(new Event('change',{bubbles:true}))};
                window.track=(language='ja',overrides={})=>({version:1,id:crypto.randomUUID(),mediaKey:key,
                    label:language,language,kind:'transcription',origin:'sidecar',complete:true,forced:false,
                    createdAt:1,cues:[{id:'cue-0',start:0,end:3,text:'字幕です。'}],...overrides});
                window.clean=async()=>{
                    await window.workspace?.dispose();await window.player?.dispose();await window.store?.close();
                    window.workspace=undefined;window.player=undefined;document.querySelector('#host').replaceChildren();
                };
                window.newStore=()=>new MediaStore(new TransactionFactory(),'transitions-'+crypto.randomUUID());
                window.makeWorkspace=async()=>{
                    await clean();window.store=newStore();window.modelCalls=0;
                    window.workspace=new VideoWorkspace(document.querySelector('#host'),{scope:'guest',store,
                        booksURL:'/manage',runtimeBase:'/moss',loadBunny:async()=>({create:()=>({
                            getAudioTracks:async()=>[],computeDuration:async()=>11,getPrimaryVideoTrack:async()=>null,dispose(){}
                        })}),engine:{prepare:async()=>{modelCalls++},transcribe:async()=>{modelCalls++;return ''},dispose(){}}});
                };
                window.makePlayer=async()=>{
                    await clean();window.store=newStore();window.playerErrors=[];
                    window.player=new VideoPlayer({scope:'guest',store,source:source('Playback.mp4'),
                        preferredLanguages:['en-US'],onGenerate:async()=>undefined,onError:e=>playerErrors.push(e),
                        onExport(){}});
                    document.querySelector('#host').append(player.root);
                    if(player.video.readyState<1)await new Promise((resolve,reject)=>{
                        player.video.addEventListener('loadedmetadata',resolve,{once:true});
                        player.video.addEventListener('error',()=>reject(Error('Fixture cannot play')),{once:true});
                    });
                };
            }''', dict(modules={**{p.name: p.read_text() for p in build.glob('*.js')},
                                'transaction-double.mjs': (ROOT / 'tests/media/transaction-double.mjs').read_text()},
                       video=base64.b64encode((args.fixture / 'video.mp4').read_bytes()).decode()))

            def case(name, script, arg=None):
                print('RUN', name, flush=True)
                try:
                    value = page.evaluate(script, arg)
                    results.append(dict(name=name, passed=True, evidence=value))
                    print('PASS', name, flush=True)
                except Exception as error:
                    results.append(dict(name=name, passed=False, error=str(error)))
                    print('FAIL', name, str(error), flush=True)
                    page.screenshot(path=str(args.output / f'failure-{len(results)}.png'))

            case('A replaced Open cannot dispose the newer real player', '''async()=>{
                await makeWorkspace();await workspace.openSource(source('First.mp4'));
                const pause=workspace.queue.pauseSparseForMedia.bind(workspace.queue),
                    entered=defer(),gate=defer();let held=false;
                workspace.queue.pauseSparseForMedia=async(...args)=>{
                    if(!held){held=true;entered.resolve();await gate.promise}return pause(...args);
                };
                const older=workspace.openSource(source('Older.mp4'));
                try {
                    await entered.promise;
                    await workspace.openSource(source('Newest.mp4'));
                    const newest=workspace.player;
                    gate.resolve();await older;
                    check(workspace.player===newest,'New player identity replaced');
                    check(!newest.closed && newest.root.isConnected && !!newest.video.getAttribute('src'),
                        'Stale Open disposed the newer player');
                    check(workspace.current.source.name==='Newest.mp4','New source lost');
                    check(modelCalls===0,'Opening started recognition');
                    return {newest:workspace.current.source.name,attached:true,modelCalls};
                } finally {gate.resolve();await older;workspace.queue.pauseSparseForMedia=pause}
            }''')

            case('A queued play event cannot cancel a newer caption wait', '''async()=>{
                await makePlayer();await player.bindIdentity(key);
                player.generationProgress({version:3,id:crypto.randomUUID(),mediaKey:key,status:'running',duration:78,
                    cues:[],sparse:{policy:'overlap-sparse-v1',targetSeconds:0,windows:[null,null,null],repairs:[null,null]}});
                const event=defer();player.video.addEventListener('play',()=>event.resolve(),{once:true});
                const playing=player.video.play().catch(e=>{if(e.name!=='AbortError')throw e});
                player.waitForBuffer();
                await event.promise;await playing;
                check(player.video.paused,'Newer caption wait did not pause media');
                check(player.waitForCaptions && player.followGeneratedCaptions,'Old play event cancelled caption waiting');
                check(!player.bypassButton.hidden,'Old play event removed the bypass action');
                return {paused:player.video.paused,waiting:player.waitForCaptions,bypass:true};
            }''')

            case('Renamed sidecars remap both selected languages and offsets to saved IDs', '''async()=>{
                await makePlayer();
                const main=track('ja',{label:'New.ja.srt'}),second=track('en',{label:'New.en.srt'}),
                    savedMain={...main,id:crypto.randomUUID(),label:'Old.ja.srt'},
                    savedSecond={...second,id:crypto.randomUUID(),label:'Old.en.srt'};
                player.setTemporaryTracks([main,second]);select(player.primary,main.id);select(player.secondary,second.id);
                player.primaryDelay.value='0.4';player.primaryDelay.dispatchEvent(new Event('change'));
                player.secondaryDelay.value='-0.6';player.secondaryDelay.dispatchEvent(new Event('change'));
                await player.bindIdentity(key);player.setTracks([savedMain,savedSecond]);
                check(player.primary.value===savedMain.id && player.secondary.value===savedSecond.id,
                    'Selected temporary captions did not remap to saved identities');
                check(player.tracks.length===2 && !player.temporaryTracks.length,'Duplicate temporary captions survived');
                check(player.delays[savedMain.id]===.4 && player.delays[savedSecond.id]===-.6,'Offsets did not follow selected tracks');
                await player.dispose();
                const saved=(await store.get('guest','video_resume',key)).payload;
                check(saved.primary===savedMain.id && saved.secondary===savedSecond.id,'Selections were not saved');
                check(saved.delays[savedMain.id]===.4 && saved.delays[savedSecond.id]===-.6,'Saved offsets were lost');
                return {tracks:2,portableSelection:true,offsetsPreserved:true};
            }''')

            case('Same-label translation remaps rather than becoming an unavailable old UUID', '''async()=>{
                await makePlayer();const main=track(),second=track('en'),saved={...second,id:crypto.randomUUID()};
                player.setTemporaryTracks([main,second]);select(player.primary,main.id);select(player.secondary,second.id);
                await player.bindIdentity(key);player.setTracks([main,saved]);
                check(player.primary.value===main.id && player.secondary.value===saved.id,'Translation selection was not remapped');
                check(!player.secondary.selectedOptions[0].disabled,'Translation became unavailable');
                return {secondaryRemapped:true};
            }''')

            for field, value in [('language', 'en'), ('forced', True), ('kind', 'translation')]:
                case(f'Temporary caption handoff does not confuse {field}', '''async({field,value})=>{
                    await makePlayer();const temporary=track(),other={...temporary,id:crypto.randomUUID(),[field]:value};
                    player.setTemporaryTracks([temporary]);select(player.primary,temporary.id);
                    await player.bindIdentity(key);player.setTracks([other]);
                    check(player.primary.value===temporary.id,'Semantically different captions stole the selection');
                    check(player.temporaryTracks.length===1,'Semantically different captions removed temporary text');
                    return {retained:true,field};
                }''', dict(field=field, value=value))

            case('Ambiguous equivalent saved tracks cannot arbitrarily take temporary selection', '''async()=>{
                await makePlayer();const temporary=track(),a={...temporary,id:crypto.randomUUID()},b={...temporary,id:crypto.randomUUID()};
                player.setTemporaryTracks([temporary]);select(player.primary,temporary.id);
                await player.bindIdentity(key);player.setTracks([a,b]);
                check(player.primary.value===temporary.id,'First matching duplicate won arbitrarily');
                return {ambiguousSelectionRetained:true};
            }''')

            case('Late discovery does not resurrect a retired temporary UUID', """async()=>{
                await makePlayer();const temporary=track(),saved={...temporary,id:crypto.randomUUID()};
                player.setTemporaryTracks([temporary]);select(player.primary,temporary.id);
                await player.bindIdentity(key);player.setTracks([saved]);
                const second=track('en');player.setTemporaryTracks([temporary,second]);
                check(player.primary.value===saved.id,'Late discovery changed the selected saved track');
                check(player.tracks.length===2 && player.temporaryTracks.length===1,
                    'Late discovery resurrected duplicate temporary captions');
                check(player.temporaryTracks[0].id===second.id,'Newly discovered captions lost');
                return {newTrackRetained:true,oldTemporaryRetired:true};
            }""")

            case('A newer explicit translation Off survives temporary publication', '''async()=>{
                await makePlayer();const main=track(),second=track('en');
                player.setTemporaryTracks([main,second]);select(player.primary,main.id);select(player.secondary,second.id);
                select(player.secondary,'');await player.bindIdentity(key);
                player.setTracks([{...main,id:crypto.randomUUID()},{...second,id:crypto.randomUUID()}]);
                check(player.secondary.value==='','Publication overrode translation Off');
                return {offPreserved:true};
            }''')

            for reverse in (False, True):
                case(f'Selected temporary offset wins over duplicate offsets (reverse={reverse})', """async reverse=>{
                    await makePlayer();const selected=track(),duplicate={...selected,id:crypto.randomUUID()},
                        saved={...selected,id:crypto.randomUUID()};
                    player.setTemporaryTracks(reverse?[duplicate,selected]:[selected,duplicate]);
                    select(player.primary,selected.id);
                    player.primaryDelay.value='.4';player.primaryDelay.dispatchEvent(new Event('change'));
                    select(player.primary,duplicate.id);
                    player.primaryDelay.value='.9';player.primaryDelay.dispatchEvent(new Event('change'));
                    select(player.primary,selected.id);
                    await player.bindIdentity(key);player.setTracks([saved]);
                    check(player.primary.value===saved.id,'Selected track did not hand off');
                    check(player.delays[saved.id]===.4,'Unselected duplicate overwrote selected offset');
                    await player.saving;
                    check((await store.get('guest','video_resume',key)).payload.delays[saved.id]===.4,
                        'Selected offset was not persisted');
                    return {delay:player.delays[saved.id]};
                }""", reverse)

            case('A selected saved offset survives resolution of an old ambiguous temporary track', """async()=>{
                await makePlayer();const temporary=track(),a={...temporary,id:crypto.randomUUID()},
                    b={...temporary,id:crypto.randomUUID()};
                player.setTemporaryTracks([temporary]);select(player.primary,temporary.id);
                player.primaryDelay.value='.4';player.primaryDelay.dispatchEvent(new Event('change'));
                await player.bindIdentity(key);player.setTracks([a,b]);
                select(player.primary,a.id);
                player.primaryDelay.value='.9';player.primaryDelay.dispatchEvent(new Event('change'));
                player.setTracks([a]);
                check(player.primary.value===a.id,'Saved selection changed');
                check(player.delays[a.id]===.9,'Retired temporary track clobbered newer saved offset');
                await player.saving;
                check((await store.get('guest','video_resume',key)).payload.delays[a.id]===.9,
                    'Newer saved offset was not persisted');
                return {delay:player.delays[a.id]};
            }""")

            case('An unselected offset handoff is saved without waiting for another playback event', """async()=>{
                await makePlayer();const temporary=track(),saved={...temporary,id:crypto.randomUUID()};
                player.setTemporaryTracks([temporary]);select(player.primary,temporary.id);
                player.primaryDelay.value='.4';player.primaryDelay.dispatchEvent(new Event('change'));
                select(player.primary,'');select(player.secondary,'');
                await player.bindIdentity(key);await player.saving;
                player.setTracks([saved]);await player.saving;
                const snapshot=(await store.get('guest','video_resume',key)).payload;
                check(player.primary.value===''&&player.secondary.value==='','Publication overrode Off');
                check(snapshot.delays[saved.id]===.4,'Offset-only handoff was not saved');
                check(!Object.hasOwn(snapshot.delays,temporary.id),'Temporary offset leaked into portable state');
                return {off:true,delay:snapshot.delays[saved.id]};
            }""")
            page.evaluate('clean()')
        finally:
            browser.close()
    report = dict(scope='Real Chromium MP4/player/workspace; explicit transaction, metadata and ASR doubles',
                  tests=results, passed=sum(t['passed'] for t in results),
                  failed=sum(not t['passed'] for t in results))
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if report['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
