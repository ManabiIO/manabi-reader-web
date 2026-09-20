from pathlib import Path

def edit(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == 1, (path, old[:100], s.count(old))
    p.write_text(s.replace(old, new))

p = 'apps/web/src/lib/library/file-operations.ts'
edit(p, r'''  // eslint-disable-next-line no-control-regex
  if (
    parts.some(
      (p) => !p || p === '.' || p === '..' || p === '.manabi-reader' || /[\\\x00-\x1f\x7f]/.test(p)
    )
  )''', r'''  // Control characters and Windows separators must never enter a filesystem path.
  // eslint-disable-next-line no-control-regex
  const forbiddenCharacter = /[\\\x00-\x1f\x7f]/;
  if (parts.some((p) => !p || p === '.' || p === '..' || p === '.manabi-reader' || forbiddenCharacter.test(p)))''')
p = Path('tests/unit/library-files.test.mjs')
s = p.read_text(); assert s.count('structuredClone(') == 3
p.write_text(s.replace('structuredClone(', 'globalThis.structuredClone('))

edit('apps/web/src/lib/library/library-workspace.svelte', '<style>\n', '''<style>
  .search-box input {
    border: 0;
    border-radius: 0;
    padding-inline: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
  }
''')
