# Import from Ttu Ebook Reader

## User flow

In Book Manager, choose **Import from Ttu Ebook Reader**. The page gives three
export steps and accepts one or more ZIP files. Preview their books and included
data, select what to import, and start. No account or access to the old cloud
library is required. Source ZIPs are read only.

Supported data: parsed books (text, images, chapters), bookmarks, per-day reading
statistics, audiobook playback position, subtitles and separately exported
Reading Goals. Audio files and original EPUB archives are not reconstructed.
Provider credentials, filesystem handles, source bindings and unrelated settings
are not imported. Old wire names such as `ttu-reader-data` and `bookdata_1_6_…`
remain import/compatibility identifiers, not Manabi product branding.

## Partial and repeated imports

Books may be imported in several exports, and several exports can be selected
at once. A Book Data package establishes content identity. A later data-only
export requires an explicit previously migrated destination with the same source
title; it cannot silently attach by filename to a normal local/cloud-linked book.

Identity hashes the decoded book and embedded media, excluding ZIP compression,
container timestamps, and browser-local row IDs. Different content with the same
title is a separate copy. Bookmark IDs and statistic titles are remapped to the
chosen local book. Day statistics are snapshots: never add two copies together.

Each book's accepted record receipts are committed with its data in one existing
IndexedDB transaction. Repeating an accepted source record does not undo later
Manabi edits or resets. Newer source data applies automatically only if the
previously imported destination record is unchanged. Conflicts abort the whole
book import; an explicit per-book action can select imported reading records.
Omitted days/types do not imply deletion. Older batches do not roll back a later
accepted source snapshot. Reading-goal date overlaps require resolution rather
than modifying unrelated goals.

Receipts are local migration metadata, not a new cloud protocol. Replacing a
book through an unrelated legacy restore, or deleting the migrated book record,
can remove its receipt. Unknown prior copies are preserved separately rather
than merged on title alone. This importer does not convert coarse reading totals
into native word coverage, sessions or other analytics they cannot establish.

## Atomicity, cancellation and archive boundaries

Preview indexes filenames only; payloads are decoded one book at a time. The UI
renders 50 preview rows per page. Cancellation aborts the current archive read
or unfinished book transaction; completed books remain available and can be
re-imported safely. Errors are shown per item. Archive-level errors can require
re-exporting the affected ZIP; a bad item is never called a successful import.

The existing bounded ZIP reader enforces actual output limits, CRC checks,
relative unambiguous paths, duplicate-entry rejection and cancellation. Import
only accepts the supported exporter/database version (1/6). Imported HTML/CSS
uses the production book sanitizer with image references restricted to declared
archive blobs. No active content or provider URL becomes trusted by migration.

Current bounds per export: 8 GiB compressed, 32 GiB cumulative decoded output
(including nested book packages), 100,000 entries, 32 MiB metadata reads. Existing
per-book bounds remain: 256 MiB compressed/decoded, 64 MiB media entry, 16 MiB text,
8,192 entries. These are upper limits, not a claim that every device can process
an 8 GiB export. Browser storage quotas still apply; smaller batches are valid.
Long statistics can import locally beyond the separate 64 KiB managed-cloud
state limit. This does not remove that cloud-sync limitation.

## Qualification

The migration browser suite makes its source ZIP using the actual retained
export UI and serializers, then imports through the production static app.
Tests use real Chromium, IndexedDB, input files and a static HTTP server; they
never intercept fetch or substitute the importer/database. Intentional malformed
archives and alternative snapshots are explicit fixture data.

Coverage includes bulk/multi-file selection, optional data and goals, data-only
follow-up, repeat/repacked ZIPs, local edits/deletion, older snapshots, atomic
conflicts, different-content title collisions, hostile restored content, longer
day histories, preview paging, cancellation, and a sparse >1 GiB valid container.
The sparse case proves seekable container access beyond the old limit, not a
multi-gigabyte decompression or memory-usage benchmark. Record actual passing
workflow revisions in the PR before treating the suite as qualified.

The native Manabi account/cloud bridge and cloud publication of migrated parsed
books remain separate product work. Migration does not authorize old Ttu cloud
libraries, change OAuth scopes, or imply native/web cloud interoperability.
