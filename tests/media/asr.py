#!/usr/bin/env python3
"""Opt-in REAL MOSS inference gate. Missing runtimes are failures, never fake passes."""
import argparse, functools, hashlib, http.server, importlib.util, json, math, os, pathlib, re, threading, unicodedata
from playwright.sync_api import sync_playwright
from urllib.parse import urlsplit
ROOT=pathlib.Path(__file__).resolve().parents[2]
JFK_SHA256='59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e'
JFK_REFERENCE='And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.'
KOKORO_JA_GIT_BLOB='de24bc10ef845ef4bc418b1d14a850ddbdd56eae'
KOKORO_JA_REFERENCE='私 は 今度 も あるいは そう なる か も 知れ ない と 思っ た 。 しかし 医者 は'
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

def natural_upstream_fixture(path, language):
    """The pinned upstream source's real speech fixture and published transcript."""
    if language != 'en':
        raise ValueError('The pinned natural fixture is English')
    wave = pathlib.Path(path)/'speech.wav'
    if wave.is_symlink() or hashlib.sha256(wave.read_bytes()).hexdigest() != JFK_SHA256:
        raise ValueError('Pinned upstream natural speech hash does not match')
    return {'fingerprint': JFK_SHA256, 'engine': {'name': 'upstream-natural-jfk', 'language': 'en'},
            'files': {'speech.wav': JFK_SHA256}, 'cues': [{'text': JFK_REFERENCE}]}

def natural_kokoro_fixture(path, language):
    """Pinned public-domain Kokoro/LibriVox Japanese reading and transcript."""
    if language != 'ja':
        raise ValueError('The pinned Kokoro fixture is Japanese')
    wave = pathlib.Path(path)/'speech.wav'
    if wave.is_symlink():
        raise ValueError('Pinned Kokoro speech must be a regular file')
    data = wave.read_bytes()
    # GitHub's immutable source tree identifies this binary with the canonical
    # Git blob hash; retain SHA-256 separately in result evidence.
    header = b'blob ' + str(len(data)).encode() + b'\0'
    if hashlib.sha1(header + data).hexdigest() != KOKORO_JA_GIT_BLOB:
        raise ValueError('Pinned Kokoro Japanese speech hash does not match')
    fingerprint = hashlib.sha256(data).hexdigest()
    return {'fingerprint': fingerprint,
            'engine': {'name': 'kokoro-public-domain-librivox', 'language': 'ja'},
            'files': {'speech.wav': fingerprint},
            'cues': [{'text': KOKORO_JA_REFERENCE}]}

def validate_streaming_metrics(result):
    """Real runtime evidence must include actual callbacks, not only final recognition."""
    if type(result) is not dict:
        raise ValueError('Invalid real MOSS streaming result')
    cues=result.get('cues')
    if type(cues) is not list or not cues or any(type(cue) is not dict for cue in cues):
        raise ValueError('Missing parsed real MOSS cues')
    count=result.get('partialUpdates')
    if type(count) is not int or count < 1:
        raise ValueError('Real MOSS emitted no streaming output callbacks')
    total=result.get('inferenceSeconds')
    if type(total) not in (int,float) or not math.isfinite(total) or total <= 0:
        raise ValueError('Invalid real MOSS inference duration')
    for name in ('firstOutputSeconds','firstPreviewCueSeconds'):
        value=result.get(name)
        # A single final cue has no following opening tag to disambiguate its
        # end timestamp during preview. Explicit null is honest; omission is not.
        if name == 'firstPreviewCueSeconds' and name in result and value is None and len(cues) == 1:
            continue
        if type(value) not in (int,float) or not math.isfinite(value) or not 0 <= value <= total:
            raise ValueError('Missing or invalid '+name)
    if result['firstPreviewCueSeconds'] is not None and result['firstPreviewCueSeconds'] < result['firstOutputSeconds']:
        raise ValueError('Preview cue precedes the first output callback')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True,type=pathlib.Path);parser.add_argument('--language',choices=['en','ja'],required=True);parser.add_argument('--threaded',action='store_true');parser.add_argument('--repeat',type=int,choices=[1,2],default=1);parser.add_argument('--max-cer',type=float,default=.35);natural=parser.add_mutually_exclusive_group();natural.add_argument('--upstream-jfk',action='store_true');natural.add_argument('--kokoro-japanese',action='store_true');parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
    valid_cer(args.max_cer)
    if args.upstream_jfk:
        fixture=natural_upstream_fixture(args.fixture,args.language)
    elif args.kokoro_japanese:
        fixture=natural_kokoro_fixture(args.fixture,args.language)
    else:
        fixture=fixture_metadata(args.fixture,args.language)
    mode='threaded' if args.threaded else 'single'
    for suffix in ['mjs','wasm']:
        if not (ROOT/f'apps/web/static/moss/{mode}/moss.{suffix}').exists():raise SystemExit('Real WASM runtime is missing; build tools/media/build-moss.py before running this gate.')
    expected=' '.join(cue['text'] for cue in fixture['cues'])
    Handler.threaded=args.threaded;Handler.fixture=args.fixture.resolve();server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox']);page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/tests/media/asr-harness.html?fixture=/__fixture__');page.wait_for_function('window.ready')
            attempts=[]
            for _ in range(args.repeat):
                page.evaluate('window.result = null; window.failure = null')
                page.get_by_role('button',name='Generate transcript',exact=True).click();page.wait_for_function('window.result || window.failure',timeout=30*60*1000);failure=page.evaluate('window.failure')
                if failure:raise RuntimeError(failure)
                result=page.evaluate('window.result')
                if result.get('crossOriginIsolated') is not args.threaded: raise AssertionError('Runtime isolation does not match the requested CPU variant')
                validate_streaming_metrics(result)
                actual=' '.join(cue['text'] for cue in result['cues']);cer=distance(normalize(expected),normalize(actual))/max(1,len(normalize(expected)))
                if cer>args.max_cer:raise AssertionError('Recognition exceeds the configured character-error threshold')
                if not attempts:first_result=result
                attempts.append({'prepareSeconds':result['prepareSeconds'],'inferenceSeconds':result['inferenceSeconds'],'realTimeFactor':result['realTimeFactor'],'characterErrorRate':cer,'partialUpdates':result['partialUpdates'],'firstOutputSeconds':result['firstOutputSeconds'],'firstPreviewCueSeconds':result['firstPreviewCueSeconds']})
            browser.close()
        result=first_result
        result['fixture']={'fingerprint':fixture['fingerprint'],'language':args.language,'engine':fixture['engine'],'speechSha256':fixture['files']['speech.wav']}
        result['runtimeVariant']=mode
        result['characterErrorRate']=attempts[0]['characterErrorRate'];result['attempts']=attempts;result['expected']=expected;result['kind']='real CPU WASM inference; not a test double';args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
        print(json.dumps({k:result[k] for k in ['characterErrorRate','inferenceSeconds','realTimeFactor','prepareSeconds','attempts']}))
    finally:server.shutdown()
if __name__=='__main__':main()
