from pathlib import Path
import base64,gzip,hashlib,json
raw=gzip.decompress(base64.b64decode(''.join(Path(f'research/reader-units-{i}.b64').read_text().strip() for i in (1,2)),validate=True))
assert hashlib.sha256(raw).hexdigest()=='6bc1632f33e704832253f99fce574cafbfbcc252357802229fcfa4452ddd47ad'
entries=json.loads(raw)
assert len(entries)==6
for entry in entries:
    p=Path(entry['path']);assert str(p).startswith('test/reader/') and '..' not in p.parts
    p.parent.mkdir(parents=True,exist_ok=True);p.write_text(entry['content'])
p=Path('test/reader/e2e/run.mjs');s=p.read_text()
s=s.replace("const root = path.resolve(process.env.READER_BUILD);", "const appBase = process.env.READER_BASE_PATH ?? '/Reader-Web';\nassert.match(appBase, /^(?:\\/[A-Za-z0-9_-]+)*$/);\nconst root = path.resolve(process.env.READER_BUILD);")
s=s.replace("url.pathname === '/__test-font-delay'", "url.pathname === appBase + '/__test-font-delay'")
s=s.replace("        const relative = decodeURIComponent(url.pathname).replace(/^\\/+/, '');", "        if (url.pathname !== appBase && !url.pathname.startsWith(appBase + '/')) { res.writeHead(404).end(); return; }\n        const relative = decodeURIComponent(url.pathname.slice(appBase.length)).replace(/^\\/+/, '');")
s=s.replace("const origin = 'http://127.0.0.1:4173';", "const origin = 'http://127.0.0.1:4173' + appBase;")
p.write_text(s)
p=Path('package.json');value=json.loads(p.read_text());value['scripts']['test:reader']='node test/reader/run.mjs';p.write_text(json.dumps(value,indent=2)+'\n')
# Quarantining the old deploy must be present in the published diff as well.
Path('.github/workflows/deploy.yml').unlink(missing_ok=True)
