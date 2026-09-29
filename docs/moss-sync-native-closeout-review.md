# Sync failure identity and native-handle qualification

Review checkpoint: September 28, 2026. No production activation or model change.

## Published implementation and source composition

Parent #67 repair `1bdb385c4f0a2d536e02c1293a37de947eefb529` changes
`sync.ts`, corrects an existing transport test, and adds 22 sync regressions.
It starts at `1fa060954d7ba241378f3de2f82b7fe01ac8314b`, retaining the decoder,
source-revocation and account-lifetime work. Child #79 integrates that parent
with the existing import/caption repairs and the browser tooling described here.

The local media source was reconstructed from artifact 10997957187 of Video
run 36482009156: ZIP SHA-256
`be99d84e40f09a27f8559b34186ea652ecce05d1c3a2d640e049972423453f91`.
Its tested merge was `64911aa6e386d5763135d41fdded281bf6624994`, tree
`4781118cf008b5b70015e25cb6003a773abd4c0b`, combining parent `1fa06095`
and child `e20223a7`. The integration uses that actual repository tree, not the
partial reconstruction's synthetic local Git tree.

## Sync mutation errors retained without granting stale authority

The mutation catch block previously called its account guard before reporting
an already-failed upload. If the account became unavailable or its predicate
threw, the secondary guard error replaced the original transport failure.
Dereferencing `status` on a null/undefined rejection also replaced that rejection
with a TypeError.

The repair preserves the original rejected value. Only a valid 412 response
from the still-current, uncancelled account can become a stored conflict.
Revoked or throwing account observations cannot acknowledge or apply a conflict;
the original mutation stays pending and the local payload is retained. Existing
preflight, successful-response, user-identity and mutation-ID guards remain.
No failed upload is converted to success.

The 22 production-store scenarios give 14 failures / 8 passes on the previous
sync function and 22 passes after repair. They use the real MediaStore with a
transaction double: five rejected values across three account states, three
conflict states, three cancellation reasons, and a fail-closed preflight.
These are not live provider or native database results.

The existing transport regression also had a test-ordering defect: it threw
from the second account check, before reaching the network request. It now
changes account-observation behavior only after that request fails, and asserts
that exactly one request ran. No account check or assertion is removed.
The prior CI core result was 838 passes and one failure among 839 tests.

## Native crash reproduced independently; upstream-fixed execution passes

The four standalone artifacts from run 36482009156 all record the same tested
merge/tree above. The probe imports no Manabi application code.

| Executable                        | Persistent profile                | Incognito profile                                 |
| --------------------------------- | --------------------------------- | ------------------------------------------------- |
| Playwright Chromium 153.0.8010.12 | Passed, including browser restart | Failed reading the stored handle, before callback |
| Chrome for Testing 154.0.8037.57  | Passed, including browser restart | Passed, including reload                          |

Successful checks verify native OPFS/IndexedDB read, rewrite, same-entry identity
and exact file bytes. Both profiles reload the page; persistent profiles also
close and restart the entire browser with the same temporary profile.
The original Incognito run commits the write, logs `read-admitted`, then the
browser disconnects without delivering the read callback. This reproduces the
failure without MediaStore or workspace code. The identical probe passes on
the tagged version containing Chromium's SQLite in-memory FSA fix.

Artifact identities and verified ZIP SHA-256:

- Original persistent: 10997652364,
  `bc17cb8361347dd46251477f50d6f72d8f5821f36ac4cde309b6d82c000c524c`.
- Original Incognito: 10997622880,
  `7c52ae55a9656587938aeca3519837fb87f04ae12ce0095311213c4e99b25ddc`.
- Fixed persistent: 10998430982,
  `cdcaf14627907e9e0f8e41f7932f0ac2c457093d802643732af6088559d7ba7e`.
- Fixed Incognito: 10998007711,
  `d5b03eb689e4570f7aae37c0c76095af6f629f363d1c3daecb0e17c4944ddc02`.

