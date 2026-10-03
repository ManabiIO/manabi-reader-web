# Contribute

Manabi Reader for Web is free and open source. We intend to maintain and grow it as a standalone reader alongside the native Manabi Reader apps.

Use [GitHub Issues](https://github.com/ManabiIO/manabi-reader-web/issues) to report a bug or propose a change. Include the browser, steps to reproduce, and a small sample book only if you have permission to share it. Do not post private books or account data.

To contribute code or documentation, fork the repository, make a focused change, and open a pull request. Read the repository's [CONTRIBUTING.md](https://github.com/ManabiIO/manabi-reader-web/blob/main/CONTRIBUTING.md) before writing code, especially for dictionary work.

## Dictionary licensing boundary

Reader source is BSD 3-Clause. Its current local-dictionary provider is a separately licensed GPL-3.0-or-later Manabitan runtime built from an exact pinned revision.

GPL implementation source from Manabitan, Yomitan, or Yomichan must stay outside the Reader source tree. Reader-side dictionary work uses an independently authored provider contract and a small provider adapter; implementation changes to the GPL engine belong in the Manabitan repository. Generated Manabitan runtime files are not committed to Reader.

This separation keeps Reader's own source provenance clear and makes the dictionary provider replaceable. See the full [contribution policy](https://github.com/ManabiIO/manabi-reader-web/blob/main/CONTRIBUTING.md) and [dictionary provider boundary](https://github.com/ManabiIO/manabi-reader-web/blob/main/docs/architecture/dictionary-provider-boundary.md).

Run the relevant checks before submitting, including the dictionary boundary check for normal code changes:

```sh
pnpm test:dictionary-boundary
pnpm eslint .
pnpm --dir apps/web check
```

Documentation lives in `site-docs/` and builds with Zensical:

```sh
python3 -m pip install -r requirements-docs.txt
bash scripts/build-docs
```

The project is licensed under [BSD 3-Clause](https://github.com/ManabiIO/manabi-reader-web/blob/main/LICENSE). See [Credits](credits.md) for its lineage and third-party work.
