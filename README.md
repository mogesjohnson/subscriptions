# subscriptions

A bare-minimum offline PWA for tracking subscriptions on an Android phone.

**Live app: https://mogesjohnson.github.io/subscriptions/**

Open it in Chrome on Android, then menu > **Add to Home screen** (or **Install app**). It runs
offline after the first load.

## What it does

- Add, edit (tap a row) and delete subscriptions: name, price in USD with up to 2 decimals,
  monthly or yearly cycle, and next renewal date. Every field is validated.
- Lists them by next renewal, soonest first, with days until renewal. Past-due rows are red.
- Shows a monthly total (yearly prices / 12) and a yearly total (monthly prices x 12).

## Privacy

There is no backend, login, bank connection, analytics or network call. Data stays in this
browser's localStorage under the key `subs.v1` (`{ "version": 1, "items": [...] }`). The app
asks once for persistent storage (`navigator.storage.persist()`) so Chrome is less likely to
evict it. Clearing site data or uninstalling deletes your list.

## Files

| Path | What it holds |
| --- | --- |
| `index.html`, `styles.css` | App shell; light and dark themes follow the system. |
| `js/store.js` | Validation, sorting, totals and storage. No DOM. |
| `js/app.js`, `js/form.js` | List rendering, and the add/edit/delete dialog. |
| `manifest.webmanifest`, `icons/` | Install metadata and 192/512 px icons. |
| `sw.js` | Caches the shell for offline use; relative paths for the `/subscriptions/` subpath. |
| `scripts/make-icons.py` | Redraws the icons with Pillow: `python3 scripts/make-icons.py`. |

## Develop

No build step and no dependencies. GitHub Pages serves the repo root of `main`.

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
npm test                      # node --check on every module, then node:test for js/store.js
node scripts/setup-hooks.mjs  # git hooks, once per clone
```

When you change a cached file, bump `CACHE` in `sw.js` so installed copies update.

Built with the BEST-OF-AI-DEV conventions; see [AGENTS.md](AGENTS.md) and [RULES.md](RULES.md).
