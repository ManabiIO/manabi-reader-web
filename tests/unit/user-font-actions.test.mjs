import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import {
  fontActionError,
  prepareUserFont,
  removeUserFont,
  saveUserFont,
  storedFontPaths
} from '../../apps/web/src/lib/components/settings/user-font-actions.ts';

const reserved = new Set(['YuKyokasho', 'Klee One', 'System Sans', 'Serif']);
const file = (name = 'custom.woff2', text = 'fixture font bytes') => new File([text], name);
const font = (name = 'Custom', fileName = 'custom.woff2') => ({
  name,
  fileName,
  path: `/userfonts/${encodeURIComponent(fileName)}`
});
function catalog(initial = []) {
  let fonts = initial;
  return {
    read: () => fonts,
    write: (value) => {
      fonts = value;
    }
  };
}
function selection(initial = 'YuKyokasho') {
  let name = initial;
  return {
    read: () => name,
    write: (value) => {
      name = value;
    }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const turn = () => new Promise((done) => setImmediate(done));

test('font draft trims names and accepts all supported extension cases', () => {
  for (const extension of ['woff2', 'WOFF', 'TtF', 'OTF']) {
    const result = prepareUserFont('  日本語 Custom  ', file('My Font.' + extension), [], reserved);
    assert.equal(result.font.name, '日本語 Custom');
    assert.equal(result.font.fileName, 'My Font.' + extension);
    assert.equal(result.font.path, '/userfonts/My%20Font.' + extension);
    assert.equal(result.mime, 'font/' + extension.toLowerCase());
  }
});

for (const [name, selected, message] of [
  ['', file(), /font name/],
  ['   ', file(), /font name/],
  ['a'.repeat(201), file(), /font name/],
  [' klee ONE ', file(), /built-in/],
  ['Custom', undefined, /Choose a font file/],
  ['Custom', file('bad.txt'), /WOFF2/],
  ['Custom', file('empty.woff', ''), /empty/],
  ['Custom', file('../bad.ttf'), /WOFF2/],
  ['Custom', file('bad\\font.ttf'), /WOFF2/],
  ['Custom', file('a'.repeat(256) + '.ttf'), /WOFF2/]
]) {
  test(`invalid font draft: ${message} / ${JSON.stringify(name.slice(0, 15))} / ${selected?.name.slice(0, 15)}`, () => {
    assert.throws(() => prepareUserFont(name, selected, [], reserved), message);
  });
}

test('font names compare case-insensitively and canonically without rewriting old entries', () => {
  const existing = [font('Café', 'old.ttf')];
  assert.throws(() => prepareUserFont('CAFE\u0301', file(), existing, reserved), /already stored/);
  assert.equal(existing[0].name, 'Café');
});

test('same filename and stylesheet catalogue limit reject before a write', () => {
  assert.throws(() => prepareUserFont('Different', file(), [font()], reserved), /already stored/);
  assert.throws(
    () =>
      prepareUserFont(
        'Different',
        file(),
        Array.from({ length: 256 }, (_, i) => font(String(i), `${i}.ttf`)),
        reserved
      ),
    /Remove a stored font/
  );
});

test('cache failure never publishes font metadata; retry remains usable', async () => {
  const c = catalog();
  await assert.rejects(
    saveUserFont(
      {
        put: async () => {
          throw new Error('quota');
        }
      },
      c,
      'Custom',
      file(),
      reserved
    ),
    /quota/
  );
  assert.deepEqual(c.read(), []);
  await saveUserFont({ put: async () => {} }, c, 'Custom', file(), reserved);
  assert.deepEqual(c.read(), [font()]);
});

test('simultaneous same-page imports revalidate after serial admission', async () => {
  const barrier = deferred();
  const c = catalog();
  let puts = 0;
  const cache = {
    put: async () => {
      puts += 1;
      await barrier.promise;
    }
  };
  const first = saveUserFont(cache, c, 'Custom', file(), reserved);
  const second = saveUserFont(cache, c, 'Custom', file(), reserved);
  const rejection = assert.rejects(second, /already stored/);
  await turn();
  assert.equal(puts, 1);
  barrier.resolve();
  await first;
  await rejection;
  assert.equal(puts, 1);
  assert.deepEqual(c.read(), [font()]);
});

test('save retains new nonconflicting catalogue entries received during cache I/O', async () => {
  const c = catalog();
  await saveUserFont(
    {
      put: async () => {
        c.write([font('Other', 'other.ttf')]);
      }
    },
    c,
    'Custom',
    file(),
    reserved
  );
  assert.deepEqual(c.read(), [font('Other', 'other.ttf'), font()]);
});

test('late conflicting catalogue edit is not overwritten or duplicated', async () => {
  const c = catalog();
  const newer = font('Custom', 'newer.ttf');
  await assert.rejects(
    saveUserFont(
      {
        put: async () => {
          c.write([newer]);
        }
      },
      c,
      'Custom',
      file(),
      reserved
    ),
    /already stored/
  );
  assert.deepEqual(c.read(), [newer]);
});

test('same exact concurrent metadata is retained once', async () => {
  const c = catalog();
  await saveUserFont(
    {
      put: async () => {
        c.write([font()]);
      }
    },
    c,
    'Custom',
    file(),
    reserved
  );
  assert.deepEqual(c.read(), [font()]);
});

test('font save response has the captured bytes and normalized MIME', async () => {
  const c = catalog();
  let captured;
  await saveUserFont(
    {
      put: async (path, response) => {
        captured = [path, response.headers.get('content-type'), await response.text()];
      }
    },
    c,
    ' Upper ',
    file('UPPER.OTF', 'original bytes'),
    reserved
  );
  assert.deepEqual(captured, ['/userfonts/UPPER.OTF', 'font/otf', 'original bytes']);
  assert.equal(c.read()[0].name, 'Upper');
});

for (const current of ['YuKyokasho', 'System Sans', 'An external installed font', '']) {
  test(`removing custom font preserves unrelated choice ${JSON.stringify(current)}`, async () => {
    const c = catalog([font()]);
    const s = selection(current);
    await removeUserFont({ delete: async () => true }, c, font(), s);
    assert.deepEqual(c.read(), []);
    assert.equal(s.read(), current);
  });
}

test('only the removed currently selected face returns to the default', async () => {
  const c = catalog([font(), font('Other', 'other.ttf')]);
  const s = selection('Custom');
  await removeUserFont({ delete: async () => false }, c, font(), s);
  assert.equal(s.read(), '');
  assert.deepEqual(c.read(), [font('Other', 'other.ttf')]);
});

test('delete failure preserves catalogue and selected face', async () => {
  const c = catalog([font()]);
  const s = selection('Custom');
  await assert.rejects(
    removeUserFont(
      {
        delete: async () => {
          throw new Error('denied');
        }
      },
      c,
      font(),
      s
    ),
    /denied/
  );
  assert.deepEqual(c.read(), [font()]);
  assert.equal(s.read(), 'Custom');
});

test('remove snapshots its target and preserves a newer selected family', async () => {
  const c = catalog([font(), font('Other', 'other.ttf')]);
  const s = selection('Custom');
  const target = font();
  let removedPath;
  const pending = removeUserFont(
    {
      delete: async (path) => {
        removedPath = path;
        s.write('Other');
      }
    },
    c,
    target,
    s
  );
  target.name = 'Other';
  target.fileName = 'other.ttf';
  target.path = '/userfonts/other.ttf';
  await pending;
  assert.equal(removedPath, '/userfonts/custom.woff2');
  assert.equal(s.read(), 'Other');
  assert.deepEqual(c.read(), [font('Other', 'other.ttf')]);
});

test('stale removal neither deletes nor clears replacement metadata', async () => {
  const c = catalog([font('New name')]);
  const s = selection('New name');
  let deletes = 0;
  await removeUserFont(
    {
      delete: async () => {
        deletes += 1;
      }
    },
    c,
    font(),
    s
  );
  assert.equal(deletes, 0);
  assert.deepEqual(c.read(), [font('New name')]);
  assert.equal(s.read(), 'New name');
});

test('metadata replacement during deletion is not erased', async () => {
  const c = catalog([font()]);
  const s = selection('New name');
  await removeUserFont(
    {
      delete: async () => {
        c.write([font('New name')]);
        return true;
      }
    },
    c,
    font(),
    s
  );
  assert.deepEqual(c.read(), [font('New name')]);
  assert.equal(s.read(), 'New name');
});

test('malformed restored path cannot delete another cache key', async () => {
  const malformed = { ...font(), path: '/app-shell.js' };
  const c = catalog([malformed]);
  let deletes = 0;
  await removeUserFont(
    {
      delete: async () => {
        deletes += 1;
      }
    },
    c,
    malformed,
    selection()
  );
  assert.equal(deletes, 0);
  assert.deepEqual(c.read(), []);
});

test('cache inspection has no mutation authority and preserves encoded names', async () => {
  const paths = await storedFontPaths({
    keys: async () => [new Request('https://reader.example/userfonts/%E6%97%A5.ttf')]
  });
  assert.deepEqual([...paths], ['/userfonts/%E6%97%A5.ttf']);
});

test('cache inspection rejection and unusual errors remain reportable', async () => {
  await assert.rejects(
    storedFontPaths({
      keys: async () => {
        throw new Error('denied');
      }
    }),
    /denied/
  );
  assert.equal(fontActionError(new Error('quota')), 'quota');
  assert.match(fontActionError(null), /unavailable/);
});

test('metadata persistence failure is reported without pretending cache and catalogue are atomic', async () => {
  let puts = 0;
  const c = {
    read: () => [],
    write: () => {
      throw new Error('metadata quota');
    }
  };
  await assert.rejects(
    saveUserFont(
      {
        put: async () => {
          puts += 1;
        }
      },
      c,
      'Custom',
      file(),
      reserved
    ),
    /metadata quota/
  );
  assert.equal(puts, 1);
  assert.deepEqual(c.read(), []);
});

test('failed removal metadata write does not reset the selected style', async () => {
  let deletes = 0;
  const c = {
    read: () => [font()],
    write: () => {
      throw new Error('metadata quota');
    }
  };
  const s = selection('Custom');
  await assert.rejects(
    removeUserFont(
      {
        delete: async () => {
          deletes += 1;
          return true;
        }
      },
      c,
      font(),
      s
    ),
    /metadata quota/
  );
  assert.equal(deletes, 1);
  assert.equal(s.read(), 'Custom');
  assert.deepEqual(c.read(), [font()]);
});
