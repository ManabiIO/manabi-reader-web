# Migration CI coverage and storage boundary

This is a qualification plan, not a record that the current source passed. Step
outcomes and per-suite logs for the exact recorded source commit are the evidence.
A skipped, timed-out, interrupted or never-started suite is **unqualified**. Green
results from an older commit do not qualify this revision.

## Execution boundary

- Only `ManabiIO/manabi-reader-web` and its own
  `feat/expo-android-web-migration` head are admitted. The event repository must
  explicitly identify public visibility and a boolean `private: false`.
- The migration workflow runs for matching pull requests and manual dispatches,
  not duplicate push events. Three stock `ubuntu-24.04` jobs run independently:
  regression plus default web, gated web, and Android. No larger, paid or self-hosted class is selected.
- Legacy automatic workflows suppress this exact repository/head combination at
  **job admission**, including direct branch pushes, before allocating runners.
  Their existing definitions still apply to other branches and external
  contributors, including forks using the same branch name. Suppression does not
  depend on visibility; making the repository private cannot enable old jobs for
  automatic migration path. Manual dispatch retains each original workflow's
  behavior, including its existing artifact/cache steps; those legacy workflows
  must not be dispatched as part of this zero-storage qualification. The
  main-only publication workflow and manual-only MOSS custody workflow are
  unchanged. The redundant migration-only `web-reader-lifetime.yml` is removed;
  its original lifetime and Library assertions run in the colocated web job.
- There are no Actions artifact uploads/downloads, cache actions, reusable
  workflows, local composite actions or cross-job files in `expo-migration.yml`.
  `pnpm/action-setup` explicitly has `cache: false` and `run_install: false`.
  Node/Python/Java setup has no cache input. Gradle runs directly without a cache
  action. Browser profiles, installed dependencies, exports, APKs, screenshots,
  diagnostic JSON and normal tool caches exist only on that disposable runner.
  Nothing here changes storage quotas, account settings or existing artifacts.
- Evidence persists only as ordinary workflow logs and job summaries. Emitted
  asset reports, Android instrumentation text and dispatcher JSON are printed.
  Screenshot and APK downloads are intentionally unavailable under this policy.

