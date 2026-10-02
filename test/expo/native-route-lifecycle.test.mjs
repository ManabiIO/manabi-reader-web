/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const React = require('react'); const { act } = React;
const { JSDOM } = require('jsdom'); const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, __DEV__: false });
const { createRoot } = require('react-dom/client');
const directory = mkdtempSync(join(tmpdir(), 'native-route-ui-'));
const fixture = join(directory, 'fixture.tsx');
writeFileSync(fixture, `
import React, {useEffect,useImperativeHandle,useSyncExternalStore} from 'react';
export const appListeners=new Set(),backListeners=new Set(),routeListeners=new Set();
export const AppState={addEventListener(_,fn){appListeners.add(fn);return{remove(){appListeners.delete(fn)}}}};
export const BackHandler={addEventListener(_,fn){backListeners.add(fn);return{remove(){backListeners.delete(fn)}}}};
export const View=({children,pointerEvents})=><div data-reader-visible={pointerEvents==='auto'?'true':pointerEvents==='none'?'false':undefined}>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const ActivityIndicator=({accessibilityLabel})=><span aria-label={accessibilityLabel}/>;
export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;
export const StyleSheet={create:x=>x};
export const calls=[],navigationCalls=[],dispatched=[];let guard;let location={path:'/b',params:{id:'1'}};let props;let handler=async()=>undefined;
export function setHandler(next){handler=next}
export function changeRoute(path,params={}){location={path,params};for(const fn of routeListeners)fn()}
export function usePathname(){return useSyncExternalStore(fn=>{routeListeners.add(fn);return()=>routeListeners.delete(fn)},()=>location).path}
export function useGlobalSearchParams(){return useSyncExternalStore(fn=>{routeListeners.add(fn);return()=>routeListeners.delete(fn)},()=>location).params}
function go(type,path){navigationCalls.push({type,path});const url=new URL(path,'https://native.test');changeRoute(url.pathname,Object.fromEntries(url.searchParams))}
export const router={push:path=>go('push',path),replace:path=>go('replace',path)};
export const useNavigation=()=>({dispatch(action){dispatched.push(action);go('dispatch','/manage')}});
export function usePreventRemove(prevent,callback){useEffect(()=>{guard=prevent?callback:undefined;return()=>{guard=undefined}},[prevent,callback])}
export function removeRoute(){guard?.({data:{action:{type:'POP'}}})}
export const getDocumentAsync=async()=>({canceled:true});export class File{};export const openBrowserAsync=async()=>{};
export async function snapshot(next){await props.onSnapshot(next)}
export async function hostError(message){props.dom.onReaderHostError({nativeEvent:{message}})}
export async function navigate(path){await props.onNavigate(path)}
export function reset(){calls.length=0;navigationCalls.length=0;dispatched.length=0;handler=async()=>undefined;guard=undefined;changeRoute('/b',{id:'1'})}
export default function Host(next){props=next;useImperativeHandle(next.ref,()=>({execute(request){calls.push(request);Promise.resolve().then(()=>handler(request)).then(value=>next.onReply({...request,ok:true,outcome:'completed',value:value??(request.method==='close'?{allowed:true}:{bookId:request.payload.bookId})}),error=>next.onReply({...request,ok:false,outcome:'unknown',error:error.message}))}}));return <div data-reader-host/>}
`);
const outfile = join(directory, 'runtime.cjs');
await build({ stdin: { contents: `export * from './apps/web/src/platform/RuntimeProvider.native';export {default as ReaderRoute} from './apps/web/src/app/b';export * from 'runtime-fixture';`, resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', tsconfig: 'apps/web/tsconfig.json', logLevel: 'silent', plugins: [{ name: 'native-host-seams', setup(b) {
  b.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
  b.onResolve({ filter: /^(react-native|expo-router(?:\/react-navigation)?|expo-document-picker|expo-file-system|expo-web-browser|runtime-fixture)$/ }, () => ({ path: fixture }));
  b.onResolve({ filter: /reader-runtime\.dom$/ }, () => ({ path: fixture }));
} }] });
const runtime = require(outfile);
const baseSnapshot = { session: 'session-0001', epoch: 0, revision: 1, books: [], settings: [], account: { status: 'local' }, loading: false };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes; reject=no; });return {promise,resolve,reject}; };
const flush = async () => { await act(async () => { for(let i=0;i<12;i++)await Promise.resolve() }); };
async function mount({ path='/b', params={id:'1'}, handler, ready=true }={}) {
  runtime.reset(); runtime.changeRoute(path,params); if(handler)runtime.setHandler(handler);
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let context;
  function Probe(){context=runtime.useReaderRuntime();return React.createElement(runtime.ReaderRoute)}
  await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(runtime.RuntimeProvider,null,React.createElement(Probe)))));
  if(ready)await act(async()=>runtime.snapshot(baseSnapshot)); await flush();
  return { container, get context(){return context}, visible:()=>container.querySelector('[data-reader-visible="true"]')!==null, close:async()=>{await act(async()=>root.unmount());container.remove();await flush()} };
}
test('mounted StrictMode provider hydrates /b once; duplicate snapshots do not reopen',async()=>{
  const view=await mount();try{
    assert.equal(runtime.calls.filter(call=>call.method==='open').length,1);assert.equal(view.visible(),true);assert.equal(view.container.querySelectorAll('[data-reader-host]').length,1);
    await act(async()=>runtime.snapshot({...baseSnapshot,revision:2}));await flush();assert.equal(runtime.calls.filter(call=>call.method==='open').length,1);assert.equal(runtime.backListeners.size,1);assert.equal(runtime.appListeners.size,1);
  }finally{await view.close()}assert.equal(runtime.backListeners.size,0);assert.equal(runtime.appListeners.size,0);
});
test('mounted native route transition preserves DOM until save succeeds',async()=>{
  const save=deferred();const view=await mount({handler:req=>req.method==='close'?save.promise:undefined});try{
    await act(async()=>runtime.changeRoute('/settings'));await flush();assert.equal(view.visible(),true);assert.equal(runtime.calls.filter(call=>call.method==='route').length,0);
    await act(async()=>save.resolve({allowed:true}));await flush();assert.equal(view.visible(),false);assert.equal(view.container.querySelectorAll('[data-reader-host]').length,1);assert.equal(runtime.calls.at(-1).payload.path,'/settings');
  }finally{await view.close()}
});
test('mounted repeated hardware Back cannot close or navigate twice',async()=>{
  const save=deferred();const view=await mount({handler:req=>req.method==='close'?save.promise:undefined});try{
    await act(async()=>{for(let i=0;i<3;i++)for(const fn of runtime.backListeners)assert.equal(fn(),true)});await flush();assert.equal(runtime.calls.filter(call=>call.method==='close').length,1);assert.equal(view.visible(),true);assert.equal(runtime.navigationCalls.length,0);
    await act(async()=>save.resolve({allowed:true,destination:'/manage'}));await flush();assert.equal(runtime.navigationCalls.filter(call=>call.type==='replace').length,1);assert.equal(view.visible(),false);
  }finally{await view.close()}
});
test('mounted prevent-remove guard waits for close and dispatches original action once',async()=>{
  const save=deferred();const view=await mount({handler:req=>req.method==='close'?save.promise:undefined});try{
    await act(async()=>{runtime.removeRoute();runtime.removeRoute()});await flush();assert.equal(runtime.calls.filter(call=>call.method==='close').length,1);assert.equal(runtime.dispatched.length,0);
    await act(async()=>save.resolve({allowed:true}));await flush();assert.deepEqual(runtime.dispatched,[{type:'POP'}]);assert.equal(view.visible(),false);
  }finally{await view.close()}
});
test('cancelled native route change restores URL and preserves DOM admission',async()=>{
  const view=await mount({handler:req=>req.method==='close'?{allowed:false}:undefined});try{
    await act(async()=>runtime.changeRoute('/statistics'));await flush();assert.equal(view.visible(),true);assert.deepEqual(runtime.navigationCalls,[{type:'replace',path:'/b?id=1'}]);assert.equal(runtime.calls.filter(call=>call.method==='open').length,1);
  }finally{await view.close()}
});
test('malformed route renders actionable error instead of a blank reader',async()=>{
  const view=await mount({params:{id:['1','2']}});try{
    assert.equal(runtime.calls.some(call=>call.method==='open'),false);assert.match(view.container.textContent,/reader link is invalid/);assert.match(view.container.textContent,/Back to Library/);assert.equal(view.visible(),false);
  }finally{await view.close()}
});
test('host startup failure is actionable in the reader route',async()=>{
  const view=await mount({ready:false});try{
    await act(async()=>runtime.hostError('Secure host failed to start'));assert.match(view.container.textContent,/Secure host failed to start/);assert.match(view.container.textContent,/Back to Library/);
  }finally{await view.close()}
});
test('new session revokes reader and late retired-session snapshot cannot take ownership',async()=>{
  const view=await mount();try{
    await act(async()=>runtime.snapshot({...baseSnapshot,session:'session-0002',revision:1}));await flush();assert.equal(view.context.snapshot.session,'session-0002');assert.equal(view.visible(),false);assert.equal(runtime.calls.filter(call=>call.method==='open').length,1);
    await act(async()=>runtime.snapshot({...baseSnapshot,revision:999,epoch:999}));await flush();assert.equal(view.context.snapshot.session,'session-0002');assert.equal(view.visible(),false);
  }finally{await view.close()}
});
test('account retirement settles pending native close without waiting on old host',async()=>{
  const save=deferred();const view=await mount({handler:req=>req.method==='close'?save.promise:undefined});try{
    await act(async()=>{for(const fn of runtime.backListeners)fn()});await flush();assert.equal(view.visible(),true);
    await act(async()=>runtime.snapshot({...baseSnapshot,epoch:1,revision:2}));await flush();assert.equal(view.visible(),false);assert.equal(view.context.snapshot.epoch,1);assert.equal(runtime.navigationCalls.length,1);
    await act(async()=>save.resolve({allowed:true}));await flush();assert.equal(runtime.navigationCalls.length,1);
  }finally{await view.close()}
});
test('DOM-confirmed exit does not invoke a second close',async()=>{
  const view=await mount();try{
    await act(async()=>runtime.navigate('/manage'));await flush();assert.equal(view.visible(),false);assert.equal(runtime.calls.filter(call=>call.method==='close').length,0);
  }finally{await view.close()}
});
test('unmount while bridge open is pending fences late success and releases listeners',async()=>{
  const load=deferred();const view=await mount({handler:req=>req.method==='open'?load.promise:undefined});await view.close();await act(async()=>load.resolve({bookId:1}));await flush();assert.equal(runtime.backListeners.size,0);assert.equal(runtime.appListeners.size,0);
});
test.after(()=>{rmSync(directory,{recursive:true,force:true});dom.window.close()});
