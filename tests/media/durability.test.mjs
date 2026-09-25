import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaStore, ImmutableTrackConflict} from '../../.cache/media-test-build/store.js';
import {edit,prepare,acknowledge,ingest,remote} from '../../.cache/media-test-build/replica.js';
import {TransactionFactory,RangeDouble} from './transaction-double.mjs';
const scope='account:a', key='content:'+'a'.repeat(64), id='11111111-1111-4111-8111-111111111111';
const info=(title='Original')=>({version:1,title,duration:10,width:100,height:100,addedAt:1});
const track=()=>({version:1,id,mediaKey:key,label:'Japanese',language:'ja',kind:'transcription',origin:'sidecar',complete:true,forced:false,createdAt:1,
  cues:Array.from({length:401},(_,i)=>({id:'c'+i,start:i,end:i+.5,text:'Caption '+i}))});
const wire=(revision,payload)=>({kind:'video_info',entity_id:key,book_key:key,revision,payload,deleted:payload===null});
function pending(){return prepare(edit(undefined,scope,'video_info',key,key,info('Local'),'v1'),'mutation1');}
async function harness(fn){
  const old=globalThis.IDBKeyRange;globalThis.IDBKeyRange=RangeDouble;
  const factory=new TransactionFactory(),store=new MediaStore(factory,'media-durability-test');
  try {await fn(store,factory);}finally{await store.close();if(old===undefined)delete globalThis.IDBKeyRange;else globalThis.IDBKeyRange=old;}
}
test('late acknowledgement cannot erase a newer already-consumed feed revision',()=>{
  const r=ingest(pending(),scope,wire(2,info('Remote successor')));
  assert.equal(r.conflict.revision,2);
  const result=acknowledge(r,'mutation1',wire(1,info('Local')));
  assert.equal(result.revision,2);assert.equal(result.payload.title,'Remote successor');assert.equal(result.dirty,false);
});
test('late acknowledgement keeps a newer local edit and successor conflict together',()=>{
  const local=edit(pending(),scope,'video_info',key,key,info('New edit'),'v2');
  const r=ingest(local,scope,wire(3,info('Other tab')));
  const result=acknowledge(r,'mutation1',wire(1,info('Local')));
  assert.equal(result.payload.title,'New edit');assert.equal(result.conflict.revision,3);assert.equal(result.dirty,true);assert.equal(result.pending,undefined);
});
test('older conflict evidence never replaces a newer observed revision',()=>{
  const r=ingest(pending(),scope,wire(3,info('Newer')));
  assert.equal(ingest(r,scope,wire(2,info('Older'))),r);
});
test('ingestion and editing cannot move a record between media or accounts',()=>{
  assert.throws(()=>ingest(pending(),'account:b',wire(2,info())));
  assert.throws(()=>edit(pending(),'account:b','video_info',key,key,info(),'v2'));
});
test('remote record is snapshotted and rejects coercible non-string identities',()=>{
  const source=wire(1,info()); const result=remote(source);source.payload.title='Mutated';assert.equal(result.payload.title,'Original');
  assert.throws(()=>remote({...wire(1,info()),entity_id:{toString:()=>key}}));
});
test('local writes snapshot their caller before asynchronous database opening',()=>harness(async(store,factory)=>{
  factory.holdOpen=true;const value={position:1};const write=store.putLocal(scope,'device','x',value);value.position=9;factory.releaseOpen();await write;
  assert.deepEqual(await store.local(scope,'device','x'),{position:1});
}));
test('replicated writes snapshot payload before asynchronous database opening',()=>harness(async(store,factory)=>{
  factory.holdOpen=true;const value=info();const write=store.edit(scope,'video_info',key,key,value);value.title='Mutated';factory.releaseOpen();await write;
  assert.equal((await store.get(scope,'video_info',key)).payload.title,'Original');
}));
test('throwing subscribers cannot strand a committed transaction promise',()=>harness(async(store)=>{
  store.subscribe(()=>{throw Error('broken view')});
  let timer;try{
    await Promise.race([store.putLocal(scope,'device','x',{n:1}),new Promise((_,no)=>{timer=setTimeout(()=>no(Error('write hung')),300)})]);
  }finally{clearTimeout(timer)}
  assert.deepEqual(await store.local(scope,'device','x'),{n:1});
}));
test('close drains admitted writes waiting for database open and rejects new admissions',()=>harness(async(store,factory)=>{
  factory.holdOpen=true;const write=store.putLocal(scope,'device','x',1),closing=store.close();
  await assert.rejects(store.putLocal(scope,'device','y',2),/closed/);
  factory.releaseOpen();await write;await closing;assert.equal(factory.values('local').get(JSON.stringify([scope,'device','x'])),1);
  assert.ok(factory.connections.every(c=>c.closed));
}));
test('subtitle publication is one atomic transaction even on mid-page quota failure',()=>harness(async(store,factory)=>{
  factory.failPutNumber=2;await assert.rejects(store.saveTrack(scope,track()),{name:'QuotaExceededError'});
  assert.equal(factory.values().size,0);factory.failPutNumber=undefined;
  await store.saveTrack(scope,track());assert.equal((await store.tracks(scope,key))[0].cues.length,401);
}));
test('publication retries are idempotent but another payload cannot reuse a track identity',()=>harness(async(store)=>{
  await store.saveTrack(scope,track());const before=await store.records(scope);await store.saveTrack(scope,track());assert.deepEqual(await store.records(scope),before);
  const changed=track();changed.cues[250].text='Changed';await assert.rejects(store.saveTrack(scope,changed),ImmutableTrackConflict);
  assert.deepEqual(await store.records(scope),before);
}));
test('an old subtitle publication cannot resurrect a user-removed track',()=>harness(async(store)=>{
  await store.saveTrack(scope,track());await store.edit(scope,'video_track',id,key,null);
  await assert.rejects(store.saveTrack(scope,track()),ImmutableTrackConflict);assert.equal((await store.tracks(scope,key)).length,0);
}));
test('scope and kind queries do not load other accounts or caption pages',()=>harness(async(store)=>{
  await store.edit(scope,'video_info',key,key,info());await store.edit('account:ab','video_info',key,key,info('Other'));
  await store.saveTrack(scope,track());await store.putLocal(scope,'device','x',1);await store.putLocal(scope,'device-other','y',2);await store.putLocal('account:ab','device','z',3);
  assert.equal((await store.records(scope,'video_info')).length,1);assert.equal((await store.records(scope,'video_info'))[0].payload.title,'Original');
  assert.deepEqual(await store.listLocal(scope,'device'),[1]);
}));
test('native unexpected database closure retires only that connection and permits a new one',()=>harness(async(store,factory)=>{
  await store.putLocal(scope,'device','x',1);factory.connections[0].onclose();await store.putLocal(scope,'device','y',2);
  assert.equal(factory.connections.length,2);assert.deepEqual(await store.listLocal(scope,'device'),[1,2]);
}));
import {syncMedia} from '../../.cache/media-test-build/sync.js';
import {validateStyle,validateTrack} from '../../.cache/media-test-build/contracts.js';
test('late conflict response cannot clear a different pending mutation',()=>harness(async(store)=>{
 await store.edit(scope,'video_info',key,key,info());const first=await store.prepare(scope,'video_info',key);
 await store.ack(scope,'video_info',key,first.pending.request.mutation_id,wire(1,info()));
 await store.edit(scope,'video_info',key,key,info('Second'));const second=await store.prepare(scope,'video_info',key);
 await store.conflict(scope,'video_info',key,wire(2,info('Remote')),first.pending.request.mutation_id);
 assert.equal((await store.get(scope,'video_info',key)).pending.request.mutation_id,second.pending.request.mutation_id);
}));
test('feed cursor cannot advance past the last actually delivered record',()=>harness(async(store)=>{
 for(const feed of [{items:[],next_cursor:9,has_more:false},{items:[{sequence:1,kind:'resume'}],next_cursor:2,has_more:false}]){
  await assert.rejects(syncMedia(store,{userId:'a',isCurrent:()=>true,async request(){return feed}},new AbortController().signal),/skips unseen/);
  assert.equal(await store.local(scope,'sync','cursor'),undefined);
 }
}));
test('an edit during upload is reported as locally saved and still pending, never fully synced',()=>harness(async(store)=>{
 await store.edit(scope,'video_info',key,key,info());const statuses=[];
 await syncMedia(store,{userId:'a',isCurrent:()=>true,async request(path,options){
  if(path.startsWith('personal/changes/'))return {items:[],next_cursor:0,has_more:false};
  await store.edit(scope,'video_info',key,key,info('Newer'));
  return {accepted:true,mutation_id:options.value.mutation_id,record:wire(1,info())};
 }},new AbortController().signal,s=>statuses.push(s));
 assert.equal(statuses.at(-1).state,'pending');assert.equal((await store.get(scope,'video_info',key)).payload.title,'Newer');
}));
test('track/style enum fields reject arrays and objects rather than coercing them',()=>{
 assert.throws(()=>validateTrack({...track(),kind:['transcription']}));assert.throws(()=>validateTrack({...track(),origin:['sidecar']}));
 assert.throws(()=>validateStyle({size:1,color:['white'],background:.5,edge:'shadow'}));
 assert.throws(()=>validateStyle({size:1,color:'white',background:.5,edge:['shadow']}));
});
