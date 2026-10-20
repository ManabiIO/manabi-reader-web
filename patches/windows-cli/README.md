# RN Windows 0.85 CLI discovery

Importing the published CLI eagerly discovers PowerShell in two modules. Expo
autolinking and rnx-kit platform discovery both import that configuration on
macOS/Linux, even when no Windows build command is being executed. Failure
caused rnx-kit to omit Windows and bundle mobile RN internals instead.

This exact-version patch defers discovery until a script, diagnostic, or repair
actually needs it. It adapts the MIT-licensed Expo Desktop template's 0.83.2
patch to the reviewed 0.85.0 files. Missing PowerShell still fails the operation;
no executable path or runtime module is faked. See `upstream.json` for attribution
and the original hashes. pnpm applies the patch during dependency installation.

`node --test patches/windows-cli/contract.test.mjs` reverses/reapplies the patch
in a fresh temporary directory, verifies upstream hashes, imports the actual RNW
configuration, and executes success/failure behavior for diagnostics. These
tests do not compile Windows binaries or exercise PowerShell itself.
