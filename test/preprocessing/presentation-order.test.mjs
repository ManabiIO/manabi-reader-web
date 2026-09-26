import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChapterOpeningController,
  chapterForResume
} from '../../apps/web/src/lib/preprocessing/presentation.mjs';
import { BookPreprocessingSession } from '../../apps/web/src/lib/preprocessing/session.mjs';
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture({ mount = () => () => {} } = {}) {
  const provider = {
    protocol: 1,
    id: 'fixture',
    release: '1',
    fingerprint: async () => 'f',
    preprocess: async (i) => ({
      protocol: 1,
      fingerprint: 'f',
      html: i.html,
      sidecar: { test: true },
      vocabulary: []
    }),
    mount,
    dispose: () => {}
  };
  const session = new BookPreprocessingSession({
    provider,
    bookKey: 'b',
    contextKey: 'c',
    resourceVersion: 'r',
    chapters: [
      { id: 'a', baseURL: 'https://fixture.test/a', html: 'a' },
      { id: 'b', baseURL: 'https://fixture.test/b', html: 'b' }
    ]
  });
  return { provider, session };
}
test('publication order is preprocess, mount, resources/layout/restore, admit, reveal', async () => {
  const order = [];
  const { session } = fixture({
    mount: () => {
      order.push('mount');
      return () => {};
    }
  });
  session.didPresent = () => {};
  const original = session.admitPresentation.bind(session);
  session.admitPresentation = async (...a) => {
    order.push('admit');
    await original(...a);
  };
  const controller = new ChapterOpeningController({
    session,
    stage: async () => {
      order.push('stage');
      return {
        root: {},
        prepare: async () => {
          order.push('restore');
        },
        commit: () => order.push('reveal'),
        rollback: () => {}
      };
    }
  });
  await controller.open(0);
  assert.deepEqual(order, ['stage', 'mount', 'restore', 'admit', 'reveal']);
  controller.dispose();
});
test('generation changed during layout restoration cannot become visible', async () => {
  let commits = 0,
    rollbacks = 0;
  const { session, provider } = fixture();
  session.didPresent = () => {};
  const controller = new ChapterOpeningController({
    session,
    stage: async () => ({
      root: {},
      prepare: async () => {
        provider.fingerprint = async () => 'changed';
      },
      commit: () => commits++,
      rollback: () => rollbacks++
    })
  });
  await assert.rejects(controller.open(0), { name: 'GenerationChanged' });
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
  controller.dispose();
});
test('new navigation aborts old stage signal and cannot reveal it', async () => {
  const { session } = fixture();
  session.didPresent = () => {};
  const gate = defer(),
    entered = defer();
  let oldSignal;
  const commits = [];
  const controller = new ChapterOpeningController({
    session,
    stage: async (_, { index, signal }) => ({
      root: {},
      prepare: async () => {
        if (index === 0) {
          oldSignal = signal;
          entered.resolve();
          await gate.promise;
        }
      },
      commit: () => commits.push(index),
      rollback: () => {}
    })
  });
  const a = controller.open(0);
  const rejected = assert.rejects(a, { name: 'AbortError' });
  await entered.promise;
  await controller.open(1);
  assert.equal(oldSignal.aborted, true);
  gate.resolve();
  await rejected;
  assert.deepEqual(commits, [1]);
  controller.dispose();
});
test('zero bookmark preserves a zero-character cover instead of skipping it', () => {
  assert.equal(chapterForResume([0, 0, 10], 0), 0);
  assert.equal(chapterForResume([0, 0, 0], 0), 0);
  assert.equal(chapterForResume([0, 10, 0, 20], 10), 3);
  assert.equal(chapterForResume([0, 10, 0, 20], 30), 3);
});
