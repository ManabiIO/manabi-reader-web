import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chapterCacheKey, validateResult, canonicalJSON, sha256} from '../../apps/web/src/lib/preprocessing/contracts.mjs';
import {MemoryChapterCache} from '../../apps/web/src/lib/preprocessing/cache.mjs';
import {BookPreprocessingSession, GenerationChanged} from '../../apps/web/src/lib/preprocessing/session.mjs';
import {ChapterOpeningController, chapterForResume} from '../../apps/web/src/lib/preprocessing/presentation.mjs';
import {loadDeploymentPreprocessor, deploymentURL} from '../../apps/web/src/lib/preprocessing/loader.mjs';

const delay=(ms=5)=>new Promise(r=>setTimeout(r,ms));
// Observe completion, not an assumed machine/WebCrypto latency. The deadline
// only diagnoses a stalled test; it is not a performance assertion.
const waitFor=async predicate=>{
 const deadline=Date.now()+3000;
 while(!predicate()) {if(Date.now()>=deadline)throw new Error('Timed out awaiting test lifecycle');await new Promise(r=>setImmediate(r));}
};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const chapters=[{id:'a',baseURL:'https://reader.test/books/key/a',html:'猫'},{id:'b',baseURL:'https://reader.test/books/key/b',html:'犬'},{id:'c',baseURL:'https://reader.test/books/key/c',html:'鳥'}];
const row=(term='猫',count=1)=>({key:'jmdict:1:'+term,term,reading:'ねこ',count});
const result=(input,more={})=>({protocol:1,fingerprint:input.fingerprint,html:input.html,sidecar:{testOnly:true},vocabulary:[row(input.html)],...more});
function provider(overrides={}) {return {protocol:1,id:'fixture',release:'r1',fingerprint:async()=> 'f1',preprocess:async(input)=>result(input),mount:()=>()=>{},dispose:()=>{},...overrides};}
function session(p=provider(), extra={}) {return new BookPreprocessingSession({provider:p,cache:new MemoryChapterCache(),bookKey:'sha256:book',chapters,contextKey:'source-readings:none',resourceVersion:'r1',...extra});}


test('canonical JSON is stable and rejects non-JSON fields',()=>{
 assert.equal(canonicalJSON({b:1,a:{c:2}}),canonicalJSON({a:{c:2},b:1}));
 for(const x of [undefined,NaN,BigInt(3),new Date(),{a:undefined}]) assert.throws(()=>canonicalJSON(x));
});

test('cache key binds every semantic/source dimension',async()=>{
 const p=provider();const base={provider:p,fingerprint:'f',source:'猫',bookKey:'b',chapterID:'1',baseURL:'https://r/b/1',contextKey:'c',resourceVersion:'r'};
 const original=await chapterCacheKey(base);
 for(const key of ['fingerprint','source','bookKey','chapterID','baseURL','contextKey','resourceVersion']) assert.notEqual(original,await chapterCacheKey({...base,[key]:base[key]+'2'}),key);
 assert.notEqual(original,await chapterCacheKey({...base,provider:{...p,release:'r2'}}));
 assert.notEqual(original,await chapterCacheKey({...base,provider:{...p,id:'other'}}));
});

test('result admission clones values and rejects wrong epochs and duplicate vocab',()=>{
 const r=result({fingerprint:'f',html:'猫'});const valid=validateResult(r,'f');r.vocabulary[0].count=9;assert.equal(valid.vocabulary[0].count,1);
 assert.throws(()=>validateResult(r,'wrong'));
 assert.throws(()=>validateResult({...r,vocabulary:[row(),row()]},'f'));
 assert.throws(()=>validateResult({...r,sidecar:undefined},'f'));
});

test('unconfigured plugin performs zero fetches',async()=>{
 const r=await loadDeploymentPreprocessor({fetcher:()=>{throw new Error('must not fetch')}});assert.equal(r.provider,null);assert.equal(r.status,'not-configured');
});

test('missing deployment returns optional fallback; other HTTP errors remain explicit',async()=>{
 const opts={manifestURL:'/engine.json',baseURL:'https://reader.test/'};
 assert.equal((await loadDeploymentPreprocessor({...opts,fetcher:async()=>new Response('',{status:404})})).status,'not-installed');
 await assert.rejects(loadDeploymentPreprocessor({...opts,fetcher:async()=>new Response('',{status:500})}),/500/);
});

test('deployment rejects foreign origins, query/fragment/credentials',()=>{
 for(const x of ['https://evil.test/p','https://user:secret@reader.test/p','/p?a=1','/p#frag','/a%2fb','data:x']) assert.throws(()=>deploymentURL(x,'https://reader.test/'));
 assert.equal(deploymentURL('./p','https://reader.test/b/manifest.json').href,'https://reader.test/b/p');
});

