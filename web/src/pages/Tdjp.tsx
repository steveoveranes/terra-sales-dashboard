import { useEffect, useMemo, useState } from 'react';
import { Deal, getDeals, getTdjpUpside, saveTdjpUpside, TdjpUpside } from '../api';

// ---------------------------------------------------------------------------
// TDJP Input Format — a faithful copy of the Google Sheet "TDJP Input Format"
// tab, so Tsuyoshi can copy the numbers straight into his own sheet.
//
// Rows 9..17 (category hierarchy):
//   9 TI = 10 Service + 15 Hardware
//   10 Service = 11 Onshore + 14 Offshore/R&D
//   11 Onshore = 12 Germany + 13 Netherlands
//   15 Hardware = 16 X1 + 17 Others
// Leaf rows come from HubSpot (pipeline -> row); subtotal rows are sums.
//
// Blocks (each 12 months):
//   1 Actual+Contracted Revenue        (firm stages)
//   2 Forecast (High Probability / Verbal Order)  (pipeline stages)
//   3 Forecast (Not a hard commit / upside)  — manual in the sheet, shown as 0 here
//   4 Total = block 1 + block 2
//   5 Total = block 1 + block 2 + block 3
// Amounts are in k EUR (deal amount / 1000), rounded to whole thousands.
// ---------------------------------------------------------------------------

interface RowDef {
  key: number;
  label: string;
  indent: number;
  leaf: boolean;
  pipe?: string;
}

const ROWS: RowDef[] = [
  { key: 9, label: 'TI', indent: 0, leaf: false },
  { key: 10, label: 'Service', indent: 1, leaf: false },
  { key: 11, label: 'Onshore', indent: 2, leaf: false },
  { key: 12, label: 'Germany', indent: 3, leaf: true, pipe: 'sales germany' },
  { key: 13, label: 'Netherlands', indent: 3, leaf: true, pipe: 'sales netherlands' },
  { key: 14, label: 'Offshore/R&D', indent: 2, leaf: true, pipe: 'fpso' },
  { key: 15, label: 'Hardware', indent: 1, leaf: false },
  { key: 16, label: 'X1', indent: 2, leaf: true, pipe: 'x1 hardware sales europe' },
  { key: 17, label: 'Others', indent: 2, leaf: true, pipe: 'ut drone hardware sales' },
];

// Rows that get the "total" tint: the subtotals TI, Service, Onshore, Hardware.
// Germany, Netherlands, Offshore/R&D, X1, Others stay the plain colour.
const TOTAL_KEYS = new Set([9, 10, 11, 15]);

// subtotal parent -> children, evaluated in this order (children first)
const SUB_ORDER: [number, number[]][] = [
  [11, [12, 13]],
  [10, [11, 14]],
  [15, [16, 17]],
  [9, [10, 15]],
];

const PIPE_ROW: Record<string, number> = {
  'sales germany': 12,
  'sales netherlands': 13,
  fpso: 14,
  'x1 hardware sales europe': 16,
  'ut drone hardware sales': 17,
};

const BLOCK1_STAGES = new Set([
  'committed',
  'closed won',
  'operations briefed',
  'project finished',
  'po or quote missing',
  'can be invoiced',
  'invoiced',
  'paid',
]);
const BLOCK2_STAGES = new Set([
  'lead',
  'quotation request',
  'quotation sent, big chance',
  'evaluation-quotation',
  'qualified',
  'negotiation',
  'distributor responsibility',
]);

const BLOCKS = [
  { id: 1, title: 'Actual+Contracted Revenue' },
  { id: 2, title: 'Forecast Revenue (High Probability / Verbal Order)' },
  { id: 3, title: 'Forecast Revenue (Not a hard commit / upside)' },
  { id: 4, title: 'Total Forecast (Actual+Contracted+Verbal order)' },
  { id: 5, title: 'Total Forecast (Including all upside)' },
];

type Grid = Record<number, number[]>; // rowKey -> 12 months (raw k EUR)

function emptyGrid(): Grid {
  const g: Grid = {};
  for (const r of ROWS) g[r.key] = new Array(12).fill(0);
  return g;
}

