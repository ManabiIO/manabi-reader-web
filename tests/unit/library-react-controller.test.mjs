/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const path = '../../apps/web/src/library-react/';
function load(name, imports = {}) {
  const url = new URL(path + name, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true, fileName: url.pathname
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(name => {
    assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}
function store(value) {
  const listeners = new Set();
  return { subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); }, set(next) { value=next; for(const fn of listeners)fn(value); }, count() { return listeners.size; } };
}
const boundary = load('observable-controller.ts', {
  '$lib/state/store': { get(source) { let value;const stop=source.subscribe(next=>value=next);typeof stop==='function'?stop():stop.unsubscribe();return value; } }
});
const drain = async () => { await Promise.resolve(); await Promise.resolve(); };

test('controller guards see changes synchronously while React subscribers receive one atomic batch', async () => {
  class Model extends boundary.ObservableController {
    owner='alice'; generation=0;
    get identity() { return `${this.owner}:${this.generation}`; }
    replace(owner) { this.owner=owner;this.generation++; }
  }
  const model=new Model(), snapshots=[];model.subscribe(()=>snapshots.push(model.identity));const stop=model.activate();snapshots.length=0;
  assert.equal(model.identity,'alice:0');
  const change=model.replace;change('bob');
  assert.equal(model.identity,'bob:1','unbound callbacks retain their controller, and async guards do not wait for React');
  assert.deepEqual(snapshots,[]);await drain();assert.deepEqual(snapshots,['bob:1']);stop();
});

test('derived controller views invalidate when an external store changes', async () => {
  const source=store(1);
  class Model extends boundary.ObservableController { start() { this.watch(source); } get value() { return boundary.readStore(source)*2; } }
  const model=new Model();const stop=model.activate();assert.equal(source.count(),1);assert.equal(model.value,2);source.set(5);assert.equal(model.value,10);await drain();stop();assert.equal(source.count(),0);
});

test('React strict lifecycle restarts subscriptions once and retires queued notifications', async () => {
  const source=store(0);let starts=0,cleanups=0,notifications=0;
  class Model extends boundary.ObservableController { value=0;start() { starts++;this.watch(source);return()=>{cleanups++;}; } }
  const model=new Model();model.subscribe(()=>notifications++);const first=model.activate();first();const atStop=notifications;source.set(1);await drain();assert.equal(notifications,atStop);const second=model.activate();assert.equal(source.count(),1);assert.equal(starts,2);second();assert.equal(source.count(),0);assert.equal(cleanups,2);
});

test('reconciliation writes settle in the same publication without a notification loop', async () => {
  class Model extends boundary.ObservableController { value=0;reconcile() { if(this.value<0)this.value=0; } }
  const model=new Model();let count=0;model.subscribe(()=>count++);const stop=model.activate();count=0;model.value=-1;await drain();assert.equal(model.value,0);assert.equal(count,1);await drain();assert.equal(count,1);stop();
});

test('DOM ref updates never turn React callback-ref detach/attach into a rerender loop', async () => {
  const Original=globalThis.Element;
  globalThis.Element=class Element {};
  try { class Model extends boundary.ObservableController { element=null; } const model=new Model();let count=0;model.subscribe(()=>count++);const stop=model.activate();count=0;model.element=new Element();model.element=null;model.element=new Element();await drain();assert.equal(count,0);stop(); }
  finally { if(Original===undefined)delete globalThis.Element;else globalThis.Element=Original; }
});

function headerHarness() {
  const media={matches:false,addEventListener(){},removeEventListener(){}};
  const original=globalThis.window;globalThis.window={matchMedia:()=>media,location:{search:''}};
  const source=store('browser');
  const stores=Object.fromEntries(['booklistSortOptions$','cacheStorageData$','fileCountData$','fsStorageSource$','gDriveStorageSource$','isOnline$','oneDriveStorageSource$'].map(key=>[key,store(key==='booklistSortOptions$'?{browser:{property:'title',direction:'asc'}}:false)]));
  const { HeaderController }=load('header-controller.ts',{
    './observable-controller':boundary,
    '$lib/components/navigation/docs-link':{openUserGuide(){}},'$app/environment':{browser:true},'$app/paths':{resolve:x=>x},'$app/navigation':{goto(){}},
    '$lib/data/sort-types':{SortDirection:{ASC:'asc',DESC:'desc'}},
    '$lib/data/storage/handler/filesystem-handler':{FilesystemStorageHandler:{}},'$lib/data/storage/storage-handler-factory':{getStorageHandler(){}},'$lib/data/storage/storage-types':{StorageKey:{BROWSER:'browser',GDRIVE:'gdrive',ONEDRIVE:'onedrive',FS:'fs'}},
    '$lib/data/storage/storage-view':{isStorageSourceAvailable:()=>false,storageSource$:source},'$lib/data/store':stores,
    '$lib/functions/file-dom/input-allow-directory':{inputAllowDirectory(){}},'$lib/functions/file-dom/input-file':{inputFile(){}},'$lib/functions/utils':{isMobile$:store(false),isOnOldUrl:()=>false}
  });
  return { HeaderController, restore() { if(original===undefined)delete globalThis.window;else globalThis.window=original; } };
}
test('the active React header preserves IME text until composition ends, with external-navigation fencing', async()=>{
  const h=headerHarness();try{const model=new h.HeaderController(),queries=[];model.libraryMenu={search:{query:'',setQuery:q=>queries.push(q)}};const stop=model.activate();assert.equal(model.hydrated,true);model.searchCompositionStarted({currentTarget:{value:'に'}});model.searchInputChanged({currentTarget:{value:'日本'},isComposing:true});assert.deepEqual(queries,[]);model.searchCompositionEnded({currentTarget:{value:'日本語'}});assert.deepEqual(queries,['日本語']);
    model.searchCompositionStarted({currentTarget:{value:'途中'}});model.libraryMenu={search:{query:'new navigation',setQuery:q=>queries.push(q)}};model.flush();model.searchCompositionEnded({currentTarget:{value:'古い入力'}});assert.deepEqual(queries,['日本語']);assert.equal(model.searchDraft,'new navigation');stop();await drain();
  }finally{h.restore();}
});

test('unwatched synchronous store reads dispose function and object subscriptions', () => {
  for (const objectSubscription of [false, true]) {
    let stops = 0;
    const source = { subscribe(run) { run(42); return objectSubscription ? { unsubscribe() { stops++; } } : () => { stops++; }; } };
    assert.equal(boundary.readStore(source), 42); assert.equal(stops, 1);
  }
});
