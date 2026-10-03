# Dictionary provider boundary

## Goal

The Reader repository owns a BSD-3-Clause dictionary-provider contract and the application behavior built on that contract. The current provider is a separately licensed Manabitan runtime. Manabitan is GPL-3.0-or-later and derives from Yomitan/Yomichan.

The architecture intentionally makes the current provider replaceable without carrying its implementation into a future provider.

## Ownership map

Reader-owned BSD code:

- `apps/web/src/lib/search/dictionary-provider.ts`: provider-neutral types and capabilities used by Reader.
- `apps/web/src/lib/search/dictionary-runtime.ts`: provider-neutral lifecycle and lease ownership.
- `apps/web/src/lib/search/dictionary-provider-selection.ts`: the single selection point for the current provider.
- Reader UI, setup, search orchestration, and tests outside the provider adapter.
- `scripts/prepare-dictionary.mjs` and `scripts/dictionary-source.mjs`: provider-neutral Reader build orchestration that treats provider source as an external input.
- `scripts/dictionary-provider-selection.mjs`: the single build-time provider selection point.

Provider adapter:

- `apps/web/src/lib/search/dictionary-providers/manabitan/adapter.ts`: a small Reader-owned adapter to the versioned public Manabitan web-runtime surface.
- `apps/web/src/lib/search/dictionary-providers/manabitan/version.json`: the exact source revision and source-branch/PR provenance Reader expects.
- `scripts/dictionary-providers/manabitan.mjs`: Manabitan-specific checkout/build/licensing packaging for the external runtime.

External-extension interoperability:

- `apps/web/src/lib/integrations/external-dictionary-interop.ts`: the only Reader application source allowed to contain public Manabitan/Yomitan/Yomichan DOM markers, popup selectors, setup URL/copy, and legacy setup-choice migration.
- This is black-box interoperability with separately installed extensions. It is not the local dictionary provider and contains no extension implementation code.

Separately licensed GPL material:

- The generated `apps/web/static/manabitan/<revision>/` runtime. The public directory is provider-owned build metadata, not a generic Reader dependency.
- Its bundled GPL license and exact corresponding source archive.
- Manabitan/Yomitan/Yomichan implementation source in the separate Manabitan repository.

Generated provider files are ignored and must not be committed to Reader.

## Dependency direction

Reader UI and application logic depend on `DictionaryRuntime` and `DictionaryClient`. They must not import Manabitan modules, source paths, classes, or types.

The provider-selection module chooses an adapter. The adapter may load the pinned runtime through its published static-module contract. The adapter validates and normalizes status/search/import objects into new Reader-owned objects; raw provider objects do not cross into generic UI, except for the deliberately opaque full-lookup payload that is handed back only to the same provider renderer. Provider protocol details such as Manabitan's internal response `version` field and default-choice enum are translated into Reader-owned semantics at the adapter.

The GPL runtime must not import Reader source or become a source-code dependency of Reader modules.

Separately, generic Reader components consume neutral functions/constants from `external-dictionary-interop.ts`. Provider/extension names and DOM compatibility identifiers must not spread back into generic components.

This boundary is about source ownership and replaceability. It does not make a legal conclusion about whether distributing multiple components together creates obligations under a particular license.

## Distribution caveat

Do not treat this source boundary as permission to ship a proprietary Reader while the current GPL provider is still part of the distributed application. The current adapter dynamically loads provider JavaScript into the Reader page, and software-license questions about when communicating components form one combined work are fact-specific.

The intended proprietary migration path is therefore to remove Manabitan and its generated runtime from the distributed product before switching Reader-owned code to non-open terms, unless qualified legal review establishes a different distribution model. A future provider should be independently authored or separately licensed for that use.

## Provenance rule

Do not implement Reader-owned code by copying or adapting GPL implementation source, even if names are changed or the code is rewritten mechanically. A future proprietary provider must be independently authored from requirements and documented behavior, not ported from Manabitan/Yomitan implementation.

When behavior must match the current provider, specify the required observable behavior in Reader-owned tests or documentation first. Implement against that specification without transferring implementation text or structure from GPL source. Use `dictionary-provider-acceptance.md` for the contract/clean-room procedure and `dictionary-boundary-provenance.md` for the current refactor's provenance record.

## Build boundary

`scripts/prepare-dictionary.mjs` is provider-neutral. It validates the selected provider descriptor, provider-owned public runtime directory, Reader-owned runtime marker, output manifest, hashes, required distribution files, and explicit-install default dictionary archive.

`scripts/dictionary-providers/manabitan.mjs` owns the Manabitan-specific work:

1. validates the Manabitan repository pin,
2. checks out that revision into an independent nested Git repository under the ignored cache,
3. requires an exact clean source commit,
4. runs Manabitan's own build,
5. copies only the generated static artifact into the ignored public-assets directory;
6. packages the GPL license/corresponding source files declared by that provider descriptor; and
7. declares obsolete generated public paths so the generic build can remove legacy provider output.

The generic preparation layer prunes old revisions inside the selected provider's public runtime directory and old default-dictionary archives before publication. A long-lived local/CI workspace therefore cannot silently ship stale provider/source artifacts from an earlier build.

Reader intentionally keeps Manabitan at its pre-existing `/manabitan/<revision>/` public URL. Renaming that URL would make already-open tabs fail if they lazy-load the runtime after a deployment. The service worker does not know this provider name: `prepare-dictionary.mjs` writes a small Reader-owned `reader-runtime.json` marker into the selected generated runtime tree. `optional-static-assets.mjs` discovers runtime trees from that marker plus `manifest.json` and excludes those exact files from mandatory shell/font caching. A future non-GPL provider therefore does not need to imitate GPL source-packaging conventions.

`tests/unit/dictionary-source.test.mjs` verifies that the nested provider checkout cannot inherit or mutate Reader's Git repository.

## Replacing Manabitan

A replacement should require only:

1. implement `DictionaryRuntime`/`DictionaryClient` in a new provider adapter,
2. update `dictionary-provider-selection.ts`,
3. add/select a replacement build-provider module in `scripts/dictionary-providers/`,
4. replace provider-specific version metadata,
5. remove the Manabitan runtime adapter/build-provider module and GPL distribution assets; and
6. update provider-specific acceptance tests and user-facing notices.

Reader UI and provider-neutral lifecycle should not need a rewrite.

External extension support is independent. If the product should continue interoperating with separately installed Yomitan/Manabitan extensions, the black-box interop module can remain. If Manabitan branding/bridge support should disappear entirely, remove its constants/markers from that one interop module without touching the local provider contract.

## Review checklist

Dictionary-related Reader changes should be rejected when they:

- import or vendor Manabitan/Yomitan implementation source,
- reproduce GPL implementation logic in Reader-owned modules,
- add provider-specific types or module paths to the provider-neutral contract/lifecycle,
- commit generated provider artifacts,
- weaken exact-revision or corresponding-source handling, or
- make Reader UI call provider-specific classes directly.
