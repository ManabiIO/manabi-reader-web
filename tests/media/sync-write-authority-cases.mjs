/** Production sync/store with controlled transport and write admission, not live-provider evidence. */
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { syncMedia } from '../../.cache/media-test-build/sync.js';

const scope = 'account:sync-review';
const key = 'content:' + '7'.repeat(64);
const info = (title) => ({ version: 1, title, duration: 12, width: 320, height: 180, addedAt: 1 });
const remote = (revision = 1) => ({
  kind: 'video_info',
  entity_id: key,
  book_key: key,
  revision,
  payload: info('Server title'),
  deleted: false
});
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message + ': ' + JSON.stringify({ actual, expected }));
};
const timeout = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Sync did not reach the controlled write')),
          4000
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const cases = [];
for (const method of ['accept', 'putLocal', 'prepare', 'ack', 'conflict']) {
  for (const stop of ['abort-null', 'abort-zero', 'account-revoked', 'live']) {
    cases.push({
      name: `${method}: ${stop} while sync write admission is delayed`,
      async run(factory) {
        const store = new MediaStore(factory, 'sync-write-' + crypto.randomUUID());
        const owner = new AbortController(),
          entered = deferred(),
          release = deferred();
        let current = true,
          intercepted = false;
        const statuses = [],
          requests = [];
        const original = store[method].bind(store);
        const result = (promise) =>
          promise.then(
            () => ({ ok: true }),
            (reason) => ({ ok: false, reason })
          );
        let operation;
        try {
          if (!['accept', 'putLocal'].includes(method))
            await store.edit(scope, 'video_info', key, key, info('Local title'));
          store[method] = async (...args) => {
            if (!intercepted && (method !== 'putLocal' || args[1] === 'sync')) {
              intercepted = true;
              entered.resolve();
              await release.promise;
            }
            return await original(...args);
          };
          operation = result(
            syncMedia(
              store,
              {
                userId: 'sync-review',
                isCurrent: () => current,
                async request(path, options) {
                  requests.push({ path, userId: options.userId });
                  if (path.startsWith('personal/changes/'))
                    return {
                      items: method === 'accept' ? [{ ...remote(), sequence: 1 }] : [],
                      next_cursor: method === 'accept' ? 1 : 0,
                      has_more: false
                    };
                  if (method === 'conflict') throw { status: 412, current: remote(2) };
                  return {
                    accepted: true,
                    mutation_id: options.value.mutation_id,
                    record: { ...remote(), payload: options.value.payload }
                  };
                }
              },
              owner.signal,
              (status) => statuses.push(status.state)
            )
          );
          await timeout(entered.promise);
          const before = {
            records: await store.records(scope),
            cursor: await store.local(scope, 'sync', 'cursor')
          };
          if (stop === 'abort-null') owner.abort(null);
          else if (stop === 'abort-zero') owner.abort(0);
          else if (stop === 'account-revoked') current = false;
          release.resolve();
          const settled = await operation;
          const after = {
            records: await store.records(scope),
            cursor: await store.local(scope, 'sync', 'cursor')
          };
          if (stop === 'live') {
            equal(settled.ok, true, 'Live sync failed');
            if (JSON.stringify(before) === JSON.stringify(after))
              throw new Error('A valid write was suppressed');
            equal(
              statuses.at(-1),
              method === 'conflict' ? 'conflict' : 'synced',
              'Wrong final state'
            );
          } else {
            equal(settled.ok, false, 'Retired sync reported success');
            if (stop.startsWith('abort-') && settled.reason !== owner.signal.reason)
              throw new Error('Original cancellation reason was replaced');
            if (stop === 'account-revoked' && !/account changed/i.test(String(settled.reason)))
              throw new Error('Wrong revocation error: ' + String(settled.reason));
            equal(after, before, 'Retired sync committed a delayed write');
            if (statuses.includes('synced') || statuses.includes('conflict'))
              throw new Error('Retired sync reported completion');
          }
          if (requests.some((request) => request.userId !== 'sync-review'))
            throw new Error('Transport account escaped the captured scope');
          return { method, stop, writesPreserved: true, requests: requests.length };
        } finally {
          release.resolve();
          owner.abort();
          if (operation) await operation;
          store[method] = original;
          await store.close();
        }
      }
    });
  }
}
