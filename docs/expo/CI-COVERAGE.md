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
  regression, web, and Android. No larger, paid or self-hosted class is selected.
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

## Retained regression job

- Existing typed ESLint/component rules, appearance CSS generation check, and
  strict application TypeScript
- Every `tests/unit/*.test.mjs` and `test/expo/*.test.mjs`, including navigation,
  history, flag-default, Library readiness/catalog ownership, and CI-policy cases
- Existing Android instrumentation-harness unit contracts, reader regressions,
  snippets domain and mounted React integration
- Existing Whispersync core coverage thresholds and React compilation, pitch
  estimator/lifetime regressions, and both Python Library-dispatcher policy and
  diagnostics suites

A failure in one test step does not hide later independent test-step evidence;
no test is made non-blocking and no application assertion is weakened.

## Colocated web qualification

Both production exports use the exact same checkout, dependency graph, base path
and browser installations. Both the output directory and local Metro transform
cache are cleared before each export;
there is no cross-job transfer or test-only runtime flag injection. The source
flag stays default-disabled.

1. Export with `EXPO_PUBLIC_QUALIFY_WEB_READER_LIFETIME=0`, then run the original
   static-reader suite (its unchanged launcher is Chromium-only) and Settings
   controls, Product journeys and Library parity in Chromium and WebKit
2. Export with `EXPO_PUBLIC_QUALIFY_WEB_READER_LIFETIME=1`, even if a default-route
   assertion failed, then repeat those same assertions and run the broader set
   below. Both export modes receive actual asset qualification. The job retains
   any earlier failure; a gated-path pass cannot mask a default-route failure

Broader gated-export coverage:

- Both Chromium and WebKit: web reader lifetime; Books Library UI; Library parity,
  Editor's Picks, want-to-read, organization sync, cloud-series replay and
  relocation, identity, collection commit, preference recovery, import hydration;
  Settings controls/editor usability; annotations, scrubber, grid labels;
  appearance, connection panels, panel/gallery usability, modal keyboard/large
  text/fallback, gallery reveal/continuity, unified search, product journeys,
  search quality/focus; actual-app offline reading and Whispersync
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
changes. A fresh disposable API 35 emulator consumes the APKs already built on
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
