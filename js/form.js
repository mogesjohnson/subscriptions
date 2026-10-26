// Add, edit and delete through one <dialog> form.
import { normalize, remove, today, upsert, validate } from './store.js';
import { commit, state } from './app.js';

const FIELDS = ['name', 'price', 'cycle', 'next'];
const $ = (id) => document.getElementById(id);

function showErrors(errors) {
  for (const f of FIELDS) {
    $(`e-${f}`).textContent = errors[f] || '';
    $(`f-${f}`).setAttribute('aria-invalid', errors[f] ? 'true' : 'false');
  }
}

export function open(sub) {
  const form = $('form');
  form.reset();
  form.elements.id.value = sub?.id || '';
  form.elements.name.value = sub?.name || '';
  form.elements.price.value = sub ? sub.price.toFixed(2) : '';
  form.elements.cycle.value = sub?.cycle || 'monthly';
  form.elements.next.value = sub?.next || today();
  $('dialog-title').textContent = sub ? 'Edit subscription' : 'Add subscription';
  $('delete').hidden = !sub;
  showErrors({});
  $('dialog').showModal();
  if (!sub) form.elements.name.focus();
}

function onSubmit(event) {
  event.preventDefault();
  const el = $('form').elements;
  const raw = { id: el.id.value, name: el.name.value, price: el.price.value.trim(), cycle: el.cycle.value, next: el.next.value };
  if (raw.price === '') raw.price = NaN;
  const { ok, errors } = validate(raw);
  showErrors(errors);
  if (!ok) {
    $(`f-${FIELDS.find((f) => errors[f])}`).focus();
    return;
  }
  commit(upsert(state.items, normalize(raw)));
  $('dialog').close();
}

function onDelete() {
  const id = $('form').elements.id.value;
  const sub = state.items.find((s) => s.id === id);
  if (!sub || !confirm(`Delete ${sub.name}?`)) return;
  commit(remove(state.items, id));
  $('dialog').close();
}

export function init() {
  $('add').addEventListener('click', () => open());
  $('cancel').addEventListener('click', () => $('dialog').close());
  $('delete').addEventListener('click', onDelete);
  $('form').addEventListener('submit', onSubmit);
  $('list').addEventListener('click', (event) => {
    const btn = event.target.closest('.item-button');
    const sub = btn && state.items.find((s) => s.id === btn.dataset.id);
    if (sub) open(sub);
  });
}
