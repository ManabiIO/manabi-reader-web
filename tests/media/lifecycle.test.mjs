/** Control-plane tests use explicit persistence/worker doubles, never ASR evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfileLifetime} from '../../.cache/media-test-build/profile-lifetime.js';
import {DeviceCheckpoints,deviceKey,validateDevicePlayback} from '../../.cache/media-test-build/device-checkpoint.js';
import {localSource,identify,streamedRange} from '../../.cache/media-test-build/sources.js';
import {MossClient} from '../../.cache/media-test-build/moss-client.js';
import {syncMedia} from '../../.cache/media-test-build/sync.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setTimeout(r,0));
function profile(offline=async()=>null){
 const mounted=[],calls=[],errors=[];
 const lifetime=new ProfileLifetime(offline,(scope,connection)=>{const workspace={scope,setConnection(c){calls.push([scope,c]);},async dispose(){calls.push([scope,'disposed']);}};mounted.push([scope,connection,workspace]);return workspace;},e=>errors.push(e));
 return {lifetime,mounted,calls,errors};
}
test('same-account reconnect replaces network authority without destroying playback',async()=>{
 const h=profile();await h.lifetime.update({status:'available',userId:'a',connection:'a1'});
 await h.lifetime.update({status:'loading',userId:null});
 await h.lifetime.update({status:'available',userId:'a',connection:'a2'});
 assert.equal(h.mounted.length,1);assert.deepEqual(h.calls.at(-1),['account:a','a2']);
 assert.ok(!h.calls.some(c=>c[1]==='disposed'));await h.lifetime.stop();
});
test('delayed offline lookup cannot mount after an account switch',async()=>{
 const d=deferred(),h=profile(()=>d.promise);
 const first=h.lifetime.update({status:'offline',userId:null});await tick();
 const second=h.lifetime.update({status:'available',userId:'b',connection:'b1'});d.resolve('a');await Promise.all([first,second]);
 assert.deepEqual(h.mounted.map(m=>m[0]),['account:b']);await h.lifetime.stop();
});
test('offline last-profile is display identity, never network authority',async()=>{
 const h=profile(async()=>'a');await h.lifetime.update({status:'offline',userId:null,connection:'must-not-use'});
 assert.equal(h.mounted[0][0],'account:a');assert.equal(h.mounted[0][1],undefined);await h.lifetime.stop();
});
test('account transition drains old workspace before mounting successor',async()=>{
 const h=profile(),d=deferred();await h.lifetime.update({status:'available',userId:'a'});
 h.mounted[0][2].dispose=()=>d.promise;
 const next=h.lifetime.update({status:'available',userId:'b'});await tick();assert.equal(h.mounted.length,1);
 d.resolve();await next;assert.equal(h.mounted[1][0],'account:b');await h.lifetime.stop();
});
test('shutdown during offline lookup cannot remount a workspace',async()=>{
 const d=deferred(),h=profile(()=>d.promise);h.lifetime.update({status:'offline',userId:null});await tick();const stop=h.lifetime.stop();d.resolve('a');await stop;assert.equal(h.mounted.length,0);
});
const snapshot=(position=2)=>({version:1,position,duration:20,rate:1,finished:false,updatedAt:10});
const deviceId='sampled-v1:'+'a'.repeat(64);
class LocalDouble {
 value;writes=[];
 async local(){return this.value;}
 async putLocal(scope,kind,id,value){this.writes.push({scope,kind,id,value:structuredClone(value)});this.value=structuredClone(value);}
}
test('provisional resume is only stored in the device-local namespace',async()=>{
 const store=new LocalDouble(),d=new DeviceCheckpoints(store,'account:a',deviceId);await d.save(snapshot());
 assert.equal(store.writes[0].kind,'device-playback');assert.equal(store.writes[0].id,deviceId);assert.equal('mediaKey' in store.writes[0].value,false);await d.close();
});
test('device checkpoint cannot overwrite an unread/corrupt saved record',async()=>{
 const store=new LocalDouble();store.value={version:99};const d=new DeviceCheckpoints(store,'guest',deviceId);
 await assert.rejects(d.save(snapshot()));assert.equal(store.writes.length,0);await d.close();
});
test('device checkpoint serializes immutable snapshots behind initial read',async()=>{
 const read=deferred(),store=new LocalDouble();store.local=()=>read.promise;
 const d=new DeviceCheckpoints(store,'guest',deviceId),first=snapshot(2),a=d.save(first);first.position=19;const b=d.save(snapshot(4));
 await tick();assert.equal(store.writes.length,0);read.resolve(undefined);await Promise.all([a,b]);assert.deepEqual(store.writes.map(w=>w.value.position),[2,4]);await d.close();
});
test('device close drains pending snapshots and rejects later saves',async()=>{
 const d=new DeviceCheckpoints(new LocalDouble(),'guest',deviceId);const saving=d.save(snapshot());await d.close();await saving;await assert.rejects(d.save(snapshot()),/closed/);
});
test('device checkpoint has a closed bounded schema',()=>{
 for(const value of [{...snapshot(),mediaKey:'content:abc'},{...snapshot(),position:21},{...snapshot(),position:NaN},{...snapshot(),rate:10},{...snapshot(),finished:1}])assert.throws(()=>validateDevicePlayback(value));
});
test('device sample is bounded and cannot masquerade as portable identity',async()=>{
 let reads=0,bytes=0;const source={name:'movie.mp4',size:10**10,version:'r1',async read(s,e){reads++;bytes+=e-s;return new Uint8Array(e-s);}};
 const k=await deviceKey(source,new AbortController().signal);assert.match(k,/^sampled-v1:[a-f0-9]{64}$/);assert.equal(reads,3);assert.equal(bytes,96*1024);
 assert.notEqual(k,await deviceKey({...source,version:'r2'},new AbortController().signal));
});
test('short identity/sample reads fail instead of creating a false content key',async()=>{
 const bad={name:'x.mp4',size:20,version:'x',async read(){return new Uint8Array(1);}};
 await assert.rejects(deviceKey(bad,new AbortController().signal),/Incomplete/);await assert.rejects(identify(bad,new AbortController().signal),/Incomplete/);
});
test('content identification rejects empty or nonintegral media sizes',async()=>{
 for(const size of [0,-1,NaN,1.5])await assert.rejects(identify({size},new AbortController().signal),/size/);
});
test('stream cancellation aborts the outstanding source range',async()=>{
 const started=deferred();let aborted=false;const source={size:100,read(s,e,signal){started.resolve();return new Promise((yes,no)=>signal.addEventListener('abort',()=>{aborted=true;no(signal.reason)},{once:true}));}};
 const reader=streamedRange(source,0,100,new AbortController().signal).getReader(),pending=reader.read();await started.promise;await reader.cancel();await pending;await tick();assert.equal(aborted,true);
});
test('stream rejects incomplete range bodies and invalid extents',async()=>{
 const source={size:100,async read(){return new Uint8Array(1)}};
 assert.throws(()=>streamedRange(source,0,101,new AbortController().signal));await assert.rejects(streamedRange(source,0,100,new AbortController().signal).getReader().read(),/Incomplete/);
});
class WorkerDouble extends EventTarget {
 static latest;static crashOnSend=false;
 constructor(){super();WorkerDouble.latest=this;}
 postMessage(data){if(WorkerDouble.crashOnSend)throw Error('transport broken');if(data.type==='prepare')queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:data.id,type:'ready',value:null}})));}
 terminate(){}
}
async function workerTest(body){const original=globalThis.Worker;globalThis.Worker=WorkerDouble;try{await body()}finally{WorkerDouble.crashOnSend=false;if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;}}
for(const [kind,message] of [['error',/worker stopped/],['messageerror',/unreadable/]])test(`worker ${kind} preserves its diagnostic and permits retry`,()=>workerTest(async()=>{
 const client=new MossClient('/moss',new URL('file:///test-worker.js'));await client.prepare(new AbortController().signal,()=>{});
 const pending=client.transcribe(new Float32Array(10),new AbortController().signal);WorkerDouble.latest.dispatchEvent(new Event(kind));await assert.rejects(pending,message);
 await client.prepare(new AbortController().signal,()=>{});client.dispose();
}));
test('postMessage failure and disposal cannot strand a busy worker',()=>workerTest(async()=>{
 const client=new MossClient('/moss',new URL('file:///test-worker.js'));WorkerDouble.crashOnSend=true;await assert.rejects(client.prepare(new AbortController().signal,()=>{}),/transport broken/);assert.doesNotThrow(()=>client.dispose());WorkerDouble.crashOnSend=false;await client.prepare(new AbortController().signal,()=>{});client.dispose();
}));
test('already cancelled preparation does not succeed merely because model is warm',()=>workerTest(async()=>{
 const client=new MossClient('/moss',new URL('file:///test-worker.js'));await client.prepare(new AbortController().signal,()=>{});const c=new AbortController();c.abort();await assert.rejects(client.prepare(c.signal,()=>{}),{name:'AbortError'});client.dispose();
}));
function syncHarness(feed,cursor=0){const puts=[],store={async local(){return cursor},async records(){return []},async putLocal(...args){puts.push(args)},async accept(){}};
 const transport={userId:'a',isCurrent:()=>true,async request(path){assert.match(path,/limit=3/);return feed;}};return {store,transport,puts};}
test('media sync pages use the bounded shared-feed envelope',async()=>{const h=syncHarness({items:[],next_cursor:0,has_more:false});await syncMedia(h.store,h.transport,new AbortController().signal);assert.equal(h.puts.length,1);});
for(const feed of [null,{items:[null],next_cursor:1,has_more:false},{items:Array(4).fill({}),next_cursor:4,has_more:false},{items:[],next_cursor:0,has_more:true}])test('malformed or oversized sync feed cannot advance its cursor '+JSON.stringify(feed),async()=>{
 const h=syncHarness(feed);await assert.rejects(syncMedia(h.store,h.transport,new AbortController().signal));assert.equal(h.puts.length,0);
});
test('corrupt local sync cursor is not sent to the account endpoint',async()=>{const h=syncHarness({},-1);h.transport.request=()=>{throw Error('must not request')};await assert.rejects(syncMedia(h.store,h.transport,new AbortController().signal),/saved sync cursor/);});
test('idle worker crash invalidates warm state instead of hanging the next transcription',()=>workerTest(async()=>{
 const client=new MossClient('/moss',new URL('file:///test-worker.js'));await client.prepare(new AbortController().signal,()=>{});
 const old=WorkerDouble.latest;old.dispatchEvent(new Event('error'));
 await assert.rejects(client.transcribe(new Float32Array(10),new AbortController().signal),/Prepare/);
 await client.prepare(new AbortController().signal,()=>{});assert.notEqual(WorkerDouble.latest,old);
 old.dispatchEvent(new Event('error')); // A retired worker cannot invalidate its replacement.
 const pending=client.transcribe(new Float32Array(10),new AbortController().signal);client.dispose();await assert.rejects(pending,{name:'AbortError'});
}));
