/** @license MIT — deterministic IDB scheduling tests, not native IDB conformance. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join } = require('node:path')
if (!process.env.WHISPERSYNC_COMPILED) throw new Error('Run node test/whispersync/run.mjs')
const { AudiobookSessionStore, emptySession } = require(join(process.env.WHISPERSYNC_COMPILED, 'persistence.js'))
const drain = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve() }

function database() {
  const values = new Map(), transactions = []
  const db = {
    closed: 0, values, transactions,
    objectStoreNames: { contains: () => true },
    close() { this.closed += 1 },
    transaction(name, mode) {
      assert.equal(name, 'sessions')
      let commit = () => {}
      const request = {}
      const tx = {
        mode, error: null, aborted: false,
        objectStore: () => ({
          get: (key) => { commit = () => { request.result = values.get(key) }; return request },
          put: (value, key) => {
            if (db.throwPut) throw new Error('synchronous clone failure')
            commit = () => { values.set(key, structuredClone(value)); request.result = key }
            return request
          },
          delete: (key) => { commit = () => { values.delete(key) }; return request }
        }),
        abort() { this.aborted = true; queueMicrotask(() => this.onabort?.()) },
        complete() { assert.equal(this.aborted, false); commit(); this.oncomplete?.() },
        fail() { this.error = new Error('quota failure'); this.abort() }
      }
      transactions.push(tx)
      return tx
    }
  }
  return db
}
function factory(db) {
  const requests = []
  return {
    requests,
    open() {
      const request = { result: db, transaction: { aborted: false, abort() { this.aborted = true } } }
      requests.push(request)
      queueMicrotask(() => request.onsuccess?.())
      return request
    }
  }
}

test('load waits for an earlier write and saves an immutable caller snapshot', async () => {
  const db = database(), store = new AudiobookSessionStore(factory(db))
  const value = { ...emptySession(), position: 12, audio: { name: 'one.mp3', size: 10, lastModified: 1 } }
  const saving = store.save('book', value)
  value.position = 99
  value.audio.name = 'mutated.mp3'
  const loading = store.load('book')
  await drain()
  assert.equal(db.transactions.length, 1)
  db.transactions[0].complete()
  await saving
  await drain()
  assert.equal(db.transactions.length, 2)
  db.transactions[1].complete()
  const read = await loading
  assert.equal(read.position, 12)
  assert.equal(read.audio.name, 'one.mp3')
  await store.close()
})

test('remove follows pending writes and a queued read observes the deletion', async () => {
  const db = database(), store = new AudiobookSessionStore(factory(db))
  const saving = store.save('book', emptySession()), removing = store.remove('book'), loading = store.load('book')
  await drain()
  db.transactions[0].complete()
  await saving
  await drain()
  assert.ok(db.values.has('book'))
  db.transactions[1].complete()
  await removing
  await drain()
  db.transactions[2].complete()
  assert.equal(await loading, undefined)
  await store.close()
})

test('a failed transaction does not poison later operations', async () => {
  const db = database(), store = new AudiobookSessionStore(factory(db))
  const saving = store.save('book', emptySession())
  const rejected = assert.rejects(saving, /quota/)
  const loading = store.load('book')
  await drain()
  db.transactions[0].fail()
  await rejected
  await drain()
  db.transactions[1].complete()
  assert.equal(await loading, undefined)
  await store.close()
})

test('close drains accepted work but immediately refuses new reads and writes', async () => {
  const db = database(), store = new AudiobookSessionStore(factory(db))
  const saving = store.save('book', emptySession())
  const closing = store.close()
  await assert.rejects(store.load('book'), /closed/)
  await assert.rejects(store.save('book', emptySession()), /closed/)
  await assert.rejects(store.remove('book'), /closed/)
  await drain()
  assert.equal(db.closed, 0)
  db.transactions[0].complete()
  await saving
  await closing
  assert.equal(db.closed, 1)
})

test('a synchronous object store error aborts the transaction and preserves queue recovery', async () => {
  const db = database(), store = new AudiobookSessionStore(factory(db))
  db.throwPut = true
  await assert.rejects(store.save('book', emptySession()), /clone failure/)
  assert.equal(db.transactions[0].aborted, true)
  db.throwPut = false
  const loading = store.load('book')
  await drain()
  db.transactions[1].complete()
  assert.equal(await loading, undefined)
  await store.close()
})

test('blocked opening rejects, aborts a late upgrade, closes a late success and permits retry', async () => {
  const db = database(), requests = []
  const store = new AudiobookSessionStore({ open() {
    const request = { result: db, transaction: { aborted: false, abort() { this.aborted = true } } }
    requests.push(request)
    return request
  } })
  const loading = store.load('book'), rejected = assert.rejects(loading, /blocked/)
  await drain()
  requests[0].onblocked()
  await rejected
  requests[0].onupgradeneeded()
  assert.equal(requests[0].transaction.aborted, true)
  requests[0].onsuccess()
  assert.equal(db.closed, 1)
  const retried = store.load('book')
  await drain()
  assert.equal(requests.length, 2)
  requests[1].onsuccess()
  await drain()
  db.transactions[0].complete()
  assert.equal(await retried, undefined)
  await store.close()
})

test('an unresponsive open times out instead of disabling playback indefinitely', async () => {
  const db = database(), request = { result: db }
  const store = new AudiobookSessionStore({ open: () => request }, 5)
  await assert.rejects(store.load('book'), /did not respond/)
  request.onsuccess()
  assert.equal(db.closed, 1)
  await store.close()
})

test('a version change discards the old cached handle before subsequent operations', async () => {
  const db = database(), source = factory(db), store = new AudiobookSessionStore(source)
  const first = store.load('book')
  await drain()
  db.transactions[0].complete()
  await first
  db.onversionchange()
  assert.equal(db.closed, 1)
  const second = store.load('book')
  await drain()
  assert.equal(source.requests.length, 2)
  db.transactions[1].complete()
  await second
  await store.close()
})
