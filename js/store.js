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

export function load(storage = globalThis.localStorage) {
  try {
    return parseStored(storage?.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function save(items, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items }));
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
  const price = typeof s?.price === 'string' ? Number(s.price) : s?.price;
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
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export function sortByRenewal(items) {
  return [...items].sort((a, b) => a.next.localeCompare(b.next) || a.name.localeCompare(b.name));
}

export function totals(items) {
  let monthly = 0;
  for (const s of items) monthly += s.cycle === 'yearly' ? s.price / 12 : s.price;
  return { monthly, yearly: monthly * 12 };
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
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} past due`;
  if (days === 0) return 'Renews today';
  if (days === 1) return 'Renews tomorrow';
  return `Renews in ${days} days`;
}
