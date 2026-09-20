<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { base } from '$app/paths'
  import * as Sheet from '$lib/components/ui/sheet'
  import type { BookmarkManager } from '$lib/components/book-reader/types'
  import { CueTimeline, MAX_SUBTITLE_BYTES, parseSubtitles, type Cue } from './subtitles'
  import { LocalAudioPlayer, audioIdentity, type PlaybackState } from './player'
  import { AudiobookSessionStore, captureSession, emptySession, sessionKey, type AudiobookSession } from './persistence'
  import { buildBookIndex, matchCues, offsetForSelection, rangeForMatch, ReaderHighlight, type BookIndex, type CueMatch } from './matcher'
  import { toTimeString } from './upstream'

  export let open = false
  export let bookId: number
  export let bookTitle: string
  export let htmlContent: string
  export let layoutKey: string | number
  export let bookmarkManager: BookmarkManager | undefined
  export let onFollow: () => void
  export let returnFocus: () => void
  export let selectionHint: Range | undefined = undefined

  let mounted = false
  let alive = false
  let ready = false
  let audioHost: HTMLDivElement
  let player: LocalAudioPlayer
  let store: AudiobookSessionStore
  let highlight: ReaderHighlight
  let snapshot: PlaybackState = { time: 0, duration: 0, ready: false, paused: true, rate: 1 }
  let saved = emptySession()
  let subtitleSource = ''
  let subtitleName = ''
  let cues: readonly Cue[] = []
  let timeline = new CueTimeline([])
  let current = -1
  let delay = 0
  let follow = false
  let approximate = false
  let subtitleLoading = false
  let subtitleGeneration = 0
  let error = ''
  let storageError = ''
  let matchError = ''
  let matching = false
  let matchProgress = 0
  let matchController: AbortController | undefined
  let index: BookIndex | undefined
  let matches: (CueMatch | undefined)[] = []
  let matchedCount = 0
  let approximateCount = 0
  let highlightSupported = true
  let lastCue = -1
  let lastHtml = htmlContent
  let lastLayout = layoutKey
  let hasMatched = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let lastSave = 0
  let saveGeneration = 0
  let dirty = false
  let clearing = false
  let confirmClear = false
  let transcriptPage = 0
  const pageSize = 30
  const key = sessionKey(bookId, bookTitle)

  $: pageCount = Math.max(1, Math.ceil(cues.length / pageSize))
  $: visibleCues = cues.slice(transcriptPage * pageSize, (transcriptPage + 1) * pageSize)
  $: activeCue = current >= 0 ? cues[current] : undefined
  $: if (mounted) contentChanged(htmlContent, layoutKey)

  onMount(() => {
    alive = true
    highlight = new ReaderHighlight(window)
    highlightSupported = highlight.supported
    store = new AudiobookSessionStore()
    player = new LocalAudioPlayer({
      createAudio: () => document.createElement('audio'),
      createURL: (file) => URL.createObjectURL(file),
      revokeURL: (url) => URL.revokeObjectURL(url),
      attach: (audio) => audio ? audioHost.replaceChildren(audio) : audioHost.replaceChildren(),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id)
    }, (state) => {
      if (!alive) return
      const justPaused = !snapshot.paused && state.paused
      if (snapshot.paused && !state.paused) lastCue = -1
      snapshot = state
      updateCurrent()
      if (ready && !clearing && state.file && state.ready) scheduleSave(justPaused)
    })
    mounted = true
    void restore()
    const flush = () => {
      if (!ready || clearing) return
      if (player.snapshot.file && player.snapshot.ready) scheduleSave(true)
      else void save()
    }
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      // Capture the last position before disposal. A queued IDB transaction is
      // best-effort on page termination; periodic checkpoints are also written.
      flush()
      alive = false
      mounted = false
      subtitleGeneration += 1
      matchController?.abort()
      if (saveTimer !== undefined) clearTimeout(saveTimer)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
      highlight.clear()
      index?.dispose()
      index = undefined
      player.dispose()
      void store.close()
    }
  })

  async function restore() {
    try {
      const data = await store.load(key)
      if (!alive) return
      if (data) {
        saved = data
        subtitleSource = data.subtitleSource
        subtitleName = data.subtitleName
        try {
          timeline = new CueTimeline(data.subtitleSource ? parseSubtitles(data.subtitleSource) : [])
          cues = timeline.cues
        } catch {
          error = 'Saved subtitles could not be parsed. Select a valid subtitle file; the saved audio resume position has been retained.'
        }
        delay = data.delay
        follow = data.follow
        approximate = data.approximate
        player.setRate(data.rate)
      }
    } catch {
      if (alive) storageError = 'Saved audiobook data could not be loaded. Playback still works; use “Remove saved audiobook data” to reset this book if needed.'
    } finally {
      if (alive) ready = true
    }
  }

  function sessionSnapshot(): AudiobookSession {
    // Reopening just the panel must not erase the previous file's resume point.
    return captureSession({ subtitleName, subtitleSource, delay, follow, approximate }, player.snapshot, saved)
  }
  async function save() {
    if (!ready || clearing || !dirty) return
    if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined }
    let data: AudiobookSession
    try { data = sessionSnapshot() } catch {
      if (alive) storageError = 'Audiobook settings could not be saved. Check the selected file and timing values.'
      return
    }
    // The latest checkpoint is local state, not the completion of an older IDB
    // write. Closing/reselecting a file must see it even while storage is slow.
    saved = data
    dirty = false
    const generation = ++saveGeneration
    lastSave = Date.now()
    try {
      await store.save(key, data)
      if (alive && generation === saveGeneration && !clearing) storageError = ''
    } catch {
      if (alive && generation === saveGeneration && !clearing) {
        dirty = true
        storageError = 'Audiobook changes could not be saved locally. Keep a copy of your subtitles; playback remains available.'
      }
    }
  }
  function scheduleSave(immediate = false) {
    if (!ready || clearing) return
    dirty = true
    if (immediate || Date.now() - lastSave >= 5000) { void save(); return }
    if (saveTimer === undefined) saveTimer = setTimeout(() => { saveTimer = undefined; void save() }, 5000)
  }

  function closeAudio() {
    if (player.snapshot.file && player.snapshot.ready) scheduleSave(true)
    player.clear()
  }

  function selectAudio(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !alive || !ready || clearing) return
    error = ''
    if (!file.size) { error = 'Choose a non-empty audio file.'; return }
    if (player.snapshot.file && player.snapshot.ready) {
      try { saved = sessionSnapshot() } catch { /* Keep the previous valid checkpoint. */ }
    }
    player.load(file, saved.audio ? { identity: audioIdentity(saved.audio), position: saved.position } : undefined)
  }

  async function selectSubtitles(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !alive || !ready || clearing) return
    const generation = ++subtitleGeneration
    subtitleLoading = true
    error = ''
    try {
      if (file.size > MAX_SUBTITLE_BYTES) throw new Error('Subtitle file exceeds the 5 MiB limit')
      const source = await file.text()
      if (!alive || generation !== subtitleGeneration) return
      const parsed = parseSubtitles(source)
      // Commit only after successful validation, retaining the old captions on error.
      invalidateMatches()
      player.setLoop()
      subtitleSource = source
      subtitleName = file.name
      timeline = new CueTimeline(parsed)
      cues = timeline.cues
      transcriptPage = 0
      lastCue = -1
      updateCurrent()
      scheduleSave(true)
    } catch (cause) {
      if (alive && generation === subtitleGeneration) error = cause instanceof Error ? cause.message : 'The subtitle file could not be read.'
    } finally {
      if (alive && generation === subtitleGeneration) subtitleLoading = false
    }
  }

  function cancelMatch() {
    matchController?.abort()
    matchController = undefined
    matching = false
  }
  function invalidateMatches(message = '') {
    cancelMatch()
    highlight?.clear()
    index?.dispose()
    index = undefined
    matches = []
    hasMatched = false
    matchedCount = 0
    approximateCount = 0
    lastCue = -1
    matchError = message
  }

  async function matchBook() {
    if (!ready || clearing || !cues.length) return
    invalidateMatches()
    const controller = new AbortController()
    matchController = controller
    matching = true
    matchProgress = 0
    const currentCues = cues
    const selection = window.getSelection()
    const selected = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : undefined
    const activeRoot = document.querySelector<HTMLElement>('.book-content')
    const hint = (selected && activeRoot?.contains(selected.startContainer) ? selected : selectionHint)?.cloneRange()
    let built: BookIndex | undefined
    try {
      await tick()
      if (!alive || controller.signal.aborted) return
      const root = document.querySelector<HTMLElement>('.book-content')
      if (!root) throw new Error('Book content is not ready. Try matching again after it finishes loading.')
      built = await buildBookIndex(root, controller.signal, () => {
        if (alive && (matchController === controller || index === built)) {
          invalidateMatches('The book text changed. Select “Match book” to rebuild its locations.')
        }
      })
      const start = hint && root.contains(hint.startContainer) ? offsetForSelection(built, hint) : undefined
      const result = await matchCues(built.text, currentCues, {
        signal: controller.signal, start, approximate,
        onProgress: (processed, total) => { if (alive && matchController === controller) matchProgress = Math.round(processed * 100 / total) }
      })
      if (!alive || controller.signal.aborted || matchController !== controller || root !== document.querySelector('.book-content') || !built.isCurrent()) return
      index = built
      matches = result
      matchedCount = result.filter(Boolean).length
      approximateCount = result.filter((match) => match?.approximate).length
      hasMatched = true
      // Playback can advance while matching yields. Refresh even within a cue.
      lastCue = -1
      updateCurrent()
    } catch (cause) {
      if (alive && matchController === controller && !controller.signal.aborted) {
        matchError = cause instanceof Error ? cause.message : 'Matching failed.'
      }
    } finally {
      if (built && index !== built) built.dispose()
      if (alive && matchController === controller) { matching = false; matchController = undefined }
    }
  }

  function contentChanged(html: string, layout: string | number) {
    if (html === lastHtml && layout === lastLayout) return
    lastHtml = html
    lastLayout = layout
    invalidateMatches(hasMatched || matching ? 'The reader layout changed. Select “Match book” to rebuild highlighting for this layout.' : '')
  }

  function updateCurrent() {
    current = snapshot.file ? timeline.at(snapshot.time, delay) : -1
    if (current === lastCue) return
    lastCue = current
    const match = matches[current]
    if (!match || !index) { highlight?.clear(); return }
    const range = rangeForMatch(index, match)
    highlight.set(range)
    if (range && follow && !snapshot.paused) navigateToRange(range)
  }
  function navigateToRange(range: Range) {
    if (!bookmarkManager) return
    const bookmark = bookmarkManager.formatBookmarkDataByRange(bookId, range)
    if (bookmark) { onFollow(); bookmarkManager.scrollToBookmark(bookmark) }
  }
  function showInBook(cueIndex: number) {
    if (!index || !matches[cueIndex]) return
    const range = rangeForMatch(index, matches[cueIndex]!)
    if (range) { open = false; navigateToRange(range) }
  }
  function canPlayCue(cue: Cue) {
    return snapshot.ready && cue.end + delay > 0 && cue.start + delay < snapshot.duration
  }
  function selectCue(cueIndex: number, play = false) {
    const cue = cues[cueIndex]
    if (!cue || !canPlayCue(cue)) return
    player.setLoop()
    player.seek(cue.start + delay)
    const match = matches[cueIndex]
    const range = index && match ? rangeForMatch(index, match) : undefined
    if (range) navigateToRange(range)
    if (play) void player.play()
  }
  function moveCue(direction: -1 | 1) {
    selectCue(timeline.adjacent(snapshot.time, direction, delay))
  }
  function toggleLoop() {
    if (snapshot.loop) player.setLoop()
    else if (activeCue) { player.setLoop(activeCue.start + delay, activeCue.end + delay); void player.play() }
  }
  function changeDelay(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const number = input.valueAsNumber
    if (!Number.isFinite(number) || number < -3600 || number > 3600) { input.value = String(delay); return }
    delay = number
    player.setLoop()
    lastCue = -1
    updateCurrent()
    scheduleSave(true)
  }
  function changeFollow(event: Event) {
    follow = (event.currentTarget as HTMLInputElement).checked
    lastCue = -1
    updateCurrent()
    scheduleSave(true)
  }
  function changeApproximate(event: Event) {
    approximate = (event.currentTarget as HTMLInputElement).checked
    invalidateMatches('Matching preferences changed. Select “Match book” to rebuild locations.')
    scheduleSave(true)
  }
  async function removeSaved() {
    if (!ready || clearing) return
    confirmClear = false
    clearing = true
    saveGeneration += 1
    dirty = false
    subtitleGeneration += 1
    subtitleLoading = false
    if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined }
    invalidateMatches()
    player.clear()
    transcriptPage = 0
    subtitleSource = ''
    subtitleName = ''
    cues = []
    timeline = new CueTimeline([])
    saved = emptySession()
    delay = 0
    follow = false
    approximate = false
    lastCue = -1
    current = -1
    error = ''
    matchError = ''
    try {
      await store.remove(key)
      if (alive) storageError = ''
    } catch {
      if (alive) storageError = 'Saved audiobook data could not be removed. Close other tabs and try again.'
    } finally {
      if (alive) { player.setRate(1); clearing = false }
    }
  }
