/** Boundary contract tests use explicit transport/decoder doubles, not live provider evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionsFrom, listingFrom, listCloudFolder, cloudRequest } from '../../.cache/media-test-build/cloud-listing.js';
import { MediaPipeline } from '../../.cache/media-test-build/pipeline.js';
const connection = {id:'a0000000-0000-4000-8000-000000000001',provider:'dropbox',roots:['selected'],needs_reconnect:false};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const entry=(id)=>({id,name:`${id}.mp4`,kind:'file',size:100});
const signal=()=>new AbortController().signal;

test('cloud connections use the exact existing backend items envelope',()=>{
 assert.deepEqual(connectionsFrom({items:[connection]}),[connection]);
 for(const value of [[connection],{connections:[connection]},null,{items:[null]},{items:[connection,connection]}])assert.throws(()=>connectionsFrom(value));
});
test('connection validation rejects malformed IDs, roots, and reconnect state',()=>{
 for(const patch of [{id:'../escape'},{roots:['x','x']},{roots:[0]},{provider:'../google'},{needs_reconnect:1}])assert.throws(()=>connectionsFrom({items:[{...connection,...patch}]}));
});
test('folder entry validation rejects invalid sizes, types and control characters',()=>{
 for(const patch of [{id:''},{name:'bad\nname'},{size:NaN},{size:-1},{kind:'symlink'}])assert.throws(()=>listingFrom({items:[{...entry('one'),...patch}],cursor:''}));
 assert.deepEqual(listingFrom({items:[entry('one')],cursor:''}).items,[entry('one')]);
});
test('folder pagination checks all cursor cycles including empty filtered pages',async()=>{
 let calls=0;const transport={userId:'u',isCurrent:()=>true,async request(){return {items:[],cursor:['a','b','a'][calls++]}}};
 await assert.rejects(listCloudFolder(transport,connection,'selected','selected',signal()),/repeated a cursor/);assert.equal(calls,3);
});
test('folder pagination cannot run forever on distinct empty cursors',async()=>{
 let calls=0;const transport={userId:'u',isCurrent:()=>true,async request(){return {items:[],cursor:'page-'+ ++calls}}};
 await assert.rejects(listCloudFolder(transport,connection,'selected','selected',signal()),/page limit/);assert.equal(calls,200);
});
test('folder pages reject repeated provider IDs instead of importing twice',async()=>{
 let calls=0;const transport={userId:'u',isCurrent:()=>true,async request(){return {items:[entry('one')],cursor:calls++?'':'next'}}};
 await assert.rejects(listCloudFolder(transport,connection,'selected','selected',signal()),/changed while listing/);
});
test('only a currently selected root is admitted for cloud discovery',async()=>{
 let calls=0;const transport={userId:'u',isCurrent:()=>true,async request(){calls++}};
 await assert.rejects(listCloudFolder(transport,connection,'other','selected',signal()));
 await assert.rejects(listCloudFolder(transport,{...connection,needs_reconnect:true},'selected','selected',signal()));assert.equal(calls,0);
});
test('late cloud responses lose authority on account change',async()=>{
 const d=deferred();let current=true;const transport={userId:'u',isCurrent:()=>current,request:()=>d.promise};
 const request=cloudRequest(transport,'connections/',signal());current=false;d.resolve({items:[]});await assert.rejects(request,/Account changed/);
});
test('late cloud responses are discarded after closing the picker',async()=>{
 const d=deferred(),controller=new AbortController();const request=cloudRequest({userId:'u',isCurrent:()=>true,request:()=>d.promise},'connections/',controller.signal);controller.abort();d.resolve({items:[]});await assert.rejects(request,{name:'AbortError'});
});
test('cloud pagination retains selected root and opaque parent',async()=>{
 let count=0;const transport={userId:'u',isCurrent:()=>true,async request(path,options){const url=new URL(path,'https://manabi.io');assert.equal(url.searchParams.get('parent'),'id:opaque/parent');assert.equal(url.searchParams.get('root'),'selected');assert.equal(options.userId,'u');return {items:[entry('item'+count)],cursor:count++?'':'next'}}};
 assert.equal((await listCloudFolder(transport,connection,'selected','id:opaque/parent',signal())).length,2);
});
function pipeline(input,outer){let disposed=0;const instance=new MediaPipeline({create(){return {...input,dispose(){disposed++;input.dispose?.()}}}},{},outer);return {instance,disposed:()=>disposed};}
test('decode cancellation covers unresolved track discovery',async()=>{
 const d=deferred(),c=new AbortController(),h=pipeline({getAudioTracks:()=>d.promise,dispose(){d.reject(new DOMException('Aborted','AbortError'))}});
 const job=h.instance.decode(1,0,1,c.signal);c.abort();await assert.rejects(job,{name:'AbortError'});assert.equal(h.disposed(),1);h.instance.dispose();assert.equal(h.disposed(),1);
});
test('pipeline parent cancellation covers metadata and disposes only once',async()=>{
 const d=deferred(),c=new AbortController(),h=pipeline({computeDuration:()=>d.promise,getPrimaryVideoTrack:async()=>null,dispose(){d.reject(new DOMException('Aborted','AbortError'))}},c.signal);
 const job=h.instance.metadata();c.abort();await assert.rejects(job);h.instance.dispose();assert.equal(h.disposed(),1);
});
test('decode cancellation covers slow codec capability checks',async()=>{
 const d=deferred(),c=new AbortController(),h=pipeline({getAudioTracks:async()=>[{id:1,canDecode:()=>d.promise}]});
 const job=h.instance.decode(1,0,1,c.signal);await new Promise(r=>setTimeout(r,0));c.abort();d.resolve(true);await assert.rejects(job,{name:'AbortError'});assert.equal(h.disposed(),1);
});
test('invalid decode ranges fail before metadata or audio allocation',async()=>{
 const h=pipeline({getAudioTracks(){throw Error('must not request')}});
 for(const [start,end] of [[NaN,1],[0,Infinity],[-1,1],[0,65],[2,1]])await assert.rejects(h.instance.decode(1,start,end,signal()),/bounded windows/);h.instance.dispose();
});
test('already cancelled pipeline construction performs no source reads',()=>{
 const c=new AbortController();c.abort();let created=false;assert.throws(()=>new MediaPipeline({create(){created=true}},{},c.signal),{name:'AbortError'});assert.equal(created,false);
});
test('invalid video metadata fails before it is saved as library state',async()=>{
 const h=pipeline({computeDuration:async()=>Infinity,getPrimaryVideoTrack:async()=>null});await assert.rejects(h.instance.metadata(),/Invalid video metadata/);h.instance.dispose();
});

import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
// This helper retains these tests' deliberately delayed persistence double.
// Real transaction atomicity is covered separately by MediaStore boundary tests.
function queueDoubleTransactions(store){
 store.enqueueJob=async(scope,draft,guard=()=>{})=>{
  const rows=await store.listLocal(scope,'jobs');guard();
  const old=rows.find(j=>['queued','running'].includes(j.status)&&j.mediaKey===draft.mediaKey&&j.language===draft.language&&j.audioTrack===draft.audioTrack&&j.modelSha256===draft.modelSha256&&j.engineRevision===draft.engineRevision);
  if(old)return structuredClone(old);await store.putLocal(scope,'jobs',draft.id,draft);return structuredClone(draft);
 };
 store.updateLocal=async(s,k,id,fn)=>{const old=await store.local(s,k,id),next=fn(old);if(next!==old)await store.putLocal(s,k,id,next);return structuredClone(next);};return store;
}
const key='content:'+'a'.repeat(64);
const job = () => ({version:1,id:'b0000000-0000-4000-8000-000000000001',mediaKey:key,language:'en',audioTrack:'1',duration:1,status:'queued',nextWindow:0,cues:[],modelSha256:MOSS.sha256,engineRevision:MOSS.engineRevision,createdAt:1});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('closing while the queue reads pending jobs never starts an orphan worker',async()=>{
 const d=deferred();let reads=0,prepared=0;const jobs=[];
 const store={async listLocal(){return ++reads===1?[]:d.promise},async putLocal(s,k,id,v){jobs.push(structuredClone(v))}};
 const queue=new TranscriptionQueue(queueDoubleTransactions(store),'account:a',{async prepare(){prepared++},dispose(){}},async()=>new Float32Array(1));
 await queue.enqueue(key,'en','1',1);const closing=queue.dispose();d.resolve([job()]);await closing;assert.equal(prepared,0);assert.equal(jobs.length,1);
});
test('closing before a delayed enqueue check prevents the new durable job',async()=>{
 const d=deferred();let writes=0;const queue=new TranscriptionQueue(queueDoubleTransactions({listLocal:()=>d.promise,async putLocal(){writes++}}),'guest',{dispose(){}},async()=>new Float32Array(1));
 const adding=queue.enqueue(key,'en','1',1);await queue.dispose();d.resolve([]);await assert.rejects(adding,/closed/);assert.equal(writes,0);
});
test('queue disposal drains the active paused checkpoint before storage closes',async()=>{
 const prepared=deferred(),persist=deferred();let latest;let hold=false;
 const store={async listLocal(){return latest?[structuredClone(latest)]:[]},async local(){return structuredClone(latest)},async putLocal(s,k,id,v){latest=structuredClone(v);if(hold&&v.status==='paused')await persist.promise;}};
 const engine={prepare(signal){prepared.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},dispose(){}};
 const queue=new TranscriptionQueue(queueDoubleTransactions(store),'guest',engine,async()=>new Float32Array(1));await queue.enqueue(key,'en','1',1);await prepared.promise;hold=true;let drained=false;const closing=queue.dispose().then(()=>{drained=true});await tick();assert.equal(latest.status,'paused');assert.equal(drained,false);persist.resolve();await closing;assert.equal(drained,true);
});
test('a canceled lock waiter cannot overwrite another tab completed job',async()=>{
 const old=Object.getOwnPropertyDescriptor(navigator,'locks'),wait=deferred();let latest,reads=0,writes=0;
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request(_name,{signal}){wait.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}}});
 try {
  const store={async listLocal(){reads++;return latest?[structuredClone(latest)]:[]},async local(){return latest},async putLocal(s,k,id,v){writes++;latest=structuredClone(v)}};
  const queue=new TranscriptionQueue(queueDoubleTransactions(store),'guest',{dispose(){}},async()=>new Float32Array(1));await queue.enqueue(key,'en','1',1);await wait.promise;latest.status='complete';await queue.dispose();assert.equal(latest.status,'complete');assert.equal(writes,1);
 } finally {if(old)Object.defineProperty(navigator,'locks',old);else delete navigator.locks;}
});
test('restricted IndexedDB getter fails lazily and does not break construction',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,get(){throw new DOMException('Denied','SecurityError')}});
 try {const store=new MediaStore();await assert.rejects(store.local('guest','x','x'),/unavailable/);await store.close();}
 finally {if(old)Object.defineProperty(globalThis,'indexedDB',old);else delete globalThis.indexedDB;}
});
test('closed media store cannot be reopened by a late asynchronous continuation',async()=>{
 let opened=0;const store=new MediaStore({open(){opened++;throw Error('must not open')}});await store.close();await assert.rejects(store.records('guest'),/closed/);assert.equal(opened,0);
});

import { missingTranscriptDecision } from '../../.cache/media-test-build/discovery-policy.js';
test('bulk missing-transcript policy never treats unsupported inspection as absence',()=>{
 assert.equal(missingTranscriptDecision([],'ja','unsupported'),'inspect-manually');
 assert.equal(missingTranscriptDecision([],'ja','complete'),'missing');
});
test('an existing complete target-language caption suppresses bulk generation',()=>{
 assert.equal(missingTranscriptDecision([{language:'ja-JP',complete:true,forced:false}],'ja','unsupported'),'present');
});
test('forced-only and translated captions do not count as full original captions',()=>{
 assert.equal(missingTranscriptDecision([{language:'ja',complete:true,forced:true},{language:'en',complete:true,forced:false}],'ja','complete'),'missing');
});

import { validateCloudLocator, cloudInfoPath } from '../../.cache/media-test-build/cloud-locator.js';
import { cloudSource } from '../../.cache/media-test-build/sources.js';
const locator={connectionId:connection.id,root:'root / opaque',id:'id:opaque'};
test('device cloud locators contain no credential or download capability fields',()=>{
 assert.deepEqual(validateCloudLocator(locator),locator);
 for(const extra of [{url:'https://capability'},{token:'secret'},{version:'digest'}])assert.throws(()=>validateCloudLocator({...locator,...extra}));
 assert.equal(new URL(cloudInfoPath(locator),'https://manabi.io').searchParams.get('root'),locator.root);
});
test('cloud locators cannot alter the selected-root API path',()=>{
 for(const value of [null,{...locator,connectionId:'../../escape'},{...locator,root:''},{...locator,id:'\nheader'}])assert.throws(()=>cloudInfoPath(value));
});
test('cloud source validates owner, revision, exact endpoint and immutable metadata',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://manabi.io'}});
 try {
  const version='b'.repeat(64),url=`/api/reader-web/connections/${connection.id}/media/?`+new URLSearchParams({root:locator.root,id:locator.id,user:'u',version});
  const manifest={name:'video.mp4',size:10,version,url};const source=cloudSource(manifest,'u',()=>true);manifest.size=999;manifest.name='changed';assert.equal(source.size,10);assert.equal(source.name,'video.mp4');assert.deepEqual(source.cloud,locator);
  for(const bad of [url+'&user=u',url.replace('user=u','user=v'),url.replace('/media/','/file/'),url+'#fragment','https://other.invalid'+url])assert.throws(()=>cloudSource({...manifest,size:10,url:bad},'u',()=>true));
  assert.throws(()=>cloudSource({...manifest,size:10,version:'c'.repeat(64),url},'u',()=>true));
 } finally {if(previous)Object.defineProperty(globalThis,'location',previous);else delete globalThis.location;}
});


import { readFileSync } from 'node:fs';
const sourceText = (path) => readFileSync(new URL('../../' + path, import.meta.url),'utf8');
test('Reader CSP permits only WASM compilation, not JavaScript eval',()=>{
 const source=sourceText('apps/web/svelte.config.js');
 const script=source.match(/'script-src': \[([^\]]+)\]/)?.[1];
 assert.ok(script); assert.match(script, /'wasm-unsafe-eval'/);
 assert.doesNotMatch(script, /'unsafe-eval'|'unsafe-inline'/);
});
test('CPU runtime recipe disables dynamic JavaScript and pins the ggml submodule',()=>{
 const source=sourceText('tools/media/build-moss.py');
 assert.match(source, /-sDYNAMIC_EXECUTION=0/); assert.match(source,/ggml_head != GGML_PIN/);
 assert.match(source,/LICENSE-MOSS.txt/); assert.match(source,/LICENSE-GGML.txt/);
});
