# Manabi accounts and libraries

The app builds to static files under `/reader-web/`; Django provides optional
account and cloud-connection services. No SvelteKit server runs in production.
Local reading continues when the account API is unavailable or disabled.

## Independent choices

Accounts and libraries is available through the existing navigation menu.
Account preference sync, cloud/local book sources, and per-book progress/statistic
write-back are separate. Signing in alone does not upload books or enable sync.
Google Drive, OneDrive and Dropbox buttons reflect server-owned application
configuration. Readers consent normally instead of creating developer apps.
Selected roots constrain Manabi's access, not necessarily the broader permission
shown by the provider's OAuth consent screen.

Manabi preferences use real reactive Reader stores, an explicit portable schema,
account-partitioned pending edits and conditional revisions. Genuine conflicts
require a user choice. Tokens, folder handles, installed fonts, arbitrary
localStorage, custom theme definitions and key maps do not upload as settings.
Late responses cannot apply to a different signed-in account or reenable a sync
subscription that was disabled while a request was running.

## Books and local folders

Imports use existing parsers and the existing Reader database. Content hashes
and source IDs distinguish books; duplicate filenames/titles cannot silently
overwrite unrelated local data. The source book itself is never changed. The
existing advanced upstream storage/backup paths are retained, not migrated.

Local directory handles persist only in IndexedDB. Read access and write-back
permission are separate; reconnection prompts come from explicit button actions.
The `.manabi-reader` directory contains append-only reading-state revisions.
Concurrent heads are shown as conflicts and an explicit resolution joins the
observed heads rather than overwriting another device's copy. A local save does
not confirm that the OS has finished uploading an iCloud/other cloud folder.
Unsupported browsers retain individual file import/export.

Current integration bounds are 128 MiB per book, 64 KiB per state document, 5,000
local revision files per book, and 100 concurrent local heads. A bound or invalid
record produces an error without discarding local reading data. There is no
automatic history pruning; large-history partitioning needs a reviewed format
change. Google stores state in its private appDataFolder, OneDrive in its app
folder, and Dropbox in a managed sidecar under the selected root.

Imported/restored HTML and CSS are sanitized before entering the authenticated
origin. Browser tests cover hostile EPUB content, ruby and archive images. The
service worker caches Reader static resources, not account/provider responses,
and leaves other Manabi apps' caches alone. It does not force takeover of an open
reader. Bookmark saves wait for layout measurement rather than persisting a
negative/uninitialized position during startup.

## Verification and deployment

Install with `pnpm install --frozen-lockfile`; run SvelteKit sync and
`pnpm --dir apps/web check`; `pnpm build` produces `apps/web/build` with a
`404.html` fallback and `manifest.webmanifest`. Both CI workflows are read-only.

`tests/browser/test_static_reader.py` runs the real compiled artifact through
Chromium. `test_local_library.py` uses real FileSystemDirectoryHandle instances
and real files in Chromium's origin-private filesystem at the persisted handle
boundary; it does not replace browser methods or intercept requests. It tests
read-only import, original integrity, reload, write-back and concurrent records.
It does not prove native OS picker/permission dialogs or iCloud transfer.

The Django companion composes the exact frontend revision with genuine allauth,
PostgreSQL and an independently running stateful OAuth/storage fake. Vendor-wire
fakes separately exercise the real Google/Graph/Dropbox HTTP adapters. These are
not mocks, but they are also not a substitute for real provider-consent tests.

Deployment and operator setup are in `lake-of-fire/manabi` PRs #60 and #61,
including `docs/reader-web-provider-e2e.md`. Production credentials, provider
verification, native folder-picker qualification and cutover remain explicit
operator steps. Never put provider client secrets into public Vite variables.
