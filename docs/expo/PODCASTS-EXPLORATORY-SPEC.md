# Podcasts + MOSS ASR exploratory implementation spec

Status: exploratory handoff draft for revision by the next worker. This document intentionally changes no production code.

Reviewed source: `feat/expo-android-web-migration` through `616f2846e99f1b4a48a340ddb3406fd06585f02a` on 2026-10-02. Media files underlying this review did not change between the original review base and this refinement; the intervening Expo commits advanced shared Settings/CI migration work.

Target product direction: add a Podcasts category focused first on Japanese native-immersion listening, using original publisher podcast enclosures directly in the client and reusing the existing local MOSS transcription stack. No audio proxy or Manabi audio rehosting is proposed.

## 1. Executive recommendation

Do not implement Podcasts as an unrelated player or as a renamed copy of Videos.

The current branch already has most of the expensive media/transcription domain work below the video-specific UI:

- bounded random-access media reads
- Mediabunny parsing and audio decode
- 16 kHz mono PCM production
- MOSS Worker/model lifetime
- sparse/playhead-prioritized transcription
- durable in-progress jobs and audio proofs
- caption tracks and paging
- transcript study behavior
- local media search
- cancellation, account lifetime, cross-tab MOSS serialization, and model cleanup

The recommended architecture is therefore:

~~~text
curated podcast catalog / RSS metadata
            |
            v
qualified original enclosure URL
            |
            +------> browser audio playback
            |
            v
remote HTTP ByteSource
            |
            v
Mediabunny / MediaPipeline
            |
            v
bounded 16 kHz mono PCM windows
            |
            v
existing TranscriptionQueue + MossClient
            |
            v
existing Cue / Track transcript domain
            |
            v
podcast-specific player shell + shared transcript/study presentation
~~~

The first implementation should be deliberately narrow:

1. Japanese-language curated catalog.
2. Prefer a publisher-provided timed transcript (`podcast:transcript`) when one is present, readable, and valid; use MOSS as the fallback rather than paying to regenerate authored captions.
3. Only enable MOSS for episodes whose exact publisher enclosure is browser-readable, range-capable, decodable, and sufficiently byte-stable for one admitted rendition session.
4. No proxy fallback.
5. No automatic transcription.
6. No automatic 648 MB MOSS model download.
7. Playback is immediate.
8. Generate transcript is explicit and transcribes around the playhead first using the existing sparse policy.
9. Do not overload RSS GUIDs or enclosure URLs as existing ContentKey values.
10. Do not redesign the synced video record protocol in the first implementation.
11. Treat native Android presentation as gated by the same domain/view separation still required for Videos on the Expo branch.
12. Treat sources with personalized/dynamic bytes that cannot satisfy rendition checks as playback-only in v1, not as something to paper over with weak identity.

The largest implementation risk is not MOSS. It is remote episode identity and byte stability. The current video system correctly treats ContentKey as a full-byte SHA-256 identity. Podcast enclosures can be large, redirect through analytics/ad infrastructure, and may be dynamically personalized. That must remain explicit.

## 2. What was reviewed on the Expo branch

### 2.1 Expo route state

The Expo branch currently has:

- apps/web/src/app/videos.tsx -> screens/routes/videos
- apps/web/src/screens/routes/videos.web.tsx -> media-react VideosScreen
- apps/web/src/screens/routes/videos.tsx -> native placeholder saying the Android migration is still in progress
- apps/web/src/routes/videos/+page.svelte -> retained Svelte reference/route implementation
- apps/web/src/media-react/index.tsx -> React web host that still mounts the framework-neutral DOM VideoWorkspace

This means Videos is not yet a shared Android/web feature presentation.

The branch's own docs are explicit about this:

- docs/expo/SHARED-UI-CONVERGENCE.md says optional video requires domain/view separation before it counts as shared.
- docs/expo/FIDELITY-MATRIX.md marks optional video shared presentation/native player layout incomplete.
- docs/expo/MIGRATION.md keeps media/moss-worker.ts inside the DOM/browser graph when video learning is enabled.

Podcasts should not make this migration harder by adding another large web-only state machine.

### 2.2 Library/category navigation

The current React LibraryTabs in apps/web/src/library-react/navigation.tsx is a small Books / Videos section switcher. The Svelte reference in apps/web/src/lib/media/library-tabs.svelte has the same two destinations.

A Podcasts category fits naturally here:

~~~text
Books | Videos | Podcasts
~~~

It does not need to become a top-level AppNav destination in the first version. It is conceptually another library/listening surface, like Videos.

The current Books screen only shows the section switcher when videoLearningEnabled is true. Podcasts should have a separate experimental feature flag initially rather than being silently coupled to the video flag.

Suggested flag:

~~~text
EXPO_PUBLIC_ENABLE_PODCASTS=true
~~~

The shared section switcher should render the enabled categories based on capabilities. Do not create separate contradictory tab definitions for Svelte, React web, and native long-term; the Expo migration direction is one shared composition with bounded platform leaves.

### 2.3 Existing media source seam is already useful

apps/web/src/lib/media/sources.ts defines ByteSource:

~~~ts
interface ByteSource {
  name: string
  size: number
  version: string
  file?: File
  cloud?: CloudLocator
  isCurrent?(): boolean

  read(
    start: number,
    end: number,
    signal: AbortSignal
  ): Promise<Uint8Array>

  playback(): {
    url: string
    release(): void
  }
}
~~~

The important point is that the rest of the decode pipeline does not fundamentally require a local video File.

apps/web/src/lib/manabi/media-runtime.ts already adapts a non-File ByteSource to Mediabunny CustomSource using streamedRange(), bounded caching, and the network prefetch profile.

A podcast enclosure can therefore become another ByteSource implementation rather than another decode stack.

### 2.4 MediaPipeline is mostly audio/media generic already

apps/web/src/lib/media/pipeline.ts already:

- discovers audio tracks
- validates track metadata
- supports audio-only inputs because getPrimaryVideoTrack() may return null
- computes duration
- decodes bounded windows of at most 64 seconds
- validates packet/memory budgets
- uses OfflineAudioContext to resample/downmix to mono 16 kHz PCM

That output is exactly what the current MOSS queue consumes.

Do not create a podcast-specific MP3 decoder unless qualification exposes a real Mediabunny gap.

### 2.5 Existing MOSS pipeline is reusable

The current video stack already has the right product behavior for long podcast audio:

