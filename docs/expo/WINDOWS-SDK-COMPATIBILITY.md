# Windows support deferred

On October 20, 2026, the user removed native Windows from this edition's scope
until Expo UI supports it. The active targets are **web and Android**. There is
no Windows app workspace, native build workflow, RN Windows dependency, or
Windows CLI patch in the current source.

The Windows-only SDK 56 downgrade was undone. The removal checkpoint restored the
pre-experiment Expo **57.0.26** baseline and its Android secure-origin DOM patch.
The subsequent [SDK 58 upgrade](MIGRATION.md#october-20-sdk-58-upgrade) targets only
web and Android; a desktop version intersection no longer constrains that choice.

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

The removal checkpoint deliberately restored the exact pre-experiment lockfile.
The subsequent SDK 58 work resolves its reported Expo/React dependency drift;
current versions and qualification are tracked in the migration document.
