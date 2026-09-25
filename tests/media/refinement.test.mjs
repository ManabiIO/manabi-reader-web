/** Production parsing/runtime/range regressions; no mocked ASR counted as recognition evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMoss} from '../../.cache/media-test-build/moss-output.js';
import {CueTimeline, exportName, matchSidecar, serializeSubtitles, parseSubtitles} from '../../.cache/media-test-build/captions.js';
import {assertRuntimeIdentity, assertRuntimeBindings, MOSS_WEB_ABI} from '../../.cache/media-test-build/moss-runtime-contract.js';
import {MOSS} from '../../.cache/media-test-build/model-cache.js';
import {boundedResponse, cloudSource} from '../../.cache/media-test-build/sources.js';
import {readFileSync} from 'node:fs';

test('MOSS bracketed numbers inside speech do not become spurious end timestamps',()=>{
 const result=parseMoss('[0.2][S01]Read [2026] and [1.5] aloud.[3.2][3.3][S02]次の文です。[5]',6);
 assert.deepEqual(result.map(c=>c.text),['Read [2026] and [1.5] aloud.','次の文です。']);
 assert.deepEqual(result.map(c=>[c.start,c.end]),[[.2,3.2],[3.3,5]]);
});
test('MOSS parser accepts reference decimal forms and surrounding whitespace',()=>{
 const result=parseMoss(' \n[.25][S01]今日は晴れです。[2.] \n[2.1][S02]明日は公園に行きます。[4.9]\n',5);
 assert.equal(result.length,2);assert.equal(result[0].start,.25);assert.equal(result[0].end,2);
});
test('malformed MOSS tail cannot silently publish earlier valid output',()=>{
 for(const raw of ['[0][S01]One.[1]trailing','[0][S01]One.[1][2][S02]Incomplete']) assert.throws(()=>parseMoss(raw,5));
});
test('nonempty MOSS speech with no usable interval fails instead of disappearing',()=>{
 for(const raw of ['[1][S01]Spoken.[1]','[5][S01]Spoken.[6]']) assert.throws(()=>parseMoss(raw,5),/interval/);
 assert.deepEqual(parseMoss('  ',5),[]);
});
test('Japanese bracketed transcript text survives ordinary subtitle export/import',()=>{
 const cues=parseMoss('[0][S01]番号は[2026]です。[2][2.2][S01]次の文です。[4]',5);
 for(const format of ['srt','vtt'])assert.deepEqual(parseSubtitles(serializeSubtitles({cues},format)).map(c=>c.text),cues.map(c=>c.text));
});
const runtime=(changes={})=>({_moss_web_abi_version:()=>MOSS_WEB_ABI,_moss_web_engine_revision:()=>16,_moss_web_ggml_revision:()=>32,UTF8ToString:p=>p===16?MOSS.engineRevision:MOSS.ggmlRevision,...changes});
test('compiled runtime compatibility identity must match both engine and ggml',()=>{
 assert.doesNotThrow(()=>assertRuntimeIdentity(runtime()));
 for(const value of [runtime({_moss_web_abi_version:()=>0}),runtime({UTF8ToString:()=> 'stale'}),runtime({_moss_web_engine_revision:undefined}),runtime({_moss_web_ggml_revision:()=>0}),runtime({_moss_web_engine_revision:()=>-1}),runtime({_moss_web_ggml_revision:()=>NaN})])assert.throws(()=>assertRuntimeIdentity(value),/outdated or incompatible/);
});
test('identity getter exceptions produce an actionable compatibility error',()=>{
 assert.throws(()=>assertRuntimeIdentity(runtime({UTF8ToString(){throw Error('bad memory')}})),/Rebuild and deploy/);
});
test('worker verifies compiled runtime before the model download',()=>{
 const src=readFileSync(new URL('../../apps/web/src/lib/media/moss-worker.ts',import.meta.url),'utf8');
 assert.ok(src.indexOf('assertRuntimeIdentity(runtime!, data.threaded)') < src.indexOf('await getModel('));
 assert.ok(src.includes('assertRuntimeIdentity(runtime!, data.threaded)'));
});
test('build recipe exports the pinned ABI and provenance handshake',()=>{
 const build=readFileSync(new URL('../../tools/media/build-moss.py',import.meta.url),'utf8');
 const bridge=readFileSync(new URL('../../tools/media/bridge.cpp',import.meta.url),'utf8');
 for(const fn of ['moss_web_abi_version','moss_web_engine_revision','moss_web_ggml_revision']){assert.ok(build.includes('_'+fn));assert.ok(bridge.includes(fn));}
 assert.ok(build.includes(MOSS.engineRevision.split('+')[1]));assert.ok(build.includes(MOSS.ggmlRevision));
});
test('forced subtitle exports preserve the forced flag when rediscovered',()=>{
 const name=exportName('Episode.mp4',{language:'ja',forced:true});assert.equal(name,'Episode.ja.forced.srt');
 assert.deepEqual(matchSidecar('Episode.mp4',name),{language:'ja',forced:true});
 assert.equal(exportName('Episode.mp4',{language:'ja',forced:false}),'Episode.ja.srt');
});
test('indexed translated overlaps agree with reference including long crossing cues',()=>{
 const cues=Array.from({length:400},(_,i)=>({id:String(i),start:i*.25,end:i*.25+(i%9===0?30:.3),text:String(i)}));
 const timeline=new CueTimeline(cues);
 for(let i=0;i<800;i++){
  const start=(i%200)*.51,end=start+.42,delay=(i%31)*.1-1.5;
  assert.deepEqual(timeline.overlaps(start,end,delay),cues.filter(c=>c.start+delay<end&&c.end+delay>start));
 }
 assert.deepEqual(timeline.overlaps(2,2),[]);assert.deepEqual(timeline.overlaps(NaN,3),[]);assert.deepEqual(timeline.overlaps(0,3,Infinity),[]);
});
test('rejected response cancellation does not become an unhandled rejection',async()=>{
 const controller=new AbortController();let canceled=0;
 const response=new Response(new ReadableStream({cancel(){canceled++;return Promise.reject(Error('transport cancel failed'));}}));
 const pending=boundedResponse(response,10,controller.signal);controller.abort();
 await assert.rejects(pending,{name:'AbortError'});await new Promise(r=>setTimeout(r,10));assert.equal(canceled,1);
});

test('oversized response rejection does not wait for a non-settling transport cancel',async()=>{
 let canceled=0;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(10));},cancel(){canceled++;return new Promise(()=>{});}});
 const pending=boundedResponse(new Response(stream),5,new AbortController().signal);
 await Promise.race([assert.rejects(pending,/Oversized/),new Promise((_,reject)=>setTimeout(()=>reject(Error('response cleanup stalled')),200))]);
 assert.equal(canceled,1);
});
test('invalid response size rejected before acquiring stream reader',async()=>{
 for(const max of [-1,NaN,Infinity,1.2])await assert.rejects(boundedResponse(new Response('x'),max,new AbortController().signal),/size limit/);
});
test('cloud account change cancels the unopened response body',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'location'),fetch=globalThis.fetch;
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://manabi.io'}});
 let current=true,canceled=0;const version='b'.repeat(64),id='a0000000-0000-4000-8000-000000000001';
 try{
  const source=cloudSource({name:'v.mp4',size:10,version,url:`/api/reader-web/connections/${id}/media/?root=r&id=i&user=u&version=${version}`},'u',()=>current);
  globalThis.fetch=async()=>{current=false;return new Response(new ReadableStream({cancel(){canceled++;return Promise.reject(Error('cleanup'));}}));};
  await assert.rejects(source.read(0,10,new AbortController().signal),/Account changed/);assert.equal(canceled,1);
 }finally{globalThis.fetch=fetch;if(old)Object.defineProperty(globalThis,'location',old);else delete globalThis.location;}
});


test('stale cloud response rejection does not wait for a non-settling body cancel',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'location'),fetch=globalThis.fetch;
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://manabi.io'}});
 let current=true,canceled=0;const version='b'.repeat(64),id='a0000000-0000-4000-8000-000000000001';
 try{
  const source=cloudSource({name:'v.mp4',size:10,version,url:`/api/reader-web/connections/${id}/media/?root=r&id=i&user=u&version=${version}`},'u',()=>current);
  globalThis.fetch=async()=>{current=false;return new Response(new ReadableStream({cancel(){canceled++;return new Promise(()=>{});}}));};
  await Promise.race([assert.rejects(source.read(0,10,new AbortController().signal),/Account changed/),new Promise((_,reject)=>setTimeout(()=>reject(Error('cloud cleanup stalled')),200))]);
  assert.equal(canceled,1);
 }finally{globalThis.fetch=fetch;if(old)Object.defineProperty(globalThis,'location',old);else delete globalThis.location;}
});
test('runtime mode mismatch is rejected before claiming threaded inference',()=>{
 const single=runtime({HEAP32:new Int32Array(4)}),threaded=runtime({HEAP32:new Int32Array(new SharedArrayBuffer(16))});
 assert.doesNotThrow(()=>assertRuntimeIdentity(single,false));assert.doesNotThrow(()=>assertRuntimeIdentity(threaded,true));
 assert.throws(()=>assertRuntimeIdentity(single,true),/incompatible/);assert.throws(()=>assertRuntimeIdentity(threaded,false),/incompatible/);
 assert.throws(()=>assertRuntimeIdentity(runtime(),true),/incompatible/);
});

test('sub-millisecond container cues export with a positive parseable interval',()=>{
 const cues=[{id:'tiny',start:.0001,end:.0002,text:'短い字幕'},{id:'other',start:1.1234,end:1.1235,text:'次の字幕'}];
 for(const format of ['srt','vtt']){
  const out=parseSubtitles(serializeSubtitles({cues},format));assert.equal(out.length,2);
  assert.ok(out.every(c=>c.end>c.start));assert.equal(out[0].end,.001);
 }
});


function bindings(changes={}) {
 const buffer=new ArrayBuffer(128);
 return {FS:{mkdir(){},mount(){},unmount(){}},WORKERFS:{},HEAP32:new Int32Array(buffer),HEAPF32:new Float32Array(buffer),
 ccall(){},UTF8ToString(){},_malloc(){},_free(){},_moss_web_load(){},_moss_web_cancel_ptr:()=>16,_moss_web_begin(){},
 _moss_transcribe_capi_transcribe_pcm(){},_moss_transcribe_capi_last_error(){},_moss_transcribe_capi_free_string(){},_moss_transcribe_capi_free(){},...changes};
}
test('runtime bindings preflight requires the full PCM and file-loading ABI',()=>{
 assert.doesNotThrow(()=>assertRuntimeBindings(bindings(),false));
 for(const name of ['ccall','_malloc','_moss_web_load','_moss_transcribe_capi_transcribe_pcm','_moss_transcribe_capi_free'])
  assert.throws(()=>assertRuntimeBindings(bindings({[name]:undefined}),false),/bindings/);
 assert.throws(()=>assertRuntimeBindings(bindings({FS:{mkdir(){}}}),false),/bindings/);
});
test('runtime bindings preflight rejects absent or unrelated heap views',()=>{
 for(const changes of [{HEAPF32:undefined},{HEAP32:undefined},{HEAPF32:new Float32Array(32)}])
  assert.throws(()=>assertRuntimeBindings(bindings(changes),false),/bindings/);
});
test('cancellation pointer must be a non-null aligned in-heap integer',()=>{
 for(const offset of [0,-4,2,128,Infinity,NaN])assert.throws(()=>assertRuntimeBindings(bindings({_moss_web_cancel_ptr:()=>offset}),false),/bindings/);
 assert.throws(()=>assertRuntimeBindings(bindings({_moss_web_cancel_ptr:()=>{throw Error('trap')}}),false),/bindings/);
});


test('worker re-reads and bounds-checks the WASM heap after allocation',()=>{
 const worker=readFileSync(new URL('../../apps/web/src/lib/media/moss-worker.ts',import.meta.url),'utf8');
 assert.match(worker,/const heap = runtime\.HEAPF32/);
 assert.match(worker,/start \+ pcm\.length > heap\.length/);
 assert.ok(worker.indexOf('const heap = runtime.HEAPF32') > worker.indexOf('runtime._malloc(pcm.byteLength)'));
});
test('MOSS operation IDs stay inside the signed 32-bit cancellation contract',()=>{
 const client=readFileSync(new URL('../../apps/web/src/lib/media/moss-client.ts',import.meta.url),'utf8');
 assert.match(client,/this\.serial >= 0x7ffffffe \? 1 : this\.serial \+ 1/);
});

test('CPU backend graph computation observes the shared cancellation word',()=>{
 const build=readFileSync(new URL('../../tools/media/build-moss.py',import.meta.url),'utf8');
 const hooks=readFileSync(new URL('../../tools/media/manabi_web_hooks.hpp',import.meta.url),'utf8');
 const bridge=readFileSync(new URL('../../tools/media/bridge.cpp',import.meta.url),'utf8');
 assert.match(build,/ggml_backend_cpu_set_abort_callback/);
 assert.match(build,/manabi_web_cancel_requested/);
 assert.match(hooks,/bool manabi_web_cancel_requested\(\)/);
 assert.match(bridge,/bool manabi_web_cancel_requested\(\)/);
});
test('runtime cancellation word uses an explicit aligned 32-bit atomic representation',()=>{
 const bridge=readFileSync(new URL('../../tools/media/bridge.cpp',import.meta.url),'utf8');
 assert.match(bridge,/alignas\(4\) static int32_t cancelled_operation/);
 assert.match(bridge,/__atomic_load_n\(&cancelled_operation, __ATOMIC_RELAXED\)/);
 assert.match(bridge,/int32_t\* moss_web_cancel_ptr\(\) \{ return &cancelled_operation; \}/);
 assert.doesNotMatch(bridge,/reinterpret_cast<.*cancelled_operation|std::atomic/);
});
test('threaded runtime must expose deterministic pool cleanup',()=>{
 assert.throws(()=>assertRuntimeBindings(bindings(),true),/bindings/);
 assert.doesNotThrow(()=>assertRuntimeBindings(bindings({PThread:{terminateAllThreads(){}}}),true));
});
test('full runtime bindings are checked before any weights are requested',()=>{
 const worker=readFileSync(new URL('../../apps/web/src/lib/media/moss-worker.ts',import.meta.url),'utf8');
 assert.ok(worker.indexOf('assertRuntimeBindings(runtime!, data.threaded)')<worker.indexOf('await getModel('));
});