test('loader verifies bytes before import and checks matching release',async()=>{
 const bytes=new TextEncoder().encode('fixture');const hash=await sha256(bytes);let imports=0;
 const opts={manifestURL:'/engine.json',baseURL:'https://reader.test/',fetcher:async(url)=>new Response(String(url).endsWith('.json')?JSON.stringify({protocol:1,release:'r1',entry:{path:'/plugin.mjs',sha256:hash}}):bytes),importer:async()=>{imports++;return {createPreprocessor:async()=>provider()}}};
 assert.equal((await loadDeploymentPreprocessor(opts)).provider.id,'fixture');assert.equal(imports,1);
 await assert.rejects(loadDeploymentPreprocessor({...opts,fetcher:async(url)=>new Response(String(url).endsWith('.json')?JSON.stringify({protocol:1,release:'r1',entry:{path:'/plugin.mjs',sha256:'0'.repeat(64)}}):bytes)}),/integrity/);assert.equal(imports,1);
 await assert.rejects(loadDeploymentPreprocessor({...opts,importer:async()=>({createPreprocessor:async()=>provider({release:'r2'})})}),/Mixed/);
});

test('abort during plugin creation disposes created provider',async()=>{
 const c=new AbortController();let disposed=0;const bytes=new TextEncoder().encode('x');const hash=await sha256(bytes);
 await assert.rejects(loadDeploymentPreprocessor({manifestURL:'/m.json',baseURL:'https://reader.test/',signal:c.signal,
 fetcher:async(url)=>new Response(String(url).endsWith('.json')?JSON.stringify({protocol:1,release:'r1',entry:{path:'/p.mjs',sha256:hash}}):bytes),
 importer:async()=>({createPreprocessor:async()=>{c.abort();return provider({dispose:()=>disposed++});}})}));assert.equal(disposed,1);
});

test('bounded memory cache evicts least recently used and copies',async()=>{
 const c=new MemoryChapterCache(32);await c.put('a',{x:1});await c.put('b',{x:2});await c.put('c',{x:3});await c.get('a');await c.put('d',{x:4});await c.put('e',{x:5});
 assert.equal(await c.get('b'),null);assert.deepEqual(await c.get('a'),{x:1});
 const r=await c.get('a');r.x=8;assert.equal((await c.get('a')).x,1);assert.ok(c.bytes<=32);
 assert.throws(()=>new MemoryChapterCache(-1));
});

test('unplugged reading preserves original source',async()=>{
 const s=session(null);const r=await s.open(1);assert.equal(r.result.sidecar,null);assert.equal('mode' in r.result,false);assert.equal(r.result.html,'犬');s.didPresent(r.revision);s.dispose();
});

test('opening waits for current chapter; no background until presented',async()=>{
 const gate=deferred(),started=deferred();const calls=[];const s=session(provider({preprocess:async(input)=>{calls.push(input.chapterID);started.resolve();await gate.promise;return result(input);}}));
 let finished=false;const opened=s.open(1).then(x=>{finished=true;return x;});await started.promise;assert.equal(finished,false);assert.deepEqual(calls,['b']);gate.resolve();await opened;assert.equal(s.background,null);assert.deepEqual(calls,['b']);s.dispose();
});

test('resume current chapter is processed before the others',async()=>{
 const calls=[];const gate=deferred();const s=session(provider({preprocess:async(input)=>{calls.push(input.chapterID);return result(input);}}),{report:event=>{if(event.type==='indexed'&&event.processed===3)gate.resolve();}});
 const r=await s.open(1);s.didPresent(r.revision);await gate.promise;assert.deepEqual(calls,['b','a','c']);assert.equal(s.vocabulary().processedChapters,3);s.dispose();
});

test('cache hit avoids preprocessing and invalid cache entry is repaired',async()=>{
 let calls=0;let writes=0;let stored={broken:true};const cache={get:async()=>stored,put:async(_k,v)=>{writes++;stored=v;}};
 const s=session(provider({preprocess:async(i)=>{calls++;return result(i);}}),{cache});await s.open(0);await s.open(0);assert.equal(calls,1);assert.equal(writes,1);s.dispose();
});

test('cache failure does not stop correct reading',async()=>{
 const s=session(provider(),{cache:{get:async()=>{throw Error()},put:async()=>{throw Error()}}});assert.equal((await s.open(0)).result.html,'猫');s.dispose();
});

test('dictionary epoch change inside preprocessing rejects publication',async()=>{
 let epoch='f1';const s=session(provider({fingerprint:async()=>epoch,preprocess:async(i)=>{epoch='f2';return result(i);}}));await assert.rejects(s.open(0),GenerationChanged);assert.equal(s.vocabulary().processedChapters,0);s.dispose();
});

test('dictionary epoch change while writing cache rejects publication',async()=>{
 let epoch='f1';const s=session(provider({fingerprint:async()=>epoch}),{cache:{get:async()=>null,put:async()=>{epoch='f2';}}});await assert.rejects(s.open(0),GenerationChanged);assert.equal(s.vocabulary().processedChapters,0);s.dispose();
});

test('new epoch clears old book vocab and binds fresh processing',async()=>{
 let epoch='f1';let calls=0;const s=session(provider({fingerprint:async()=>epoch,preprocess:async(i)=>{calls++;return result(i);}}));await s.open(0);epoch='f2';await s.open(1);assert.equal(calls,2);assert.equal(s.vocabulary().processedChapters,1);s.dispose();
});

