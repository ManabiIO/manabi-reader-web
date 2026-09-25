import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {identityPreprocessor,normalizeChapterResult,sha256} from '../../apps/web/src/lib/preprocessing/contracts.mjs';
import {BookPreprocessingSession,GenerationChanged} from '../../apps/web/src/lib/preprocessing/session.mjs';
import {ChapterOpeningController} from '../../apps/web/src/lib/preprocessing/presentation.mjs';
import {installationPlan,processingSetFingerprint,DictionaryInstallationCoordinator} from '../../apps/web/src/lib/dictionary-setup/installation.mjs';
import {fetchVerifiedDictionaryArchive} from '../../apps/web/src/lib/dictionary-setup/archive-fetch.mjs';
const chapter={id:'c',baseURL:'https://reader.test/c',html:'<p>猫&amp;犬</p>'};
function session(provider=null,extra={}) {return new BookPreprocessingSession({provider,bookKey:'book',contextKey:'ctx',resourceVersion:'r',chapters:[chapter],...extra});}
const active=overrides=>({...identityPreprocessor,id:'fixture',fingerprint:async()=> 'f1',...overrides});
const output=input=>({protocol:1,fingerprint:input.fingerprint,html:input.html,sidecar:{fixture:true},vocabulary:[]});
test('identity path returns original bytes, no mode, cache access, runtime mount, or background work',async()=>{
 let cacheCalls=0,mounted=0,committed=0;
 const s=session({...identityPreprocessor,mount:()=>{mounted++;return ()=>{};}},{cache:{get:()=>cacheCalls++,put:()=>cacheCalls++}});
 const c=new ChapterOpeningController({session:s,stage:async result=>{assert.equal(result.html,chapter.html);return {root:{},commit:()=>committed++,rollback:()=>{}};}});
 const r=await c.open(0);assert.equal(r.sidecar,null);assert.equal(r.fingerprint,null);assert.ok(!('mode' in r));
 assert.equal(committed,1);assert.equal(mounted,0);assert.equal(cacheCalls,0);assert.equal(s.background,null);assert.equal(s.vocabulary().processedChapters,0);c.dispose();
});
test('intentional null result remains unchanged and is not cached as an annotated success',async()=>{
 let writes=0,calls=0;const s=session(active({preprocess:async()=>{calls++;return null;}}),{cache:{get:async()=>null,put:()=>writes++}});
 for(let n=0;n<2;n++){const r=await s.open(0);assert.equal(r.result.html,chapter.html);assert.equal(r.result.sidecar,null);}
 assert.equal(writes,0);assert.equal(calls,2);s.dispose();
});
test('undefined and failures do not become no-op success',async()=>{
 for(const preprocess of [async()=>undefined,async()=>{throw Error('failed');}]) {
  const s=session(active({preprocess}));await assert.rejects(s.open(0));s.dispose();
 }
 assert.throws(()=>normalizeChapterResult({protocol:1,fingerprint:'f',html:'changed',sidecar:null,vocabulary:[]},chapter.html,'f'));
});
test('unavailable generation cannot return annotations',async()=>{
 const s=session(active({fingerprint:async()=>null,preprocess:async i=>output(i)}));await assert.rejects(s.open(0),/Annotations require/);s.dispose();
});
test('resource installation while staging unchanged chapter prevents stale reveal',async()=>{
 let f=null,committed=0;const s=session(active({fingerprint:async()=>f}));
 const c=new ChapterOpeningController({session:s,stage:async()=>{f='installed';return {root:{},commit:()=>committed++,rollback:()=>{}};}});
 await assert.rejects(c.open(0),GenerationChanged);assert.equal(committed,0);c.dispose();
});
test('same processor becomes active at next opening without a reader-mode toggle',async()=>{
 let f=null;const s=session(active({fingerprint:async()=>f,preprocess:async i=>f?output(i):null}));
 assert.equal((await s.open(0)).result.sidecar,null);f='ready';assert.deepEqual((await s.open(0)).result.sidecar,{fixture:true});s.dispose();
});
test('old negative cached output is ignored after readiness',async()=>{
 let calls=0;const s=session(active({preprocess:async i=>{calls++;return output(i);}}),{cache:{get:async()=>({protocol:1,fingerprint:'f1',html:chapter.html,sidecar:null,vocabulary:[]}),put:async()=>{}}});
 assert.deepEqual((await s.open(0)).result.sidecar,{fixture:true});assert.equal(calls,1);s.dispose();
});
const asset=(id,purpose='definitions',extra={})=>({id,label:id,purpose,revision:'r1',contentSha256:'a'.repeat(64),source:'https://manabi.io/'+id,...extra});
const sk=asset('skeleton','processing'),def=asset('jitendex');
const receipt=a=>({...a,artifactID:'artifact-'+a.id,artifactSha256:'c'.repeat(64),importerVersion:'1',formatVersion:'3',verified:true});
function storage(overrides={}) {
 const calls=[];let set=null;const db={calls,
  withLock:async fn=>{calls.push('lock');return fn();},
  ensure:async a=>{calls.push('ensure:'+a.id);return receipt(a);},
  activateProcessingSet:async s=>{calls.push('activate');set=s;},
  readProcessingSet:async()=>{calls.push('readback');return set;},...overrides};return db;
}
test('not-now/empty selection makes no install or storage request',async()=>{
 const db=storage();const c=new DictionaryInstallationCoordinator({processingAssets:[sk],storage:db});
 assert.deepEqual(await c.install([]),{installed:[],processingFingerprint:null});assert.deepEqual(db.calls,[]);
});
test('every user-selected dictionary implies required processing resources first',()=>{
 for(const id of ['jitendex','custom-local','frequency-only','jp-jp']) assert.deepEqual(installationPlan([asset(id)],[sk]).map(a=>a.id),['skeleton',id]);
});
test('definitions do not replace skeleton and skeleton cannot be selected as a definition',()=>{
 assert.equal(installationPlan([asset('full-jmdict')],[sk])[0].id,'skeleton');
 assert.throws(()=>installationPlan([sk],[sk]),/definition/);
});
test('conflicting identities, missing checksums and provisional resources fail closed',()=>{
 assert.throws(()=>installationPlan([def,{...def,revision:'r2'}],[sk]));
 assert.throws(()=>installationPlan([def],[{...sk,contentSha256:null}]));
});
test('identical requests are deduplicated without mutating caller input',()=>{
 const plan=installationPlan([def,def],[sk,sk]);def.label='renamed';assert.equal(plan.length,2);assert.notEqual(plan[1].label,def.label);def.label='jitendex';
});
test('processing set is installed, activated and verified before definitions',async()=>{
 const db=storage();const c=new DictionaryInstallationCoordinator({processingAssets:[sk],storage:db});
 const result=await c.install([def]);assert.deepEqual(db.calls,['lock','ensure:skeleton','activate','readback','ensure:jitendex']);
 assert.deepEqual(result.installed,['skeleton','jitendex']);assert.match(result.processingFingerprint,/^processing-set-v2:/);
});
test('public distribution needs neither private engine nor processing catalogue',async()=>{
 const db=storage();await new DictionaryInstallationCoordinator({storage:db}).install([def]);
 assert.deepEqual(db.calls,['lock','ensure:jitendex']);
});
test('failed skeleton import prevents new activation and definition work',async()=>{
 let activated=0,defs=0;const db=storage({ensure:async a=>{if(a.purpose==='processing')throw Error('bad');defs++;return receipt(a);},activateProcessingSet:async()=>activated++});
 await assert.rejects(new DictionaryInstallationCoordinator({storage:db,processingAssets:[sk]}).install([def]));assert.equal(activated,0);assert.equal(defs,0);
});
test('a false receipt never establishes readiness',async()=>{
 for(const bad of [{verified:false},{contentSha256:'b'.repeat(64)},{purpose:'definitions'},{artifactID:''}]) {
  const db=storage({ensure:async a=>({...receipt(a),...bad})});
  await assert.rejects(new DictionaryInstallationCoordinator({storage:db,processingAssets:[sk]}).install([def]),/receipt/);assert.ok(!db.calls.includes('activate'));
 }
});
test('processing readback mismatch prevents claiming completion',async()=>{
 const db=storage({readProcessingSet:async()=>null});
 await assert.rejects(new DictionaryInstallationCoordinator({storage:db,processingAssets:[sk]}).install([def]),/activation/);assert.ok(!db.calls.includes('ensure:jitendex'));
});
test('cancellation after ensure never publishes an unacknowledged processing set',async()=>{
 const controller=new AbortController();const db=storage({ensure:async a=>{controller.abort();return receipt(a);}});
 await assert.rejects(new DictionaryInstallationCoordinator({storage:db,processingAssets:[sk]}).install([def],{signal:controller.signal}),{name:'AbortError'});assert.ok(!db.calls.includes('activate'));
});
test('retry after definition failure can reuse the verified skeleton receipt',async()=>{
 let imports=0,fail=true;const retained=new Map(),db=storage({ensure:async a=>{
  if(a.id===def.id&&fail){fail=false;throw Error('definition download');}
  if(!retained.has(a.id)){imports++;retained.set(a.id,receipt(a));}return retained.get(a.id);
 }});const c=new DictionaryInstallationCoordinator({storage:db,processingAssets:[sk]});
 await assert.rejects(c.install([def]));await c.install([def]);assert.equal(imports,2);
});
test('analysis identity ignores display labels/order but binds content and importer semantics',async()=>{
 const a=receipt(sk),b=receipt(asset('morphology','processing'));const f=await processingSetFingerprint([a,b]);
 assert.equal(f,await processingSetFingerprint([{...b,label:'new'},{...a,artifactID:'different'}]));
 for(const change of [{contentSha256:'b'.repeat(64)},{importerVersion:'2'},{formatVersion:'4'},{artifactSha256:'d'.repeat(64)}]) assert.notEqual(f,await processingSetFingerprint([{...a,...change},b]));
 await assert.rejects(processingSetFingerprint([a,a]));
});
const zip=new Uint8Array([0x50,0x4b,3,4,1,2,3]); // representation fixture, NOT a structurally valid imported dictionary
const archiveAsset=async()=>({...sk,contentSha256:await sha256(zip),sourceRepresentation:'brotli-wrapped-zip'});
const brotliStream=stream=>{const parts=[];return stream.pipeThrough(new TransformStream({transform(x){parts.push(x);},flush(c){c.enqueue(new Uint8Array(brotliDecompressSync(Buffer.concat(parts))));}}));};
test('already HTTP-decoded Brotli archive is not decompressed twice',async()=>{
 let decoded=0;const bytes=await fetchVerifiedDictionaryArchive(await archiveAsset(),{fetcher:async()=>new Response(zip,{headers:{'Content-Encoding':'br'}}),brotliStream:()=>{decoded++;throw Error('double decode');}});
 assert.deepEqual(bytes,zip);assert.equal(decoded,0);
});
test('raw Brotli payload is decompressed and checksum-verified as ZIP bytes',async()=>{
 const bytes=await fetchVerifiedDictionaryArchive(await archiveAsset(),{fetcher:async()=>new Response(brotliCompressSync(zip)),brotliStream});assert.deepEqual(bytes,zip);
});
test('bad checksum and unapproved origin cannot be admitted',async()=>{
 const a=await archiveAsset();await assert.rejects(fetchVerifiedDictionaryArchive({...a,contentSha256:'b'.repeat(64)},{fetcher:async()=>new Response(zip)}),/checksum/);
 let calls=0;await assert.rejects(fetchVerifiedDictionaryArchive({...a,source:'https://evil.test/file'},{fetcher:async()=>{calls++;return new Response(zip);}}),/origin/);assert.equal(calls,0);
});
test('archive transport and decompressed budgets are independently enforced',async()=>{
 const a=await archiveAsset();await assert.rejects(fetchVerifiedDictionaryArchive(a,{fetcher:async()=>new Response(zip),maxTransferBytes:4}),/budget/);
 await assert.rejects(fetchVerifiedDictionaryArchive(a,{fetcher:async()=>new Response(brotliCompressSync(zip)),brotliStream,maxDecodedBytes:4}),/budget/);
});
test('unsupported Brotli is an error, not an empty dictionary or fallback import',async()=>{
 await assert.rejects(fetchVerifiedDictionaryArchive(await archiveAsset(),{fetcher:async()=>new Response([1,2,3]),brotliStream:()=>{throw Error('unsupported');}}),/unsupported/);
});
test('aborting a stalled dictionary body cancels the stream',async()=>{
 let canceled=0;const c=new AbortController();const body=new ReadableStream({cancel(){canceled++;}});
 const pending=fetchVerifiedDictionaryArchive(await archiveAsset(),{signal:c.signal,fetcher:async()=>new Response(body)});
 const rejected=assert.rejects(pending,{name:'AbortError'});await new Promise(r=>setTimeout(r,5));c.abort();await rejected;assert.equal(canceled,1);
});
