export interface Deal {
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
  execution_month: string | null;
  deal_link: string;
  synced_at: string;
}

export interface Meta {
  pipelines: { id: string; label: string }[];
  stages: { id: string; pipeline_id: string; label: string }[];
  owners: { id: string; name: string }[];
  years: number[];
  dataYears: number[];
  defaultHiddenStages: string[];
  useMock: boolean;
  portalId: string;
}

export interface SyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  status: string | null;
  source: string | null;
  error: string | null;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export interface TdjpUpside {
  year: number;
  rows: Record<string, number[]>;
  source: 'sheet' | 'none' | 'error';
}
export const getTdjpUpside = (force = false) =>
  j<TdjpUpside>('/api/tdjp-upside' + (force ? '?force=1' : ''));

export interface BudgetMonth {
  budget_amount: number;
  budget_margin: number;
}
export interface Budget {
  year: number;
  months: Record<string, BudgetMonth>;
}
export const getBudget = (year: number) => j<Budget>(`/api/budget?year=${year}`);
export const saveBudget = (year: number, months: Record<string, BudgetMonth>) =>
  j<Budget & { status: string }>('/api/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, months }),
  });

export const getMeta = () => j<Meta>('/api/meta');
export const getDeals = (year: number) => j<{ year: number; deals: Deal[] }>(`/api/deals?year=${year}`);
export const getSyncStatus = () => j<SyncStatus>('/api/sync-status');
export const refresh = () => j<{ status: string; message: string; count: number }>('/api/refresh', { method: 'POST' });

const eur = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

// Money formatter: Dutch thousands separator + euro sign, e.g. "€ 15.000".
export function fmtInt(n: number): string {
  return eur.format(Math.round(n || 0));
}

// Compact money for axis labels / tiles, e.g. "€ 1,2 mln" or "€ 15k".
export function fmtCompact(n: number): string {
  const v = n || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return '€ ' + (v / 1_000_000).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' mln';
  if (abs >= 1_000) return '€ ' + Math.round(v / 1_000).toLocaleString('nl-NL') + 'k';
  return '€ ' + Math.round(v).toLocaleString('nl-NL');
}

// Percentage, e.g. "34,2%".
export function fmtPct(n: number): string {
  if (!isFinite(n)) return '–';
  return n.toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + '%';
}
