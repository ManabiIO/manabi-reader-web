# Manabi Reader for Web

Read and organize your own ebooks in a browser. Manabi Reader for Web is a free, open-source reader with a personal library, flexible page layouts, bookmarks, reading progress, and optional account sync. There is no bookstore or discovery feed.

**[Read the user guide](https://manabi.io/Manabi-Web/Docs/)** · [Open the reader](https://manabi.io/reader-web/) · [Report an issue](https://github.com/ManabiIO/manabi-reader-web/issues)

The guide covers getting started, library organization, reading, accounts and data, migration, comparisons with other readers, and contributing. Its source is in [`site-docs/`](site-docs/). Build it with [Zensical](https://zensical.org/):

```sh
python3 -m pip install -r requirements-docs.txt
bash scripts/build-docs
```

The site builds into `apps/web/build/docs/` after the web app build. The backend release pipeline packages both in one static artifact; production publication is controlled separately by the backend deployment configuration.

## Licensing boundary

Reader-owned source is BSD 3-Clause. The current local-dictionary provider is built from an exact pinned revision of [Manabitan](https://github.com/ManabiIO/manabitan), a separately licensed GPL-3.0-or-later Yomitan fork. Manabitan source is checked out and built in an isolated ignored cache; its generated runtime is distributed with its GPL license and exact corresponding source rather than vendored into Reader source.

Contributions must keep GPL implementation code out of Reader-owned modules. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [dictionary provider boundary](docs/architecture/dictionary-provider-boundary.md).

Manabi Reader for Web began as a fork of [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader). Its [original README](docs/ttu-upstream-readme.md) is retained for attribution and historical reference. See the guide's [Credits](site-docs/credits.md), [BSD 3-Clause](LICENSE), and [third-party UI licenses](THIRD_PARTY_UI_LICENSES.md).

## Expo Android and web draft

The migration branch uses Expo SDK 57 and React Native 0.86 for Android and web. The native Apple apps remain separate; this project has no iOS or macOS target. See [architecture, verification and open parity gates](docs/expo/MIGRATION.md) before treating this draft as a release candidate.

Use Node 24.21.x and pnpm 12.3.4. `pnpm dev` starts web; `pnpm build` exports the existing `/reader-web` static deployment; `pnpm android` prepares/runs Android. `pnpm export:android` verifies the native/DOM bundle without deploying. `pnpm test:reader`, `pnpm test:whispersync`, and `pnpm test:expo` retain the core regression workflows.

The draft CI performs builds and tests only. It does not merge, deploy, enable EAS Update, or modify another repository.
