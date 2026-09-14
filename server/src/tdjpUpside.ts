import { config } from './config';

// Reads the manual "upside" (TDJP block 3) live from the published CSV of the
// Google Sheet's "TDJP Input Format" tab. Only the LEAF rows are read
// (Germany, Netherlands, Offshore/R&D, X1, Others); the dashboard computes the
// subtotals itself, so the (empty) TI subtotal in the sheet is not a problem.

export interface UpsideData {
  year: number;
  rows: Record<number, number[]>; // leaf row key -> 12 monthly k-EUR values
  source: 'sheet' | 'none' | 'error';
}

const ZERO = () => new Array(12).fill(0);
function emptyRows(): Record<number, number[]> {
  return { 12: ZERO(), 13: ZERO(), 14: ZERO(), 16: ZERO(), 17: ZERO() };
}

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

let cache: { at: number; data: UpsideData } | null = null;
const TTL_MS = 30_000;

export async function getTdjpUpside(force = false): Promise<UpsideData> {
  const empty: UpsideData = { year: config.tdjpUpsideYear, rows: emptyRows(), source: 'none' };
  if (!config.tdjpUpsideCsvUrl) return empty;
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const res = await fetch(config.tdjpUpsideCsvUrl);
    const txt = await res.text();
    if (!res.ok || /<html/i.test(txt.slice(0, 200))) throw new Error('published CSV not available');

    const g = parseCSV(txt);
    let ti = -1;
    for (let i = 0; i < g.length; i++) {
      if (g[i].some((c) => c.trim() === 'TI')) {
        ti = i;
        break;
      }
    }
    if (ti < 0) throw new Error('TI row not found');

    const B3_COL = 35; // column AJ (0-based) = start of block 3, 12 months
    const num = (v: unknown) => {
      const n = Number(String(v ?? '').trim());
      return isFinite(n) ? n : 0;
    };
    const seg = (r: number) => Array.from({ length: 12 }, (_, k) => num((g[r] || [])[B3_COL + k]));

    // leaf rows are at fixed offsets from the TI row: TI, Service, Onshore,
    // Germany(+3), Netherlands(+4), Offshore/R&D(+5), Hardware(+6), X1(+7), Others(+8)
    const rows: Record<number, number[]> = {
      12: seg(ti + 3),
      13: seg(ti + 4),
      14: seg(ti + 5),
      16: seg(ti + 7),
      17: seg(ti + 8),
    };
    const data: UpsideData = { year: config.tdjpUpsideYear, rows, source: 'sheet' };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return { year: config.tdjpUpsideYear, rows: emptyRows(), source: 'error' };
  }
}
