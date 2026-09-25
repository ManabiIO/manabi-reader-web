/** Deterministic IDB transaction-boundary double, NOT an IndexedDB implementation.
 * Adapted from the repository's test/whispersync/idb-test-double.cjs. Serializes
 * transactions and commits atomically; real engine coverage remains a separate gate.
 */
export class RangeDouble {
  static bound(lower, upper) { return { lower, upper }; }
}
export class TransactionFactory {
  tables = new Map();
  queue = Promise.resolve();
  connections = [];
  failNextCommit;
  putCount = 0;
  reads = [];
  transactions = [];
  failPutNumber;
  holdOpen = false;
  openings = [];
  values(name = 'records') { return this.tables.get(name) ?? new Map(); }
  releaseOpen() { for (const fn of this.openings.splice(0)) fn(); }
  open() {
    const request = {};
    const factory = this;
    const db = {
      closed: false,
      objectStoreNames: { contains: () => true },
      close() { this.closed = true; },
      transaction(name, mode) {
        if (this.closed) throw new DOMException('Connection closed', 'InvalidStateError');
        const operations = [];
        let aborted = false, tables;
        const names = Array.isArray(name) ? name : [name];
        factory.transactions.push({names, mode});
        const transaction = {
          error: null,
          abort() { aborted = true; },
          objectStore(storeName = names[0]) {
            if (!names.includes(storeName)) throw Error("Wrong transaction store");
            const values = () => tables.get(storeName);
            const enqueue = op => {
              const result = {};
              operations.push(() => { result.result = op(); result.onsuccess?.(); });
              return result;
            };
            return {
              get(key) { factory.reads.push({store:storeName, operation:"get", key}); return enqueue(() => structuredClone(values().get(key))); },
              getAll(query) { factory.reads.push({store:storeName, operation:"getAll", query}); return enqueue(() => [...values().entries()].filter(([key]) => !query || key >= query.lower && key <= query.upper).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,v]) => structuredClone(v))); },
              put(value, key) {
                const snapshot = structuredClone(value);
                if (++factory.putCount === factory.failPutNumber) throw new DOMException('Injected quota failure', 'QuotaExceededError');
                return enqueue(() => { values().set(key, snapshot); return key; });
              },
              delete(key) { return enqueue(() => values().delete(key)); }
            };
          }
        };
        factory.queue = factory.queue.then(async () => {
          tables = new Map(names.map(n => [n, structuredClone(factory.tables.get(n) ?? new Map())]));
          while (operations.length && !aborted) {
            try { operations.shift()(); } catch (error) { transaction.error = error; aborted = true; }
            await Promise.resolve();
          }
          if (mode === 'readwrite' && factory.failNextCommit && !aborted) {
            transaction.error = factory.failNextCommit; factory.failNextCommit = undefined; aborted = true;
          }
          if (aborted) transaction.onabort?.();
          else { if (mode === 'readwrite') names.forEach(n => factory.tables.set(n, tables.get(n))); transaction.oncomplete?.(); }
        });
        return transaction;
      }
    };
    this.connections.push(db);
    const finish = () => { request.result = db; request.onsuccess?.(); };
    if (this.holdOpen) this.openings.push(finish); else queueMicrotask(finish);
    return request;
  }
}
