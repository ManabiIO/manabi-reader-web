/** @license BSD-3-Clause */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookPreprocessingSession } from '../../apps/web/src/lib/preprocessing/session.mjs';
import { ChapterOpeningController } from '../../apps/web/src/lib/preprocessing/presentation.mjs';

test('on-demand interaction attaches without analysis and retires with its chapter', async () => {
  const session = new BookPreprocessingSession({
    bookKey: 'book',
    contextKey: 'context',
    resourceVersion: '1',
    chapters: [
      { id: 'one', baseURL: 'https://book.invalid/', html: '<p>日本語</p>' },
      { id: 'two', baseURL: 'https://book.invalid/', html: '<p>続き</p>' }
    ]
  });
  const order = [];
  const controller = new ChapterOpeningController({
    session,
    stage: async (result, { index }) => ({
      root: { index },
      prepare: async () => order.push(`layout${index}`),
      commit: () => order.push(`reveal${index}`),
      rollback: () => order.push(`remove${index}`)
    }),
    interaction: async (root, { result }) => {
      assert.equal(result.sidecar, null);
      order.push(`attach${root.index}`);
      return () => order.push(`detach${root.index}`);
    }
  });
  const result = await controller.open(0);
  assert.equal(result.html, '<p>日本語</p>');
  assert.deepEqual(order, ['attach0', 'layout0', 'reveal0']);
  await controller.open(1);
  assert.deepEqual(order.slice(3), ['attach1', 'layout1', 'reveal1', 'detach0', 'remove0']);
  controller.dispose();
  assert.deepEqual(order.slice(-2), ['detach1', 'remove1']);
});
test('a late interaction attachment is disposed after reader teardown and never revealed', async () => {
  const session = new BookPreprocessingSession({
    bookKey: 'book',
    contextKey: 'context',
    resourceVersion: '1',
    chapters: [{ id: 'one', baseURL: 'https://book.invalid/', html: '日本語' }]
  });
  let finish, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const calls = [];
  const controller = new ChapterOpeningController({
    session,
    stage: async () => ({
      root: {},
      commit: () => calls.push('reveal'),
      rollback: () => calls.push('rollback')
    }),
    interaction: () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  });
  const opening = controller.open(0);
  await entered;
  controller.dispose();
  finish(() => calls.push('detach'));
  await assert.rejects(opening, { name: 'AbortError' });
  assert.deepEqual(calls, ['detach', 'rollback']);
});
