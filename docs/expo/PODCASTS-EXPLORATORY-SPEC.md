# Podcasts + MOSS ASR exploratory implementation spec

Status: exploratory handoff draft for revision by the next worker. This document intentionally changes no production code.

Reviewed source: `feat/expo-android-web-migration` at `c3b0c0ba225f9f14373b8594db7062e300f9c504` on 2026-10-02.

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
2. Only episodes whose original enclosure is browser-readable and random-access-capable enough for MOSS.
3. No proxy fallback.
4. No automatic transcription.
5. No automatic 648 MB MOSS model download.
6. Playback is immediate.
7. Generate transcript is explicit and transcribes around the playhead first using the existing sparse policy.
8. Do not overload RSS GUIDs or enclosure URLs as existing ContentKey values.
9. Do not redesign the synced video record protocol in the first implementation.
10. Treat native Android presentation as gated by the same domain/view separation still required for Videos on the Expo branch.

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

### 2.7 Current identity model is intentionally stronger than an RSS identity

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
2. Use credentials: omit.
3. Use redirect: follow.
4. Attempt GET with one bounded Range such as bytes=0-0.
5. A CORS failure is a hard ASR failure.
6. Require HTTP 206 for the random-access path.
7. Consume/cancel the tiny body and require exactly the requested bytes.
8. Establish a safe total byte size.
9. Verify a second nonzero range before marking the source qualified.
10. Run the same source through Mediabunny metadata/audio-track discovery before allowing Generate.

Do not use HEAD as the sole authority. Some media origins implement GET/Range and HEAD differently.

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

Do not make ETag or Content-Range mandatory unless actual qualified hosts expose them. The adapter can require only what is necessary for safety and use other evidence when appropriate.

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

### 5.1 read(start, end, signal)

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

### 5.2 playback()

Playback should use the original publisher enclosure URL unless there is a strong reason not to.

Do not create a Manabi media copy.

For web, an audio element is the natural playback primitive. The MOSS ByteSource and playback element may use separate requests, so remote-rendition stability must be considered; see the identity section below.

### 5.3 Do not leak Manabi authority

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

### 6.2 Recommended MVP: preserve full-byte ContentKey

For the first implementation, preserve the existing ContentKey invariant rather than changing the sync protocol.

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

### 6.3 Remote provisional identity needs a deliberate extension

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

### 6.4 Strong validator fast path

If a qualified source provides a strong, readable, stable ETag and consistent size across ranges, retain it as a session validator.

It can detect obvious replacement during a hash/transcription session.

Do not treat ETag itself as ContentKey.

If conditional request headers would require a CORS preflight that the host does not support, do not make the system depend on them. Comparing exposed validators is useful but not a universal enforcement mechanism.

### 6.5 Dynamic ad insertion

Dynamic ads can make separate requests to the same enclosure URL return different bytes.

This creates two risks:

1. Full hash stream and MOSS range reads could observe different renditions.
2. A later playback could differ from the transcript's timing.

Minimum safe behavior:

- during one Generate session, capture every observable validator/final URL/size signal
- fail/pause publication if a later read contradicts that session
- preserve existing audio proofs
- on reopen, before trusting a transcript for a remote episode whose rendition stability is uncertain, decode one or more bounded proof windows and compare their PCM digest
- if proof differs, mark transcript/source stale rather than showing mismatched timed text as authoritative

The exact proof policy needs benchmarking. Do not re-decode every saved window merely to open an episode.

A sensible first check is one early non-ad-prone speech window plus one later window, but do not pretend ad placement is predictable. The next worker should design this from actual qualified providers.

### 6.6 Alternative future identity

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

A + C is a reasonable MVP: curated manifest for coverage, direct client refresh where possible.

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

### 7.4 Arbitrary Add RSS feed

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

### 11.2 Default language

For a Japanese-curated catalog, metadata can suggest ja.

Still preserve the current principle that metadata is not magical speech detection. A bad feed language tag must not silently force an incompatible behavior.

The first UI can simplify the video multi-audio-track selector because most podcast enclosures have one audio track, but MediaPipeline should still verify and select a decodable track rather than assuming track ID 0.

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
- ETag changes when exposed
- Last-Modified changes
- cancellation before headers
- cancellation during body
- stale source lifetime
- response body cleanup
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

Maintain a small live smoke list across candidate hosts.

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

