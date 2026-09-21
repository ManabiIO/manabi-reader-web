/** @license MIT — loaded after a locally compiled browser harness bundle. */
window.runWhispersyncBrowserTests = async function ({ skipStorage = false } = {}) {
  const w = { ...window.whispersync };
  const indexes = [];
  const build = w.buildBookIndex;
  w.buildBookIndex = async (...args) => {
    const index = await build(...args);
    indexes.push(index);
    return index;
  };
  const buildSource = w.buildSourceBookIndex;
  w.buildSourceBookIndex = async (...args) => {
    const index = await buildSource(...args);
    indexes.push(index);
    return index;
  };
  const results = [];
  const assert = (condition, message = 'assertion failed') => {
    if (!condition) throw new Error(message);
  };
  // Native IDB records preserve values, not the caller's property insertion order.
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])])
          )
        : value;
  const equal = (a, b) =>
    assert(
      JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)),
      `${JSON.stringify(a)} !== ${JSON.stringify(b)}`
    );
  const test = async (name, fn) => {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error), stack: error.stack });
    } finally {
      for (const index of indexes.splice(0)) index.dispose();
    }
  };
  const runKey = `whispersync-test-${Date.now()}-${Math.random()}`;
  const storageTest = async (name, fn) => {
    if (skipStorage)
      results.push({
        name,
        skipped: true,
        reason: 'Native IndexedDB requires an origin; unavailable in offline DOM mode'
      });
    else await test(name, fn);
  };
  const root = document.createElement('article');
  document.body.append(root);
  const dom = (html) => {
    root.innerHTML = html;
    return root;
  };
  const makeCue = (text) => ({ id: 0, start: 0, end: 2, text });
  await test('ruby pronunciation and hidden/metadata nodes are excluded', async () => {
    dom(
      '<p>私は<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>です。</p><div hidden>HIDDEN</div><div aria-hidden="true">NO</div><style>body {color: red}</style>'
    );
    const before = root.innerHTML;
    const index = await w.buildBookIndex(root);
    equal(index.text, '私は漢字です');
    equal(root.innerHTML, before);
  });
  await test('indexing and highlight ranges never wrap/split/modify the book DOM', async () => {
    dom('<p id="paragraph">Hello <em>lovely</em> world</p>');
    const paragraph = root.firstChild,
      text = paragraph.firstChild,
      emphasis = paragraph.children[0];
    const before = root.innerHTML;
    const mutations = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(root, {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true
    });
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('hello lovely world')]);
    const range = w.rangeForMatch(index, match);
    equal(range.toString(), 'Hello lovely world');
    const highlight = new w.ReaderHighlight(window);
    highlight.set(range);
    highlight.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
    equal(root.innerHTML, before);
    assert(paragraph.firstChild === text && paragraph.children[0] === emphasis);
    equal(mutations.length, 0);
    observer.disconnect();
  });
  await test('UTF-16 offsets preserve supplementary characters and grapheme boundaries', async () => {
    dom('<p>前𠮷野家ＡＢＣ</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('𠮷野家ABC')]);
    const range = w.rangeForMatch(index, match);
    equal(range.toString(), '𠮷野家ＡＢＣ');
    equal(range.startOffset, 1);
    equal(range.endOffset, 8);
  });
  await test('compatibility ligatures and combining halfwidth kana map back to original text', async () => {
    dom('<p>前ﾊﾟカ\u3099ﬃ終わり</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('パガffi')]);
    const range = w.rangeForMatch(index, match);
    equal(range.toString(), 'ﾊﾟカ\u3099ﬃ');
  });
  await test('user selection is preserved when the audiobook highlight changes', async () => {
    dom('<p>first passage and second passage</p>');
    const index = await w.buildBookIndex(root);
    const selected = document.createRange();
    selected.setStart(root.firstChild.firstChild, 0);
    selected.setEnd(root.firstChild.firstChild, 5);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(selected);
    const [match] = await w.matchCues(index.text, [makeCue('second passage')]);
    const highlighter = new w.ReaderHighlight(window);
    highlighter.set(w.rangeForMatch(index, match));
    equal(window.getSelection().toString(), 'first');
    highlighter.clear();
    equal(window.getSelection().toString(), 'first');
  });
  await test('an old highlighter cannot clear a new session highlight', async () => {
    if (!CSS.highlights) throw new Error('CSS Highlight API unavailable in test browser');
    dom('<p>first passage</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('first passage')]);
    const range = w.rangeForMatch(index, match);
    const first = new w.ReaderHighlight(window),
      second = new w.ReaderHighlight(window);
    first.set(range);
    second.set(range);
    const value = CSS.highlights.get('manabi-whispersync');
    first.clear();
    assert(CSS.highlights.get('manabi-whispersync') === value);
    second.clear();
    assert(!CSS.highlights.has('manabi-whispersync'));
  });
  await test('highlighting fails closed when the CSS Highlight API is unavailable', async () => {
    const unsupported = new w.ReaderHighlight({});
    assert(!unsupported.supported);
    unsupported.set(document.createRange());
    unsupported.clear();
  });
  await test('matching reports an actionable error when mutation observers are unavailable', async () => {
    const view = document.defaultView;
    const previous = view.MutationObserver;
    view.MutationObserver = undefined;
    try {
      dom('<p>book text</p>');
      let failed = false;
      try {
        await w.buildBookIndex(root);
      } catch (error) {
        failed = /mutation tracking is unavailable/i.test(error.message);
      }
      assert(failed);
    } finally {
      view.MutationObserver = previous;
    }
  });
  await test('selection hint maps across normalized characters', async () => {
    dom('<p>前ﾊﾟ𠮷chapter</p>');
    const index = await w.buildBookIndex(root);
    const range = document.createRange();
    range.setStart(root.firstChild.firstChild, 3);
    range.collapse(true);
    equal(w.offsetForSelection(index, range), 2);
  });
  await test('detached and modified text invalidates old ranges safely', async () => {
    dom('<p>original passage</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('original passage')]);
    root.firstChild.firstChild.data = 'x';
    equal(w.rangeForMatch(index, match), undefined);
    dom('<p>new passage</p>');
    equal(w.rangeForMatch(index, match), undefined);
  });
  await test('indexing aborts after a book is removed during a yielded batch', async () => {
    dom('<p>' + 'abcdefghij'.repeat(3000) + '</p>');
    const promise = w.buildBookIndex(root);
    root.remove();
    let caught = false;
    try {
      await promise;
    } catch (error) {
      caught = error.name === 'AbortError';
    }
    assert(caught);
    document.body.append(root);
  });
  await test('subtitle markup stays inert when displayed as text', async () => {
    const before = window.__whispersyncInjection;
    const cue = w.parseSubtitles(
      '00:01.000 --> 00:02.000\n<img src=x onerror="window.__whispersyncInjection=1">'
    )[0];
    const display = document.createElement('p');
    display.textContent = cue.text;
    root.replaceChildren(display);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert(!root.querySelector('img'));
    equal(window.__whispersyncInjection, before);
  });

  const sourceHTML =
    '<section id="ttu-one"><p>First <em>chapter</em> passage.</p></section><section id="ttu-two"><p>Second <ruby>chapter<rt>reading</rt></ruby> passage.</p></section>';
  const sourceFor = async (html = sourceHTML) =>
    new w.BookSource(await w.buildSourceBookIndex(html, document));
  const locationFor = async (source, text) => {
    const [match] = await w.matchCues(source.index.text, [makeCue(text)]);
    assert(match, `no source match for ${text}`);
    const location = source.location(match);
    assert(location, 'missing source location');
    return location;
  };
  const renderSection = (id) => {
    const template = document.createElement('template');
    template.innerHTML = sourceHTML;
    const section = template.content.getElementById(id);
    dom(
      `<div class="book-content-container" id="${id}"><!--svelte-start-->${section.innerHTML}<!--svelte-end--></div>`
    );
    root.setAttribute('aria-busy', 'false');
  };
  await test('whole-book indexing is inert and includes chapters absent from the live DOM', async () => {
    dom('<p>Only the live chapter</p>');
    const before = root.innerHTML;
    root.setAttribute('aria-hidden', 'true');
    const source = await sourceFor(sourceHTML + '<script>window.unwantedAudioCode = true</script>');
    root.removeAttribute('aria-hidden');
    equal(root.innerHTML, before);
    equal(window.unwantedAudioCode, undefined);
    assert(source.index.valid());
    assert(!source.index.root.isConnected);
    const location = await locationFor(source, 'Second chapter passage');
    equal(location.sectionId, 'ttu-two');
    equal(source.resolve(location, root), undefined);
  });
  await test('virtualized chapters resolve original text through Svelte comment anchors', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-two');
    const before = root.innerHTML;
    equal(source.resolve(location, root).toString(), 'Second chapterreading passage');
    equal(root.innerHTML, before);
    renderSection('ttu-one');
    equal(source.resolve(location, root), undefined);
    assert(source.index.valid(), 'switching live chapters must not invalidate immutable source');
  });
  await test('continuous source paths work without stable chapter IDs', async () => {
    const html = '<section><p>First passage. Second passage.</p></section>';
    const source = await sourceFor(html);
    const location = await locationFor(source, 'Second passage');
    dom(`<!--svelte-start-->${html}<!--svelte-end-->`);
    equal(source.resolve(location, root).toString(), 'Second passage');
  });
  await test('starting selections map from the mounted chapter into the whole book', async () => {
    const source = await sourceFor();
    renderSection('ttu-two');
    const paragraph = root.querySelector('p');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 6);
    equal(source.selectionOffset(range, root), source.index.text.indexOf('second'));
    range.setStart(paragraph, 1);
    range.setEnd(paragraph, 2);
    equal(
      source.selectionOffset(range, root),
      source.index.text.indexOf('chapter', source.index.text.indexOf('second'))
    );
  });
  await test('a captured selection remains usable while the drawer hides the reader', async () => {
    const source = await sourceFor();
    renderSection('ttu-two');
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('p'));
    for (const hidden of [root, document.body]) {
      hidden.setAttribute('aria-hidden', 'true');
      try {
        equal(source.selectionOffset(range, root), source.index.text.indexOf('second'));
      } finally {
        hidden.removeAttribute('aria-hidden');
      }
    }
    root.querySelector('p').hidden = true;
    equal(source.selectionOffset(range, root), undefined);
  });
  await test('source projection rejects altered middle text, hidden text, and stale render readiness', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'First chapter passage');
    renderSection('ttu-one');
    root.setAttribute('aria-busy', 'true');
    equal(source.resolve(location, root), undefined);
    root.setAttribute('aria-busy', 'false');
    assert(source.resolve(location, root));
    root.querySelector('em').firstChild.data = 'changed';
    equal(source.resolve(location, root), undefined);
    renderSection('ttu-one');
    root.querySelector('em').hidden = true;
    equal(source.resolve(location, root), undefined);
  });
  await test('duplicate live anchors cannot redirect a valid source location', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'First chapter passage');
    renderSection('ttu-one');
    root.append(root.firstElementChild.cloneNode(true));
    equal(source.resolve(location, root), undefined);
  });
  await test('unsafe imported IDs never reach the existing chapter-selector boundary', async () => {
    const source = await sourceFor(
      `<section id='ttu-bad"selector'><p>Unusual identifier passage.</p></section>`
    );
    const location = await locationFor(source, 'Unusual identifier passage');
    equal(location.sectionId, undefined);
    dom('<p>Another chapter</p>');
    let dispatched = false;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {
        dispatched = true;
      },
      navigate: () => true
    });
    try {
      let failed = false;
      try {
        await navigator.show(source, location);
      } catch (error) {
        failed = /stable chapter identifier/.test(error.message);
      }
      assert(failed);
      equal(dispatched, false);
    } finally {
      navigator.dispose();
    }
  });
  await test('chapter navigation waits for fresh render readiness before using a new range', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-one');
    const calls = [];
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: (id) => {
        calls.push(id);
        root.setAttribute('aria-busy', 'true');
        setTimeout(() => renderSection(id), 0);
      },
      navigate: (range) => {
        calls.push(range.toString());
        return true;
      },
      timeout: 1000
    });
    try {
      const range = await navigator.show(source, location);
      equal(range.toString(), 'Second chapterreading passage');
      equal(calls, ['ttu-two', 'Second chapterreading passage']);
    } finally {
      navigator.dispose();
    }
  });
  await test('superseded chapter navigation cannot scroll or highlight an old request', async () => {
    const source = await sourceFor();
    const first = await locationFor(source, 'First chapter passage');
    const second = await locationFor(source, 'Second chapter passage');
    dom('<p>Loading</p>');
    const calls = [];
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {},
      navigate: (range) => {
        calls.push(range.toString());
        return true;
      },
      timeout: 1000
    });
    try {
      const old = navigator.show(source, first);
      const current = navigator.show(source, second);
      renderSection('ttu-two');
      equal(await old, undefined);
      assert(await current);
      equal(calls, ['Second chapterreading passage']);
    } finally {
      navigator.dispose();
    }
  });
  await test('navigator disposal cancels pending render observers without late navigation', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    dom('<p>Loading</p>');
    let navigated = false;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {},
      navigate: () => {
        navigated = true;
        return true;
      },
      timeout: 1000
    });
    const result = navigator.show(source, location);
    navigator.dispose();
    renderSection('ttu-two');
    equal(await result, undefined);
    equal(navigated, false);
    equal(await navigator.show(source, location), undefined);
  });
  await test('unavailable chapter rendering produces an actionable timeout without scrolling', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    dom('<p>Unavailable</p>');
    let navigated = false;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {},
      navigate: () => {
        navigated = true;
        return true;
      },
      timeout: 10
    });
    try {
      let failed = false;
      try {
        await navigator.show(source, location);
      } catch (error) {
        failed = /did not become ready/.test(error.message);
      }
      assert(failed);
      equal(navigated, false);
    } finally {
      navigator.dispose();
    }
  });
  await storageTest('IndexedDB roundtrip persists only declared session fields', async () => {
    const store = new w.AudiobookSessionStore();
    const key = runKey + '-roundtrip';
    const data = {
      ...w.emptySession(),
      subtitleSource: '00:01.000 --> 00:02.000\nhello',
      subtitleName: 'hello.srt',
      position: 35,
      updatedAt: 100,
      audio: { name: 'hello.mp3', size: 100, lastModified: 1 }
    };
    await store.save(key, data);
    equal(await store.load(key), data);
    await store.remove(key);
    equal(await store.load(key), undefined);
    await store.close();
  });
  await storageTest('queued saves capture immutable snapshots and deletion runs last', async () => {
    const store = new w.AudiobookSessionStore();
    const key = runKey + '-order';
    const a = { ...w.emptySession(), position: 10 };
    const first = store.save(key, a);
    a.position = 100;
    await first;
    equal((await store.load(key)).position, 10);
    const one = store.save(key, { ...a, position: 20 });
    const two = store.save(key, { ...a, position: 30 });
    const remove = store.remove(key);
    await Promise.all([one, two, remove]);
    equal(await store.load(key), undefined);
    await store.close();
  });
  await storageTest('storage shutdown waits for pending saves', async () => {
    const store = new w.AudiobookSessionStore();
    const write = store.save(runKey + '-close', { ...w.emptySession(), position: 12 });
    await store.close();
    await write;
    const reopened = new w.AudiobookSessionStore();
    equal((await reopened.load(runKey + '-close')).position, 12);
    await reopened.remove(runKey + '-close');
    await reopened.close();
  });
  await test('native media metadata, seek, playback and disposal use local audio only', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const revoked = [];
    let state;
    const player = new w.LocalAudioPlayer(
      {
        createAudio: () => document.createElement('audio'),
        createURL: (file) => URL.createObjectURL(file),
        revokeURL: (url) => {
          revoked.push(url);
          URL.revokeObjectURL(url);
        },
        attach: (audio) => (audio ? host.replaceChildren(audio) : host.replaceChildren()),
        requestFrame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (id) => cancelAnimationFrame(id)
      },
      (next) => {
        state = next;
      }
    );
    // Generate three seconds of silence: no copyrighted fixture or network audio.
    const sampleRate = 8000,
      samples = sampleRate * 3;
    const data = new ArrayBuffer(44 + samples * 2),
      v = new DataView(data);
    const text = (offset, string) =>
      [...string].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    v.setUint32(4, data.byteLength - 8, true);
    text(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    text(36, 'data');
    v.setUint32(40, samples * 2, true);
    const file = new File([data], 'silence.wav', { type: 'audio/wav', lastModified: 1 });
    player.setRate(1.5);
    player.load(file, { identity: w.audioIdentity(file), position: 1.2 });
    const audio = host.querySelector('audio');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('metadata timeout')), 5000);
      audio.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
    assert(state.ready);
    equal(audio.playbackRate, 1.5);
    equal(state.rate, 1.5);
    assert(Math.abs(state.duration - 3) < 0.02);
    assert(Math.abs(audio.currentTime - 1.2) < 0.02);
    await player.play();
    assert(!state.error, state.error);
    player.pause();
    player.dispose();
    equal(host.children.length, 0);
    equal(revoked.length, 1);
    host.remove();
  });

  await test('split inline combining sequences match and span their complete original grapheme', async () => {
    dom('<p>前<em>カ</em>\u3099です</p>');
    const index = await w.buildBookIndex(root);
    equal(index.text, w.normalizeText('前ガです'));
    const [match] = await w.matchCues(index.text, [makeCue('ガです')], { start: 1 });
    equal(w.rangeForMatch(index, match).toString(), 'カ\u3099です');
  });
  await test('context-dependent Greek sigma matches across text nodes', async () => {
    dom('<p>Ο<span>Σ</span> είναι εδώ</p>');
    const index = await w.buildBookIndex(root);
    equal(index.text, w.normalizeText('ΟΣ είναι εδώ'));
    const [match] = await w.matchCues(index.text, [makeCue('ΟΣ είναι εδώ')]);
    assert(match);
  });
  await test('mutations in a middle span invalidate a match even when both endpoints are unchanged', async () => {
    dom('<p>first <em>middle</em> last</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('first middle last')]);
    root.querySelector('em').firstChild.data = 'replacement';
    equal(w.rangeForMatch(index, match), undefined);
  });
  await test('inserting new text between unchanged spans invalidates old matches immediately', async () => {
    dom('<p>first <em>middle</em> last</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('first middle last')]);
    root.querySelector('em').before(document.createTextNode('inserted'));
    equal(w.rangeForMatch(index, match), undefined);
  });
  await test('hiding previously matched text invalidates its cached book index', async () => {
    dom('<p>first <em>middle</em> last</p>');
    const index = await w.buildBookIndex(root);
    const [match] = await w.matchCues(index.text, [makeCue('first middle last')]);
    root.querySelector('em').hidden = true;
    equal(w.rangeForMatch(index, match), undefined);
  });
  await test('selection hints accept an element boundary, not only a text-node boundary', async () => {
    dom('<p>first passage</p><p>second passage</p>');
    const index = await w.buildBookIndex(root);
    const range = document.createRange();
    range.setStart(root, 1);
    range.collapse(true);
    equal(w.offsetForSelection(index, range), 'firstpassage'.length);
  });
  await test('invalid fractional and non-finite cached match ranges fail closed', async () => {
    dom('<p>some long text</p>');
    const index = await w.buildBookIndex(root);
    equal(w.rangeForMatch(index, { start: NaN, end: 4, score: 1 }), undefined);
    equal(w.rangeForMatch(index, { start: 0.5, end: 4, score: 1 }), undefined);
  });

  await test('index disposal disconnects its observer without publishing invalidations', async () => {
    dom('<p>first passage</p>');
    let invalidations = 0;
    const index = await w.buildBookIndex(root, undefined, () => {
      invalidations += 1;
    });
    index.dispose();
    root.firstChild.firstChild.data = 'changed';
    await Promise.resolve();
    equal(invalidations, 0);
    assert(!index.valid());
  });
  await test('mutation invalidation publishes once and takes effect before its microtask', async () => {
    dom('<p>first passage</p>');
    let invalidations = 0;
    const index = await w.buildBookIndex(root, undefined, () => {
      invalidations += 1;
    });
    root.firstChild.append(document.createTextNode('new'));
    assert(!index.valid());
    await Promise.resolve();
    assert(!index.valid());
    equal(invalidations, 1);
  });
  await test('a punctuation-only oversized source is rejected before normalization can bypass limits', async () => {
    dom('<p></p>');
    root.firstChild.textContent = '.'.repeat(w.MAX_SOURCE_UNITS + 1);
    let rejected = false;
    try {
      await w.buildBookIndex(root);
    } catch (error) {
      rejected = /source exceeds/.test(error.message);
    }
    assert(rejected);
    dom('<p>small valid book</p>');
    equal((await w.buildBookIndex(root)).text, 'smallvalidbook');
  });
  await test('edits to already indexed nodes during a yielded build abort the whole index', async () => {
    dom('<p>first passage</p><p>' + 'あ'.repeat(20000) + '</p>');
    const pending = w.buildBookIndex(root);
    root.firstChild.firstChild.data = 'edited early span';
    let canceled = false;
    try {
      await pending;
    } catch (error) {
      canceled = error.name === 'AbortError';
    }
    assert(canceled);
  });

  // Review 3 regressions: source addresses must not invent a selected passage.
  await test('image-only selections do not silently select the following book text', async () => {
    const html =
      '<section id="ttu-one"><img alt="illustration"><p>Following readable passage</p></section>';
    const source = await sourceFor(html);
    dom(html);
    const selection = document.createRange();
    selection.selectNode(root.querySelector('img'));
    equal(source.selectionOffset(selection, root), undefined);
  });
  await test('hidden-only selections do not silently select following visible book text', async () => {
    const html =
      '<section id="ttu-one"><span hidden>Hidden text</span><p>Following readable passage</p></section>';
    const source = await sourceFor(html);
    dom(html);
    const selection = document.createRange();
    selection.selectNodeContents(root.querySelector('span'));
    equal(source.selectionOffset(selection, root), undefined);
  });
  await test('a selection reaching outside this book cannot become a starting hint', async () => {
    const html = '<section id="ttu-one"><p>Readable book passage</p></section>';
    const source = await sourceFor(html);
    dom(html);
    const other = document.createElement('p');
    other.textContent = 'Outside the book';
    root.after(other);
    const selection = document.createRange();
    selection.setStart(root.querySelector('p').firstChild, 0);
    selection.setEnd(other.firstChild, 5);
    try {
      equal(source.selectionOffset(selection, root), undefined);
    } finally {
      other.remove();
    }
  });
  await test('source ID edits invalidate addresses before a new chapter can be requested', async () => {
    const source = await sourceFor();
    source.index.root.querySelector('#ttu-one').id = 'changed-section';
    assert(!source.index.valid());
  });
  await test('navigation never changes a chapter or scrolls behind an aria-hidden modal', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-one');
    root.setAttribute('aria-hidden', 'true');
    const commands = [];
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: (id) => {
        commands.push(id);
        renderSection(id);
      },
      navigate: () => {
        commands.push('scroll');
        return true;
      },
      timeout: 1000
    });
    try {
      const pending = navigator.show(source, location);
      await new Promise((resolve) => setTimeout(resolve, 0));
      equal(commands, []);
      root.removeAttribute('aria-hidden');
      assert(await pending);
      equal(commands, ['ttu-two', 'scroll']);
    } finally {
      root.removeAttribute('aria-hidden');
      navigator.dispose();
    }
  });
  await test('navigation does not scroll an already rendered passage while an ancestor is inert', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-two');
    const holder = document.createElement('div');
    document.body.append(holder);
    holder.append(root);
    holder.inert = true;
    let scrolled = 0;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {
        throw new Error('already mounted');
      },
      navigate: () => {
        scrolled++;
        return true;
      },
      timeout: 1000
    });
    try {
      const pending = navigator.show(source, location);
      await new Promise((resolve) => setTimeout(resolve, 0));
      equal(scrolled, 0);
      holder.inert = false;
      assert(await pending);
      equal(scrolled, 1);
    } finally {
      navigator.dispose();
      document.body.append(root);
      holder.remove();
    }
  });

  await test('navigation resumes when the document root stops being inert', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-two');
    let scrolls = 0;
    document.documentElement.inert = true;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {
        throw new Error('already mounted');
      },
      navigate: () => {
        scrolls++;
        return true;
      },
      timeout: 1000
    });
    try {
      const pending = navigator.show(source, location);
      await new Promise((resolve) => setTimeout(resolve, 0));
      equal(scrolls, 0);
      document.documentElement.inert = false;
      assert(await pending);
      equal(scrolls, 1);
    } finally {
      document.documentElement.inert = false;
      navigator.dispose();
    }
  });
  await test('same-cue mutation callbacks do not cancel an automatic chapter transition', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-one');
    const highlights = [],
      errors = [];
    let scrolls = 0,
      timer;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: (id) => {
        root.setAttribute('aria-busy', 'true');
        timer = setTimeout(() => {
          renderSection(id);
          root.setAttribute('aria-busy', 'false');
        }, 5);
      },
      navigate: () => {
        scrolls++;
        return true;
      },
      timeout: 1000
    });
    const session = new w.ReaderNavigationSession(navigator, {
      highlight: (range) => highlights.push(range.toString()),
      error: (message) => errors.push(message)
    });
    const observer = new MutationObserver(() => session.cueChanged(1));
    observer.observe(root, { subtree: true, childList: true, attributes: true });
    try {
      session.cueChanged(1);
      await session.show(source, location, true);
      // Range text includes ruby pronunciation even though matching excludes it.
      equal(highlights, ['Second chapterreading passage']);
      equal(errors, []);
      equal(scrolls, 1);
    } finally {
      observer.disconnect();
      clearTimeout(timer);
      session.dispose();
      navigator.dispose();
      root.removeAttribute('aria-busy');
    }
  });
  await test('a cue gap prevents a pending chapter render from scrolling or highlighting stale text', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-one');
    const highlights = [],
      errors = [];
    let scrolls = 0;
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {
        root.setAttribute('aria-busy', 'true');
      },
      navigate: () => {
        scrolls++;
        return true;
      },
      timeout: 1000
    });
    const session = new w.ReaderNavigationSession(navigator, {
      highlight: (range) => highlights.push(range.toString()),
      error: (message) => errors.push(message)
    });
    try {
      session.cueChanged(1);
      const pending = session.show(source, location, true);
      session.cueChanged(-1);
      renderSection('ttu-two');
      root.setAttribute('aria-busy', 'false');
      await pending;
      equal(highlights, []);
      equal(errors, []);
      equal(scrolls, 0);
    } finally {
      session.dispose();
      navigator.dispose();
      root.removeAttribute('aria-busy');
    }
  });
  await test('canceling an already resolved DOM request prevents its queued UI highlight', async () => {
    const source = await sourceFor();
    const location = await locationFor(source, 'Second chapter passage');
    renderSection('ttu-two');
    const highlights = [],
      errors = [];
    const navigator = new w.ReaderNavigator({
      document,
      root: () => root,
      selectSection: () => {
        throw new Error('unexpected chapter request');
      },
      navigate: () => true
    });
    const session = new w.ReaderNavigationSession(navigator, {
      highlight: (range) => highlights.push(range.toString()),
      error: (message) => errors.push(message)
    });
    try {
      const pending = session.show(source, location);
      session.cancel();
      await pending;
      equal(highlights, []);
      equal(errors, []);
    } finally {
      session.dispose();
      navigator.dispose();
    }
  });
  await storageTest(
    'native IndexedDB rejects a stale checkpoint across separate connections',
    async () => {
      const key = runKey + '-conflict';
      const a = new w.AudiobookSessionStore(),
        b = new w.AudiobookSessionStore();
      try {
        await Promise.all([a.load(key), b.load(key)]);
        await b.save(key, { ...w.emptySession(), position: 72 });
        let conflict;
        try {
          await a.save(key, { ...w.emptySession(), position: 11 });
        } catch (error) {
          conflict = error;
        }
        assert(conflict instanceof w.AudiobookStorageConflictError);
        equal((await b.load(key)).position, 72);
        await b.remove(key);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }
  );
  await storageTest(
    'native IndexedDB reset cannot be undone by an older open connection',
    async () => {
      const key = runKey + '-reset';
      const a = new w.AudiobookSessionStore(),
        b = new w.AudiobookSessionStore();
      const data = {
        ...w.emptySession(),
        subtitleSource: '00:01.000 --> 00:02.000\nDeleted captions'
      };
      try {
        await a.save(key, data);
        await b.load(key);
        await b.remove(key);
        let conflict;
        try {
          await a.save(key, data);
        } catch (error) {
          conflict = error;
        }
        assert(conflict instanceof w.AudiobookStorageConflictError);
        equal(await b.load(key), undefined);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }
  );
  await storageTest(
    'native IndexedDB concurrent initial writers have exactly one owner',
    async () => {
      const key = runKey + '-initial';
      const a = new w.AudiobookSessionStore(),
        b = new w.AudiobookSessionStore();
      try {
        await Promise.all([a.load(key), b.load(key)]);
        const results = await Promise.allSettled([
          a.save(key, { ...w.emptySession(), position: 1 }),
          b.save(key, { ...w.emptySession(), position: 2 })
        ]);
        equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        equal(results.filter((result) => result.status === 'rejected').length, 1);
        assert(
          results.find((result) => result.status === 'rejected').reason instanceof
            w.AudiobookStorageConflictError
        );
        await a.remove(key);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }
  );
  await storageTest(
    'native IndexedDB does not replace a record without first restoring it',
    async () => {
      const key = runKey + '-unread';
      const a = new w.AudiobookSessionStore(),
        b = new w.AudiobookSessionStore();
      try {
        await a.save(key, { ...w.emptySession(), position: 59 });
        let failure;
        try {
          await b.save(key, w.emptySession());
        } catch (error) {
          failure = error;
        }
        assert(/unread|Restore/.test(failure?.message));
        equal((await a.load(key)).position, 59);
        await a.remove(key);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }
  );
  await storageTest(
    'native IndexedDB coordinator conflict blocks retries until explicit reset',
    async () => {
      const key = runKey + '-coordinator';
      const a = new w.AudiobookSessionCoordinator(new w.AudiobookSessionStore(), key);
      const b = new w.AudiobookSessionCoordinator(new w.AudiobookSessionStore(), key);
      try {
        await Promise.all([a.restore(), b.restore()]);
        await b.persist({ ...w.emptySession(), position: 90 });
        for (let attempt = 0; attempt < 2; attempt++) {
          let failure;
          try {
            await a.persist(w.emptySession());
          } catch (error) {
            failure = error;
          }
          assert(failure instanceof w.AudiobookStorageConflictError);
        }
        await a.remove();
        await a.persist({ ...w.emptySession(), position: 2 });
        const observer = new w.AudiobookSessionStore();
        try {
          equal((await observer.load(key)).position, 2);
        } finally {
          await observer.close();
        }
        await a.remove();
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }
  );
  root.remove();
  return results;
};
