# Browser design reference and refinement

Research and captures: October 10–11, 2026. Scope: the active Expo Router web app in `apps/web`, based on `origin/main` a1101b66. The root Svelte UI is retired. The dirty primary checkout was preserved in place; this work uses an isolated worktree.

## Reference evidence

- **App Store Connect, May 28, 2026 release notes:** Apple says the homepage now opens directly to Apps and uses a top navigation bar. This is current product evidence, not evidence of particular border radii or glass CSS. [Official release notes](https://developer.apple.com/help/app-store-connect/release-notes/).
- **Visible App Store Connect web UI:** the public WWDC25 “Get to know the new App Store Connect” video, frame at approximately 03:24, shows TestFlight build uploads: plain text top navigation, a flat sidebar, grouped controls and restrained table separators. The video is from 2025; it is not presented as a newly authenticated 2026 screenshot. [Official video](https://developer.apple.com/videos/play/wwdc2025/328/).
- **Current public iCloud help imagery:** Apple's Contacts example shows a text Edit action and unboxed plus/share controls. Circular blue glyphs identify contact field types; that does not justify making every toolbar action a circle. Apple's Drive example shows a full-height sidebar, a rectangular search field and a list with restrained separators. The public images are undated; October 10–11 is the retrieval date, not an asserted redesign date. [Contacts guide](https://support.apple.com/guide/icloud/view-contacts-mmfba73ffb/icloud), [Drive guide](https://support.apple.com/guide/icloud/view-files-and-folders-mmebf050837b/icloud).
- **Notes, Calendar and Mail:** current public guides describe folder/list/detail navigation, list-top search, view controls, and Mailboxes/Settings/Refresh actions. Full signed-in current application pixels were not accessible. Fresh signed-out iCloud pages were inspected; those landing pages are not evidence of signed-in app chrome. [Notes](https://support.apple.com/guide/icloud/notes-on-icloudcom-overview-mm6704cac5/icloud), [Calendar](https://support.apple.com/guide/icloud/use-calendar-on-icloudcom-mmd67283e4/icloud), [Mail](https://support.apple.com/guide/icloud/read-email-mm6b1a0b80/icloud).
- **Native HIG, separately:** current Materials, Layout, Buttons, Toolbars and Sheets guidance supports hierarchy, related action grouping, adequate targets, clear dismissal and predictable modal behavior. Liquid Glass material guidance concerns native platforms; it is not a specification of Apple's web implementation. [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets).

## Decisions

Use ordinary opaque browser surfaces, system UI fonts with Windows/Linux/Japanese fallbacks, existing semantic Manabi colors and restrained eight-pixel action corners. Keep icon-only search, collections and overflow where their functions are familiar and names remain accessible; make Import a visible text action when space permits. Hover, expanded, pressed and keyboard focus states remain distinct.

Tablet and desktop share the same flat navigation rail from 768 px. The toolbar wraps naturally when search needs another row. Phone controls retain 44 px targets. Remove the floating rail frame and blurred library header, reducing layers between navigation and content. Keep the reader's Japanese typography and vertical layout independent of shell fonts.

Empty states identify missing books and offer existing actions. Remove the large empty-library card and the decorative “for Web” suffix; add no promotional copy, artwork or new data features. Retain useful import and connection guidance. Editor's Picks retains its loading, empty, error and retry behavior. There is no separate feed-management screen in the current web navigation, so none was invented.

Browser overrides load from `RuntimeProvider.web.tsx`. The native runtime and Android embedded reader's shared base styles remain unchanged. Persistence, imports, account connections, reading controls and lookup ownership are untouched.

## Review and qualification

Screenshots are kept outside Git. Library upload was attempted with the current supported batch helper, but it stopped before preparation because `Library prepare_uploads is not available`; no preview IDs were created. The local comparison gallery is `/Users/alex/Documents/Codex/2026-10-10/task-23/evidence/review-index.html`.

Disposable browser profiles use generated book and dictionary fixtures; external requests are blocked. Qualification includes a web-only export, TypeScript, 22 focused unit checks, 46 rendered Chromium/WebKit captures at 320/390/820/1440 px, light/dark appearance, collections Tab containment/Escape/close/focus restoration, 200% text with reachable lower sheet actions, catalog loading/empty/error/populated fixtures, a real one-entry Yomitan import and lookup, and a vertical Japanese fixture book. The matrix has zero horizontal page overflow. Actual screenshots were visually inspected, including phone, tablet, desktop, dark mode, imports, lookups, sheets and enlarged text. Run the repeatable matrix with `MANABI_WEB_EVIDENCE=/absolute/path/outside/repository node test/expo/web-design-browser.mjs` against `PORT=4183 node scripts/serve-expo.mjs`.

No native build, production deployment, account connection, merge or real-user mutation is part of this change.
