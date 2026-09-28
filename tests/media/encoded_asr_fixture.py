"""Build a bounded encoded-video fixture from checksum-verified synthetic speech.

Two copies at offsets 0 and 30 seconds exercise multiple sparse windows. This is
an artificial timing/recovery fixture, never claimed to be continuous dialogue.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import wave

from asr import fixture_metadata

OFFSETS = (0, 30)
RATE = 16000
MAX_VIDEO_BYTES = 16 * 1024 * 1024


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compose_pcm(pcm, cues):
    if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > RATE * 25 * 2:
        raise ValueError('Encoded fixture requires at most 25 seconds of verified PCM')
    duration = len(pcm) / (RATE * 2)
    if not cues or any(not 0 <= cue['start'] < cue['end'] <= duration for cue in cues):
        raise ValueError('Fixture reference lies outside verified audio')
    out = bytearray((OFFSETS[-1] * RATE * 2) + len(pcm))
    expected = []
    for offset in OFFSETS:
        at = offset * RATE * 2
        out[at:at + len(pcm)] = pcm
        expected.extend({**cue, 'start': cue['start'] + offset, 'end': cue['end'] + offset} for cue in cues)
    return bytes(out), expected


def build_fixture(source, output, language):
    source, output = Path(source), Path(output)
    manifest = fixture_metadata(source, language)
    with wave.open(str(source / 'speech.wav'), 'rb') as stream:
        if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (1, 2, RATE, 'NONE'):
            raise ValueError('Expected verified mono PCM16 at 16 kHz')
        if not 0 < stream.getnframes() <= RATE * 25:
            raise ValueError('Speech fixture exceeds encoded-test budget')
        pcm = stream.readframes(stream.getnframes())
        if len(pcm) != stream.getnframes() * 2:
            raise ValueError('Truncated verified PCM')
    composed, cues = compose_pcm(pcm, manifest['cues'])
    output.mkdir(parents=True, exist_ok=True)
    if output.is_symlink() or any((output / name).is_symlink() for name in ('reference.wav', 'video.webm', 'manifest.json')):
        raise ValueError('Encoded fixture destinations cannot be symlinks')
    with wave.open(str(output / 'reference.wav'), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        stream.writeframes(composed)
    duration = len(composed) / (RATE * 2)
    subprocess.run([
        'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
        'color=c=black:s=160x90:r=10', '-i', str(output / 'reference.wav'),
        '-t', str(duration), '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
        '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-b:a', '96k',
        '-metadata:s:a:0', 'language=' + ('jpn' if language == 'ja' else 'eng'),
        str(output / 'video.webm')
    ], check=True, timeout=120)
    video = output / 'video.webm'
    if not 0 < video.stat().st_size <= MAX_VIDEO_BYTES:
        raise ValueError('Encoded video exceeds the fixture byte budget')
    result = {
        'version': 1, 'kind': 'two-copy synthetic speech with a gap, not natural dialogue',
        'language': language, 'sourceFingerprint': manifest['fingerprint'],
        'sourceSpeechSha256': manifest['files']['speech.wav'],
        'duration': duration, 'offsets': list(OFFSETS), 'cues': cues,
        'videoSha256': sha256(video), 'videoBytes': video.stat().st_size,
        'referenceSha256': sha256(output / 'reference.wav'),
        'encoder': subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
    }
    (output / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return result
