import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('navigation caches index.html only for ok responses', () => {
  const put = src.indexOf("c.put('./index.html'");
  const guard = src.lastIndexOf('if (res.ok)', put);
  assert.ok(put > 0, 'navigation handler stores index.html');
  assert.ok(guard > 0 && guard < put, 'a 404 or 500 page must not overwrite the offline copy');
});
