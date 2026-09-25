import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {Sha256,canonical,digestText} from '../../.cache/media-test-build/hash.js';
import {validateTrack,validatePlayback,validateStyle,language} from '../../.cache/media-test-build/contracts.js';
import {parseSubtitles,serializeSubtitles,CueTimeline,matchSidecar,chooseLayout} from '../../.cache/media-test-build/captions.js';
import {edit,prepare,acknowledge,ingest,resolve,splitTrack,assembleTrack,remote} from '../../.cache/media-test-build/replica.js';
import {downloadVerified} from '../../.cache/media-test-build/model-cache.js';
import {parseMoss,planWindows,ownedCues} from '../../.cache/media-test-build/moss-output.js';
import {localSource,identify,assertRange,boundedResponse} from '../../.cache/media-test-build/sources.js';
import {discoverEmbedded} from '../../.cache/media-test-build/embedded.js';
const key='content:'+'a'.repeat(64),id='11111111-1111-4111-8111-111111111111',scope='account:a';
const cues=[{id:'a',start:0,end:2,text:'日本語 <literal> & text'},{id:'b',start:2.5,end:4,text:'二つ目の行'}];
const track=()=>({version:1,id,mediaKey:key,label:'Japanese',language:'ja',kind:'transcription',origin:'sidecar',complete:true,forced:false,createdAt:1,cues:structuredClone(cues)});
const playback=(position=1)=>({version:1,mediaKey:key,position,duration:20,rate:1,finished:false,updatedAt:1,primary:id,secondary:null,delays:{}});
const wire=(r,revision=1,payload=r.payload)=>({kind:r.kind,entity_id:r.id,book_key:r.mediaKey,revision,payload,deleted:payload===null});
for(const size of [0,1,2,3,55,56,57,63,64,65,127,128,129,1024,65537,1048589])test(`incremental SHA-256 agrees with Node crypto for ${size} bytes`,()=>{const data=crypto.randomBytes(size),hash=new Sha256();for(let i=0;i<data.length;i+=37)hash.update(data.subarray(i,i+37));assert.equal(hash.hex(),crypto.createHash('sha256').update(data).digest('hex'));assert.throws(()=>hash.update(new Uint8Array()));});
test('canonical JSON is independent of insertion order',()=>assert.equal(canonical({z:1,a:{b:2,a:3}}),canonical({a:{a:3,b:2},z:1})));
test('SRT and VTT round-trip literal markup safely',()=>{for(const format of ['srt','vtt'])assert.deepEqual(parseSubtitles(serializeSubtitles(track(),format)).map(({id,...c})=>c),cues.map(({id,...c})=>c));});
test('VTT NOTE/style blocks do not become captions',()=>assert.equal(parseSubtitles('WEBVTT\n\nNOTE engine=test\n\nSTYLE\n::cue {}\n\na\n00:00.000 --> 00:01.000\nこんにちは')[0].text,'こんにちは'));
test('malformed subtitles are not silently accepted',()=>{for(const raw of ['', 'garbage','1\n00:00:02,000 --> 00:00:01,000\nx','WEBVTT\n00:00.000 --> 00:01.000\nx'])assert.throws(()=>parseSubtitles(raw));});
test('overlapping cues are all preserved; ends are exclusive',()=>{const t=new CueTimeline([{id:'long',start:0,end:10,text:'long'},{id:'short',start:1,end:2,text:'short'}]);assert.equal(t.active(1.5).length,2);assert.deepEqual(t.active(2).map(c=>c.id),['long']);assert.equal(t.active(10).length,0);assert.equal(t.active(1.5,1).length,1);});
test('translation alignment uses intervals, never row indices',()=>{const translation=new CueTimeline([{id:'span',start:.5,end:3,text:'both'}]);assert.equal(translation.overlaps(0,2).length,1);assert.equal(translation.overlaps(2,4).length,1);assert.equal(translation.overlaps(3,4).length,0);});
test('language matching is basename-bound and does not infer moss as language',()=>{assert.equal(matchSidecar('Movie.mp4','Movie.moss.jpn.srt').language,'ja');assert.equal(matchSidecar('Movie.mp4','Other.ja.srt'),null);assert.equal(matchSidecar('Movie.mp4','Movie.en.forced.srt').forced,true);assert.equal(language('jpn'),'ja');assert.throws(()=>language('moss'));});
test('layout is stable and respects narrow viewports',()=>{assert.equal(chooseLayout(390,700,16/9),'below');assert.equal(chooseLayout(1400,650,16/9),'side');assert.equal(chooseLayout(NaN,650,1),'below');});
test('closed schemas reject credentials, NaN, invalid timestamps and duplicate IDs',()=>{assert.throws(()=>validateTrack({...track(),token:'secret'}));assert.throws(()=>validateTrack({...track(),cues:[cues[0],cues[0]]}));assert.throws(()=>validatePlayback({...playback(),position:NaN}));assert.throws(()=>validatePlayback({...playback(),position:100}));assert.throws(()=>validatePlayback({...playback(),secondary:id}));assert.throws(()=>validateStyle({size:100,color:'white',background:0,edge:'none'}));});
test('generated tracks must retain provenance',()=>assert.throws(()=>validateTrack({...track(),origin:'generated'})));
test('idempotent retry preserves exact request identity',()=>{const r=prepare(edit(undefined,scope,'video_resume',key,key,playback(),'v1'),'m1');assert.deepEqual(prepare(r,'m2').pending,r.pending);});
test('late acknowledgement cannot erase a newer local save',()=>{let r=prepare(edit(undefined,scope,'video_resume',key,key,playback(1),'v1'),'m1');const accepted=wire(r);r=edit(r,scope,'video_resume',key,key,playback(7),'v2');r=acknowledge(r,'m1',accepted);assert.equal(r.payload.position,7);assert.equal(r.revision,1);assert.equal(r.dirty,true);assert.equal(r.pending,undefined);});
test('wrong acknowledgement is rejected',()=>{const r=prepare(edit(undefined,scope,'video_resume',key,key,playback(),'v1'),'m1');assert.throws(()=>acknowledge(r,'m1',{...wire(r),book_key:'content:'+'b'.repeat(64)}));});
test('feed recovers a lost acknowledgement without losing newer edits',()=>{let r=prepare(edit(undefined,scope,'video_resume',key,key,playback(1),'v1'),'m1');const accepted=wire(r);r=edit(r,scope,'video_resume',key,key,playback(8),'v2');r=ingest(r,scope,accepted);assert.equal(r.payload.position,8);assert.equal(r.revision,1);assert.equal(r.dirty,true);});
test('concurrent remote edit remains a visible conflict',()=>{let r=edit(undefined,scope,'video_resume',key,key,playback(4),'v1');r=ingest(r,scope,wire(r,1,playback(9)));assert.equal(r.payload.position,4);assert.equal(r.conflict.payload.position,9);assert.equal(resolve(r,'remote').payload.position,9);assert.equal(resolve(r,'local').dirty,true);});
test('stale remote revision cannot regress state',()=>{const r=ingest(undefined,scope,{kind:'video_resume',entity_id:key,book_key:key,revision:4,payload:playback(9),deleted:false});assert.equal(ingest(r,scope,wire(r,2,playback(1))).payload.position,9);});
test('chunk manifests publish only when every page verifies',()=>{const t=track();t.cues=Array.from({length:501},(_,i)=>({id:String(i),start:i,end:i+.5,text:'text'}));const pieces=splitTrack(t),rows=pieces.map((p,i)=>edit(undefined,scope,p.kind,p.id,p.key,p.payload,`v${i}`));assert.equal(pieces.length,4);const manifest=rows.at(-1);assert.equal(assembleTrack(manifest,rows).cues.length,501);assert.equal(assembleTrack(manifest,rows.slice(1)),undefined);const corrupted=structuredClone(rows);corrupted[0].payload.cues[0].text='edited';assert.equal(assembleTrack(manifest,corrupted),undefined);});
test('partial transcripts cannot masquerade as complete tracks',()=>assert.throws(()=>splitTrack({...track(),complete:false})));
test('remote deletion shape must be consistent',()=>assert.throws(()=>remote({kind:'video_resume',entity_id:key,book_key:key,revision:1,payload:playback(),deleted:true})));
test('windows are bounded, cover the whole input and keep speaker IDs local',()=>{const windows=planWindows(125);assert.deepEqual(windows.map(w=>[w.start,w.end]),[[0,62],[58,122],[118,125]]);assert.ok(windows.every(w=>w.end-w.start<=64));const result=ownedCues([{id:'a',start:3,end:4,text:'x',speaker:'S01'}],windows[1]);assert.equal(result[0].speaker,'w1/S01');});
test('MOSS malformed/truncated/out-of-range output is rejected',()=>{assert.equal(parseMoss('[0.5][S01]こんにちは[1.5]',2).length,1);for(const raw of ['junk','[0][S01]missing end','[0][S01]bad[100]'])assert.throws(()=>parseMoss(raw,2));assert.deepEqual(parseMoss('',2),[]);});
test('bounded media reads reject overflows and negative ranges',()=>{for(const args of [[-1,2,10],[0,11,10],[0,0,10],[0,5*1024*1024,9*1024*1024]])assert.throws(()=>assertRange(...args));});
test('bounded response cancels an oversized body',async()=>{let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(10));},cancel(){cancelled=true;}});await assert.rejects(boundedResponse(new Response(stream),5,new AbortController().signal));assert.equal(cancelled,true);});
for(const mode of ['valid','wrong-hash','short','oversized','cancelled'])test(`model download ${mode} is transactional`,async()=>{const bytes=new TextEncoder().encode('GGUFtest model payload'),expected={bytes:bytes.length,sha256:digestText('GGUFtest model payload')},controller=new AbortController();let closed=false,aborted=false;const target={async write(){if(mode==='cancelled')controller.abort();},async close(){closed=true;},async abort(){aborted=true;}};const body=mode==='short'?bytes.slice(0,-1):mode==='oversized'?new Uint8Array([...bytes,0]):bytes;if(mode==='wrong-hash')expected.sha256='0'.repeat(64);const result=downloadVerified(new Response(body),target,expected,controller.signal);if(mode==='valid'){await result;assert.equal(closed,true);assert.equal(aborted,false);}else{await assert.rejects(result);assert.equal(closed,false);assert.equal(aborted,true);}});
test('real generated MP4 embedded captions are extracted without decoding video',{skip:!process.env.MEDIA_FIXTURE},async()=>{const dir=process.env.MEDIA_FIXTURE,bytes=await fs.readFile(dir+'/embedded.mp4'),file=new File([bytes],'embedded.mp4');const result=await discoverEmbedded(localSource(file),new AbortController().signal);assert.equal(result.state,'complete',result.warnings.join('; '));assert.equal(result.tracks.length,1);assert.equal(result.tracks[0].language,'en');assert.equal(result.tracks[0].cues.length,3);assert.match(result.tracks[0].cues[1].text,/reading a book/);});
test('unsupported containers are not reported as no subtitles',async()=>{const source=localSource(new File(['x'],'video.mkv'));assert.equal((await discoverEmbedded(source,new AbortController().signal)).state,'unsupported');});

