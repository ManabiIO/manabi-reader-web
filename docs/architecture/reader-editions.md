# Reader editions

One Reader implementation supports two build-time compositions. Web is the active qualification target; shared Expo UI controls and Android adapters remain in place for future Android delivery.

| Edition               | Composition repository                    | Base path           | Provider            |
| --------------------- | ----------------------------------------- | ------------------- | ------------------- |
| Manabitan Reader      | `ManabiIO/manabi-reader-web`              | `/manabitan-reader` | Manabitan           |
| Manabi Reader for Web | private `lake-of-fire/manabi-reader-expo` | `/reader-web`       | Manabi Dictionaries |

`config/reader-editions.mjs` defines reviewed product identities. `READER_EDITION` selects the composition during the build. URL parameters cannot select a provider or change a storage identity.

## Distribution boundary

The public build prepares only the pinned Manabitan provider. A private build requires an absolute external provider build module and runtime entry, a production-capable release, and reviewed revision/content hashes. Metro substitutes only the provider selection and optional product extension modules; features continue to use the neutral Reader contract.

Asset preparation stages tracked public files and the selected provider's verified manifest. It rejects symlinks and mismatched bytes. Stale ignored provider output and dictionary archives are excluded. Final artifact verification checks product identity, base path, provider inventory and bytes. The private artifact also rejects unselected provider paths/implementation markers and source maps. Provider notices and redistribution rights remain part of each release's qualification.

`reader-edition.json` is the small publication identity consumed by the backend. `reader-product.json` carries UI/storage metadata. Neither marker is permission to publish; source pins, qualification and backend release gates must also pass.

## Local data and offline behavior

Each edition owns distinct IndexedDB names, preference keys, locks, broadcasts and app caches. There is no automatic migration, copying or deletion of pre-release web data. Existing developer data remains untouched. Flashcards data is outside this work.

Logical backup keys remain independent of their physical edition namespace, allowing explicit supported exports/imports. New persistent product features must include recovery behavior. Dictionary data belongs to its provider and must not be silently installed when opening the library.

The shell service worker is scoped to the deployment path. Optional engines are cached only when requested, separately from the required shell. Missing or unusable optional storage does not block online use. An offline shell indicates application availability; it does not promise that every optional engine or dictionary is downloaded or that browser storage cannot be evicted.

## Analysis and interaction

Proactive preprocessing and mounted-chapter interaction are separate capabilities. An on-demand provider may attach to unchanged source without fabricating an analysis sidecar. The chapter-opening controller owns attachment/disposal and guards stale work before publication. Connecting the full Manabi engine to both reader modes remains a separate end-to-end qualification gate.

## Current qualification

Run `pnpm test:edition`, `pnpm test:expo`, the unit suites, `pnpm --dir apps/web check`, `pnpm check`, and the final export verifiers. `tests/browser/test_reader_editions.py` exercises the actual exported app in Chromium and WebKit, small/large layouts, book import/open/offline reopen, and unrelated-data preservation. It defaults to `apps/web/build`; private composition sets `READER_EDITION_TEST_OUTPUT` to its exact `dist` directory. An explicit output must be absolute, exist, and contain no symlink components; invalid overrides fail rather than testing a different build. The local receipt inventories that same output before and after browser qualification.

The `reader-editions.yml` workflow is manual on the default branch. It performs qualification without automatic publishing. The backend keeps both new edition descriptors disabled until a real qualified artifact and activation checks exist.

The portable Swift runtime has real definition rendering and Anki primitives, but currently does not provide full chapter analysis or dictionary storage. It must not be advertised or packaged as a complete private provider until the real analysis, import/storage/media and reader path pass end-to-end checks.
