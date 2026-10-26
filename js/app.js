// DOM layer: renders the list and totals from js/store.js.
import { dueLabel, daysUntil, formatUSD, load, save, sortByRenewal, today, totals } from './store.js';

export const state = { items: load() };

const $ = (id) => document.getElementById(id);

export function commit(items) {
  state.items = items;
  save(items);
  render();
}

export function render() {
  const t = totals(state.items);
  $('total-monthly').textContent = formatUSD(t.monthly);
  $('total-yearly').textContent = formatUSD(t.yearly);
  const list = $('list');
  list.replaceChildren();
  $('empty').hidden = state.items.length > 0;
  const now = today();
  for (const s of sortByRenewal(state.items)) {
    const days = daysUntil(s.next, now);
    const li = document.createElement('li');
    li.className = days < 0 ? 'item past-due' : 'item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-button';
    btn.dataset.id = s.id;
    btn.setAttribute('aria-label', `${s.name}, ${formatUSD(s.price)} ${s.cycle}, ${dueLabel(days)}. Edit.`);
    const cell = (cls, text) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      return span;
    };
    btn.append(
      cell('name', s.name),
      cell('price', formatUSD(s.price)),
      cell('due', `${dueLabel(days)} · ${s.next}`),
      cell('cycle', s.cycle),
    );
    li.append(btn);
    list.append(li);
  }
}

async function persistOnce() {
  try {
    if (localStorage.getItem('subs.persistAsked')) return;
    localStorage.setItem('subs.persistAsked', '1');
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Storage persistence is best effort.
  }
}

render();
persistOnce();
