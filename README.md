# Manabi Reader for Web

Read and organize your own ebooks in a browser. Manabi Reader for Web is a free, open-source reader with a personal library, flexible page layouts, bookmarks, reading progress, and optional account sync. There is no bookstore or discovery feed.

**[Read the user guide](https://manabi.io/Manabi-Web/Docs/)** · [Open the reader](https://manabi.io/reader-web/) · [Report an issue](https://github.com/ManabiIO/manabi-reader-web/issues)

The guide covers getting started, library organization, reading, accounts and data, migration, comparisons with other readers, and contributing. Its source is in [`site-docs/`](site-docs/). Build it with [Zensical](https://zensical.org/):

```sh
python3 -m pip install -r requirements-docs.txt
bash scripts/build-docs
```

The site builds into `apps/web/build/docs/` after the web app build. The backend release pipeline packages both in one static artifact; production publication is controlled separately by the backend deployment configuration.

Manabi Reader for Web began as a fork of [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader). Its [original README](docs/ttu-upstream-readme.md) is retained for attribution and historical reference. See the guide's [Credits](site-docs/credits.md), [BSD 3-Clause](LICENSE), [third-party EPUB licenses](THIRD_PARTY_EPUB_LICENSES.md), and [third-party UI licenses](THIRD_PARTY_UI_LICENSES.md).