function fillSubtotals(g: Grid) {
  for (const [parent, kids] of SUB_ORDER) {
    for (let m = 0; m < 12; m++) {
      g[parent][m] = kids.reduce((s, k) => s + g[k][m], 0);
    }
  }
}

const fmt = (n: number) => Math.round(n).toLocaleString('nl-NL');

export default function Tdjp({
  year,
  refreshKey,
  defaultCurrency,
}: {
  year: number;
  refreshKey: number;
  defaultCurrency?: string;
}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string>('');
  const [upside, setUpside] = useState<TdjpUpside | null>(null);

  // upside editor (block 3) — values are whole k-EUR, always in EUR
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  // EUR -> USD/JPY conversion (rate fetched live only while a currency is active).
  // 'eur' = no conversion; 'usd' and 'jpy' are mutually exclusive.
  type Cur = 'eur' | 'usd' | 'jpy';
  const [cur, setCur] = useState<Cur>(
    defaultCurrency === 'usd' || defaultCurrency === 'jpy' ? defaultCurrency : 'eur'
  );
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState(false);

  async function fetchRate(target: 'USD' | 'JPY') {
    setRateLoading(true);
    setRateError(false);
    try {
      let r: number | undefined;
      try {
        const j = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${target}`).then((x) => x.json());
        r = j?.rates?.[target];
      } catch {
        /* try fallback */
      }
      if (!r) {
        const j = await fetch('https://open.er-api.com/v6/latest/EUR').then((x) => x.json());
        r = j?.rates?.[target];
      }
      if (!r || !isFinite(r)) throw new Error('no rate');
      setRate(r);
    } catch {
      setRateError(true);
      setRate(null);
    } finally {
      setRateLoading(false);
    }
  }

  // Toggle a currency on/off. Checking one turns the other off; unchecking → euros.
  function toggleCur(target: 'usd' | 'jpy', on: boolean) {
    setRate(null);
    setRateError(false);
    if (on) {
      setCur(target);
      fetchRate(target === 'usd' ? 'USD' : 'JPY'); // fresh rate every time it's switched on
    } else {
      setCur('eur');
    }
  }

  // convert a k-EUR value to the displayed currency
  const conv = (v: number) => (cur !== 'eur' && rate ? v * rate : v);
  const currencyLabel = cur === 'usd' && rate ? 'k USD' : cur === 'jpy' && rate ? 'k JPY' : 'k EUR';
  const ratePairLabel = cur === 'jpy' ? 'EUR/JPY' : 'EUR/USD';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDeals(year)
      .then((d) => {
        if (!cancelled) setDeals(d.deals);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, refreshKey]);

  // fetch the manual upside (block 3) for the selected year from our database
  useEffect(() => {
    let cancelled = false;
    getTdjpUpside(year)
      .then((u) => {
        if (!cancelled) setUpside(u);
      })
      .catch(() => {
        if (!cancelled) setUpside(null);
      });
    return () => {
      cancelled = true;
    };
  }, [year, refreshKey]);

  // compute the five blocks (raw k EUR)
  const blocks = useMemo(() => {
    const b1 = emptyGrid();
    const b2 = emptyGrid();
    const b3 = emptyGrid(); // manual upside — read live from the sheet (block 3)
    // seed block 3 leaf rows from the sheet's published upside (only for its year)
    if (upside && upside.year === year && upside.rows) {
      for (const r of ROWS) {
        if (!r.leaf) continue;
        const src = upside.rows[String(r.key)] || upside.rows[r.key as unknown as string];
        if (Array.isArray(src)) for (let m = 0; m < 12; m++) b3[r.key][m] = Number(src[m]) || 0;
      }
    }
    for (const d of deals) {
      if (!d.execution_month) continue;
      const [yy, mm] = d.execution_month.split('-').map(Number);
      if (yy !== year || !mm) continue;
      const lr = PIPE_ROW[(d.sales_pipeline || '').trim().toLowerCase()];
      if (!lr) continue;
      const st = (d.deal_stage || '').trim().toLowerCase();
      const g = BLOCK1_STAGES.has(st) ? b1 : BLOCK2_STAGES.has(st) ? b2 : null;
      if (!g) continue;
      g[lr][mm - 1] += (d.deal_amount || 0) / 1000;
    }
    fillSubtotals(b1);
    fillSubtotals(b2);
    fillSubtotals(b3);
    const b4 = emptyGrid();
    const b5 = emptyGrid();
    for (const r of ROWS) {
      for (let m = 0; m < 12; m++) {
        b4[r.key][m] = b1[r.key][m] + b2[r.key][m];
        b5[r.key][m] = b1[r.key][m] + b2[r.key][m] + b3[r.key][m];
      }
    }
    return { 1: b1, 2: b2, 3: b3, 4: b4, 5: b5 } as Record<number, Grid>;
  }, [deals, year, upside]);

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('copy failed');
      setTimeout(() => setCopied(''), 1500);
    }
  }

  // the full grid incl. row labels + all 5 blocks (blocks separated by one empty column)
  function copyFull() {
    const lines = ROWS.map((r) => {
      const cells: (string | number)[] = [r.label];
      for (const b of BLOCKS) {
        cells.push('');
        for (let m = 0; m < 12; m++) cells.push(Math.round(conv(blocks[b.id][r.key][m])));
      }
      return cells.join('\t');
    });
    // header line with block titles
    const header: string[] = [''];
    for (const b of BLOCKS) {
      header.push(b.title);
      for (let m = 0; m < 12; m++) header.push(String(m + 1));
    }
    copyText([header.join('\t'), ...lines].join('\n'), 'full');
  }

  // ---- upside editor (block 3) ----
  const LEAF_ROWS = ROWS.filter((r) => r.leaf);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtUpdated(iso: string | null): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'never';
    return d.toLocaleString('nl-NL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function openEditor() {
    const d: Record<number, string[]> = {};
    for (const r of LEAF_ROWS) {
      const src = upside?.rows?.[String(r.key)] || [];
      d[r.key] = Array.from({ length: 12 }, (_, m) => {
        const v = Number(src[m]) || 0;
        return v ? String(v) : '';
      });
    }
    setDraft(d);
    setSaveErr('');
    setEditing(true);
  }

  // only allow whole integers (optional leading minus); strip everything else
  function setDraftCell(rowKey: number, month: number, raw: string) {
    const clean = raw.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');
    setDraft((prev) => {
      const next = { ...prev, [rowKey]: [...(prev[rowKey] || new Array(12).fill(''))] };
      next[rowKey][month] = clean;
      return next;
    });
  }

  const draftRowTotal = (rowKey: number) =>
    (draft[rowKey] || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  const draftMonthTotal = (month: number) =>
    LEAF_ROWS.reduce((s, r) => s + (parseInt((draft[r.key] || [])[month], 10) || 0), 0);
  const draftGrandTotal = () => LEAF_ROWS.reduce((s, r) => s + draftRowTotal(r.key), 0);

  async function saveUpside() {
    setSaving(true);
    setSaveErr('');
    try {
      const rows: Record<number, number[]> = {};
      for (const r of LEAF_ROWS) {
        rows[r.key] = Array.from({ length: 12 }, (_, m) => parseInt((draft[r.key] || [])[m], 10) || 0);
      }
      const saved = await saveTdjpUpside(year, rows);
      setUpside(saved);
      setEditing(false);
    } catch (e) {
      setSaveErr((e as Error).message || 'Saving failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="tdjp-bar">
        <div className="tdjp-bar-left">
          <span className="tdjp-title">Revenue Input Sheet — {year}</span>
          <span style={{ fontWeight: 600 }}>Convert to</span>
          <label className="toggle-chip">
            <input type="checkbox" checked={cur === 'usd'} onChange={(e) => toggleCur('usd', e.target.checked)} /> $USD
          </label>
          <label className="toggle-chip">
            <input type="checkbox" checked={cur === 'jpy'} onChange={(e) => toggleCur('jpy', e.target.checked)} /> ¥JPY
          </label>
          {cur !== 'eur' && rateLoading && <span className="tdjp-sub">fetching rate…</span>}
          {cur !== 'eur' && !rateLoading && rate && (
            <span className="tdjp-sub">Actual retrieved {ratePairLabel} exchange rate: {rate.toFixed(4)}</span>
          )}
          {cur !== 'eur' && !rateLoading && rateError && (
            <span className="tdjp-sub" style={{ color: 'var(--status-red)' }}>
              exchange rate unavailable — showing EUR
            </span>
          )}
        </div>
        <span className="spacer" />
        <span className="tdjp-upside-updated" title="When the manual upside (block 3) was last edited">
          Upside updated: {fmtUpdated(upside?.updatedAt ?? null)}
        </span>
        <button
          className="btn btn-ghost"
          onClick={openEditor}
          title="Edit the manual upside numbers (block 3) for this year"
        >
          ✎ Edit upside
        </button>
        {copied && <span className="copied-flag">Copied ✓</span>}
        <button className="btn" onClick={copyFull} title="Copy the whole grid (labels + all 5 blocks) as tab-separated values">
          Copy full grid
        </button>
      </div>

      {loading && <div className="placeholder">Loading…</div>}
      {error && (
        <div className="placeholder" style={{ color: 'var(--status-red)' }}>
          Error: {error}
        </div>
      )}

      {!loading && !error && (
        <div className="table-wrap tdjp-wrap">
          <table className="grid tdjp">
            <colgroup>
              <col className="tdjp-col-label" />
              {Array.from({ length: 60 }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="tdjp-cat sticky-col">Revenue Input Sheet</th>
                {BLOCKS.map((b) => (
                  <th key={b.id} className="tdjp-block-head" colSpan={12}>
                    {b.title}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="tdjp-cat sticky-col">{currencyLabel}</th>
                {BLOCKS.map((b) =>
                  Array.from({ length: 12 }, (_, m) => (
                    <th key={b.id + '-' + m} className={'num tdjp-month' + (m === 0 ? ' block-start' : '')}>
                      {m + 1}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className={TOTAL_KEYS.has(r.key) ? 'tdjp-total' : 'tdjp-plain'}>
                  <td className="tdjp-cat sticky-col" style={{ paddingLeft: 6 + r.indent * 10 }}>
                    {r.label}
                  </td>
                  {BLOCKS.map((b) =>
                    blocks[b.id][r.key].map((v, m) => (
                      <td key={b.id + '-' + m} className={'num tdjp-val' + (m === 0 ? ' block-start' : '')}>
                        {fmt(conv(v))}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="up-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div className="up-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="up-head">
              <div>
                <div className="up-title">Edit upside — Forecast (not a hard commit) · {year}</div>
                <div className="up-sub">
                  Whole numbers in <b>k EUR</b> (50 = € 50.000) · always <b>EUR</b>, regardless of the $USD / ¥JPY toggle.
                </div>
              </div>
              <button className="up-x" onClick={() => setEditing(false)} aria-label="Close">×</button>
            </div>

            <div className="up-body">
              {/* Months down, categories across — compact so the whole grid fits the width. */}
              <table className="up-grid">
                <thead>
                  <tr>
                    <th className="up-rowhead">Month</th>
                    {LEAF_ROWS.map((r) => (
                      <th key={r.key} className="up-mhead">{r.label}</th>
                    ))}
                    <th className="up-total-head">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((mLabel, m) => (
                    <tr key={m}>
                      <td className="up-rowlabel">{mLabel}</td>
                      {LEAF_ROWS.map((r) => (
                        <td key={r.key} className="up-cell">
                          <input
                            className="up-input"
                            type="text"
                            inputMode="numeric"
                            value={(draft[r.key] || [])[m] ?? ''}
                            onChange={(e) => setDraftCell(r.key, m, e.target.value)}
                            placeholder="0"
                          />
                        </td>
                      ))}
                      <td className="up-total">{draftMonthTotal(m).toLocaleString('nl-NL')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="up-rowlabel up-foot">Total</td>
                    {LEAF_ROWS.map((r) => (
                      <td key={r.key} className="up-total up-foot">{draftRowTotal(r.key).toLocaleString('nl-NL')}</td>
                    ))}
                    <td className="up-total up-foot">{draftGrandTotal().toLocaleString('nl-NL')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="up-footer">
              {saveErr && <span className="up-err">{saveErr}</span>}
              <span className="spacer" />
              <button className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              <button className="btn" onClick={saveUpside} disabled={saving}>
                {saving ? 'Saving…' : 'Save upside'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