// Queue control uses explicit test doubles for the engine and persistence. These
// tests never count as speech-recognition, IndexedDB, or performance qualification.
import {TranscriptionQueue} from '../../.cache/media-test-build/queue.js';
class QueueStoreDouble {
  rows=new Map();tracks=[];
  async enqueueJob(scope,draft,guard=()=>{}) {
    // Control-plane double only. Actual atomic admission uses MediaStore tests.
    const jobs=await this.listLocal(scope,'jobs');guard();
    const old=jobs.find(j=>['queued','running'].includes(j.status)&&j.mediaKey===draft.mediaKey&&j.language===draft.language&&j.audioTrack===draft.audioTrack&&j.modelSha256===draft.modelSha256&&j.engineRevision===draft.engineRevision);
    if(old)return structuredClone(old);
    await this.putLocal(scope,'jobs',draft.id,draft);return structuredClone(draft);
  }

  k(scope,kind,id){return JSON.stringify([scope,kind,id]);}
  async local(scope,kind,id){return structuredClone(this.rows.get(this.k(scope,kind,id)));}
  async putLocal(scope,kind,id,value){this.rows.set(this.k(scope,kind,id),structuredClone(value));}
  async listLocal(scope,kind){return [...this.rows].filter(([key])=>{const p=JSON.parse(key);return p[0]===scope&&p[1]===kind;}).map(([,v])=>structuredClone(v));}
  async updateLocal(scope,kind,id,fn){const key=this.k(scope,kind,id),old=structuredClone(this.rows.get(key)),next=fn(old);if(next!==old){if(next===undefined)this.rows.delete(key);else this.rows.set(key,structuredClone(next));}return structuredClone(next);}
  async saveTrack(scope,t,completion){validateTrack(t);if(completion){const key=this.k(scope,'jobs',t.id),old=this.rows.get(key);assert.equal(old.ownerId,completion.ownerId);assert.equal(old.cancelRequested,false);this.rows.set(key,structuredClone(completion.job));}this.tracks.push(structuredClone(t));}
}
const eventually=async(predicate)=>{for(let i=0;i<500;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,2));}throw Error('Condition did not settle');};
test('queue never initializes an engine before explicit enqueue',async()=>{let prepares=0;const store=new QueueStoreDouble(),engine={async prepare(){prepares++},async transcribe(){return '[0][S01]First.[1][1][S01]Second.[2]'},dispose(){}};const queue=new TranscriptionQueue(store,scope,engine,async()=>new Float32Array(48000).fill(.1));await new Promise(r=>setTimeout(r,5));assert.equal(prepares,0);const job=await queue.enqueue(key,'ja','1',3);await eventually(async()=> (await store.local(scope,'jobs',job.id)).status==='complete');assert.equal(prepares,1);assert.equal(store.tracks[0].cues.length,2);queue.dispose();});
test('cancelled windows resume from the last durable checkpoint',async()=>{let calls=0,secondStarted=false;const store=new QueueStoreDouble();const engine={async prepare(){},async transcribe(pcm,signal){calls++;if(calls===2){secondStarted=true;await new Promise((yes,no)=>signal.addEventListener('abort',()=>no(signal.reason),{once:true}));}return '[3][S01]A sentence.[4]';},dispose(){}};const queue=new TranscriptionQueue(store,scope,engine,async()=>new Float32Array(16000*5).fill(.1));const job=await queue.enqueue(key,'ja','1',120);await eventually(()=>secondStarted);await queue.cancel(job.id);await eventually(async()=> (await store.local(scope,'jobs',job.id)).status==='paused');assert.equal((await store.local(scope,'jobs',job.id)).nextWindow,1);assert.equal(store.tracks.length,0);await queue.resume(job.id);await eventually(async()=> (await store.local(scope,'jobs',job.id)).status==='complete');assert.equal(calls,3);assert.equal(store.tracks[0].cues.length,2);queue.dispose();});
test('queue failure keeps incomplete transcript unpublished',async()=>{const store=new QueueStoreDouble(),engine={async prepare(){},async transcribe(){return '[0][S01]truncated';},dispose(){}};const queue=new TranscriptionQueue(store,scope,engine,async()=>new Float32Array(16000).fill(.1));const job=await queue.enqueue(key,'ja','1',1);await eventually(async()=> (await store.local(scope,'jobs',job.id)).status==='failed');assert.equal(store.tracks.length,0);queue.dispose();});
test('exact silence skips recognition but quiet speech does not',async()=>{let called=0;const store=new QueueStoreDouble(),engine={async prepare(){},async transcribe(){called++;return '[0][S01]quiet[0.5]';},dispose(){}};let quiet=false;const queue=new TranscriptionQueue(store,scope,engine,async()=>new Float32Array(16000).fill(quiet?1e-9:0));let job=await queue.enqueue(key,'ja','1',1);await eventually(async()=> (await store.local(scope,'jobs',job.id)).status==='complete');assert.equal(called,0);quiet=true;job=await queue.enqueue(key,'ja','1',1);await eventually(async()=> (await store.local(scope,'jobs',job.id)).status==='complete');assert.equal(called,1);queue.dispose();});
test('storage failure during queue polling reaches the error callback, not an unhandled rejection',async()=>{let reported;const store=new QueueStoreDouble();let reads=0;store.listLocal=async()=>{if(++reads>1)throw Error('quota / storage failure');return [];};const queue=new TranscriptionQueue(store,scope,{async prepare(){},async transcribe(){return ''},dispose(){}},async()=>new Float32Array(),()=>{},e=>reported=e);await queue.enqueue(key,'ja','1',1);await eventually(()=>reported);assert.match(reported.message,/storage failure/);queue.dispose();});