- MossClient creates one owned Worker and lazily prepares the model.
- First opening media does not install the model.
- Generate is explicit.
- TranscriptionQueue serializes inference and owns durable jobs.
- navigator.locks coordinates MOSS across tabs where available.
- sparse/progressive policies use bounded decode windows.
- queue.prioritize(job.id, currentTime) can prioritize around the user's playhead.
- audioProofAsync records SHA-256 evidence over actual 16 kHz PCM windows that produced hypotheses.
- completed Track records carry MOSS provenance.
- model/runtime cleanup is explicit.
- search only uses already-published transcript data and does not start recognition.

This should remain one transcription engine for video and podcasts.

### 2.6 Current MOSS performance changes the podcast UX

Do not design the initial Podcasts experience around "transcribe the whole 90-minute episode, then start studying."

The recovered MOSS qualification documented in docs/moss-video-runtime-review.md showed Japanese recognition was accurate on its pinned short fixture but far slower than real time on the CI host. The existing sparse/playhead-priority work is therefore especially important for podcasts.

The preferred UX is:

~~~text
open episode
-> play immediately
-> user presses Generate transcript
-> current / near-future listening window is prioritized
-> accepted transcript grows around playback
-> full episode completion may continue while the page remains eligible to run it
~~~

Do not claim background execution after the browser suspends/terminates the page. The current app does not have a magical persistent background inference service.

### 2.7 Existing Expo dependencies change the preferred implementation seam

The Expo branch already depends on:

- `expo-audio ~57.0.5`
- `fast-xml-parser 5.11.1`
- `dompurify 3.4.15`
- `mediabunny 1.59.1`

Do not add another audio playback package or XML parser before evaluating these.

`expo-audio` supports Android and web remote-URL playback and exposes shared play/pause/seek/rate/status APIs. It is a strong candidate for a `PodcastPlaybackPort`, especially on Android where it can support media-session/background playback when explicitly configured. It does **not** replace the MOSS byte path: ASR still needs the CORS-readable `ByteSource`/Mediabunny pipeline.

For web, retaining a bounded DOM `<audio>` leaf may still be preferable if it gives materially better browser semantics/accessibility. The shared product controller should depend on a transport port, not on either choice.

For RSS, prefer the already-installed XML parser with a deliberately hostile-input configuration. Reject `DOCTYPE`/custom entity declarations, bound bytes/depth/item counts, and never pass parsed feed HTML directly to the DOM. Do not rely on parser defaults as the security policy.

### 2.8 The newer Expo work strengthens the shared-controller direction

Since the original review, the Expo branch has begun converging Settings into shared category/search/workspace composition with bounded platform leaves. That is the pattern Podcasts should follow:

- shared podcast/catalog/player state and commands
- bounded web/native playback leaves
- bounded DOM media/ASR runtime where required
- no second feature state machine hidden behind a `.web.tsx` file

Podcasts should ideally help extract this boundary from Videos rather than adding another migration exception.

### 2.9 Current identity model is intentionally stronger than an RSS identity

ContentKey currently means full media-byte SHA-256.

identify(source) reads and hashes the entire source. This is appropriate for local/cloud files because a portable Track is bound to exact bytes.

The local File path can start v3 sparse transcription before that hash finishes:

- deviceKey() creates a device-only sampled hint.
- a random provisional ContentKey owns the in-progress device job.
- audio proofs bind each accepted sparse hypothesis to the decoded PCM that produced it.
- full-file identify() runs separately.
- queue.verifyProvisional() promotes the work only after real content identity is known.

That is the closest existing pattern to reuse for remote podcast audio.

Do not create a ContentKey by hashing:

- feed URL
- RSS GUID
- episode URL
- title/date
- Apple/Spotify directory ID

Those are locator/logical identities, not content-byte identities.

## 3. Product scope

### 3.1 Primary use case

A learner wants a high-quality Japanese immersion source inside Manabi:

1. Browse Japanese podcasts.
2. Pick an episode.
3. Listen normally.
4. Generate Japanese transcript locally when useful.
5. Follow the transcript with playback.
6. Replay/previous/next by utterance.
7. Select text and use the existing reading/dictionary affordances where technically available.
8. Resume later.
9. Search already-generated transcript text without fetching podcast audio.

This is an immersion product first, not a general-purpose podcast replacement.

### 3.2 Catalog positioning

The first catalog should distinguish at least:

- Native Japanese
- Learner-friendly Japanese

The default/primary discovery experience should favor Native Japanese because that is the motivating use case.

Potential editorial tags:

- conversation / 雑談
- news/current affairs
- culture
- history
- technology
- comedy
- interviews
- short
- long-form
- clear/formal
- casual/native-speed

Avoid pretending an algorithmically guessed CEFR/JLPT level is authoritative.

### 3.3 Candidate source families

Working candidates from the exploratory research:

| Host/source family | Why it matters | Working status for this project |
| --- | --- | --- |
| Megaphone | Professional publishers/broadcasters; Japanese examples include major radio/media publishers | Strong technical candidate; qualify current real enclosure redirect/range behavior before shipping |
| RedCircle | Smaller/independent creators; Japanese-learning and indie inventory exists | Strong candidate. A RedCircle representative stated in 2024 that CORS should work on audio*.redcircle.com URLs. Still qualify current real episodes |
| Spotify for Creators / legacy Anchor | Large creator inventory, including many Japanese shows | Important catalog source; current enclosure CORS/range behavior must be measured rather than assumed |
| SoundCloud podcast RSS | Some well-liked native shows such as Donguri FM distribute there | Technically interesting; provider/API/terms boundary needs explicit review before product reliance |
| Podbean | Japanese creator inventory | Measure actual enclosure behavior |
| Omny/Triton | Professional/broadcaster inventory | Measure the actual enclosure redirect chain |
| Simplecast/Acast/Libsyn/etc. | Broad podcast ecosystem | Add only after automated qualification |
| self-hosted RSS/media | Important for smaller native shows | Per-origin/per-episode qualification, no blanket assumption |

Examples discussed during exploration include COTEN RADIO, Donguri FM, YUYUの日本語Podcast, Japanese with Shun, Nihongo con Teppei, 4989 American Life, TBS/Megaphone programs, and independent/self-hosted shows. These are discovery candidates, not a promise that every current enclosure is MOSS-compatible.

Useful external starting points:

- Reddit Japanese-learning podcast discussions: https://www.reddit.com/r/LearnJapanese/
- RedCircle CORS discussion with host representative: https://www.reddit.com/r/podcasting/comments/1frmvpy/
- RedCircle show example: https://redcircle.com/shows/japanese-with-shun
- Donguri FM distribution note: https://donguri.fm/n/nfe10f5b247fc
- Podcast Standards Project CORS discussion: https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification/discussions/7
- Podcast Standards Project RSS specification: https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification
- Podcasting 2.0 transcript tag: https://podcasting2.org/docs/podcast-namespace/tags/transcript
- Podcasting 2.0 transcript format details: https://podcasting2.org/docs/podcast-namespace/examples/transcripts/transcripts
- MDN Range/CORS behavior: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range
- MDN exposed CORS response headers: https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header
- Podcast Standards certification list: https://github.com/Podcast-Standards-Project/Certification

