# Sparse publication ordering and browser assertion review

Reviewed `ba9e7ed72480dee91d6000e53a558ea15992c69b` and its exact media
workflow source tree `94ac6fa1361a5fc94bac85a86ebf67e5e31ec945`.
The reverted frozen-page experiment remains reverted. This follow-up does not
change the model, WASM, worker lifetime, lock ownership, sparse policy or audio.

## Fixed publication boundary

The durable completed-job summary deliberately has no sparse windows or cues.
Workspace job refresh can deliver it before the independently refreshed caption
pages. The player previously interpreted absent windows as no active generation
and resumed playback even though the matching completed transcript was not visible.

A version-3 compact completion now remains in finalization until the exact job's
complete track is present. Unrelated tracks and an incomplete track do not clear
the wait. The old draft stays visible; Play without captions and explicit authored
subtitle selection still override the wait. Stale running progress cannot restart
the elapsed-time timer after the matching complete track has appeared.

Four focused production-controller/Chromium cases reproduce the old failures and
pass after the repair. They use generated MP4 bytes and a storage double, not native
IndexedDB or real recognition. Existing controller cases continue to run separately.

## Corrected native-browser assertions

Five existing media assertions passed async functions directly to Playwright's
synchronous `wait_for_function` predicate: overlay preference persistence, Off/seek
persistence, abandoned-tab admission, successor completion, and Svelte reload state.
A Promise could satisfy truthiness before the requested state was true. Locally,
`wait_for_function('async () => false')` returned a handle containing false.

The shared `wait_for_async` helper starts at most one pending read, checks only its
settled boolean value, propagates rejection, and retains Playwright's host timeout.
A query that never resolves cannot hang an unbounded `page.evaluate` loop. There is
no page-global polling state or timer; a late result after timeout schedules no
more reads. A static regression disallows direct async predicates in media runners.

Ten actual Chromium tests exercise false and truthy-nonboolean values, never-settling
queries, eventually true results, arguments, sync/async errors, non-overlap and late
resolution. Three tooling tests enforce validation and the no-async-predicate rule.
The existing native browser/application checks now use this helper and must be
rerun in CI; earlier runs are not retroactively counted as this stronger evidence.

The shared-admission Node test also accepts an already-running/completed successor
when Node has no Web Locks. It still rejects a paused or cancellation-requested peer;
it no longer assumes a browser-only scheduling order on Node 22.

## Verification boundary

Local TypeScript 5.8.3 compilation and the fixture-enabled media suite pass:
558 tests, no failures/skips. Python/native helpers: 77 pass. The four new controller
regressions fail on pre-fix code and pass on the refined controller. The full local
controller composition was 83/83 before splitting the four new tests into their
focused runner; the unchanged general runner remains 79 cases. Async polling:
10/10 native Chromium checks pass. No new real-MOSS quality or speed result is claimed.

The local native-IDB runner was blocked at localhost navigation by
`ERR_BLOCKED_BY_ADMINISTRATOR`. That restriction was not bypassed. Exact-head CI
results for native storage, the Svelte application, and the integrated build are
recorded separately on the PR.

## Research and outstanding release work

[Playwright's frame implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/frames.ts)
and [Python Page documentation](https://playwright.dev/python/docs/api/class-page)
distinguish polling predicate truthiness from awaiting a returned Promise.
[Chrome's lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
requires care with freezable tasks and held resources. The
[Web Locks specification](https://www.w3.org/TR/web-locks/)
does not make preempting a lock proof that its previous model owner released resources.

Keep the PR draft. Resource-safe frozen-tab takeover, unresolved adjacent/oversized
bounded repairs, broader natural Japanese dialogue/video evaluation, controlled
performance/memory, physical Safari/iOS, production serving and live provider
qualification remain open. No lock stealing, fabricated caption timing, background
completion promise, merge, or deployment is introduced by this change.
