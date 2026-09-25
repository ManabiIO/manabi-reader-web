"""Local speech backends for generated fixtures; never substitute another language.

Open JTalk uses installed dictionary/HTS voice files. pyopenjtalk is optional and
only admitted with an already installed dictionary, so discovery does not download
anything. All executable/model identities feed the fixture cache key.
"""
from dataclasses import dataclass
import hashlib
import importlib
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

DICT_FILES = ('char.bin', 'matrix.bin', 'sys.dic', 'unk.dic')
DICT_PATHS = (
    '/var/lib/mecab/dic/open-jtalk/naist-jdic',
    '/usr/share/open-jtalk/dic', '/usr/share/open_jtalk/dic',
    '/usr/local/share/open-jtalk/dic',
)
VOICE_PATHS = ('/usr/share/hts-voice', '/usr/local/share/hts-voice',
               '/usr/share/open-jtalk/voices', '/usr/share/open_jtalk/voices')


def sha256(path):
    hashed = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hashed.update(chunk)
    return hashed.hexdigest()


def checked_file(path, maximum):
    path = Path(path).expanduser().resolve(strict=True)
    if not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError(f'Invalid synthesis asset: {path.name}')
    return path


def dictionary_identity(path):
    path = Path(path).expanduser().resolve(strict=True)
    if not path.is_dir() or any(not (path / name).is_file() or not (path / name).stat().st_size for name in DICT_FILES):
        raise ValueError('Open JTalk needs its compiled UTF-8 dictionary, not a generic MeCab dictionary.')
    files = sorted(p for p in path.iterdir() if p.is_file())
    if len(files) > 128 or sum(p.stat().st_size for p in files) > 512 * 1024 * 1024:
        raise ValueError('Unexpectedly large Open JTalk dictionary')
    return path, {p.name: sha256(p) for p in files}


def voice_identity(path):
    path = checked_file(path, 64 * 1024 * 1024)
    with path.open('rb') as source:
        header = source.read(8192)
    if not re.search(rb'(?m)^FULLCONTEXT_FORMAT:HTS_TTS_JPN\s*$', header):
        raise ValueError(f'{path.name} is not a Japanese HTS voice')
    return path, {'name': path.stem, 'sha256': sha256(path)}


def output(command):
    return subprocess.check_output(command, text=True, encoding='utf-8', errors='strict',
                                   timeout=20, stderr=subprocess.STDOUT)


@dataclass
class Voice:
    name: str
    language: str
    identity: dict
    executable: str = ''
    voice: str = ''
    dictionary: str = ''

    def synthesize(self, text, destination):
        """Write a local audio file. The caller resamples and verifies the PCM."""
        destination = Path(destination)
        if self.name == 'say':
            command = [self.executable, '-v', self.voice, '-o', str(destination), '--', text]
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL, timeout=120)
        elif self.name == 'open-jtalk':
            command = [self.executable, '-x', self.dictionary, '-m', self.voice, '-ow', str(destination)]
            subprocess.run(command, input=text + '\n', encoding='utf-8', check=True,
                           stdout=subprocess.DEVNULL, timeout=120)
        elif self.name == 'pyopenjtalk':
            import numpy as np
            import wave
            module = importlib.import_module('pyopenjtalk')
            # Admission checked both assets before calling a lazy synthesizer.
            pcm, rate = module.tts(text)
            pcm = np.asarray(pcm)
            if pcm.ndim != 1 or not len(pcm) or not np.isfinite(pcm).all():
                raise ValueError('Japanese synthesizer produced invalid PCM')
            with wave.open(str(destination), 'wb') as target:
                target.setnchannels(1); target.setsampwidth(2); target.setframerate(int(rate))
                target.writeframes(np.clip(np.rint(pcm), -32768, 32767).astype('<i2').tobytes())
        else:
            subprocess.run([self.executable, '-v', self.voice, '-s', '145', '-w', str(destination), '--stdin'],
                           input=text + '\n', encoding='utf-8', check=True,
                           stdout=subprocess.DEVNULL, timeout=120)


def say_voice(language, preferred):
    executable = shutil.which('say') if platform.system() == 'Darwin' else None
    if not executable:
        raise ValueError('macOS say is unavailable')
    voices = []
    for line in output([executable, '-v', '?']).splitlines():
        match = re.match(r'^(.+?)\s+([a-zA-Z]{2,3}[-_][a-zA-Z]{2,4})\s+', line)
        if match and match[2].split('_')[0].split('-')[0].lower() == language:
            voices.append((match[1].strip(), match[2].replace('_', '-')))
    if not voices:
        raise ValueError(f'No installed {language} macOS voice')
    wanted = preferred or ('Kyoko' if language == 'ja' else 'Samantha')
    name, locale = next((v for v in voices if v[0] == wanted), sorted(voices)[0])
    return Voice('say', language, {'name': 'say', 'voice': name, 'language': locale,
        'os': platform.platform(), 'binarySha256': sha256(executable)}, executable, name)


