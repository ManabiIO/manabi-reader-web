/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
const output = mkdtempSync(join(tmpdir(), 'native-snippets-adapter-'));
const require = createRequire(import.meta.url);
const fixture = join(output, 'fixture.ts');
const root = process.cwd();
writeFileSync(
  fixture,
  `import {writable,get,derived} from '${root}/apps/web/src/lib/state/store';
export const account=writable({status:'available',session:null});export const localUser=derived(account,s=>s.session?.user??null);export const localProfileUser=()=>get(localUser);export const currentUser=()=>get(localUser);let generation=0;export const changeUser=id=>{generation++;account.set({status:'available',session:id?{user:{id,username:id}}:null});};export const accountScope=()=>({generation,userId:currentUser()?.id});export class IntegrationError extends Error { constructor(code){super(code);this.code=code;} }
export const memory={sources:[],caps:new Map(),folderCalls:[]};export const sourceDescriptors=async()=>memory.sources;export const capability=async(source,guard)=>{guard();if(memory.caps.get(source.id)==='denied')throw new Error('permission');return {write:memory.caps.get(source.id)!==false};};export const folders=async(source,parent,guard)=>{guard();memory.folderCalls.push({source,parent});return [{id:parent+'/child',name:'Child'}];};export const librarySource=async()=>({});export const scanCatalog=async()=>({});export const sha256=async()=>'';export const prepareDestination=async value=>value;export const readDocument=async()=>{throw new Error('offline');};export const writeDocument=async()=>{throw new Error('not used');};
`
);
const outfile = join(output, 'adapter.cjs');
await build({
  stdin: {
    contents: `export * from './apps/web/src/native-snippets/dom-repository';export * from './apps/web/src/native-snippets/service';export * from './apps/web/src/lib/snippets/document';export * from './apps/web/src/lib/snippets/database';export * from 'native-snippet-fixture';`,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: 'apps/web/tsconfig.json',
  logLevel: 'silent',
  plugins: [
    {
      name: 'only-transport-and-account',
      setup(b) {
        b.onResolve(
          {
            filter:
              /native-snippet-fixture|(?:\.\.\/)?(?:lib\/)?manabi\/(client|sources)$|(?:\.\.\/)?(?:lib\/)?library\/catalog$|(?:\.\.\/)?lib\/snippets\/storage$|^\.\/storage$/
          },
          () => ({ path: fixture })
        );
      }
    }
  ]
});
const {
  createNativeSnippetsRepository,
  NativeSnippetsService,
  memory,
  changeUser,
  createSnippet,
  plainContent,
  saveDocument,
  editSnippet,
  mutateRecord,
  saveDraft,
  summaries,
  drafts,
  getRecord
} = require(outfile);
const authority = () => ({
  key: crypto.randomUUID(),
  signal: new AbortController().signal,
  assertCurrent() {}
});
const source = (provider, owner = null) => ({
  id: crypto.randomUUID(),
  name: provider,
  provider,
  owner,
  root: {
    local: '',
    google: 'root',
    dropbox: '/Manabi',
    onedrive: '01MANABI_FOLDER',
    webdav: 'https://example.test/dav/Manabi'
  }[provider]
});
const patchFor = (editor) => ({
  title: editor.title,
  runs: editor.runs.map(({ key, text, ruby }) => ({
    key,
    text,
    ...(ruby !== undefined ? { ruby } : {})
  })),
  source: { ...editor.source }
});
test('production adapter verifies Google, Dropbox, OneDrive, WebDAV and local capability boundaries', async () => {
  changeUser('user-a');
  const repo = createNativeSnippetsRepository();
  const sources = ['google', 'dropbox', 'onedrive'].map((provider) => source(provider, 'user-a'));
  sources.push(source('webdav'), source('local'), source('google', 'other-user'));
  memory.sources = sources;
  memory.caps.set(sources[1].id, false);
  memory.caps.set(sources[2].id, 'denied');
  const result = await repo.load(authority());
  assert.equal(result.owner, 'account:user-a');
  assert.equal(result.sources.length, 5);
  assert.deepEqual(
    result.sources.map((item) => item.writable),
    [true, false, false, true, false]
  );
  assert.match(result.sources[4].reason, /Android/);
  await assert.rejects(
    repo.folders({ source: sources[4], parent: '' }, authority()),
    /folder writes/
  );
  assert.equal(memory.folderCalls.length, 0);
  const folders = await repo.folders({ source: sources[0], parent: sources[0].root }, authority());
  assert.equal(folders[0].name, 'Child');
});
test('production adapter retains device draft if capability is revoked before save', async () => {
  changeUser('revocation');
  const connected = source('google', 'revocation');
  memory.sources = [connected];
  const repo = createNativeSnippetsRepository(),
    service = new NativeSnippetsService(repo),
    auth = authority();
  const state = await service.state({}, auth);
  const { editor } = await service.action({ type: 'new', token: state.token }, auth);
  const patch = { ...patchFor(editor), destinationKey: state.sources[0].key };
  patch.runs[0].text = 'Keep me';
  memory.caps.set(connected.id, false);
  const result = await service.action(
    { type: 'save', token: editor.token, key: editor.key, patch },
    auth
  );
  assert.equal(result.editor.hasConflict, true);
  assert.equal((await summaries('account:revocation')).length, 0);
  assert.equal((await drafts('account:revocation')).length, 1);
});
test('production adapter saves to the single domain store and fences an in-transaction stale trash revision', async () => {
  changeUser('transaction');
  memory.sources = [];
  const repo = createNativeSnippetsRepository(),
    auth = authority();
  const document = createSnippet(plainContent('Real store'));
  await saveDocument('account:transaction', document, null, undefined, () => {});
  await assert.rejects(repo.trash(document.id, crypto.randomUUID(), false, auth), /changed/);
  assert.equal((await getRecord('account:transaction', document.id)).document.trashedAt, undefined);
  await repo.trash(document.id, document.revision, false, auth);
  assert.ok((await getRecord('account:transaction', document.id)).document.trashedAt);
});
test('production adapter detects ownership change across asynchronous source discovery', async () => {
  changeUser('before');
  memory.sources = [];
  const repo = createNativeSnippetsRepository();
  const pending = repo.load(authority());
  changeUser('after');
  await assert.rejects(pending, /account_changed/);
});
test('save acknowledgment recovery tolerates domain-retained remote ancestry', async () => {
  changeUser('ancestry');
  memory.sources = [];
  const owner = 'account:ancestry';
  const repo = createNativeSnippetsRepository(),
    auth = authority();
  const document = createSnippet(plainContent('Original'));
  await saveDocument(owner, document, null, undefined, () => {});
  await mutateRecord(
    owner,
    document.id,
    () => {},
    (record) => ({ ...record, remoteRevision: document.revision })
  );
  let edited = document;
  for (let count = 0; count < 20; count++)
    edited = editSnippet(edited, edited.content, `Edit ${count}`);
  assert.ok(!edited.parents.includes(document.revision));
  const session = crypto.randomUUID();
  const draft = {
    key: JSON.stringify([owner, session]),
    owner,
    session,
    id: edited.id,
    base: document.revision,
    document: edited,
    updatedAt: Date.now()
  };
  await saveDraft(draft, () => {});
  await repo.save(draft, auth);
  assert.ok((await getRecord(owner, edited.id)).document.parents.includes(document.revision));
  await repo.save(draft, auth);
  assert.equal((await summaries(owner)).length, 1);
});
test.after(() => rmSync(output, { recursive: true, force: true }));
