# Podcasts + MOSS ASR exploratory implementation spec

Status: exploratory handoff draft for revision by the next worker. This document intentionally changes no production code.

Reviewed source: `feat/expo-android-web-migration` through `53d4534ca681d4bf8f49f9b236d8330c41784811` on 2026-10-03. Media/MOSS internals underlying this review did not change between the earlier review base and this refinement; intervening Expo commits advanced shared Settings, Library/web-parity, bridge/font and CI migration work. Library section navigation was rechecked at this head.

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
2. Prefer a publisher transcript (`podcast:transcript`) when one is present, readable, and valid; enable timed follow/replay only when its timeline is qualified for the delivered rendition.
3. Only enable MOSS for episodes whose selected publisher-declared media source is browser-readable, range-capable, decodable, and sufficiently byte-stable for one admitted rendition session.
4. No proxy fallback.
5. No automatic transcription.
6. No automatic 648 MB MOSS model download.
7. Playback is immediate.
8. Local MOSS captions are explicit and use a new bounded `playback-lead` scheduler built on the existing sparse window/seam format; whole-episode completion is never the hidden default.
9. Do not overload RSS GUIDs or enclosure URLs as existing ContentKey values.
10. Do not redesign the synced video record protocol in the first implementation.
11. Treat native Android presentation as gated by the same domain/view separation still required for Videos on the Expo branch.
12. Treat intra-session rendition mismatch as a hard timed-MOSS failure. A host that is coherent within one session but changes on reopen may still support session-bound local captions; do not paper over either case with weak identity.

The largest implementation risk is not only MOSS accuracy. It is keeping logical episode identity, delivered rendition identity, transcript timeline, and exact byte identity separate while avoiding unbounded CPU/network work. The current video system correctly treats ContentKey as a full-byte SHA-256 identity. Podcast media can be large, redirect through analytics/ad infrastructure, and may be dynamically personalized. That must remain explicit.

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

There is already duplication to remove:

- React `LibraryTabs()` renders Books / Videos and hardcodes Books as current
- `VideoWorkspace` constructs a separate DOM Books / Videos nav and marks Videos current
- the retained Svelte reference has its own tab markup

Do **not** add a fourth Podcasts-specific switcher. Extract one host-owned section-navigation model/view with an explicit current category and enabled categories. VideoWorkspace should no longer own site/library navigation as part of its eventual domain/view split.

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

There are two different pieces of historical performance evidence in the media docs and neither qualifies current podcast throughput:

- the older recovered Japanese smoke in `docs/moss-video-runtime-review.md` measured about **19.5x realtime threaded** on its short CI fixture
- the later base-v4 CPU qualification recorded in `docs/moss-progressive-transcription.md` improved the small generated-speech fixture to about **3.14x realtime threaded** and **5.7x single-threaded**

The current v7 callback runtime has not been requalified there, those figures are not representative-device measurements, and natural Japanese/music/background-noise/long-form repair behavior remains explicitly unqualified. Even the better 3.14x figure is still slower than playback.

This makes a podcast-specific scheduler distinction necessary. The existing v3 sparse policy is **playhead-prioritized but not playhead-bounded**: once a sparse job runs, `nextSparseWindow()` keeps selecting missing windows until the whole media item is covered.

Do not reuse that behavior unchanged for long podcasts.

The default podcast UX should be:

~~~text
open episode
-> play immediately
-> use a valid publisher timed transcript if one is already available
-> otherwise user explicitly enables local MOSS captions
-> generate only the bounded caption lead needed around/after the current playhead
-> park inference when that lead is satisfied
-> resume bounded work as playback/seek approaches missing coverage
~~~

Whole-episode transcription must be a separate explicit policy/action, not the hidden consequence of "Generate transcript." It should not ship until representative devices establish acceptable time, power, thermal, memory and repair behavior.

Do not claim background inference after the browser/WebView suspends or terminates the page. Background **playback** and background **MOSS inference** are separate capabilities.

### 2.7 Existing Expo dependencies change the preferred implementation seam

The Expo branch already depends on:

- `expo-audio ~57.0.5`
- `fast-xml-parser 5.11.1`
- `dompurify 3.4.15`
- `mediabunny 1.59.1`

Do not add another audio playback package or XML parser before evaluating these.

`expo-audio` supports Android and web remote-URL playback and exposes shared play/pause/seek/rate/status APIs. Its web player also has an explicit `crossOrigin` option whose default is undefined/no CORS. That is useful because playback and ASR do not have to use the same request mode.

The current Expo config explicitly sets:

~~~ts
enableBackgroundPlayback: false
~~~

So background podcast playback is **not** an existing capability of this branch. Enabling it later is a separate native/config decision: Expo's Android path adds a foreground media-playback service, requires the audio mode to allow background playback, and requires active lock-screen controls for sustained background playback. Do not smuggle that permission/service change into the first podcast slice.

`expo-audio` does **not** replace the MOSS byte path. ASR still needs the CORS-readable `ByteSource`/Mediabunny pipeline.

For web, retaining a bounded DOM `<audio>` leaf may still be preferable if it gives materially better browser semantics/accessibility. The shared product controller should depend on a transport port, not on either choice.

For RSS, prefer the already-installed XML parser with a deliberately hostile-input configuration. Reject `DOCTYPE`/custom entity declarations before parsing, bound bytes/depth/item counts, retain namespace prefixes, avoid accidental numeric/boolean coercion of GUIDs and IDs, and never pass parsed feed HTML directly to the DOM. Do not rely on parser defaults as the security policy.

Official Expo Audio reference for the pinned SDK line:
https://docs.expo.dev/versions/v57.0.0/sdk/audio/

### 2.8 The newer Expo work strengthens the shared-controller direction

Since the original review, the Expo branch has begun converging Settings into shared category/search/workspace composition with bounded platform leaves. That is the pattern Podcasts should follow:

- shared podcast/catalog/player state and commands
- bounded web/native playback leaves
- bounded DOM media/ASR runtime where required
- no second feature state machine hidden behind a `.web.tsx` file

Podcasts should ideally help extract this boundary from Videos rather than adding another migration exception.

### 2.9 Current identity model is intentionally stronger than an RSS identity

`ContentKey` currently means full media-byte SHA-256.

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

### 2.10 Existing service-worker behavior is already favorable

The current service worker already has the right default for remote podcast media:

- requests with a `Range` header are not intercepted
- unrelated cross-origin requests are not intercepted
- arbitrary remote resources are not placed in Reader caches
- public/static audio formats are excluded from the required offline shell

Do not add podcast audio caching to the service worker as part of this feature. Add regression coverage that the new route/catalog does not weaken those boundaries.

A checked-in/generated **metadata manifest** may be an ordinary same-origin application asset. Episode audio and linked publisher transcript bodies remain remote/user-requested resources, not shell assets.

### 2.11 Current feature gating is too video-specific for Podcasts

The current optional-media release boundary is wired specifically to `EXPO_PUBLIC_ENABLE_VIDEO_LEARNING`:

- `lib/media/feature.ts` exposes only `videoLearningEnabled`
- Library section navigation appears only under that flag
- unified media search refuses to initialize when video learning is disabled
- `scripts/prepare-expo.mjs` copies `static/moss/**` into Expo public assets only when video learning is enabled
- `app.config.ts` only carries the legacy `ENABLE_VIDEO_LEARNING` environment compatibility mapping

A separate Podcasts flag cannot simply be added at the route level. A Podcasts-only build would otherwise risk either missing the MOSS runtime or enabling Videos just to get shared media assets.

Recommended capability split:

~~~ts
export const videoLearningEnabled = ...
export const podcastsEnabled = ...

// Build/runtime capability, not another user-facing category.
export const mossMediaEnabled =
  videoLearningEnabled || podcastsEnabled
~~~

The exact name is open. The important rule is:

- product/category flags decide which UI/search sources exist
- a derived MOSS/media capability decides whether runtime/model assets and qualification gates are present

Update `prepare-expo.mjs` to package MOSS when **either** product needs it. Refactor Library tabs and unified search to compose enabled media sources rather than using `videoLearningEnabled` as the synonym for all optional media.

Do not make Podcasts depend on turning Videos on.

### 2.12 Cross-origin isolation can change playback rules

`MossClient` selects the threaded WASM runtime only when `globalThis.crossOriginIsolated` and `SharedArrayBuffer` are available. The Reader repository itself does not currently establish a universal COOP/COEP deployment contract; production/server headers remain part of runtime qualification.

That matters for podcasts. Under `Cross-Origin-Embedder-Policy: require-corp`, a cross-origin media element requested in normal `no-cors` mode can be blocked unless the response opts into CORP. A CORS-mode media request can instead pass COEP if the media host actually permits CORS. Under `credentialless`, no-cors behavior is different again and cannot be assumed across the entire supported matrix.

Therefore "playback works without CORS" is only true in the ordinary non-COEP case.

Provider qualification must record:

- actual web response headers for the Manabi document
- `crossOriginIsolated`
- COEP/COOP mode
- whether playback succeeds with the transport's default/no-CORS request
- whether playback succeeds with anonymous CORS when necessary
- whether MOSS Range fetches remain readable

Do not globally enable or change COOP/COEP merely to speed up podcast MOSS without requalifying the rest of Reader and third-party media. MDN reference:
https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy

## 3. Product scope

### 3.1 Primary use case

A learner wants a high-quality Japanese immersion source inside Manabi:

1. Browse Japanese podcasts.
2. Pick an episode.
3. Listen normally.
4. Use a publisher transcript immediately when it is suitable.
5. If timed captions are absent or not aligned to the delivered audio rendition, explicitly enable bounded local MOSS captions near the current playhead.
6. Follow compatible timed text with playback.
7. Replay/previous/next by utterance.
8. Select text and use the existing reading/dictionary affordances where technically available.
9. Resume the logical episode later even if its CDN locator changes.
10. Search saved transcript text without fetching podcast audio or starting recognition.

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


### 3.4 Dated provider CORS investigation — 2026-10-03

This checkpoint separates five kinds of evidence:

- **target-origin browser evidence**: strongest; an actual Manabi-origin/browser `fetch()` reads the requested Range body
- **current wire/header evidence**: a captured real HTTP response/redirect shows CORS/Range headers, but may have come from a media-element/no-CORS request and therefore is **not** proof that JavaScript can read the body
- current provider documentation: what the hosting platform says it does
- current directory/feed evidence: the URL shape publishers are actually distributing
- historical evidence: useful for identifying failure classes, but not a release pass

