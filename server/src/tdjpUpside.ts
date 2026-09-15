import { config } from './config';
import { getSetting, setSetting, flushDb } from './db';

// TDJP block 3 — "Forecast Revenue (Not a hard commit / upside)".
//
// These numbers used to be typed by hand into a Google Sheet and read here from
// its published CSV. They now live in OUR database (per year), edited straight from
// the dashboard's TDJP tab. Values are whole k-EUR (thousands of euros), 5 leaf
// rows × 12 months, always in EUR.
//
// Migration: the first time a year is read and the database has nothing yet, we do
// a one-time seed from the old published sheet (for the legacy forecast year only),
// so Tsuyoshi's existing numbers are preserved automatically. After that it is
// database-only and the sheet is never touched again.

export interface UpsideData {
  year: number;
  rows: Record<number, number[]>; // leaf row key -> 12 monthly k-EUR values
  updatedAt: string | null; // ISO timestamp of the last edit (or seed)
  source: 'db' | 'seeded' | 'none';
}

const LEAF_KEYS = [12, 13, 14, 16, 17];
const ZERO = () => new Array(12).fill(0);
function emptyRows(): Record<number, number[]> {
  const r: Record<number, number[]> = {};
  for (const k of LEAF_KEYS) r[k] = ZERO();
  return r;
}
const settingKey = (year: number) => `tdjp.upside.${year}`;

/** Coerce arbitrary input into exactly 5 leaf rows × 12 whole-number values. */
export function sanitizeRows(input: unknown): Record<number, number[]> {
  const out = emptyRows();
  const obj = (input || {}) as Record<string, unknown>;
  for (const k of LEAF_KEYS) {
    const src = (obj[k] ?? obj[String(k)]) as unknown;
    if (Array.isArray(src)) {
      for (let m = 0; m < 12; m++) {
        const n = Math.round(Number(src[m]));
        out[k][m] = Number.isFinite(n) ? n : 0;
      }
    }
  }
  return out;
}

function readDb(year: number): { rows: Record<number, number[]>; updatedAt: string | null } | null {
  const raw = getSetting(settingKey(year));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return { rows: sanitizeRows(parsed.rows), updatedAt: parsed.updatedAt || null };
  } catch {
    return null;
  }
}

// ---- one-time legacy seed from the published Google Sheet CSV ----

function parseCSV(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n') {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else if (c === '\r') {
        /* skip */
      } else cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function seedFromSheet(year: number): Promise<Record<number, number[]> | null> {
  // only the legacy forecast year was ever in the sheet
  if (!config.tdjpUpsideCsvUrl || year !== config.tdjpUpsideYear) return null;
  try {
    const res = await fetch(config.tdjpUpsideCsvUrl);
    const txt = await res.text();
    if (!res.ok || /<html/i.test(txt.slice(0, 200))) return null;
    const g = parseCSV(txt);
    let ti = -1;
    for (let i = 0; i < g.length; i++) {
      if (g[i].some((c) => c.trim() === 'TI')) {
        ti = i;
        break;
      }
    }
    if (ti < 0) return null;
    const B3_COL = 35; // column AJ (0-based) = start of block 3
    const num = (v: unknown) => {
      const n = Number(String(v ?? '').trim());
      return isFinite(n) ? Math.round(n) : 0;
    };
    const seg = (r: number) => Array.from({ length: 12 }, (_, k) => num((g[r] || [])[B3_COL + k]));
    return {
      12: seg(ti + 3),
      13: seg(ti + 4),
      14: seg(ti + 5),
      16: seg(ti + 7),
      17: seg(ti + 8),
    };
  } catch {
    return null;
  }
}

// ---- public API ----

export async function getTdjpUpside(year: number): Promise<UpsideData> {
  const db = readDb(year);
  if (db) return { year, rows: db.rows, updatedAt: db.updatedAt, source: 'db' };

  const seeded = await seedFromSheet(year);
  if (seeded) {
    const updatedAt = new Date().toISOString();
    setSetting(settingKey(year), JSON.stringify({ rows: seeded, updatedAt, seededFromSheet: true }));
    await flushDb();
    return { year, rows: seeded, updatedAt, source: 'seeded' };
  }

  return { year, rows: emptyRows(), updatedAt: null, source: 'none' };
}

export async function saveTdjpUpside(year: number, rows: unknown): Promise<UpsideData> {
  const clean = sanitizeRows(rows);
  const updatedAt = new Date().toISOString();
  setSetting(settingKey(year), JSON.stringify({ rows: clean, updatedAt }));
  await flushDb();
  return { year, rows: clean, updatedAt, source: 'db' };
}