The next worker should refresh this matrix with actual browser probes. Search results, old curl captures, and provider statements are research leads, not release evidence.

## 4. Browser/CORS constraint

The no-proxy requirement is viable only for qualifying episodes.

A browser may often play a cross-origin URL in audio/video without exposing its bytes to JavaScript. That is insufficient here.

MOSS requires readable bytes through the decode pipeline. Therefore the relevant question is:

> Can the browser issue the exact enclosure request/ranges from the Manabi origin and read the response body?

CORS is a technical capability, not a copyright license.

### 4.1 No workaround policy

Do not attempt to bypass failed CORS with:

- fetch mode no-cors
- hidden iframe
- service worker relaying an opaque response
- canvas/audio capture tricks
- undocumented Spotify/Apple media endpoints
- public random CORS proxies

If a source is not browser-readable, the no-proxy v1 has two honest states:

- playback-only
- unsupported for the MOSS catalog

If MOSS is the defining feature, it is reasonable for the curated first catalog to surface only MOSS-capable episodes.

### 4.2 Probe the RSS enclosure URL itself

Podcast enclosures frequently redirect through tracking/analytics/ad systems.

Do not infer capability from the final CDN hostname alone.

Probe the exact enclosure URL supplied by the publisher. A redirect hop can fail CORS before the browser reaches a CORS-friendly final media CDN.

### 4.3 Proposed ASR capability probe

For an episode enclosure:

1. Require HTTPS in production.
2. Use `credentials: 'omit'`.
3. Use the exact publisher enclosure URL and `redirect: 'follow'`.
4. Attempt GET with **one** bounded byte Range such as `bytes=0-0`.
5. A single `Range` request is CORS-safelisted and should not itself require a preflight; the server still must opt into CORS for the response body.
6. A CORS failure is a hard ASR failure.
7. Require HTTP 206 for the v1 random-access MOSS path.
8. Consume/cancel the tiny body and require exactly the requested bytes.
9. Establish a safe total byte size.
10. Verify at least one nonzero range.
11. Repeat a small set of fixed ranges within the same qualification session and compare byte digests. If identical requests produce different bytes without an explicit rendition/version transition, mark the source unstable for MOSS.
12. Run the same source through Mediabunny metadata/audio-track discovery and bounded decode before allowing Generate.
13. Record request count/redirect count as part of qualification; excessive range fan-out is a publisher-analytics and performance concern, not merely an implementation detail.

Do not use HEAD as the sole authority. Some media origins implement GET/Range and HEAD differently.

Do not require a custom request header for qualification. Keeping the request in the simple-CORS path materially increases compatibility.

### 4.4 Establishing source size

ByteSource requires a known safe size.

Preferred evidence order:

1. Valid exposed Content-Range total from a successful range request.
2. Trusted-enough-for-admission RSS enclosure length confirmed by successful bounded range behavior.
3. A CORS-readable GET/HEAD Content-Length path whose body is immediately canceled and whose semantics are qualified.

RSS metadata is untrusted input. Validate integer bounds.

If exact source size cannot be established without downloading the whole body first, do not admit that episode into the random-access MOSS path.

### 4.5 Response headers are not automatically readable

Remember that a cross-origin fetch can succeed while JavaScript is still unable to inspect arbitrary response headers unless the origin exposes them.

The browser exposes `Content-Length` and `Last-Modified` by default on a successful CORS response. It does **not** expose `Content-Range` or `ETag` by default; those need `Access-Control-Expose-Headers` (or an applicable wildcard on a credentialless request).

This matters because a 206 response's exposed `Content-Length` is only the partial body length. The total resource size cannot be inferred from it.

Therefore:

- use RSS `<enclosure length>` as a strong candidate size input, because both RSS 2.0 and current podcast RSS guidance define it as file size in bytes
- verify that the claimed size is consistent with successful bounded ranges and decode
- prefer exposed `Content-Range` when available
- treat exposed strong ETag as useful session evidence, not as ContentKey
- do not make ETag or Content-Range universally mandatory when qualified hosts do not expose them

If a safe exact size cannot be established, the source is not eligible for the current random-access ByteSource contract.

## 5. Proposed RemotePodcastSource

Add a remote HTTP implementation behind the existing ByteSource abstraction rather than teaching MOSS about URLs.

Conceptual shape:

~~~ts
interface PodcastEpisodeLocator {
  version: 1

  feedUrl: string
  guid: string
  enclosureUrl: string
  enclosureType?: string
  enclosureLength?: number

  showTitle: string
  episodeTitle: string
  publishedAt?: string
  artworkUrl?: string
  webpageUrl?: string
}

interface QualifiedRemoteSource {
  source: ByteSource

  originalUrl: string
  finalUrl: string

  capability: {
    corsReadable: true
    randomAccess: true
    size: number
  }

  validator?: {
    strongEtag?: string
    lastModified?: string
  }
}
~~~

The exact types should be revised against the implementation. The important separation is:

- PodcastEpisodeLocator = publisher/catalog identity and presentation metadata
- ByteSource = currently readable bytes
- ContentKey = SHA-256 identity of one exact complete byte rendition

### 5.1 ByteSource needs a generic network/read profile first

The current `identify()` implementation does not treat all non-File sources equally. It uses 4 MiB reads only when `source.cloud` is present; otherwise it hashes in 1 MiB chunks.

A podcast source implemented as a plain non-File/non-cloud `ByteSource` would therefore turn a 100 MiB full verification into roughly 100 network range requests before accounting for Mediabunny/MOSS reads. That is undesirable for latency, host analytics, dynamic ads, and request limits.

Do not fake `source.cloud` to get the larger chunk size.

Before remote podcasts use full verification, generalize the source contract with an explicit capability/profile such as:

~~~ts
type ByteSourceProfile = 'local' | 'network'

interface ByteSource {
  // existing fields...
  profile?: ByteSourceProfile
  preferredReadBytes?: number
}
~~~

or an equivalent owned abstraction. `identify()`, prefetch, sampling and future remote sources should consume the generic capability rather than provider-specific fields.

Keep `LIMITS.rangeBytes` as the hard upper bound.

### 5.2 read(start, end, signal)

Remote reads should:

- run through the existing assertRange budget
- fetch the original admitted enclosure URL or a frozen validated redirect result only if safe
- send one Range
- use credentials: omit
- use cache behavior intentionally
- validate status/body length
- never accept a full 200 response for a 4 MiB random range and silently buffer the whole episode
- cancel discarded bodies
- fence all results by source lifetime/generation
- detect observable source-version changes