import {MossClient} from '../../.cache/media-test-build/moss-client.js';
class WorkerDouble extends EventTarget {
  static failConstruction=false;
  constructor(){super();if(WorkerDouble.failConstruction)throw Error('Worker creation denied');}
  postMessage(message){if(message.type==='prepare')queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:message.id,type:'ready',value:null}})));}
  terminate(){}
}
async function withWorkerDouble(run){const original=globalThis.Worker;globalThis.Worker=WorkerDouble;try{await run();}finally{WorkerDouble.failConstruction=false;if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;}}
test('worker creation failure is retryable without a stuck busy flag (worker control double)',()=>withWorkerDouble(async()=>{const client=new MossClient('/moss',new URL('file:///worker.js'));WorkerDouble.failConstruction=true;await assert.rejects(client.prepare(new AbortController().signal,()=>{}),/creation denied/);WorkerDouble.failConstruction=false;await client.prepare(new AbortController().signal,()=>{});client.dispose();}));
test('disposing a worker settles its outstanding caller (worker control double)',()=>withWorkerDouble(async()=>{const client=new MossClient('/moss',new URL('file:///worker.js'));await client.prepare(new AbortController().signal,()=>{});const pending=client.transcribe(new Float32Array(160),new AbortController().signal);client.dispose();await assert.rejects(pending,{name:'AbortError'});}));
test('cancelling single-thread inference settles promptly (worker control double)',()=>withWorkerDouble(async()=>{const client=new MossClient('/moss',new URL('file:///worker.js'));await client.prepare(new AbortController().signal,()=>{});const abort=new AbortController(),pending=client.transcribe(new Float32Array(160),abort.signal);abort.abort();await assert.rejects(pending,{name:'AbortError'});client.dispose();}));

