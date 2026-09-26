#!/usr/bin/env python3
"""Run production PCM-window rendering against Chromium's real Web Audio engine.

Only decoded-packet delivery is injected. No fake OfflineAudioContext/AudioBuffer,
no microphone permission, speech synthesis, encoded-media decoder, or MOSS is used.
The in-memory document does not require an invented secure origin.
"""
import argparse
import base64
import json
import os
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / '.cache/media-audio-browser')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = ROOT / '.cache/media-test-build/pipeline.js'
    module = 'data:text/javascript;base64,' + base64.b64encode(source.read_bytes()).decode()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        page = browser.new_page()
        page.set_content('<!doctype html><meta charset="utf-8"><title>Native Web Audio qualification</title>')
        result = page.evaluate('''async module => {
            const {MediaPipeline} = await import(module), tests = [], errors = [];
            window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
            const check = (value, message) => { if (!value) throw Error(message); };
            const near = (actual, expected, message, tolerance = .0001) =>
                check(Math.abs(actual-expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
            const mean = (pcm, start, end) => {
                const samples = pcm.slice(Math.ceil(start*16000), Math.floor(end*16000));
                return samples.reduce((a,b)=>a+b,0)/samples.length;
            };
            const buffer = (duration, rate, values) => {
                const result = new AudioBuffer({length:Math.round(duration*rate),sampleRate:rate,numberOfChannels:values.length});
                values.forEach((value,channel)=>{
                    const samples=result.getChannelData(channel);
                    if(typeof value==='function')for(let i=0;i<samples.length;i++)samples[i]=value(i/rate);
                    else samples.fill(value);
                }); return result;
            };
            const decode = async (packets, start, end) => {
                let disposed=0;
                const track={id:1,canDecode:async()=>true,getNumberOfChannels:async()=>packets[0]?.buffer.numberOfChannels??1,
                    async *buffers(){for(const packet of packets)yield packet;}};
                const pipeline=new MediaPipeline({create:()=>({getAudioTracks:async()=>[track],dispose(){disposed++}})},{});
                try {
                    const pcm=await pipeline.decode(1,start,end,new AbortController().signal);
                    check(pcm.length===Math.ceil((end-start)*16000),'exact 16 kHz window length');
                    check(pcm.every(Number.isFinite),'finite PCM');return pcm;
                } finally {pipeline.dispose();check(disposed===1,'decoder disposed exactly once');}
            };
            const test=async(name,run)=>{try{const measurements=await run();tests.push({name,passed:true,...(measurements?{measurements}:{})});}
                catch(e){tests.push({name,passed:false,error:String(e)});}};
            await test('real 48 kHz stereo resampling and speaker downmix to 16 kHz mono',async()=>{
                const pcm=await decode([{timestamp:0,duration:1,buffer:buffer(1,48000,[.25,.75])}],0,1);
                near(mean(pcm,.01,.99),.5,'stereo mean');return {length:pcm.length,interiorMean:mean(pcm,.01,.99)};
            });
            await test('nonzero media offsets preserve trimmed speech and a silent gap',async()=>{
                const pcm=await decode([{timestamp:2.9,duration:.2,buffer:buffer(.2,48000,[.25])},
                    {timestamp:3.2,duration:.2,buffer:buffer(.2,48000,[.75])}],3,3.3);
                near(mean(pcm,.02,.08),.25,'trimmed first packet');near(mean(pcm,.12,.18),0,'middle gap');near(mean(pcm,.22,.28),.75,'second packet');
            });
            await test('negative initial packet timestamps trim pre-roll rather than shift it',async()=>{
                const pcm=await decode([{timestamp:-.1,duration:.2,buffer:buffer(.2,48000,[.4])}],0,.2);
                near(mean(pcm,.02,.08),.4,'audible remainder');near(mean(pcm,.12,.18),0,'trailing gap');
            });
            await test('leading silence is retained instead of moving the first caption earlier',async()=>{
                const pcm=await decode([{timestamp:.1,duration:.1,buffer:buffer(.1,44100,[.6])}],0,.3);
                near(mean(pcm,.02,.08),0,'leading gap');near(mean(pcm,.12,.18),.6,'absolute packet timing');near(mean(pcm,.22,.28),0,'trailing gap');
            });
            await test('opposite-phase stereo cancels through real browser downmix',async()=>{
                const pcm=await decode([{timestamp:0,duration:.2,buffer:buffer(.2,48000,[.6,-.6])}],0,.2);
                check(pcm.every(n=>Math.abs(n)<.0001),'opposite phases sum to zero');
            });
            await test('44.1 kHz sine frequency is preserved by native 16 kHz rendering',async()=>{
                const pcm=await decode([{timestamp:0,duration:.25,buffer:buffer(.25,44100,[t=>.5*Math.sin(2*Math.PI*1000*t)])}],0,.25);
                let square=0,count=0;for(let i=160;i<pcm.length-160;i++) {square+=(pcm[i]-.5*Math.sin(2*Math.PI*1000*i/16000))**2;count++;}
                const rmse=Math.sqrt(square/count);check(rmse<.01,`resampling RMSE ${rmse}`);return {rmse};
            });
            await test('absent packets render the requested silent interval',async()=>{
                const pcm=await decode([],5,5.125);check(pcm.every(n=>n===0),'no fabricated speech');
            });
            await test('out-of-window packets do not leak sound into the requested interval',async()=>{
                const pcm=await decode([{timestamp:0,duration:.1,buffer:buffer(.1,48000,[1])},
                    {timestamp:4,duration:.1,buffer:buffer(.1,48000,[1])}],2,2.2);check(pcm.every(n=>n===0),'discard outside packets');
            });
            await new Promise(resolve=>setTimeout(resolve,25));
            check(errors.length===0,`unhandled errors: ${errors}`);
            return {scope:'Production MediaPipeline with real Chromium OfflineAudioContext and AudioBuffer; only decoded-packet delivery is injected',
                notCovered:['Mediabunny/WebCodecs encoded-file decoding','Japanese synthesis','MOSS recognition','Safari/iOS','native IndexedDB'],
                userAgent:navigator.userAgent,tests,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length};
        }''', module)
        browser.close()
    (args.output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    for test in result['tests']:
        print('PASS' if test['passed'] else 'FAIL', test['name'], test.get('error', ''))
    if result['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