The installed setup-action inputs and cache-save paths were inspected on
2026-10-02: [pnpm action inputs](https://github.com/pnpm/action-setup/blob/v6.1.0/action.yml),
[Node save guard](https://github.com/actions/setup-node/blob/v4/src/cache-save.ts),
[Python save guard](https://github.com/actions/setup-python/blob/v5/src/cache-save.ts),
and [Java save guard](https://github.com/actions/setup-java/blob/v4/src/cleanup-java.ts).
Invoked project scripts and package lifecycle configuration were also checked for
artifact/cache API calls and external publishing; none was found. This audit is
of the reviewed configuration, not a claim to have sandboxed every dependency's
possible behavior or frozen mutable upstream action tags.

## Retained regression and default web job

- Existing typed ESLint/component rules, appearance CSS generation check, and
  strict application TypeScript
- Every `tests/unit/*.test.mjs` and `test/expo/*.test.mjs`, including navigation,
  history, promoted-reader routing, Library readiness/catalog ownership, and CI-policy cases
- Existing Android instrumentation-harness unit contracts, reader regressions,
  snippets domain and mounted React integration
- Existing Whispersync core coverage thresholds and React compilation, pitch
  estimator/lifetime regressions, and both Python Library-dispatcher policy and
  diagnostics suites

A failure in one test step does not hide later independent test-step evidence;
no test is made non-blocking and no application assertion is weakened.

## Two independent web exports with colocated qualification

The regression job builds the default route after its independent unit/domain
steps. The web job independently builds the same promoted production reader route. They check out the
exact same recorded commit and frozen dependency graph, base path and pinned
browser versions. Each job owns its build and tests; there are still exactly two
web exports, no duplicated matrix and no cross-job transfer. Both output and
local Metro transform cache are cleared before export. The temporary reader flag has been removed. Both exports use the web Slot,
account-owned reader lifetime and save/cleanup navigation barrier.

A unit failure remains a job failure, but cannot suppress the default browser
setup when dependency installation succeeded. A default-route failure cannot
suppress gated-route evidence because the jobs have no dependency on each other.
This separation exposes completed default-route logs earlier while the broader
qualification runs; it does not turn any failure into success.

The PR's automatic runs use **affected** qualification. Manual dispatch offers
`qualification_scope: affected | full`; unknown scope values fail closed. Every
job summary records the scope with its exact source commit. An affected pass is
never a complete-parity or merge-readiness result.

Both independent exports receive the same intermediate affected checks. The
`default` and `gated` selector labels identify the existing CI jobs only; they
no longer select different runtime code:

- The original static-reader launcher in Chromium
- All 20 canonical cases from `tests/browser/statistics_acceptance_cases.py` in
  Chromium and WebKit: original Statistics geometry, keyboard/focus, title-filter,
  appearance, identity-safe deletion, raw recovery and the two new complete-route
  cases. `--list --json` exposes the identical default/gated inventory without
  starting a browser; `--validate` resolves exact cases without inherited-suite
  discovery or duplicate whole-reader runs
- The real reader save/cancel/Back/Forward/fragment lifetime suite in both engines
- The two corrected offline handoffs in both engines: Library bookmark reconnect
  and owned-book offline/signout. Worker activation and controller acquisition
  are bounded; a previously uncontrolled page gets at most one ordinary online
  reload. The production worker deliberately still does not call `clients.claim()`

The **full** scope retains every original default core group and the complete
gated inventory below, including all shared/local data safety, open-lifetime and
snippets cases. It is the explicit final web-parity gate on the final source.
Intermediate scope avoids re-running known superseded duplicate presentations
while shared routes converge; those unselected cases remain **unrun**, never
silently passed or deleted. On c3b0c0ba the previous flag-enabled export passed all eight reader lifetime
and two offline-handoff cases in each browser engine. The promoted source must
still pass both exact-head exports; older-head results do not qualify this edit.

Actual emitted-worker/genuine SwiftF0/cover checks and Android qualification are
still separate, always-selected job steps. No scope changes runner classes,
number of exports/jobs, artifacts, caches, assertions, failure aggregation or
existing whole-job timeouts.

Full-scope gated-export coverage:

- Both Chromium and WebKit: web reader lifetime; Books Library UI; Library parity,
  Editor's Picks, want-to-read, organization sync, cloud-series replay and
  relocation, identity, collection commit, preference recovery, import hydration;
  Settings controls/editor usability; annotations, scrubber, grid labels;
  appearance, connection panels, panel/gallery usability, modal keyboard/large
  text/fallback, gallery reveal/continuity, unified search, product journeys,
  search quality/focus; complete shared Statistics controls/exports/keyboard/zoom; actual-app offline reading and Whispersync
- Chromium additionally: Books Library filesystem cases, original static Reader,
  local Library, local move recovery, preview-cache handling, reading recovery,
  TTU migration/edges, and completed reading
- The unchanged `qualify_library_data_safety.py` runs **all** shared/local groups,
  preserving its exact own-main selectors, Chromium/WebKit engines, open-lifetime
  cases, native-storage harnesses, independent failure aggregation, and diagnostics
- Original snippets production UI/native IndexedDB acceptance in both engines,
  using the Expo static server with readiness and child-exit checks
- Actual emitted web pitch-worker bytes, genuine SwiftF0 inference fixture and
  real Chromium cover decode/canvas checks. These are separate from native device
  qualification and do not inject Expo worker globals

The workflow reuses original suite entry points rather than unittest-discovering
inherited harness cases. Each ordinary browser group has a ten-minute bound;
independent groups continue after a failure and every attempted group's exit
status appears in logs/summary. A whole-job timeout still leaves unfinished
qualifications unqualified. No per-suite pass is implied merely by listing it.

## Colocated Android qualification

The same Android job exports real DOM assets; performs Android-only prebuild;
checks patched DOM autolinking and origin contracts; runs JVM tests; compiles the
release and instrumentation APKs; verifies the APK's actual bytes; and executes
its emitted pitch worker in Chromium. The latter is asset execution only.

The explicitly approved temporary-runner KVM setup uses exactly the three
commands in [GitHub's hardware-acceleration guidance](https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/).
It is scoped to this public-repository stock Android job, with no other permission
changes. The SDK emulator package is installed before invoking its acceleration
probe; KVM device permission is checked first, with no software-emulation retry. A fresh disposable API 35 emulator consumes the APKs already built on
that runner. The unchanged `tests/android/run-qualification.sh` rejects existing
apps/non-emulator devices, uses synthetic randomly named records, verifies native
replies, force-stops between phases and requires both instrumentation evidence
phases. No real account or real library is used.

**Runtime stays unqualified until that exact step passes.** Compilation, APK
inspection or a Chromium worker pass cannot replace packaged-host execution.
Passing this synthetic harness still does not establish complete Android product
parity, authentication/cloud transport, background playback or physical-device
coverage.

## Explicitly unrun or superseded legacy qualifications

The following are not silently counted as passes or removed from their original
workflows. Their original workflows remain automatically available outside this
exact migration branch and keep any pre-existing manual-dispatch behavior.
Invoking them here requires another reviewed plan; their legacy storage-producing
manual paths are outside this zero-storage qualification.

- `foliate-slide.yml`: detailed slide/fast-turn/style/navigation/EPUB-resource and
  catalog-lifetime matrices and standalone slide demo. The original static-reader
  subset remains covered, but does not replace this larger qualification
- `manabi-reader-ci.yml`: standalone Firefox/Chromium/WebKit Whispersync browser
  harness, native database-upgrade/statistics-deletion/offline-worker harnesses,
  and documentation-site generation. Core/React coverage and actual-app
  Chromium/WebKit suites above remain covered
- `voice-pitch.yml`: platform-native audio-output matrix (including macOS WebKit)
  and actual-app voice-pitch playback/appearance suite. Retained estimator and
  genuine/emitted-worker inference checks do not qualify audio-clock behavior
- `media-player.yml`, `media-packaged.yml`, `media-qualification.yml`: optional
  video-enabled exports, exact native-handle browser profiles, MOSS runtime/model
  compilation, encoded/natural speech, threaded ASR and full media DOM/storage
  suites. The migration's normal video-disabled asset check is not a substitute
- `ttu-upstream-portability.yml`: separately checked-out pinned upstream TTU
  importer/exporter round-trip. Local TTU/shared-library tests do not replace it
- `snippets.yml` and `voice-pitch.yml`: dedicated formatting-only checks/patch
  outputs are not reproduced. Broad committed-source ESLint is retained; no
  formatting patch or generated source archive is uploaded
- All legacy upload/download steps, source archives, preview artifacts and remote
  cache saves are superseded for this branch by logged source identities and
  colocated jobs, not treated as missing application assertions
- Main publication remains governed by its unchanged existing release workflows;
  this migration workflow does not publish, deploy, merge or assert release parity
