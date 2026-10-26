#!/usr/bin/env node
// Syntax-checks every app module with `node --check`. No dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const files = ['sw.js', ...readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)].filter((f) => existsSync(f));
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`check-js: ${files.length - failed}/${files.length} files pass`);
process.exitCode = failed ? 1 : 0;