Only target-origin browser evidence should turn a catalog media URL green for MOSS. Header-positive wire evidence is a strong probe candidate, not release qualification.

Do not turn this table into a hostname allowlist. The exact publisher-declared media URL remains the release-admission unit.

| Provider family | Feed/discovery | Actual audio CORS | Range | Main blocker |
| --- | --- | --- | --- | --- |
| Megaphone | green | **CORS-header-positive; target-origin fetch pending** | **Range-header-positive; target-origin fetch pending** | browser redirect semantics, exact-size exposure, rendition/session stability |
| RedCircle | likely green | **likely green at RedCircle core; target-origin fetch pending** | unproven | third-party prefix chain + dynamic insertion stability |
| Spotify for Creators / Anchor | green public RSS | **unproven; historical negative evidence** | unproven | Anchor wrapper/final CloudFront browser-fetch chain + dynamic ads |
| SoundCloud | feed historically poor | **final CDN CORS-header-positive; enclosure fetch pending** | **final CDN Range-header-positive; enclosure fetch pending** | exact RSS enclosure chain + signed URL/terms |
| Omny/Triton | green-ish | historically promising | historically promising | needs current exact Japanese enclosure probe |
| Podbean | feed green | unproven | unproven | feed CORS is not media CORS |
| Simplecast | feed green | unproven | unproven | feed CORS is not media CORS |
| Libsyn | feed green | unproven | unproven | feed CORS is not media CORS |
| ART19 | n/a | historical redirect failure class | n/a | first 302 can block before a CORS-friendly final CDN |

#### Megaphone — strongest current candidate

A February 23, 2026 capture of a real traffic.megaphone.fm MP3 shows the complete publisher-facing chain cooperating with CORS:

~~~text
traffic.megaphone.fm/<episode>.mp3
  302
  Access-Control-Allow-Origin: *
        |
        v
dcs-spotify.megaphone.fm/...session...
  audio/mpeg
  Access-Control-Allow-Origin: *
~~~

The same capture shows the browser issuing a Range media request and the final response returning Content-Range plus Access-Control-Allow-Origin: *.

Evidence:
https://urlscan.io/result/019c89d9-9b3d-76dd-83f3-cb53883514af/

This is materially stronger than merely observing that the final CDN has ACAO, because the original tracking redirect is also header-positive.

It is still **not target-origin JavaScript proof**. urlscan/network captures can show headers from a media-element request whose response body would remain opaque to script. Megaphone stays the best Phase-0 candidate, not an already-qualified provider.

The wildcard ACAO on both observed hops is nevertheless especially promising for Manabi's redirect shape: the Fetch standard can redirect-taint a cross-origin chain so later requests serialize Origin as `null`; credentialless `ACAO: *` remains compatible with that state. The executable browser probe must confirm Chromium/WebKit/WebView behavior.

One remaining header issue is important for ByteSource: the capture does not establish Access-Control-Expose-Headers: Content-Range. JavaScript must not assume it can read the total merely because a network trace can see Content-Range. Use the exact-size proof described in section 4.4 when necessary.

Megaphone final URLs are sessionized and the response includes ad/session metadata, so repeated fixed-range stability still needs qualification before transcript timing is treated as durable.

Working status:

~~~text
redirect headers       green candidate
final audio headers    green candidate
Range headers          green candidate
Manabi fetch body       UNPROVEN
exact size exposure     yellow
session stability       yellow
reopen stability        yellow
~~~

#### RedCircle — core CORS looks promising; the actual enclosure chain is the trap

A RedCircle representative stated publicly in September/October 2024 that CORS had been enabled on RedCircle feeds and, when specifically asked about audio, said it should work on audio*.redcircle.com URLs:

https://www.reddit.com/r/podcasting/comments/1frmvpy/

Current public Japanese examples still use the expected direct RedCircle media form. Japanese with Shun / Oyasumi Japanese with Shun episodes are exposed through audio4.redcircle.com/.../stream.mp3 in current podcast directory metadata. These should be first Phase-0 RedCircle probes.

Core RedCircle CORS is therefore not the only question. There are two larger blockers.

First, RedCircle Dynamic Insertion explicitly creates a listener-specific audio version on the fly. Two listeners can receive different copies. Current RedCircle support documentation also says it maintains one listener's audio for 24 hours so returning playback does not splice different ads, and programmatic-ad troubleshooting describes the stable window in terms of the same application and IP address.

Sources:
https://support.redcircle.com/articles/1930996965-what-is-dynamic-insertion
https://support.redcircle.com/articles/3315965613-troubleshooting-dynamic-insertion
https://support.redcircle.com/articles/2362676166-understanding-programmatic-ads-in-rap

That is encouraging for one listening session, but it is not proof that independent credentialless byte Range requests from Manabi receive an identical byte/timeline rendition. Test fixed ranges repeatedly from the actual application.

If the RedCircle rendition is coherent during one active browser/app session but changes in a fresh context later, classify it `MOSS_SESSION_ONLY`, not unsupported. Saved text can survive; old timed behavior must revalidate before reuse.

Second, RedCircle lets creators prepend third-party analytics prefixes directly into the RSS enclosure. Current supported prefixes include Spotify Ad Analytics / Podsights, Podtrac, Podscribe, Claritas and Magellan:

https://support.redcircle.com/articles/6155114893-how-to-add-a-third-party-prefix-to-your-podcast

A RedCircle-hosted show can therefore expose a chain like:

~~~text
pdst.fm
 -> dts.podtrac.com
 -> pscrb.fm
 -> claritaspod.com
 -> mgln.ai
 -> audio4.redcircle.com
~~~

Even if audio4.redcircle.com is perfect, any earlier redirect can break browser fetch CORS.

Multi-provider prefix chains are also exposed to redirect-origin taint. After the first cross-origin redirect, later requests can carry an Origin serialized as `null` under the Fetch model. Wildcard ACAO is the simplest robust behavior for a credentialless chain; an intermediate/final service that only mirrors the original Manabi origin can fail later in the chain.

Do not strip those prefixes to reach RedCircle directly. They are publisher-selected measurement/monetization infrastructure.

Working status:

~~~text
RedCircle feed CORS          likely green
direct RedCircle audio       likely header/body compatible from provider statement
Manabi fetch body            UNPROVEN
Range                        unproven
same-session rendition       promising but unproven
reopen rendition             expected to vary in some monetized cases
third-party prefix chain     per-show unknown
~~~

The right admission key is therefore not redcircle.com. It is the exact RSS/publisher media URL for that show/episode.

#### Spotify for Creators / legacy Anchor — do not admit yet

Spotify explicitly supports public RSS distribution for Spotify-hosted shows. Its current help center says Spotify-hosted podcasts receive an RSS feed containing audio file links and can submit that feed to external podcast applications.

Sources:
https://support.spotify.com/us/creators/article/distributing-your-show-to-other-platforms/
https://support.spotify.com/ag/creators/article/finding-and-enabling-your-rss-feed/

Current Japanese Spotify-hosted shows continue to use legacy Anchor-style RSS and media infrastructure. Public directory metadata for shows such as YUYU and COTEN continues to point at anchor.fm feeds, and current Spotify-hosted episode metadata still uses the Anchor play-wrapper / d3ctxlq1ktw2nl.cloudfront.net delivery family.

That establishes normal podcast distribution. It does **not** establish browser-readable audio bytes.

This investigation did not find sufficiently current wire evidence proving all of the following on the actual Anchor RSS enclosure:

- Access-Control-Allow-Origin on the Anchor play-wrapper redirect
- Access-Control-Allow-Origin on the final CloudFront MP3
- 206 Range with browser-readable response body
- exact-size evidence usable by JavaScript

The explicit browser failure found for this same Anchor/CloudFront architecture is historical: a 2019 report shows the audio request being blocked because Access-Control-Allow-Origin was absent. That cannot prove the 2026 path is still broken, but in the absence of current positive **target-origin browser-fetch evidence** it remains a release blocker, not a green host.

Historical failure:
https://sonaar.ticksy.com/ticket/1905730/

Do not decode the CloudFront URL embedded inside an Anchor wrapper and use it directly as a workaround. The wrapper is the publisher-distributed authority and may carry measurement/ad semantics.

Spotify also has a separate rendition-stability problem. Current Spotify Partner Program documentation says targeted ads can be delivered when Spotify-hosted episodes are streamed on Spotify **or downloaded on another podcast listening platform**.

Source:
https://support.spotify.com/pk-en/creators/article/spotify-partner-program/

So even after CORS passes, monetized Spotify-hosted episodes need the same two-tier stability tests as RedCircle: coherence during the active playback/ASR session, then separate reopen compatibility. A fresh-session ad change does not by itself forbid session-bound MOSS.

Working status:

~~~text
public RSS/distribution     green
feed CORS                   historically positive; current app probe needed
Anchor-wrapper fetch CORS   unknown — release blocker
final audio fetch CORS      unknown — release blocker
Range                       unknown
same-session rendition      unknown
reopen rendition            expected to vary in some monetized cases
~~~

For v1, treat Spotify for Creators as unsupported for MOSS until the actual target-origin browser probe succeeds.

#### SoundCloud — final CDN is technically strong, but that is not the whole chain

A September 2026 captured response from cf-media.sndcdn.com shows:

~~~text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
Accept-Ranges: bytes
Content-Type: audio/mpeg
ETag: ...
Content-Length: ...
~~~

The current evidence is in a recent yt-dlp issue containing the signed SoundCloud CDN response:
https://github.com/yt-dlp/yt-dlp/issues/17651

That makes the final media CDN technically attractive for Manabi.

However, the Podcast Standards Project's host survey found SoundCloud podcast feeds did not broadly enable CORS in its 2023 sample, and signed CDN URLs are implementation/session URLs. The generated catalog removes the need for runtime feed CORS, but it does not justify manufacturing or scraping a signed CDN URL instead of following the publisher's actual enclosure.

Working status:

~~~text
feed CORS               historical red
final CDN CORS headers  green candidate
final CDN Range headers green candidate
Manabi enclosure fetch  UNPROVEN
RSS enclosure chain     unknown
terms/API boundary      separate review
~~~

