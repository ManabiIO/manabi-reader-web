#!/usr/bin/env python3
"""Actual Chromium player publication races with generated video and a storage double.

No ASR, native IndexedDB, Svelte-shell, physical-device or performance claim.
"""
import argparse
import base64
import functools
import json
import os
from pathlib import Path
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    build = ROOT / '.cache/media-test-build'

    @functools.cache
    def module(name):
        source = (build / name).read_text()
        def replace(match):
            return match[1] + module(match[2][2:]) + match[1]
        source = re.sub(r"(['\"])(\./[^'\"\n]+\.js)\1", replace, source)
        return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()

    fixture = base64.b64encode((args.fixture / 'video.mp4').read_bytes()).decode()
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                                     headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1280,'height':900})
        page.set_default_timeout(5000)
        page.set_content('<!doctype html><meta charset="utf-8"><style>' +
                         (build / 'media.css').read_text() + '</style><main class="manabi-media" id="root"></main>')
        page.evaluate("""async ({playerURL,sourceURL,fixture}) => {
            const {VideoPlayer}=await import(playerURL), {localSource}=await import(sourceURL);
            const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0));
            window.mediaKey='content:'+'a'.repeat(64);
            window.trackId='11111111-1111-4111-8111-111111111111';
            window.trackId2='22222222-2222-4222-8222-222222222222';
            window.track=(id,language,cues)=>({version:1,id,mediaKey,label:language+' captions',language,
                kind:'transcription',origin:'sidecar',complete:true,forced:false,createdAt:1,cues});
            window.createPlayer=async ()=>{
                await window.player?.dispose();
                const values=new Map();let version=null, serial=0;
                window.errors=[];
                const store={
                    async local(scope,kind,id){return values.get(kind+'/'+id);},
                    async putLocal(scope,kind,id,value){values.set(kind+'/'+id,structuredClone(value));},
                    async get(){return undefined;},
                    async edit(scope,kind,id,key,payload,expected){
                        if(expected!==version)throw Error('conflict');version=String(++serial);return {localVersion:version};
                    }
                };
                window.player=new VideoPlayer({scope:'guest',source:localSource(new File([bytes],'fixture.mp4',{type:'video/mp4'})),store,
                    onError:m=>errors.push(m),onGenerate(){},onImport(){},onExport(){}});
                document.querySelector('#root').replaceChildren(player.root);
                await new Promise((resolve,reject)=>{
                    if(player.video.readyState>=1)return resolve();
                    player.video.addEventListener('loadedmetadata',resolve,{once:true});
                    player.video.addEventListener('error',()=>reject(Error('fixture video codec failed')),{once:true});
                });
            };
            window.select=(label,value)=>{const e=document.querySelector('[aria-label="'+label+'"]');
                e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
        }""", {'playerURL':module('player.js'),'sourceURL':module('sources.js'),'fixture':fixture})

        def case(name, body):
            try:
                body()
                assert not page.evaluate('errors'), page.evaluate('errors')
                results.append({'name':name,'passed':True})
                print('PASS',name,flush=True)
            except Exception as error:
                results.append({'name':name,'passed':False,'error':str(error)})
                print('FAIL',name,str(error),flush=True)
                page.screenshot(path=str(args.output / f'failure-{len(results)}.png'))
        def compact_wait_fixture():
            page.evaluate("""async()=>{
                await createPlayer();
                await player.bindIdentity(mediaKey);
                window.sparseJob={version:3,id:trackId,mediaKey,status:'running',duration:26,
                    nextWindow:0,cues:[],sparse:{policy:'overlap-sparse-v2',targetSeconds:0,
                        windows:[null],repairs:[]}};
                player.pendingGenerated=trackId;
                player.generationProgress(sparseJob);
                await player.video.play();
            }""")
            page.get_by_role('button',name='Wait for captions',exact=True).click()
            page.evaluate("""()=>{
                // This is the shape MediaStore persists after atomic publication.
                const {sparse,...summary}=sparseJob;
                window.compactJob={...summary,status:'complete',nextWindow:1,cues:[]};
                player.generationProgress(compactJob);
            }""")
        def compact_summary_waits():
            compact_wait_fixture()
            assert page.evaluate('player.video.paused && player.waitForCaptions')
            assert page.get_by_role('button',name='Play without captions',exact=True).is_visible()
            assert 'Finalizing captions' in page.evaluate('player.bufferStatus.textContent')
            page.evaluate("player.setTracks([track(trackId2,'en',[{id:'other',start:0,end:3,text:'Unrelated track'}])])")
            assert page.evaluate('player.video.paused && player.waitForCaptions')
            page.evaluate("player.setTracks([{...track(trackId,'ja',[{id:'w0/cue-0',start:0,end:3,text:'Draft only'}]),complete:false}])")
            assert page.evaluate('player.video.paused && player.waitForCaptions')
            page.evaluate("player.setTracks([track(trackId,'ja',[{id:'w0/cue-0',start:0,end:3,text:'完成した字幕'}])])")
            page.wait_for_function('!player.video.paused && !player.waitForCaptions && player.bufferStatus.hidden')
            assert page.locator('[aria-label="Transcript track"]').input_value()==page.evaluate('trackId')
        case('compact completed job keeps caption wait until its exact published track arrives',compact_summary_waits)
        def compact_summary_bypass():
            compact_wait_fixture()
            page.get_by_role('button',name='Play without captions',exact=True).click()
            page.wait_for_function('!player.video.paused')
            page.evaluate('player.generationProgress(compactJob)')
            assert page.evaluate('!player.waitForCaptions && !player.followGeneratedCaptions')
            assert not page.evaluate('player.video.paused')
        case('compact finalization preserves explicit playback bypass',compact_summary_bypass)
        def compact_summary_draft_and_manual_choice():
            compact_wait_fixture()
            page.evaluate("""()=>{
                const draft={track:{...track(trackId,'ja',[{id:'w0/cue-0',start:0,end:3,text:'保存した字幕'}]),complete:false},
                    coverage:26,duration:26,state:'running',restartRequired:false,provisional:false,pending:[]};
                player.setDrafts([draft]);
                player.setDrafts([{...draft,state:'complete',track:{...draft.track,cues:[]}}]);
            }""")
            assert page.locator('.transcript-cue',has_text='保存した字幕').count()==1
            assert page.evaluate('player.video.paused && player.waitForCaptions')
            page.evaluate("player.setTracks([track(trackId2,'ja',[{id:'authored',start:0,end:3,text:'Authored subtitles'}])]);select('Transcript track',trackId2)")
            page.wait_for_function('!player.video.paused')
            assert page.evaluate('!player.waitForCaptions && !player.followGeneratedCaptions')
        case('compact summary retains draft text and respects a newer authored subtitle choice',compact_summary_draft_and_manual_choice)
        def published_job_has_no_first_window_clock():
            page.evaluate("""async()=>{
                await createPlayer();await player.bindIdentity(mediaKey);
                player.setTracks([track(trackId,'ja',[{id:'done',start:0,end:3,text:'Published'}])]);
                player.generationProgress({version:3,id:trackId,mediaKey,status:'running',duration:26,cues:[],
                    sparse:{policy:'overlap-sparse-v2',targetSeconds:0,windows:[null],repairs:[]}},'transcribing');
            }""")
            assert page.evaluate('player.firstWindowClock===undefined && player.bufferStatus.hidden')
        case('late pre-publication progress cannot restart a completed track elapsed timer',published_job_has_no_first_window_clock)
        page.evaluate('() => player.dispose()')
        browser.close()
    (args.output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    if any(not item['passed'] for item in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