def open_jtalk_voice(preferred, dictionary=None):
    executable = shutil.which('open_jtalk')
    if not executable:
        raise ValueError('open_jtalk is not installed')
    configured = dictionary or os.environ.get('OPEN_JTALK_DICT_DIR')
    candidates = [configured] if configured else DICT_PATHS
    dict_path = None
    dict_hashes = {}
    for candidate in candidates:
        try:
            dict_path, dict_hashes = dictionary_identity(candidate)
            break
        except (OSError, ValueError):
            if configured:
                raise
    if dict_path is None:
        raise ValueError('A complete Open JTalk Japanese dictionary is not installed')
    configured_voice = os.environ.get('OPEN_JTALK_VOICE')
    if preferred and (preferred.endswith('.htsvoice') or '/' in preferred):
        candidates = [Path(preferred)]
    elif configured_voice:
        candidates = [Path(configured_voice)]
    else:
        candidates = sorted({p for root in VOICE_PATHS if Path(root).is_dir()
                             for p in Path(root).rglob('*.htsvoice')})
        candidates.sort(key=lambda p: (p.stem != preferred, p.stem != 'nitech_jp_atr503_m001', str(p)))
    voice = identity = None
    for path in candidates:
        try:
            voice, identity = voice_identity(path)
            break
        except (OSError, ValueError):
            if configured_voice or (preferred and preferred.endswith('.htsvoice')):
                raise
    if voice is None:
        raise ValueError('No installed Japanese .htsvoice for Open JTalk')
    return Voice('open-jtalk', 'ja', {'name': 'open-jtalk', 'voice': identity,
        'language': 'ja-JP', 'dictionarySha256': dict_hashes, 'binarySha256': sha256(executable)},
        executable, str(voice), str(dict_path))


def pyopenjtalk_voice():
    module = importlib.import_module('pyopenjtalk')
    dictionary, hashes = dictionary_identity(os.fsdecode(module.OPEN_JTALK_DICT_DIR))
    voice, identity = voice_identity(os.fsdecode(module.DEFAULT_HTS_VOICE))
    package = Path(module.__file__).parent
    binaries = sorted(p for p in package.iterdir() if p.suffix in ('.so', '.pyd', '.py'))
    return Voice('pyopenjtalk', 'ja', {'name': 'pyopenjtalk', 'language': 'ja-JP', 'voice': identity,
        'version': getattr(module, '__version__', 'unknown'), 'dictionarySha256': hashes,
        'binarySha256': {p.name: sha256(p) for p in binaries}}, voice=str(voice), dictionary=str(dictionary))


def espeak_voice(language, preferred):
    for name in ('espeak-ng', 'espeak'):
        executable = shutil.which(name)
        if not executable:
            continue
        voices = []
        for line in output([executable, '--voices']).splitlines():
            fields = line.split()
            if len(fields) >= 5 and fields[0].isdigit() and fields[1].split('-')[0].lower() == language:
                voices.append((fields[1], fields[3]))
        if not voices:
            continue
        desired = preferred or ('en-us' if language == 'en' else 'ja')
        locale, label = next((v for v in voices if desired in v), sorted(voices)[0])
        version = output([executable, '--version']).strip()
        # eSpeak stores pronunciation data outside its executable. Include it when exposed.
        data = re.search(r'Data at:\s*(.+)', version)
        assets = {}
        if data and Path(data[1]).is_dir():
            path = Path(data[1]); total = 0
            for p in sorted(path.rglob('*')):
                if p.is_file():
                    total += p.stat().st_size
                    if total > 128 * 1024 * 1024:
                        raise ValueError('Unexpectedly large eSpeak voice data')
                    assets[str(p.relative_to(path))] = sha256(p)
        return Voice(name, language, {'name': name, 'voice': label, 'language': locale,
            'version': version, 'binarySha256': sha256(executable), 'dataSha256': assets}, executable, locale)
    raise ValueError(f'No installed {language} eSpeak/eSpeak NG voice')


def select_voice(language, preferred=None, engine='auto', dictionary=None):
    if language not in ('en', 'ja'):
        raise ValueError('Unsupported fixture language')
    factories = [('say', lambda: say_voice(language, preferred))]
    if language == 'ja':
        factories += [('open-jtalk', lambda: open_jtalk_voice(preferred, dictionary)),
                      ('pyopenjtalk', pyopenjtalk_voice)]
    factories += [('espeak', lambda: espeak_voice(language, preferred))]
    failures = []
    for name, factory in factories:
        if engine not in ('auto', name):
            continue
        try:
            return factory()
        except (OSError, ValueError, TypeError, ImportError, AttributeError, subprocess.SubprocessError) as exc:
            failures.append(f'{name}: {exc}')
    hint = ('Install open-jtalk, open-jtalk-mecab-naist-jdic and a Japanese HTS voice, '
            'or supply OPEN_JTALK_DICT_DIR / OPEN_JTALK_VOICE. ' if language == 'ja' else '')
    raise ValueError(f'No usable local {language} speech synthesizer. {hint}' + '; '.join(failures))
