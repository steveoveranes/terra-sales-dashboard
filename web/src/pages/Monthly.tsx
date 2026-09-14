import { useEffect, useMemo, useState } from 'react';
import { Deal, Meta, fmtInt, getDeals } from '../api';
import MultiSelect from '../components/MultiSelect';
import CheckList from '../components/CheckList';
import ColumnHead from '../components/ColumnHead';

// current month as "YYYY-MM" (used for the overdue colour rules, relative to today)
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Month key ("YYYY-MM") -> human label, e.g. "September 2026"
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
  return `${name} ${y}`;
}

// TerraFlow deep link for a deal. TerraFlow highlights a kanban card by its project
// code (e.g. "26-0004.2"), which is the leading NN-NNNN(.N…) code in the deal name.
// If no such code is present, link to the kanban board itself.
const TERRAFLOW_KANBAN = 'https://terra-flow.ai/kanban/';
function terraflowUrl(dealName: string): string {
  const m = (dealName || '').match(/\b\d{2}-\d{4}(?:\.\d+)*\b/);
  return m ? `${TERRAFLOW_KANBAN}?highlight=${encodeURIComponent(m[0])}` : TERRAFLOW_KANBAN;
}

const NO_MONTH = '__none__';

// small localStorage helper (remembers the user's last filter choices)
const LS = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

// Row colour rule (relative to today's date):
//  1. stage "PO or Quote missing"                       -> red (always)
//  2. stage "Paid"                                      -> dark green
//  3. stage "Can be invoiced"                           -> light green,
//        but orange if execution month is before this month
//  4. not on can-be-invoiced/invoiced/paid AND
//        execution month before this month              -> red
function rowClass(d: Deal, cur: string): string {
  const stage = (d.deal_stage || '').trim().toLowerCase();
  const overdue = !!d.execution_month && d.execution_month < cur;
  if (stage === 'po or quote missing') return 'row-red';
  if (stage === 'paid') return 'row-darkgreen';
  if (stage === 'can be invoiced') return overdue ? 'row-orange' : 'row-lightgreen';
  const settled = stage === 'can be invoiced' || stage === 'invoiced' || stage === 'paid';
  if (!settled && overdue) return 'row-red';
  return '';
}

interface Group {
  key: string; // "YYYY-MM" or NO_MONTH
  label: string;
  deals: Deal[];
  amount: number;
  cost: number;
  margin: number;
  redCount: number;
}

type SortKey = 'deal_name' | 'sales_pipeline' | 'deal_stage' | 'owner' | 'deal_amount' | 'cost_of_sales' | 'margin';
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null;
type Range = { min: string; max: string };

const NUMERIC_KEYS: SortKey[] = ['deal_amount', 'cost_of_sales', 'margin'];

// small checkbox list used inside a column filter menu
function CheckboxMenu({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const all = options.length > 0 && selected.length === options.length;
  return (
    <div className="cbmenu">
      <label className="ms-opt ms-all">
        <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : [...options])} /> All
      </label>
      <div className="ms-divider" />
      <div className="ms-scroll">
        {options.map((o) => (
          <label key={o} className="ms-opt">
            <input
              type="checkbox"
              checked={selected.includes(o)}
              onChange={() => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])}
            />
            {o}
          </label>
        ))}
        {options.length === 0 && <span className="subtle" style={{ fontSize: 12 }}>—</span>}
      </div>
    </div>
  );
}