### 5.3 playback()

Playback should use the original publisher enclosure URL unless there is a strong reason not to.

Do not create a Manabi media copy.

For web, an audio element is the natural playback primitive. The MOSS ByteSource and playback element may use separate requests, so remote-rendition stability must be considered; see the identity section below.

Readable playback-element bytes are not required because ASR uses the separate ByteSource path. If the web transport uses `<audio>` or Expo Audio, do not set `crossOrigin="anonymous"` / `crossOrigin: 'anonymous'` merely for MOSS. Forcing CORS on the playback element can make otherwise playable publisher audio fail. Set it only if the playback implementation itself needs CORS-readable media.

### 5.4 Do not leak Manabi authority

Third-party media requests should not send:

- Manabi auth cookies
- account headers
- cloud-provider credentials
- source tokens belonging to another integration

Use credentials: omit.

Review referrer behavior; prefer minimizing unnecessary Manabi URL disclosure if compatible with the target host.

## 6. Remote identity and dynamic-ad problem

This is the most important design section for the next worker.

### 6.1 Why RSS GUID is insufficient

A GUID identifies an episode in a feed. It does not prove that two HTTP responses contain identical bytes.

An enclosure can change because of:

- publisher replacement
- corrected audio
- CDN migration
- tracking redirects
- server-side ad insertion
- personalized/dynamic ads
- geo/time variation
- host migration while GUID remains stable

A transcript timed against rendition A must not be silently attached to materially different rendition B.

### 6.2 Admission rule: MOSS requires one sufficiently stable rendition

The first draft underweighted dynamic ad insertion.

Before creating a remote provisional MOSS job, establish a `RenditionSession` (name provisional) containing the exact admitted enclosure URL, size evidence, final observed URL for diagnostics, exposed validators when available, and fixed-range byte fingerprints.

The session is valid only while subsequent reads remain consistent with that evidence.

Do **not** automatically switch playback or ASR to the final CDN URL merely because `Response.url` reveals it. Doing so can bypass publisher tracking/ad delivery or rely on an expiring implementation URL. The original enclosure remains publisher authority unless a provider-specific integration explicitly permits another URL.

If repeated reads of the original enclosure are not stable enough to bind transcript timing, v1 should classify that episode as playback-only.

### 6.3 Conservative MVP: preserve full-byte ContentKey

For the first implementation, preserve the existing ContentKey invariant rather than changing the sync protocol. Treat this as the conservative compatibility path, not a claim that full hashing is the final podcast identity design.

Recommended flow:

~~~text
Open episode
  -> qualified remote source
  -> playback immediately
  -> no full hash yet

User presses Generate transcript
  -> capture qualified source session
  -> create provisional v3 job
  -> start sparse MOSS around current playhead
  -> in parallel, lazily hash the complete remote rendition
  -> store audio proofs for MOSS windows
  -> once full SHA-256 finishes and rendition is still current:
       promote provisional job to real ContentKey
       permit complete track publication
~~~

This intentionally incurs a complete byte read only for episodes the user asks to transcribe. It does not make browsing or playback download the entire episode.

This is not bandwidth-free, but it is simple, honest, proxyless, and consistent with the existing portable transcript identity model.

### 6.4 Remote provisional identity needs a deliberate extension

Today provisional generation is intentionally limited to local File sources.

The next worker should generalize that mechanism only after establishing a stable remote-source session contract.

Do not simply remove the File check.

A remote provisional source needs at least:

- stable admitted URL/locator snapshot
- known size
- bounded random reads
- sticky lifetime/revocation
- protection against response-version changes
- audio proofs for every saved sparse inference window
- a rule preventing publication until exact full-byte identity is known

### 6.5 Strong validator fast path

If a qualified source provides a strong, readable, stable ETag and consistent size across ranges, retain it as a session validator.

It can detect obvious replacement during a hash/transcription session.

Do not treat ETag itself as ContentKey.

If conditional request headers would require a CORS preflight that the host does not support, do not make the system depend on them. Comparing exposed validators is useful but not a universal enforcement mechanism.

### 6.6 Dynamic ad insertion

Dynamic ads can make separate requests to the same enclosure URL return different bytes.

This creates two risks:

1. Full hash stream and MOSS range reads could observe different renditions.
2. A later playback could differ from the transcript's timing.

Minimum safe behavior:

- during one Generate session, capture every observable validator/final URL/size signal and fixed-range fingerprints
- fail/pause publication if a later read contradicts that session
- preserve existing audio proofs
- on reopen, before trusting a transcript for a remote episode whose rendition stability is uncertain, decode one or more bounded proof windows and compare their PCM digest
- if proof differs, mark transcript/source stale rather than showing mismatched timed text as authoritative
- never attempt to remove, skip, normalize away, or otherwise defeat dynamically inserted advertising
- measure whether ASR/hash range requests materially multiply publisher download/ad requests; if they do, reduce/coalesce reads or exclude the provider until an acceptable integration exists

The exact proof policy needs benchmarking. Do not re-decode every saved window merely to open an episode.

A sensible first check is one early non-ad-prone speech window plus one later window, but do not pretend ad placement is predictable. The next worker should design this from actual qualified providers.

### 6.7 Alternative future identity

A future version may introduce an explicit ExternalMediaKey / EpisodeKey distinct from ContentKey and sync transcript evidence under a richer rendition identity.

That is a larger protocol/schema decision and should not be smuggled into the first Podcasts PR.

## 7. Catalog and RSS strategy

### 7.1 Do not require a podcast backend for v1

A useful first catalog can remain frontend/static.

Recommended starting architecture:

~~~text
checked-in/generated curated catalog manifest
          |
          +-- show metadata
          +-- feed URL
          +-- native/learner category
          +-- editorial tags
          +-- source-family hint
          |
          v
client fetches feed only when CORS-qualified
or consumes generated recent-episode metadata from the manifest
          |
          v
exact enclosure qualification in browser
~~~

This avoids introducing an audio proxy or account backend merely to discover episodes.

### 7.2 Catalog freshness options

For this project, prefer a **static generated catalog** over runtime arbitrary-feed fetching unless a concrete reason favors client RSS.

Use a separate catalog-refresh command/job to fetch a reviewed list of public feeds, validate them, and produce bounded inert JSON. Check in or otherwise pin that generated manifest before an application build. The normal production build should consume the validated manifest without depending on live podcast hosts or network availability.

That avoids runtime feed-CORS dependence while preserving the core no-backend/no-audio-proxy architecture: users still fetch audio directly from publishers.

The next worker should choose and document one:

A. Checked-in manifest, manually refreshed.
- Simplest.
- Best for a small editorial Japanese catalog.
- Stale unless maintained.

B. Build/CI-generated manifest from public RSS.
- Still no runtime audio proxy.
- Keeps static deployment.
- Must avoid unreviewed network-derived metadata becoming trusted HTML/code.
- CI fetch licensing/terms still need review.

C. Client-side feed fetch.
- Most decentralized.
- Only works when the feed itself allows CORS.
- Arbitrary user-entered RSS cannot be guaranteed.

A + B is the stronger default for the curated Japanese MVP: keep a reviewed source list in-repo and generate bounded episode metadata during a controlled build/update step. Optional direct client refresh can be added only for feeds whose CORS behavior is qualified.

Do not make production app startup **or production build determinism** depend on GitHub Actions or a live feed update succeeding. Ship the last validated manifest.

The generated catalog may retain publisher metadata and URLs needed for discovery. It should not copy/bundle episode audio or full publisher transcript bodies into Manabi merely to avoid runtime CORS.

### 7.3 RSS parsing

Treat every feed field as hostile external input.

Requirements:

- parse XML without executing markup
- never inject description HTML with innerHTML
- cap feed bytes, item count, text lengths, image URL lengths
- reject external entities / XXE-style behavior
- normalize dates defensively
- support common RSS/iTunes podcast fields but ignore unknown fields
- require one supported enclosure per surfaced episode
- canonicalize only enough for dedupe; do not mutate publisher URLs into a different authority
- use publisher-provided webpage URL for attribution when safe

### 7.4 Prefer publisher transcripts before MOSS

Current podcast RSS guidance recommends `<podcast:transcript>`, and the Podcasting 2.0 namespace supports multiple linked transcript formats.

When an episode supplies transcript links:

1. prefer a timed publisher transcript over MOSS when it is CORS-readable and validates safely
2. prefer WebVTT / SRT / timed Podcast JSON for line-synced study
3. treat plain text / HTML as low-fidelity searchable/readable transcript content unless reliable timing exists
4. preserve publisher language metadata and speaker names when the format provides them
5. do not confuse publisher speaker names with MOSS window-local diarization IDs
6. keep MOSS available as an explicit fallback when no usable authored timed transcript exists

This requires a new semantic distinction. Do not label a publisher RSS transcript as `origin: 'generated'`, and do not casually call it an embedded video track. Decide whether the existing `sidecar` meaning is sufficient or whether Track origin should grow a reviewed `publisher`/remote-authored value.

Linked transcript files have their own CORS and hostile-input requirements. Their availability is independent of enclosure CORS.

### 7.5 Arbitrary Add RSS feed

Defer from the first release unless it is trivial after the curated path.

If added:

- it must be explicit that some feeds cannot be read from a browser
- no proxy fallback
- feed CORS and enclosure CORS are separate capabilities
- subscription storage should keep the user's original URL plus safe normalized metadata

## 8. Legal/product boundary

This document is not a legal opinion.

Important distinction:

- CORS answers whether browser JavaScript can technically read a response.
- Public RSS answers how publishers distribute podcast metadata/audio to podcast clients.
- Neither automatically grants every possible downstream copyright use.

The initial product should stay close to ordinary podcast-client behavior:

- use public publisher RSS
- play the publisher's original enclosure URL
- do not rehost the MP3
- do not redistribute an episode copy
- keep show/episode attribution and source link
- make MOSS transcription user-initiated
- perform ASR on the user's device
- do not upload audio for recognition
- do not create a public transcript corpus
- do not centrally publish generated full transcripts by default

Before production, review current terms for every catalog/discovery API or provider-specific integration used.

In particular, do not assume that because a SoundCloud CDN response is technically readable, the SoundCloud developer API is automatically suitable for a commercial podcast feature. RSS consumption and proprietary API usage are separate questions.

Generated transcript sync to the user's own account also deserves explicit product/legal review. If uncertain, ship local-only generated podcast transcripts first and add sync only after the identity/legal model is settled.

## 9. Data/storage strategy

### 9.1 Do not blindly rename video_* kinds

The current synced media protocol is explicitly:

- video_info
- video_resume
- video_track
- video_chunk

and Replica/Remote/Mutation validation is strict.

Changing these names to generic media_* is not a cosmetic refactor. It changes:

- validation
- IndexedDB records
- sync requests
- backend compatibility
- search invalidation
- conflict behavior
- migrations
- existing users' saved video transcripts

Do not combine that protocol migration with the first Podcasts feature unless it is independently designed and reviewed.

### 9.2 Reuse domain types where their meaning is generic

Cue and Track are already mostly media-generic.

Playback is also generic except for naming around the storage kind.

VideoInfo is not generic because width/height are baked in.

Recommended direction:

- extract/grow generic transcript and playback domain only where behavior is genuinely common
- add podcast-specific catalog/episode metadata
- leave existing video sync kinds untouched initially
- decide separately whether podcast resume/transcripts are local-only in MVP or need new backend kinds

### 9.3 Suggested podcast metadata

Conceptual only:

~~~ts
interface PodcastShow {
  id: string
  feedUrl: string
  title: string
  description?: string
  artworkUrl?: string
  webpageUrl?: string
  language: string
  immersion: 'native' | 'learner-friendly'
  tags: string[]
}

interface PodcastEpisode {
  showId: string
  logicalId: string
  guid: string
  title: string
  description?: string
  publishedAt?: number
  duration?: number
  enclosureUrl: string
  enclosureType?: string
  enclosureLength?: number
  artworkUrl?: string
  webpageUrl?: string
}
~~~

Do not use show/episode logical IDs as ContentKey.

## 10. Player architecture

### 10.1 Do not copy VideoPlayer wholesale

VideoPlayer owns both generic transcript behavior and video-only presentation.

Reusable behavior includes:

- primary/secondary tracks
- line following
- pause after line
- previous/replay/next
- A/S/D and Space ownership rules
- transcript scrolling/windowing
- delays
- generated draft/provisional display
- Generate state
- Reader typography/background integration
- transcript export
- playback progress/checkpoints

Video-only behavior includes:

- video element
- caption overlay over moving picture
- theater mode
- video overlay style controls
- visual video column/layout
- fullscreen/native-video assumptions

Podcasts need an audio transport and podcast artwork/metadata, not an empty video rectangle.

### 10.2 Recommended extraction

The existing dependency set makes a playback port especially useful. A shared Podcasts controller should not know whether playback is backed by Expo Audio, a DOM audio element, or a future native leaf.

A candidate transport contract should expose only product semantics (position, duration, playing/paused, rate, seek/play/pause, status subscription, disposal) and should not expose native player objects.

