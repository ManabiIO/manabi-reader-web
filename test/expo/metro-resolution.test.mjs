/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import sourceResolver from '../../apps/web/metro-source-resolver.cjs';
test('Metro preserves real JS and only substitutes retained local TS specifiers', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-metro-'));
  try {
    writeFileSync(path.join(root,'sources.ts'), '');
    const resolve = sourceResolver(root); const calls=[]; const missing=new Error('missing');
    const context={originModulePath:path.join(root,'cloud-browser.ts'),resolveRequest(_ctx,name,platform){calls.push([name,platform]);if(name==='./sources.js')throw missing;return {type:'sourceFile',filePath:name};}};
    assert.equal(resolve(context,'./sources.js','web').filePath,'./sources');
    assert.deepEqual(calls,[['./sources.js','web'],['./sources','web']]);
    assert.equal(resolve({...context,resolveRequest(){return {filePath:'real.js'};}},'./sources.js','android').filePath,'real.js');
    for(const name of ['package/sources.js','../sources.js','./absent.js'])assert.throws(()=>resolve({...context,resolveRequest(){throw missing;}},name,'web'),error=>error===missing);
    assert.throws(()=>resolve({...context,originModulePath:'/node_modules/x/index.ts',resolveRequest(){throw missing;}},'./sources.js','web'),error=>error===missing);
  } finally {rmSync(root,{recursive:true,force:true});}
});
