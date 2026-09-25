import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJSON} from '../../apps/web/src/lib/preprocessing/contracts.mjs';
test('cache/options canonical JSON rejects holes and recursive structures',()=>{
 assert.throws(()=>canonicalJSON(Array(1)),/sparse/);
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>canonicalJSON(cyclic),/cycle/);
 const shared={x:1};assert.equal(canonicalJSON([shared,shared]),'[{"x":1},{"x":1}]');
});
test('canonical JSON fails predictably on pathological depth without stack overflow',()=>{
 let value={};for(let i=0;i<200;i++)value={child:value};assert.throws(()=>canonicalJSON(value),/nesting/);
});
