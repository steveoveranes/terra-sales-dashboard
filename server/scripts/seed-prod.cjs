#!/usr/bin/env node
/*
 * seed-prod.cjs — load user-configured data (budget + settings/rules/TDJP upside)
 * into the PRODUCTION database of the Terra Sales Dashboard.
 *
 * Intended for the FIRST deploy: it copies the budget, the location rules and the
 * other saved settings from development into production so production shows the
 * same numbers and behaves the same way from day one.
 *
 * WHAT IT DOES
 *   - Reads seed-data.json (produced from development; sits next to this script).
 *   - Upserts every budget month  -> table "budgets"
 *   - Upserts every setting key    -> table "settings"
 *   - Creates those two tables if they do not exist yet.
 *
 * WHAT IT NEVER DOES
 *   - It never DELETEs anything. Existing rows that are not in the seed stay put.
 *   - It never touches deals / pipelines / stages / owners. Those come from the
 *     HubSpot sync and are left completely alone.
 *
 * It is safe to run more than once (idempotent): re-running just re-applies the
 * same values.
 *
 * USAGE (run on the production server, from the server/ folder):
 *   node scripts/seed-prod.cjs                # uses DATABASE_URL from env / .env
 *   node scripts/seed-prod.cjs --dry-run      # show what WOULD change, write nothing
 *   node scripts/seed-prod.cjs --file other-seed.json
 *   node scripts/seed-prod.cjs --database-url "postgres://user:pass@host:5432/db"
 *
 * The database connection is resolved in this order:
 *   1. --database-url "<url>"
 *   2. process.env.DATABASE_URL
 *   3. a DATABASE_URL= line in a .env file next to the server (../.env, ./.env, ../../.env)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// tiny arg parser
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { dryRun: false, file: null, databaseUrl: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--file' || a === '-f') out.file = argv[++i];
    else if (a === '--database-url') out.databaseUrl = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else console.warn('[seed] ignoring unknown argument:', a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// minimal .env reader (no dependency on dotenv, works from any cwd)
// ---------------------------------------------------------------------------
function databaseUrlFromEnvFile() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  for (const p of candidates) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        const m = /^\s*DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
        if (m) {
          let v = m[1].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (v) return { url: v, from: p };
        }
      }
    } catch {
      /* file not present – try the next candidate */
    }
  }
  return null;
}

function resolveDatabaseUrl(args) {
  if (args.databaseUrl) return { url: args.databaseUrl, from: '--database-url' };
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, from: 'env DATABASE_URL' };
  const f = databaseUrlFromEnvFile();
  if (f) return f;
  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*/, '').trim());
    return;
  }

  const seedPath = args.file
    ? path.resolve(args.file)
    : path.join(__dirname, 'seed-data.json');

  if (!fs.existsSync(seedPath)) {
    fail(`seed file not found: ${seedPath}\n(Point to it with --file <path>.)`);
  }

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (e) {
    fail(`could not parse seed file ${seedPath}: ${e.message}`);
  }

  const budgets = seed.budgets && typeof seed.budgets === 'object' ? seed.budgets : {};
  const settings = seed.settings && typeof seed.settings === 'object' ? seed.settings : {};
  const budgetCount = Object.keys(budgets).length;
  const settingCount = Object.keys(settings).length;

  console.log('Terra Sales Dashboard — production seed');
  console.log('---------------------------------------');
  console.log(`seed file      : ${seedPath}`);
  console.log(`exported at    : ${seed.exportedAt || '(unknown)'}  from ${seed.source || '(unknown)'}`);
  console.log(`budget months  : ${budgetCount}`);
  console.log(`setting keys   : ${settingCount}`);
  console.log(`mode           : ${args.dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`);
  console.log('');

  if (budgetCount === 0 && settingCount === 0) {
    console.log('Nothing to seed (empty budgets and settings). Done.');
    return;
  }

  // ---- connect ----
  const conn = resolveDatabaseUrl(args);
  if (!conn) {
    fail(
      'No database connection found.\n' +
        'Set DATABASE_URL in the environment or the server .env, or pass --database-url "<url>".'
    );
  }
  console.log(`database       : (from ${conn.from})`);

  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    fail(
      "the 'pg' package is not available.\n" +
        'Run this script from the server/ folder (where node_modules with pg lives), ' +
        'e.g.  node scripts/seed-prod.cjs'
    );
  }

  const pool = new Pool({ connectionString: conn.url });
  const client = await pool.connect();
  try {
    // Tables mirror server/src/db.ts (ensureSchema). Safe if they already exist.
    await client.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        month text PRIMARY KEY,
        budget_amount numeric NOT NULL DEFAULT 0,
        budget_margin numeric NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key text PRIMARY KEY,
        value text
      );
    `);

    // Show a short before/after so it is obvious what changed.
    const before = {
      budgets: Number((await client.query('SELECT count(*) FROM budgets')).rows[0].count),
      settings: Number((await client.query('SELECT count(*) FROM settings')).rows[0].count),
    };
    console.log(`existing rows  : budgets=${before.budgets}, settings=${before.settings}`);
    console.log('');

    if (args.dryRun) {
      console.log('Would upsert these budget months:');
      for (const m of Object.keys(budgets).sort()) {
        const v = budgets[m] || {};
        console.log(`  ${m}  amount=${num(v.budget_amount)}  margin=${num(v.budget_margin)}`);
      }
      console.log('Would upsert these setting keys:');
      for (const k of Object.keys(settings).sort()) console.log(`  ${k}`);
      console.log('\nDRY RUN — no changes written.');
      return;
    }

    await client.query('BEGIN');

    let bWritten = 0;
    for (const [month, v] of Object.entries(budgets)) {
      await client.query(
        `INSERT INTO budgets (month, budget_amount, budget_margin)
         VALUES ($1, $2, $3)
         ON CONFLICT (month) DO UPDATE
           SET budget_amount = EXCLUDED.budget_amount,
               budget_margin = EXCLUDED.budget_margin`,
        [month, num((v || {}).budget_amount), num((v || {}).budget_margin)]
      );
      bWritten++;
    }

    let sWritten = 0;
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value`,
        [key, value == null ? null : String(value)]
      );
      sWritten++;
    }

    await client.query('COMMIT');

    const after = {
      budgets: Number((await client.query('SELECT count(*) FROM budgets')).rows[0].count),
      settings: Number((await client.query('SELECT count(*) FROM settings')).rows[0].count),
    };

    console.log(`upserted       : ${bWritten} budget months, ${sWritten} settings`);
    console.log(`rows now       : budgets=${after.budgets}, settings=${after.settings}`);
    console.log('');
    console.log('Done. Deals / pipelines / stages / owners were not touched (they come from the HubSpot sync).');
    console.log('Reload the dashboard (Ctrl+F5) to see the seeded budget and settings.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    fail('database error, nothing was changed: ' + e.message);
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fail(msg) {
  console.error('\n[seed] ERROR: ' + msg + '\n');
  process.exit(1);
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
