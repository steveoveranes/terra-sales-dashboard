// Generates web/src/buildInfo.ts at build time with an auto-incrementing build
// number in the format YYYYMMDD.NNN (build date + sequence for that day).
//
//  - Every build bumps the sequence.
//  - A new day resets the sequence to 001.
//  - The counter is kept in web/.buildcounter.json (a local build artifact that
//    survives between builds; it is NOT copied from the shared drive, so it keeps
//    counting on whichever machine does the building).
//
// This script must never throw: if anything goes wrong it still writes a valid
// build number so `vite build` can continue.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // .../web/scripts
const webRoot = join(here, '..'); // .../web
const counterFile = join(webRoot, '.buildcounter.json');
const outFile = join(webRoot, 'src', 'buildInfo.ts');

// Baseline so the first automated build continues where the manual numbering
// stopped: ~78 manual updates were done on 2026-09-12, so the next build is .079.
const BASELINE = { date: '20260912', seq: 78 };

function pad3(n) {
  return String(n).padStart(3, '0');
}
function todayStr(d = new Date()) {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

let build;
const today = todayStr();
try {
  let state;
  try {
    state = JSON.parse(readFileSync(counterFile, 'utf8'));
  } catch {
    state = null;
  }
  if (!state || typeof state.date !== 'string' || typeof state.seq !== 'number') {
    state = { ...BASELINE };
  }
  const seq = state.date === today ? state.seq + 1 : 1; // new day -> .001
  writeFileSync(counterFile, JSON.stringify({ date: today, seq }) + '\n');
  build = `${today}.${pad3(seq)}`;
} catch {
  build = `${today}.001`;
}

try {
  mkdirSync(dirname(outFile), { recursive: true });
} catch {
  /* ignore */
}
writeFileSync(
  outFile,
  `// AUTO-GENERATED at build time by scripts/genbuild.mjs — do not edit by hand.\n` +
    `export const BUILD_NUMBER = '${build}';\n`
);
console.log('[build] BUILD_NUMBER =', build);
