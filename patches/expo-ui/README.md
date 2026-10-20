# Expo UI 56 accessibility backport

Expo UI 56.0.26 has `semantics({ contentType })`, but it does not expose
`contentDescription`. Reader's existing Android switch and checkbox labels use
the latter. Dropping the label to satisfy a type check would regress accessibility.

This version-scoped patch backports the description field and Compose assignment
from Expo UI 57.0.21. It preserves the existing autofill content type and no-op
behavior when neither field is supplied. The TypeScript source and emitted
declaration agree with the Kotlin record and native modifier.

The application explicitly builds `expo-ui` from source so its precompiled AAR
cannot bypass the patch. `scripts/verify-reader-dom-autolinking.mjs` verifies the
resolved module version, Gradle project, full-match source-build rule and native
field implementation, alongside the existing DOM host guard.

`contract.test.mjs` reverses the patch in a fresh temporary copy, verifies each
upstream hash, reapplies it, and executes the installed JS modifier factory.
It retains its temporary evidence. Installed package files are never edited by
the test. The lockfile applies the reviewed patch during installation.

These checks are not a native Android build or TalkBack test. Those remain
required for this SDK candidate. This patch does not add Windows Expo UI support.
