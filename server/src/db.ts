import fs from 'fs';
import path from 'path';
import type { Pool as PgPool, PoolClient } from 'pg';
import { config } from './config';

// Pluggable data store.
//
//  - No DATABASE_URL  → a simple pure-JS JSON file in DATA_DIR (zero-config local
//    dev; no native modules, works on any OS/Node).
//  - DATABASE_URL set → PostgreSQL (production: a dedicated database on the shared
//    Postgres server). Real tables; see ensureSchema() below.
//
// Either way the data lives in an in-memory `store`, so all reads stay synchronous
// and the rest of the app is unchanged. Writes update memory and then persist:
// the JSON backend writes the file synchronously; the PG backend flushes the store
// to Postgres (debounced in the background, and forced via flushDb() at the points
// where durability matters — after a budget save and after a sync).

export interface DealRow {
  id: string;
  year: number;
  deal_name: string;
  sales_pipeline: string;
  pipeline_id: string;
  deal_stage: string;
  stage_id: string;
  owner: string;
  owner_id: string;
  customer: string;
  customer_id: string;
  deal_amount: number;
  cost_of_sales: number;
  margin: number;
  close_date: string | null;
  execution_date: string | null;
  execution_month: string | null; // "YYYY-MM" or null ("No execution date")
  deal_link: string;
  synced_at: string;
}

interface Pipeline { id: string; label: string; display_order: number }
interface Stage { id: string; pipeline_id: string; label: string; display_order: number }
interface Owner { id: string; name: string; email: string }

export interface BudgetMonth {
  budget_amount: number;
  budget_margin: number;
}

interface Store {
  deals: Record<string, DealRow[]>;
  pipelines: Pipeline[];
  stages: Stage[];
  owners: Owner[];
  budgets: Record<string, { budget_amount: number; budget_margin: number }>;
  tdjp_upside: Record<string, number>;
  settings: Record<string, string>;
  sync_log: any[];
}

function emptyStore(): Store {
  return {
    deals: {},
    pipelines: [],
    stages: [],
    owners: [],
    budgets: {},
    tdjp_upside: {},
    settings: {},
    sync_log: [],
  };
}

let store: Store | null = null;
let backend: 'json' | 'pg' = 'json';
let pool: PgPool | null = null;

function dataFile(): string {
  return path.join(config.dataDir, 'data.json');
}

/** Which backend is active ('json' local dev, 'pg' production). Valid after initDb(). */
export function getBackend(): 'json' | 'pg' {
  return backend;
}
/** The PostgreSQL pool when running on Postgres, else null. Used by feature modules
 *  (e.g. feedback) that manage their own append-only tables directly. */
export function getPool(): PgPool | null {
  return pool;
}

// ---------------------------------------------------------------------------
// initialisation
// ---------------------------------------------------------------------------

/** Connect the chosen backend and load all data into memory. Call once at startup
 *  and await it before serving requests. */
export async function initDb(): Promise<void> {
  if (config.databaseUrl) {
    backend = 'pg';
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: config.databaseUrl });
    await ensureSchema();
    store = await pgLoad();
    console.log('[db] using PostgreSQL');
  } else {
    backend = 'json';
    load();
    console.log('[db] using local JSON store at', dataFile());
  }
}

function load(): Store {
  if (store) return store;
  // JSON lazy-load (PG populates `store` in initDb).
  let s: Store;
  try {
    s = { ...emptyStore(), ...JSON.parse(fs.readFileSync(dataFile(), 'utf8')) };
  } catch {
    s = emptyStore();
  }
  store = s;
  return s;
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

function save(): void {
  if (backend === 'pg') {
    dirty = true;
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        doFlush().catch((e) => console.error('[db] background flush failed', e));
      }, 200);
    }
    return;
  }
  // JSON backend: atomic file write.
  const s = load();
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, dataFile());
}

