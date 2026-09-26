# Yatsu Reader backup fixture

`complete-local-backup-v11.zip` was exported from the public Yatsu Reader web app
(`https://app.yatsu.moe`) on 2026-09-23 using an isolated, signed-out Chromium
profile. The profile contained only a synthetic 118-byte TXT book titled “Manabi
Yatsu Portability Fixture.” In Yatsu, the book was tagged “Portable Shelf,”
opened, given a saved reading position and a saved bookmark; the app's “Get
complete local backup” action produced this ZIP. It is 5,929 bytes and contains
no copyrighted book media or personal account data.

SHA-256: `88a45e85dc37bbc73f8ff266ca77fc5dad42ed60c4a5830d358134258318ac06`

The fixture exercises Yatsu's actual version-11 archive names, backup manifest,
`bookmeta` sidecar with a tag, saved position, saved bookmark, and statistics.
The ZIP also includes Yatsu's
default local settings. The original TXT source can be reconstructed from this
short content:

```text
Manabi Yatsu Portability Fixture

これは移行テスト用の短い文章です。
Another sentence for bookmarks.
```

The fixture is evidence of this observed Yatsu export shape, not a promise that
future Yatsu versions use the same schema. Keep import validation versioned and
bounded; never silently treat an unknown version as TTU data.
