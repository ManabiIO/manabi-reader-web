# Product journeys and visual QA — 2026-09-28

## Scope and source identity

PR #84 adds a standalone nine-case product suite in Chromium and WebKit, using
the existing `LibraryBase`, generated EPUB files, actual compiled routes, real
Workers, and native IndexedDB. No live accounts, external providers, filesystem
permission substitutes, production deployment or destructive user-data actions.

The initial source/visual review used main
`7a49e32ec385a9e12e9abf8416b9e9d2b53b8f70`, from Appearance run
`36454766799`. The `appearance-source` archive's 813 text files were checked
against the Git blob identities in its exact `tree.txt`. The associated compiled
app was retrieved, but local Chromium navigation was administrator-blocked
(`ERR_BLOCKED_BY_ADMINISTRATOR`). No attempt was made to bypass that restriction.

Main advanced during this review to `077c2b00f9d835e624df40d49d140e2155be7254`
(direct-import identity changes). The reviewed search panel and statistics header
were unchanged in that comparison. PR CI tests its recorded merge candidate,
not an assumed current main or an unrelated feature preview.

## Fixes found during this pass

### Search rejection needs an explanation

The reader worker rejects queries longer than 512 Unicode code points with zero
results. The original Reader panel rendered this exactly like a genuine miss.
Library search already explains the same limit. The Reader now validates before
starting a worker search, links the explanatory alert to the input, marks the
input invalid, and clears validation on correction. A bad query does not offer
a meaningless worker retry. Existing worker failure/retry handling remains.

The regression checks 512 supplementary Japanese characters (1024 UTF-16 code
units) really find a result; 513 produce the explanation; a corrected query
works without closing or remounting the reader.

### Enlarged statistics heading splits a word

I directly inspected `chromium-connect-statistics-options-320.png` from the
baseline artifact at its native size. At a 320px viewport with 200% root text,
"Statistics options" was rendered as "Statistic" / "s options" because the
close button consumed the remaining heading width. This was not a missing font
or a screenshot-size inference.

The heading now preserves its minimum word width. When the heading and close
button cannot share a row, the close button wraps into a row above the title,
aligned to the end. Text stays enlarged; the dismiss target is not reduced or
overlapped. The new test checks actual DOM Range rectangles for the word, its
bounds, close-control separation, dismissal and focus restoration at 320px /
200%, 390px / 100% and desktop / 100%.

## New end-to-end contracts

| Journey | Observable assertions |
| --- | --- |
| Desktop horizontal reader pagination | 127 authored hits: 50 → 100 → 127, unique excerpts, final hit reachable, changed query resets the limit to 50 |
| Phone-sized vertical reader pagination | The same real search flow at 390 × 844, including dismissal and restored keyboard focus |
| Reader query boundary | Valid 512-code-point input, explicit 513-point rejection, corrected-query recovery |
| Reader literal search | Metacharacters treated literally, supplementary Japanese/emoji preserved, no-match and clear cannot reuse old hits |
| Library query boundary | Valid boundary, rejected overflow, then real passage navigation without a duplicate book |
| Library metadata pagination | 61 real EPUB imports, 30 → 60 → 61 exact titles, narrowing/reset and reload |
| Corrupt import recovery | Invalid EPUB cannot change an existing book; corrected same filename imports and reads after reload |
| Settings round trip | Reader → Settings → Back → reload preserves the selected 28px size and book identity |
| Statistics heading reflow | Real word geometry at enlarged text and compact/desktop widths; no dismissal overlap |

All fixtures are synthetic. The suite has no inherited test methods to inflate
its count, no expected-failure markers and no retries that turn failures green.
It preserves the base harness's uncaught-page-error and unsafe-resource checks.

## Visual inspection record

The baseline artifact contained 150 Chromium images. I reviewed a selected
contact sheet and inspected important views individually at native resolution;
this is a targeted visual review, not a claim to have examined every image.

- Desktop vertical reading toolbar: book text and toolbar are separated, ruby
  remains visible, and the toolbar does not cover the passage in this capture.
- Desktop Fonts & text: field labels, inputs and section hierarchy are readable;
  no visual collisions in the inspected 1440px capture.
- Compact search and book-details panels: long Japanese content wraps within the
  panel; the close target remains distinguishable.
- Enlarged dictionary onboarding: the heading, explanatory copy, main action,
  alternative and dismissal remain readable in the inspected capture.
- Enlarged statistics options: the mid-word heading break above was unacceptable
  polish despite the existing reflow test passing; fixed in this PR.
- Enlarged title filter: the captured scrolled state gives very little space to
  the body between sticky regions. This overlaps the separate panel-usability
  work in #72; that branch is not modified or treated as qualified here.

Reference images are in the `appearance-evidence` artifact for run
`36454766799`, under `artifacts/appearance/chromium/screenshots/`:
`rhea-reader-toolbar.png`, `chromium-connect-settings-light-1440.png`,
`chromium-modal-search-phone.png`, `chromium-modal-book-info-dark-320.png`,
`chromium-onboarding-readable-enlarged-phone.png`,
`chromium-connect-statistics-options-320.png`, and
`chromium-connect-title-filter-enlarged.png`.

That baseline Appearance run was cancelled when main advanced. Its retained
logs contain successful 57-case Chromium Rhea, 50-case Chromium controls, and
57-case WebKit Rhea completions. The WebKit controls log ends during its last
case, before that engine's screenshots were moved into the artifact. This is
**not** a fully green baseline run or a WebKit screenshot review.

## Reproduction and evidence

Build with the repository's pinned toolchain and `BASE_PATH=/reader-web`, then:

```sh
LIBRARY_BROWSER=chromium python tests/browser/test_product_journeys.py
LIBRARY_BROWSER=webkit python tests/browser/test_product_journeys.py
```

`product-journeys.yml` builds once and executes both engines even if the first
fails. `product-journey-evidence` retains exact commit/tree, the tested source,
logs, viewport checkpoints, HTML, console diagnostics and per-case traces. Trace
recording begins after the existing harness hydrates the initial Library.
This bounds the evidence claim: it does not include initial document startup.

Python syntax and actual unittest collection (nine cases) passed locally.
Browser qualification is provided by the exact recorded CI run; queued,
cancelled or partial jobs are not passes. The tests-only first head intentionally
asserted the missing search feedback without an expected-failure exemption;
its source diagnosis is not, by itself, proof of a completed negative browser run.

Not covered by this review: physical iPhone/iPad/Safari behavior, native file
pickers or OS zoom, screen-reader speech output, live authenticated services,
large real-world dictionary libraries, real video playback, or production
release admission. Emulated viewport size and enlarged root text are not
claimed to be those device-level qualifications.
