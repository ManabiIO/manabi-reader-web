import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule } from './fixtures/offline-module.mjs';
import {
  MAX_TRACKER_IDLE_MINUTES,
  MAX_TRACKER_IDLE_SECONDS,
  trackerIdleSecondsFromMinutes
} from '../../apps/web/src/lib/components/settings/settings-number-policy.ts';

function subjectBoundary() {
  const writableSubject = (initial) => {
    let value = initial;
    const subscribers = new Set();
    return {
      getValue: () => value,
      next(next) {
        value = next;
        for (const subscriber of [...subscribers]) subscriber(value);
      },
      set(next) {
        this.next(next);
      },
      subscribe(subscriber) {
        subscribers.add(subscriber);
        subscriber(value);
        return { unsubscribe: () => subscribers.delete(subscriber) };
      }
    };
  };
  return { writableSubject };
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem: (key) => values.get(key),
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
    value: (key) => values.get(key)
  };
}

function numberFactory(path, store) {
  return loadOfflineModule(path, {
    modules: { '$lib/functions/svelte/store': subjectBoundary() }
  }).api[store];
}

test('number subject publishes the same default value it persists for an empty edit', () => {
  const backing = storage();
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-local-storage-subject.ts',
    'writableNumberLocalStorageSubject'
  );
  const subject = create(backing)('fontSize', 20);

  subject.next(undefined);

  assert.equal(subject.getValue(), 20);
  assert.equal(backing.value('fontSize'), '20');
});

for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  test(`number subject rejects non-finite write ${String(invalid)}`, () => {
    const backing = storage();
    const create = numberFactory(
      'apps/web/src/lib/data/internal/writable-number-local-storage-subject.ts',
      'writableNumberLocalStorageSubject'
    );
    const subject = create(backing)('lineHeight', 1.65);

    subject.next(invalid);

    assert.equal(subject.getValue(), 1.65);
    assert.equal(backing.value('lineHeight'), '1.65');
  });
}

test('number subject repairs a corrupted non-finite stored value on read without writing', () => {
  const backing = storage({ fontSize: 'NaN' });
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-local-storage-subject.ts',
    'writableNumberLocalStorageSubject'
  );
  const subject = create(backing)('fontSize', 20);

  assert.equal(subject.getValue(), 20);
  assert.equal(backing.value('fontSize'), 'NaN');
  assert.deepEqual(backing.writes, []);
});

test('number subject preserves finite zero and fractional values', () => {
  const backing = storage();
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-local-storage-subject.ts',
    'writableNumberLocalStorageSubject'
  );
  const subject = create(backing)('value', 10);

  subject.next(0);
  assert.equal(subject.getValue(), 0);
  assert.equal(backing.value('value'), '0');
  subject.next(1.25);
  assert.equal(subject.getValue(), 1.25);
  assert.equal(backing.value('value'), '1.25');
});

test('nullable number subject keeps explicit null and finite numbers', () => {
  const backing = storage();
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-or-null-local-storage-subject.ts',
    'writableNumberOrNullLocalStorageSubject'
  );
  const subject = create(backing)('fontWeight', null);

  subject.next(500);
  assert.equal(subject.getValue(), 500);
  assert.equal(backing.value('fontWeight'), '500');
  subject.next(null);
  assert.equal(subject.getValue(), null);
  assert.equal(backing.value('fontWeight'), 'null');
});

test('nullable number subject keeps null when its default is a number', () => {
  const backing = storage({ fontWeight: 'null' });
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-or-null-local-storage-subject.ts',
    'writableNumberOrNullLocalStorageSubject'
  );
  const subject = create(backing)('fontWeight', 400);

  assert.equal(subject.getValue(), null);
  subject.next(500);
  subject.next(null);
  assert.equal(subject.getValue(), null);
  assert.equal(backing.value('fontWeight'), 'null');
});

test('nullable number subject normalizes non-finite values to its default', () => {
  const backing = storage();
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-or-null-local-storage-subject.ts',
    'writableNumberOrNullLocalStorageSubject'
  );
  const subject = create(backing)('fontWeight', null);

  subject.next(Number.NaN);

  assert.equal(subject.getValue(), null);
  assert.equal(backing.value('fontWeight'), 'null');
});

test('failed persistence still prevents publication', () => {
  const create = numberFactory(
    'apps/web/src/lib/data/internal/writable-number-local-storage-subject.ts',
    'writableNumberLocalStorageSubject'
  );
  const backing = {
    getItem: () => undefined,
    setItem() {
      throw new Error('quota');
    },
    removeItem() {}
  };
  const subject = create(backing)('fontSize', 20);

  assert.throws(() => subject.next(24), /quota/);
  assert.equal(subject.getValue(), 20);
});

test('tracker idle limit is exactly twelve hours', () => {
  assert.equal(MAX_TRACKER_IDLE_MINUTES, 720);
  assert.equal(MAX_TRACKER_IDLE_SECONDS, 43_200);
  assert.equal(trackerIdleSecondsFromMinutes(720), 43_200);
});

test('tracker idle conversion preserves half-minute precision and floors seconds', () => {
  assert.equal(trackerIdleSecondsFromMinutes(0.5), 30);
  assert.equal(trackerIdleSecondsFromMinutes(1.234), 74);
});

test('tracker idle conversion clamps values above twelve hours instead of resetting to fifteen minutes', () => {
  assert.equal(trackerIdleSecondsFromMinutes(720.5), 43_200);
  assert.equal(trackerIdleSecondsFromMinutes(43_200), 43_200);
});

for (const invalid of [undefined, null, '', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`tracker idle conversion disables invalid value ${String(invalid)}`, () => {
    assert.equal(trackerIdleSecondsFromMinutes(invalid), 0);
  });
}
