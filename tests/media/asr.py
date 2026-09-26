#!/usr/bin/env python3
"""Opt-in REAL MOSS inference gate. Missing runtimes are failures, never fake passes."""
import argparse, functools, http.server, importlib.util, json, math, os, pathlib, re, threading, unicodedata
from playwright.sync_api import sync_playwright
from urllib.parse import urlsplit
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
    threaded=False
    fixture=None
    def translate_path(self,path):
        if urlsplit(path).path=="/__fixture__/speech.wav" and self.fixture is not None:
            return str(self.fixture/"speech.wav")
        return super().translate_path(path)
    def log_message(self,*args):pass
    def end_headers(self):
        if self.threaded:
            self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        super().end_headers()
def normalize(text):return ''.join(c for c in unicodedata.normalize('NFKC',text).lower() if unicodedata.category(c)[0] in 'LN')
def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        next_row=[i]
        for j,y in enumerate(b,1):next_row.append(min(next_row[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=next_row
    return row[-1]
def fixture_metadata(path, language):
    """Recognition evidence must refer to verified generated speech, not an arbitrary sidecar."""
    spec=importlib.util.spec_from_file_location('asr_fixture_generator',ROOT/'tools/media/generate-fixtures.py')
    generator=importlib.util.module_from_spec(spec);spec.loader.exec_module(generator)
    path=pathlib.Path(path)
    manifest=path/'manifest.json'
    if manifest.is_symlink() or manifest.stat().st_size>1024*1024:
        raise ValueError('Invalid fixture manifest')
    data=json.loads(manifest.read_text(encoding='utf-8'))
    if type(data) is not dict or not re.fullmatch(r'[a-f0-9]{64}',str(data.get('fingerprint',''))) or not generator.cached_fixture_valid(path,data['fingerprint'],language):
        raise ValueError('Fixture language, files or checksums do not match')
    engine=data.get('engine')
    if type(engine) is not dict or engine.get('name') not in ('say','open-jtalk','pyopenjtalk','espeak','espeak-ng') or type(engine.get('language')) is not str or engine['language'].split('-')[0]!=language:
        raise ValueError('Fixture voice does not match the requested recognition language')
    return data

def valid_cer(value):
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1:
        raise ValueError('Character-error threshold must be finite and between zero and one')
    return value

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True,type=pathlib.Path);parser.add_argument('--language',choices=['en','ja'],required=True);parser.add_argument('--threaded',action='store_true');parser.add_argument('--max-cer',type=float,default=.35);parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
    valid_cer(args.max_cer)
    fixture=fixture_metadata(args.fixture,args.language)
    mode='threaded' if args.threaded else 'single'
    for suffix in ['mjs','wasm']:
        if not (ROOT/f'apps/web/static/moss/{mode}/moss.{suffix}').exists():raise SystemExit('Real WASM runtime is missing; build tools/media/build-moss.py before running this gate.')
    expected=' '.join(cue['text'] for cue in fixture['cues'])
    Handler.threaded=args.threaded;Handler.fixture=args.fixture.resolve();server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox']);page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/tests/media/asr-harness.html?fixture=/__fixture__');page.wait_for_function('window.ready');page.get_by_role('button',name='Generate transcript',exact=True).click();page.wait_for_function('window.result || window.failure',timeout=30*60*1000);failure=page.evaluate('window.failure');
            if failure:raise RuntimeError(failure)
            result=page.evaluate('window.result');browser.close()
        if result.get('crossOriginIsolated') is not args.threaded: raise AssertionError('Runtime isolation does not match the requested CPU variant')
        result['fixture']={'fingerprint':fixture['fingerprint'],'language':args.language,'engine':fixture['engine'],'speechSha256':fixture['files']['speech.wav']}
        result['runtimeVariant']=mode
        actual=' '.join(cue['text'] for cue in result['cues']);result['characterErrorRate']=distance(normalize(expected),normalize(actual))/max(1,len(normalize(expected)));result['expected']=expected;result['kind']='real CPU WASM inference; not a test double';args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
        if len(result['cues'])<2:raise AssertionError('Expected at least two timestamped caption lines')
        if result['characterErrorRate']>args.max_cer:raise AssertionError('Recognition exceeds the configured character-error threshold')
        print(json.dumps({k:result[k] for k in ['characterErrorRate','inferenceSeconds','realTimeFactor','prepareSeconds']}))
    finally:server.shutdown()
if __name__=='__main__':main()
