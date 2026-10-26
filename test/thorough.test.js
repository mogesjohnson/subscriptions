// Thorough coverage of js/store.js: totals, sorting, labels, storage, validation.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CYCLES, STORAGE_KEY, daysUntil, dueLabel, formatUSD, load, normalize, parseStored, save, sortByRenewal, today, totals, validate,
} from '../js/store.js';

const sub = (over = {}) => ({ id: 'x', name: 'Sub', price: 10, cycle: 'monthly', next: '2026-11-01', ...over });

/** A fake localStorage installed on globalThis for one test. */
function fakeLocalStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

describe('totals', () => {
  test('empty list is zero', () => {
    assert.deepEqual(totals([]), { monthly: 0, yearly: 0 });
    assert.equal(formatUSD(0), '$0.00');
  });
  test('monthly prices x 12 for the yearly total', () => {
    assert.deepEqual(totals([sub({ price: 15.49 })]), { monthly: 15.49, yearly: 185.88 });
  });
  test('yearly prices / 12 for the monthly total', () => {
    assert.deepEqual(totals([sub({ price: 120, cycle: 'yearly' })]), { monthly: 10, yearly: 120 });
    assert.deepEqual(totals([sub({ price: 99.99, cycle: 'yearly' })]), { monthly: 8.33, yearly: 99.99 });
  });
  test('mixed cycles add up in both directions', () => {
    const t = totals([sub({ price: 15.49 }), sub({ price: 12, cycle: 'yearly' }), sub({ price: 2.99 })]);
    assert.deepEqual(t, { monthly: 19.48, yearly: 233.76 });
  });
  test('rounds to cents without float noise', () => {
    const t = totals(Array.from({ length: 10 }, () => sub({ price: 0.1 })));
    assert.equal(t.monthly, 1);
    assert.equal(t.yearly, 12);
    assert.deepEqual(totals([sub({ price: 1, cycle: 'yearly' }), sub({ price: 1, cycle: 'yearly' })]), { monthly: 0.17, yearly: 2 });
  });
  test('formats USD with Intl.NumberFormat', () => {
    assert.equal(formatUSD(1234.5), '$1,234.50');
    assert.equal(formatUSD(totals([sub({ price: 9.99 })]).yearly), '$119.88');
  });
});

describe('sortByRenewal', () => {
  test('soonest first, and it does not mutate the input', () => {
    const input = [sub({ name: 'Late', next: '2027-01-01' }), sub({ name: 'Soon', next: '2026-10-26' }), sub({ name: 'Mid', next: '2026-12-01' })];
    assert.deepEqual(sortByRenewal(input).map((s) => s.name), ['Soon', 'Mid', 'Late']);
    assert.equal(input[0].name, 'Late');
  });
  test('ties on the same date sort by name', () => {
    const input = [sub({ name: 'Zed' }), sub({ name: 'Apple' }), sub({ name: 'Mango' })];
    assert.deepEqual(sortByRenewal(input).map((s) => s.name), ['Apple', 'Mango', 'Zed']);
  });
  test('past-due rows come before upcoming ones', () => {
    const input = [sub({ name: 'Next', next: '2026-10-30' }), sub({ name: 'Overdue', next: '2026-10-01' })];
    assert.deepEqual(sortByRenewal(input).map((s) => s.name), ['Overdue', 'Next']);
    assert.ok(daysUntil('2026-10-01', '2026-10-25') < 0);
  });
  test('invalid dates go last', () => {
    const input = [sub({ name: 'Bad', next: '2026-02-30' }), sub({ name: 'Empty', next: '' }), sub({ name: 'Ok', next: '2030-01-01' })];
    assert.deepEqual(sortByRenewal(input).map((s) => s.name), ['Ok', 'Bad', 'Empty']);
  });
  test('empty list', () => assert.deepEqual(sortByRenewal([]), []));
});

