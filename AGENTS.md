# Agent instructions

## License and provenance boundary

Manabi Reader for Web is BSD-3-Clause source. The current local dictionary provider is a separately built GPL-3.0-or-later Manabitan/Yomitan-derived runtime.

For any automated coding, review, refactor, or migration task:

- Do not copy, port, translate, mechanically rewrite, or use Manabitan/Yomitan/Yomichan implementation source as donor code for Reader-owned source.
- Do not inspect GPL provider implementation files and then implement a Reader-owned equivalent in the same worker/context.
- Reader-side dictionary code must depend on the provider-neutral contract in `apps/web/src/lib/search/dictionary-provider.ts`.
- Provider-specific runtime loading belongs under `apps/web/src/lib/search/dictionary-providers/`; provider-specific checkout/build/licensing logic belongs under `scripts/dictionary-providers/`.
- Public external-extension DOM selectors/markers belong only in `apps/web/src/lib/integrations/external-dictionary-interop.ts`.
- Never commit generated provider runtime/source archives or dictionary archives under `apps/web/static/`.
- Never cherry-pick or apply a Manabitan/Yomitan patch into Reader merely because some contributor-owned additions were also offered under BSD.

If Reader needs behavior parity with GPL software, use a clean-room workflow:

1. an observation/specification worker may use public documentation, release notes, black-box behavior, and Reader-owned tests to write neutral observable requirements;
2. that spec must exclude GPL source text, symbols, comments, patches, distinctive internal structure, and implementation recipes;
3. a different implementation worker that has not inspected GPL implementation source writes the Reader-owned implementation from that spec.

The Reader-owned acceptance contract is `docs/architecture/dictionary-provider-acceptance.md`. Current boundary provenance is recorded in `docs/architecture/dictionary-boundary-provenance.md`.

If a requested task would require crossing this boundary, keep the change in the Manabitan repository or produce a neutral specification instead of implementation.
