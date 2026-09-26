#!/usr/bin/env python3
"""Real single-threaded MOSS WASM, no weights or recognition.

Instantiates verified, prebuilt bytes in an in-memory Chromium page. Tests the
actual exported ABI, memory and a tiny MEMFS error path. Does NOT qualify Worker
startup, URL/CSP loading, pthreads, inference, model memory or cancellation.
"""
import argparse
import base64
import functools
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True,
                        help='Verified single/ runtime directory containing build.json and WASM')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('runtime_artifacts', ROOT / 'tools/media/runtime_artifacts.py')
    artifacts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(artifacts)
    path = artifacts.check_path(args.runtime)
    manifest = artifacts.check_path(path / 'build.json')
    if not manifest.is_file() or manifest.stat().st_size > 65536:
        raise SystemExit('Missing or oversized runtime manifest.')
    metadata = json.loads(manifest.read_text())
    if type(metadata) is not dict or metadata.get('mode') != 'single':
        raise SystemExit('This in-memory runner only qualifies the single CPU variant.')
    # Reuse the production publication validator: required files, checksums,
    # unknown files, symlinks and WASM magic must all pass before executing bytes.
    metadata = artifacts.validate_mode(path, 'single', metadata.get('engineRevision'), metadata.get('ggmlCommit'))
    inputs = metadata.get('portSha256')
    expected_inputs = {'build-moss.py', 'bridge.cpp', 'manabi_web_hooks.hpp',
                       'runtime_artifacts.py', 'manabi_model_reader.hpp', 'model_loader_patch.py'}
    if type(inputs) is not dict or set(inputs) != expected_inputs:
        raise SystemExit('Runtime manifest does not cover the complete port inputs.')
    for name, digest in inputs.items():
        source = artifacts.check_path(ROOT / 'tools/media' / name)
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise SystemExit('Runtime input is not the checked source: ' + name)

    @functools.cache
    def module(name):
        source = (ROOT / '.cache/media-test-build' / name).read_text()
        source = re.sub(r'''(['"])(\./[^'"\n]+\.js)\1''',
                        lambda match: match[1] + module(match[2][2:]) + match[1], source)
        return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()

    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                                     headless=True, args=['--no-sandbox'])
        page = browser.new_page()
        page.set_content('<!doctype html><title>Real single CPU runtime contract</title>')
        results = page.evaluate('''async ({factory,wasm,contract}) => {
            const checks=[];
            const check=(name,condition)=>{if(!condition)throw Error(name);checks.push({name,passed:true});};
            try {
                const {assertRuntimeIdentity,assertRuntimeBindings}=await import(contract);
                const create=(await import(factory)).default;
                const bytes=Uint8Array.from(atob(wasm),c=>c.charCodeAt(0));
                const runtime=await create({wasmBinary:bytes,locateFile:p=>p,print:()=>{},printErr:()=>{}});
                assertRuntimeIdentity(runtime,false);
                check('compiled ABI and pinned engine/ggml identities',true);
                assertRuntimeBindings(runtime,false);
                check('actual runtime exposes required FS, heap and C bindings',true);
                const offset=runtime._moss_web_cancel_ptr();
                runtime._moss_web_begin(101);
                runtime.HEAP32[offset/4]=101;
                runtime._moss_web_begin(102);
                check('operation start does not erase an earlier cancellation token',runtime.HEAP32[offset/4]===101);
                const pointer=runtime._malloc(16000*4);
                check('actual PCM allocation has an aligned in-bounds heap view',pointer>0 && pointer%4===0 && pointer+64000<=runtime.HEAPF32.byteLength);
                runtime.HEAPF32[pointer/4]=0.25;
                check('allocated PCM is writable without replacing the runtime heap',runtime.HEAPF32[pointer/4]===0.25);
                runtime._free(pointer);
                runtime.FS.writeFile('/invalid-model.gguf',new TextEncoder().encode('GGUFnot-a-model'));
                let ctx;
                try {ctx=await runtime.ccall('moss_web_load','number',['string','number'],['/invalid-model.gguf',1],{async:true});}
                finally {runtime.FS.unlink('/invalid-model.gguf');}
                check('native model loader rejects invalid MEMFS bytes without a model context',ctx===0);
                return {checks};
            } catch(error) {return {checks,error:String(error.stack||error)};}
        }''', {
            'factory': 'data:text/javascript;base64,' + base64.b64encode((args.runtime / 'moss.mjs').read_bytes()).decode(),
            'wasm': base64.b64encode((args.runtime / 'moss.wasm').read_bytes()).decode(),
            'contract': module('moss-runtime-contract.js')
        })
        browser.close()
    results.update({'kind': 'real single MOSS WASM / in-memory Chromium page / invalid tiny GGUF, no model weights',
                    'runtime': metadata, 'notCovered': ['recognition', 'Worker startup/WORKERFS', 'pthread pool', 'model memory',
                    'real-model cancellation', 'native URL/CSP loading', 'Safari/iOS'],
                    'passed': len(results['checks']), 'failed': int('error' in results)})
    (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))
    if results['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
