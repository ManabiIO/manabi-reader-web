"""Pinned upstream fixture; not a dictionary bundled into the Reader shell."""
import hashlib
import json
import pathlib
import sys
import urllib.request
import zipfile

root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
size=15595643
digest='b895d0fa41324d5bdd7bd0a943e73b46d25f849ddab6e0491e619bfc4e4e20d9'
url='https://github.com/yomidevs/jmdict-yomitan/releases/download/2026-09-18/JMdict_english.zip'
path=root/'JMdict_english.zip'
if not path.exists():
    try:
        with urllib.request.urlopen(url,timeout=90) as response,path.open('wb') as output:
            count=0
            while data:=response.read(256*1024):
                count+=len(data)
                if count>size:raise ValueError('JMdict fixture exceeds the pinned size')
                output.write(data)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
raw=path.read_bytes()
assert len(raw)==size
assert hashlib.sha256(raw).hexdigest()==digest
with zipfile.ZipFile(path) as z:
    index=json.loads(z.read('index.json'))
    rows=sum(len(json.loads(z.read(name))) for name in z.namelist() if name.startswith('term_bank_') and name.endswith('.json'))
assert rows==527095
meta={'repository':'yomidevs/jmdict-yomitan','release':'2026-09-18','asset':path.name,'bytes':size,'sha256':digest,'termRows':rows,'index':index}
(root/'jmdict.json').write_text(json.dumps(meta,indent=2))
print(json.dumps(meta))
