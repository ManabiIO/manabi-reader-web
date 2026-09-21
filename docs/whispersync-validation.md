# Whispersync v3 checkout integration

The supplied `manabi-whispersync-reviewed-v3.patch` is the complete replacement
implementation. Its source overlay and third-pass review describe the same
revision. The review-only delta and previous implementation in the archive are
historical reference material; neither was applied on top of v3.

The replacement applied cleanly to reviewed base
`c037fbec3911a10e90a3b94bf19443a484e7adc4`. Integration also includes the newer
library changes through main commit `aec21b19`. Work is isolated on
`feat/whispersync-v3-20260920`; the existing older Whispersync PRs were left
unmerged.

## Additional integration fixes

- Keep a captured starting selection usable while the audiobook drawer hides
  the reader or an ancestor. Hidden text inside the book is still excluded.
- Keep the compact storage/following warning visible even without a loaded audio
  file, including caption-only cross-tab conflicts.
- Observe modal visibility changes on the document root as well as its body so
  pending navigation resumes after an inert root is released.
- Serve the browser harness as UTF-8 and compare persisted objects by structure
  instead of property insertion order.
- Preserve MIT source notices in the repository linter, configure standalone
  harness globals, and remove unused component CSS selectors.

The supplied 95 core tests, eight native IndexedDB cases, and three application
acceptance cases are retained. Two additional DOM tests and two application tests
cover the integration fixes. All executable validation is delegated to a
`gpt-5.6-luna` subagent with medium reasoning.

## Validation results

Validated with Node 24.21.0, pnpm 12.3.4, TypeScript 6.0.3, and Chromium
153.0.8010.12. Native browser tests use a loopback origin; no IndexedDB cases
are skipped or replaced by the transaction test double.

| Check                                                    | Result                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| Strict core TypeScript and unit/controller/session tests | 95 passed                                  |
| Chromium DOM/media/navigation/native IndexedDB suite     | 52 passed, 0 skipped                       |
| Actual built Svelte application acceptance               | 5 passed                                   |
| Existing application unit tests                          | 62 passed                                  |
| Existing reader tests                                    | 108 passed                                 |
| Existing static-reader browser suite                     | 5 passed                                   |
| Existing local-library browser suite                     | 3 unqualified: Chromium process aborts     |
| Full Svelte check                                        | 0 errors, 0 warnings                        |
| Production static build                                  | Passed                                     |
| Repository ESLint and formatting                         | Passed                                     |
| Patch whitespace and original MIT license hash           | Passed; original license unchanged          |

The application cases verify real paginated cross-chapter navigation, caption
restore/reset, stale-tab protection with and without audio loaded, and matching
from a selection captured before opening the drawer. The media harness uses a
generated silent WAV and an autoplay-permissive test setting.

An initial app-test selector matched both the footer launcher and compact player;
the test now selects the launcher's dialog control. An initial IndexedDB assertion
compared object property insertion order; the corrected assertion checks values
structurally. These harness failures are not counted as successful runs.

The local-library suite failed repeatedly when Chromium exited during its fixture
with macOS `CVDisplayLinkCreateWithCGDisplay` errors. No pass is claimed for those
three cases; they need another run in a functioning browser environment before
release. The static reader and Whispersync application suites completed in the
same installed browser version.

Local execution logs are in `/tmp/manabi-whispersync-validation/`, including
`final-core-svelte-bundle.log`, `final-browser-52.log`,
`final-app-5.log`, `worktree-unit.log`, `worktree-reader.log`,
`final-eslint-clean.log`, `final-svelte-check.log`, `final-build.log`, and
`final-static-local.log` (five static-reader passes and local-library aborts).

Original MIT notice SHA-256:
`8b51ad70f6aed5ce783d6770d9545eb005d50876051a8ab2e4ca91c902bd04d2`.

## Remaining device qualification

Automated browser results do not qualify physical Safari/iOS devices, all audio
codecs and long recordings, operating-system background playback, or third-party
dictionary extension combinations. The full original MIT notice and both
upstream credits remain in the source and player.
