# Optional chapter preprocessing

Status: foundation and lifecycle modules, NOT an enabled end-to-end product.
The public source builds without a proprietary module. A missing processor is not
a second reader mode: the identity provider follows the same interface and returns
no transformation, leaving source HTML unchanged with no sidecar/vocabulary.

## Opening contract

Resolve the resume chapter with TTU's existing character counts first. Preprocess
that chapter before reveal, sanitize it using the ordinary book security policy,
mount/validate its sidecar while hidden, bind renewable resources and restore
geometry, recheck generation, then reveal synchronously. Only after publication
should lower-priority processing advance through the rest of the book. Background
work fills derived caches/vocabulary and must never replace visible prose.

Cache identity includes the processor/release, engine fingerprint, original source
hash, stable book/chapter IDs, base/resource/context identity and explicit analysis
options. Dictionary/morphology/schema changes therefore invalidate semantic output.
The bounded IndexedDB cache is a separate derived database, not a change to book
or account storage. Cache failures do not prevent correct uncached reading.

Analyze stable imported `bookData.elementHtml` before the existing
`formatBookDataHtml` creates renewable Blob URLs. Bind media to each rendered
chapter's lifetime afterward; background analysis must not own the image gallery.

## Dictionary setup

Keep definition choices (for example Jitendex) independent of processing data.
Whenever the user selects any dictionary for installation, automatically include
deployment-supplied skeletal processing dependencies. The skeleton is not a
definition checkbox and full JMdict does not replace it. Empty/Not now performs
no installation. Processing receipts become ready only after immutable import,
semantic reopen/verification, atomic activation and readback.

`loadDeploymentManifest` reads the data-only setup catalogue without executing the
private plugin. `loadDeploymentPreprocessor` verifies module bytes before loading
and validates its versioned public contract. Missing optional configuration does
not fetch anything. Configured incompatible/corrupt code is an error, not a success
with zero processing. The setup component and vocabulary view are available for
the application's integration; their presence alone does not activate either.

The private Manabi implementation remains optional and separately deployed.
Manabitan remains the normal scanner/definition/popup path without that module and
owns its own dictionaries, audio and Anki UI.

## Validation and remaining integration

Run `node --test test/preprocessing/*.test.mjs`. The read-only preprocessing
workflow runs these contracts on every relevant change. Full repository lint and
static builds retain their existing workflows; these module tests do not stand in
for real-origin IndexedDB/Worker or installed-extension qualification.

The initial PR publication omitted loader/cache/setup files and most tests. Those
files are now restored. A one-shot branch-only job normalized them with the actual
repository tools and passed the restored module tests and full lint; its temporary
write-enabled workflow has been removed.

Still required: real paginated/continuous Svelte entry-point wiring, startup and
installation composition, private engine/morphology integration, source-to-render
resource mapping, and full browser/native parity qualification. Do not publish
unresolved private resource checksums or call the diagnostic WASM probe a product.
