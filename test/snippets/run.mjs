/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), 'manabi-snippet-tests-'));
const root = process.cwd();
const fixture = `
import {writable,get,derived} from 'svelte/store';
import {canonical} from '${root}/apps/web/src/lib/snippets/document.ts';
export const account=writable({status:'available',session:null});
export const localUser=derived(account,s=>s.session?.user??null);
export const localProfileUser=()=>get(localUser);
export const currentUser=()=>get(localUser);
let generation=0;
export const changeUser=(id)=>{generation++;account.set({status:'available',session:id?{user:{id,username:id}}:null});};
export const accountScope=()=>({userId:currentUser()?.id,generation});
export class IntegrationError extends Error {constructor(code,status=0){super(code);this.code=code;this.status=status;}}
export const memory={files:new Map(),writes:[],states:new Map(),sources:[],dropReply:false,beforeWrite:null,failRemove:false,readCount:0};
export function sameSource(a,b){return a.id===b.id&&a.owner===b.owner&&a.root===b.root;}
export const capability=async()=>({write:true});
export const sourceDescriptors=async()=>memory.sources;
export const scanCatalog=async(_adapter,source)=>({source,entries:[...memory.files].filter(([,x])=>sameSource(x.location.source,source)).map(([id,x])=>({id,name:x.location.name,kind:'file'})),names:{},warnings:[],scannedAt:Date.now()});
export const librarySource=async(source)=>({source,state:async(key)=>memory.states.get(source.id+key)??{value:null,revision:'0'},write:async(key,value,revision)=>{const name=source.id+key,current=memory.states.get(name)??{revision:'0'};if(current.revision!==revision)throw new IntegrationError('conflict');const result={value:structuredClone(value),revision:String(Number(revision)+1)};memory.states.set(name,result);return result;}});
export const prepareDestination=async(dest,doc)=>({...dest,name:doc.id+'.manabi-snippet.json',createId:dest.createId??crypto.randomUUID()});
export const readDocument=async(source,item,guard)=>{guard();memory.readCount++;const id=typeof item==='string'?item:item.id,result=memory.files.get(id);if(!result)throw new IntegrationError('not_found',404);return structuredClone(result);};
export const writeDocument=async(dest,document,expected,guard)=>{guard();if(memory.beforeWrite)await memory.beforeWrite();const id=expected?.fileId??dest.createId;
  const current=memory.files.get(id);if(current&&canonical(current.document)===canonical(document))return structuredClone(current.location);
  if(current&&(!expected||expected.token!==current.location.token||!document.parents.includes(current.document.revision)))throw new IntegrationError('conflict');
  if(!current&&expected)throw new IntegrationError('not_found',404);
  const location={...dest,fileId:id,name:dest.name,token:crypto.randomUUID()};memory.files.set(id,{document:structuredClone(document),location});memory.writes.push(structuredClone(document));
  if(memory.dropReply){memory.dropReply=false;throw new IntegrationError('unavailable');}return location;};
export const moveWithinSource=async(from,to,document,guard)=>{guard();const current=await readDocument(from.source,from.fileId,guard);if(current.location.parent!==to.parent&&current.location.token!==from.token)throw new IntegrationError('conflict');const location={...current.location,parent:to.parent,token:crypto.randomUUID()};memory.files.set(from.fileId,{document:current.document,location});return location;};
export const removeDocument=async(location,document,guard)=>{guard();if(memory.failRemove)throw new IntegrationError('offline');const current=memory.files.get(location.fileId);if(!current)throw new IntegrationError('not_found');if(current.location.token!==location.token||canonical(current.document)!==canonical(document))throw new IntegrationError('conflict');memory.files.delete(location.fileId);};
export const sha256=async(text)=>{const bytes=typeof text==='string'?new TextEncoder().encode(text):text;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');};
`;
await writeFile(join(dir, 'fixture.mjs'), fixture);
await build({
  entryPoints: ['test/snippets/unit.test.mjs'],
  outfile: join(dir, 'tests.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['node:*'],
  conditions: ['browser'],
  alias: {
    $lib: root + '/apps/web/src/lib',
    'fake-indexeddb/auto': root + '/apps/web/node_modules/fake-indexeddb/auto/index.mjs'
  },
  plugins: [
    {
      name: 'isolated-transport-fixtures',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(\.\/storage|\.\.\/snippets\/storage|\.\.\/library\/catalog|\.\.\/manabi\/client|\.\.\/manabi\/sources)$/
          },
          () => ({ path: join(dir, 'fixture.mjs') })
        );
        b.onResolve({ filter: /^snippet-fixture$/ }, () => ({ path: join(dir, 'fixture.mjs') }));
        b.onResolve({ filter: /^svelte\/store$/ }, () => ({
          path: root + '/node_modules/svelte/src/store/index-client.js'
        }));
      }
    }
  ]
});
try {
  const result = spawnSync(process.execPath, ['--test', join(dir, 'tests.mjs')], {
    stdio: 'inherit',
    env: process.env
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
