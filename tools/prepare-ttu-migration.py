"""One-time asserted UI edits; commit the reviewed output and remove this file."""
from pathlib import Path
import json
import subprocess

changed = set()

def replace(path, old, new, count=1):
    file = Path(path)
    content = file.read_text()
    assert content.count(old) == count, (path, old, content.count(old))
    file.write_text(content.replace(old, new))
    changed.add(path)

root = 'apps/web/src/'
p = root + 'lib/components/book-card/book-manager-header.svelte'
replace(p, 'const importMenuItems = [mergeEntries.FILE_IMPORT];', 'const importMenuItems = [mergeEntries.FILE_IMPORT, mergeEntries.TTU_IMPORT];')
replace(p, "label: 'GDrive'", "label: 'Google Drive'")
replace(p, '    switch (event.detail) {', '    switch (event.detail) {\n      case mergeEntries.TTU_IMPORT.label:\n        break;')
replace(p, 'class="w-28 bg-surface-raised"', 'class="w-40 bg-surface-raised"')
replace(root + 'lib/components/book-export/book-export-dialog.svelte', "label: 'GDrive'", "label: 'Google Drive'")
replace(root + 'lib/components/settings/settings-storage-source.svelte', "label: 'GDrive'", "label: 'Google Drive'")
p = root + 'lib/components/book-export/book-export-selection.svelte'
replace(p, '<label for="bookstatistic">Audiobook</label>', '<label for="audioBook">Audiobook</label>')
replace(p, '<label for="bookstatistic">Subtitles</label>', '<label for="subtitle">Subtitles</label>')
p = root + 'lib/components/merged-header-icon/merged-entries.ts'
replace(p, '  BACKUP_IMPORT:', "  TTU_IMPORT: { routeId: '/import-ttu', label: 'Import from Ttu Ebook Reader', icon: faFileZipper, title: 'Import from Ttu Ebook Reader' },\n  BACKUP_IMPORT:")
for path in ('lib/components/merged-header-icon/merged-header-icon.svelte', 'lib/manabi/shared-library.ts', 'lib/manabi/ttu-folder-contract.ts', 'routes/shared-library/+page.svelte'):
    p = Path(root + path)
    content = p.read_text()
    assert 'TTU' in content
    content = content.replace('TTU Reader', 'Ttu Ebook Reader').replace('TTU', 'Ttu Ebook Reader')
    if path.endswith('merged-header-icon.svelte'):
        content = content.replace('class="w-44 bg-surface-raised"', 'class="w-64 max-w-[80vw] bg-surface-raised"')
    p.write_text(content)
    changed.add(str(p))
replace('tests/browser/test_shared_ttu.py', 'published in TTU format', 'published in Ttu Ebook Reader format')
replace(root + 'routes/import-ttu/+page.svelte', 'rows = [...rows];', 'rows = rows.map((item) => item.key === row.key ? { ...row } : item);', 2)
p = 'tests/browser/test_ttu_migration.py'
replace(p, "['data','bookmark','statistic','audioBook','subtitle'],'readwrite'", "['data','bookmark','statistic','audioBook','subtitle','lastModified'],'readwrite'")
replace(p, "                    tx.objectStore('audioBook').put", "                    tx.objectStore('lastModified').put({title:book.title,dataType:'statistic',lastModifiedValue:stamp});\n                    tx.objectStore('audioBook').put")
changed.update([root + 'lib/manabi/ttu-migration-format.ts', root + 'lib/manabi/ttu-migration.ts', root + 'routes/import-ttu/+page.svelte', 'tests/unit/ttu-migration.test.mjs'])
paths = sorted(changed)
code = [p for p in paths if p.endswith(('.ts', '.svelte', '.mjs'))]
subprocess.run(['pnpm', 'exec', 'prettier', '--write', *code], check=True)
Path('review').mkdir(exist_ok=True)
Path('review/generated-files.json').write_text(json.dumps([{'path':p, 'content':Path(p).read_text()} for p in paths]))
