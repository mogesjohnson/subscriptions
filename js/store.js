// Pure subscription logic plus localStorage. No DOM here, so node:test can cover it.
export const STORAGE_KEY = 'subs.v1';
export const CYCLES = ['monthly', 'yearly'];
const DAY = 86400000;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatUSD = (n) => usd.format(n);

/** Parse stored JSON; anything malformed becomes an empty list. */
export function parseStored(raw) {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return list.filter((s) => validate(s).ok).map(normalize);
  } catch {
    return [];
  }
}

// Reading globalThis.localStorage can itself throw (blocked storage), so it stays inside try.
export function load(storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    return parseStored(store?.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function save(items, storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items }));
    return true;
  } catch {
    return false;
  }
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns { ok, errors } where errors maps a field to a message. */
export function validate(s) {
  const errors = {};
  const name = typeof s?.name === 'string' ? s.name.trim() : '';
  if (!name) errors.name = 'Enter a name.';
  else if (name.length > 60) errors.name = 'Keep the name under 60 characters.';
  // Number('') is 0, so a blank string must not count as a price.
  const price = typeof s?.price === 'string' ? (s.price.trim() === '' ? NaN : Number(s.price)) : s?.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) errors.price = 'Enter a price of 0 or more.';
  else if (price > 100000) errors.price = 'Enter a price under 100,000.';
  else if (Math.round(price * 100) !== Number((price * 100).toFixed(6))) errors.price = 'Use at most 2 decimals.';
  if (!CYCLES.includes(s?.cycle)) errors.cycle = 'Pick monthly or yearly.';
  if (!isDate(s?.next)) errors.next = 'Pick a valid renewal date.';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function normalize(s) {
  return {
    id: typeof s.id === 'string' && s.id ? s.id : newId(),
    name: s.name.trim(),
    price: Math.round(Number(s.price) * 100) / 100,
    cycle: s.cycle,
    next: s.next,
  };
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Local calendar date as YYYY-MM-DD. */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when past due. */
export function daysUntil(to, from) {
  if (!isDate(to) || !isDate(from)) return NaN;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** Soonest renewal first; ties by name; rows without a valid date go last. */
export function sortByRenewal(items) {
  const key = (s) => (isDate(s?.next) ? s.next : '\uffff');
  const name = (s) => (typeof s?.name === 'string' ? s.name : '');
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || name(a).localeCompare(name(b)));
}

/**
 * Monthly total (yearly / 12) and yearly total (monthly x 12), rounded to cents.
 * Both are summed in cents from the raw prices, so a $10/year plan adds exactly
 * $10.00 to the yearly total instead of 12 x $0.83 = $9.96.
 */
export function totals(items) {
  let monthlyCents = 0;
  let yearlyCents = 0;
  for (const s of items) {
    const cents = Math.round(Number(s.price) * 100);
    if (!Number.isFinite(cents)) continue;
    monthlyCents += s.cycle === 'yearly' ? cents / 12 : cents;
    yearlyCents += s.cycle === 'yearly' ? cents : cents * 12;
  }
  return { monthly: Math.round(monthlyCents) / 100, yearly: Math.round(yearlyCents) / 100 };
}

export function upsert(items, sub) {
  const i = items.findIndex((s) => s.id === sub.id);
  if (i === -1) return [...items, sub];
  const copy = [...items];
  copy[i] = sub;
  return copy;
}

export const remove = (items, id) => items.filter((s) => s.id !== id);

export function dueLabel(days) {
  if (!Number.isFinite(days)) return 'No valid renewal date';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} past due`;
  if (days === 0) return 'Renews today';
  if (days === 1) return 'Renews tomorrow';
  return `Renews in ${days} days`;
}

export const PERSIST_KEY = 'subs.persistAsked';

/**
 * Ask once for persistent storage. Every step is guarded: no navigator, no
 * navigator.storage, no persist(), no localStorage, or a rejection all resolve
 * to false instead of throwing. Resolves true only when the browser granted it.
 */
export async function requestPersist(nav = globalThis.navigator, storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (store?.getItem(PERSIST_KEY)) return false;
    store?.setItem(PERSIST_KEY, '1');
    if (typeof nav?.storage?.persist !== 'function') return false;
    return (await nav.storage.persist()) === true;
  } catch {
    return false;
  }
}
