#!/usr/bin/env python3
"""Generate/cache actual speech videos, without committing binary fixtures.

Japanese uses an installed same-language voice: say, Open JTalk, pyopenjtalk, or eSpeak NG.
Browser SpeechSynthesis is not used: its API exposes no recordable audio output.
"""
import argparse, hashlib, json, math, os, pathlib, re, shutil, subprocess, tempfile, wave
import array, contextlib, importlib.util, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
_voice_spec = importlib.util.spec_from_file_location('manabi_fixture_tts', pathlib.Path(__file__).with_name('fixture_tts.py'))
_voice_module = importlib.util.module_from_spec(_voice_spec)
sys.modules[_voice_spec.name] = _voice_module
_voice_spec.loader.exec_module(_voice_module)
select_voice = _voice_module.select_voice

def run(args): subprocess.run(args,check=True,stdout=subprocess.DEVNULL,timeout=120)

@contextlib.contextmanager
def fixture_lock(root, fingerprint):
    """Serialize validation, repair and publication, not just the final rename."""
    if not re.fullmatch(r'[a-f0-9]{64}', fingerprint):
        raise ValueError('Invalid fixture fingerprint')
    locks = root / '.locks'
    if locks.is_symlink():
        raise ValueError('Fixture lock directory must not be a symlink')
    locks.mkdir(parents=True, exist_ok=True)
    fd = os.open(locks / (fingerprint + '.lock'), os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        import fcntl  # Fixtures support the macOS and Linux development runners.
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)

def fixture_pcm(path, rate):
    with wave.open(str(path), 'rb') as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != rate or source.getcomptype() != 'NONE':
            raise ValueError('Fixture synthesis must produce mono signed 16-bit PCM')
        frames = source.getnframes()
        if not 0 < frames <= rate * 60:
            raise ValueError('Invalid fixture utterance duration')
        pcm = source.readframes(frames)
    if len(pcm) != frames * 2:
        raise ValueError('Truncated fixture speech')
    values = array.array('h', pcm)
    if sys.byteorder != 'little': values.byteswap()
    if max(abs(value) for value in values) <= 16 or sum(value != 0 for value in values) < 32:
        raise ValueError('The selected voice produced silence, not speech')
    return pcm

def validate_spec(spec, language):
    if type(spec) is not dict or spec.get('sampleRate') != 16000:
        raise ValueError('Fixture sampleRate must be 16000')
    for name in ('leadingSilence', 'sentenceGap'):
        value = spec.get(name)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 5:
            raise ValueError('Invalid fixture silence interval')
    by_language = spec.get('sentences')
    sentences = by_language.get(language) if type(by_language) is dict else None
    if type(sentences) is not list or not 2 <= len(sentences) <= 12 or any(
        type(text) is not str or not text.strip() or len(text) > 1000 or
        re.search(r'[\x00-\x08\x0b-\x1f\x7f\ud800-\udfff]', text) for text in sentences):
        raise ValueError('Fixtures need 2–12 non-empty sentences in the requested language')

def digest(path):
    hashed = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hashed.update(chunk)
    return hashed.hexdigest()

def expected_files(language):
    return {'speech.wav', 'video.mp4', 'embedded.mp4', 'embedded.mkv',
            'embedded-ass.mkv', f'video.{language}.srt', 'video.es.srt'}

def cached_fixture_valid(target, fingerprint, language):
    """A corrupt/missing manifest is a cache miss, never an empty successful fixture."""
    try:
        manifest = target / 'manifest.json'
        if target.is_symlink() or not target.is_dir() or manifest.is_symlink() or manifest.stat().st_size > 1024 * 1024:
            return False
        data = json.loads(manifest.read_text(encoding='utf-8'))
        if (type(data) is not dict or data.get('schemaVersion') != 2 or data.get('language') != language or data.get('fingerprint') != fingerprint or
                type(data.get('files')) is not dict or set(data['files']) != expected_files(language) or
                type(data.get('duration')) not in (int, float) or not math.isfinite(data['duration']) or
                not 0 < data['duration'] <= 300 or type(data.get('cues')) is not list or not 2 <= len(data['cues']) <= 12):
            return False
        previous = 0
        for cue in data['cues']:
            if type(cue) is not dict or set(cue) != {'start', 'end', 'text'}:
                return False
            start, end, text = cue['start'], cue['end'], cue['text']
            if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)) or
                    not previous <= start < end <= data['duration'] or type(text) is not str or
                    not text.strip() or len(text) > 1000 or re.search(r'[\x00-\x08\x0b-\x1f\x7f\ud800-\udfff]', text)):
                return False
            previous = end
        # Inspect only our exact, known output basenames; never paths supplied by a manifest.
        for name in expected_files(language):
            path = target / name
            checksum = data['files'][name]
            if (type(checksum) is not str or not re.fullmatch(r'[a-f0-9]{64}', checksum) or
                    path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 128 * 1024 * 1024 or
                    digest(path) != checksum):
                return False
        return True
    except (OSError, ValueError, UnicodeError, KeyError, TypeError, RecursionError):
        return False

