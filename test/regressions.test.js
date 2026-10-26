// One test per bug fixed in fix(store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, dueLabel, load, save, sortByRenewal, totals, validate } from '../js/store.js';

test('a blank price string is invalid (Number("") is 0)', () => {
  const base = { name: 'X', cycle: 'monthly', next: '2026-11-01' };
  assert.equal(validate({ ...base, price: '' }).errors.price, 'Enter a price of 0 or more.');
  assert.equal(validate({ ...base, price: '   ' }).ok, false);
});

test('sortByRenewal does not throw on a missing or invalid date and puts it last', () => {
  const list = [{ name: 'B' }, { name: 'C', next: '2026-13-01' }, { name: 'A', next: '2026-11-01' }];
  assert.deepEqual(sortByRenewal(list).map((s) => s.name), ['A', 'B', 'C']);
});

test('daysUntil and dueLabel handle invalid dates', () => {
  assert.ok(Number.isNaN(daysUntil('nope', '2026-10-25')));
  assert.equal(dueLabel(NaN), 'No valid renewal date');
});

test('load survives a localStorage getter that throws', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(load(), []);
    assert.equal(save([]), false);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

test('save reports false when there is no storage', () => {
  assert.equal(save([], null), false);
});

test('a yearly plan adds its exact price to the yearly total', () => {
  assert.deepEqual(totals([{ price: 10, cycle: 'yearly' }]), { monthly: 0.83, yearly: 10 });
  assert.deepEqual(totals([{ price: 0.1, cycle: 'monthly' }, { price: 0.2, cycle: 'monthly' }]), { monthly: 0.3, yearly: 3.6 });
});
