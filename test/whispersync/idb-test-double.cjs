/**
 * Deterministic transaction-boundary double, NOT an IndexedDB implementation.
 * Serializes transactions, snapshots at their start, delivers request callbacks,
 * commits atomically, and supports abort/commit failure. Native engine tests are
 * separately required in browser-tests.js; this does not replace those gates.
 */
class TransactionFactory {
  constructor() {
    this.values = new Map();
    this.queue = Promise.resolve();
    this.connections = [];
    this.failNextCommit = undefined;
  }
  open() {
    const request = {};
    // The transaction callbacks below intentionally retain the factory instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const factory = this;
    const db = {
      closed: false,
      objectStoreNames: { contains: () => true },
      close() {
        this.closed = true;
      },
      transaction(name, mode) {
        if (this.closed) throw new DOMException('Connection closed', 'InvalidStateError');
        const operations = [];
        let aborted = false,
          values;
        const transaction = {
          error: null,
          abort() {
            aborted = true;
          },
          objectStore() {
            const enqueue = (operation) => {
              const result = {};
              operations.push(() => {
                result.result = operation();
                result.onsuccess?.();
              });
              return result;
            };
            return {
              get(key) {
                return enqueue(() => structuredClone(values.get(key)));
              },
              put(value, key) {
                const snapshot = structuredClone(value);
                return enqueue(() => {
                  values.set(key, snapshot);
                  return key;
                });
              },
              delete(key) {
                return enqueue(() => {
                  values.delete(key);
                });
              }
            };
          }
        };
        factory.queue = factory.queue.then(async () => {
          values = structuredClone(factory.values);
          while (operations.length && !aborted) {
            try {
              operations.shift()();
            } catch (error) {
              transaction.error = error;
              aborted = true;
            }
            await Promise.resolve();
          }
          if (mode === 'readwrite' && factory.failNextCommit && !aborted) {
            transaction.error = factory.failNextCommit;
            factory.failNextCommit = undefined;
            aborted = true;
          }
          if (aborted) transaction.onabort?.();
          else {
            if (mode === 'readwrite') factory.values = values;
            transaction.oncomplete?.();
          }
        });
        return transaction;
      }
    };
    factory.connections.push(db);
    queueMicrotask(() => {
      request.result = db;
      request.onsuccess?.();
    });
    return request;
  }
}
module.exports = { TransactionFactory };
