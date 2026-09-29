# Remote-source lifetime and full-page recovery

Base: `c474d290acf33a13df14e930973a6351f9c5a5f0`. The unchanged runtime is
manabi-web-v7, using the same Mudler Q5_0 model and saved window/repair policies.

## Production correction

A cloud source checked account lifetime at each network read, but a decoder can
return cached metadata, packets or rendered audio without another network read.
The adapter and pipeline previously checked only cancellation there. Full-file
identity could likewise finish after its final progress callback revoked the
source, and a custom read could return cached data after revocation.

`sourceLifetime` captures the admitted predicate/receiver and latches rejection.
Pipeline operations check before/after awaited work, dispose their input on
revocation, and cannot revive it when a caller later replaces the predicate.
Retained adapter track methods check as well. Full hashing and streamed ranges
check after reads and before returning their result. Existing cancellation still
owns an aborted operation; the change is not a new account event subscription.
A source without an account predicate retains its existing behavior.

The check does not detect a remote file mutation without server evidence. ETag,
Content-Range and user checks on every real cloud response remain authoritative;
cached bytes from the already validated immutable version are not re-downloaded
on every playback tick. No credentials or source handles are added to saved jobs.

## Stronger encoded qualification

The range-backed case now encodes deterministic high-entropy video frames around
the same synthetic Japanese audio, requiring more than 8 MiB of real media. It
uses no artificial padding, virtual byte offsets, or reduced production cache.
Every HTTP read stays within the 4 MiB transport budget. Observed source reads are
labeled separately from full hashing. Late audio decoding and resumed decoding
must each perform a successful nonzero read beyond 4 MiB; identity reads cannot
satisfy that condition. Audio waveform and caption-quality thresholds are unchanged.

After the first accepted window, the test cancels, closes the queue/database,
performs an actual browser page reload, reconstructs the remote source and verifies
its full identity, reads the real persisted checkpoint, and explicitly resumes.
No model preparation or publication is allowed merely because the page reloaded.
Exactly one model call/ordinary decode occurs in each page lifetime. The final
track must preserve the original accepted prefix, survive another database reopen
and serialize to SRT. The HTTP fixture and driver-supplied reconnection descriptor
are not live-provider authentication or the full workspace's alias-reconnect UI.

The native path also checks that cached metadata and retained track methods reject
a revoked source without requesting additional bytes. A new valid source/pipeline
is used afterwards; the retired pipeline cannot resume.

## Evidence

Local fixture-enabled strict media TypeScript/Node suite: 705 passed, no skips or
failures. Thirteen new lifetime cases include ten pipeline/hash/stream scenarios;
the first nine were reproduced as failures against the unmodified base before
implementing the guard. The separate helper cases test sticky revocation and
predicate receiver/error preservation. The Python/native-helper suite passes 96 cases. Five new Python evidence checks ensure
that whole-file hashing, same-page reopen, oversized ranges or repeated recognition
cannot manufacture a passing remote-reload result.

Local work uses a CI-derived source subset. Full application, actual adapter and
real-model/browser results must be read from the newly published head's CI. Native
loopback navigation is blocked in the local environment; no local native-browser
pass or physical-device result is claimed. A local English high-entropy fixture
generation succeeded and produced over 20 MiB of real encoded video.

## Remaining scope

Resource-safe frozen-owner recovery, natural continuous Japanese dialogue and
long-duration behavior, exhausted repair budgets, physical Safari/iOS, controlled
device memory/throughput and live-provider/account composition remain separate
gates. This change does not steal a lock, change the model, re-time audio, relax
caption acceptance, merge the draft stack or activate production.

Primary references:
- https://mediabunny.dev/api/CustomSourceOptions
- https://mediabunny.dev/api/Input
- https://mediabunny.dev/guide/media-sinks
