# Binary persistence follow-up review

Reviewed Codex commit `49e4058a6b7ac818c478f399c71cf0c6a5bd4cc8`, keeping its
`reader-bytes-v1` representation, local IndexedDB version 7 and portable Ttu
version 6. This follow-up integrates `main` at
`3e04c3e36122e2200851b637477ca013c3c034b0`, including the lowercase
`/reader-web/` deployment and user-guide build. It does not merge or publish the PR.

## Findings addressed

1. Binary preparation precedes the book-write transaction and its error wrapper.
   A native `AbortError` from `Blob.arrayBuffer()` therefore escaped as deliberate
   user cancellation. Preparation failures now carry their native cause inside
   an actionable save error. No partial record is written or missing bytes invented.
2. Already-encoded records were accepted without validation or byte ownership.
   Encoding and decoding now validate the marker, MIME string and ArrayBuffer;
   re-encoding copies the mutable buffer and strips undeclared fields. Repeated
   references to one Blob, including the cover, share a single read per encoding
   operation. Top-level fields and resource membership are captured before awaiting.
3. The Library used `getAll('data')`. With native Blobs replaced by ArrayBuffers,
   this eagerly materialized every book's binary content at once. It now projects
   cursor values immediately into card metadata and covers. This limits retained
   book-body data to the cursor's current record, not the whole library. A single
   large book and all library covers can still consume significant memory; this
   is not a measured speed claim or an arbitrary total-memory guarantee.
4. Updating last-read time encoded and replaced an old full Reader snapshot.
   The new transaction reads the latest record and changes only `lastBookOpen`,
   preserving newer content, receipt metadata and a newer timestamp. A deletion
   is not undone. No asynchronous byte reads run inside the transaction.

A timestamp update preserves the current binary representation. It is **not**
a legacy-media conversion or repair. Legacy native Blobs are converted on an
explicit content save/re-import, not just because the user reads a book. Already
unavailable legacy bytes still require the original source. This deliberately
avoids making an unrelated byte read a prerequisite for updating reading metadata.
The transaction still stores the full IndexedDB record; a separate metadata store
would require a wider schema change and is not introduced here.

## Tests and boundaries

Four added binary-preparation regressions failed against the Codex implementation
before these changes. Focused Node tests cover malformed records, native read
aborts, error causes, owned buffers, duplicate resources, cursor projection,
missing/newer records, transaction completion and request/transaction errors.
The metadata tests use controlled transaction collaborators, not a native-IDB
conformance claim.

The actual compiled-app test retains all prior stopped-origin, full-process
restart, decoded-image/hash, manifest, rollback and retry assertions. It also
checks that restored images are version-7 byte records, that reopening does not
read PNG Blob bytes merely to update last-read metadata, and that an injected
native binary-read abort is shown as an import failure and can be retried.
No failing browser assertion was skipped or turned into an expected failure.

Codex's prior browser qualification is recorded in `automatic-offline.md` and the
PR history. It is not reused as evidence for this follow-up head. The local review
checkout is partial; full types/build/native-browser qualification is performed
by the PR's exact-head CI. Physical iPhone, user eviction and large-library memory
benchmarks are not certified by these fixtures.

## References

- [idb transaction lifetimes and completion](https://github.com/jakearchibald/idb#transaction-lifetime)
- [Indexed Database API: transactions and cursors](https://w3c.github.io/IndexedDB/)
- [File API: Blob byte reads](https://w3c.github.io/FileAPI/#dom-blob-arraybuffer)
