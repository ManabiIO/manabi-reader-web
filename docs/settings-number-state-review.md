# Numeric settings state repair — 2026-09-28

This follow-up fixes two independent correctness defects found during the settings review.

## Persisted number subjects

The generic storage subject previously persisted `updatedValue ?? defaultValue` but
published the original `updatedValue`. Clearing a number input could therefore write
the default to localStorage while publishing `undefined` to the running app. Number
subjects also admitted `NaN` and infinities, including damaged stored strings.

The storage boundary now normalizes once before both persistence and publication.
Numeric wrappers reject non-finite values to their declared default; nullable numeric
settings continue to preserve explicit `null`. A failed storage write still publishes
nothing. Valid zero and fractional values are unchanged.

This is deliberately a type-validity boundary, not per-setting range policy: existing
field-specific minimums, maximums and semantics remain owned by their settings.

## Tracker idle time

The UI is in minutes and documents a twelve-hour maximum. The previous blur handler
compared that minute value with 43,200 (seconds), effectively accepting up to thirty
days, then changed larger input to 900 seconds (fifteen minutes).

The conversion now has one tested policy: 0/invalid disables; positive minutes convert
to seconds; values above 720 minutes clamp to exactly 43,200 seconds. The native input
also exposes `max=720`.

## Evidence boundary

Focused unit tests execute the complete production storage-subject modules through the
existing offline-module fixture with only the Svelte subject and storage I/O boundaries
controlled. The settings conversion helper is tested directly. Full application lint,
Svelte check/build and browser behavior remain CI qualification; this document does not
claim physical Safari or storage-eviction coverage.