</script>

<!-- This host remains mounted when the Sheet closes. No audio copy or upload. -->
<div class="audio-bar" class:inactive={!snapshot.file} data-ui-overlay="audiobook-controls">
  <div class="audio-heading">
    <button type="button" on:click={() => { open = true }}>Audiobook</button>
    <span class="audio-title" title={snapshot.file?.name}>{snapshot.file?.name}</span>
    <button type="button" on:click={() => player?.pause()} disabled={snapshot.paused}>Pause</button>
    <button type="button" on:click={closeAudio} aria-label="Close audio playback">×</button>
  </div>
  <div bind:this={audioHost}></div>
  {#if activeCue}<p class="now-playing">{activeCue.text}</p>{/if}
  {#if snapshot.error}<p role="alert">{snapshot.error}</p>{/if}
</div>

<Sheet.Root bind:open>
  <Sheet.Content side="bottom" class="audiobook-sheet max-h-[85dvh] overflow-y-auto [writing-mode:horizontal-tb]" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus() }}>
    <Sheet.Title>Audiobook</Sheet.Title>
    <Sheet.Description>Listen alongside {bookTitle} using local audio and timed subtitles. Files are not uploaded.</Sheet.Description>
    <div class="panel" data-ui-overlay="audiobook-panel">
      {#if !ready}<p role="status">Loading saved audiobook settings…</p>{/if}
      <div class="file-fields">
        <label>Audio file
          <input type="file" accept="audio/*,.mp3,.m4a,.m4b,.ogg,.wav,.flac" disabled={!ready || clearing} on:change={selectAudio} />
        </label>
        <label>Subtitles (.srt or .vtt; .txt also accepted)
          <input type="file" accept=".srt,.vtt,.txt,text/vtt,application/x-subrip,text/plain" disabled={!ready || clearing} on:change={selectSubtitles} />
        </label>
      </div>
      <p class="hint">Select the same audio file again after reopening the book to resume. Audio is not stored; subtitles, settings, and position are saved only in this browser. Codec support depends on your browser.</p>
      {#if subtitleLoading}<p role="status">Reading subtitles…</p>{/if}
      {#if subtitleName}<p>{subtitleName} · {cues.length.toLocaleString()} cues</p>{/if}
      {#if error}<p role="alert">{error}</p>{/if}
      {#if storageError}<p role="status">{storageError}</p>{/if}
      {#if snapshot.error}<p role="alert">{snapshot.error}</p>{/if}
      {#if snapshot.file}
        <div class="actions">
          <button type="button" on:click={() => snapshot.paused ? void player.play() : player.pause()}>{snapshot.paused ? 'Play' : 'Pause'}</button>
          <button type="button" on:click={() => player.seek(snapshot.time - 10)}>−10 seconds</button>
          <button type="button" on:click={() => player.seek(snapshot.time + 10)}>+10 seconds</button>
          <label>Speed
            <input type="number" min="0.5" max="3" step="0.05" value={snapshot.rate} on:change={(event) => player.setRate(event.currentTarget.valueAsNumber)} />×
          </label>
          <span>{toTimeString(snapshot.time)} / {toTimeString(snapshot.duration)}</span>
        </div>
      {/if}
      {#if cues.length}
        <div class="actions">
          <button type="button" disabled={!snapshot.ready} on:click={() => moveCue(-1)}>Previous cue</button>
          <button type="button" disabled={!snapshot.ready || !activeCue} on:click={() => selectCue(current, true)}>Replay cue</button>
          <button type="button" disabled={!snapshot.ready} on:click={() => moveCue(1)}>Next cue</button>
          <button type="button" disabled={!snapshot.ready || (!activeCue && !snapshot.loop)} aria-pressed={!!snapshot.loop} on:click={toggleLoop}>{snapshot.loop ? 'Stop looping' : 'Loop cue'}</button>
        </div>
        <label>Subtitle delay (seconds)
          <input type="number" min="-3600" max="3600" step="0.1" value={delay} on:change={changeDelay} />
        </label>
        <p class="hint">Positive delay means the spoken audio comes later than the subtitle timestamp.</p>
        <div class="matching">
          <label><input type="checkbox" checked={follow} on:change={changeFollow} /> Follow matched text while playing</label>
          <label><input type="checkbox" checked={approximate} disabled={matching} on:change={changeApproximate} /> Allow approximate matches (review highlighted text)</label>
          <div class="actions">
            <button type="button" disabled={matching || subtitleLoading} on:click={matchBook}>Match book</button>
            {#if matching}<button type="button" on:click={cancelMatch}>Cancel</button><span role="status">{matchProgress}% processed</span>{/if}
            {#if hasMatched}<span role="status">{matchedCount} / {cues.length} matched{approximateCount ? ` (${approximateCount} approximate)` : ''}</span>{/if}
          </div>
          <p class="hint">Matching does not edit the book. For a chapter-only recording, select its starting text in the book first. Unmatched cues still play. After changing reader layout, match again.</p>
          {#if !highlightSupported}<p>Inline highlighting is unavailable in this browser. Transcript playback and matched-text navigation still work.</p>{/if}
          {#if matchError}<p role="status">{matchError}</p>{/if}
        </div>
        <section aria-label="Audiobook transcript">
          <div class="actions">
            <h3>Transcript</h3>
            <button type="button" disabled={current < 0} on:click={() => { transcriptPage = Math.floor(current / pageSize) }}>Show current cue</button>
            <button type="button" disabled={transcriptPage === 0} on:click={() => { transcriptPage -= 1 }}>Previous 30</button>
            <span>Page {transcriptPage + 1} / {pageCount}</span>
            <button type="button" disabled={transcriptPage + 1 >= pageCount} on:click={() => { transcriptPage += 1 }}>Next 30</button>
          </div>
          <ol start={transcriptPage * pageSize + 1}>
            {#each visibleCues as cue, offset (cue.id)}
              {@const cueIndex = transcriptPage * pageSize + offset}
              <li class:active={cueIndex === current}>
                <button type="button" disabled={!canPlayCue(cue)} aria-current={cueIndex === current ? 'true' : undefined} on:click={() => selectCue(cueIndex, true)}>
                  <time>{toTimeString(cue.start + delay)}</time> {cue.text}
                </button>
                {#if matches[cueIndex]}<button type="button" class="locate" on:click={() => showInBook(cueIndex)} aria-label={`Show cue ${cueIndex + 1} in book`}>{matches[cueIndex]!.approximate ? 'Approximate location' : 'Show in book'}</button>{/if}
              </li>
            {/each}
          </ol>
        </section>
      {/if}
      <div class="actions">
        <button type="button" disabled={!ready || clearing} on:click={() => { confirmClear = true }}>Remove saved audiobook data</button>
        {#if confirmClear}<span>Remove captions and resume position for this book?</span><button type="button" disabled={clearing} on:click={removeSaved}>Remove</button><button type="button" on:click={() => { confirmClear = false }}>Cancel</button>{/if}
      </div>
      <p class="credits">Adapted from <a href="https://github.com/4890A/ttu-whispersync" target="_blank" rel="noopener noreferrer">4890A/ttu-whispersync</a>, originally by <a href="https://github.com/Renji-XD/ttu-whispersync" target="_blank" rel="noopener noreferrer">Renji-XD</a>. <a href={`${base}/licenses/ttu-whispersync.txt`} target="_blank" rel="noopener noreferrer">MIT license</a>. This built-in player does not require their userscript or Anki.</p>
    </div>
  </Sheet.Content>
</Sheet.Root>

<style>
  .audio-bar { position: fixed; z-index: 20; inset-inline: 0.75rem; bottom: calc(2.25rem + env(safe-area-inset-bottom)); max-width: 42rem; margin-inline: auto; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.75rem; background: var(--background); color: var(--foreground); box-shadow: 0 2px 12px #0003; writing-mode: horizontal-tb; font-size: 0.875rem; line-height: 1.5; }
  .inactive { display: none; }
  .audio-heading, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .audio-heading { flex-wrap: nowrap; }
  .audio-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .now-playing { margin: 0.25rem 0 0; max-height: 4.5em; overflow-y: auto; white-space: pre-wrap; }
  .panel { display: grid; gap: 1rem; max-width: 60rem; margin-inline: auto; font-size: 0.9375rem; line-height: 1.6; }
  .file-fields { display: flex; flex-wrap: wrap; gap: 1rem; }
  .file-fields label { flex: 1; min-width: min(100%, 16rem); }
  .file-fields input { display: block; width: 100%; margin-top: 0.25rem; }
  .hint, .credits { font-size: 0.8125rem; opacity: 0.85; }
  .matching { display: grid; gap: 0.75rem; }
  button, input[type='number'] { border: 1px solid currentColor; border-radius: 0.375rem; padding: 0.3rem 0.6rem; min-height: 2.25rem; background: transparent; color: inherit; }
  input[type='checkbox'] { margin-inline-end: 0.4rem; }
  button { cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible, input:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  button[aria-pressed='true'], li.active { outline: 2px solid currentColor; outline-offset: 2px; }
  ol { display: grid; gap: 0.75rem; padding-inline-start: 2rem; margin-top: 0.75rem; }
  li > button:first-child { width: 100%; text-align: start; white-space: pre-wrap; overflow-wrap: anywhere; }
  time { font-variant-numeric: tabular-nums; opacity: 0.8; }
  .locate { font-size: 0.8rem; margin-top: 0.3rem; }
  a { text-decoration: underline; }
  :global(::highlight(manabi-whispersync)) { background-color: #f5cb5c88; color: inherit; }
</style>
