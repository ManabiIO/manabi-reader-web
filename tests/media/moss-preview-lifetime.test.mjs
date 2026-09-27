/** Actual progressive orchestration, with scripted inference and decoded PCM, not real ASR. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeProgressively } from '../../.cache/media-test-build/progressive-transcription.js';
import {
  newProgressiveState,
  SAMPLE_RATE
} from '../../.cache/media-test-build/moss-progressive.js';

const fresh = (duration = 2) => ({
  version: 2,
  progressive: newProgressiveState(),
  id: '77777777-7777-4777-8777-777777777777',
  mediaKey: 'content:' + 'a'.repeat(64),
  language: 'ja',
  audioTrack: '1',
  duration,
  status: 'running',
  nextWindow: 0,
  cues: [],
  modelSha256: 'a'.repeat(64),
  engineRevision: 'scripted-test',
  createdAt: 1
});
const prefix = '[0][S01]日本語[1][1][S01]続き',
  final = prefix + '[2]';
const decode = async (_job, a, b) => new Float32Array(Math.round((b - a) * SAMPLE_RATE)).fill(0.1);
async function run(
  transcribe,
  { duration = 2, notify = () => {}, signal = new AbortController().signal } = {}
) {
  const checkpoints = [];
  const completed = await transcribeProgressively(fresh(duration), {
    engine: { prepare: async () => {}, transcribe },
    decode,
    signal,
    checkpoint: async (job) => {
      checkpoints.push(structuredClone(job));
      return job;
    },
    notify
  });
  return { completed, checkpoints };
}
test('a throwing provisional renderer cannot fail valid final recognition', async () => {
  let previews = 0;
  const { completed, checkpoints } = await run(
    async (_pcm, _signal, partial) => {
      partial(prefix);
      partial(final);
      return final;
    },
    {
      notify: (p) => {
        if (p.provisional) {
          previews++;
          throw new Error('optional renderer failed');
        }
      }
    }
  );
  assert.equal(previews, 1);
  assert.deepEqual(
    completed.cues.map((c) => c.text),
    ['日本語', '続き']
  );
  assert.equal(checkpoints.length, 1);
  assert.equal(completed.nextWindow, 1);
});
test('an invalid custom-engine preview disables previews, not final parsing', async () => {
  const previews = [];
  const { completed } = await run(
    async (_pcm, _signal, partial) => {
      partial(null);
      partial(prefix);
      return final;
    },
    {
      notify: (p) => {
        if (p.provisional) previews.push(p.provisional);
      }
    }
  );
  assert.equal(previews.length, 0);
  assert.deepEqual(
    completed.cues.map((c) => c.text),
    ['日本語', '続き']
  );
});
test('invalid final output still fails after an invalid preview', async () => {
  await assert.rejects(
    run(async (_pcm, _signal, partial) => {
      partial(null);
      return 'malformed final';
    }),
    /Malformed MOSS output/
  );
});
test('preview-triggered cancellation cannot advance the checkpoint', async () => {
  const controller = new AbortController();
  let saved = 0;
  await assert.rejects(
    transcribeProgressively(fresh(), {
      engine: {
        prepare: async () => {},
        transcribe: async (_pcm, _signal, partial) => {
          partial(prefix);
          assert.doesNotThrow(() => partial(prefix));
          return final;
        }
      },
      decode,
      signal: controller.signal,
      checkpoint: async (job) => {
        saved++;
        return job;
      },
      notify: (p) => {
        if (p.provisional) controller.abort();
      }
    }),
    { name: 'AbortError' }
  );
  assert.equal(saved, 0);
});
test('late preview after rejection is inert and preserves the inference error', async () => {
  let late;
  const error = new Error('authoritative inference failed');
  const events = [];
  await assert.rejects(
    run(
      async (_pcm, _signal, partial) => {
        late = partial;
        throw error;
      },
      { notify: (p) => events.push(p) }
    ),
    (e) => e === error
  );
  const count = events.length;
  assert.doesNotThrow(() => late(null));
  late(prefix);
  assert.equal(events.length, count);
});
test('a previous inference cannot inject a preview during the next window', async () => {
  let previous,
    calls = 0;
  const previews = [];
  const { completed } = await run(
    async (_pcm, _signal, partial) => {
      if (calls++ === 0) {
        previous = partial;
        partial(prefix);
        return final;
      }
      previous(prefix);
      partial(prefix);
      return final;
    },
    {
      duration: 15,
      notify: (p) => {
        if (p.provisional) previews.push(p.provisional);
      }
    }
  );
  assert.equal(calls, 2);
  assert.equal(previews.length, 2);
  assert.equal(previews[0][0].start, 0);
  assert.equal(previews[1][0].start, 8);
  assert.deepEqual(
    completed.cues.map((c) => c.start),
    [0, 1, 8, 9]
  );
});
