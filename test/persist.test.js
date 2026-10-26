import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSIST_KEY, requestPersist } from '../js/store.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(String(k), String(v)), map: m };
};

test('requestPersist resolves false when navigator.storage.persist is absent', async () => {
  assert.equal(await requestPersist(undefined, memStorage()), false);
  assert.equal(await requestPersist({}, memStorage()), false);
  assert.equal(await requestPersist({ storage: {} }, memStorage()), false);
  assert.equal(await requestPersist({ storage: { persist: 'nope' } }, memStorage()), false);
});

test('requestPersist calls persist once and remembers it asked', async () => {
  let calls = 0;
  const nav = { storage: { persist: async () => { calls++; return true; } } };
  const storage = memStorage();
  assert.equal(await requestPersist(nav, storage), true);
  assert.equal(storage.map.get(PERSIST_KEY), '1');
  assert.equal(await requestPersist(nav, storage), false);
  assert.equal(calls, 1);
});

test('requestPersist swallows a rejected persist() and a throwing localStorage', async () => {
  const nav = { storage: { persist: async () => { throw new Error('denied'); } } };
  assert.equal(await requestPersist(nav, memStorage()), false);
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() {} };
  assert.equal(await requestPersist(nav, broken), false);
});

test('requestPersist still works with no localStorage at all', async () => {
  const nav = { storage: { persist: async () => true } };
  assert.equal(await requestPersist(nav, null), true);
});
