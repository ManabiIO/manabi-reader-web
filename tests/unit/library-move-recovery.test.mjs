import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeMove,
  planMove,
  renameSeriesOnDisk
} from '../../apps/web/src/lib/library/file-operations.ts';
import { filesystem, deferred } from './helpers/local-file-fixture.mjs';

async function fixture() {
  const fs = filesystem();
  await fs.put('One/1.epub', 'one');
  await fs.put('Two/2.epub', 'two');
  await fs.put('Spare/1.epub', 'one');
  const plan = await planMove(fs.root, 'source', '', 'My Series', ['One/1.epub', 'Two/2.epub']);
  fs.events.length = 0;
  return { ...fs, plan };
}
const noOp = async () => {};

test('invalid display names cannot create an empty canonical sidecar', async () => {
  const fs = await fixture();
  await fs.put('Series/.Manabi-Reader.yaml', 'name: Legacy\n');
  fs.events.length = 0;
  await assert.rejects(renameSeriesOnDisk(fs.root, 'Series', '  '));
  await assert.rejects(fs.read('Series/.manabi-reader.yaml'), { name: 'NotFoundError' });
  assert.equal(await fs.read('Series/.Manabi-Reader.yaml'), 'name: Legacy\n');
  assert.deepEqual(fs.events, []);
});

test('a changed canonical sidecar during stream preparation is not overwritten', async () => {
  const fs = await fixture();
  await fs.put('Series/.manabi-reader.yaml', 'name: Old\n');
  fs.hooks.createWritable = async (handle) => {
    if (handle.path === 'Series/.manabi-reader.yaml') await fs.put(handle.path, 'name: External\n');
  };
  await assert.rejects(renameSeriesOnDisk(fs.root, 'Series', 'Requested'), /changed elsewhere/);
  assert.equal(await fs.read('Series/.manabi-reader.yaml'), 'name: External\n');
  assert.ok(fs.events.some(([op]) => op === 'abort'));
});

test('a changing legacy sidecar cannot be masked by a stale canonical rename', async () => {
  const fs = await fixture();
  await fs.put('Series/.Manabi-Reader.yaml', 'name: Old\n');
  fs.hooks.createWritable = async () => {
    await fs.put('Series/.Manabi-Reader.yaml', 'name: External\n');
  };
  await assert.rejects(renameSeriesOnDisk(fs.root, 'Series', 'Requested'), /changed elsewhere/);
  assert.equal(await fs.read('Series/.Manabi-Reader.yaml'), 'name: External\n');
  assert.ok(!fs.events.some(([op]) => op === 'write'));
  await assert.rejects(fs.read('Series/.manabi-reader.yaml'), { name: 'NotFoundError' });
});

test('recovery rejects an invalid display name before creating directories or files', async () => {
  const fs = await fixture();
  fs.plan.name = '';
  await assert.rejects(executeMove(fs.root, fs.plan, noOp, noOp));
  assert.deepEqual(fs.events, []);
});

test('recovery validates Unicode-normalized filename collisions before touching disk', async () => {
  const fs = await fixture();
  await fs.put('One/\u00e9.epub', 'one');
  await fs.put('Two/e\u0301.epub', 'two');
  fs.plan.files = [
    { ...fs.plan.files[0], from: 'One/\u00e9.epub', to: 'My Series/\u00e9.epub' },
    { ...fs.plan.files[1], from: 'Two/e\u0301.epub', to: 'My Series/e\u0301.epub' }
  ];
  fs.events.length = 0;
  await assert.rejects(executeMove(fs.root, fs.plan, noOp, noOp), /Invalid move recovery path/);
  assert.deepEqual(fs.events, []);
});

test('caller plan mutation while a directory read waits cannot change deleted paths', async () => {
  const fs = await fixture();
  const gate = deferred(),
    entered = deferred();
  const original = fs.root.getDirectoryHandle.bind(fs.root);
  fs.root.getDirectoryHandle = async (...args) => {
    entered.resolve();
    await gate.promise;
    return original(...args);
  };
  const running = executeMove(fs.root, fs.plan, noOp, noOp);
  await entered.promise;
  fs.plan.files[0].from = 'Spare/1.epub';
  gate.resolve();
  await running;
  assert.equal(await fs.read('Spare/1.epub'), 'one');
  await assert.rejects(fs.read('One/1.epub'), { name: 'NotFoundError' });
});

