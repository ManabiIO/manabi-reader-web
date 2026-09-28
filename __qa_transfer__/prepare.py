"""One-shot verified source transport; never included in the feature tree."""
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = Path.cwd()
EXPECTED_BASE = 'd53f42c80bdf805ba6c60fedada5d434100d74a8'
OUTPUT = Path('/tmp/search-quality-prepared')

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

manifest = json.loads(''.join((ROOT / '__qa_transfer__' / str(n)).read_text() for n in range(1, 6)))
assert manifest['base'] == EXPECTED_BASE
assert len(manifest['files']) == 15
paths = [row['path'] for row in manifest['files']]
assert len(set(paths)) == len(paths)
assert all(not Path(p).is_absolute() and '..' not in Path(p).parts and not p.startswith('__qa_transfer__') for p in paths)

if sys.argv[1] == 'prepare':
    assert git('rev-parse', 'HEAD^') == EXPECTED_BASE
    for row in manifest['files']:
        path = ROOT / row['path']
        assert (blob(path.read_bytes()) if path.exists() else None) == row['before'], row['path']
    compressed = base64.b64decode(manifest['patch'], validate=True)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        patch = stream.read(500001)
    assert len(patch) == 47922
    subprocess.run(['git', 'apply', '--index', '--whitespace=error', '-'], input=patch, check=True)
    assert set(git('diff', '--cached', '--name-only').splitlines()) == set(paths)
    for row in manifest['files']:
        assert blob((ROOT / row['path']).read_bytes()) == row['after'], row['path']
    formatted = [p for p in paths if Path(p).suffix in {'.ts', '.mjs', '.svelte', '.yml'}]
    subprocess.run(['pnpm', 'exec', 'prettier', '--write', *formatted], check=True)
    subprocess.run(['git', 'diff', '--check'], check=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for row in manifest['files']:
        data = (ROOT / row['path']).read_bytes()
        destination = OUTPUT / row['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        records.append({'path': row['path'], 'before': row['before'], 'sha': blob(data)})
    (OUTPUT / 'manifest.json').write_text(json.dumps({'base': EXPECTED_BASE, 'files': records}, indent=2))
    (OUTPUT / 'review.patch').write_bytes(subprocess.check_output(['git', 'diff', 'HEAD', '--', *paths]))
    print(json.dumps(records, indent=2))
elif sys.argv[1] == 'publish-blobs':
    records = json.loads((OUTPUT / 'manifest.json').read_text())['files']
    published = []
    for row in records:
        data = (OUTPUT / row['path']).read_bytes()
        assert blob(data) == row['sha']
        request = Request('https://api.github.com/repos/ManabiIO/manabi-reader-web/git/blobs',
            data=json.dumps({'encoding': 'base64', 'content': base64.b64encode(data).decode()}).encode(),
            headers={'Authorization': 'Bearer ' + os.environ['SOURCE_BLOB_TOKEN'],
                     'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'}, method='POST')
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
        assert result['sha'] == row['sha'], row['path']
        published.append({'path': row['path'], 'mode': '100644', 'type': 'blob', 'sha': row['sha']})
    (OUTPUT / 'published.json').write_text(json.dumps(published, indent=2))
    print(json.dumps(published, indent=2))
else:
    raise ValueError('Unsupported action')
