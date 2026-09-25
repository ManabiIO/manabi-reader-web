# Optional chapter preprocessing

Status: foundation patch, NOT an enabled end-to-end product integration.
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
Do not persist renewable Blob URLs; analyze stable imported source and bind media
to the render lifetime afterward.

## Dictionary setup

Keep definition choices (for example Jitendex) independent of processing data.
Whenever the user selects any dictionary for installation, automatically include
deployment-supplied skeletal processing dependencies. The skeleton is not a
definition checkbox and full JMdict does not replace it. Empty/Not now performs
no installation. Processing receipts become ready only after immutable import,
semantic reopen/verification, atomic activation and readback.

The private Manabi implementation remains optional and separately deployed.
Manabitan remains the default/fallback popup scanner/definitions path and owns
its own dictionaries, audio and Anki UI.

## Remaining integration

The helpers in this PR still need the real paginated/continuous Svelte entry-point
wiring, complete deployment loader/cache plumbing, and production private WASM
provider qualification. Do not claim end-to-end preprocessing from this PR alone.
