"""Apply small, asserted integration edits before recording reviewed source objects."""
from pathlib import Path
import json

changed = []
def replace(path, old, new):
    p = Path(path)
    value = p.read_text()
    assert value.count(old) == 1, (path, old)
    p.write_text(value.replace(old, new))
    if path not in changed:
        changed.append(path)

root = 'apps/web/src/'
file = root + 'lib/components/settings/settings-storage-source.svelte'
replace(file, "  import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';", "  import { resolveTtuRoot } from '$lib/manabi/ttu-folder-contract';")
replace(file, "      directoryHandle = await dirHandle.getDirectoryHandle(BaseStorageHandler.rootName, {\n        create: true\n      });\n      handleFsPath = `${dirHandle.name === '\\\\' ? '' : `${dirHandle.name}/`}${\n        BaseStorageHandler.rootName\n      }`;", "      directoryHandle = await resolveTtuRoot(dirHandle, true);\n      handleFsPath = directoryHandle.name === dirHandle.name\n        ? directoryHandle.name\n        : `${dirHandle.name}/${directoryHandle.name}`;")
file = root + 'lib/data/storage/handler/filesystem-handler.ts'
replace(file, "import { throwIfAborted } from '$lib/functions/replication/replication-error';", "import { throwIfAborted } from '$lib/functions/replication/replication-error';\nimport { selectTtuFile, ttuPrefixes } from '$lib/manabi/ttu-folder-contract';")
replace(file, "    const file = files.find((entry) => entry.name.startsWith(fileIdentifier));", "    const file = selectTtuFile(files, fileIdentifier);")
replace(file, "            if (!files.length) {\n              return;\n            }", "            if (!files.length) {\n              return;\n            }\n            for (const prefix of ttuPrefixes) selectTtuFile(files, prefix);")
replace(file, "        .catch(() => {\n          // no-op\n        });", "        .catch((error: unknown) => {\n          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;\n          return undefined;\n        });")
file = root + 'lib/manabi/shared-library.ts'
replace(file, "    if (direction === 'import') {\n      const db = await database.db;", "    {\n      const db = await database.db;")
replace(file, "    database.dataListChanged$.next();", "    database.dataListChanged$.next(undefined);")
Path('review').mkdir(exist_ok=True)
extra = [root + 'lib/manabi/ttu-folder-contract.ts', root + 'lib/manabi/shared-library.ts',
         root + 'routes/shared-library/+page.svelte',
         root + 'lib/components/merged-header-icon/merged-header-icon.svelte']
Path('review/changed-paths.json').write_text(json.dumps(sorted(set(changed + extra))))