export default function Monthly({
  year,
  refreshKey,
  meta,
}: {
  year: number;
  refreshKey: number;
  meta: Meta | null;
}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filter state
  const [owners, setOwners] = useState<string[]>([]);
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => LS.get<Record<string, boolean>>('tsd.collapsed') || {});
  const [onlyRed, setOnlyRed] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  // per-column numeric range filters
  const [ranges, setRanges] = useState<Record<'deal_amount' | 'cost_of_sales' | 'margin', Range>>({
    deal_amount: { min: '', max: '' },
    cost_of_sales: { min: '', max: '' },
    margin: { min: '', max: '' },
  });
  function setRange(key: 'deal_amount' | 'cost_of_sales' | 'margin', side: 'min' | 'max', val: string) {
    setRanges((r) => ({ ...r, [key]: { ...r[key], [side]: val } }));
  }

  // sort state (single active column, 3-state: asc -> desc -> none), remembered
  const [sort, setSort] = useState<SortState>(() => LS.get<SortState>('tsd.sort') || null);
  useEffect(() => {
    LS.set('tsd.sort', sort);
  }, [sort]);
  useEffect(() => {
    LS.set('tsd.collapsed', collapsed);
  }, [collapsed]);
  function cycleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  // last remembered partial selections (used when "All" is unchecked again)
  const [ownersSub, setOwnersSub] = useState<string[]>(() => LS.get<string[]>('tsd.owners.subset') || []);
  const [pipesSub, setPipesSub] = useState<string[]>(() => LS.get<string[]>('tsd.pipelines.subset') || []);

  const cur = useMemo(currentMonth, []);

  // load deals
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

  // distinct filter options, derived from the deals actually present
  const ownerOptions = useMemo(
    () => [...new Set(deals.map((d) => d.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [deals]
  );
  const pipelineOptions = useMemo(
    () => [...new Set(deals.map((d) => d.sales_pipeline).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [deals]
  );
  // Deal stages can appear with different casing across HubSpot pipelines
  // (e.g. "Can be invoiced" vs "Can be Invoiced"). De-duplicate case-insensitively
  // so the user sees one entry; picking it applies to every casing variant.
  const stageOptions = useMemo(() => {
    const variants = new Map<string, Map<string, number>>(); // key -> (display -> count)
    for (const d of deals) {
      const raw = (d.deal_stage || '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!variants.has(key)) variants.set(key, new Map());
      const m = variants.get(key)!;
      m.set(raw, (m.get(raw) || 0) + 1);
    }
    const canonical: string[] = [];
    for (const m of variants.values()) {
      const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      canonical.push(best);
    }
    return canonical.sort((a, b) => a.localeCompare(b));
  }, [deals]);

  // (re)initialise filter selections whenever the data set or defaults change.
  useEffect(() => {
    if (!ownerOptions.length && !pipelineOptions.length && !stageOptions.length) return;
    const hidden = new Set((meta?.defaultHiddenStages || []).map((s) => s.trim().toLowerCase()));

    const savedO = LS.get<string[]>('tsd.owners.current');
    const savedP = LS.get<string[]>('tsd.pipelines.current');
    const savedS = LS.get<string[]>('tsd.stages.current');

    setOwners(savedO ? ownerOptions.filter((o) => savedO.includes(o)) : ownerOptions);
    setPipelines(savedP ? pipelineOptions.filter((o) => savedP.includes(o)) : pipelineOptions);
    setStages(
      savedS ? stageOptions.filter((o) => savedS.includes(o)) : stageOptions.filter((s) => !hidden.has(s.trim().toLowerCase()))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerOptions, pipelineOptions, stageOptions, meta]);

  // persist current selections + remember partial subsets
  useEffect(() => {
    if (!ownerOptions.length) return;
    LS.set('tsd.owners.current', owners.length ? owners : null);
    if (owners.length > 0 && owners.length < ownerOptions.length) {
      LS.set('tsd.owners.subset', owners);
      setOwnersSub(owners);
    }
  }, [owners, ownerOptions]);

  useEffect(() => {
    if (!pipelineOptions.length) return;
    LS.set('tsd.pipelines.current', pipelines.length ? pipelines : null);
    if (pipelines.length > 0 && pipelines.length < pipelineOptions.length) {
      LS.set('tsd.pipelines.subset', pipelines);
      setPipesSub(pipelines);
    }
  }, [pipelines, pipelineOptions]);

  useEffect(() => {
    if (!stageOptions.length) return;
    LS.set('tsd.stages.current', stages.length ? stages : null);
  }, [stages, stageOptions]);

  // apply filters
  const filtered = useMemo(() => {
    const ownerSet = new Set(owners);
    const pipeSet = new Set(pipelines);
    const stageKeySet = new Set(stages.map((s) => s.trim().toLowerCase())); // case-insensitive
    const q = search.trim().toLowerCase();
    const inRange = (v: number, r: Range) => {
      if (r.min !== '' && v < Number(r.min)) return false;
      if (r.max !== '' && v > Number(r.max)) return false;
      return true;
    };
    return deals.filter((d) => {
      if (!ownerSet.has(d.owner)) return false;
      if (!pipeSet.has(d.sales_pipeline)) return false;
      if (!stageKeySet.has((d.deal_stage || '').trim().toLowerCase())) return false;
      if (q && !(d.deal_name || '').toLowerCase().includes(q)) return false;
      if (!inRange(d.deal_amount, ranges.deal_amount)) return false;
      if (!inRange(d.cost_of_sales, ranges.cost_of_sales)) return false;
      if (!inRange(d.margin, ranges.margin)) return false;
      if (onlyRed && rowClass(d, cur) !== 'row-red') return false;
      return true;
    });
  }, [deals, owners, pipelines, stages, search, ranges, onlyRed, cur]);

  // group by execution month; "No execution date" sorts last. Sorting (when active)
  // is applied WITHIN each month group, so the monthly grouping is preserved.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Deal[]>();
    for (const d of filtered) {
      const key = d.execution_month || NO_MONTH;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === NO_MONTH) return 1;
      if (b === NO_MONTH) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const cmp = (a: Deal, b: Deal): number => {
      if (!sort) return 0;
      const k = sort.key;
      let c: number;
      if (NUMERIC_KEYS.includes(k)) c = (a[k] as number) - (b[k] as number);
      else c = String(a[k] || '').toLowerCase().localeCompare(String(b[k] || '').toLowerCase());
      return sort.dir === 'asc' ? c : -c;
    };
    return keys.map((key) => {
      const gd = map.get(key)!;
      const amount = gd.reduce((s, d) => s + d.deal_amount, 0);
      const cost = gd.reduce((s, d) => s + d.cost_of_sales, 0);
      const margin = gd.reduce((s, d) => s + d.margin, 0);
      const redCount = gd.reduce((n, d) => n + (rowClass(d, cur) === 'row-red' ? 1 : 0), 0);
      const sorted = sort ? [...gd].sort(cmp) : gd;
      return {
        key,
        label: key === NO_MONTH ? 'No execution date' : monthLabel(key),
        deals: sorted,
        amount,
        cost,
        margin,
        redCount,
      };
    });
  }, [filtered, cur, sort]);

  const grand = useMemo(
    () =>
      filtered.reduce(
        (a, d) => {
          a.amount += d.deal_amount;
          a.cost += d.cost_of_sales;
          a.margin += d.margin;
          return a;
        },
        { amount: 0, cost: 0, margin: 0 }
      ),
    [filtered]
  );

  function toggleGroup(key: string) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }
  function expandAll() {
    setCollapsed({});
  }
  function collapseAll() {
    const all: Record<string, boolean> = {};
    for (const g of groups) all[g.key] = true;
    setCollapsed(all);
  }

  // Export the current (filtered + sorted) view to a CSV that Dutch Excel opens
  // cleanly: ";" separator + UTF-8 BOM so € and accented names render correctly.
  function exportCsv() {
    const sep = ';';
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = [
      'Execution date',
      'Month',
      'Deal name',
      'Sales pipeline',
      'Deal stage',
      'Owner',
      'Deal amount',
      'Cost of sales',
      'Margin',
      'Deal link',
    ];
    const lines = [header.join(sep)];
    for (const g of groups) {
      for (const d of g.deals) {
        lines.push(
          [
            d.execution_date ? d.execution_date.slice(0, 10) : '',
            g.key === NO_MONTH ? 'No execution date' : g.label,
            d.deal_name,
            d.sales_pipeline,
            d.deal_stage,
            d.owner,
            Math.round(d.deal_amount),
            Math.round(d.cost_of_sales),
            Math.round(d.margin),
            d.deal_link,
          ]
            .map(esc)
            .join(sep)
        );
      }
    }
    const csv = '﻿' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-monthly-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const sortDir = (key: SortKey): 'asc' | 'desc' | null => (sort?.key === key ? sort.dir : null);

  // active-filter indicators per column
  const nameFilterActive = search.trim() !== '';
  const pipeFilterActive = pipelines.length < pipelineOptions.length;
  const stageFilterActive = stages.length < stageOptions.length;
  const ownerFilterActive = owners.length < ownerOptions.length;
  const rangeActive = (r: Range) => r.min !== '' || r.max !== '';

  const nameMenu = () => (
    <div className="search-input-wrap col-search">
      <input
        type="text"
        className="text-input"
        placeholder="Search…"
        value={search}
        autoFocus
        onChange={(e) => setSearch(e.target.value)}
      />
      {search && (
        <button type="button" className="search-clear" onClick={() => setSearch('')} title="Clear" aria-label="Clear">
          ×
        </button>
      )}
    </div>
  );
  const rangeMenu = (key: 'deal_amount' | 'cost_of_sales' | 'margin') => () =>
    (
      <div className="range-menu">
        <div className="range-row">
          <label>From</label>
          <input type="number" value={ranges[key].min} onChange={(e) => setRange(key, 'min', e.target.value)} />
        </div>
        <div className="range-row">
          <label>To</label>
          <input type="number" value={ranges[key].max} onChange={(e) => setRange(key, 'max', e.target.value)} />
        </div>
        <button type="button" className="link-btn" onClick={() => setRanges((r) => ({ ...r, [key]: { min: '', max: '' } }))}>
          Clear
        </button>
      </div>
    );

  const expandCollapse = (
    <>
      <button className="hdr-icon" title="Expand all months" aria-label="Expand all months" onClick={expandAll}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>
      <button className="hdr-icon" title="Collapse all months" aria-label="Collapse all months" onClick={collapseAll}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>
    </>
  );

  return (
    <div className="card">
      <div className="filterbar">
        <CheckList
          label="Account manager"
          options={ownerOptions}
          selected={owners}
          onChange={setOwners}
          columns={3}
          rememberedSubset={ownersSub}
        />
        <CheckList
          label="Sales pipeline"
          options={pipelineOptions}
          selected={pipelines}
          onChange={setPipelines}
          columns={3}
          rememberedSubset={pipesSub}
        />
        <MultiSelect label="Deal stage" options={stageOptions} selected={stages} onChange={setStages} />
        <div className="filter-right">
          <label className="toggle-chip" title="Show only deals that need attention (red)">
            <input type="checkbox" checked={onlyRed} onChange={(e) => setOnlyRed(e.target.checked)} />
            <span className="dot-red" /> Only attention
          </label>
          <button
            type="button"
            className="ghost-btn"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((o) => !o)}
          >
            Legend
          </button>
          <div className="search-block">
            <span className="cl-label">Deal name</span>
            <div className="search-input-wrap">
              <input
                type="text"
                className="text-input"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => setSearch('')}
                >
                  ×
                </button>
              )}
            </div>
            <span className="count-pill">{filtered.length} deals</span>
          </div>
          <button type="button" className="btn export-btn" onClick={exportCsv} title="Export the current view to CSV (Excel)">
            Export
          </button>
        </div>
      </div>

      {legendOpen && (
        <div className="legend">
          <span className="legend-item">
            <span className="sw sw-red" /> Overdue, or PO/Quote missing — needs action
          </span>
          <span className="legend-item">
            <span className="sw sw-orange" /> Can be invoiced (execution month already passed)
          </span>
          <span className="legend-item">
            <span className="sw sw-lightgreen" /> Can be invoiced
          </span>
          <span className="legend-item">
            <span className="sw sw-darkgreen" /> Paid
          </span>
        </div>
      )}

      {loading && <div className="placeholder">Loading…</div>}
      {error && (
        <div className="placeholder" style={{ color: 'var(--status-red)' }}>
          Error: {error}
        </div>
      )}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="grid monthly">
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <ColumnHead
                    label="Deal name"
                    sortDir={sortDir('deal_name')}
                    onCycleSort={() => cycleSort('deal_name')}
                    filterActive={nameFilterActive}
                    renderMenu={nameMenu}
                    extra={expandCollapse}
                  />
                </th>
                <th>
                  <ColumnHead
                    label="Sales pipeline"
                    sortDir={sortDir('sales_pipeline')}
                    onCycleSort={() => cycleSort('sales_pipeline')}
                    filterActive={pipeFilterActive}
                    renderMenu={() => (
                      <CheckboxMenu options={pipelineOptions} selected={pipelines} onChange={setPipelines} />
                    )}
                  />
                </th>
                <th>
                  <ColumnHead
                    label="Deal stage"
                    sortDir={sortDir('deal_stage')}
                    onCycleSort={() => cycleSort('deal_stage')}
                    filterActive={stageFilterActive}
                    renderMenu={() => <CheckboxMenu options={stageOptions} selected={stages} onChange={setStages} />}
                  />
                </th>
                <th>
                  <ColumnHead
                    label="Owner"
                    sortDir={sortDir('owner')}
                    onCycleSort={() => cycleSort('owner')}
                    filterActive={ownerFilterActive}
                    renderMenu={() => <CheckboxMenu options={ownerOptions} selected={owners} onChange={setOwners} />}
                  />
                </th>
                <th className="num">
                  <ColumnHead
                    label="Deal amount"
                    numeric
                    sortDir={sortDir('deal_amount')}
                    onCycleSort={() => cycleSort('deal_amount')}
                    filterActive={rangeActive(ranges.deal_amount)}
                    renderMenu={rangeMenu('deal_amount')}
                  />
                </th>
                <th className="num">
                  <ColumnHead
                    label="Cost of sales"
                    numeric
                    sortDir={sortDir('cost_of_sales')}
                    onCycleSort={() => cycleSort('cost_of_sales')}
                    filterActive={rangeActive(ranges.cost_of_sales)}
                    renderMenu={rangeMenu('cost_of_sales')}
                  />
                </th>
                <th className="num">
                  <ColumnHead
                    label="Margin"
                    numeric
                    sortDir={sortDir('margin')}
                    onCycleSort={() => cycleSort('margin')}
                    filterActive={rangeActive(ranges.margin)}
                    renderMenu={rangeMenu('margin')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupBlock
                  key={g.key}
                  group={g}
                  collapsed={!!collapsed[g.key]}
                  onToggle={() => toggleGroup(g.key)}
                  cur={cur}
                  isCurrent={g.key === cur}
                />
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={7} className="placeholder" style={{ padding: '32px' }}>
                    No deals match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="grand-total">
                <td colSpan={4} style={{ textAlign: 'right' }}>
                  Year total {year}
                </td>
                <td className="num">{fmtInt(grand.amount)}</td>
                <td className="num">{fmtInt(grand.cost)}</td>
                <td className="num">{fmtInt(grand.margin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupBlock({
  group,
  collapsed,
  onToggle,
  cur,
  isCurrent,
}: {
  group: Group;
  collapsed: boolean;
  onToggle: () => void;
  cur: string;
  isCurrent: boolean;
}) {
  return (
    <>
      <tr className={'group-header' + (isCurrent ? ' current' : '')} onClick={onToggle}>
        <td colSpan={4}>
          <span className="group-caret">{collapsed ? '▸' : '▾'}</span>
          {group.label}
          {isCurrent && <span className="current-tag">current</span>}
          <span className="group-count">{group.deals.length}</span>
          {group.redCount > 0 && (
            <span className="group-count group-red" title="Deals needing attention (red)">
              {group.redCount}
            </span>
          )}
        </td>
        <td className="num">{fmtInt(group.amount)}</td>
        <td className="num">{fmtInt(group.cost)}</td>
        <td className="num">{fmtInt(group.margin)}</td>
      </tr>
      {!collapsed &&
        group.deals.map((d) => (
          <tr key={d.id} className={rowClass(d, cur)}>
            <td>
              <a className="deal-link" href={terraflowUrl(d.deal_name)} target="_blank" rel="noreferrer" title="Open in TerraFlow">
                {d.deal_name}
              </a>
              <a
                className="hs-link"
                href={d.deal_link}
                target="_blank"
                rel="noreferrer"
                title="Open in HubSpot"
                aria-label="Open in HubSpot"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="#ff7a59" aria-hidden="true">
                  <path d="M18.164 7.931V5.084a2.198 2.198 0 0 0 1.267-1.978v-.066A2.199 2.199 0 0 0 17.238.845h-.067a2.199 2.199 0 0 0-2.193 2.195v.066a2.198 2.198 0 0 0 1.252 1.973l.013.006v2.852a6.22 6.22 0 0 0-2.969 1.31l.012-.01-7.828-6.096A2.497 2.497 0 1 0 3.9 6.919l-.007-.005 7.702 5.984a6.235 6.235 0 0 0-1.048 3.474c0 1.315.407 2.535 1.103 3.541l-.014-.021-2.342 2.343a2.03 2.03 0 0 0-.585-.09h-.001a2.031 2.031 0 1 0 2.03 2.031c0-.209-.032-.411-.09-.601l.004.014 2.317-2.317a6.257 6.257 0 1 0 4.892-11.815l-.058-.02zm-1.056 9.402a3.21 3.21 0 1 1 .001-6.42 3.21 3.21 0 0 1-.001 6.42z" />
                </svg>
              </a>
            </td>
            <td>{d.sales_pipeline}</td>
            <td>{d.deal_stage}</td>
            <td>{d.owner}</td>
            <td className="num">{fmtInt(d.deal_amount)}</td>
            <td className="num">{fmtInt(d.cost_of_sales)}</td>
            <td className="num">{fmtInt(d.margin)}</td>
          </tr>
        ))}
    </>
  );
}
