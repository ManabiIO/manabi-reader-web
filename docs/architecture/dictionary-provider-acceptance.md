# Dictionary provider acceptance contract

This document describes the observable behavior Manabi Reader for Web requires from a dictionary provider. It is intentionally implementation-neutral and is the preferred input to any future clean-room replacement.

The TypeScript source of truth for shapes is `apps/web/src/lib/search/dictionary-provider.ts`. This document explains the semantics Reader relies on.

## Provider opening and lifetime

- Provider code is loaded lazily. Opening the Reader or library must not require initializing dictionary storage.
- `openDictionaryProvider()` resolves to one `DictionaryRuntime`.
- Reader may share that runtime between simultaneous dictionary consumers in a tab.
- When the final Reader lease is released, `client.close()` must settle and release provider-owned resources.
- A failed open must not leave a permanently live provider owner. A later Reader retry must be able to attempt a new open.

The provider may use any independently implemented storage engine or internal data model.

## Status

`client.status()` returns the current user-visible dictionary set and preferences.

Reader relies on:

- each installed dictionary having a stable `title`;
- optional revision, author, and description metadata being display-only;
- `preferences.disabled` containing the titles currently disabled;
- status returned after a mutation reflecting the durable post-mutation state.

Provider-specific storage metadata must not leak into Reader UI contracts.

## Search

`client.search(query, full, { signal })` returns `DictionaryResult`.

Reader requires:

- `version === 1`;
- `query` equals the trimmed submitted query;
- `matchedQuery` states the spelling actually matched;
- `prefix` truthfully states whether the result is prefix-derived;
- `dictionaryCount` is the number of enabled local dictionaries participating in the result;
- `preview.items` is bounded display data suitable for search result rows;
- `preview.hasMore` states whether additional preview results exist;
- when `full === true`, `lookup` may contain an opaque provider-owned payload for the provider renderer.

Reader deliberately does not define the internal structure of `lookup`.

Queries over 256 Unicode code points are rejected by Reader before provider search. A provider may enforce equal or tighter safety bounds when needed, but should not silently reinterpret accepted query text.

## Preview items

Each preview item contains:

- stable result-local `id`;
- `term`;
- `reading`;
- zero or more senses with `source`, plain display `text`, and `tags`.

Preview data is Reader-owned presentation data. It must not require Reader to understand provider database records or renderer internals.

## Full-result rendering

`runtime.render(container, lookup, onLookup)`:

- receives the opaque `lookup` payload previously returned by this runtime;
- renders only inside the supplied container;
- may invoke `onLookup(text)` for a user-requested nested lookup;
- returns a disposer that releases object URLs, listeners, media handles, or other render-lifetime resources;
- must not require Reader UI code to receive the provider's raw client object.

A replacement provider may use different markup and internals as long as Reader's accessibility/security/product requirements are preserved.

## Dictionary mutation

`importDictionary(blob, ...)`:

- accepts a user-selected local dictionary archive supported by the product;
- honors abort requests where cancellation can still win;
- returns the committed dictionary title;
- reports bounded warnings separately from success/failure;
- truthfully reports `cancelledAfterCommit` when durable publication won a cancellation race.

`deleteDictionary(title)` removes that local dictionary and returns fresh status.

`setEnabled(title, enabled)` durably changes whether the dictionary participates in lookup and returns fresh status.

`setDefault(choice, title?)` records the user's explicit decision about the bundled/default dictionary. Provider code must not silently reinstall a default dictionary after the user declines or deletes it.

## Default dictionary and recommendations

`runtime.installDefault(...)` returns the verified archive bytes for the explicit default-dictionary installation flow. Opening Reader/search must not install it automatically.

`runtime.recommendations(...)` returns display metadata and HTTPS publisher/download URLs. Recommendations are not permission to redistribute third-party dictionaries and must not trigger background installation.

These product capabilities can be backed by Reader-owned metadata in a future provider; they are not required to remain sourced from Manabitan.

## Cancellation and errors

Operations accepting `AbortSignal` must stop publishing results to a cancelled caller. Durable mutation APIs must distinguish cancellation-before-commit from a commit that already won the race.

Rejected operations should return normal JavaScript errors with user-safe messages. Provider-specific stack traces, filesystem paths, database internals, or source identifiers should not be required by Reader UI.

## Security boundary

A provider must not require Reader to execute code supplied by dictionary archives. Imported dictionary content is untrusted data.

Rendered dictionary content must continue to respect Reader's content/security policy. External navigation must remain explicit and constrained by Reader/provider rendering rules. Provider media lifetimes must be disposable.

## Clean-room replacement procedure

For a future proprietary or otherwise non-GPL provider, use a two-role process when parity with the current provider is needed.

### Observation/specification role

The specification role may examine:

- Reader-owned provider contracts, UI behavior, and acceptance tests;
- publicly observable behavior of the currently shipped Reader/provider combination;
- user-facing documentation, release notes, file-format documentation, and independently licensed standards/data specifications needed to describe interoperability.

Its deliverable must stay at the level of observable requirements: inputs, outputs, state transitions, failure/cancellation behavior, UX flows, bounds, fixtures, and acceptance tests.

Do not put GPL source text, symbols, comments, patches, line-by-line descriptions, distinctive internal structure, or implementation recipes into the clean-room specification.

### Implementation role

The implementation role should receive only:

- Reader-owned provider interfaces;
- this acceptance contract and clean-room specification;
- independently licensed/public format specifications and test fixtures approved for the replacement;
- black-box acceptance tests and expected observable results.

The implementation role should not inspect Manabitan/Yomitan/Yomichan source, diffs, patches, code review discussions that reveal implementation, or generated source maps from the GPL runtime while implementing the replacement.

### Provenance record

Keep a contemporaneous record containing:

- the Reader commit and provider-contract version implemented;
- specification/test sources used;
- third-party dependencies and licenses;
- implementers and reviewers;
- hashes/versions of fixtures;
- a statement that GPL provider implementation source was not used as donor material.

If a requirement cannot be specified without describing the GPL implementation rather than its observable behavior, leave it out and derive a black-box acceptance case instead.

This procedure is an engineering provenance control, not a legal conclusion. For a proprietary distribution, remove the GPL runtime from the distributed Reader and obtain qualified license counsel for the final distribution model.

## Replacement acceptance

A replacement is ready to substitute for Manabitan when:

1. it implements the Reader-owned contract without importing Manabitan/Yomitan/Yomichan source;
2. provider-neutral Reader source and UI require no provider-specific changes;
3. the generic build preparation requires only a new provider descriptor/selection;
4. existing Reader dictionary search/setup/browser tests pass against the replacement;
5. provider-specific acceptance tests are newly implemented from this contract and observable product requirements; and
6. the distributed artifact no longer contains the Manabitan runtime or its GPL source package before any proprietary Reader distribution is considered.
