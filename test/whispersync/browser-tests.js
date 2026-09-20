/** @license MIT — loaded after a locally compiled browser harness bundle. */
window.runWhispersyncBrowserTests = async function ({ skipStorage = false } = {}) {
  const w = window.whispersync
  const results = []
  const indexes = new Set()
  const buildIndex = w.buildBookIndex
  w.buildBookIndex = async (...args) => { const index = await buildIndex(...args); indexes.add(index); return index }
  const assert = (condition, message = 'assertion failed') => { if (!condition) throw new Error(message) }
  const equal = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, passed: true }) }
    catch (error) { results.push({ name, passed: false, error: String(error), stack: error.stack }) }
    finally { for (const index of indexes) index.dispose?.(); indexes.clear() }
  }
  const root = document.createElement('article')
  document.body.append(root)
  const dom = (html) => { root.innerHTML = html; return root }
  const makeCue = (text) => ({ id: 0, start: 0, end: 2, text })
  await test('ruby pronunciation and hidden/metadata nodes are excluded', async () => {
    dom('<p>私は<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>です。</p><div hidden>HIDDEN</div><div aria-hidden="true">NO</div><style>body {color: red}</style>')
    const before = root.innerHTML
    const index = await w.buildBookIndex(root)
    equal(index.text, '私は漢字です')
    equal(root.innerHTML, before)
  })
  await test('indexing and highlight ranges never wrap/split/modify the book DOM', async () => {
    dom('<p id="paragraph">Hello <em>lovely</em> world</p>')
    const paragraph = root.firstChild, text = paragraph.firstChild, emphasis = paragraph.children[0]
    const before = root.innerHTML
    const mutations = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(root, { childList: true, characterData: true, attributes: true, subtree: true })
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('hello lovely world')])
    const range = w.rangeForMatch(index, match)
    equal(range.toString(), 'Hello lovely world')
    const highlight = new w.ReaderHighlight(window)
    highlight.set(range)
    highlight.clear()
    await new Promise((resolve) => setTimeout(resolve, 0))
    equal(root.innerHTML, before)
    assert(paragraph.firstChild === text && paragraph.children[0] === emphasis)
    equal(mutations.length, 0)
    observer.disconnect()
  })
  await test('UTF-16 offsets preserve supplementary characters and grapheme boundaries', async () => {
    dom('<p>前𠮷野家ＡＢＣ</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('𠮷野家ABC')])
    const range = w.rangeForMatch(index, match)
    equal(range.toString(), '𠮷野家ＡＢＣ')
    equal(range.startOffset, 1)
    equal(range.endOffset, 8)
  })
  await test('compatibility ligatures and combining halfwidth kana map back to original text', async () => {
    dom('<p>前ﾊﾟカ\u3099ﬃ終わり</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('パガffi')])
    const range = w.rangeForMatch(index, match)
    equal(range.toString(), 'ﾊﾟカ\u3099ﬃ')
  })
  await test('user selection is preserved when the audiobook highlight changes', async () => {
    dom('<p>first passage and second passage</p>')
    const index = await w.buildBookIndex(root)
    const selected = document.createRange()
    selected.setStart(root.firstChild.firstChild, 0)
    selected.setEnd(root.firstChild.firstChild, 5)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(selected)
    const [match] = await w.matchCues(index.text, [makeCue('second passage')])
    const highlighter = new w.ReaderHighlight(window)
    highlighter.set(w.rangeForMatch(index, match))
    equal(window.getSelection().toString(), 'first')
    highlighter.clear()
    equal(window.getSelection().toString(), 'first')
  })
  await test('an old highlighter cannot clear a new session highlight', async () => {
    if (!CSS.highlights) throw new Error('CSS Highlight API unavailable in test browser')
    dom('<p>first passage</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('first passage')])
    const range = w.rangeForMatch(index, match)
    const first = new w.ReaderHighlight(window), second = new w.ReaderHighlight(window)
    first.set(range)
    second.set(range)
    const value = CSS.highlights.get('manabi-whispersync')
    first.clear()
    assert(CSS.highlights.get('manabi-whispersync') === value)
    second.clear()
    assert(!CSS.highlights.has('manabi-whispersync'))
  })
  await test('selection hint maps across normalized characters', async () => {
    dom('<p>前ﾊﾟ𠮷chapter</p>')
    const index = await w.buildBookIndex(root)
    const range = document.createRange()
    range.setStart(root.firstChild.firstChild, 3)
    range.collapse(true)
    equal(w.offsetForSelection(index, range), 2)
  })
  await test('detached and modified text invalidates old ranges safely', async () => {
    dom('<p>original passage</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('original passage')])
    root.firstChild.firstChild.data = 'x'
    equal(w.rangeForMatch(index, match), undefined)
    dom('<p>new passage</p>')
    equal(w.rangeForMatch(index, match), undefined)
  })
  await test('indexing aborts after a book is removed during a yielded batch', async () => {
    dom('<p>' + 'abcdefghij'.repeat(3000) + '</p>')
    const promise = w.buildBookIndex(root)
    root.remove()
    let caught = false
    try { await promise } catch (error) { caught = error.name === 'AbortError' }
    assert(caught)
    document.body.append(root)
  })
  await test('subtitle markup stays inert when displayed as text', async () => {
    const before = window.__whispersyncInjection
    const cue = w.parseSubtitles('00:01.000 --> 00:02.000\n<img src=x onerror="window.__whispersyncInjection=1">')[0]
    const display = document.createElement('p')
    display.textContent = cue.text
    root.replaceChildren(display)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert(!root.querySelector('img'))
    equal(window.__whispersyncInjection, before)
  })
  await test('interior edits invalidate a range even when both endpoint nodes survive', async () => {
    dom('<p>first <em>middle</em> last</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('first middle last')])
    root.querySelector('em').firstChild.data = 'changed'
    equal(w.rangeForMatch(index, match), undefined)
  })
  await test('text insertion and reordering invalidate an old index synchronously', async () => {
    dom('<p>first</p><p>last</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('first last')])
    root.insertBefore(document.createTextNode('inserted'), root.lastChild)
    equal(w.rangeForMatch(index, match), undefined)
  })
  await test('newly hidden text invalidates an existing match', async () => {
    dom('<p>original passage</p>')
    const index = await w.buildBookIndex(root)
    const [match] = await w.matchCues(index.text, [makeCue('original passage')])
    root.firstChild.hidden = true
    equal(w.rangeForMatch(index, match), undefined)
  })
  await test('combining sequences split across inline markup still match and map correctly', async () => {
    dom('<p>前<span>カ</span><em>\u3099</em>後</p>')
    const index = await w.buildBookIndex(root)
    equal(index.text, w.normalizeText('前カ\u3099後'))
    const [match] = await w.matchCues(index.text, [makeCue('前ガ後')], { start: 0 })
    equal(w.rangeForMatch(index, match).toString(), '前カ\u3099後')
  })
  await test('contextual lowercase does not make book and cue normalization disagree', async () => {
    dom('<p>ΟΣ</p>')
    const index = await w.buildBookIndex(root)
    equal(index.text, w.normalizeText('ΟΣ'))
  })
  await test('noninteger and nonfinite range offsets fail safely', async () => {
    dom('<p>original passage</p>')
    const index = await w.buildBookIndex(root)
    for (const start of [NaN, Infinity, 0.5]) equal(w.rangeForMatch(index, { start, end: 5, score: 1 }), undefined)
  })
  await test('modal aria-hidden outside the book does not exclude its narration', async () => {
    dom('<p>original passage</p><span aria-hidden="true">decoration</span>')
    const wrapper = document.createElement('div')
    wrapper.setAttribute('aria-hidden', 'true')
    root.replaceWith(wrapper)
    wrapper.append(root)
    try { equal((await w.buildBookIndex(root)).text, 'originalpassage') }
    finally { wrapper.replaceWith(root) }
  })
  await test('element-boundary selection hints point to the next readable text', async () => {
    dom('<p>first</p><p>second</p>')
    const index = await w.buildBookIndex(root)
    const range = document.createRange()
    range.setStart(root, 1)
    range.collapse(true)
    equal(w.offsetForSelection(index, range), 5)
  })
  await test('disposed indexes reject ranges without retaining a live mutation observer', async () => {
    dom('<p>original passage</p>')
    let invalidated = 0
    const index = await w.buildBookIndex(root, undefined, () => { invalidated += 1 })
    index.dispose()
    root.firstChild.firstChild.data = 'changed'
    await Promise.resolve()
    equal(invalidated, 0)
    equal(index.isCurrent(), false)
    equal(w.rangeForMatch(index, { start: 0, end: 4, score: 1 }), undefined)
  })
  await test('a mutation during cue matching invalidates the complete candidate index', async () => {
    dom('<p>' + 'abcdefghij'.repeat(50) + '</p>')
    const index = await w.buildBookIndex(root)
    const promise = w.matchCues(index.text, Array.from({ length: 40 }, () => makeCue('abcdefghij')))
    root.firstChild.append(document.createTextNode('new text'))
    await promise
    equal(index.isCurrent(), false)
  })
  await test('large punctuation-only input is bounded before normalization', async () => {
    dom('<p></p>')
    root.firstChild.textContent = '。'.repeat(w.MAX_BOOK_RAW_UNITS + 1)
    let message = ''
    try { await w.buildBookIndex(root) } catch (error) { message = error.message }
    assert(message.includes('too large'), message)
  })
  if (!skipStorage) await test('IndexedDB roundtrip persists only declared session fields', async () => {
    const store = new w.AudiobookSessionStore()
    const key = 'test-roundtrip'
    const data = { ...w.emptySession(), subtitleSource: '00:01.000 --> 00:02.000\nhello', subtitleName: 'hello.srt', position: 35, updatedAt: 100, audio: { name: 'hello.mp3', size: 100, lastModified: 1 } }
    await store.save(key, data)
    equal(await store.load(key), data)
    await store.remove(key)
    equal(await store.load(key), undefined)
    await store.close()
  })
  if (!skipStorage) await test('queued saves capture immutable snapshots and deletion runs last', async () => {
    const store = new w.AudiobookSessionStore()
    const key = 'test-order'
    const a = { ...w.emptySession(), position: 10 }
    const first = store.save(key, a)
    a.position = 100
    await first
    equal((await store.load(key)).position, 10)
    const one = store.save(key, { ...a, position: 20 })
    const two = store.save(key, { ...a, position: 30 })
    const remove = store.remove(key)
    await Promise.all([one, two, remove])
    equal(await store.load(key), undefined)
    await store.close()
  })
  if (!skipStorage) await test('storage shutdown waits for pending saves', async () => {
    const store = new w.AudiobookSessionStore()
    const write = store.save('test-close', { ...w.emptySession(), position: 12 })
    await store.close()
    await write
    const reopened = new w.AudiobookSessionStore()
    equal((await reopened.load('test-close')).position, 12)
    await reopened.remove('test-close')
    await reopened.close()
  })
  await test('native media metadata, seek, playback and disposal use local audio only', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const revoked = []
    let state
    const player = new w.LocalAudioPlayer({
      createAudio: () => document.createElement('audio'),
      createURL: (file) => URL.createObjectURL(file),
      revokeURL: (url) => { revoked.push(url); URL.revokeObjectURL(url) },
      attach: (audio) => audio ? host.replaceChildren(audio) : host.replaceChildren(),
      requestFrame: (fn) => requestAnimationFrame(fn), cancelFrame: (id) => cancelAnimationFrame(id)
    }, (next) => { state = next })
    // Generate three seconds of silence: no copyrighted fixture or network audio.
    const sampleRate = 8000, samples = sampleRate * 3
    const data = new ArrayBuffer(44 + samples * 2), v = new DataView(data)
    const text = (offset, string) => [...string].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
    text(0, 'RIFF')
    v.setUint32(4, data.byteLength - 8, true)
    text(8, 'WAVEfmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, sampleRate, true)
    v.setUint32(28, sampleRate * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    text(36, 'data')
    v.setUint32(40, samples * 2, true)
    const file = new File([data], 'silence.wav', { type: 'audio/wav', lastModified: 1 })
    player.load(file, { identity: w.audioIdentity(file), position: 1.2 })
    const audio = host.querySelector('audio')
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('metadata timeout')), 5000)
      audio.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    assert(state.ready)
    assert(Math.abs(state.duration - 3) < 0.02)
    assert(Math.abs(audio.currentTime - 1.2) < 0.02)
    await player.play()
    assert(!state.error, state.error)
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert(audio.currentTime >= 1.2)
    player.pause()
    player.dispose()
    equal(host.children.length, 0)
    equal(revoked.length, 1)
    host.remove()
  })
  root.remove()
  w.buildBookIndex = buildIndex
  return results
}
