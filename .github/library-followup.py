from pathlib import Path
root=Path('.')
def edit(path,old,new):
 p=root/path; s=p.read_text(); assert s.count(old)==1,(path,old[:90],s.count(old));p.write_text(s.replace(old,new))
p='apps/web/src/lib/data/storage/handler/base-handler.ts'
edit(p,"import type { Section } from '$lib/data/database/books-db/versions/v4/books-db-v4';\n",'')
edit(p,"""    const staticDataToZip: Array<
      Exclude<
        keyof Omit<BooksDbBookData, 'id'>,
        | 'blobs'
        | 'hasThumb'
        | 'coverImage'
        | 'characters'
        | 'lastBookModified'
        | 'lastBookOpen'
        | 'storageSource'
      >
    > = ['title', 'styleSheet', 'elementHtml', 'htmlBackup', 'sections'];
    const staticData: Record<string, string | Section[] | undefined> = {};""","""    const staticDataToZip = [
      'title', 'styleSheet', 'elementHtml', 'htmlBackup', 'sections', 'language', 'pageDirection'
    ] as const satisfies readonly (keyof BooksDbBookData)[];
    const staticData: Record<string, BooksDbBookData[(typeof staticDataToZip)[number]]> = {};""")
p='apps/web/src/lib/library/book-cover.svelte'
edit(p,'if (img.naturalHeight) ratio = img.naturalWidth / img.naturalHeight;', 'if (img instanceof HTMLImageElement && img.naturalHeight) ratio = img.naturalWidth / img.naturalHeight;')
edit(p,'    -webkit-line-clamp: 8;', '    line-clamp: 8;\n    -webkit-line-clamp: 8;')
p='apps/web/src/lib/library/cover-stack.svelte'
edit(p,'{#each visible as book, index}', '{#each visible as book, index (index)}')
p='apps/web/src/lib/library/library-workspace.svelte'
edit(p,'void goto(`${url.pathname}${url.search}`);', "void goto(`${resolve('/manage')}${url.search}`);")
edit(p,'{#each sortItems as item}', '{#each sortItems as item (item.property)}')
edit(p,'{#each warnings as warning}', '{#each warnings as warning, index (index)}')
edit(p,'{#each locals as local}', '{#each locals as local (local.id)}')
p='apps/web/src/lib/library/direction.ts'
edit(p,"export interface FlowSample {", """/** Only the authored/imported evidence shape crosses backup restoration. */
export function validDirectionEvidence(value: unknown): value is DirectionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every((key) => key === 'value' || key === 'source') &&
    (v.value === 'unknown' ? v.source === 'unknown' :
      (v.value === 'ltr' || v.value === 'rtl') && (v.source === 'spine' || v.source === 'content'));
}
export interface FlowSample {""")
p='apps/web/src/lib/functions/file-loaders/utils/restored-book.ts'
edit(p,"import { LimitedArchive, type ArchiveOptions } from './limited-archive';", "import { LimitedArchive, type ArchiveOptions } from './limited-archive';\nimport { validDirectionEvidence, type DirectionEvidence } from '$lib/library/direction';")
edit(p,'  language?: string;','  language?: string;\n  pageDirection?: DirectionEvidence;')
edit(p,'  const sections: Section[] = [];', "  if (value.pageDirection !== undefined && !validDirectionEvidence(value.pageDirection))\n    throw new Error('Invalid restored book page direction');\n  const sections: Section[] = [];")
edit(p,"    ...(value.language === undefined ? {} : { language: value.language as string })", "    ...(value.language === undefined ? {} : { language: value.language as string }),\n    ...(value.pageDirection === undefined ? {} : { pageDirection: value.pageDirection as DirectionEvidence })")