test('new open cancels stale foreground and serializes native engine use',async()=>{
 const gate=deferred(),started=deferred();let active=0,max=0;const s=session(provider({preprocess:async(i)=>{active++;max=Math.max(max,active);if(i.chapterID==='a'){started.resolve();await gate.promise;}active--;return result(i);}}));
 const a=s.open(0);const rejected=assert.rejects(a,{name:'AbortError'});await started.promise;const b=s.open(1);gate.resolve();await rejected;assert.equal((await b).result.html,'犬');assert.equal(max,1);s.dispose();
});

test('book closure prevents slow result publication',async()=>{
 const gate=deferred(),started=deferred();const s=session(provider({preprocess:async(i)=>{started.resolve();await gate.promise;return result(i);}}));const r=s.open(0);const rejected=assert.rejects(r,{name:'AbortError'});await started.promise;s.dispose();gate.resolve();await rejected;
});

test('background waits for visibility and restarts after navigation',async()=>{
 let visible=false;const observedHidden=deferred(),complete=deferred();const calls=[];const s=session(provider({preprocess:async(i)=>{calls.push(i.chapterID);return result(i);}}),{report:event=>{if(event.type==='indexed'&&event.processed===3)complete.resolve();}});let r=await s.open(0);s.didPresent(r.revision,{isVisible:()=>{observedHidden.resolve();return visible;}});await observedHidden.promise;assert.deepEqual(calls,['a']);r=await s.open(1);visible=true;s.didPresent(r.revision);await complete.promise;assert.equal(s.vocabulary().processedChapters,3);s.dispose();
});

test('resume uses chapter count boundaries including empty and terminal sections',()=>{
 assert.equal(chapterForResume([3,0,5],0),0);assert.equal(chapterForResume([3,0,5],3),2);assert.equal(chapterForResume([3,0,5],8),2);assert.equal(chapterForResume([],0),-1);assert.throws(()=>chapterForResume([1],-1));
});

test('mount and ready occur before background publication',async()=>{
 const calls=[];const p=provider({mount:()=>{calls.push('mount');return ()=>calls.push('unmount')}});const s=session(p);
 const c=new ChapterOpeningController({session:s,stage:async()=>({root:{},commit:()=>calls.push('commit'),rollback:()=>calls.push('rollback')}),ready:()=>calls.push('ready')});
 await c.open(0);assert.deepEqual(calls,['mount','commit','ready']);c.dispose();assert.deepEqual(calls.slice(-2),['unmount','rollback']);
});

test('stale asynchronous mount never commits visible DOM',async()=>{
 const gate=deferred(),started=deferred();let n=0;const calls=[];const s=session(provider({mount:async()=>{if(++n===1){started.resolve();await gate.promise;}return ()=>calls.push('unmount')}}));
 const c=new ChapterOpeningController({session:s,stage:async(_r,{index})=>({root:{},commit:()=>calls.push(`commit${index}`),rollback:()=>calls.push(`rollback${index}`)})});
 const a=c.open(0);const rejected=assert.rejects(a,{name:'AbortError'});await started.promise;await c.open(1);gate.resolve();await rejected;assert.ok(!calls.includes('commit0'));assert.ok(calls.includes('commit1'));c.dispose();
});

test('analysis options are immutable, sent to engine, and invalidate cache',async()=>{
 const cache=new MemoryChapterCache();let calls=0;
 const p=provider({preprocess:async(i)=>{calls++;assert.equal(i.analysisOptions.jlpt,true);i.analysisOptions.jlpt=false;return result(i);}});
 const options={jlpt:true};const a=session(p,{cache,analysisOptions:options});options.jlpt=false;
 await a.open(0);await a.open(0);assert.equal(calls,1);a.dispose();
 const key={provider:p,fingerprint:'f',source:'猫',bookKey:'b',chapterID:'1',baseURL:'https://r/1',contextKey:'c',resourceVersion:'r'};
 assert.notEqual(await chapterCacheKey({...key,analysisOptions:{jlpt:true}}),await chapterCacheKey({...key,analysisOptions:{jlpt:false}}));
});


test('dictionary update during runtime mount prevents chapter reveal',async()=>{
 let epoch='f1',committed=0,rolledBack=0;
 const s=session(provider({fingerprint:async()=>epoch,mount:async()=>{epoch='f2';return ()=>{};}}));
 const c=new ChapterOpeningController({session:s,stage:async()=>({root:{},commit:()=>committed++,rollback:()=>rolledBack++})});
 await assert.rejects(c.open(0),GenerationChanged);assert.equal(committed,0);assert.equal(rolledBack,1);c.dispose();
});

test('explicit invalidation after preparation rejects late presentation',async()=>{
 const s=session();const opened=await s.open(0);s.invalidate();await assert.rejects(s.admitPresentation(opened.revision,opened.result),{name:'AbortError'});assert.equal(s.vocabulary().processedChapters,0);s.dispose();
});