On Android, qualify the already-installed `expo-audio` before inventing a player. It can provide remote playback and platform media-session/background behavior. On web, either Expo Audio or a bounded DOM `<audio>` leaf may own playback.

Background playback and background transcription are separate capabilities. Expo Audio may continue playback while the app is backgrounded; the existing DOM/WebView MOSS worker must **not** be assumed to continue inference under Android/web suspension.

Before or while implementing Podcasts, isolate a shared transcript/study controller from VideoPlayer.

Possible conceptual split:

~~~text
MediaTranscriptSession
  - tracks
  - generated draft state
  - active cue/spans
  - follow
  - line pause
  - primary/secondary selection
  - delays
  - transcript rendering model
  - save/reconcile semantics

MediaTransport
  - currentTime
  - duration
  - playbackRate
  - paused
  - play()
  - pause()
  - seek()
  - time/rate/ended events

VideoPlayerView
  - video element
  - overlay
  - theater
  - video caption style

PodcastPlayerView
  - audio element
  - artwork/show/episode metadata
  - audio transport controls

SharedTranscriptView
  - transcript pane
  - study controls
  - generation state
~~~

Do not require this exact class structure. Preserve behavioral tests first and extract at a seam that keeps Video stable.

### 10.3 Audio UI

Initial episode screen should include:

- show name
- episode title
- artwork when safely available
- publication date
- duration
- source/publisher link
- native browser audio controls or an accessible minimal custom transport
- playback rate
- transcript pane
- Generate transcript
- model download notice on first generation
- previous/replay/next utterance
- follow playback
- pause after each line
- transcript/translation track selectors where applicable
- transcript appearance using Reader settings

Do not add podcast-specific visual gimmicks before the core path is qualified.

### 10.4 No video overlay controls

Remove/omit for podcast:

- theater mode
- video text color
- video caption background opacity
- video text edge
- overlay caption positioning

Transcript typography remains shared with Reader.

## 11. MOSS behavior for podcasts

### 11.1 Generation remains explicit

Opening/browsing/playing a podcast must not:

- download the MOSS model
- start inference
- full-hash the episode
- generate a transcript

Generate transcript is the explicit expensive action.

### 11.2 Default language and audio-track admission

For a Japanese-curated catalog, metadata can suggest ja.

For ordinary podcast enclosures with exactly one decodable, non-commentary audio track, auto-select it. Do not carry over the video's mandatory manual audio-track chooser when there is no ambiguity.

If multiple plausible audio tracks exist, retain the existing explicit-choice principle rather than guessing.

Still preserve the current principle that metadata is not magical speech detection. A bad feed language tag must not silently force an incompatible behavior. MediaPipeline must still verify the chosen track rather than assuming track ID 0.

### 11.3 Sparse-first behavior

Use the current v3 sparse/playhead-priority policy as the default.

On Generate:

- prioritize current playback position
- keep nearby accepted transcript available first
- reprioritize as user seeks/plays
- checkpoint after bounded windows
- preserve accepted windows on cancel/close
- do not restart from zero just because the user jumps forward

This is substantially more useful for long episodes than an all-or-nothing transcript.

### 11.4 Model disclosure

The existing UI states that first Generate downloads a verified 648 MB model.

Podcasts should use the same model/cache and not present it as a second download.

If model size/revision changes later, display values should come from the shared MOSS model contract rather than duplicated copy.

### 11.5 Transcript publication

Only complete verified tracks currently publish to the synced media record layer.

Keep that invariant unless deliberately redesigned.

For provisional remote jobs:

- in-progress cues may render locally
- completed portable Track publication waits for exact ContentKey
- a failed full hash must not silently turn provisional cues into a portable transcript
- user-visible state should explain that recognized windows were kept locally when applicable

## 12. Search integration

The existing unified Library search is a good model:

- media code is lazy-loaded
- video titles and complete published transcript cues participate only in Everything
- searching never resolves/open media
- searching never downloads media
- searching never starts MOSS
- transcript hits deep-link to paused media time

Podcasts should preserve those boundaries.

Potential deep link:

~~~text
/podcasts?episode=<logical-episode-id>&time=<seconds>&track=<track-id>
~~~

Do not use a mutable enclosure URL as the route identity.

The search data source should know whether a result is video or podcast and route accordingly.

If podcast transcripts are local-only in MVP, search them locally. Do not force backend sync just to appear in search.

## 13. Expo/shared-UI integration

### 13.1 Respect the migration direction

The branch target is one nonreader composition across Android/web, with bounded platform leaves.

Do not implement:

- podcasts/+page.svelte as the new authoritative product
- an unrelated React-web-only Podcasts app plus a totally separate native screen state machine

A reasonable migration-aware route shape is:

~~~text
apps/web/src/app/podcasts.tsx
apps/web/src/screens/routes/podcasts.tsx
apps/web/src/screens/routes/podcasts.web.tsx   # only while capability leaf is necessary
features/podcasts/...                           # shared product state/controller
~~~

Exact placement should follow the branch's current convergence work when implementation starts.

### 13.2 Browser DOM media leaf is justified

MOSS Worker, Web Locks, Mediabunny/Web Audio, IndexedDB, and existing media transcript code already live in the browser/DOM graph.

It is acceptable for the low-level media runtime to remain a bounded DOM leaf on Android while the shared screen composition/controller owns product state.

That is different from keeping an entire second web page.

### 13.3 Do not solve native podcast playback ahead of native video architecture

Current native Videos is still a placeholder.

The Podcasts worker should first establish reusable media-domain/player ports that improve the path to both Video and Podcast convergence.

Do not introduce a one-off Android native podcast player whose lifecycle/persistence rules diverge from Videos unless the project explicitly chooses that architecture.

## 14. Proposed implementation phases

### Phase 0 — provider qualification harness

No product UI yet.

Build a small qualification harness for real enclosure URLs:

- exact publisher RSS enclosure URL
- actual target environment/origin: production web origin and packaged Android DOM/WebView origin
- browser CORS GET
- redirect behavior
- Range 0-0
- second random range
- total size evidence
- Mediabunny metadata
- audio track decode
- 16 kHz PCM production
- cancellation
- validator stability
- repeated-request stability

Produce a machine-readable report.

Do not make ordinary PR CI depend on external podcast hosts.

A manual or scheduled qualification workflow can test live providers. Normal CI should use local fixtures that emulate their important response patterns.

### Phase 1 — remote ByteSource

Implement RemotePodcastSource / RemoteHttpByteSource behind the existing ByteSource boundary.

Acceptance:

- no full episode download to open/play
- no proxy
- no credentials
- bounded ranges
- abortable
- changed response/session rejected
- works with Mediabunny audio-only sources