#### Omny/Triton — promising but needs a current Japanese probe

Observed podcast redirect chains have used:

~~~text
tracking prefix
 -> traffic.omny.fm
 -> *.mc.tritondigital.com
~~~

with CORS-friendly redirects in historical captures. Triton also documents Podtrac-prefix integration and dynamic monetization delivery.

References:
https://help.tritondigital.com/docs/integrating-your-podcast-cms-and-monetizing
https://gist.github.com/voltagex/4f0188fbb74cb7568438aaab565471b4

This is worth prioritizing for Japanese broadcaster/news content, but it does not yet have Megaphone-level current wire evidence in this review.

#### Podbean, Simplecast and Libsyn — feed CORS is not audio CORS

The Podcast Standards Project's 2023 survey found broad feed CORS on feed.podbean.com, feeds.simplecast.com and feeds.libsyn.com, as well as Omny, Megaphone and Anchor feeds.

Survey:
https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification/discussions/7

That survey measured RSS feed responses, not the enclosure path required for JavaScript MOSS. No sufficiently current exact-enclosure Range+CORS evidence was found for Podbean, Simplecast or Libsyn in this pass. Keep them in the qualification set, not the supported set.

#### ART19 — canonical redirect-hop failure class

A documented ART19 browser case demonstrates why final-CDN CORS is insufficient:

~~~text
rss.art19.com/episodes/...mp3
  302 without usable ACAO
        |
        v
content.production.cdn.art19.com/...mp3
  final CDN has CORS
~~~

The browser fails at the redirect before JavaScript can use the final object.

Historical reference:
https://stackoverflow.com/questions/62567373/frontend-javascript-request-gets-302-redirected-but-ultimately-fails

This is not a current 2026 ART19 verdict. It is the regression class the Phase-0 harness must reproduce locally.

### 3.5 Exact Phase-0 capability model

Do not reduce qualification to one mutually exclusive `cors: true/false` status. Dynamic podcast delivery needs separate dimensions.

For each exact catalog media URL, from the production Manabi web origin and packaged Android DOM/WebView origin, record:

~~~ts
interface PodcastMediaQualification {
  playback: 'works' | 'fails' | 'unknown'
  playbackRequestMode: 'no-cors' | 'anonymous-cors' | 'unknown'
  corsBody: 'readable' | 'blocked' | 'unknown'
  range: 'single-range-206' | 'unsupported' | 'unknown'
  exactSize: 'proved' | 'unknown'

  // Can separate Range reads used by ASR during one active session be trusted
  // as one coherent byte/timeline rendition?
  asrSessionStability: 'stable' | 'unstable' | 'unknown'

  // Does the playback transport receive the same effective timeline that the
  // ByteSource/MOSS path is transcribing?
  playbackAsrCoherence: 'proved' | 'mismatch' | 'unknown'

  // After a fresh network/context later, does the same publisher URL still map
  // to evidence compatible with saved timed captions?
  reopenStability: 'stable' | 'different' | 'unknown'
}
~~~

Derived product capabilities:

~~~text
PLAYBACK_ONLY
  playback works
  JS readable Range path does not

MOSS_SESSION
  CORS body + Range + exact size pass
  ASR Range reads are stable within the session
  playback/ASR timeline coherence is proved
  timed local captions are valid for the active RenditionSession

MOSS_REOPEN
  MOSS_SESSION passes
  later reopen evidence also matches
  saved timed captions may be reactivated after the normal proof check

MOSS_SESSION_ONLY
  MOSS_SESSION passes
  fresh/reopen rendition differs or is not safely reusable
  old transcript text may remain useful, but old timestamps must not
  automatically drive the new audio

UNSTABLE_SESSION
  ASR reads disagree during one active rendition, or playback and ASR receive
  incompatible timelines
  do not present timed MOSS captions against that playback session
~~~

This distinction is particularly important for RedCircle/Spotify dynamic ads. A host that deliberately changes ads between listeners or later sessions is **not automatically unusable for local MOSS** if it gives one coherent rendition during the active session.

However, "all fetch ranges agree" is not enough. A host may key dynamic delivery on request metadata such as user agent, IP, fetch destination, media-element request mode or other application signals. The browser playback request and the MOSS fetch request can therefore receive different ad/timeline variants.

The hard failure is either:

- instability among ASR reads inside one session, or
- a playback/ASR timeline mismatch inside that session.

On reopen, revalidate bounded byte/PCM evidence before restoring timed behavior. If it differs, demote the prior transcript to text-only/history rather than silently seeking against the new timeline.

For failures, the browser qualification artifact should capture the network redirect chain and response headers. JavaScript itself cannot reliably inspect a CORS-blocked redirect after the fetch has failed.

The diagnostic result should identify whether the blocker was:

- publisher host
- RedCircle/other third-party analytics prefix
- redirect response
- redirect-origin taint / browser redirect policy
- final CDN
- COEP/CORP policy
- Range semantics
- exact-size/header exposure
- same-session dynamic-rendition instability
- reopen-only rendition change

The provider matrix must be refreshed from actual browser probes before release. Search results, directory metadata, old captures and provider statements are research evidence, not release evidence.

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
- `redirect: 'manual'` to discover a cross-origin Location; Fetch exposes an opaque-redirect response to script rather than a readable redirect target
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

Probe the exact media URL supplied by the publisher. For ordinary RSS this is the `<enclosure>` URL. A later section also permits a publisher-declared Podcasting 2.0 `<podcast:alternateEnclosure>` HTTPS source when it is explicitly the same/default content and separately qualified.

A tracking redirect can make a CORS fetch fail before JavaScript receives usable media, even when the final CDN would otherwise be readable. Do not treat a final CDN hostname as an app-facing API or synthesize a direct CDN URL from observed redirects.

There are two redirect-specific reasons to test the exact chain in the real browsers rather than reasoning only from the final headers:

1. Fetch performs a CORS check on a CORS-tainted network response before following the redirect. An intermediate 3xx can therefore fail the request before the final CDN matters.
2. The Fetch standard's redirect-taint rules can serialize the request Origin as `null` after cross-origin redirects. With `credentials: 'omit'`, `Access-Control-Allow-Origin: *` remains robust to that taint. A provider that emits an explicit original Manabi origin instead of wildcard/appropriate redirected-origin handling may behave differently after a multi-origin chain.

MDN also documents browser-specific CORS redirect failure cases and lingering redirect limitations around preflighted requests. Manabi intentionally keeps the media Range request non-preflighted, but Chromium, WebKit and packaged Android WebView still need an executable redirect matrix.

References:

- Fetch redirect/CORS algorithm: https://fetch.spec.whatwg.org/#http-redirect-fetch
- Fetch redirect-tainted Origin: https://fetch.spec.whatwg.org/#concept-request-tainted-origin
- MDN CORS redirects: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#preflighted_requests_and_redirects
- MDN external-redirect error class: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSExternalRedirectNotAllowed

### 4.3 Proposed ASR capability probe

For a selected publisher-declared media source:

1. Require HTTPS in production.
2. Use explicit `mode: 'cors'`, `credentials: 'omit'`, the exact publisher-declared URL and `redirect: 'follow'`; never substitute an inferred CDN URL.
3. Attempt GET with **one contiguous** byte Range such as `bytes=0-0`.
4. A single-byte-range `Range` header is CORS-safelisted and should not itself require a preflight; the server still must opt into CORS for the response body.
5. Never combine disjoint reads into a multi-range header such as `bytes=0-99,1000-1099`. Multiple ranges are not CORS-safelisted, can trigger preflight behavior, and return multipart semantics the current ByteSource does not need.
6. Do not add `If-Range`, `If-Match`, `If-None-Match` or custom validator headers in v1. They leave the simple request path and can introduce preflight/provider incompatibility.
7. A CORS failure is a hard failure for that readable-byte path.
8. Require HTTP 206 for the v1 random-access MOSS path. `Accept-Ranges: bytes` is useful diagnostic evidence but is neither required nor sufficient; prove behavior with an actual Range request.
9. Consume/cancel the tiny body and require exactly the requested bytes.
10. Establish a safe total byte size.
11. Verify at least one nonzero range.
12. Test **same-session coherence** with the same runtime-equivalent request/cache policy Manabi will use in production. Repeated fixed ranges used by one active RenditionSession must agree.
13. Separately test **reopen stability** from a fresh browser context/network validation without changing the publisher URL. A changed later rendition does not invalidate MOSS_SESSION if the active session itself was coherent; it limits timed-caption reuse across sessions.
14. For the explicit fresh-network qualification check, prefer a browser cache mode such as `reload` or an equivalent new context. Do not append cache-busting query parameters and do not use a different publisher URL, because that can change ad/session routing and no longer tests the real enclosure.
15. If identical reads disagree **inside one active rendition session**, classify it UNSTABLE_SESSION and do not run MOSS.
16. Run the same source through Mediabunny metadata/audio-track discovery and bounded decode before allowing MOSS.
17. Record request count/redirect count and request `Origin` values where browser instrumentation exposes them; excessive range fan-out is a publisher-analytics and performance concern, not merely an implementation detail.
18. Record whether the document is cross-origin isolated and whether its COEP mode changes playback behavior.

Do not use HEAD as the sole authority. Some media origins implement GET/Range and HEAD differently.

Do not require a custom request header for qualification. Keeping the request in the simple-CORS path materially increases compatibility.

Do not switch to `credentials: 'include'` merely to obtain sticky dynamic ads. Wildcard ACAO cannot authorize credentialed CORS reads, third-party cookie behavior is increasingly restricted, and cross-device/session semantics would become browser-policy dependent. If one provider requires cookies/authentication to keep separate Range reads coherent, mark that path unsupported for the proxyless v1 rather than weakening the request model.

MDN confirms that `Range` is CORS-safelisted only for a single byte range:
https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range

### 4.4 Establishing exact source size

`ByteSource` requires a known exact size, not merely a display hint.

Preferred evidence order:

1. Valid exposed `Content-Range` total from a successful 206 response.
2. A publisher-declared file length from RSS `<enclosure length>` or qualified `podcast:alternateEnclosure length`, **actively checked against Range behavior**.
3. Another separately qualified exact-size mechanism.

Do not use the `Content-Length` of a 206 response as total size; it is normally just the selected range body length. A full-response HEAD/GET `Content-Length` can be useful only if that exact response representation is demonstrably the same random-access representation.

