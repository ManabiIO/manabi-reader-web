# Decoder retirement and independent native-handle qualification

Review date: 2026-09-28. Parent and child source compositions remain distinct.

## Decoder-session repair on parent #67

Commit `1fa060954d7ba241378f3de2f82b7fe01ac8314b` starts from actual parent
`c28e03578243f53ec3656169403e86ea9ab6affb`. Its two files are
`decode-session.ts` and `decode-session-retirement.test.mjs`.

The preceding cache could invoke a deferred factory after cancellation, await
an uncooperative decode after retirement, return its late PCM, reopen after
disposal, and orphan an entry if the caller mutated its job ID. The repair
checks cancellation before factory entry, detaches active calls using the
existing abortable helper, makes disposal terminal, and captures the admitted
ID for retirement. Owned pipeline references are cleared before cleanup.
Same-owner reuse and successor-owner separation remain unchanged. No ID-only
release API is introduced.

All sixteen new unchanged-API cases fail before the repair and pass afterward.
They cover four abort reasons, late success/failure, replacement, closure and
ID mutation. All six existing cases also pass: **22 passed, no failures/skips**.
Strict focused TypeScript and retained Prettier3.6.2 core checks pass. These use
controlled factories/decoders, not encoded-media decoding, MOSS inference,
physical memory reclamation or the full installed application.

## Independent profile jobs

Video run `36474614461` for #79 head `293d498b` tested merge
`c30660ae58bbcc03543652a3180906a6c7ccc983`, tree
`3e66c29d10123bd35d197f88f7bde7e307cc338b`. Artifact `10993162817` SHA-256 is
`61716e1479ee48a4654693b75e44a9c1e8b8d407c4e761911ca764f322598b9b`.
It reports 813 core cases (812 passed, one failed) and 98 Python cases passed.
The inherited decoder test's cleanup assertion prevented native qualification.
Parent `86cdcb00` already corrected that fixed-microtask-count test assumption;
this is not counted as a production defect fixed here.

Commit `69feecb89b4731212341185b7a1a33063ed960bb` separates the app-independent
handle probe from the application job. Persistent and Incognito profiles have
independent runners, no prerequisite job, no continue-on-error, and fail-fast
disabled. Both original production-import profiles remain required separately.
The driver retains its default of requiring both modes and accepts an explicit
mode for the matrix. It writes partial phase evidence before browser calls can
stall. A 120-second subprocess deadline with termination/kill fallback fails,
rather than passes, a stalled run. Five mocked driver/evidence tests pass; those
five tests do not exercise native storage.

## Pinned upstream-fix comparison

The matrix additionally runs the same probe with Chrome for Testing
**154.0.8037.57**, alongside the original Playwright1.63.0 bundled Chromium.
Both profiles remain hard gates on both engines. A Chrome154 success never
substitutes for a failure of the bundled browser.

Upstream commit `909a0222ba0f48ace3fd3a011b379dcd998871bb` adds an in-memory
handle-reference branch when reconstructing SQLite IndexedDB values
(bug562119515). Independently read tag `154.0.8037.57` contains that branch in
`content/browser/indexed_db/instance/sqlite/database_connection.cc`, blob
`3c9fb589aebf9f82d6c62bbc058084b0e9be9c99`. This is source inclusion evidence,
not execution of our probe against that binary.

The fixed-version Linux archive comes from the official distribution. CI checks
the executable-reported version and records archive/binary SHA-256 values plus
runtime browser and tested-source identities. These are recorded download
hashes, not verification against an independently published SHA-256. Browser
archives, profiles and model data are not uploaded. No new security flags,
private-mode detection, application serialization workaround or model change
is introduced.

Local Python, workflow shell syntax, matrix/failure-gate structure and formatter
checks pass. Native local navigation remains administrator-blocked and was not
bypassed. Native runs, whole-browser restart and the full installed application
matrix still require CI results. The upstream match is not marked solved before
those results exist.

Primary sources:

- https://github.com/chromium/chromium/commit/909a0222ba0f48ace3fd3a011b379dcd998871bb
- https://github.com/chromium/chromium/blob/154.0.8037.57/content/browser/indexed_db/instance/sqlite/database_connection.cc
- https://googlechromelabs.github.io/chrome-for-testing/154.0.8037.57.json
- https://playwright.dev/python/docs/release-notes