## 18. Performance/bandwidth expectations

Opening an episode should consume only metadata and ordinary playback demand.

Generate transcript may cause:

1. sparse decode/range requests near current position
2. MOSS model download on first use if absent
3. lazy full-episode hashing for exact ContentKey in the recommended MVP

The UI should not misrepresent #3. It may be useful to show a separate "verifying episode" byte progress state from MOSS inference progress.

Avoid running full hash at high concurrency with aggressive MediaBunny prefetch. One source session should budget requests so transcription near the playhead remains responsive.

A later identity protocol could remove the full hash requirement, but only after replacing it with an equally explicit rendition identity model.

## 19. Acceptance criteria for the first production-capable slice

A first shippable Podcasts experiment should satisfy all of the following:

- Feature is separately gated.
- Books / Videos / Podcasts category navigation is coherent.
- Catalog is Japanese-first and curated.
- Every episode offered for MOSS passed actual browser byte-read/range/decode qualification.
- Audio comes from the publisher's original enclosure; no Manabi audio proxy/rehost.
- Opening an episode does not download MOSS.
- Opening an episode does not full-hash the complete enclosure.
- Playback begins independently of transcript generation.
- Generate is explicit.
- MOSS uses the existing verified model/runtime/cache.
- MOSS receives bounded 16 kHz mono PCM through MediaPipeline.
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
1. Is lazy full-byte hashing acceptable for Generate in the first release?
2. Which remote validator signals are actually available from qualified hosts?
3. How should dynamic-ad renditions be detected on reopen?
4. Which audio-proof subset is sufficient to reject stale transcript reuse cheaply?

### Storage/sync
5. Are podcast transcripts local-only initially?
6. Is playback resume local-only or synced?
7. Do we add podcast-specific remote record kinds later, or plan a separate generic media-protocol migration?
8. How are logical episode IDs mapped to one or more byte renditions?

### Catalog
9. Checked-in editorial manifest, build-generated manifest, client RSS, or hybrid?
10. What is the minimum initial native-Japanese catalog?
11. What does "native" mean for catalog tagging?
12. How are dead/moved feeds handled?

### UX
13. Hide playback-only episodes or show them without Generate?
14. Should Generate mean "around current playback first" explicitly in copy?
15. Do we expose full-episode completion progress separately?
16. What should happen if the user seeks into an untranscribed region while MOSS is far behind?

### Expo
17. Should Podcasts wait for Video transcript/player domain extraction, or perform that extraction as its first enabling refactor?
18. What is the bounded Android DOM/media leaf?
19. Which exact shared screen/controller owns episode state?

### Provider/legal
20. Which catalog/provider terms need explicit approval?
21. Can generated transcripts sync privately, or should v1 keep them on-device?
22. Which SoundCloud usage path, if any, is acceptable without relying on a restricted proprietary API?

## 22. Suggested first engineering PR sequence

Keep each implementation PR reviewable.

1. Remote media qualification harness + docs only.
2. Remote ByteSource + local fixture tests.
3. Podcast catalog/parser domain + security tests.
4. Podcasts route/category + playback only.
5. Shared transcript/player seam extraction with zero intended Video behavior changes.
6. MOSS remote provisional generation + lazy full-hash promotion.
7. Podcast transcript UI/study controls.
8. Unified search integration.
9. Live-provider qualification workflow/report.
10. Optional sync design as a separately reviewed change.

Do not begin by renaming every media/video type.

## 23. Handoff summary

The current Expo branch is unusually well-positioned for Podcasts because the hard ASR/media primitives are already beneath VideoWorkspace. The project should reuse those primitives rather than reimplementing MOSS or decoding.

The main blockers are:

1. remote CORS/range qualification,
2. remote rendition identity,
3. video-specific presentation entanglement,
4. current Expo Video parity gap,
5. provider/legal boundaries around transcription and transcript persistence.

The recommended MVP stays conservative:

- curated Japanese catalog
- original publisher enclosures
- no proxy
- qualified CORS/range sources only
- immediate audio playback
- explicit on-device MOSS
- sparse playhead-first transcription
- lazy full-byte hash only after Generate
- exact ContentKey before portable Track publication
- local-first persistence where sync semantics are unresolved
- no second media stack

This should be revised after Phase 0 measures real current Japanese podcast enclosures in Chromium and the supported Android WebView/DOM environment.
