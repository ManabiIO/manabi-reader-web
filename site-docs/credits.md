# Credits

Manabi Reader for Web began as a fork of [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader), also known as Ttsu Reader. Ttsu provided the foundation for EPUB, HTMLZ, and text reading, flexible layouts, bookmarks, reading statistics, and data import and export. We preserve its [original README](https://github.com/ManabiIO/manabi-reader-web/blob/main/docs/ttu-upstream-readme.md), [BSD 3-Clause license](https://github.com/ManabiIO/manabi-reader-web/blob/main/LICENSE), and ッツ Reader Authors notice.

The EPUB reader includes code derived from [Foliate.js](https://github.com/johnfactotum/foliate-js), used under its MIT license.

The interface uses [shadcn-svelte](https://www.shadcn-svelte.com/) components and [Bits UI](https://www.bits-ui.com/). The [third-party UI notices](https://github.com/ManabiIO/manabi-reader-web/blob/main/THIRD_PARTY_UI_LICENSES.md) credit Hunter Johnston, CokaKoala, and shadcn.

The local dictionary feature can load a generated runtime from [Manabitan](https://github.com/ManabiIO/manabitan), a Yomitan fork licensed GPL-3.0-or-later. Reader builds an exact pinned revision outside its source tree and publishes the runtime with its GPL license and corresponding source. Reader-owned integration code remains subject to Reader's BSD license; see the [dictionary provider boundary](https://github.com/ManabiIO/manabi-reader-web/blob/main/docs/architecture/dictionary-provider-boundary.md) for the source-ownership rules.

The optional read-along playback adapts [4890A/ttu-whispersync](https://github.com/4890A/ttu-whispersync), which builds on [Renji-XD/ttu-whispersync](https://github.com/Renji-XD/ttu-whispersync). Its [license notice](https://github.com/ManabiIO/manabi-reader-web/blob/main/apps/web/static/licenses/ttu-whispersync.txt) remains with the app.

This guide is built with [Zensical](https://zensical.org/). Thanks to the maintainers and contributors of these projects.
