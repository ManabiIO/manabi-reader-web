# Manabi Reader for Web

Read and organize your own ebooks in a browser. Manabi Reader for Web is a free, open-source reader with a personal library, flexible page layouts, bookmarks, reading progress, and optional account sync. There is no bookstore or discovery feed.

**[Read the user guide](https://manabi.io/Manabi-Web/Docs/)** · [Open the reader](https://manabi.io/reader-web/) · [Report an issue](https://github.com/ManabiIO/manabi-reader-web/issues)

The guide covers getting started, library organization, reading, accounts and data, migration, comparisons with other readers, and contributing. Its source is in [`site-docs/`](site-docs/). Build it with [Zensical](https://zensical.org/):

```sh
python3 -m pip install -r requirements-docs.txt
bash scripts/build-docs
```

The site builds into `apps/web/build/docs/` after the web app build. The backend release pipeline packages both in one static artifact; production publication is controlled separately by the backend deployment configuration.

Manabi Reader for Web began as a fork of [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader). Its [original README](docs/ttu-upstream-readme.md) is retained for attribution and historical reference. See the guide's [Credits](site-docs/credits.md), [BSD 3-Clause](LICENSE), and [third-party UI licenses](THIRD_PARTY_UI_LICENSES.md).

## Expo web draft

Web is the active delivery target. The migration branch uses Expo SDK 58 and React Native 0.88, retaining Expo UI, shared feature code and platform adapters so Android can be resumed later. Android implementation and device qualification are paused. Native Windows is deferred until Expo UI supports it; desktop browsers remain supported. The native Apple apps remain separate; this project has no iOS or macOS target. See [architecture, verification and open parity gates](docs/expo/MIGRATION.md) before treating this draft as a release candidate.

Use Node 24.21.x and pnpm 12.3.4. `pnpm dev` starts web; `pnpm build` exports the existing `/reader-web` static deployment. `pnpm test:reader`, `pnpm test:whispersync`, and `pnpm test:expo` retain the core regression workflows. Android commands remain available for future development, but are outside the current web acceptance requirements.

The draft CI runs two web jobs by default. Android build and device qualification require explicit manual opt-in. CI performs builds and tests only; it does not merge, deploy, enable EAS Update, or modify another repository.
