# Windows support deferred

On October 20, 2026, the user removed native Windows from this edition's scope
until Expo UI supports it. The active targets are **web and Android**. There is
no Windows app workspace, native build workflow, RN Windows dependency, or
Windows CLI patch in the current source.

The Windows-only SDK 56 downgrade was undone. The application returns to its
pre-experiment Expo **57.0.26**, React Native **0.86.3**, React **19.2.3** baseline,
including the existing Android secure-origin DOM patch. SDK 58 remains a separate
upgrade to qualify on web and Android; a desktop version intersection no longer
constrains that choice.

No user database, storage origin, backup format, or existing saved data was
changed. The Windows developer bootstrap never opened a Reader library.

[Desktop research](DESKTOP-RESEARCH-2026-10.md) is retained as historical evidence,
not an active implementation plan. The
[retired experiment](https://github.com/ManabiIO/manabi-reader-web/tree/395f4605086e7fe26c27f2c88c9017b04cb25fdc/apps/windows)
and its
[qualification record](https://github.com/ManabiIO/manabi-reader-web/blob/395f4605086e7fe26c27f2c88c9017b04cb25fdc/docs/expo/WINDOWS-SDK-COMPATIBILITY.md)
remain in Git history. No completed native Windows runtime acceptance is claimed.

Reconsider native Windows only after Expo UI documents Windows support and a new
explicit product decision resumes it. Ordinary browser use is still available
on desktop operating systems; it does not imply a native Windows release.

Removal validation: frozen installation, application TypeScript, scoped lint,
71 focused CI/Android DOM/export checks, both production exports, and nine
browser connection/offline scenarios pass. The latter cover compact/sidebar
sizes in Chromium and WebKit and a persistent-profile offline restart with a
new local save. The Android export remains an inventory, with the existing
relocated-worker warnings; it is not APK or device acceptance.

Expo's online dependency check reports newer SDK 57 patch packages and React
type versions outside its recommended range. This cleanup deliberately restores
the exact pre-experiment lockfile; it does not claim latest-package alignment.
Resolve those versions as part of the next web/Android SDK upgrade.
