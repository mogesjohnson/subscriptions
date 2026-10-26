import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, daysUntil, dueLabel, formatUSD, load, parseStored, remove, save, sortByRenewal, totals, upsert, validate } from '../js/store.js';

const netflix = { id: 'a', name: 'Netflix', price: 15.49, cycle: 'monthly', next: '2026-11-03' };
const domain = { id: 'b', name: 'Domain', price: 12, cycle: 'yearly', next: '2026-10-30' };

test('validate accepts a good subscription and rejects bad fields', () => {
  assert.equal(validate(netflix).ok, true);
  const bad = validate({ name: ' ', price: 1.234, cycle: 'weekly', next: '2026-02-30' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['cycle', 'name', 'next', 'price']);
  assert.equal(validate({ ...netflix, price: -1 }).errors.price, 'Enter a price of 0 or more.');
  assert.equal(validate({ ...netflix, price: '9.99' }).ok, true);
});

test('totals convert yearly to monthly and monthly to yearly', () => {
  const t = totals([netflix, domain]);
  assert.equal(t.monthly.toFixed(2), '16.49');
  assert.equal(t.yearly.toFixed(2), '197.88');
  assert.equal(formatUSD(t.monthly), '$16.49');
});

test('sort puts the soonest renewal first; daysUntil goes negative when past due', () => {
  assert.deepEqual(sortByRenewal([netflix, domain]).map((s) => s.id), ['b', 'a']);
  assert.equal(daysUntil('2026-10-30', '2026-10-25'), 5);
  assert.equal(daysUntil('2026-10-20', '2026-10-25'), -5);
  assert.equal(dueLabel(-1), '1 day past due');
  assert.equal(dueLabel(0), 'Renews today');
});

test('parseStored survives bad JSON and drops invalid rows', () => {
  assert.deepEqual(parseStored('{not json'), []);
  assert.deepEqual(parseStored(null), []);
  assert.equal(parseStored(JSON.stringify({ version: 1, items: [netflix, { name: '' }] })).length, 1);
});

test('save and load round-trip under the versioned key', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(save([netflix], storage), true);
  assert.ok(mem.has(STORAGE_KEY));
  assert.deepEqual(load(storage), [netflix]);
});

test('upsert replaces by id and remove drops by id', () => {
  const list = upsert([netflix], { ...netflix, price: 17.99 });
  assert.equal(list.length, 1);
  assert.equal(list[0].price, 17.99);
  assert.equal(upsert(list, domain).length, 2);
  assert.deepEqual(remove([netflix, domain], 'a'), [domain]);
});
