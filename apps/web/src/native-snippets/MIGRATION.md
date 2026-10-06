# Shared native snippets controls

## Implemented

`NativeSnippetsScreen` is an Android/web-compatible React Native surface. It provides a paged shelf; source and trash filters; title, body and furigana search; new snippets; editing; reviewed duplication; soft deletion and restore; draft recovery; and a writable source/folder destination picker. Inputs, lists, buttons and dialogs are native controls. Reader content remains in the existing DOM reader owner.

The native editor edits each existing text run and its furigana, a custom/automatic title, and source title/link. It can append paragraphs. It applies admitted run patches to a clone of the original structured document. Heading levels, block IDs, list topology, code language, hard breaks, horizontal rules, other text marks (including links), and source item/quote attribution survive saves. It never round-trips content through plain text or reader HTML. Emptying a run explicitly removes only that run. An empty paragraph can be filled without changing the surrounding structure.

The UI checkpoints drafts after 800 ms of inactivity, on Android Back, when backgrounded, and best-effort on unmount. An explicit Keep draft & close waits for persistence before closing. A rejected checkpoint remains visible and does not repeatedly retry without an edit. Inputs are temporarily disabled during checkpoint ownership. A process kill before the first checkpoint can lose the latest keystrokes; the UI distinguishes unsaved text from saved drafts.

## Integration contract

Create one `NativeSnippetsService(createNativeSnippetsRepository())` in the existing trusted DOM runtime. The repository must never be imported by a native route. Wire `snippets.state` to `service.state(payload, authority)` and `snippets.action` to `service.action(payload, authority)`. The trusted caller supplies `{ key, signal, assertCurrent }`, including the native session/account generation in `key`; these values are not accepted from bridge payloads. Call `dispose()` on runtime teardown.

Render `NativeSnippetsScreen` with `{ identity, request, onRead? }`. `identity` must include the current session and account generation; a change remounts the native workspace and clears account-specific fields. `request` calls the above two trusted methods. `onRead` is optional until the reader host is wired. A read action returns `readerId` and `readerRevision` for the host to reread/revalidate before mounting `SnippetReader`; the host must preserve this authority through its reader lifetime. The screen can then navigate through `onRead(id)`.

The existing `startSnippets` runtime remains the one outbox/discovery/synchronization owner. This adapter creates no new database, workers, sync loop, credentials, storage permissions or provider transport. Changes use the existing snippet store, durable draft APIs, revision-checked document commits and transaction mutation API. Uploads remain in the existing outbox. A pending flag means queued locally, not successfully uploaded.

## Ownership and recovery

- A bounded admission binds each list selection or editor revision to trusted session/account authority and its expected document revision
- Source/folder handles are opaque. Provider IDs, filesystem handles, private roots, create IDs and provider revision tokens do not cross the bridge
- Real source descriptor/capability checks are rerun before browsing or assigning a new destination. Revoked capability preserves the durable draft
- Drafts are persisted before save, with monotonically ordered checkpoint timestamps. Reopening a saved draft creates a fresh editing lease to keep an older screen from replacing it
- Repeated identical action tokens return the same bounded receipt without repeating a mutation; mismatched replay is rejected. Lost/expired host admissions require rereading saved state
- Saves use the original base revision in the IndexedDB transaction. A conflict returns the retained native draft with an explicit save-as-copy recovery path
- Native trash/restore rechecks the admitted revision inside the existing record transaction. Trash remains reversible
- A resumed draft whose underlying document changed is flagged before further saving. Canonically saved document revisions reconcile an interrupted save without manufacturing another identity

## Explicit remaining gaps

This is substantive native functionality, not full Tiptap feature parity. Structural layout editing, bold/italic/link tools, Markdown import/export, clipboard capture-to-existing-snippet, full conflict-version selection, folder creation, remembered default destination, file portability/backup, provider authorization, permission escalation, moving existing documents and transfer-journal recovery remain in the web workflows. The source attribution already present is preserved.

Browser File System Access folders are listed with an explicit Android limitation and cannot become new native write destinations. The existing local record/outbox is retained; this implementation does not claim persistent Android folder access. Connected writable Google Drive, Dropbox, OneDrive and WebDAV use their existing domain storage adapters. Live OAuth, cloud writes, WebDAV server behavior and filesystem permission prompts were not exercised here.

Bounds are explicit: 40 list rows/page, 100 visible saved drafts, 200 visible sources, 500 subfolders, 400 editable text runs and 320 KiB documents/edits. Native search matches all title/excerpts plus up to 500 full documents / 16 MiB body scan; its incomplete flag is shown instead of presenting truncated results as exhaustive. Larger rich documents fail closed with instructions to use the web editor. The original document is unchanged.

## Verification

Run from the repository root with Node 24:

- `node --test test/expo/native-snippets.test.mjs`: 20 service/model regressions using actual structured document and IndexedDB draft/save APIs
- `node --test test/expo/native-snippets-adapter.test.mjs`: 5 production-adapter regressions, replacing only account/provider transport boundaries
- `node --test test/expo/native-snippets-ui.test.mjs`: 5 real React lifecycle regressions with native primitive rendering shims; repeat-click fencing, account replacement during an in-flight editor, native input/autosave and Back, failed-checkpoint retry suppression, subscription cleanup and current-query preservation on Back
- `node test/expo/native-snippets-typecheck.mjs`: strict scoped diagnostics using production Expo TypeScript configuration and real dependency types

The transport fixtures use actual Google, Dropbox, OneDrive, WebDAV and local descriptor shapes. These are focused checks, not Android emulator/device or production Metro export qualification. Native keyboard/IME behavior, physical Android Back/background timing, platform rendering and the integrated DOM snippet reader still need device-level QA.