This establishes an external browser failure with successful upstream-fixed
execution of the independent probe. It does not yet qualify all 19 production
import scenarios on the fixed browser: the application job in that run stopped
at the core-test failure before executing them.

## Explicit test-browser disposition

Required Video checks now use the fixed Chrome for Testing 154.0.8037.57 pin.
Both persistent and Incognito independent probes remain required, as do the
unchanged 19 production-import assertions in each profile. The actual Svelte
application runner honors the same `CHROMIUM` executable as the native and
controller runners. No application serialization workaround, private-mode
fingerprinting, assertion suppression or expected-failure conversion is added.

The legacy Chromium 153 reproduction is retained through the Video workflow's
`workflow_dispatch` input `legacy_browser: true`. Selecting it adds the original
browser/profile combinations and still reports the observed failure normally.
It is no longer a permanently failing default PR requirement after the external
cause and upstream-fixed execution have been established. This is an explicit
qualification-baseline change, not a claim that affected versions now work.
Persistent-handle reads in the affected private browser remain incompatible;
this review does not implement support for that broken executable.

`install-qualified-chromium.sh` fetches the official fixed-version archive and
checks its archive hash, executable hash and reported version before exporting
`CHROMIUM`. Both successful fixed-browser CI artifacts independently recorded:

- Archive: `ceee2972074d441ea7c4ba8bcc0eaab77e7e87680f6653d73d3065851fe10302`.
- Executable: `e528b77a8b250c48a5bbd7aeeabbc2813940c0a2fe39b1b11fbaf1f01fb04f18`.

These are observed official-download hashes, not vendor-signed checksums. Five
installer tests execute the real Bash verification with local fixture bytes,
covering valid input, corrupt archive, wrong executable, wrong version and
failed download. Unverified executables are never exported to the job.

## Executed local verification and remaining work

- Strict media TypeScript/Node with generated English fixtures: 861 passed;
  zero failures, cancellations or skips.
- Python tooling/native-helper suite: 108 passed, including five new installer
  tests. Scripted fixture/driver failure cases are expected unit-test inputs,
  not failed native browser runs.
- Chromium production player: 79 passed; workspace: 45 passed; caption/transition:
  14 passed. These use real MP4 playback with documented storage/decoder/model
  doubles. The first workspace attempt exceeded its external 120-second process
  allowance. An isolated unchanged retry case passed, and the complete rerun
  with a 300-second process allowance passed without changing test assertions
  or their internal waits.
- Changed-file formatting, workflow shell syntax, Python syntax and diff checks
  passed. Full repository formatter plugins, lint, Svelte/Mediabunny/build and
  new-head native/ASR runs still belong to CI.

Local runtime: Node 22.16.0, TypeScript 5.8.3, retained Prettier core 3.6.2;
this is a verified media subset, not a full locked-dependency checkout. Local
native navigation remains administrator-blocked and was not bypassed.
The successful native profile results above are real CI results, not local runs.
No new real-model, latency, memory, natural-speech or physical-device claim is made.

Before integration, obtain the selected head's complete CI matrix, including
both production-import modes using the verified browser, encoded-path/MOSS
lifecycle checks, and current-main composition. Natural Japanese and long-form
seams, resource-safe frozen-owner recovery, live provider/account composition,
controlled device memory/throughput and physical Safari/iOS remain release work.
No runtime binary, model, sparse policy, schema, backend, feature activation or
main-branch merge is part of this review.

Primary upstream references:

- https://github.com/chromium/chromium/commit/909a0222ba0f48ace3fd3a011b379dcd998871bb
- https://github.com/chromium/chromium/blob/154.0.8037.57/content/browser/indexed_db/instance/sqlite/database_connection.cc
- https://playwright.dev/python/docs/release-notes
- https://googlechromelabs.github.io/chrome-for-testing/154.0.8037.57.json