When `Content-Range` is not exposed, a positive publisher-declared candidate size `N` can usually be checked with **one** CORS-safelisted contiguous Range:

~~~text
Range: bytes=N-1-N
~~~

HTTP byte positions are inclusive. RFC 9110 specifies that when the requested last position extends beyond the selected representation, the server interprets the range as the remainder of the representation.

Therefore:

~~~text
actual size == N
  -> 206 with exactly 1 readable body byte (N-1)

actual size > N
  -> 206 with 2 readable body bytes (N-1 and N)

actual size < N
  -> start N-1 is unsatisfiable -> 416
~~~

For the common exact-size case, this proves the declared boundary without needing `Content-Range` exposure or a second 416 probe. It also cuts qualification traffic/analytics hits.

Require the actual response status and body length. A server returning 200 ignored the Range and is not qualified. A 416 means the declaration is too large, stale, or the rendition changed; do not attempt request-heavy binary searching in v1 just to recover an unknown dynamic size.

Run this boundary probe inside the same `RenditionSession` and combine it with fixed-range fingerprints; it is not a substitute for rendition-stability checks.

Reference:
https://www.rfc-editor.org/rfc/rfc9110.html#name-range

RSS/feed metadata is hostile input. Require a positive safe integer within a deliberate maximum. Zero, missing, stale or contradictory lengths are not exact size evidence.

If exact size cannot be established safely, do not admit that media source into the current random-access MOSS path.

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

CORS/cache variance also matters because the product flow is playback first, ASR later. If a host conditionally emits ACAO based on the request `Origin`, its cacheable response should vary on `Origin`. The Fetch standard warns that a cached non-CORS response can otherwise be reused for a later CORS request and make it appear to lack ACAO. Wildcard ACAO sent consistently avoids this class.

Phase 0 must therefore test both playback-before-ASR and ASR-before-playback from cold contexts and record `Vary: Origin` whenever ACAO is explicit/conditional.

Reference:
https://fetch.spec.whatwg.org/#cors-protocol-and-http-caches

## 5. Proposed RemotePodcastSource

Add a remote HTTP implementation behind the existing ByteSource abstraction rather than teaching MOSS about URLs.

Conceptual shape:

~~~ts
type ShowKey = `show:${string}`
type EpisodeKey = `episode:${string}`

interface PodcastMediaCandidate {
  source: 'enclosure' | 'alternate-enclosure'
  url: string
  type: string
  length?: number

  // Alternate-enclosure metadata when present.
  bitrate?: number
  language?: string
  codecs?: string
  relation?: string
  title?: string
  isDefault?: boolean
  integrity?: {
    type: 'sri' | 'pgp-signature'
    value: string
  }
}

interface PodcastTranscriptResource {
  url: string
  type: string
  language?: string
  rel?: 'captions'
}

interface PodcastEpisodeLocator {
  version: 1
  showKey: ShowKey
  episodeKey: EpisodeKey

  feedUrl: string
  guid?: string

  showTitle: string
  episodeTitle: string
  publishedAt?: string
  artworkUrl?: string
  webpageUrl?: string

  media: PodcastMediaCandidate[]
  transcripts: PodcastTranscriptResource[]
}

interface QualifiedRenditionSession {
  episodeKey: EpisodeKey
  source: ByteSource

  publisherUrl: string
  sourceKind: PodcastMediaCandidate['source']
  observedFinalUrl?: string

  capability: {
    corsReadable: true
    randomAccess: true
    size: number
  }

  evidence: {
    fixedRangeDigests: Array<{
      start: number
      end: number
      sha256: string
    }>
    strongEtag?: string
    lastModified?: string
  }
}
~~~

The exact types should be revised against the implementation. The important separation is:

- `PodcastEpisodeLocator` = logical publisher/catalog identity and presentation metadata
- `PodcastMediaCandidate` = publisher-declared ways to obtain episode media
- `QualifiedRenditionSession` = one admitted byte/timeline session for ASR
- `ByteSource` = currently readable bytes inside that session
- `ContentKey` = SHA-256 identity of one exact complete byte representation, only needed when existing portable Track semantics require it

Do not persist `observedFinalUrl` as a replacement media authority merely because redirects revealed it.

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

- run through the existing `assertRange` budget
- fetch the publisher-admitted media URL, not an inferred final CDN URL
- send exactly one byte `Range`
- use `credentials: 'omit'`
- use `referrerPolicy: 'no-referrer'` for JavaScript ASR reads unless provider qualification demonstrates a requirement for referrer delivery
- avoid cache-busting query parameters
- prefer normal/default runtime HTTP caching; do **not** copy the cloud source's `cache: 'no-store'` behavior by default, because that would multiply publisher requests and defeat useful CDN/browser caching
- validate 206 status and exact body length
- never accept a full 200 response for a bounded random range and silently buffer the whole episode
- cancel discarded bodies
- fence all results by source lifetime/generation
- detect observable source-version changes

Qualification may deliberately revalidate cache to test **reopen** stability. Production reading and same-session coherence testing should use runtime-equivalent/default cache behavior.

Production reading and qualification stability testing are different policies and should not share one opaque `fetch` helper without an explicit mode.

Suggested distinction:

~~~ts
type RemoteReadMode =
  | 'runtime'            // normal browser cache semantics
  | 'qualify-reopen'     // fresh/revalidated evidence, same publisher URL
~~~

Do not use `cache: 'no-store'` for every production chunk. That defeats useful HTTP caching and can cause a dynamic-ad host to mint more renditions/measurements than a normal podcast player would.

### 5.3 playback()

Playback should use the selected publisher-declared media URL (normally the standard RSS enclosure; otherwise an explicitly qualified publisher alternate enclosure).

Do not create a Manabi media copy.

For web, an audio element is the natural playback primitive. The MOSS ByteSource and playback element use separate network requests, so remote-rendition stability must include **playback/ASR timeline coherence**; see the identity section below.

Readable playback-element bytes are not required by the production ASR path. In an ordinary non-COEP document, do not globally set `crossOrigin="anonymous"` / `crossOrigin: 'anonymous'` for every podcast: forcing CORS can make otherwise playable publisher audio fail.

For an episode already qualified as MOSS-capable, anonymous-CORS playback is worth testing and may be preferable because it brings playback closer to the credentialless CORS request model used by ASR and also works with `COEP: require-corp` when the host permits it. This is a per-qualified-source playback capability, not a global setting.

If anonymous-CORS playback fails but ordinary no-CORS playback works while JS Range fetches also work, that source needs a stronger playback/ASR coherence test before timed MOSS is enabled.

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

### 6.1 Separate show, episode and rendition identity

The podcast domain needs at least three identities with different semantics:

~~~text
ShowKey
  stable Manabi/catalog identity for one subscribed/curated show

EpisodeKey
  logical episode identity
  normally derived from ShowKey + RSS GUID
  survives CDN moves and corrected/re-encoded media

RenditionSession
  one currently admitted delivered byte/timeline rendition
  URL/size/validators/fixed-range evidence are session data

ContentKey
  existing portable SHA-256 identity for one exact complete byte representation
~~~

An RSS GUID is not globally unique by itself; scope it to the show/feed identity. When GUID is missing, the Podcasting 2.0 recommendations allow enclosure URL as a fallback, but that fallback must remain a logical locator identity, not a claim that the audio bytes can never change.

Do not use title + publication date as the primary episode key.

Playback resume belongs primarily to `EpisodeKey`: the user generally wants to continue the same logical episode after a CDN migration or corrected file. Timed generated captions belong to a rendition/content identity and need stronger evidence.

A GUID identifies an episode in a feed. It does not prove that two HTTP responses contain identical bytes.

A media rendition can change because of:

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

Before creating a remote provisional MOSS job, establish a `RenditionSession` (name provisional) containing the exact admitted publisher media URL, exact-size evidence, final observed URL for diagnostics, exposed validators when available, and fixed-range byte fingerprints.

The session is valid only while subsequent runtime reads remain consistent with that evidence.

Do **not** automatically switch playback or ASR to the final CDN URL merely because `Response.url` reveals it. Doing so can bypass publisher tracking/ad delivery or rely on an expiring implementation URL. The publisher-declared source remains authority unless a provider-specific integration explicitly permits another URL.

Distinguish two failures:

- **intra-session mismatch** — the same active RenditionSession returns incompatible bytes/timeline for overlapping/fixed ranges. This is a hard MOSS failure: stop inference and classify that media path `UNSTABLE_SESSION`.
- **later-session mismatch** — a fresh context/reopen gets a different but internally coherent rendition. This is expected on some monetized hosts. Current-session MOSS can still be valid; saved timed captions require evidence revalidation before reuse and may fall back to text-only history.

Do not reduce both cases to playback-only.

### 6.3 Full-byte ContentKey is a compatibility path, not the default experiment

Preserving the existing `ContentKey` invariant is the safest path **if** a podcast result is going to become an existing portable/synced `Track`. It is not necessarily the right cost for the first local podcast experiment.

Benchmark two stages separately:

1. **Local bounded draft:** `EpisodeKey + RenditionSession + audio proofs`; enough to display/study accepted MOSS windows locally, but not enough to publish them as an existing portable Track.
2. **Portable publication:** only if the product requires export/sync/ordinary Track publication, finish exact byte identity or introduce a separately reviewed rendition identity protocol.

The current Job validator also requires a completed provisional job to have `verifiedMediaKey`, so this is a real scheduler/schema decision. Do not keep a fake ContentKey forever just to satisfy existing types.

If the implementation later chooses the exact-`ContentKey` compatibility path for portable publication, the flow is:

~~~text
Open episode
  -> qualified rendition session
  -> playback immediately
  -> optional publisher transcript
  -> no full hash

User explicitly enables local captions
  -> create/re-admit bounded playback-lead job
  -> transcribe only required sparse windows
  -> store rendition evidence + audio proofs
  -> remain a local draft

Only if user/product requests portable Track publication
  -> finish exact full-byte verification inside the same rendition session
  -> once SHA-256 finishes and rendition is still current:
       bind/promote to real ContentKey
       permit ordinary portable Track publication
~~~

This intentionally incurs a complete byte read only when portable publication is required. It does not make browsing or playback download the entire episode.

