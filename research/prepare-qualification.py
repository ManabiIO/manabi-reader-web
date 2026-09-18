from pathlib import Path

p=Path('research/finish-reader.py');s=p.read_text()
s=s.replace("displayedHtml = html;''')))","displayedHtml = html;'''))")
start=s.index('def replication(s):');end=s.index("edit('apps/web/src/lib/functions/replication/replicator.ts',replication)",start)
end+=len("edit('apps/web/src/lib/functions/replication/replicator.ts',replication)")
s=s[:start]+s[end:]
exec(compile(s,str(p),'exec'))
p=Path('apps/web/src/lib/functions/replication/replicator.ts');s=p.read_text()
s=s.replace("import pLimit from 'p-limit';\n",'')
start=s.index('  return replicateData(',s.index('export async function importBackup('));end=s.index('\n}',start)
old=s[start:end].replace('  return replicateData(', '    return await replicateData(').replace('await sourceHandler.setBackupZip(file)','contexts')
s=s[:start]+'''  try {
    const contexts = await sourceHandler.setBackupZip(file, cancelSignal);
'''+old+'''
  } finally {
    await sourceHandler.closeBackupZip();
  }'''+s[end:]
s=s.replace('  const replicationLimiter = pLimit(1);\n','').replace('  const replicationTasks: Promise<void>[] = [];','  const replicationTasks: Array<() => Promise<void>> = [];')
s=s.replace('      replicationLimiter(async () => {','      async () => {').replace('      })\n    )\n  );','      }\n    )\n  );').replace('      })\n    );','      }\n    );').replace('[replicationLimiter],','undefined,')
old='  await Promise.all(replicationTasks).catch(() => {});'
assert s.count(old)==1
s=s.replace(old,'''  for (const task of replicationTasks) {
    if (cancelSignal?.aborted) break;
    try {
      await task();
    } catch (error) {
      if (cancelSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) break;
      throw error;
    }
  }''')
p.write_text(s)
p=Path('test/reader/e2e/run.mjs');s=p.read_text()
s=s.replace("import {runFontAcceptance} from './font-acceptance.mjs';", "import {runFontAcceptance} from './font-acceptance.mjs';\nimport {runBackupAcceptance} from './backup-acceptance.mjs';")
s=s.replace("    await close('reader-second-session');", "    await runBackupAcceptance({page, origin, fixtures, check, books, openBook});\n    await close('reader-second-session');")
p.write_text(s)