async function doFlush(): Promise<void> {
  if (backend !== 'pg' || !pool || !dirty) return;
  if (flushing) return flushing;
  flushing = (async () => {
    dirty = false;
    const s = load();
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await replaceTable(client, 'budgets', '(month text, budget_amount numeric, budget_margin numeric)',
        ['month', 'budget_amount', 'budget_margin'],
        Object.entries(s.budgets).map(([month, v]) => ({
          month, budget_amount: v.budget_amount || 0, budget_margin: v.budget_margin || 0,
        })));
      await replaceTable(client, 'settings', '(key text, value text)', ['key', 'value'],
        Object.entries(s.settings).map(([key, value]) => ({ key, value })));
      await replaceTable(client, 'pipelines', '(id text, label text, display_order int)',
        ['id', 'label', 'display_order'], s.pipelines);
      await replaceTable(client, 'stages', '(id text, pipeline_id text, label text, display_order int)',
        ['id', 'pipeline_id', 'label', 'display_order'], s.stages);
      await replaceTable(client, 'owners', '(id text, name text, email text)',
        ['id', 'name', 'email'], s.owners);
      await replaceTable(client, 'tdjp_upside', '(key text, value numeric)', ['key', 'value'],
        Object.entries(s.tdjp_upside).map(([key, value]) => ({ key, value })));
      // deals: stored as jsonb rows (a re-syncable cache, queried in memory).
      const dealRows: { year: number; id: string; data: DealRow }[] = [];
      for (const [year, arr] of Object.entries(s.deals)) {
        for (const d of arr) dealRows.push({ year: Number(year), id: d.id, data: d });
      }
      await client.query('DELETE FROM deals');
      if (dealRows.length) {
        await client.query(
          `INSERT INTO deals (year, id, data)
             SELECT (r->>'year')::int, r->>'id', r->'data'
             FROM jsonb_array_elements($1::jsonb) AS r`,
          [JSON.stringify(dealRows)]
        );
      }
      // sync_log
      await client.query('DELETE FROM sync_log');
      if (s.sync_log.length) {
        await client.query(
          `INSERT INTO sync_log (entry)
             SELECT e FROM jsonb_array_elements($1::jsonb) AS e`,
          [JSON.stringify(s.sync_log)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      dirty = true; // retry on next flush
      throw e;
    } finally {
      client.release();
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

/** Replace an entire small table from an array of plain objects, via one
 *  jsonb_to_recordset insert. */
async function replaceTable(
  client: PoolClient,
  table: string,
  recordDef: string,
  columns: string[],
  rows: Record<string, any>[]
): Promise<void> {
  await client.query(`DELETE FROM ${table}`);
  if (!rows.length) return;
  const cols = columns.join(', ');
  await client.query(
    `INSERT INTO ${table} (${cols})
       SELECT ${cols} FROM jsonb_to_recordset($1::jsonb) AS x${recordDef}`,
    [JSON.stringify(rows)]
  );
}

/** Force any pending writes to Postgres to complete. No-op for the JSON backend. */
export async function flushDb(): Promise<void> {
  if (backend !== 'pg') return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await doFlush();
  if (dirty) await doFlush();
}

async function ensureSchema(): Promise<void> {
  await pool!.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      month text PRIMARY KEY,
      budget_amount numeric NOT NULL DEFAULT 0,
      budget_margin numeric NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value text
    );
    CREATE TABLE IF NOT EXISTS pipelines (
      id text PRIMARY KEY,
      label text,
      display_order int
    );
    CREATE TABLE IF NOT EXISTS stages (
      id text PRIMARY KEY,
      pipeline_id text,
      label text,
      display_order int
    );
    CREATE TABLE IF NOT EXISTS owners (
      id text PRIMARY KEY,
      name text,
      email text
    );
    CREATE TABLE IF NOT EXISTS tdjp_upside (
      key text PRIMARY KEY,
      value numeric
    );
    CREATE TABLE IF NOT EXISTS deals (
      year int NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      PRIMARY KEY (year, id)
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id serial PRIMARY KEY,
      entry jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function pgLoad(): Promise<Store> {
  const s = emptyStore();
  const [budgets, settings, pipelines, stages, owners, tdjp, deals, syncLog] = await Promise.all([
    pool!.query('SELECT month, budget_amount, budget_margin FROM budgets'),
    pool!.query('SELECT key, value FROM settings'),
    pool!.query('SELECT id, label, display_order FROM pipelines'),
    pool!.query('SELECT id, pipeline_id, label, display_order FROM stages'),
    pool!.query('SELECT id, name, email FROM owners'),
    pool!.query('SELECT key, value FROM tdjp_upside'),
    pool!.query('SELECT year, data FROM deals'),
    pool!.query('SELECT entry FROM sync_log ORDER BY id'),
  ]);
  for (const r of budgets.rows) {
    s.budgets[r.month] = { budget_amount: Number(r.budget_amount) || 0, budget_margin: Number(r.budget_margin) || 0 };
  }
  for (const r of settings.rows) s.settings[r.key] = r.value;
  s.pipelines = pipelines.rows.map((r) => ({ id: r.id, label: r.label, display_order: r.display_order ?? 0 }));
  s.stages = stages.rows.map((r) => ({ id: r.id, pipeline_id: r.pipeline_id, label: r.label, display_order: r.display_order ?? 0 }));
  s.owners = owners.rows.map((r) => ({ id: r.id, name: r.name, email: r.email ?? '' }));
  for (const r of tdjp.rows) s.tdjp_upside[r.key] = Number(r.value) || 0;
  for (const r of deals.rows) {
    const y = String(r.year);
    (s.deals[y] ||= []).push(r.data as DealRow);
  }
  s.sync_log = syncLog.rows.map((r) => r.entry);
  return s;
}

// Kept for compatibility with startup code; just ensures the store is loaded.
export function getDb(): Store {
  return load();
}

// ---------- deals ----------

export function replaceDealsForYear(year: number, deals: DealRow[]) {
  const s = load();
  s.deals[String(year)] = deals;
  save();
}

export function getDealsByYear(year: number): DealRow[] {
  const s = load();
  const arr = (s.deals[String(year)] || []).slice();
  arr.sort((a, b) => {
    const am = a.execution_month || '￿'; // nulls last
    const bm = b.execution_month || '￿';
    if (am !== bm) return am < bm ? -1 : 1;
    return (a.deal_name || '').localeCompare(b.deal_name || '');
  });
  return arr;
}

export function getYearsWithData(): number[] {
  const s = load();
  return Object.keys(s.deals)
    .filter((y) => Array.isArray(s.deals[y]) && s.deals[y].length > 0)
    .map(Number)
    .sort((a, b) => a - b);
}

// ---------- budgets ----------
// Budget is entered at TOTAL level per month (revenue + margin, in euros).
// Keyed as "YYYY-MM", e.g. "2026-03".

export function getBudgetsForYear(year: number): Record<string, BudgetMonth> {
  const s = load();
  const prefix = String(year) + '-';
  const out: Record<string, BudgetMonth> = {};
  for (const [k, v] of Object.entries(s.budgets || {})) {
    if (k.startsWith(prefix)) out[k] = { budget_amount: v.budget_amount || 0, budget_margin: v.budget_margin || 0 };
  }
  return out;
}

export function setBudgetsForYear(year: number, months: Record<string, BudgetMonth>) {
  const s = load();
  const prefix = String(year) + '-';
  // drop existing entries for this year, then write the new ones
  for (const k of Object.keys(s.budgets || {})) {
    if (k.startsWith(prefix)) delete s.budgets[k];
  }
  for (const [k, v] of Object.entries(months)) {
    if (!k.startsWith(prefix)) continue;
    s.budgets[k] = {
      budget_amount: Number(v.budget_amount) || 0,
      budget_margin: Number(v.budget_margin) || 0,
    };
  }
  save();
}

// ---------- reference data ----------

export function upsertPipelines(items: { id: string; label: string; order?: number }[]) {
  const s = load();
  const map = new Map(s.pipelines.map((p) => [p.id, p]));
  items.forEach((p, i) => map.set(p.id, { id: p.id, label: p.label, display_order: p.order ?? i }));
  s.pipelines = [...map.values()];
  save();
}

export function upsertStages(items: { id: string; pipeline_id: string; label: string; order?: number }[]) {
  const s = load();
  const map = new Map(s.stages.map((st) => [st.id, st]));
  items.forEach((st, i) =>
    map.set(st.id, { id: st.id, pipeline_id: st.pipeline_id, label: st.label, display_order: st.order ?? i })
  );
  s.stages = [...map.values()];
  save();
}

export function upsertOwners(items: { id: string; name: string; email?: string }[]) {
  const s = load();
  const map = new Map(s.owners.map((o) => [o.id, o]));
  items.forEach((o) => map.set(o.id, { id: o.id, name: o.name, email: o.email ?? '' }));
  s.owners = [...map.values()];
  save();
}

export function getMeta() {
  const s = load();
  const pipelines = [...s.pipelines]
    .sort((a, b) => a.display_order - b.display_order || a.label.localeCompare(b.label))
    .map((p) => ({ id: p.id, label: p.label }));
  const stages = [...s.stages]
    .sort((a, b) => a.display_order - b.display_order || a.label.localeCompare(b.label))
    .map((st) => ({ id: st.id, pipeline_id: st.pipeline_id, label: st.label }));
  const owners = [...s.owners]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => ({ id: o.id, name: o.name }));
  return { pipelines, stages, owners };
}

// ---------- settings & sync log ----------

export function setSetting(key: string, value: string) {
  const s = load();
  s.settings[key] = value;
  save();
}

export function getSetting(key: string): string | null {
  const s = load();
  return key in s.settings ? s.settings[key] : null;
}

export function addSyncLog(entry: {
  started_at: string;
  finished_at: string;
  status: string;
  message: string;
  deals_count: number;
  years: string;
  source: string;
}) {
  const s = load();
  s.sync_log.push(entry);
  if (s.sync_log.length > 50) s.sync_log = s.sync_log.slice(-50);
  save();
}

export function getLastSync() {
  const s = load();
  return s.sync_log.length ? s.sync_log[s.sync_log.length - 1] : null;
}