Do not run a second independent full-file verifier blindly beside hours of sparse decode. Measure duplicate byte/request cost first and share a single `RenditionSession` so all reads observe the same source evidence. If whole-file hashing remains necessary, profile its main-thread cost as well as network cost; the current incremental hasher yields but was designed around local/cloud video, not hour-long remote audio.

This path is proxyless and preserves existing portable transcript semantics, but it is deliberately conservative and potentially expensive.

### 6.4 Remote provisional identity needs a deliberate extension

Today provisional generation is intentionally limited to local `File` sources.

The next worker should generalize that mechanism only after establishing a stable remote-source session contract.

Do not simply remove the `File` check, and do not reuse `deviceKey()` verbatim. That helper hashes the literal domain marker `device-video-v1` and local-source name/size/version semantics. Extract a generic sampled-source/rendition-evidence primitive or define a podcast-specific equivalent with an explicit version.

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

Dynamic ads can make the same logical episode URL map to different byte/timeline renditions across listeners, devices or sessions.

This creates three different risks:

1. **same-session split brain** — MOSS, hashing and playback requests accidentally observe different renditions during one active session.
2. **reopen mismatch** — later playback is coherent but no longer aligns with saved timed captions.
3. **cross-device mismatch** — another device receives a different ad/timeline even when the logical episode is the same.

Minimum safe behavior:

- during one active local-caption session, capture observable validator/final-URL/size signals and fixed-range fingerprints
- record the qualified playback request mode and decoded/playback duration
- before accepting a newly decoded window, ensure its source evidence still belongs to the active RenditionSession
- where dynamic delivery is possible, qualify playback/ASR timeline coherence rather than assuming the audio element and fetch receive the same inserted audio
- if same-session ASR evidence contradicts or playback/ASR coherence fails, abort/park timed MOSS immediately; do not merge hypotheses from two renditions
- preserve already accepted local text/audio proofs under the old rendition evidence
- on reopen, verify a bounded set of byte and/or decoded-PCM proofs before reactivating old timed cues
- if reopen proof differs, keep useful transcript text/history but disable old automatic seek/follow timing for the new rendition
- cross-device timed-caption reuse requires exact compatible content/rendition evidence; EpisodeKey alone is never enough
- never attempt to remove, skip, normalize away, or otherwise defeat dynamically inserted advertising
- measure whether ASR/hash range requests materially multiply publisher download/ad requests; if they do, reduce/coalesce reads or exclude the provider until an acceptable integration exists

Do not assume there is an "ad-free speech window" suitable for the reopen proof. Dynamic insertion can occur at pre-, mid- and post-roll positions, and publisher custom audio can appear at arbitrary insertion points. Select proof ranges from actual saved accepted audio windows and require their decoded PCM digest to match.

The proof count/placement needs measurement. Start small and fail closed; do not re-decode every saved window merely to open an episode.

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

For this project, prefer a **generated static catalog data plane** over runtime arbitrary-feed fetching unless a concrete reason favors client RSS.

There are two different freshness classes:

~~~text
curated show seed
  stable ShowKey + feed URL/aliases + editorial tags
  small and reviewable
  safe to check in / bundle

episode manifest
  recent EpisodeKey + publisher metadata + media/transcript resource descriptors
  changes frequently
  should be refreshable independently of an Android binary
~~~

Use a separate catalog-refresh command/job to fetch the reviewed feed set, validate it, and produce bounded inert JSON.

Do **not** assume "put the generated episode JSON in Expo public/" solves this cross-platform. The current Expo migration explicitly embeds public assets in the Android binary and disables EAS Update; a frequently changing packaged episode manifest would require a new binary to refresh.

Preferred long-term shape:

- bundle/check in the small curated show seed
- publish the validated current episode manifest as a versioned **static data file** on an updateable Manabi-controlled HTTPS origin
- this is static metadata hosting, not an audio proxy or transcription backend
- web can use same-origin delivery when deployed that way
- packaged Android/DOM must qualify the manifest's CORS/origin path explicitly
- validate the complete manifest before atomically replacing the last-known-good local copy
- keep the last valid manifest for offline/retry behavior

If the project does not want a separately updateable static-data publication path yet, state the tradeoff honestly: web deployment/app release cadence becomes the catalog refresh cadence.

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

Do not make production app startup **or application build determinism** depend on a live feed update succeeding. A catalog-refresh failure must leave the last validated static manifest publishable/usable.

The generated catalog may retain publisher metadata and URLs needed for discovery. It should not copy/bundle episode audio or full publisher transcript bodies into Manabi merely to avoid runtime CORS.

Version the manifest schema independently of the application bundle. Reject an unsupported or partially downloaded manifest instead of half-applying it.

### 7.3 RSS parsing

Treat every feed field as hostile external input.

Requirements:

- parse XML without executing markup
- pre-reject `<!DOCTYPE` / `<!ENTITY` declarations for this feed subset rather than accepting feed-supplied entity definitions
- set explicit parser depth/entity limits supported by the pinned `fast-xml-parser` version
- retain namespace prefixes so `podcast:transcript`, `podcast:alternateEnclosure`, `itunes:duration` and similarly named unrelated tags cannot collapse together
- avoid automatic scalar coercion for GUIDs, IDs, durations and numeric-looking titles; normalize fields deliberately after parse
- force known repeated structures (`item`, `podcast:transcript`, alternate-enclosure/source collections) into predictable arrays
- never inject description HTML with `innerHTML`; extract/sanitize plain display text separately
- cap feed bytes, nesting, item count, per-item transcript/enclosure counts, text lengths and URL lengths
- normalize dates defensively
- treat feed `itunes:duration` only as catalog/display metadata; MediaPipeline duration is authoritative for playback/ASR
- support common RSS/iTunes/Podcasting 2.0 fields but ignore unknown fields
- require at least one supported publisher media source per surfaced episode
- canonicalize only enough for dedupe; do not mutate publisher URLs into a different authority
- use publisher-provided webpage URL for attribution when safe
- retain `podcast:license` metadata when present for review/display, but do not infer permission or prohibition solely from presence/absence of that tag

The installed parser has had recent entity/security work; that is not a reason to omit application-level limits. Add malicious/entity-bomb, deep-nesting, duplicate-field and huge-feed fixtures.

### 7.4 Prefer publisher transcripts before MOSS

Current podcast RSS guidance recommends `<podcast:transcript>`, and the Podcasting 2.0 namespace supports multiple linked transcript formats.

When an episode supplies transcript links:

1. prefer a publisher transcript over MOSS when it is readable and validates safely
2. prefer WebVTT / SRT / timed Podcast JSON for potential line-synced study
3. treat plain text / HTML as readable/searchable episode text without fabricating timestamps
4. preserve publisher language metadata and speaker names when the format provides them
5. honor `rel="captions"` as the publisher's assertion that timing exists, but **not** as proof that those timestamps match every dynamically ad-inserted rendition
6. do not confuse publisher speaker names with MOSS window-local diarization IDs
7. keep MOSS available as an explicit fallback for rendition-aligned timing

Dynamic advertising creates a second timeline problem: a publisher transcript can be perfectly valid for the editorial master and still drift after a personalized ad insertion. Therefore a linked publisher transcript is initially a **logical-episode transcript resource**, not automatically an existing rendition-bound `Track`.

For hosts/renditions qualified as timeline-stable, timed publisher cues may drive follow/replay. For dynamic or unknown timelines, show the publisher transcript as text but do not promise line-synced seeking; use rendition-bound MOSS when the user wants exact local timing.

The current `Track.origin` validator accepts only `embedded | sidecar | generated`, and `saveImportedTrack()` is similarly strict. Do not permanently mislabel a publisher RSS resource as `sidecar` merely to bypass that schema. If publisher tracks become durable Track records, add reviewed publisher-authored provenance/origin semantics and migrate/test every strict validator, sort, sync and export path that consumes them.

Linked transcript files have their own CORS and hostile-input requirements. Their availability is independent of enclosure CORS.

### 7.5 Publisher-declared alternate enclosures

Podcasting 2.0 can explicitly offer alternate media through `podcast:alternateEnclosure` and `podcast:source`. These are publisher-declared sources and are materially different from scraping a redirect target.

The namespace semantics matter:

- an absent `rel`, or `rel="default"`, groups the alternate with the ordinary enclosure as another encoding/transport for that content
- `default="true"` explicitly says the asset is the same as the ordinary enclosure content and should be preferred
- another `rel` can mean commentary/supporting/otherwise different media and must not be silently substituted for the main episode

The catalog parser may retain them, but v1 should only automatically consider:

- HTTPS `podcast:source` URIs
- finite directly addressable audio files
- a decodable MIME/codec
- the default/enclosure content group
- separately qualified CORS/range/rendition behavior

A non-default relation can be surfaced only as an explicit user-visible alternate with its own logical/timeline semantics.

Do not silently choose IPFS, torrents, onion URLs, HLS/live playlists or other transport schemes for the first ByteSource implementation.

Do not automatically pick the lowest bitrate: alternate encodes can differ in quality and ASR behavior. Prefer the publisher's standard/default source unless another declared source is intentionally qualified.

If `podcast:integrity` supplies SRI for an alternate enclosure, retain it as useful publisher-declared integrity evidence. It does not become an existing `ContentKey` without a reviewed mapping/verification rule.

References:
https://podcasting2.org/docs/podcast-namespace/tags/alternate-enclosure
https://podcasting2.org/docs/podcast-namespace/tags/integrity

### 7.6 Arbitrary Add RSS feed

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

`Cue` is media-generic. `Track` is only partly generic because it requires a `ContentKey` and has strict video-era origin semantics.

Existing `Playback` is **not** a good logical podcast-resume record even though its fields look generic: it requires `mediaKey: ContentKey`. Podcast resume should survive a rendition/CDN replacement and therefore belongs to `EpisodeKey`.

`VideoInfo` is not generic because width/height and video record kinds are baked in.

Recommended direction:

- define a small local `EpisodePlayback` / podcast-resume record keyed by `EpisodeKey`
- clamp/reconcile its saved position when the current delivered rendition has a changed duration; do not pretend byte identity stayed the same
- keep rendition-bound timed cue data separate from logical episode resume
- extract/grow generic transcript/player domain only where behavior is genuinely common
- represent publisher transcript resources separately until/unless they are safely promoted to durable Tracks
- add podcast-specific catalog/episode metadata
- leave existing video sync kinds untouched initially
- decide separately whether podcast resume/transcripts are local-only in MVP or need new backend kinds

