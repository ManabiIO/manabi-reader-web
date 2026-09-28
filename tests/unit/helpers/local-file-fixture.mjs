import { setImmediate } from 'node:timers';

// Fault transport only: production file operations, hash checks and journal
// sequencing are not reimplemented here. Native handles are covered separately.
export function filesystem() {
  const events = [];
  const hooks = { write: undefined, createWritable: undefined };
  class Directory {
    kind = 'directory';
    constructor(name, path = '') {
      this.name = name;
      this.path = path;
      this.children = new Map();
    }
    async isSameEntry(other) {
      return this === other;
    }
    async queryPermission() {
      return 'granted';
    }
    async getDirectoryHandle(name, options = {}) {
      let value = this.children.get(name);
      if (!value && options.create) {
        value = new Directory(name, [this.path, name].filter(Boolean).join('/'));
        this.children.set(name, value);
        events.push(['create-directory', value.path]);
      }
      if (!value) throw new DOMException('Missing directory', 'NotFoundError');
      if (value.kind !== 'directory')
        throw new DOMException('Not a directory', 'TypeMismatchError');
      return value;
    }
    async getFileHandle(name, options = {}) {
      let value = this.children.get(name);
      if (!value && options.create) {
        value = new Handle(name, [this.path, name].filter(Boolean).join('/'));
        this.children.set(name, value);
        events.push(['create-file', value.path]);
      }
      if (!value) throw new DOMException('Missing file', 'NotFoundError');
      if (value.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
      return value;
    }
    async *entries() {
      yield* this.children.entries();
    }
    async removeEntry(name) {
      events.push(['delete', [this.path, name].filter(Boolean).join('/')]);
      this.children.delete(name);
    }
  }
  class Handle {
    kind = 'file';
    constructor(name, path) {
      this.name = name;
      this.path = path;
      this.bytes = new Uint8Array();
    }
    async getFile() {
      return new File([this.bytes], this.name);
    }
    async createWritable() {
      let staged = new Uint8Array();
      await hooks.createWritable?.(this);
      return {
        write: async (value) => {
          staged = new Uint8Array(await new Blob([value]).arrayBuffer());
          await hooks.write?.(this);
        },
        close: async () => {
          this.bytes = staged;
          events.push(['write', this.path]);
        },
        abort: async () => events.push(['abort', this.path])
      };
    }
  }
  const root = new Directory('Fixture');
  async function handle(path, create = false) {
    const parts = path.split('/'),
      name = parts.pop();
    let directory = root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
    return directory.getFileHandle(name, { create });
  }
  return {
    root,
    events,
    hooks,
    handle,
    async put(path, text) {
      (await handle(path, true)).bytes = new TextEncoder().encode(text);
    },
    async read(path) {
      return (await (await handle(path)).getFile()).text();
    }
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function integrationDatabase(library) {
  const tables = new Map([
    ['localLibraries', new Map([[library.id, { ...library }]])],
    ['books', new Map()],
    ['metadata', new Map()]
  ]);
  const copy = (value) => (value?.handle ? { ...value } : globalThis.structuredClone(value));
  function transaction(names, mode = 'readonly') {
    const selected = typeof names === 'string' ? [names] : names;
    const working = new Map(selected.map((name) => [name, new Map(tables.get(name))]));
    const completion = deferred();
    let aborted = false;
    setImmediate(() => {
      if (aborted) return;
      if (mode === 'readwrite') for (const [name, rows] of working) tables.set(name, rows);
      completion.resolve();
    });
    function objectStore(name) {
      const rows = working.get(name);
      if (!rows) throw new Error(`Undeclared store ${name}`);
      return {
        get: async (key) => copy(rows.get(key)),
        getAll: async () => [...rows.values()].map(copy),
        getAllKeys: async () => [...rows.keys()],
        put: async (value, key = value.id) => {
          rows.set(key, copy(value));
          return key;
        },
        delete: async (key) => {
          rows.delete(key);
        }
      };
    }
    return {
      objectStore,
      store: selected.length === 1 ? objectStore(selected[0]) : undefined,
      done: completion.promise,
      abort() {
        aborted = true;
        completion.reject(new DOMException('Aborted', 'AbortError'));
      }
    };
  }
  return {
    tables,
    transaction,
    get: async (name, key) => copy(tables.get(name).get(key)),
    async put(name, value, key = value.id) {
      const tx = transaction(name, 'readwrite');
      await tx.store.put(value, key);
      await tx.done;
    },
    async delete(name, key) {
      const tx = transaction(name, 'readwrite');
      await tx.store.delete(key);
      await tx.done;
    }
  };
}
