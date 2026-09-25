#!/usr/bin/env python3
"""Real player interactions over generated MP4. Storage/network/ASR are not exercised.
These cases intentionally use a small explicit persistence double; the separate
app-browser gate owns native IndexedDB and shared ebook appearance acceptance.
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
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/transcript-interactions')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM', '/usr/bin/chromium'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    build = ROOT / '.cache/media-test-build'

    @functools.cache
    def module(name):
        text = (build / name).read_text()
        text = re.sub(r"(['\"])(\./[^'\"\n]+\.js)\1", lambda m: m[1] + module(m[2][2:]) + m[1], text)
        return 'data:text/javascript;base64,' + base64.b64encode(text.encode()).decode()

    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.set_default_timeout(5000)
        page.set_content('<!doctype html><meta charset="utf-8"><style>' + (build / 'media.css').read_text() + '</style><main class="manabi-media" id="host"></main>')
        page.evaluate('''async ({playerURL,sourceURL,video}) => {
            const {VideoPlayer}=await import(playerURL), {localSource}=await import(sourceURL);
            const bytes=Uint8Array.from(atob(video),c=>c.charCodeAt(0));
            window.ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
            window.key='content:'+'a'.repeat(64);
            window.track=(id,language)=>({version:1,id,mediaKey:key,label:language,language,kind:'transcription',origin:'sidecar',complete:true,forced:false,createdAt:1,cues:[{id:'cue-'+id,start:0,end:3,text:language==='ja'?'本を探しています。':'Looking for a book.'}]});
            window.ja=track(ids[0],'ja');window.en=track(ids[1],'en');window.other=track(ids[2],'en');
            window.select=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
            window.make=async saved=>{
                await window.player?.dispose(); window.errors=[];window.generated=0;window.edits=[];
                const store={local:async()=>undefined,putLocal:async()=>{},get:async()=>saved?{payload:saved,localVersion:'old'}:undefined,
                    edit:async(scope,kind,id,key,payload)=>{edits.push(structuredClone(payload));return {localVersion:'next'};}};
                window.player=new VideoPlayer({scope:'guest',source:localSource(new File([bytes],'short-video.mp4',{type:'video/mp4'})),store,
                    preferredLanguages:['en-US'],onError:e=>errors.push(e),onGenerate:()=>{generated++;},onImport:()=>{},onExport:()=>{}});
                host.replaceChildren(player.root);
                await new Promise((yes,no)=>{if(player.video.readyState>=1)return yes();player.video.addEventListener('loadedmetadata',yes,{once:true});player.video.addEventListener('error',()=>no(Error('Generated MP4 cannot play')),{once:true});});
            };
        }''', {'playerURL': module('player.js'), 'sourceURL': module('sources.js'), 'video': base64.b64encode((args.fixture / 'video.mp4').read_bytes()).decode()})

        def case(name, body):
            try:
                body()
                assert page.evaluate('errors.length') == 0, page.evaluate('errors')
                results.append({'name': name, 'passed': True})
                print('PASS', name, flush=True)
            except Exception as error:
                results.append({'name': name, 'passed': False, 'error': str(error)})
                print('FAIL', name, str(error), flush=True)
                page.screenshot(path=str(args.output / f'failure-{len(results)}.png'))

        def setup():
            page.evaluate('make()')
            page.evaluate('player.setTracks([ja,en])')
            assert page.get_by_label('Translation track', exact=True).is_disabled()
            assert page.evaluate('!player.primary.value && !player.secondary.value && generated===0')
        case('setup asks for the main transcript before enabling translation selection', setup)

        def discovery():
            page.evaluate('make()');page.evaluate("player.setTracks([ja,en]);select('Transcript track',ja.id)")
            assert page.evaluate("player.secondary.value===''") , 'An incomplete discovery must not choose the first arriving translation'
            page.evaluate("player.setTracks([ja,en,other]);player.setDiscovery('complete')")
            assert page.evaluate("player.secondary.value===''") , 'Two viewer-language tracks must remain ambiguous'
            assert page.evaluate('player.primary.value===ja.id && generated===0')
        case('automatic translation waits for discovery instead of preferring arrival order', discovery)

        def revision():
            page.evaluate('make()');page.evaluate("player.setTracks([ja,en]);select('Transcript track',ja.id);player.setDiscovery('complete')")
            assert page.evaluate('player.secondary.value===en.id')
            page.evaluate('player.setTracks([ja,en,other])')
            assert page.evaluate("player.secondary.value===''")
            page.evaluate("other=track(ids[2],'en-US');player.setTracks([ja,en,other])")
            assert page.evaluate('player.secondary.value===other.id')
            assert page.evaluate('player.primary.value===ja.id')
        case('automatic suggestions reconsider ties and exact locale matches as tracks arrive', revision)

        def manual():
            page.evaluate('make()')
            page.evaluate("other=track(ids[2],'en-US');player.setTracks([ja,en,other]);player.setDiscovery('complete');select('Transcript track',ja.id)")
            page.evaluate("select('Translation track',en.id);player.setTracks([ja,en,other]);player.setDiscovery('complete')")
            assert page.evaluate('player.secondary.value===en.id')
            page.evaluate("select('Translation track','');player.setTracks([ja,en,other]);player.setDiscovery('limited')")
            assert page.evaluate("player.secondary.value===''")
        case('an explicit translation or Off overrides all later automatic suggestions', manual)

        def restored():
            page.evaluate("make({version:1,mediaKey:key,position:0,duration:10,rate:1,finished:false,updatedAt:1,primary:ja.id,secondary:null,delays:{}})")
            page.evaluate("player.bindIdentity(key)");page.evaluate("player.setTracks([ja,en]);player.setDiscovery('complete')")
            assert page.evaluate("player.primary.value===ja.id && player.secondary.value===''")
        case('restoring a saved main transcript with translation Off never opts back in', restored)

        def replay():
            page.evaluate('make()')
            page.evaluate("player.setTracks([{...ja,cues:Array.from({length:180},(_,i)=>({id:'line-'+i,start:i*3,end:i*3+2,text:'Line '+i}))}]);player.setDiscovery('complete');select('Transcript track',ja.id)")
            page.get_by_role('button', name='Transcript options', exact=True).click()
            page.get_by_label('Follow playback', exact=True).uncheck();page.keyboard.press('Escape')
            page.locator('.transcript-rows').evaluate('e=>{e.scrollTop=1200;e.dispatchEvent(new Event("scroll"));}')
            assert page.locator('.transcript-rows').evaluate('e=>e.scrollTop') > 500
            page.evaluate('player.video.muted=true')
            page.get_by_role('button', name='Replay line', exact=True).click()
            page.wait_for_function('player.follow.checked && document.querySelector(".transcript-rows").scrollTop<100')
            page.evaluate('player.video.pause()')
        case('Replay restores follow position even when replaying the already active line', replay)
        browser.close()
    report = {'environment': 'Chromium real MP4 / production controller / explicit persistence double',
              'notCovered': ['Svelte application', 'native IndexedDB', 'live accounts/providers', 'MOSS inference'],
              'tests': results, 'passed': sum(r['passed'] for r in results), 'failed': sum(not r['passed'] for r in results)}
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if report['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
