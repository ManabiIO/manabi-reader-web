/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PageTurnSequence,
  PAGE_TURN_DURATION
} from '../../apps/web/src/lib/foliate-epub/page-turn-sequence.ts';

const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function harness({ delay = false, reduced = false, page = 5, end = 100 } = {}) {
  let now = 0;
  let id = 0;
  let pending;
  let cancels = 0;
  const tasks = new Map();
  const turns = [];
  const commits = [];
  const errors = [];
  const loads = [];
  const clock = {
    now: () => now,
    frame: (f) => {
      tasks.set(++id, { at: now + 10, f });
      return id;
    },
    cancelFrame: (i) => tasks.delete(i),
    timer: (f, ms) => {
      tasks.set(++id, { at: now + ms, f });
      return id;
    },
    clearTimer: (i) => tasks.delete(i)
  };
  const port = {
    async prepare(direction) {
      const token = {};
      pending = token;
      if (delay) await new Promise((resolve, reject) => loads.push({ resolve, reject }));
      if (pending !== token || page + direction < 0 || page + direction > end) return null;
      const turn = { direction, frames: [], cancelled: false, committed: false, readyAt: now };
      turns.push(turn);
      return {
        update: (p) => {
          turn.frames.push(p);
          return pending === token;
        },
        commit: () => {
          if (pending !== token) return false;
          turn.committed = true;
          page += direction;
          commits.push(page);
          pending = undefined;
          return true;
        },
        cancel: () => {
          turn.cancelled = true;
          if (pending === token) pending = undefined;
        }
      };
    },
    cancel: () => {
      cancels++;
      pending = undefined;
    },
    reducedMotion: () => reduced,
    error: (e) => errors.push(e)
  };
  const sequence = new PageTurnSequence(port, clock);
  const advance = async (ms) => {
    const to = now + ms;
    await tick();
    for (;;) {
      const due = [...tasks].filter(([, t]) => t.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      tasks.delete(due[0]);
      due[1].f(now);
      await tick();
    }
    now = to;
    await tick();
  };
  return {
    sequence,
    advance,
    turns,
    commits,
    errors,
    loads,
    tasks,
    port,
    get page() {
      return page;
    },
    get cancels() {
      return cancels;
    },
    setReduced(value) {
      reduced = value;
    }
  };
}

test('duration is 70% of the original 220ms', () => assert.equal(PAGE_TURN_DURATION, 154));

test('a single turn animates immediately and finishes at the shorter duration', async () => {
  const h = harness();
  h.sequence.request(1);
  await h.advance(100);
  assert.equal(h.commits.length, 0);
  assert.ok(h.turns[0].frames.length > 0);
  await h.advance(60);
  assert.deepEqual(h.commits, [6]);
  assert.equal(h.sequence.active, false);
});

test('fast buttons animate the leading turn, skip middle animations, and animate the tail', async () => {
  const h = harness();
  h.sequence.request(1);
  await h.advance(30);
  for (let i = 0; i < 4; i++) {
    h.sequence.request(1);
    await h.advance(30);
  }
  assert.deepEqual(h.commits, [6, 7, 8, 9]);
  assert.ok(h.turns[0].frames.length > 0);
  assert.ok(h.turns.slice(1).every((t) => !t.frames.length));
  await h.advance(89);
  assert.equal(h.commits.length, 4);
  await h.advance(171);
  assert.deepEqual(h.commits, [6, 7, 8, 9, 10]);
  assert.ok(h.turns.at(-1).frames.length > 0);
  assert.equal(h.sequence.active, false);
});

test('held-key repeat survives the OS initial delay and a slow repeat cadence', async () => {
  const h = harness();
  h.sequence.request(1, { key: 'KeyL' });
  await h.advance(600);
  assert.equal(h.page, 6);
  for (let i = 0; i < 5; i++) {
    h.sequence.request(1, { repeat: true, key: 'KeyL' });
    await h.advance(300);
  }
  assert.equal(h.page, 10);
  assert.ok(h.turns.slice(1).every((t) => !t.frames.length));
  h.sequence.release('ShiftLeft');
  await h.advance(200);
  assert.equal(h.page, 10);
  h.sequence.release('KeyL');
  await h.advance(160);
  assert.equal(h.page, 11);
  assert.ok(h.turns.at(-1).frames.length);
  assert.equal(h.tasks.size, 0);
});

test('key released during neighbor preparation still animates its final turn', async () => {
  const h = harness({ delay: true });
  h.sequence.request(1, { repeat: true, key: 'ArrowRight' });
  h.sequence.release('ArrowRight');
  h.loads.shift().resolve();
  await h.advance(160);
  assert.deepEqual(h.commits, [6]);
  assert.ok(h.turns[0].frames.length > 0);
});

test('auto-repeat without explicit key identity falls back to the quiet timer', async () => {
  const h = harness();
  h.sequence.request(1, { repeat: true });
  await h.advance(119);
  assert.equal(h.turns[0].frames.length, 0);
  await h.advance(161);
  assert.equal(h.page, 6);
});

test('requests during loading are preserved with only one prepared view', async () => {
  const h = harness({ delay: true });
  for (let i = 0; i < 10; i++) h.sequence.request(1);
  assert.equal(h.loads.length, 1);
  for (let i = 0; i < 9; i++) {
    h.loads.shift().resolve();
    await tick();
    assert.equal(h.loads.length, 1);
  }
  assert.equal(h.commits.length, 9);
  assert.ok(h.turns.every((t) => !t.frames.length));
  h.loads.shift().resolve();
  await h.advance(280);
  assert.equal(h.commits.length, 10);
  assert.ok(h.turns.at(-1).frames.length);
  assert.equal(h.tasks.size, 0);
});

for (const directions of [
  [1, 1, -1, -1, 1],
  [-1, -1, 1, 1, -1]
]) {
  test(`preserves reversal order ${directions}`, async () => {
    const h = harness();
    let expected = 5;
    const path = [];
    for (const d of directions) {
      h.sequence.request(d);
      expected += d;
      path.push(expected);
      await h.advance(20);
    }
    await h.advance(280);
    assert.deepEqual(h.commits, path);
  });
}

for (const [page, direction] of [
  [0, -1],
  [10, 1]
]) {
  test(`at edge ${page}, impossible intents do not swallow the later reversal`, async () => {
    const h = harness({ page, end: 10 });
    h.sequence.request(direction);
    h.sequence.request(direction);
    h.sequence.request(-direction);
    await h.advance(280);
    assert.deepEqual(h.commits, [page - direction]);
  });
}

test('another request interrupts the trailing animation without a replay or extra page', async () => {
  const h = harness();
  h.sequence.request(1);
  await h.advance(30);
  h.sequence.request(1);
  await h.advance(150);
  assert.ok(h.turns[1].frames.length);
  h.sequence.request(-1);
  await h.advance(280);
  assert.deepEqual(h.commits, [6, 7, 6]);
  assert.equal(h.tasks.size, 0);
});

test('reduced motion commits all turns without waiting for key release', async () => {
  const h = harness({ reduced: true });
  for (let i = 0; i < 10; i++) h.sequence.request(1, { repeat: true, key: 'ArrowRight' });
  await tick();
  assert.equal(h.page, 15);
  assert.ok(h.turns.every((t) => !t.frames.length));
  assert.equal(h.tasks.size, 0);
});

test('enabling reduced motion during an animation finishes on the next frame', async () => {
  const h = harness();
  h.sequence.request(1);
  await h.advance(20);
  h.setReduced(true);
  await h.advance(10);
  assert.equal(h.page, 6);
});

for (const phase of ['loading', 'animation', 'held-tail']) {
  test(`cancellation clears ${phase} and stale completion cannot publish`, async () => {
    const h = harness({ delay: phase === 'loading' });
    h.sequence.request(1, phase === 'held-tail' ? { repeat: true, key: 'ArrowRight' } : {});
    await h.advance(20);
    h.sequence.cancel();
    for (const load of h.loads.splice(0)) load.resolve();
    await h.advance(1000);
    assert.equal(h.page, 5);
    assert.equal(h.sequence.active, false);
    assert.equal(h.tasks.size, 0);
    h.sequence.request(-1);
    if (phase === 'loading') h.loads.shift().resolve();
    await h.advance(160);
    assert.equal(h.page, 4);
  });
}

test('failed preparation reports once, clears the burst, and allows retry', async () => {
  const h = harness({ delay: true });
  h.sequence.request(1);
  h.sequence.request(1);
  h.loads.shift().reject(new Error('load failed'));
  await tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.page, 5);
  assert.equal(h.sequence.active, false);
  h.sequence.request(1);
  h.loads.shift().resolve();
  await h.advance(160);
  assert.equal(h.page, 6);
});

for (const method of ['update', 'commit']) {
  test(`${method} exception cancels the sequence and reports once`, async () => {
    const h = harness();
    const prepare = h.port.prepare;
    h.port.prepare = async (direction) => {
      const turn = await prepare(direction);
      turn[method] = () => {
        throw new Error('render failed');
      };
      return turn;
    };
    h.sequence.request(1);
    await h.advance(500);
    assert.equal(h.errors.length, 1);
    assert.equal(h.page, 5);
    assert.equal(h.tasks.size, 0);
    assert.equal(h.sequence.active, false);
  });
}

test('invalid directions are ignored', async () => {
  const h = harness();
  for (const d of [0, 2, -2, NaN]) h.sequence.request(d);
  await h.advance(1000);
  assert.equal(h.turns.length, 0);
  assert.equal(h.sequence.active, false);
});
