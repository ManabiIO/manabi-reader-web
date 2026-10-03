# Dictionary boundary provenance record

This record documents the source provenance of the dictionary-boundary refactor introduced by the branch behind PR #259. It is an engineering provenance record, not a legal opinion.

## Reader-owned source used for the refactor

The boundary was extracted from code already present in Manabi Reader for Web's BSD-licensed `main` branch at base commit `7d552c47de7f0da9a723cc7645ea148482cd238f`.

The principal donor files were Reader files, not Manabitan/Yomitan implementation files:

- `apps/web/src/lib/search/dictionary-runtime.ts` at blob `f555ef53a06e49927b9b4c689b853695d466d1b4`: supplied the Reader-side dictionary interfaces, lifecycle, Manabitan loader calls, and recommendation wiring that were separated into a provider-neutral contract/lifecycle plus a provider adapter.
- `scripts/prepare-dictionary.mjs` at blob `e43e93eb352b42403e9bd3a0f65a4b814270ef2a`: supplied the pre-existing Reader-side external checkout/build/copy/source-package flow that was split into generic preparation and a Manabitan-specific build-provider module.
- `scripts/dictionary-source.mjs` at blob `6ab304279e543567a6dc2a4fb0aa415c2fd45e2f`: already enforced that the external provider checkout owns independent Git metadata and cannot inherit Reader's repository.
- `apps/web/src/lib/search/manabitan-version.json` at blob `972ed2ae5ac4cd091a36b231eaed0414a775aa3a`: supplied the existing exact provider revision pin and was relocated under the provider-specific directory.

The refactor moves and narrows Reader-owned integration code; it does not vendor Manabitan source into Reader.

## Repository-history audit

The original Reader integration entered this repository in commit `c417607b571b0173d5b4a2868eab127b3d5c93fb` (`feat(search): unify dictionary titles and local content search`).

For the dictionary integration, that commit added Reader-side files including:

- `apps/web/src/lib/search/dictionary-runtime.ts`;
- `apps/web/src/lib/search/manabitan-version.json`; and
- `scripts/prepare-dictionary.mjs`.

The commit patch labels the Reader runtime/orchestration as BSD-3-Clause and shows an integration layer that loads the external static runtime rather than adding the external provider's implementation tree.

A GitHub path-history query for `apps/web/static/manabitan` returns no commits. Subsequent dictionary integration commits modify the Reader adapter/orchestration, version pin, UI, and tests; the generated provider tree remains ignored rather than tracked.

This is evidence about the repository paths and patches reviewed here. It does not prove the absence of all possible copyright issues in history and should not replace a license review before a proprietary release.

## External provider

The current external provider pin is Manabitan revision `4db879b7b5bcb749f90042a313669526ef2f57f4`.

Manabitan is GPL-3.0-or-later and derives from Yomitan/Yomichan. Its implementation remains in the separate Manabitan repository. Reader's build checks out that exact revision into an ignored independent repository, invokes Manabitan's own build, and publishes only the generated runtime plus the provider-declared distribution files under the ignored `apps/web/static/manabitan/` provider directory.

## Future replacement rule

A future non-GPL implementation should use the Reader-owned provider contract and the observable acceptance requirements documented in `dictionary-provider-acceptance.md`. It should not be implemented by porting, translating, mechanically rewriting, or otherwise using GPL implementation files as donor source.

If behavior must be matched, record the behavior as a Reader-owned acceptance test/specification first, then implement independently from that requirement.