### Phase 2 — episode/catalog domain

Add safe parser/catalog types and curated Japanese manifest.

Start with a small high-quality set across more than one host.

Do not claim host-wide qualification from one episode. Surface per-episode capability when necessary.

### Phase 3 — Podcasts category + playback

Add Books / Videos / Podcasts section navigation.

Implement:

- show/episode browse
- recent episodes
- text search over catalog metadata
- episode open
- audio playback
- resume checkpoint
- no MOSS yet in the first vertical slice if needed

This phase should already prove lifecycle/reopen/route behavior.

### Phase 4 — MOSS transcription

Connect the remote source to the existing queue.

Implement:

- explicit Generate
- provisional remote job
- lazy full hash only after Generate
- playhead priority
- audio proof
- verified promotion to ContentKey
- published Track
- cancel/resume/switch behavior
- shared MOSS model cache

### Phase 5 — transcript/study convergence

Extract only the generic pieces needed from VideoPlayer.

Preserve Video behavior with regression tests while adding Podcast:

- line following
- A/S/D
- pause after line
- primary/secondary tracks
- transcript appearance
- export

### Phase 6 — unified search

Add podcast titles and complete transcript cues without network side effects.

Deep-link to exact episode/time.

### Phase 7 — sync and cross-device policy

Only after remote identity semantics and legal/product review.

Choices:

- local-only podcast resume/transcripts
- sync resume only
- sync transcript under new podcast-specific records
- larger generic media protocol migration

Do not let Phase 7 block a useful local-first experiment.

## 15. Testing plan

### 15.1 Remote source unit tests

Local fixture server cases:

- 206 correct one-byte range
- correct nonzero bounded range
- server ignores Range and returns 200
- range body too short
- range body too long
- missing/invalid source size
- changed total size
- redirect success
- redirect CORS failure modeled at browser harness level
- final URL changes
- same URL + same size + different fixed-range bytes
- same fixed ranges stable across repeated requests
- ETag changes when exposed
- Last-Modified changes
- cancellation before headers
- cancellation during body
- stale source lifetime
- response body cleanup
- generic network source uses coalesced/bounded remote read sizing rather than 1 MiB full-hash request fan-out
- request count is bounded/measured for full verification
- credentials are omitted
- non-HTTPS rejected in production policy
- URL credentials rejected

### 15.2 Mediabunny/audio tests

Use generated or redistributable tiny fixtures for:

- MP3
- AAC/M4A where supported by target browser/runtime
- mono
- stereo
- odd sample rates
- long-duration metadata without long fixture bytes when possible
- audio-only source with no video track
- bounded seek/decode
- decode cancellation
- 16 kHz mono output

Do not add a large copyrighted podcast episode to the repository.

### 15.3 MOSS queue tests

Reuse existing doubles plus new audio-only integration:

- opening episode does not prepare MOSS
- Generate prepares MOSS after valid PCM exists
- current playhead is first sparse priority
- seeking reprioritizes
- cancel preserves accepted windows
- route switch pauses owned job
- source validator change pauses/fails safely
- provisional transcript cannot publish before verified ContentKey
- audio proof mismatch prevents reuse
- full hash failure does not destroy accepted device-local work
- model remains one shared cache/runtime
- another tab cannot run a competing MOSS batch

### 15.4 UI/browser tests

Cover:

- Books / Videos / Podcasts navigation
- browser back/forward
- responsive episode list
- accessible show/episode names
- audio controls
- keyboard ownership
- screen-reader names
- transcript open/close
- follow
- line navigation
- pause-after-line
- model-download disclosure
- Generate progress
- cancel/resume
- Reader typography/background
- no video-only overlay controls
- deep-link to episode/time
- route replacement while reads/inference are pending

### 15.5 Search tests

Assert:

- title search is local
- transcript search uses only saved/published cues
- search never requests enclosure bytes
- search never downloads model
- opening hit validates episode/track/time
- stale/missing episode does not break the whole search route

### 15.6 External provider qualification

Maintain a small live smoke list across candidate hosts. A passing hostname is not sufficient; qualify the publisher enclosure shape actually used by the catalog.

For each provider, record:

- date checked
- feed URL
- exact enclosure URL
- browser/origin used
- redirect final URL
- Range result
- body readability
- size source
- Mediabunny parse/decode result
- response/version stability across repeated checks
- fixed-range digest stability
- number of HTTP requests/redirects required for probe, metadata, bounded decode and verification
- whether repeated ranges appear to trigger materially different ad/personalized renditions
- official `podcast:transcript` availability/CORS and whether it is timed enough for study
- whether playback requires no CORS while ASR succeeds through the separate fetch path
- any relevant provider terms reviewed

Do not turn one passing show into an eternal hostname allowlist.

## 16. Security/privacy checklist

- No podcast audio upload for ASR.
- No proxy/rehost in v1.
- credentials: omit for third-party audio/feed requests.
- HTTPS-only production remote media.
- Reject credential-bearing URLs.
- Bound all RSS/media metadata lengths.
- No feed description innerHTML.
- No external entity resolution.
- Keep source/account lifetime fences.
- Abort range/decode/inference work on route/source replacement.
- Never let an old episode publish into a successor's transcript.
- Preserve existing MOSS cross-tab lock.
- Do not let podcast artwork execute SVG/script or become trusted HTML.
- Consider image proxy/privacy separately; it is not needed for audio ASR.
- Do not log full signed enclosure URLs if providers ever use them.
- Do not persist third-party response credentials/tokens.
- Treat final redirect URL as sensitive metadata if it contains tracking identifiers.

## 17. Offline behavior

Initial expectation:

- catalog metadata previously stored may remain visible
- saved transcript remains readable/searchable
- saved playback position remains local
- remote episode audio is unavailable offline unless already cached by normal browser behavior
- Manabi does not promise an offline MP3 download

An explicit "download episode" feature is out of scope and has different storage/licensing implications.

Do not allow service-worker shell caching to accidentally cache huge podcast media responses.

## 18. Performance, bandwidth and publisher-request expectations

Opening an episode should consume only metadata and ordinary playback demand.

Range count matters in addition to byte count. Podcast hosts and ad systems may observe each request, so dozens of tiny reads are not an acceptable implementation merely because the aggregate bytes are small. Reuse/coalesce Mediabunny reads, honor the existing 4 MiB hard range budget, and measure the real request graph per provider.

Generate transcript may cause:

1. sparse decode/range requests near current position
2. MOSS model download on first use if absent
3. lazy full-episode hashing for exact ContentKey in the conservative compatibility MVP

The UI should not misrepresent #3. It may be useful to show a separate "verifying episode" byte progress state from MOSS inference progress.