test('a journal callback cannot mutate the execution plan or remove an unselected copy', async () => {
  const fs = await fixture();
  await executeMove(
    fs.root,
    fs.plan,
    async (checkpoint) => {
      checkpoint.files[0].from = 'Spare/1.epub';
    },
    noOp
  );
  assert.equal(await fs.read('Spare/1.epub'), 'one');
  await assert.rejects(fs.read('One/1.epub'), { name: 'NotFoundError' });
});

test('a relink callback cannot mutate the paths used by the final byte check and unlink', async () => {
  const fs = await fixture();
  await executeMove(fs.root, fs.plan, noOp, async (file) => {
    if (file.from === 'One/1.epub') file.from = 'Spare/1.epub';
  });
  assert.equal(await fs.read('Spare/1.epub'), 'one');
  await assert.rejects(fs.read('One/1.epub'), { name: 'NotFoundError' });
});

test('a failed final checkpoint is retried, not mistaken for durable completion', async () => {
  const fs = await fixture();
  let failed = false;
  const checkpoints = [];
  const save = async (plan) => {
    checkpoints.push(plan.phase);
    if (plan.phase === 'done' && !failed) {
      failed = true;
      throw new Error('Injected commit failure');
    }
  };
  await assert.rejects(executeMove(fs.root, fs.plan, save, noOp), /Injected commit failure/);
  await executeMove(fs.root, fs.plan, save, noOp);
  assert.equal(checkpoints.filter((phase) => phase === 'done').length, 2);
  assert.equal(await fs.read('My Series/1.epub'), 'one');
  assert.equal(await fs.read('My Series/2.epub'), 'two');
});

test('successful progress checkpoints do not mutate the caller-owned recovery snapshot', async () => {
  const fs = await fixture();
  const before = globalThis.structuredClone(fs.plan);
  await executeMove(fs.root, fs.plan, noOp, noOp);
  assert.deepEqual(fs.plan, before);
});

test('revocation during a staged file write aborts publication and preserves all originals', async () => {
  const fs = await fixture();
  let revoked = false;
  fs.hooks.write = async (handle) => {
    if (handle.path === 'My Series/1.epub') revoked = true;
  };
  const guard = () => {
    if (revoked) throw new Error('Revoked');
  };
  await assert.rejects(executeMove(fs.root, fs.plan, noOp, noOp, guard), /Revoked/);
  assert.equal(await fs.read('One/1.epub'), 'one');
  assert.equal(await fs.read('Two/2.epub'), 'two');
  assert.ok(fs.events.some(([op, path]) => op === 'abort' && path === 'My Series/1.epub'));
  assert.ok(!fs.events.some(([op]) => op === 'delete'));
});

test('revocation after relinking stops unlinking and leaves the durable copied journal resumable', async () => {
  const fs = await fixture();
  let revoked = false,
    persisted;
  const guard = () => {
    if (revoked) throw new Error('Revoked');
  };
  const save = async (plan) => {
    persisted = globalThis.structuredClone(plan);
  };
  await assert.rejects(
    executeMove(
      fs.root,
      fs.plan,
      save,
      async () => {
        revoked = true;
      },
      guard
    ),
    /Revoked/
  );
  assert.equal(persisted.phase, 'copied');
  assert.equal(await fs.read('One/1.epub'), 'one');
  assert.equal(await fs.read('Two/2.epub'), 'two');
  revoked = false;
  await executeMove(fs.root, persisted, save, noOp, guard);
  assert.equal(persisted.phase, 'done');
});

test('unchanged legacy and canonical metadata still support ordinary series rename', async () => {
  for (const filename of ['.manabi-reader.yaml', '.Manabi-Reader.yaml']) {
    const fs = await fixture();
    await fs.put(`Series/${filename}`, 'name: Before\n');
    await renameSeriesOnDisk(fs.root, 'Series', 'After');
    assert.equal(await fs.read('Series/.manabi-reader.yaml'), 'name: "After"\n');
  }
});

test('failed rename cleanup never removes a nonempty external canonical edit', async () => {
  const fs = await fixture();
  await fs.put('Series/.Manabi-Reader.yaml', 'name: Before\n');
  fs.hooks.write = async (handle) => {
    await fs.put(handle.path, 'name: External\n');
    throw new Error('Injected write failure');
  };
  await assert.rejects(
    renameSeriesOnDisk(fs.root, 'Series', 'Requested'),
    /Injected write failure/
  );
  assert.equal(await fs.read('Series/.manabi-reader.yaml'), 'name: External\n');
});
