#!/usr/bin/env node
/*
 * export-dev.cjs — snapshot the user-configured data from DEVELOPMENT into
 * seed-data.json, ready for seed-prod.cjs to load into production.
 *
 * It reads the local JSON store (data.json) and keeps ONLY:
 *   - budgets
 *   - settings, except per-environment runtime state (last_sync_*) and the dead
 *     legacy "country.rules" blob (rules now live in code + "country.rules.user").
 *
 * Deals / pipelines / stages / owners are deliberately dropped — production gets
 * those from its own HubSpot sync.
 *
 * USAGE (run on the development machine):
 *   node scripts/export-dev.cjs
 *   node scripts/export-dev.cjs --in  "C:\\path\\to\\data.json"
 *   node scripts/export-dev.cjs --out other-seed.json
 *
 * Default input:  %LOCALAPPDATA%\terra-sales-dashboard\server\data\data.json (Windows)
 *                 else $DATA_DIR/data.json, else ./data/data.json
 * Default output: seed-data.json next to this script.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EXCLUDE_SETTINGS = new Set([
  'country.rules', // legacy full-rules blob; no longer read
  'last_sync_at',
  'last_sync_status',
  'last_sync_source',
  'last_sync_error',
]);

function parseArgs(argv) {
  const out = { in: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' || a === '-i') out.in = argv[++i];
    else if (a === '--out' || a === '-o') out.out = argv[++i];
  }
  return out;
}

function defaultInPath() {
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'terra-sales-dashboard', 'server', 'data', 'data.json');
  }
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'data.json');
  return path.join(process.cwd(), 'data', 'data.json');
}

function main() {
  const args = parseArgs(process.argv);
  const inPath = args.in ? path.resolve(args.in) : defaultInPath();
  const outPath = args.out ? path.resolve(args.out) : path.join(__dirname, 'seed-data.json');

  if (!fs.existsSync(inPath)) {
    console.error(`[export] ERROR: development data file not found: ${inPath}`);
    console.error('Point to it with --in "<path to data.json>".');
    process.exit(1);
  }

  const src = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const budgets = src.budgets && typeof src.budgets === 'object' ? src.budgets : {};
  const settings = {};
  for (const [k, v] of Object.entries(src.settings || {})) {
    if (!EXCLUDE_SETTINGS.has(k)) settings[k] = v;
  }

  const seed = {
    _comment:
      'Seed data for the Terra Sales Dashboard PRODUCTION database. User-configured ' +
      'data only (budget + settings/rules/TDJP upside). Deals/pipelines/stages/owners ' +
      'come from the HubSpot sync and are NOT here. Load with seed-prod.cjs.',
    version: 1,
    exportedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: 'development (data.json)',
    budgets,
    settings,
  };

  fs.writeFileSync(outPath, JSON.stringify(seed, null, 2), 'utf8');
  console.log(`[export] wrote ${outPath}`);
  console.log(`[export] budget months: ${Object.keys(budgets).length}, setting keys: ${Object.keys(settings).length}`);
  console.log('[export] settings: ' + Object.keys(settings).sort().join(', '));
}

main();
