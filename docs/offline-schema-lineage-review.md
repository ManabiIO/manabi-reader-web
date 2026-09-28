# Offline database lineage repair

Review base: `d0afc6fab0530c597e68b5345ab28ab138d16ac1`, after merged #48 and #68.
This is independent of #69's source/ownership caller-boundary work.

## Why another local version is required

Version 7 has two historical shapes. The byte-storage release at `248f1fc3`
used version 7 with the legacy stores only. Later reader features created six
annotation/identity stores only when `oldVersion < 7`. A byte-only version-7
installation therefore bypassed them. A fresh installation did not expose this
error. Versions 3 and 4 also skipped later legacy stores because the old switch
handled only one version step, not the full upgrade path.

Changing the old guards alone cannot repair a database already advanced to
version 11. Local version **12** runs one additive, presence-based schema check
for every supported lineage, including already-incomplete version 11. It creates
only missing stores/indexes. Compatible stores, key generators, extension
stores/indexes and all their records remain intact. Incompatible required key
paths or index options abort rather than dropping/recreating stored data.

The local book representation remains `reader-bytes-v1`. **Portable Ttu wire
version 8 is unchanged.** This does not rewrite EPUBs, change reading identities,
merge history, decode book images, or request account/provider access.

## Upgrade failure is not successful storage

The `idb` upgrade callback is an event callback; its returned promise is not
awaited by IndexedDB. The prior asynchronous v2 migration could reject after
parsing while its transaction continued. The factory now observes transaction
completion before work begins and explicitly aborts on synchronous schema errors
or asynchronous conversion failures. The rejected open retains the original
conversion error. Version, schema, and request writes roll back together.

The v2 converter no longer silently ignores an invalid recognized book record
and deletes its original store. It awaits the recent-book write and tolerates
absence of localForage's optional Blob-detection store. Its dictionaries have
null prototypes so a legitimate `__proto__` resource key cannot disappear.
This repair does not reconstruct bytes already lost from a legacy native Blob;
those still require the original source.

## Qualification

`test/reader/books-schema-cases.mjs` contains an independent expected schema and
historical fixtures, not a copy of the new installer's definitions. The same
cases run with fake-indexeddb in Node and native IndexedDB in Chromium, Firefox
and WebKit. Cases cover fresh/skip upgrades, both version-7 lineages, v8-v11,
incomplete v11 stores/indexes, extension records, preserved native/encoded image
bytes, stable keys, second reopening, malformed v2 rollback/retry and incompatible
schema rollback. Failures remain failures; no retry turns them into passes.

Commands:

```sh
node --experimental-strip-types --test tests/unit/books-schema-upgrade.test.mjs
node test/reader/build-schema-fixture.mjs
python tests/browser/test_books_schema_upgrade.py --browser chromium
python tests/browser/test_books_schema_upgrade.py --browser firefox
python tests/browser/test_books_schema_upgrade.py --browser webkit
```

The native fixture loads the actual production database factory. It does not
pretend to be a full Reader application. Existing production-build, compiled-app
offline restart, recovery, migration, and Library gates remain enabled.

Initial local evidence used the full old/new factory with controlled schema
objects: four old-factory failures, twelve repaired schema paths passing. That
is a component/schema-model result, not native browser execution. Exact-head CI
results are recorded in the PR rather than borrowed from earlier revisions.

The baseline main run already fails the WebKit empty-library offline case with
an access-control page error while fetching the optional public OPDS catalogue.
Its image-bearing restart reports pass. That independent failure is not evidence
against byte recovery and is not waived by this schema repair. Physical Safari,
OS eviction, and multi-version tabs remain distinct qualification boundaries.

## Primary references

- https://www.w3.org/TR/IndexedDB-3/ (upgrade transactions and atomic rollback)
- https://github.com/jakearchibald/idb (upgrade callback and transaction lifetime)