def timestamp(seconds):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language',choices=('en','ja'),default='en')
    parser.add_argument('--voice', help='Preferred installed voice; automatic fallback stays in the requested language.')
    parser.add_argument('--engine', choices=('auto','say','open-jtalk','pyopenjtalk','espeak'), default='auto')
    parser.add_argument('--dictionary', help='Compiled UTF-8 Open JTalk dictionary directory')
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'.cache/media-fixtures')
    args=parser.parse_args()
    if not shutil.which('ffmpeg'):raise SystemExit('ffmpeg is required to generate fixtures.')
    spec=json.loads((ROOT/'tools/media/fixture-spec.json').read_text(encoding='utf-8'));spec['language']=args.language
    validate_spec(spec, args.language)
    try:
        voice = select_voice(args.language, args.voice, args.engine, args.dictionary)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    engine = dict(voice.identity)
    print('Fixture speech: ' + json.dumps({'engine': voice.name, 'voice': engine['voice'], 'language': engine['language']}, ensure_ascii=False), file=sys.stderr)
    engine['ffmpeg']=subprocess.check_output(['ffmpeg','-version'],text=True).strip()
    engine['ffmpegBinarySha256']=digest(pathlib.Path(shutil.which('ffmpeg')))
    fingerprint=hashlib.sha256(json.dumps({'spec':spec,'engine':engine,'script':digest(pathlib.Path(__file__)), 'ttsScript':digest(pathlib.Path(_voice_module.__file__))},sort_keys=True).encode()).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    with fixture_lock(args.output, fingerprint):
        target=args.output/fingerprint
        if cached_fixture_valid(target, fingerprint, args.language):
            print(target); return
        if target.is_symlink() or target.exists() and not target.is_dir():
            raise SystemExit('Refusing to replace a non-directory/symlink fixture cache entry.')
        if target.exists():
            shutil.rmtree(target)  # Only the generator-owned, fingerprint-named cache entry.

        args.output.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='fixture-',dir=args.output) as temp:
            work=pathlib.Path(temp);rate=spec['sampleRate'];samples=bytearray(b'\0\0'*round(rate*spec['leadingSilence']));cues=[]
            for index,text in enumerate(spec['sentences'][args.language]):
                raw=work/f'sentence-{index}.aiff' if voice.name=='say' else work/f'sentence-{index}-raw.wav';wav=work/f'sentence-{index}.wav'
                voice.synthesize(text, raw)
                run(['ffmpeg','-loglevel','error','-y','-i',str(raw),'-ar',str(rate),'-ac','1','-c:a','pcm_s16le',str(wav)])
                body = fixture_pcm(wav, rate)
                start=len(samples)/2/rate;samples.extend(body);end=len(samples)/2/rate;
                if end + spec['sentenceGap'] > 300: raise ValueError('Fixture exceeds five minutes')
                cues.append({'start':start,'end':end,'text':text});samples.extend(b'\0\0'*round(rate*spec['sentenceGap']))
            with wave.open(str(work/'speech.wav'),'wb') as output:output.setnchannels(1);output.setsampwidth(2);output.setframerate(rate);output.writeframes(samples)
            source='\n\n'.join(f'{i+1}\n{timestamp(c["start"])} --> {timestamp(c["end"])}\n{c["text"]}' for i,c in enumerate(cues))+'\n'
            (work/f'video.{args.language}.srt').write_text(source,encoding='utf-8')
            # Independent translation timing deliberately differs from source cue segmentation.
            (work/'video.es.srt').write_text(f'1\n{timestamp(cues[0]["start"])} --> {timestamp(cues[-1]["start"])}\nEste es un vídeo de prueba.\n\n2\n{timestamp(cues[-1]["start"])} --> {timestamp(cues[-1]["end"])}\nMañana iremos al parque.\n',encoding='utf-8')
            duration=len(samples)/2/rate
            run(['ffmpeg','-loglevel','error','-y','-f','lavfi','-i','color=c=0x1b454b:s=320x180:r=12','-i',str(work/'speech.wav'),'-t',str(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-metadata:s:a:0',f'language={"jpn" if args.language=="ja" else "eng"}','-movflags','+faststart',str(work/'video.mp4')])
            run(['ffmpeg','-loglevel','error','-y','-i',str(work/'video.mp4'),'-i',str(work/f'video.{args.language}.srt'),'-map','0:v','-map','0:a','-map','1:0','-c:v','copy','-c:a','copy','-c:s','mov_text','-metadata:s:s:0',f'language={"jpn" if args.language=="ja" else "eng"}','-movflags','+faststart',str(work/'embedded.mp4')])
            # Test real Matroska block timing, forced flags and independently segmented tracks.
            run(['ffmpeg','-loglevel','error','-y','-i',str(work/'video.mp4'),'-i',str(work/f'video.{args.language}.srt'),'-i',str(work/'video.es.srt'),'-map','0:v','-map','0:a','-map','1:0','-map','2:0','-c:v','copy','-c:a','copy','-c:s','srt','-metadata:s:s:0',f'language={"jpn" if args.language=="ja" else "eng"}','-metadata:s:s:1','language=spa','-disposition:s:1','forced',str(work/'embedded.mkv')])
            run(['ffmpeg','-loglevel','error','-y','-i',str(work/'video.mp4'),'-i',str(work/f'video.{args.language}.srt'),'-map','0:v','-map','0:a','-map','1:0','-c:v','copy','-c:a','copy','-c:s','ass','-metadata:s:s:0',f'language={"jpn" if args.language=="ja" else "eng"}',str(work/'embedded-ass.mkv')])
            keep=sorted(expected_files(args.language));data={'schemaVersion':2, 'language':args.language, 'fingerprint':fingerprint,'engine':engine,'duration':duration,'cues':cues,'files':{name:digest(work/name) for name in keep}}
            for file in work.iterdir():
                if file.name not in keep:file.unlink()
            (work/'manifest.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
            try:
                os.rename(work,target)
            except OSError:
                # A parallel generator may have published the same key. Never replace an
                # unexpected directory: accept only its complete checksum-verified fixture.
                if not cached_fixture_valid(target, fingerprint, args.language):
                    raise

    print(target)
if __name__=='__main__':main()
