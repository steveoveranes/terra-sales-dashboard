import fs from 'fs';
import path from 'path';
import { config } from './config';

// Simple pure-JavaScript JSON store. No native modules, so it installs on any
// Node version and any OS without build tools, and works the same in Docker.
// Data volumes here are small (hundreds of deals per year), so a JSON file is plenty.

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

function dataFile(): string {
  return path.join(config.dataDir, 'data.json');
}

function load(): Store {
  if (store) return store;
  let s: Store;
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    s = { ...emptyStore(), ...JSON.parse(raw) };
  } catch {
    s = emptyStore();
  }
  store = s;
  return s;
}

function save(): void {
  const s = load();
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, dataFile());
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

export interface BudgetMonth {
  budget_amount: number;
  budget_margin: number;
}

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
