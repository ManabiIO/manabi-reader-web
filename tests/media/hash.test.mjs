import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Sha256,hashBlob} from '../../.cache/media-test-build/hash.js';
const native=b=>createHash('sha256').update(b).digest('hex');
for(const length of [0,1,2,55,56,57,63,64,65,127,128,129,1023,1024,1025,65536,1000000]){
 test('SHA-256 matches native across subarray offsets and chunk boundaries: '+length,()=>{
  const storage=new Uint8Array(length+29),bytes=storage.subarray(13,13+length);
  for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+(i>>>8))&255;
  assert.equal(new Sha256().update(bytes).hex(),native(bytes));
  const h=new Sha256();let step=1;for(let i=0;i<bytes.length;){step=(step*48271)%65521;const end=Math.min(bytes.length,i+step%257+1);h.update(bytes.subarray(i,end));i=end;}
  assert.equal(h.hex(),native(bytes));assert.throws(()=>h.update(bytes),/finalized/);assert.throws(()=>h.hex(),/finalized/);
 });
}
test('blob hash preserves byte identity and supports cancellation between bounded reads',async()=>{
 const bytes=new Uint8Array(2*1024*1024+9);bytes.fill(157);const progress=[];
 assert.equal(await hashBlob(new Blob([bytes]),new AbortController().signal,n=>progress.push(n)),native(bytes));assert.equal(progress.at(-1),bytes.length);
 const c=new AbortController();await assert.rejects(hashBlob(new Blob([bytes]),c.signal,()=>c.abort()),{name:'AbortError'});
});