The existing `MediaStore` has a useful local-only seam: its IndexedDB `local` object store accepts arbitrary string kinds and is not part of the strict `Replica.Kind = video_*` sync protocol. A thin podcast-local repository may reuse that transaction/lifetime machinery for namespaced keys such as episode resume and draft metadata without a database schema bump.

But do not use it unchanged as though it were already generic:

- database/error text still says Video
- its public subscription invalidation is only the legacy `captionsChanged, metadataChanged` boolean pair
- ordinary `putLocal()` writes notify with neither flag, so current unified media search would not learn that a podcast search projection changed
- loading every `jobs` record is not an acceptable substitute for a compact podcast transcript-search projection

Either generalize those local-store error/invalidation semantics while preserving Video behavior, or wrap the store with a podcast-specific typed invalidation layer. Do not create a second IndexedDB database merely to avoid doing that small ownership work unless isolation has a measured benefit.

### 9.3 Suggested podcast metadata and local transcript documents

Conceptual only:

~~~ts
interface PodcastShow {
  key: ShowKey
  feedUrl: string
  feedAliases?: string[]
  title: string
  description?: string
  artworkUrl?: string
  webpageUrl?: string
  language: string
  immersion: 'native' | 'learner-friendly'
  tags: string[]
}

interface PodcastEpisode {
  key: EpisodeKey
  showKey: ShowKey
  guid?: string
  title: string
  description?: string
  publishedAt?: number

  // Feed/display hint only; current decoded media owns transport duration.
  durationHint?: number

  media: PodcastMediaCandidate[]
  transcripts: PodcastTranscriptResource[]

  artworkUrl?: string
  webpageUrl?: string
}

interface EpisodePlayback {
  version: 1
  episodeKey: EpisodeKey
  position: number
  durationAtSave: number
  rate: number
  finished: boolean
  updatedAt: number

  // Optional reconciliation hint only; not content authority.
  renditionEvidenceId?: string
}

interface EpisodeTranscriptDocument {
  version: 1
  id: string
  episodeKey: EpisodeKey
  source: 'publisher'
  resourceUrl: string
  resourceSha256: string
  language: string
  format: 'text' | 'html' | 'vtt' | 'srt' | 'podcast-json'

  timing:
    | { kind: 'untimed' }
    | { kind: 'publisher-timed-unbound' }
    | {
        kind: 'rendition-bound'
        renditionEvidenceId: string
      }

  // Untimed resources retain normalized plain text. Timed resources may retain
  // validated cues, but only rendition-bound cues own playback seek semantics.
  text?: string
  cues?: Cue[]
}
~~~

`ShowKey` must survive reviewed feed URL migrations/aliases. `EpisodeKey` is scoped to the show and normally derives from the stable, case-sensitive RSS GUID; a missing-GUID fallback needs an explicit versioned rule. Podcasting 2.0's consumer recommendation permits falling back to enclosure URL (or a namespaced UUIDv5 of it), but that should be treated as legacy compatibility because standards-compliant RSS expects a stable GUID.

`EpisodeTranscriptDocument` is intentionally not an existing portable `Track`. It gives local search/read UI somewhere honest to persist publisher transcript content before rendition binding.

Resume across a changed rendition also needs explicit semantics:

- if the current rendition evidence matches the saved hint, restore the saved seconds normally
- if the rendition changed or cannot be proved the same, the saved position is a **logical-episode hint**, not an exact content timestamp
- clamp it to the current duration and do not automatically reactivate stale rendition-bound cues
- future chapter/text-anchor recovery may improve remapping, but v1 must not claim exact semantic resume across dynamic-ad timeline changes

Do not use `ShowKey` or `EpisodeKey` as `ContentKey`. Do not bind logical resume state to a particular CDN URL.

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
- decoded/known duration
- source/publisher link
- native browser audio controls or an accessible minimal custom transport
- playback rate
- transcript pane
- explicit **Generate local captions** only when rendition-bound MOSS is useful
- optional separate **Transcribe full episode** only if/when full mode is actually supported and qualified
- model download notice on first local MOSS use
- previous/replay/next utterance only for real timed cues
- follow playback only for real timed cues
- pause after each line only for real timed cues
- transcript/translation/source selectors where applicable
- clear labeling of Publisher transcript versus Local MOSS captions
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

### 11.1 Local MOSS remains explicit

Opening/browsing/playing a podcast must not:

- download the MOSS model
- start inference
- full-hash the episode
- generate local captions

A publisher transcript is not "generated" by Manabi and may be shown/read independently when available.

**Generate local captions** is the explicit MOSS action. It starts bounded playback-lead work by default. Exact full-byte verification is a separate portable-publication concern, not an automatic side effect of enabling local captions.

### 11.2 Default language and audio-track admission

For a Japanese-curated catalog, metadata can suggest ja.

For ordinary podcast enclosures with exactly one decodable, non-commentary audio track, auto-select it. Do not carry over the video's mandatory manual audio-track chooser when there is no ambiguity.

If multiple plausible audio tracks exist, retain the existing explicit-choice principle rather than guessing.

Still preserve the current principle that metadata is not magical speech detection. A bad feed language tag must not silently force an incompatible behavior. MediaPipeline must still verify the chosen track rather than assuming track ID 0.

### 11.3 Sparse-first, bounded-coverage behavior

Reuse the current v3 sparse **window format and seam safety**, but do not reuse its "eventually cover every window" scheduling policy unchanged.

Podcast default should be a versioned coverage policy such as:

~~~text
playback-lead
  maintain only a bounded accepted/ready lead around the current playback target

full
  explicitly requested whole-episode completion
~~~

The exact schema/state name is open, but it must be durable and validator-visible. Do not encode the distinction only in transient UI state.

Existing version-3 sparse jobs already have durable meaning: their scheduler ultimately fills the whole media item. **Do not reinterpret existing v3 jobs.** The podcast coverage contract needs a new persisted version/shape (for example a new Job version with a separate `coveragePolicy`) while retaining the current `overlap-sparse-v2` window/seam algorithm.

Keep recognition-window policy and scheduling policy separate:

~~~text
recognition policy
  overlap-sparse-v2
  -> how a window is decoded, reconciled and repaired

coverage policy
  playback-lead | full
  -> which missing windows are admitted, and when the job parks
~~~

This prevents a later scheduler change from relabeling old inference/checkpoint semantics.

For `playback-lead`:

- prioritize current playback position
- request only the predecessor/current/future windows needed for a bounded lead
- repair seams required for that lead
- checkpoint accepted windows normally
- use a measured high-water/low-water lead rather than scheduling one window on every `timeupdate`
- stop inference scheduling when the high-water lead is satisfied
- as playback approaches the low-water mark, re-admit/restart bounded work for the same durable job
- preserve accepted windows on cancel/close
- do not restart from zero because the user jumps forward
- do not let an idle open episode silently consume CPU filling distant hours
- a reload/new workspace never auto-starts MOSS merely because a saved playback-lead job or selected local draft exists; the user must explicitly resume local captions for that session

Model lifetime needs hysteresis too. Loading the verified model into a Worker is expensive even when its bytes are cached. Do not unload/reload on every small lead transition, but also do not keep 648 MB resident indefinitely merely because an episode stays open.

The implementation should measure a bounded **warm grace** for an active local-caption session. While the model is resident, retain the existing origin Web Lock ownership rule. After pause/inactivity/route departure or grace expiry, retire the runtime exactly as the current queue does.

The current Job status/pause-reason model has no "lead satisfied" state and current sparse queue code continues until full coverage. This requires an explicit versioned scheduler/job-state change rather than only calling `queue.prioritize()`.

Prefer a non-error parked/idle state or equivalently explicit coverage status. Do not overload `pauseReason: 'user'` or `'switch'`: lead satisfaction is successful scheduler state, and startup recovery must not present it as an abandoned/failed job.

Persist durable window coverage, not a promise that the prior Worker/model is still resident. Warm-grace state is ephemeral and must never change recovery correctness.

Whole-episode `full` mode, if eventually offered, must be an explicit separate action and should surface expected cost.

### 11.4 Model disclosure

The existing UI states that first Generate downloads a verified 648 MB model.

Podcasts should use the same model/cache and not present it as a second download.

If model size/revision changes later, display values should come from the shared MOSS model contract rather than duplicated copy.

### 11.5 Transcript publication

Only complete verified tracks currently publish to the synced media record layer.

Keep that invariant unless deliberately redesigned.

For provisional remote jobs:

- in-progress/accepted bounded cues may render and remain useful locally
- a playback-lead job may park successfully without becoming a complete Track
- ordinary portable Track publication waits for exact ContentKey unless a separately reviewed rendition identity protocol replaces that invariant
- if the optional full-verification/publication path fails, local accepted cues must not be silently promoted or destroyed
- user-visible state should distinguish Local MOSS captions from a complete portable transcript

## 12. Search integration

The existing unified Library search is a good model:

- media code is lazy-loaded
- searching never resolves/opens media
- searching never downloads podcast audio
- searching never starts MOSS
- complete saved timed cues may deep-link to a validated playback time

Podcasts should preserve those boundaries while also admitting **untimed publisher text** and accepted local MOSS drafts.

The existing video search path intentionally scans only complete published Tracks. That is insufficient for the proposed default podcast model because a successful bounded `playback-lead` job may remain a local draft indefinitely.

Do not solve this by forcing bounded drafts into complete Track publication.

Instead, add a bounded/disposable **local podcast transcript search projection** derived from durable publisher documents and accepted MOSS cues. It may be rebuilt, and it is never transcript authority. Avoid making unified search deserialize every full MOSS Job/sparse hypothesis merely to find text.

Cross-tab invalidation for that projection must be explicit; current `MediaStore.putLocal()` notifications do not mark either legacy Video search revision flag.

Suggested result classes:

~~~text
episode-title
  -> /podcasts?episode=<EpisodeKey>

timed-transcript
  -> /podcasts?episode=<EpisodeKey>&time=<seconds>&transcript=<document-or-draft-id>

untimed-publisher-transcript
  -> /podcasts?episode=<EpisodeKey>&transcript=<document-id>
~~~

Do not fabricate `time=0` or another timestamp merely to reuse the video search-row shape.

