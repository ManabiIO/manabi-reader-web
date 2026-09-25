/** Cancellation tests deliberately inject decoder promises and Web Audio stand-ins. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaPipeline, MAX_DECODE_PACKETS} from '../../.cache/media-test-build/pipeline.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function promptly(promise){let timer;try{return await Promise.race([promise,new Promise((_,no)=>timer=setTimeout(()=>no(Error('Cancellation did not settle')),500))]);}finally{clearTimeout(timer);}}
function harness(changes={}){
 let disposed=0;const track={id:1,getName:async()=>null,getLanguageCode:async()=>'und',getDisposition:async()=>({default:false,primary:false,forced:false,original:false,commentary:false,hearingImpaired:false,visuallyImpaired:false}),canDecode:async()=>true,getNumberOfChannels:async()=>1,async *buffers(){},...changes.track};
 const input={getAudioTracks:async()=>[track],getPrimaryVideoTrack:async()=>null,computeDuration:async()=>20,dispose(){disposed++},...changes.input};
 const controller=new AbortController(),pipeline=new MediaPipeline({create:()=>input},{},controller.signal);
 return {pipeline,controller,disposed:()=>disposed};
}
for(const phase of ['getAudioTracks','canDecode','getNumberOfChannels'])test(`cancel detaches a stalled ${phase} without needing its callback`,async()=>{
 const d=deferred(),changes=phase==='getAudioTracks'?{input:{[phase]:()=>d.promise}}:{track:{[phase]:()=>d.promise}};
 const h=harness(changes),c=new AbortController();const pending=h.pipeline.decode(1,0,1,c.signal);await tick();c.abort();
 await promptly(assert.rejects(pending,{name:'AbortError'}));assert.equal(h.disposed(),1);d.reject(Error('late decoder failure'));await tick();
});

for(const phase of ['getName','getLanguageCode','getDisposition','canDecode'])test(`audio description cancellation detaches a stalled ${phase}`,async()=>{
 const d=deferred(),h=harness({track:{[phase]:()=>d.promise}});const pending=h.pipeline.describeAudioTracks();await tick();h.pipeline.dispose();
 await promptly(assert.rejects(pending,{name:'AbortError'}));d.reject(Error('late metadata failure'));await tick();
});
test('audio description validates third-party disposition metadata before automatic selection',async()=>{
 const h=harness({track:{getDisposition:async()=>({default:false,primary:false,forced:false,original:false,commentary:'yes',hearingImpaired:false,visuallyImpaired:false})}});
 await assert.rejects(h.pipeline.describeAudioTracks(),/Invalid audio track metadata/);h.pipeline.dispose();
});
test('pipeline disposal cancels duration inspection even if the decoder never settles',async()=>{
 const d=deferred(),h=harness({input:{computeDuration:()=>d.promise}});const pending=h.pipeline.metadata();h.pipeline.dispose();
 await promptly(assert.rejects(pending,{name:'AbortError'}));d.reject(Error('late duration failure'));await tick();
});
test('throwing decoder cleanup cannot prevent cancellation from settling',async()=>{
 const d=deferred(),h=harness({input:{getAudioTracks:()=>d.promise,dispose(){throw Error('cleanup failed')}}});
 const pending=h.pipeline.audioTracks();assert.doesNotThrow(()=>h.pipeline.dispose());await promptly(assert.rejects(pending,{name:'AbortError'}));
 d.reject(Error('late'));await tick();
});
class AudioContextDouble {
 static started=false;static rendered;static stopped=0;static disconnected=0;
 constructor(_channels,length){this.length=length;this.destination={};}
 createBufferSource(){return {connect(){},start(){},stop(){AudioContextDouble.stopped++},disconnect(){AudioContextDouble.disconnected++}}}
 startRendering(){AudioContextDouble.started=true;return AudioContextDouble.rendered??Promise.resolve({getChannelData:()=>new Float32Array(this.length)})}
}
async function audio(body){const old=globalThis.OfflineAudioContext;globalThis.OfflineAudioContext=AudioContextDouble;
 AudioContextDouble.started=false;AudioContextDouble.rendered=undefined;AudioContextDouble.stopped=0;AudioContextDouble.disconnected=0;
 try{await body();}finally{if(old===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=old;}}
const packet={timestamp:0,duration:.01,buffer:{duration:.01,length:160,numberOfChannels:1}};
test('cancel releases a pending iterator without waiting for async-generator return',()=>audio(async()=>{
 const d=deferred();let returned=0;const h=harness({track:{buffers:()=>({[Symbol.asyncIterator]:()=>({next:()=>d.promise,return(){returned++;return Promise.reject(Error('cleanup'));}})})}});
 const pending=h.pipeline.decode(1,0,1,new AbortController().signal);await tick();h.pipeline.dispose();
 await promptly(assert.rejects(pending,{name:'AbortError'}));assert.equal(returned,1);assert.equal(AudioContextDouble.started,false);d.reject(Error('late packet'));await tick();
}));
test('cancel during offline rendering detaches promptly and stops scheduled nodes',()=>audio(async()=>{
 const d=deferred();AudioContextDouble.rendered=d.promise;const h=harness({track:{async *buffers(){yield packet;}}});
 const pending=h.pipeline.decode(1,0,1,new AbortController().signal);await tick();assert.equal(AudioContextDouble.started,true);h.pipeline.dispose();
 await promptly(assert.rejects(pending,{name:'AbortError'}));assert.equal(AudioContextDouble.stopped,1);assert.equal(AudioContextDouble.disconnected,1);d.reject(Error('late rendering failure'));await tick();
}));
test('pathologically tiny packets have a count budget as well as a PCM byte budget',()=>audio(async()=>{
 const h=harness({track:{async *buffers(){for(let i=0;i<=MAX_DECODE_PACKETS;i++)yield {...packet,timestamp:100};}}});
 await assert.rejects(h.pipeline.decode(1,0,1,new AbortController().signal),/packet budget/);assert.equal(AudioContextDouble.started,false);h.pipeline.dispose();
}));
test('a normal exhausted iterator renders exactly one requested window',()=>audio(async()=>{
 const h=harness({track:{async *buffers(){yield packet;}}});
 const result=await h.pipeline.decode(1,0,.125,new AbortController().signal);assert.equal(result.length,2000);assert.equal(AudioContextDouble.started,true);h.pipeline.dispose();
}));
