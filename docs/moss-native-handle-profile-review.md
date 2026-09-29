# Native handle profiles and caption-offset handoff

Review date: 2026-09-28. Base: PR #79 at `2a8271e4`; profile probes are published
in `d428b030`. The accompanying offset repair changes `authored-track.ts` and
`player.ts`, not model/runtime bytes, queue policy, storage schema or activation.

## Native failure: evidence before changing application storage

Video workflow `36469259416`, evidence artifact `10992521363`, ran the exact
`2a8271e4` source tree. Artifact SHA-256:
`15902cda5d0bdb7fec1ab95c2b56975170e4e9f1508662bb5ff306b7781008ac`.

The 18 ordinary native import cases passed. The real OPFS handle case reached
initial handle registration and committed its alias. The subsequent transient
reimport logged `alias-update-admitted`, then the browser disconnected. It did
not reach `alias-existing-handle-read`. Thus the new evidence puts the failure
before delivery of the stored handle to the JavaScript callback, not inside
that callback's replacement write or the final reconnect assertion.

The recorded browser is HeadlessChrome 153; the runner uses Playwright's new
incognito context. Chromium issue 564001201 is a duplicate of 562119515, which
reports a browser crash reading FileSystemHandle from IndexedDB in M153's
SQLite in-memory backend. The public duplicate records normal-profile success
and private-profile failures, including on Linux. Upstream change 8408154 fixes
FSA handles in incognito profiles; its original revision is
`909a0222ba0f48ace3fd3a011b379dcd998871bb`.

This strongly matches our failure, but is not yet an independently demonstrated
root cause for our exact executable. No speculative application serialization
workaround, user-agent sniff, private-mode detector, browser downgrade, security
flag or weakened assertion was introduced.

## Profile comparison added to the existing workflow

`import-durability-browser.py` accepts an explicit profile mode and records the
browser version. The same 19 production import assertions run first in a fresh
persistent profile. A separate incognito step still runs all 19 and remains a
hard failure. Separating these steps allows later unrelated native-storage
suites to run without implicitly treating private-profile failure as a pass.

`native-handle-profile.py` imports no application code. It writes an OPFS file,
stores a real handle in IndexedDB, verifies the loaded entry and bytes, rewrites
the alias, and reloads the page. Persistent mode additionally closes the entire
browser and opens the same temporary profile before verifying again. Both
profile modes are independent and required; either failure makes the probe fail.
No profile, media or model data is uploaded as an artifact.

Local loopback navigation remains administrator-blocked and was not bypassed.
The new native probes have syntax checks only locally. Their actual results,
including restart behavior, must come from the recorded CI source/browser.
If persistent mode and its restart pass while the app-independent incognito
probe crashes at native read, that separates the browser regression from the
application's alias transformation. Private-profile compatibility must still
be verified with a patched browser; a persistent-profile pass alone cannot
clear that boundary.

## Caption-offset handoff defects fixed separately

Several equivalent temporary caption IDs can map to one saved authored track.
The old loop copied each offset in turn, so the final unselected duplicate
could overwrite the selected track's offset. A previously ambiguous temporary
track could also overwrite a more recently chosen saved offset when matching
became unique. Finally, an offset-only handoff while both selectors were Off
updated memory without immediately saving the portable state.

`remapTemporaryTrackDelays` resolves offsets as one grouped operation before
remapping the selectors. The selected transcript, then translation, owns its
value, including an implicit zero. An already selected saved identity keeps its
value. Unselected aliases never replace an existing saved offset; without one,
only agreeing explicit values can migrate. Conflicting unselected values have
no arbitrary winner. Retired temporary keys are removed without mutating the
caller's original map. A no-op retains the original map identity.

The player now saves an offset-only change as well as a selection handoff. It
preserves Off and the existing coalesced/conflict-fenced save path. Track matching,
cue text/times, model output and user-selected playback position are unchanged.

## Executed local results

- Strict media TypeScript/Node suite with generated English container fixtures:
  **807 passed; 0 failed, cancelled or skipped**.
- Python tooling/native-helper suite: **98 passed**.
- Existing production-player Chromium suite: **79 passed**.
- Existing production-workspace Chromium suite: **44 passed**.
- Transition/handoff browser suite: **14 passed** (10 retained, 4 new).

The same four new browser assertions on preceding production code produced
**3 failures and 1 pass**; all four pass after repair. Ten additional pure
helper tests are included in the 807 core count, not added to it. They cover
insertion order, selected/saved/default-zero authority, ambiguous unselected
values, translation independence and no-op identity.

Local execution uses a hash-verified media source subset, Node 22.16.0,
TypeScript 5.8.3, Playwright 1.57.0 and Chromium 144.0.7559.96. Browser controller
tests use real generated MP4 playback with explicit storage/decoder/recognition
doubles. Retained Prettier 3.6.2 core checks do not establish the full repository
formatter plugins/lint/Svelte/build matrix. No new real-model inference,
recognition quality, throughput or physical-device memory result is claimed.

## Primary references

- Chromium regression/duplicate: https://issuetracker.google.com/issues/564001201
- Upstream fix record (third-party mirror with original revision):
  https://chromium.googlesource.com/chromium/src/third_party/+/88f73d3f1f199b7a33dd694c152279c0eb57b563
- Playwright context semantics: https://playwright.dev/python/docs/api/class-browser#browser-new-context
- Persistent profiles: https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context