Avoid running full hash at high concurrency with aggressive MediaBunny prefetch. One source session should budget requests so transcription near the playhead remains responsive.

A later identity protocol could remove the full hash requirement, but only after replacing it with an equally explicit rendition identity model.

## 19. Acceptance criteria for the first production-capable slice

A first shippable Podcasts experiment should satisfy all of the following:

- Feature is separately gated.
- Books / Videos / Podcasts category navigation is coherent.
- Catalog is Japanese-first and curated.
- Every episode offered for MOSS passed actual browser byte-read/range/decode **and rendition-stability** qualification.
- Publisher-provided timed transcripts are preferred when safely usable; MOSS is not run merely because it exists.
- Audio comes from the publisher's original enclosure; no Manabi audio proxy/rehost.
- Opening an episode does not download MOSS.
- Opening an episode does not full-hash the complete enclosure.
- Playback begins independently of transcript generation.
- Generate is explicit.
- MOSS uses the existing verified model/runtime/cache.
- MOSS receives bounded 16 kHz mono PCM through MediaPipeline.
- Remote verification does not explode into 1 MiB network-range request fan-out.
- Repeated remote reads cannot silently mix different ad/personalized renditions into one transcript.
- Sparse inference prioritizes the current playhead.
- In-progress work survives supported pause/reload flows without pretending to be a verified portable Track.
- Portable transcript publication is bound to exact ContentKey, or a separately reviewed replacement identity protocol.
- Changed remote bytes cannot silently reuse a timed transcript.
- Search never downloads podcast media or starts MOSS.
- Feed text cannot inject HTML/script.
- No existing Video behavior is regressed.
- No existing video_* sync record is silently reinterpreted as podcast data.
- Android/web product state moves toward shared composition rather than adding another permanent divergent page.
- External provider qualification is reproducible and dated.
- Documentation is clear about legal/terms review versus technical CORS capability.

## 20. Non-goals for the first implementation

- every podcast on the internet
- arbitrary Apple Podcasts replacement
- Spotify proprietary stream extraction
- bypassing CORS
- public CORS proxy dependency
- Manabi audio CDN
- server-side transcription
- server-side audio ingestion
- automatic transcription of every subscribed episode
- background inference after browser/app suspension without a real platform design
- offline podcast download
- public generated-transcript corpus
- transcript SEO pages
- automatic translation
- speaker identity across an entire show
- ad removal
- chapter editing
- OPML migration
- rating/review ecosystem
- recommendation ML
- iOS/macOS work in this Expo branch

## 21. Open decisions for the next worker

The next worker should revise this spec and answer these before substantial implementation:

### Identity
1. Is lazy full-byte hashing acceptable for Generate in the first release after measuring its request count and bandwidth?
2. Should the first implementation simply exclude dynamically personalized/unstable enclosures from MOSS?
3. Which remote validator signals are actually exposed by qualified hosts?
4. How should fixed-range fingerprints and decoded audio proofs divide responsibility?
5. How should dynamic-ad renditions be detected on reopen?
6. Which audio-proof subset is sufficient to reject stale transcript reuse cheaply?

### Storage/sync
7. Are podcast transcripts local-only initially?
8. Is playback resume local-only or synced?
9. Do we add podcast-specific remote record kinds later, or plan a separate generic media-protocol migration?
10. How are logical episode IDs mapped to one or more byte renditions?
11. Does publisher-authored transcript storage require a new Track origin value?

### Catalog
12. Checked-in source list + generated static manifest, direct client RSS, or another hybrid?
13. What is the minimum initial native-Japanese catalog?
14. What does "native" mean for catalog tagging?
15. How are dead/moved feeds handled?
16. Which shows expose usable `podcast:transcript` resources so MOSS can be avoided?

### UX
17. Hide playback-only episodes or show them without Generate?
18. Should Generate mean "around current playback first" explicitly in copy?
19. Do we expose full-episode verification progress separately from recognition progress?
20. What should happen if the user seeks into an untranscribed region while MOSS is far behind?
21. Should a valid publisher transcript suppress the Generate action by default while still offering MOSS as an advanced fallback?

### Expo
22. Should Podcasts wait for Video transcript/player domain extraction, or perform that extraction as its first enabling refactor?
23. Should the shared playback port use Expo Audio on both platforms or Expo Audio on Android plus a DOM audio leaf on web?
24. What is the bounded Android DOM/media/ASR leaf?
25. Which exact shared screen/controller owns episode state?
26. What lifecycle contract reconciles native background playback with foreground-only/suspendable DOM MOSS work?

### Provider/legal
27. Which catalog/provider terms need explicit approval?
28. Can generated transcripts sync privately, or should v1 keep them on-device?
29. Which SoundCloud usage path, if any, is acceptable without relying on a restricted proprietary API?
30. Do repeated range/hash requests distort host analytics, downloads, or dynamic-ad accounting enough to require provider-specific limits or exclusion?

## 22. Suggested first engineering PR sequence

Keep each implementation PR reviewable.

1. Remote media qualification harness + docs only.
2. Generic ByteSource network/read-profile refactor + request-count tests.
3. Remote ByteSource + local fixture tests.
4. Podcast catalog/parser + `podcast:transcript` domain/security tests.
5. Shared transcript/player seam extraction with zero intended Video behavior changes.
6. Podcasts route/category + playback only, through a shared playback port.
7. Publisher timed-transcript import/display.
8. MOSS remote provisional generation + rendition session + lazy full-hash promotion.
9. Podcast transcript UI/study controls.
10. Unified search integration.
11. Live-provider qualification workflow/report.
12. Optional sync design as a separately reviewed change.

Do not begin by renaming every media/video type.

## 23. Handoff summary

The current Expo branch is unusually well-positioned for Podcasts because the hard ASR/media primitives are already beneath VideoWorkspace. The project should reuse those primitives rather than reimplementing MOSS or decoding.

The main blockers are:

1. remote CORS/range and request-amplification qualification,
2. remote rendition identity / dynamic-ad stability,
3. video-specific presentation entanglement,
4. current Expo Video parity gap,
5. provider/legal/analytics boundaries around repeated enclosure reads, transcription and transcript persistence.

The recommended MVP stays conservative:

- curated Japanese catalog
- original publisher enclosures
- publisher timed transcripts first when available
- no proxy
- qualified CORS/range/stable-rendition sources only for MOSS
- immediate audio playback
- explicit on-device MOSS fallback
- sparse playhead-first transcription
- lazy full-byte hash only after Generate
- exact ContentKey before portable Track publication
- local-first persistence where sync semantics are unresolved
- no second media stack

This should be revised after Phase 0 measures real current Japanese podcast enclosures in Chromium and the supported Android WebView/DOM environment.
