import test from 'node:test';
import assert from 'node:assert/strict';
import { writable, derived, get } from '../../apps/web/src/lib/state/store.ts';
import { bytesToBase64 } from '../../apps/web/src/platform/transfer-encoding.ts';
test('store start/stop, snapshot, reentrant ordering and object updates remain synchronous', () => {
 let starts=0,stops=0; const store=writable(1, () => {starts++;return () => stops++;});
 assert.equal(get(store),1); assert.equal(starts,1); assert.equal(stops,1);
 const values=[];const stop=store.subscribe(value=>{values.push(value);if(value===2)store.set(3);});store.set(2);assert.deepEqual(values,[1,2,3]);stop();assert.equal(stops,2);
});
test('derived stores preserve released synchronous dependency ordering and clean up', () => {
 const a=writable(1), b=derived(a,value=>value*2), both=derived([a,b],([x,y])=>[x,y]);const values=[];const stop=both.subscribe(value=>values.push(value));a.set(2);stop();assert.deepEqual(values,[[1,2],[2,2],[2,4]]);
});
test('manual derived cleanup runs for changes and disposal', () => {
 const source=writable(1);let clean=0;const result=derived(source,(value,set)=>{set(value+2);return()=>clean++;},0);const stop=result.subscribe(()=>{});source.set(2);assert.equal(get(result),4);stop();assert.equal(clean,2);
});
test('bounded native file transfer base64 is byte-exact for padding and chunk lengths', () => {
 for(const length of [0,1,2,3,7,256,262144]){const bytes=Uint8Array.from({length},(_,i)=>i%256);assert.equal(bytesToBase64(bytes),Buffer.from(bytes).toString('base64'));}
});
