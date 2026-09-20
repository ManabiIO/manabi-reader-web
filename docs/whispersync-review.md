# Native Whispersync: deeper review and qualification record

Reviewed September 20, 2026. Integration base:
`ManabiIO/manabi-reader-web@c037fbec3911a10e90a3b94bf19443a484e7adc4`.
The untouched reader route was reconstructed from connector reads and checked
byte-for-byte against Git blob `a7ec587dfd4c677de8adba04313442c0568c7f12`
before making the integration changes. This was not a full local checkout.

## Reproduced failures and fixes

| Area | Reproduction | Fix / regression coverage |
| --- | --- | --- |
| Resume writes | Two checkpoints overlap; the first acknowledgement overwrites the second in-memory checkpoint. | Capture authoritative state before awaiting the write; fence only status updates by generation. Component-script tests defer and reorder acknowledgements. |
| Close/reselect | The live media clock advances between timeupdate and close/reselect. | Snapshot reads the current media clock; capture before clearing/loading. Controller and component-script tests cover both paths. |
| Initial load | Open fails, then an untouched panel closes and writes an empty record. | Dirty tracking prevents writes without a user/playback change. Subtitle parse errors retain independently valid audio metadata. |
| Play intentions | A first play promise rejects after a second attempt or deliberate pause. | Same-element intent generations ignore superseded completions, in addition to the per-element guard. |
| Media metadata | Early events or an unknown duration replace a pending resume with zero. | Retain pending seek until metadata, a finite positive duration and an accepted seek; retry on later readiness events. |
| Fatal media error | Decode error leaves playback/actions or a frame loop active. | Pause the element, disable readiness, cancel the frame and show a file error. |
| DOM lifetime | A middle node changes or text is inserted/reordered while endpoints remain intact. | Scoped observer plus synchronous takeRecords fencing invalidates the entire index. Disposal disconnects it. Real Chromium tests cover edits, insertion, reordering and hidden-state changes. |
| Unicode | Combining kana split across inline nodes does not match a normalized subtitle. | Segment the concatenated eligible source, then map graphemes back to original node offsets. Preserve the DOM. Greek contextual sigma folding is consistent. |
| Modal state | A drawer aria-hides an ancestor and matching sees an empty book. | Exclusion applies to authored descendants inside the book root, not modal-managed ancestors. |
| Matching completion | Playback remains in the same cue while async matching finishes, so the new highlight is never shown. | Reset the last-cue marker before updating. Unpublished/cancelled indexes are disposed. |
| Approximate results | A n-gram score of 1 is mislabeled exact; changed preferences retain old guesses. | Persist explicit approximate match kind, consider near-tied rivals and invalidate on policy changes. |
| Reset | Clearing data leaves transcript pagination beyond the empty/new transcript or receives stale save errors. | Reset pagination, invalidate reads/matching, fence older save completions and serialize removal after accepted writes. |
| Book switch | Raw metadata and completed HTML can refer to different books; old audio survives a pending book load. | Pair identity with the completed HTML emission and gate the keyed player on the requested route book ID. |
| Storage lifetime | Reads bypass queued writes; restricted getters throw during construction; blocked opens never settle. | Serialize reads/writes/deletes, defer the getter, bound opening, abort late upgrades and close late results. Eight deterministic queue/open tests supplement the native-IDB harness. |

The same new core tests run against the previous bundle first produced **10
failures** (40 old tests passed). The initial additional DOM cases produced
**6 failures** (11 old browser tests passed). The component-script harness against
the previous component produced **9 failures**. These are retained reproduction
observations, not a claim that every new test originally failed or that each test
represents a distinct defect.

## Local validation actually run

- **68/68 Node tests passed:** 50 core/controller/checkpoint tests, 10
  component-script orchestration tests and 8 deterministic storage-queue tests.
- Strict core TypeScript compilation passed with **TypeScript 5.8.3** on
  **Node 22.16.0**.
- **22/22 real Chromium DOM/media tests passed**, Chromium **144.0.7559.96**.
  These exercise actual DOM Ranges, MutationObservers and generated local WAV media.
- The reader route and both components compile for **client and server with zero
  warnings using Svelte 5.48.0**, a locally available compiler. This checks code
  generation, not import resolution or application type correctness.
- **Three native IndexedDB tests were not run locally.** Browser-origin navigation
  was blocked by the authoring environment; offline about:blank execution skips
  those tests explicitly. Deterministic queue tests are not a substitute for them.

The component-script harness transpiles the actual script block and supplies
controlled collaborators. It does **not** mount Svelte, simulate its reactivity,
validate Sheet/focus behavior, or qualify the complete reader UI.

## CI and readiness boundary

`.github/workflows/whispersync.yml` runs the feature tests with the repository's
Node/pnpm/TypeScript/Svelte dependencies, then the normal loopback-origin browser
harness **including native IndexedDB**. The repository's existing CI separately
runs lint, application typechecking, static build and existing browser acceptance.
Adding these jobs is not evidence that they have passed; inspect the exact PR head.

Before marking ready:

```sh
node test/whispersync/run.mjs --svelte --browser-bundle=/tmp/ws-browser/bundle.js
python test/whispersync/browser.py /tmp/ws-browser/bundle.js
pnpm eslint .
pnpm test:reader
pnpm --dir apps/web check
pnpm build
```

Use the repository-pinned Node 24.21.0, pnpm 12.3.4, TypeScript 6.0.3 and
Svelte 5.57.1, not the authoring machine's alternate toolchain. Full application
checks, lint and production build were not run locally. Keep the PR a draft until
these gates and the following actual-reader checks are complete:

Horizontal/vertical and paginated/continuous modes; touch safe areas and footer
layout; native keyboard controls and Sheet focus restoration; opening/closing while
playing; lazy chunk failure/retry; large supported audio; unsupported codecs;
normal autoplay/user-gesture policy; live resume during pause/close/file replacement;
route changes and cancelled imports/matches; storage denial/quota; reset with a
pending save; extension dictionary interaction. Qualify Safari/iOS and Firefox
where supported, not only Chromium.

## Remaining product boundaries

No new backend or application package dependency. Attribution and the original
MIT notice remain in source, UI, documentation and the shipped license file.
No GitHub fork, merge or deployment is needed for this change.

This is still a focused native adaptation, not full upstream parity: no Anki/audio
clip export, subtitle editing, playlist, automatic dictionary-popup pause,
filesystem-handle auto-reopen, userscript database migration or cross-device sync.
Audio is reselected after reopening. File identity is metadata, not a content hash.
Records are last-writer-wins across tabs and book deletion does not cascade to this
separate store. The limits and cleanup workflow are in `docs/whispersync.md`.