describe('days until and the label', () => {
  test('daysUntil counts calendar days across months, years and DST', () => {
    assert.equal(daysUntil('2026-10-25', '2026-10-25'), 0);
    assert.equal(daysUntil('2026-11-02', '2026-10-31'), 2);
    assert.equal(daysUntil('2027-01-01', '2026-12-31'), 1);
    assert.equal(daysUntil('2026-03-09', '2026-03-07'), 2);
    assert.equal(daysUntil('2028-03-01', '2028-02-28'), 2);
  });
  test('labels today, tomorrow, later and past', () => {
    assert.equal(dueLabel(0), 'Renews today');
    assert.equal(dueLabel(1), 'Renews tomorrow');
    assert.equal(dueLabel(2), 'Renews in 2 days');
    assert.equal(dueLabel(-1), '1 day past due');
    assert.equal(dueLabel(-3), '3 days past due');
  });
  test('today() is the local date as YYYY-MM-DD', () => {
    assert.equal(today(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('storage with a fake localStorage on globalThis', () => {
  let saved;
  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: fakeLocalStorage() });
  });
  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  });

  test('round-trips through the versioned key', () => {
    const items = [sub({ id: 'a' }), sub({ id: 'b', cycle: 'yearly', price: 99.99 })];
    assert.equal(save(items), true);
    assert.equal(STORAGE_KEY, 'subs.v1');
    assert.deepEqual([...globalThis.localStorage.map.keys()], ['subs.v1']);
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('subs.v1')), { version: 1, items });
    assert.deepEqual(load(), items);
  });
  test('corrupt JSON falls back to an empty list', () => {
    for (const raw of ['{', 'undefined', '"text"', '42', 'null', '{"items":"no"}']) {
      globalThis.localStorage.setItem(STORAGE_KEY, raw);
      assert.deepEqual(load(), [], raw);
    }
  });
  test('reads a bare array too, and drops invalid rows', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([sub(), { name: 'no price' }, null]));
    assert.equal(load().length, 1);
  });
  test('nothing stored is an empty list', () => assert.deepEqual(load(), []));
  test('a setItem that throws (quota) makes save return false', () => {
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.equal(save([sub()]), false);
  });
  test('missing localStorage: load is empty and save is false', () => {
    delete globalThis.localStorage;
    assert.equal(globalThis.localStorage, undefined);
    assert.deepEqual(load(), []);
    assert.equal(save([sub()]), false);
  });
});

describe('validate', () => {
  test('accepts a valid subscription and both cycles', () => {
    assert.deepEqual(CYCLES, ['monthly', 'yearly']);
    for (const cycle of CYCLES) assert.equal(validate(sub({ cycle })).ok, true);
  });
  test('price: up to 2 decimals, zero allowed, no negatives or junk', () => {
    for (const price of [0, 0.5, 9.99, '19.99', '7', 100000]) assert.equal(validate(sub({ price })).ok, true, String(price));
    for (const price of [1.234, '0.001', -0.01, -5, NaN, Infinity, 'abc', '', null, undefined, 100000.01]) {
      assert.equal(validate(sub({ price })).ok, false, String(price));
    }
    assert.equal(validate(sub({ price: 1.234 })).errors.price, 'Use at most 2 decimals.');
    assert.equal(validate(sub({ price: -1 })).errors.price, 'Enter a price of 0 or more.');
  });
  test('name: required, trimmed, at most 60 characters', () => {
    assert.equal(validate(sub({ name: '' })).errors.name, 'Enter a name.');
    assert.equal(validate(sub({ name: '   ' })).errors.name, 'Enter a name.');
    assert.equal(validate(sub({ name: 42 })).ok, false);
    assert.equal(validate(sub({ name: 'x'.repeat(61) })).ok, false);
    assert.equal(validate(sub({ name: 'x'.repeat(60) })).ok, true);
  });
  test('date: real calendar dates in YYYY-MM-DD only', () => {
    for (const next of ['2026-02-29', '2026-13-01', '2026-04-31', '26-01-01', '2026/01/01', '', undefined, 'tomorrow']) {
      assert.equal(validate(sub({ next })).errors.next, 'Pick a valid renewal date.', String(next));
    }
    assert.equal(validate(sub({ next: '2028-02-29' })).ok, true);
  });
  test('cycle: only monthly or yearly', () => {
    for (const cycle of ['weekly', 'Monthly', '', undefined]) assert.equal(validate(sub({ cycle })).errors.cycle, 'Pick monthly or yearly.');
  });
  test('null and empty input report every field', () => {
    assert.deepEqual(Object.keys(validate(null).errors).sort(), ['cycle', 'name', 'next', 'price']);
    assert.deepEqual(Object.keys(validate({}).errors).sort(), ['cycle', 'name', 'next', 'price']);
  });
  test('normalize trims the name, rounds the price and keeps or makes an id', () => {
    assert.deepEqual(normalize({ id: 'k', name: '  Netflix ', price: '15.49', cycle: 'monthly', next: '2026-11-01' }),
      { id: 'k', name: 'Netflix', price: 15.49, cycle: 'monthly', next: '2026-11-01' });
    assert.ok(normalize(sub({ id: '' })).id.length > 0);
    assert.deepEqual(parseStored(JSON.stringify([sub({ name: ' a ' })]))[0].name, 'a');
  });
});
