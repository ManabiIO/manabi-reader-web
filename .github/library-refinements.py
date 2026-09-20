from pathlib import Path

def edit(path, old, new):
    p = Path(path)
    source = p.read_text()
    assert source.count(old) == 1, (path, old[:100], source.count(old))
    p.write_text(source.replace(old, new))

edit('apps/web/src/lib/library/book-cover.svelte', '  .right-bound .binding {', '  .cover-stage[data-direction="unknown"] .binding {\n    display: none;\n  }\n  .right-bound .binding {')
edit('apps/web/src/lib/library/cover-stack.svelte', '$: visible = books.slice(0, hero ? 5 : 2);', '$: visible = Array.from(new Map(books.map((book) => [book.key, book])).values()).slice(0, hero ? 5 : 2);')
edit('apps/web/src/lib/library/cover-stack.svelte', '{#each visible as book, index (index)}', '{#each visible as book, index (book.key)}')
p = Path('tests/browser/test_books_library.py')
s = p.read_text().replace('import os\n', 'import os\nimport re\n')
s = s.replace(".to_have_class('shelf-item series-item')", ".to_have_class(re.compile(r'\\bseries-item\\b'))")
p.write_text(s)