A timed search hit is valid only while its transcript timing remains admitted for the current rendition. If reopening reveals changed/unknown rendition evidence, open the logical episode/transcript and withhold the stale automatic seek rather than applying an old timestamp to new audio.

Do not use a mutable enclosure/CDN URL as the route identity. `EpisodeKey` is the route identity; a current publisher media candidate is resolved only when opening playback.

If podcast transcript data is local-only in MVP, search it locally. Do not force backend sync just to appear in search. A saved catalog/publisher transcript may be searchable even when the episode's audio is currently unavailable.

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

Likewise, do not add an Android-native arbitrary HTTP range bridge merely to escape browser CORS in v1. That would expand the trusted native/DOM bridge into a general network capability, create separate SSRF/private-network/security policy, and make Android support a different podcast universe from web. It can be evaluated later as an explicit platform capability.

The first shared catalog should use the web-readable source baseline for MOSS on both platforms; native Expo Audio may still play a broader set of URLs than the DOM ASR layer can transcribe.

## 14. Proposed implementation phases

### Phase 0 — provider and deployment qualification harness

No product UI yet.

Build a small qualification harness for real publisher media URLs:

- normal RSS enclosure and any considered publisher alternate-enclosure URL
- actual target environments: exported web in both supported browser engines plus packaged Android DOM/WebView
- document COOP/COEP headers and `crossOriginIsolated`
- playback with each candidate request mode (`no-cors` default and anonymous CORS where supported)
- browser CORS GET for ASR
- redirect behavior and request-Origin/redirect-taint evidence
- single Range 0-0 and another bounded range
- same-session runtime-cache fixed-range stability
- fresh-context/reload reopen stability
- exact-size evidence
- playback/ASR duration and rendition coherence
- Mediabunny request count, metadata and audio track decode
- 16 kHz PCM production
- cancellation
- validator stability
- publisher transcript availability/format/timeline behavior
- service-worker pass-through behavior
- repeated-request/ad/rendition stability
- playback-before-ASR and ASR-before-playback request order

For web qualification, use Playwright/network instrumentation as diagnostic tooling, not product authority. Record the real media-element and `fetch()` request chains. When an overlapping media-element Range response body is available to the harness, hash it and compare it with the corresponding ByteSource Range. If the browser tooling cannot safely read that streaming response, compare final/session URLs, validators, sizes and durations and leave `playbackAsrCoherence` unknown rather than guessing.

Produce a machine-readable report.

Do not make ordinary PR CI depend on external podcast hosts.

A manual or scheduled qualification workflow can test live providers. Normal CI should use local fixture origins that emulate their important response patterns.

The local browser matrix should include at least:

~~~text
Manabi origin
  -> host A 206 with ACAO: *
  -> host A 302 ACAO:* -> host B 206 ACAO:*
  -> host A 302 missing ACAO -> host B good
  -> host A 302 explicit ACAO -> host B response under redirect-tainted Origin
  -> multi-origin analytics-prefix chain
  -> same chain with one broken intermediate hop
  -> anonymous-CORS audio-element playback + JS Range fetch
  -> no-CORS audio playback before JS Range fetch
  -> JS Range fetch before no-CORS audio playback
  -> server that varies ACAO by Origin with Vary: Origin
  -> same server incorrectly missing Vary: Origin
  -> dynamic server keyed differently by Sec-Fetch-Dest/audio versus fetch
  -> session-stable but fresh-context-different rendition
~~~

Run the browser redirect/cache matrix in Chromium and WebKit. Android WebView gets its own packaged-host gate for the production source modes.

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

### Phase 2 — episode/catalog domain and feature-capability split

Add:

- safe parser/catalog types and curated Japanese manifest
- stable ShowKey/EpisodeKey rules
- separate Podcasts product flag
- derived shared MOSS/media capability
- MOSS asset packaging when Video **or** Podcasts needs it
- enabled-source composition for Library section tabs and unified search

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

### Phase 4 — bounded local MOSS captions

Connect the remote source to the existing queue only after adding a podcast-safe coverage policy.

Implement:

- explicit enable/generate action
- remote provisional/rendition session
- `playback-lead` durable coverage policy
- playhead priority
- park/re-admit behavior when lead is satisfied/exhausted
- audio proofs
- cancel/resume/switch behavior
- shared MOSS model cache
- local accepted-draft study without pretending it is a portable Track

Portable full-byte verification/publication is a separate gate. If exact `ContentKey` publication is selected, start/finish the lazy full hash only when that publication is actually required.

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
- one contiguous Range remains non-preflighted
- multiple-range request is never used by production ByteSource
- controlled redirect A -> B succeeds only under the expected CORS behavior in each target browser
- missing ACAO on an intermediate redirect is diagnosed
- redirect-tainted Origin behavior is recorded, including wildcard versus explicit ACAO
- playback-first then ASR-fetch cache ordering
- ASR-fetch first then playback cache ordering
- origin-varying CORS response with correct `Vary: Origin`
- origin-varying response without `Vary: Origin` cannot be assumed safe from cache-mode poisoning
- dynamic fixture serving different bytes for `Sec-Fetch-Dest: audio` versus JS fetch is detected as playback/ASR mismatch
- session-stable/fresh-context-different fixture derives MOSS_SESSION_ONLY rather than UNSTABLE_SESSION
- server ignores Range and returns 200
- range body too short
- range body too long
- observed non-identity Content-Encoding / transformed range behavior is rejected unless exact random-access semantics are separately proven
- missing/zero/invalid declared source size
- boundary probe `bytes=N-1-N` returns exactly one byte for exact declared size
- boundary probe returns two bytes when declared size is too small
- boundary probe returns 416 when declared size is too large
- boundary probe returns 200 because Range was ignored
- exposed Content-Range contradicts declared size
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
- enabling local captions prepares MOSS only after valid PCM exists
- current playhead is first sparse priority
- existing v3 jobs retain their historical whole-media scheduling semantics
- the new podcast job version persists coverage policy explicitly
- playback-lead mode stops inference scheduling after its bounded high-water lead is satisfied
- lead satisfaction is not misreported as user cancellation/failure
- bounded warm grace avoids pathological unload/reload churn without retaining the model indefinitely
- origin Web Lock remains held for exactly the lifetime of any resident shared MOSS runtime
- reload/reopen never auto-starts MOSS from a saved lead job
- seeking into uncovered audio during an explicitly active local-caption session re-admits the same durable job and prioritizes the new region
- whole-episode work does not begin unless full mode was explicitly selected
- cancel preserves accepted windows
- route switch pauses owned job
- source validator/fingerprint change pauses/fails safely
- provisional transcript cannot publish as an existing portable Track before verified ContentKey
- audio proof mismatch prevents reuse
- full-hash/publication failure does not destroy accepted device-local work
- model remains one shared cache/runtime
- another tab cannot run a competing MOSS batch

### 15.4 UI/browser tests

Cover:

- Books / Videos / Podcasts navigation
- browser back/forward
- responsive episode list
- accessible show/episode names
- foreground audio controls
- keyboard ownership
- screen-reader names
- publisher transcript versus local MOSS source labeling
- plain publisher transcript never fabricates timed seek behavior
- dynamically unqualified publisher captions do not auto-follow a personalized rendition
- transcript open/close
- follow
- line navigation
- pause-after-line
- model-download disclosure
- bounded lead generation/progress/park/resume
- cancel/resume
- Reader typography/background
- no video-only overlay controls
- deep-link to episode/time only when a real timed cue exists
- route replacement while reads/inference are pending
- ordinary no-COEP playback and the actual qualified COEP deployment mode

### 15.5 Search tests

Assert:

- title search is local
- transcript search uses only already-saved publisher/accepted-local-MOSS text
- bounded local MOSS drafts are searchable without pretending they are complete Tracks
- the search projection can be rebuilt from durable authority and does not become authority itself
- search does not deserialize every full sparse Job/hypothesis just to find text
- search never requests enclosure bytes
- search never downloads model
- timed hits validate episode/transcript/time against current rendition evidence
- changed rendition evidence withholds a stale automatic seek
- untimed publisher transcript hits open the episode/transcript without inventing a timestamp
- stale/missing episode does not break the whole search route

### 15.6 External provider qualification

Maintain a small live smoke list across candidate hosts. A passing hostname is not sufficient; qualify the publisher enclosure shape actually used by the catalog.

For each provider/episode, record:

- date checked
- feed URL and exact publisher-declared media URL
- browser engine / app origin / Android WebView version
- document COOP/COEP and `crossOriginIsolated`
- playback request mode
- redirect chain and final URL for diagnostics
- request `Origin`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest` and Range where tooling exposes them
- response ACAO, `Vary`, CORP, exposed-header policy, Content-Encoding, ETag and range headers where observable
- JS body readability
- 206 Range result and exact requested body length
- exact-size evidence
- Mediabunny parse/decode result
- same-session fixed-range digest stability under runtime cache behavior
- fresh-context/reload evidence separately from same-session evidence
- playback/ASR duration/session/PCM coherence evidence
- number of HTTP requests/redirects required for probe, metadata, bounded decode and optional verification
- whether repeated ranges appear to trigger materially different ad/personalized renditions
- official `podcast:transcript` availability/CORS and whether it is timed enough for study
- any relevant provider terms reviewed

Do not persist full signed/sessionized final CDN URLs in long-lived reports when a redacted origin/path class is sufficient.

Do not turn one passing show into an eternal hostname allowlist.

## 16. Security/privacy checklist

- No podcast audio upload for ASR.
- No proxy/rehost in v1.
- `credentials: 'omit'` for third-party audio/feed requests; do not depend on third-party cookies for rendition coherence.
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
- Treat final redirect URL as sensitive metadata if it contains tracking/session identifiers.
- Do not log full signed query strings in ordinary telemetry.
- Arbitrary user-entered feed/media URLs remain deferred; before adding them, separately review localhost/private-network redirect/probing risks rather than assuming the curated-source trust model applies.

## 17. Offline behavior

Initial expectation:

- the small curated show seed may be bundled with the application
- the last fully validated episode manifest is persisted as local data after a successful static-manifest fetch
- saved transcript text remains readable/searchable
- logical `EpisodeKey` resume remains local
- remote episode audio is unavailable offline unless the user agent/platform independently retained usable network cache
- Manabi does not promise an offline MP3 download

An explicit "download episode" feature is out of scope and has different storage/licensing implications.

The current Reader service worker already passes through Range and unrelated-origin requests and excludes public audio from required shell assets. Preserve that behavior; add tests rather than a new audio caching path.

Also avoid accidentally turning a potentially large/changing podcast episode manifest into a mandatory shell install dependency. Current public JSON is otherwise eligible as a required public shell asset. Either keep the current episode manifest outside the packaged shell or add an explicit optional/lazy classification with regression tests.

## 18. Performance, bandwidth and publisher-request expectations

Opening an episode should consume only metadata and ordinary playback demand.

Range count matters in addition to byte count. Podcast hosts and ad systems may observe each request, so dozens of tiny reads are not an acceptable implementation merely because the aggregate bytes are small. Reuse/coalesce Mediabunny reads, honor the existing 4 MiB hard range budget, and measure the real request graph per provider.

The current Mediabunny `network` prefetch profile is explicitly designed to reduce read-call count in high-latency sources. Keep that adapter path and measure it; do not replace it with hand-written MP3 seeking unless a real qualification failure requires it.

MOSS throughput is a separate cost. Current repository evidence does not establish realtime v7 podcast transcription on representative devices. The product must remain useful when local captions build slower than playback, and playback-lead mode must stop work when its bounded target is satisfied.

**Generate local captions** may cause:

1. sparse decode/range requests near current position
2. MOSS model download on first use if absent

Only a later **portable publication / exact-content verification** path may additionally cause:

3. full-episode byte verification/hashing for an exact `ContentKey`

The UI must not conflate recognition progress with optional byte-verification progress.

If exact verification runs, do not run an independent high-concurrency full hash beside aggressive Mediabunny prefetch. One rendition session should budget/coalesce requests so playback-lead transcription remains responsive.

A later identity protocol could remove the full hash requirement, but only after replacing it with an equally explicit rendition identity model.

## 19. Acceptance criteria for the first production-capable slice

A first shippable Podcasts experiment should satisfy all of the following:

- Feature is separately gated.
- Books / Videos / Podcasts category navigation is coherent.
- Catalog is Japanese-first and curated.
- Every episode offered for timed MOSS passed actual browser body-read/range/decode, same-session stability and playback/ASR-coherence qualification under the deployed cross-origin-isolation mode.
- Reopen-stable episodes may restore timed captions after bounded evidence validation; session-only episodes must revalidate or demote old timing rather than pretending the new rendition is identical.
- Publisher-provided transcripts are preferred when safely usable; timed follow/replay is enabled only when their timeline is qualified for the delivered rendition.
- Audio comes from a publisher-declared enclosure or qualified publisher-declared alternate enclosure; no Manabi audio proxy/rehost.
- Opening an episode does not download MOSS.
- Opening an episode does not full-hash the selected media rendition.
- Playback begins independently of local transcript generation.
- **Generate local captions** is explicit; whole-episode completion is not implied.
- MOSS uses the existing verified model/runtime/cache.
- MOSS receives bounded 16 kHz mono PCM through MediaPipeline.
- Remote verification does not explode into 1 MiB network-range request fan-out.
- Repeated remote reads cannot silently mix different ad/personalized renditions into one transcript.
- Sparse inference prioritizes the current playhead.
- Default podcast inference is bounded playback-lead work and does not silently fill the full episode.
- Satisfying the lead stops inference scheduling; any warm model retention is bounded, explicitly owned and eventually released.
- In-progress work survives supported pause/reload flows without pretending to be a verified portable Track.
- Portable transcript publication is bound to exact ContentKey, or a separately reviewed replacement identity protocol.
- Changed remote bytes cannot silently reuse a timed transcript.
- Search never downloads podcast media or starts MOSS.
- Untimed transcript search never fabricates timestamps.
- Feed text cannot inject HTML/script/entity-expansion/resource-fetch behavior.
- No existing Video behavior is regressed.
- No existing video_* sync record is silently reinterpreted as podcast data.
- A Podcasts-only build packages MOSS correctly without enabling Videos.
- A Videos-only build keeps its current behavior.
- A build with neither feature does not package MOSS merely because shared media code exists.
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
- silent full-episode transcription as the default Generate behavior
- background inference after browser/app suspension without a real platform design
- enabling Android background playback/foreground-service permissions as an incidental side effect of the first podcast slice
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
1. Is the first MOSS release intentionally local-draft-only, avoiding full-byte identity until portable publication is requested?
2. If portable publication is required, is lazy full-byte hashing acceptable after measuring duplicate requests, bandwidth and main-thread cost?
3. What evidence threshold promotes a host from MOSS_SESSION to MOSS_REOPEN, and how long may that qualification remain cached before re-probing?
4. Which remote validator signals are actually exposed by qualified hosts?
5. How should fixed-range fingerprints and decoded audio proofs divide responsibility?
6. How should dynamic-ad renditions be detected on reopen?
7. Which audio-proof subset is sufficient to reject stale transcript reuse cheaply?
8. What exact `ShowKey`/`EpisodeKey` fallback and feed-redirect alias rules prevent duplicate logical episodes?

### Storage/sync
9. Are podcast transcripts local-only initially?
10. Is logical episode resume local-only or synced?
11. Do we add podcast-specific remote record kinds later, or plan a separate generic media-protocol migration?
12. How are logical episode IDs mapped to one or more byte renditions?
13. Should publisher transcript resources remain a separate episode-domain object until rendition binding?
14. If publisher transcripts become durable Tracks, what versioned origin/provenance change replaces the current strict three-value Track origin?

### Catalog
15. Checked-in source list + generated static manifest, direct client RSS, or another hybrid?
16. What is the minimum initial native-Japanese catalog?
17. What does "native" mean for catalog tagging?
18. How are dead/moved feeds and stable ShowKey aliases handled?
19. Which shows expose usable `podcast:transcript` resources?
20. Which publisher alternate enclosures materially improve CORS/range/codec support without changing editorial content?
21. Which feeds expose `podcast:license` metadata useful for internal review/testing?

### UX
22. Hide playback-only episodes or show them without local-caption capability?
23. What measured high-water/low-water caption lead should playback-lead mode target?
24. What bounded warm-model grace avoids load thrash without retaining 648 MB unnecessarily?
25. Should a separate "Transcribe full episode" action exist at all in v1?
26. Do we expose optional full-byte verification progress separately from recognition progress?
27. What should happen if the user seeks into an untranscribed region while MOSS is far behind?
28. Should a valid **timeline-compatible** publisher transcript suppress local MOSS by default?
29. How should a timed-but-rendition-uncertain publisher transcript be presented without implying exact seek alignment?

### Expo
30. Should Podcasts wait for Video transcript/player domain extraction, or perform that extraction as its first enabling refactor?
31. Should the shared playback port use Expo Audio on both platforms or Expo Audio on Android plus a DOM audio leaf on web?
32. What COOP/COEP policy is actually deployed for Reader web and packaged Android DOM, and how does that change media request mode?
33. What is the bounded Android DOM/media/ASR leaf?
34. Which exact shared screen/controller owns episode state?
35. What exact product flags and derived MOSS capability replace the current video-only gate without changing released defaults?
36. Should the first slice remain foreground-playback-only, preserving current `enableBackgroundPlayback: false`?
37. If background playback is later enabled, what lifecycle contract reconciles native playback with foreground-only/suspendable DOM MOSS work?

### Provider/legal
38. Which catalog/provider terms need explicit approval?
39. Can generated transcripts sync privately, or should v1 keep them on-device?
40. Which SoundCloud usage path, if any, is acceptable without relying on a restricted proprietary API?
41. Do repeated range/hash requests distort host analytics, downloads, dynamic-ad accounting or monetization enough to require provider-specific limits/exclusion?
42. Does using a publisher-declared alternate enclosure preserve the host's intended measurement/monetization path for that show?

## 22. Suggested first engineering PR sequence

Keep each implementation PR reviewable.

1. Provider/deployment qualification harness + docs only.
2. Generic ByteSource network/read-profile refactor + request-count tests.
3. Remote ByteSource/RenditionSession + local fixture tests.
4. Podcast identity/catalog/parser domain + product/MOSS feature-capability split.
5. Shared transcript/player seam extraction with zero intended Video behavior changes.
6. Podcasts route/category + logical EpisodeKey resume + foreground playback only.
7. Publisher transcript display/search, with timed follow gated by timeline qualification.
8. New versioned MOSS coverage-policy/job state + `playback-lead` scheduler + local audio-only fixture tests.
9. Remote bounded local MOSS draft + rendition/audio-proof recovery.
10. Optional exact ContentKey/full-publication path only after request/bandwidth measurement.
11. Podcast transcript study UI and unified search integration.
12. Live-provider qualification workflow/report.
13. Optional background playback as a separately reviewed native/config capability.
14. Optional sync/generic media-protocol design as a separately reviewed change.

Do not begin by renaming every media/video type.

## 23. Handoff summary

The current Expo branch is unusually well-positioned for Podcasts because the hard ASR/media primitives are already beneath VideoWorkspace. The project should reuse those primitives rather than reimplementing MOSS or decoding.

The main blockers are:

1. remote CORS/range, COEP and request-amplification qualification,
2. logical episode versus delivered-rendition identity,
3. dynamic-ad and publisher-transcript timeline stability,
4. the existing sparse scheduler's whole-media completion behavior,
5. video-specific presentation entanglement and current Expo Video parity gap,
6. provider/legal/analytics boundaries around repeated enclosure reads, transcription and transcript persistence.

The recommended MVP stays conservative:

- curated Japanese catalog
- original publisher enclosures
- publisher transcript resources first, with timed follow only when rendition-compatible
- publisher enclosure or explicitly declared/qualified alternate enclosure
- no proxy
- qualified CORS/range/COEP/stable-rendition sources only for MOSS
- immediate foreground audio playback
- explicit on-device MOSS fallback
- bounded playback-lead MOSS rather than silent whole-episode completion
- local draft first
- exact ContentKey only when existing portable Track publication actually requires it
- logical EpisodeKey resume separated from rendition-bound captions
- local-first persistence where sync semantics are unresolved
- no second media stack

This should be revised after Phase 0 measures real current Japanese podcast enclosures in Chromium and the supported Android WebView/DOM environment.