test('model cancellation preserves AbortError even if stream cancellation rejects', async()=>{
  const abort=new AbortController();let rolledBack=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('GGUF'));},cancel(){return Promise.reject(Error('transport teardown failed'));}}));
  const target={async write(){abort.abort();},async close(){assert.fail('cancelled download must not publish');},async abort(){rolledBack=true;}};
  await assert.rejects(downloadVerified(response,target,{bytes:20,sha256:'0'.repeat(64)},abort.signal),{name:'AbortError'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(rolledBack,true);
});

for (const cancelled of [false,true]) test('HTTP model failure closes response and preserves its cause even when cleanup fails: '+cancelled,async()=>{
 const signal=new AbortController();if(cancelled)signal.abort();let closed=false,rolledBack=false;
 const response=new Response(new ReadableStream({cancel(){closed=true;return Promise.reject(Error('network cleanup failed'))}}),{status:503});
 const target={async abort(){rolledBack=true;throw Error('writer cleanup failed')},async close(){assert.fail()},async write(){assert.fail()}};
 await assert.rejects(downloadVerified(response,target,{bytes:20,sha256:'0'.repeat(64)},signal.signal),cancelled?{name:'AbortError'}:/download failed \(503\)/);
 assert.equal(closed,true);assert.equal(rolledBack,true);
});
