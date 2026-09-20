/** @license MIT — component-script orchestration, not Svelte rendering tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const compiled = process.env.WHISPERSYNC_COMPILED
if (!compiled) throw new Error('Run node test/whispersync/run.mjs')
const source = process.env.WHISPERSYNC_COMPONENT_SOURCE || join(__dirname, '../../apps/web/src/lib/features/whispersync')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const drain = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const { emptySession } = require(join(compiled, 'persistence.js'))
const file = { name: 'book.mp3', size: 100, lastModified: 1 }
const savedSession = (extra = {}) => ({ ...emptySession(), audio: file, position: 10, ...extra })
const media = (time = 20) => ({ file, time, duration: 120, ready: true, paused: true, rate: 1 })

async function harness(options = {}) {
  let mount
  const timers = new Map(), saves = [], players = [], highlights = [], ranges = []
  const remove = deferred()
  const root = { isConnected: true, contains: () => true }
  const fakeIndex = { root, text: 'original passage', isCurrent: () => true, dispose() { this.disposals = (this.disposals || 0) + 1 } }
  const matched = options.matched || { promise: Promise.resolve([{ start: 0, end: 8, score: 1 }]) }
  class Store {
    load() { return options.load || Promise.resolve(options.session || savedSession()) }
    save(key, session) { const pending = deferred(); saves.push({ key, session, ...pending }); return pending.promise }
    remove() { return remove.promise }
    close() { return Promise.resolve() }
  }
  class Player {
    state = { time: 0, duration: 0, ready: false, paused: true, rate: 1 }
    constructor(environment, changed) { this.changed = changed; players.push(this) }
    get snapshot() { return { ...this.state } }
    setRate(rate) { this.state.rate = rate; this.changed(this.snapshot) }
    load(selected, resume) { this.loaded = { selected, resume } }
    clear() { this.state = { time: 0, duration: 0, ready: false, paused: true, rate: this.state.rate }; this.changed(this.snapshot) }
    setLoop() {}
    pause() {}
    dispose() { this.disposed = true }
  }
  class Highlight {
    supported = true
    set(range) { highlights.push(range) }
    clear() {}
  }
  let script = readFileSync(join(source, 'audiobook-panel.svelte'), 'utf8').match(/<script lang="ts">([^]*?)<\/script>/)[1]
  script = script.replace(/^  export let bookId: number$/m, '  let bookId: number = 1')
    .replace(/^  export let bookTitle: string$/m, "  let bookTitle: string = 'Book'")
    .replace(/^  export let /gm, '  let ')
    .replace(/^  \$:.*$/gm, '')
  // Svelte-derived declarations are explicitly evaluated by the harness when
  // needed. No Svelte compiler, DOM, binding or reactive scheduler is simulated.
  script += `
    let activeCue: Cue | undefined
    export const access = {
      inspect: () => ({ saved, ready, error, storageError, current, lastCue, hasMatched, matches, transcriptPage, approximate, index }),
      setMedia: (state: PlaybackState, notify = false) => {
        (player as any).state = state
        snapshot = state
        if (notify) (player as any).changed(state)
      },
      setPage: (value: number) => { transcriptPage = value },
      setCues: (value: Cue[]) => { cues = value; timeline = new CueTimeline(value); updateCurrent() },
      scheduleSave, save, restore, closeAudio, selectAudio, selectSubtitles, removeSaved, matchBook, cancelMatch,
      changeApproximate: typeof changeApproximate === 'function' ? changeApproximate : undefined,
      changeDelay, updateCurrent
    }
  `
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = {
    exports: {}, console, AbortController, DOMException, URL,
    document: { querySelector: () => root, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    window: { getSelection: () => null, addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn) => { const id = timers.size + 1; timers.set(id, fn); return id },
    clearTimeout: (id) => timers.delete(id),
    require(id) {
      if (id === 'svelte') return { onMount: (fn) => { mount = fn }, tick: () => Promise.resolve() }
      if (id === '$app/paths') return { base: '' }
      if (id.startsWith('$lib')) return {}
      const actual = require(join(compiled, id + '.js'))
      if (id === './persistence') return { ...actual, AudiobookSessionStore: Store }
      if (id === './player') return { ...actual, LocalAudioPlayer: Player }
      if (id === './matcher') return {
        ...actual, ReaderHighlight: Highlight,
        buildBookIndex: async () => fakeIndex,
        matchCues: () => matched.promise,
        rangeForMatch: () => { const range = {}; ranges.push(range); return range }
      }
      return actual
    }
  }
  vm.runInNewContext(code, context, { filename: 'audiobook-panel.script.js' })
  const access = context.exports.access
  const cleanup = mount()
  await drain()
  return { ...access, cleanup, saves, players, highlights, ranges, timers, remove, fakeIndex, root }
}

test('opening and closing an untouched panel never overwrites saved resume', async () => {
  const h = await harness()
  assert.equal(h.inspect().saved.position, 10)
  h.cleanup()
  await drain()
  assert.equal(h.saves.length, 0)
})
test('a failed initial read is not replaced by an empty session on cleanup', async () => {
  const h = await harness({ load: Promise.reject(new Error('temporary read failure')) })
  assert.ok(h.inspect().storageError)
  h.cleanup()
  await drain()
  assert.equal(h.saves.length, 0)
})
test('subtitle parse failure preserves independently valid audio resume metadata', async () => {
  const h = await harness({ session: savedSession({ subtitleSource: 'invalid subtitles', subtitleName: 'bad.srt' }) })
  assert.equal(h.inspect().saved.position, 10)
  assert.ok(h.inspect().error)
  h.cleanup()
})
test('older write acknowledgements cannot replace a newer local checkpoint', async () => {
  const h = await harness()
  h.setMedia(media(20))
  h.scheduleSave(true)
  h.setMedia(media(30))
  h.scheduleSave(true)
  assert.equal(h.inspect().saved.position, 30)
  h.saves[0].resolve()
  await drain()
  assert.equal(h.inspect().saved.position, 30)
  h.saves[1].resolve()
  await drain()
  assert.equal(h.inspect().saved.position, 30)
  h.cleanup()
})
test('reselecting the same file resumes at the live position, not the previous save', async () => {
  const h = await harness()
  h.setMedia(media(27))
  h.selectAudio({ currentTarget: { files: [file], value: 'file' } })
  assert.equal(h.players[0].loaded.resume.position, 27)
  h.cleanup()
})
test('close audio retains the latest checkpoint before clearing the media element', async () => {
  const h = await harness()
  h.setMedia(media(39))
  h.closeAudio()
  assert.equal(h.inspect().saved.position, 39)
  assert.equal(h.players[0].state.file, undefined)
  h.cleanup()
})
test('reset clears transcript pagination and stale save failures cannot undo it', async () => {
  const h = await harness()
  h.setPage(4)
  h.setMedia(media(39))
  h.scheduleSave(true)
  const removing = h.removeSaved()
  h.saves[0].reject(new Error('old failure'))
  h.remove.resolve()
  await removing
  await drain()
  assert.equal(h.inspect().transcriptPage, 0)
  assert.equal(h.inspect().saved.position, 0)
  assert.equal(h.inspect().storageError, '')
  h.cleanup()
})
test('matching completion refreshes highlighting even when playback stays in the same cue', async () => {
  const matched = deferred()
  const h = await harness({ matched })
  h.setCues([{ id: 0, start: 0, end: 50, text: 'original passage' }])
  h.setMedia(media(20))
  const matching = h.matchBook()
  await drain()
  h.updateCurrent()
  matched.resolve([{ start: 0, end: 8, score: 1 }])
  await matching
  assert.equal(h.highlights.length, 1)
  h.cleanup()
})
test('cancelled matching releases an unpublished DOM index', async () => {
  const matched = deferred()
  const h = await harness({ matched })
  h.setCues([{ id: 0, start: 0, end: 50, text: 'original passage' }])
  const matching = h.matchBook()
  await drain()
  h.cancelMatch()
  matched.resolve([{ start: 0, end: 8, score: 1 }])
  await matching
  assert.equal(h.inspect().hasMatched, false)
  assert.equal(h.fakeIndex.disposals, 1)
  h.cleanup()
})
test('changing approximate matching policy invalidates prior guesses', async () => {
  const h = await harness()
  h.setCues([{ id: 0, start: 0, end: 50, text: 'original passage' }])
  await h.matchBook()
  assert.equal(h.inspect().hasMatched, true)
  h.changeApproximate({ currentTarget: { checked: false } })
  assert.equal(h.inspect().hasMatched, false)
  assert.equal(h.inspect().matches.length, 0)
  assert.equal(h.fakeIndex.disposals, 1)
  h.cleanup()
})
