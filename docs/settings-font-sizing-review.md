# Reader sizing and custom-font review — 2026-09-28

## Scope and integration

Four existing settings components and two focused helpers. Reviewed against
`18084d91e539839b229037a6d013017de2fb6246`; integration base
`91db8cbe4e8c9a88fb5d601cac9cea974021dffc` changes only disjoint importer/WebDAV tests.
The four component preimages plus the Appearance workflow and lint list were
individually checked against GitHub blobs. The local workspace is a CI text-source
subset, not a complete clone or a substitute parent commit.

This does not reapply the earlier unpushed Contents bundle: #86 has overlapping
Contents/dialog work. #72's shared controls, #83's Library/chrome work and #84's
search journeys remain separate. No schema, dependency, account-sync contract,
source-file, production-activation or deployment changes.

## Design

Reuse Manabi's existing neutral surfaces and shared Button/Input components.
A primary Save action, outlined presets/Use actions, quiet navigation and explicit
destructive Remove avoid styling every control identically. Labels and action rows
wrap; controls retain 44-CSS-pixel minimum heights. Loading is local status text,
not a full-window overlay obstructing dismissal.

Sizing distinguishes the exact **Current** pixel setting from the nearest **Quick
size** preview. Zero maximum remains **Automatic**, with an explicit reset. Both
axes receive meaningful trigger/dialog/range labels. Choosing a preset saves
pixels; viewing or resizing the chooser does not.

The reference direction is the same content-first hierarchy documented in the
existing Apple review, not copied assets or a claim of native visual parity:

- https://www.apple.com/apple-books/
- https://www.apple.com/
- https://developer.apple.com/app-store-connect/analytics/
- https://developer.apple.com/help/app-store-connect/release-notes/

The March 2026 Analytics refresh and May 2026 navigation update are distinct;
see `app-store-connect-ui-review.md`. No font or Apple image files are included.

## Correctness

### Inspection cannot silently edit settings

The old sizing component called its saving preset setter from `onMount`, rounding
an exact margin and changing a zero automatic maximum into a fixed pixel limit.
Initialization now computes a read-only preview. Window bindings keep the preview
current; explicit choices use the current axis, validate bounds/steps and retain
the two-sided margin convention. Invalid numeric choices cannot persist NaN.

### Font operations own their inputs and do not prune on opening

Cache enumeration is informational. Missing catalogued files remain visible as
unavailable; unlisted cache entries are not automatically deleted. A failed cache
open/list offers Retry without pretending the catalogue is empty.

Save is a native form action, including Enter activation. It validates at submission
rather than relying on blur, trims/canonically compares names, rejects reserved or
duplicate names/files and empty/unsupported files, and accepts uppercase extensions.
This is metadata/extension validation, not binary font parsing or safety certification.

Explicit mutations serialize within this page and snapshot input before cache I/O.
The final metadata step rereads the live store, not a disposed component's stale
`$userFonts$` subscription. Dismissed explicit saves/removals can finish without
publishing UI events into a newer dialog. Use validates availability and closes
only its own dialog. Remove resets a selected family only when it equals the
removed face; built-in, externally installed and newer choices are preserved.

### Retained storage boundaries

CacheStorage and the localStorage catalogue are **not one atomic transaction**.
Cache writes/deletes can succeed before a metadata write fails. The error is
reported; no successful rollback is invented. Unlisted bytes can remain after an
interrupted save. Retry/remove remains explicit. This does not introduce IndexedDB
font migration, cross-tab locking or cross-device reconciliation. Other browser
tabs/external cache writers and OS storage eviction remain separate boundaries.

## Executed verification

- **60 new cases:** 11 dimension helpers, 33 font-action helpers, 16 complete
  component-script cases. Native File/Response/promises execute; cache/store and
  Svelte lifecycle/reactivity dependencies are declared doubles.
- **Same 16 script assertions against original source: 9 failed, 7 passed.**
  Repaired scripts: 16 passed, no skipped/cancelled cases. The harness models
  auto-subscribed store assignment and disposal rather than counting a missing
  test hook as a regression.
- **89 selected unit/component cases passed**, including those 60 and retained
  appearance, offline-font, modal and gallery tests. This is not the full suite.
- Strict TypeScript for both helpers passed with their real font type dependency.
  Python syntax and patch whitespace checks passed.

Local toolchain: Node 22.16.0 / TypeScript 5.8.3 in a text subset. The full pinned
Node 24.21.0 / TypeScript 6.0.3 application install, formatter plugins, lint, Svelte
compiler/check, build and actual-app browser qualification remain CI work. No
local full-app or native WebKit success is claimed.

## Added compiled-app qualification

`tests/browser/test_settings_controls.py` contains six actual-app journeys:
read-only size inspection/reload, resized and vertical preset actions, keyboard
font save/native cache/reload/removal, denied cache/retry with retained entries,
reserved-name recovery plus Close during a held native save, and light/dark
320px/200%-text target reachability. The existing Appearance workflow runs these
in Chromium and WebKit, retaining all earlier suites, error gates and permissions.
The four changed components are explicitly added to component lint.

The font byte fixtures are intentionally synthetic and are never chosen for
rendering. Cache-error/held-save tests wrap only the specified native operation.
These six browser cases are added, not counted as passed without CI evidence.
Physical Safari/iOS, real IME, screen-reader speech, font shaping and OS zoom are
not certified by helper tests or desktop engine automation.
