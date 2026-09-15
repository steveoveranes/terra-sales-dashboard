import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Deal, Meta, getDeals, getBudget, Budget, BudgetMonth, fmtInt, fmtCompact, fmtPct } from '../api';
import MultiSelect from '../components/MultiSelect';
import EChart, { EChartHandle } from '../components/EChart';
import { customerOf } from '../customerRules';

/* ---------------- constants ---------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Categorical palette, tuned a touch brighter for a dark dashboard surface.
const CAT = ['#4f9df7', '#ff8a5b', '#2fd4a7', '#ffc23d', '#f78ab0', '#5ad469', '#9b8cff', '#ff6b6b'];
const BLUE = '#4f9df7';
const AQUA = '#22d3ee';
const GRAY = '#8593b5';
const GREEN = '#37d39a';
const RED = '#ff6b6b';
const INK = '#e8edf9'; // primary text on dark
const MUTED = '#93a1c4'; // secondary text on dark
const LINE = 'rgba(255,255,255,0.10)'; // gridlines on dark
const CARDBG = '#16244d'; // ~card colour, used for pie slice gaps

const AXIS = {
  axisLine: { lineStyle: { color: LINE } },
  axisTick: { show: false },
  axisLabel: { color: MUTED },
};
const SPLIT = { splitLine: { lineStyle: { color: LINE, type: 'dashed' as const } } };

// Blend two hex colours (0..1 toward `b`).
function mix(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const p = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// A soft gradient for a base colour, so bars get depth instead of looking flat.
// dir 'h' = left→right (horizontal bars), 'v' = bottom→top (vertical bars).
function grad(base: string, dir: 'h' | 'v' = 'h') {
  const lighter = mix(base, '#ffffff', 0.4);
  const coords = dir === 'h' ? [0, 0, 1, 0] : [0, 1, 0, 0];
  return new echarts.graphic.LinearGradient(coords[0], coords[1], coords[2], coords[3], [
    { offset: 0, color: base },
    { offset: 1, color: lighter },
  ]);
}

// soft "track" behind each bar, for the modern capsule look (on dark)
const TRACK = { color: 'rgba(255,255,255,0.06)', borderRadius: 6 };

/* ---------------- tiny localStorage helper ---------------- */

const LS = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

/* ---------------- helpers ---------------- */

function monthIdx(execMonth: string | null): number {
  // "YYYY-MM" -> 0..11, or -1 when there is no execution month
  if (!execMonth) return -1;
  const m = parseInt(execMonth.slice(5, 7), 10);
  return isNaN(m) ? -1 : m - 1;
}

// Month bucket for a deal in the monthly charts: execution month when known,
// otherwise fall back to the close-date month so deals without an execution date
// are still counted (keeps the monthly totals equal to the KPI totals).
function monthOfDeal(d: Deal): number {
  if (d.execution_month) return monthIdx(d.execution_month);
  if (d.close_date) {
    const raw = d.close_date;
    const dt = new Date(isNaN(Number(raw)) ? raw : Number(raw));
    if (!isNaN(dt.getTime())) return dt.getUTCMonth();
  }
  return -1;
}

function applyFilters(
  deals: Deal[],
  f: { owners: string[]; pipelines: string[]; stages: string[]; search: string }
): Deal[] {
  const q = f.search.trim().toLowerCase();
  const os = new Set(f.owners);
  const ps = new Set(f.pipelines);
  const ss = new Set(f.stages);
  return deals.filter((d) => {
    if (!ps.has(d.sales_pipeline)) return false;
    if (!ss.has(d.deal_stage)) return false;
    if (!os.has(d.owner || '—')) return false;
    if (q && !(`${d.deal_name} ${d.customer} ${d.owner}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

// Customer name resolution (associated company, else parsed from the deal name)
// plus the learned alias/override rules live in ../customerRules.
const custName = (d: Deal) => customerOf(d);
const ownerName = (d: Deal) => d.owner || '—';

function sum(deals: Deal[], pick: (d: Deal) => number): number {
  let t = 0;
  for (const d of deals) t += pick(d) || 0;
  return t;
}

function groupSum(deals: Deal[], key: (d: Deal) => string, pick: (d: Deal) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of deals) m.set(key(d), (m.get(key(d)) || 0) + (pick(d) || 0));
  return m;
}

function baseGrid(extra?: Record<string, unknown>) {
  return { left: 64, right: 24, top: 24, bottom: 56, containLabel: true, ...extra };
}

// height that fits every category label (interval 0) for a horizontal bar chart
function barHeight(count: number, min = 260) {
  return Math.max(min, count * 34 + 90);
}

/**
 * Polished horizontal bar chart: gradient fill, rounded ends, a soft background
 * track per row, every label shown, value labels at the end, minimal axes.
 */
function horizontalBars(opts: {
  rows: { name: string; value: number }[];
  color: string | ((name: string, value: number) => string);
  valueFmt: (v: number) => string;
  axisFmt: (v: number) => string;
  labelWidth?: number;
}) {
  const { rows, color, valueFmt, axisFmt, labelWidth = 150 } = opts;
  const colorOf = (name: string, value: number) =>
    typeof color === 'function' ? color(name, value) : color;
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,56,147,0.06)' } },
      valueFormatter: (v: number) => valueFmt(v),
    },
    grid: { left: 8, right: 64, top: 12, bottom: 12, containLabel: true },
    xAxis: {
      type: 'value',
      ...AXIS,
      axisLine: { show: false },
      ...SPLIT,
      axisLabel: { color: MUTED, formatter: (v: number) => axisFmt(v) },
    },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK, interval: 0, width: labelWidth, overflow: 'truncate', fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => ({ value: r.value, itemStyle: { color: grad(colorOf(r.name, r.value)), borderRadius: [4, 6, 6, 4] } })),
        barWidth: 16,
        showBackground: true,
        backgroundStyle: TRACK,
        label: {
          show: true,
          position: 'right',
          distance: 6,
          formatter: (p: any) => valueFmt(p.value),
          color: INK,
          fontSize: 11,
          fontWeight: 600,
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(20,56,147,0.25)' } },
        animationDuration: 700,
      },
    ],
  };
}

/* ---------------- budget chart types ---------------- */

type BudgetChartType = 'group' | 'barline' | 'line' | 'smooth' | 'area' | 'step';
const BUDGET_TYPES: { key: BudgetChartType; label: string }[] = [
  { key: 'group', label: 'Grouped bars' },
  { key: 'barline', label: 'Bars + budget line' },
  { key: 'line', label: 'Lines' },
  { key: 'smooth', label: 'Smooth lines' },
  { key: 'area', label: 'Area' },
  { key: 'step', label: 'Step lines' },
];

function cumulate(arr: number[]): number[] {
  let t = 0;
  return arr.map((v) => (t += v));
}

// Build the ECharts series for the budget chart, per chosen type.
function buildBudgetSeries(
  type: BudgetChartType,
  actual: number[],
  budget: number[],
  actualColor: string,
  actualName: string,
  hasBudget: boolean
): any[] {
  const B = 'Budget';
  const budgetLine = { name: B, type: 'line', data: budget, symbol: 'none', lineStyle: { width: 2, color: GRAY, type: 'dashed' }, itemStyle: { color: GRAY } };
  if (type === 'group') {
    const s: any[] = [{ name: actualName, type: 'bar', data: actual, itemStyle: { color: grad(actualColor, 'v'), borderRadius: [6, 6, 0, 0] }, barMaxWidth: 26, animationDuration: 600 }];
    if (hasBudget) s.push({ name: B, type: 'bar', data: budget, itemStyle: { color: grad(GRAY, 'v'), borderRadius: [6, 6, 0, 0] }, barMaxWidth: 26, animationDuration: 600 });
    return s;
  }
  if (type === 'barline') {
    const s: any[] = [{ name: actualName, type: 'bar', data: actual, itemStyle: { color: grad(actualColor, 'v'), borderRadius: [6, 6, 0, 0] }, barMaxWidth: 30, animationDuration: 600 }];
    if (hasBudget) s.push({ ...budgetLine, smooth: true, symbol: 'circle', symbolSize: 6, z: 5 });
    return s;
  }
  const smooth = type === 'smooth' || type === 'area';
  const step = type === 'step' ? 'middle' : undefined;
  const s: any[] = [
    {
      name: actualName,
      type: 'line',
      data: actual,
      smooth,
      step,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 3, color: actualColor },
      itemStyle: { color: actualColor },
      areaStyle: type === 'area' ? { color: actualColor, opacity: 0.16 } : undefined,
      z: 5,
    },
  ];
  if (hasBudget) s.push({ ...budgetLine, smooth, step });
  return s;
}

// tiny schematic preview of each chart type (for the picker)
function TypePreview({ type }: { type: BudgetChartType }) {
  const c = '#7fb2ff';
  const g = '#9aa7c4';
  const common = { width: 40, height: 22, viewBox: '0 0 40 22' } as const;
  if (type === 'group')
    return (
      <svg {...common}>
        {[4, 16, 28].map((x, i) => (
          <g key={i}>
            <rect x={x} y={22 - (8 + i * 3)} width="4" height={8 + i * 3} fill={c} rx="1" />
            <rect x={x + 5} y={22 - (6 + i * 3)} width="4" height={6 + i * 3} fill={g} rx="1" />
          </g>
        ))}
      </svg>
    );
  if (type === 'barline')
    return (
      <svg {...common}>
        {[5, 16, 27].map((x, i) => (
          <rect key={i} x={x} y={22 - (7 + i * 4)} width="6" height={7 + i * 4} fill={c} rx="1" />
        ))}
        <polyline points="8,12 19,8 30,5" fill="none" stroke={g} strokeWidth="1.6" strokeDasharray="3 2" />
      </svg>
    );
  if (type === 'line')
    return (
      <svg {...common}>
        <polyline points="3,16 13,8 23,12 37,4" fill="none" stroke={c} strokeWidth="2" />
        <polyline points="3,18 13,14 23,15 37,10" fill="none" stroke={g} strokeWidth="1.6" strokeDasharray="3 2" />
      </svg>
    );
  if (type === 'smooth')
    return (
      <svg {...common}>
        <path d="M3 16 C 10 6, 16 6, 22 12 S 32 4, 37 5" fill="none" stroke={c} strokeWidth="2" />
        <path d="M3 18 C 10 12, 16 13, 22 15 S 32 10, 37 10" fill="none" stroke={g} strokeWidth="1.6" strokeDasharray="3 2" />
      </svg>
    );
  if (type === 'area')
    return (
      <svg {...common}>
        <path d="M3 16 C 10 6, 16 6, 22 12 S 32 4, 37 5 L37 22 L3 22 Z" fill={c} opacity="0.3" />
        <path d="M3 16 C 10 6, 16 6, 22 12 S 32 4, 37 5" fill="none" stroke={c} strokeWidth="2" />
      </svg>
    );
  // step
  return (
    <svg {...common}>
      <polyline points="3,16 12,16 12,9 22,9 22,13 31,13 31,5 37,5" fill="none" stroke={c} strokeWidth="2" />
    </svg>
  );
}

function ChartTypeMenu({ value, onChange }: { value: BudgetChartType; onChange: (t: BudgetChartType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div className="ctmenu" ref={ref}>
      <button className="icon-btn" title="Chart type" aria-label="Chart type" onClick={() => setOpen((o) => !o)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      </button>
      {open && (
        <div className="ctmenu-panel">
          {BUDGET_TYPES.map((t) => (
            <button
              key={t.key}
              className={'ctmenu-opt' + (value === t.key ? ' active' : '')}
              onClick={() => {
                onChange(t.key);
                setOpen(false);
              }}
            >
              <span className="ctmenu-preview">
                <TypePreview type={t.key} />
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- KPI tile + sparkline ---------------- */

// Lightweight inline-SVG sparkline (no chart instance needed).
// Optional `data2` is drawn as a dashed reference line (e.g. budget), sharing the
// same scale as `data`.
function Sparkline({ data, data2, color = BLUE }: { data: number[]; data2?: number[]; color?: string }) {
  const vals = data && data.length ? data : [0];
  const w = 100;
  const h = 30;
  const all = data2 && data2.length ? vals.concat(data2) : vals;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const toPath = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = arr.length === 1 ? w : (i / (arr.length - 1)) * w;
        const y = h - 3 - ((v - min) / span) * (h - 6);
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  const line = toPath(vals);
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  const id = 'sg' + Math.round(vals.reduce((a, b) => a + b, 0)) + '-' + vals.length;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="22">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      {data2 && data2.length > 1 && (
        <path
          d={toPath(data2)}
          fill="none"
          stroke="#9aa7c4"
          strokeWidth="1.3"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  goodWhenUp = true,
  spark,
  spark2,
  sparkColor,
  note,
  noteColor,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  goodWhenUp?: boolean;
  spark?: number[];
  spark2?: number[];
  sparkColor?: string;
  note?: string;
  noteColor?: string;
}) {
  let deltaEl = null;
  if (delta !== null && delta !== undefined && isFinite(delta)) {
    const up = delta >= 0;
    const good = goodWhenUp ? up : !up;
    deltaEl = (
      <span className="kpi-delta" style={{ color: good ? GREEN : RED }}>
        {up ? '▲' : '▼'} {fmtPct(Math.abs(delta))}
      </span>
    );
  }
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        {deltaEl}
        {sub && <span className="kpi-sub">{sub}</span>}
      </div>
      {note && (
        <div className="kpi-note" style={noteColor ? { color: noteColor } : undefined}>
          {note}
        </div>
      )}
      {spark && spark.filter((v) => v).length > 1 && <Sparkline data={spark} data2={spark2} color={sparkColor} />}
    </div>
  );
}

/* ---------------- card ---------------- */

function Card({
  title,
  hint,
  controls,
  wide,
  children,
}: {
  title: string;
  hint?: string;
  controls?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={'gcard' + (wide ? ' wide' : '')}>
      <div className="gcard-head">
        <div>
          <h3>{title}</h3>
          {hint && <span className="gcard-hint">{hint}</span>}
        </div>
        {controls && <div className="gcard-controls">{controls}</div>}
      </div>
      {children}
    </div>
  );
}

// A chart card with title, optional controls, and a PNG-download button in the
// header (so the download control never overlaps the chart itself).
function ChartBlock({
  title,
  hint,
  controls,
  wide,
  height,
  option,
  downloadName,
  empty,
}: {
  title: string;
  hint?: string;
  controls?: React.ReactNode;
  wide?: boolean;
  height: number;
  option: any;
  downloadName: string;
  empty?: boolean;
}) {
  const ref = useRef<EChartHandle>(null);
  return (
    <Card
      title={title}
      hint={hint}
      wide={wide}
      controls={
        <>
          {controls}
          <button
            className="icon-btn"
            title="Download as image"
            aria-label="Download as image"
            onClick={() => ref.current?.download(downloadName)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="M7 11l5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
          </button>
        </>
      }
    >
      {empty ? <div className="empty small">No data</div> : <EChart ref={ref} option={option} height={height} />}
    </Card>
  );
}

// small read-only Actual-vs-Budget table (one metric), through `n` months
function BudgetVsActualTable({
  title,
  actual,
  budget,
  n,
  hasBudget,
  cumulative,
}: {
  title: string;
  actual: number[];
  budget: number[];
  n: number;
  hasBudget: boolean;
  cumulative?: boolean;
}) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let runA = 0,
    runB = 0;
  let totA = 0,
    totB = 0;
  return (
    <div className="bva">
      <div className="bva-title">{title}</div>
      <table className="bva-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Actual</th>
            <th className="num">Budget</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            runA += actual[i] || 0;
            runB += budget[i] || 0;
            totA += actual[i] || 0;
            totB += budget[i] || 0;
            const a = cumulative ? runA : actual[i] || 0;
            const b = cumulative ? runB : budget[i] || 0;
            const d = a - b;
            return (
              <tr key={i}>
                <td>{MON[i]}</td>
                <td className="num">{fmtCompact(a)}</td>
                <td className="num">{hasBudget ? fmtCompact(b) : '–'}</td>
                <td className="num" style={{ color: !hasBudget ? MUTED : d >= 0 ? GREEN : RED }}>
                  {hasBudget ? fmtCompact(d) : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">{fmtCompact(totA)}</td>
            <td className="num">{hasBudget ? fmtCompact(totB) : '–'}</td>
            <td className="num" style={{ color: !hasBudget ? MUTED : totA - totB >= 0 ? GREEN : RED }}>
              {hasBudget ? fmtCompact(totA - totB) : '–'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// small segmented control
function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.key}
          className={'seg-btn' + (value === o.key ? ' active' : '')}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- main ---------------- */

type Metric = 'revenue' | 'margin' | 'marginpct';

export default function Graphs({
  year,
  refreshKey,
  meta,
}: {
  year: number;
  refreshKey: number;
  meta: Meta | null;
}) {
  const [byYear, setByYear] = useState<Record<number, Deal[]>>({});
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [owners, setOwners] = useState<string[]>([]);
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [includeNoExec, setIncludeNoExec] = useState<boolean>(() => LS.get<boolean>('tsd.g.includeNoExec') ?? false);
  const [initDone, setInitDone] = useState(false);
  useEffect(() => { LS.set('tsd.g.includeNoExec', includeNoExec); }, [includeNoExec]);

  // per-card controls
  const [pipeChart, setPipeChart] = useState<'donut' | 'bar'>('donut');
  const [amMetric, setAmMetric] = useState<Metric>('revenue');
  const [custDir, setCustDir] = useState<'top' | 'bottom'>('top');
  const [custCount, setCustCount] = useState<number>(() => LS.get<number>('tsd.g.custCount') || 30);
  const [yoyMetric, setYoyMetric] = useState<Metric>('revenue');
  const [yoyMode, setYoyMode] = useState<'monthly' | 'cumulative'>('monthly');
  const [budgetMetric, setBudgetMetric] = useState<'sales' | 'margin'>(() => (LS.get<'sales' | 'margin'>('tsd.g.budgetMetric2')) || 'margin');
  const [budgetMode, setBudgetMode] = useState<'month' | 'cumulative'>(() => (LS.get<'month' | 'cumulative'>('tsd.g.budgetMode2')) || 'cumulative');
  const [budgetType, setBudgetType] = useState<BudgetChartType>(() => (LS.get<BudgetChartType>('tsd.g.budgetType')) || 'group');
  const budgetChartRef = useRef<EChartHandle>(null);
  useEffect(() => { LS.set('tsd.g.budgetMetric2', budgetMetric); }, [budgetMetric]);
  useEffect(() => { LS.set('tsd.g.budgetMode2', budgetMode); }, [budgetMode]);
  useEffect(() => { LS.set('tsd.g.budgetType', budgetType); }, [budgetType]);

  // period (month) filter: 'full' year, or a month index 0..11 meaning "through that month"
  const [periodMonth, setPeriodMonth] = useState<number | 'full'>('full');
  // whenever the year changes, always fall back to Full year
  useEffect(() => {
    setPeriodMonth('full');
  }, [year]);
  const monthsCount = periodMonth === 'full' ? 12 : periodMonth + 1;
  const periodLabel = periodMonth === 'full' ? `${year}` : `until ${MONTHS[periodMonth]} ${year}`;
  const inPeriod = (d: Deal) => {
    if (periodMonth === 'full') return true;
    const mi = monthOfDeal(d);
    return mi >= 0 && mi <= periodMonth;
  };

  const years = useMemo(
    () => (meta?.dataYears?.length ? meta.dataYears : [year]),
    [meta?.dataYears, year]
  );

  // load deals for every year that has data (for YoY + last-year deltas)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all(years.map((y) => getDeals(y).then((r) => [y, r.deals] as const)))
      .then((entries) => {
        if (!alive) return;
        // HubSpot sometimes has the same stage in two casings ("Closed Won" /
        // "Closed won"). Canonicalise each stage to its most common casing so it
        // groups as one everywhere (filters + charts), matching the Monthly view.
        const freq = new Map<string, Map<string, number>>();
        for (const [, ds] of entries)
          for (const d of ds) {
            const lo = (d.deal_stage || '').toLowerCase();
            if (!freq.has(lo)) freq.set(lo, new Map());
            const m = freq.get(lo)!;
            m.set(d.deal_stage, (m.get(d.deal_stage) || 0) + 1);
          }
        const canon = new Map<string, string>();
        for (const [lo, m] of freq)
          canon.set(lo, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
        const map: Record<number, Deal[]> = {};
        for (const [y, ds] of entries)
          map[y] = ds.map((d) => ({ ...d, deal_stage: canon.get((d.deal_stage || '').toLowerCase()) || d.deal_stage }));
        setByYear(map);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [years.join(','), refreshKey]);

  // load the budget for the selected year
  useEffect(() => {
    let alive = true;
    getBudget(year)
      .then((b) => alive && setBudget(b))
      .catch(() => alive && setBudget({ year, months: {} }));
    return () => {
      alive = false;
    };
  }, [year, refreshKey]);

  const dealsYear = byYear[year] || [];
  const dealsPrev = byYear[year - 1] || [];

  // filter option lists (from all loaded deals, so they are stable across years)
  const allDeals = useMemo<Deal[]>(() => Object.values(byYear).flat() as Deal[], [byYear]);
  const ownerOptions = useMemo(
    () => [...new Set(allDeals.map(ownerName))].sort((a, b) => a.localeCompare(b)),
    [allDeals]
  );
  const pipelineOptions = useMemo(
    () => [...new Set(allDeals.map((d) => d.sales_pipeline).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allDeals]
  );
  const stageOptions = useMemo(
    () => [...new Set(allDeals.map((d) => d.deal_stage).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allDeals]
  );

  // initialise selections once options are known
  useEffect(() => {
    if (initDone || !allDeals.length) return;
    const hidden = new Set((meta?.defaultHiddenStages || []).map((s) => s.trim().toLowerCase()));
    const savedO = LS.get<string[]>('tsd.g.owners');
    const savedP = LS.get<string[]>('tsd.g.pipelines');
    const savedS = LS.get<string[]>('tsd.g.stages');
    setOwners(savedO ? ownerOptions.filter((o) => savedO.includes(o)) : ownerOptions);
    setPipelines(savedP ? pipelineOptions.filter((o) => savedP.includes(o)) : pipelineOptions);
    setStages(savedS ? stageOptions.filter((o) => savedS.includes(o)) : stageOptions.filter((s) => !hidden.has(s.toLowerCase())));
    setInitDone(true);
  }, [allDeals.length, ownerOptions, pipelineOptions, stageOptions, meta, initDone]);

  useEffect(() => {
    if (initDone) LS.set('tsd.g.owners', owners);
  }, [owners, initDone]);
  useEffect(() => {
    if (initDone) LS.set('tsd.g.pipelines', pipelines);
  }, [pipelines, initDone]);
  useEffect(() => {
    if (initDone) LS.set('tsd.g.stages', stages);
  }, [stages, initDone]);
  useEffect(() => {
    LS.set('tsd.g.custCount', custCount);
  }, [custCount]);

  const filt = { owners, pipelines, stages, search };
  // when "Include no exec date" is off, deals without an execution date are excluded everywhere
  const passExec = (d: Deal) => includeNoExec || !!d.execution_month;
  const fThis = useMemo(
    () => applyFilters(dealsYear, filt).filter(passExec).filter(inPeriod),
    [dealsYear, owners, pipelines, stages, search, periodMonth, includeNoExec]
  );
  const fPrev = useMemo(
    () => applyFilters(dealsPrev, filt).filter(passExec).filter(inPeriod),
    [dealsPrev, owners, pipelines, stages, search, periodMonth, includeNoExec]
  );

  // stable colour per pipeline (follows the entity, not its rank)
  const pipeColor = useMemo(() => {
    const m = new Map<string, string>();
    pipelineOptions.forEach((p, i) => m.set(p, CAT[i % CAT.length]));
    return (name: string) => m.get(name) || GRAY;
  }, [pipelineOptions]);

  /* ---------- KPI numbers ---------- */

  const revThis = sum(fThis, (d) => d.deal_amount);
  const revPrev = sum(fPrev, (d) => d.deal_amount);
  const marThis = sum(fThis, (d) => d.margin);
  const marPrev = sum(fPrev, (d) => d.margin);
  const marPctThis = revThis ? (marThis / revThis) * 100 : NaN;
  const marPctPrev = revPrev ? (marPrev / revPrev) * 100 : NaN;
  const nThis = fThis.length;
  const nPrev = fPrev.length;
  // Average deal size ignores €0 deals (they only drag the average down); the sum
  // already excludes them since they add nothing, so we only adjust the denominator.
  const nAmtThis = fThis.filter((d) => d.deal_amount > 0).length;
  const nAmtPrev = fPrev.filter((d) => d.deal_amount > 0).length;
  const avgThis = nAmtThis ? revThis / nAmtThis : 0;
  const avgPrev = nAmtPrev ? revPrev / nAmtPrev : 0;

  const budgetMonths: Record<string, BudgetMonth> = budget?.months || {};
  const budgetRevYear = useMemo(
    () => Object.values(budgetMonths).reduce((s, m) => s + (m.budget_amount || 0), 0),
    [budget]
  );
  const budgetMarYear = useMemo(
    () => Object.values(budgetMonths).reduce((s, m) => s + (m.budget_margin || 0), 0),
    [budget]
  );
  const revVsBudget = budgetRevYear ? (revThis / budgetRevYear) * 100 : NaN;
  // annual budget minus what's booked in the selected period → still needed to hit the year's budget
  const revToMeet = budgetRevYear - revThis;
  const marToMeet = budgetMarYear - marThis;

  const pctDelta = (now: number, prev: number) => (prev ? ((now - prev) / prev) * 100 : NaN);

  /* ---------- chart data ---------- */

  // monthly budget arrays
  const budgetRevMonth = useMemo(() => {
    const arr = new Array(12).fill(0);
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    for (let i = 0; i < 12; i++) arr[i] = budget?.months[`${year}-${pad(i + 1)}`]?.budget_amount || 0;
    return arr;
  }, [budget, year]);
  const budgetMarMonth = useMemo(() => {
    const arr = new Array(12).fill(0);
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    for (let i = 0; i < 12; i++) arr[i] = budget?.months[`${year}-${pad(i + 1)}`]?.budget_margin || 0;
    return arr;
  }, [budget, year]);
  const hasBudget = budgetRevMonth.some((v) => v > 0) || budgetMarYear > 0;

  // pipeline split
  const pipeData = useMemo(() => {
    const m = groupSum(fThis, (d) => d.sales_pipeline || 'Unknown', (d) => d.deal_amount);
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [fThis]);

  const pipelineOption = useMemo(() => {
    if (pipeChart === 'donut') {
      return {
        tooltip: { trigger: 'item', valueFormatter: (v: number) => fmtInt(v) },
        legend: { bottom: 0, type: 'scroll', textStyle: { color: INK } },
        series: [
          {
            type: 'pie',
            radius: ['52%', '76%'],
            center: ['50%', '46%'],
            avoidLabelOverlap: true,
            padAngle: 2,
            itemStyle: { borderColor: CARDBG, borderWidth: 3, borderRadius: 6 },
            label: { formatter: (p: any) => `${fmtCompact(p.value)}\n${p.percent}%`, color: INK, fontSize: 11 },
            labelLine: { lineStyle: { color: LINE } },
            data: pipeData.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: grad(pipeColor(d.name), 'v') } })),
            emphasis: { scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: 'rgba(20,56,147,0.25)' } },
            animationDuration: 700,
          },
        ],
      };
    }
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,56,147,0.06)' } }, valueFormatter: (v: number) => fmtInt(v) },
      grid: baseGrid(),
      xAxis: { type: 'category', data: pipeData.map((d) => d.name), ...AXIS, axisLabel: { color: MUTED, interval: 0, rotate: 20, width: 90, overflow: 'truncate' } },
      yAxis: { type: 'value', ...AXIS, axisLine: { show: false }, ...SPLIT, axisLabel: { color: MUTED, formatter: (v: number) => fmtCompact(v) } },
      series: [
        {
          type: 'bar',
          data: pipeData.map((d) => ({ value: d.value, itemStyle: { color: grad(pipeColor(d.name), 'v'), borderRadius: [6, 6, 0, 0] } })),
          barMaxWidth: 46,
          label: { show: true, position: 'top', formatter: (p: any) => fmtCompact(p.value), color: INK, fontSize: 11, fontWeight: 600 },
          animationDuration: 700,
        },
      ],
    };
  }, [pipeData, pipeChart, pipeColor]);

  // revenue by stage
  const stageData = useMemo(() => {
    const m = groupSum(fThis, (d) => d.deal_stage || 'Unknown', (d) => d.deal_amount);
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => a.value - b.value);
  }, [fThis]);
  const stageOption = useMemo(
    () =>
      horizontalBars({
        rows: stageData,
        color: BLUE,
        valueFmt: (v) => fmtInt(v),
        axisFmt: (v) => fmtCompact(v),
        labelWidth: 160,
      }),
    [stageData]
  );

  // budget vs actual by month
  const revByMonth = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const d of fThis) {
      const i = monthOfDeal(d);
      if (i >= 0) arr[i] += d.deal_amount || 0;
    }
    return arr;
  }, [fThis]);
  const marByMonth = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const d of fThis) {
      const i = monthOfDeal(d);
      if (i >= 0) arr[i] += d.margin || 0;
    }
    return arr;
  }, [fThis]);

  // extra monthly series, for the KPI sparklines
  const countByMonth = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const d of fThis) {
      const i = monthOfDeal(d);
      if (i >= 0) arr[i] += 1;
    }
    return arr;
  }, [fThis]);
  // per-month count of deals WITH an amount (>0), for the avg-deal-size sparkline
  const amtCountByMonth = useMemo(() => {
    const arr = new Array(12).fill(0);
    for (const d of fThis) {
      if (!(d.deal_amount > 0)) continue;
      const i = monthOfDeal(d);
      if (i >= 0) arr[i] += 1;
    }
    return arr;
  }, [fThis]);
  const avgByMonth = useMemo(
    () => revByMonth.map((r, i) => (amtCountByMonth[i] ? r / amtCountByMonth[i] : 0)),
    [revByMonth, amtCountByMonth]
  );
  const marPctByMonth = useMemo(
    () => revByMonth.map((r, i) => (r ? (marByMonth[i] / r) * 100 : 0)),
    [revByMonth, marByMonth]
  );

  const budgetMonthOption = useMemo(() => {
    const isSales = budgetMetric === 'sales';
    let actual = (isSales ? revByMonth : marByMonth).slice(0, monthsCount);
    let budgetArr = (isSales ? budgetRevMonth : budgetMarMonth).slice(0, monthsCount);
    if (budgetMode === 'cumulative') {
      actual = cumulate(actual);
      budgetArr = cumulate(budgetArr);
    }
    const actualColor = isSales ? BLUE : AQUA;
    const actualName = (isSales ? 'Gross sales' : 'Nett sales') + (budgetMode === 'cumulative' ? ' (cum.)' : ' (actual)');
    const series = buildBudgetSeries(budgetType, actual, budgetArr, actualColor, actualName, hasBudget);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: budgetType === 'group' || budgetType === 'barline' ? 'shadow' : 'line', shadowStyle: { color: 'rgba(20,56,147,0.06)' } }, valueFormatter: (v: number) => fmtInt(v) },
      legend: { bottom: 0, textStyle: { color: INK }, icon: 'roundRect' },
      grid: baseGrid({ bottom: 56 }),
      xAxis: { type: 'category', data: MONTHS.slice(0, monthsCount), boundaryGap: budgetType === 'group' || budgetType === 'barline', ...AXIS },
      yAxis: { type: 'value', ...AXIS, axisLine: { show: false }, ...SPLIT, axisLabel: { color: MUTED, formatter: (v: number) => fmtCompact(v) } },
      series,
    };
  }, [revByMonth, marByMonth, budgetRevMonth, budgetMarMonth, hasBudget, budgetMetric, budgetMode, budgetType, monthsCount]);

  // cumulative pacing
  const pacingOption = useMemo(() => {
    const cum = (arr: number[]) => {
      let t = 0;
      return arr.map((v) => (t += v));
    };
    const actualCum = cum(revByMonth.slice(0, monthsCount));
    const series: any[] = [
      {
        name: 'Gross sales cumulative',
        type: 'line',
        data: actualCum,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 3, color: BLUE },
        itemStyle: { color: BLUE },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(42,120,214,0.28)' },
            { offset: 1, color: 'rgba(42,120,214,0.02)' },
          ]),
        },
        z: 5,
      },
    ];
    if (hasBudget) {
      const budgetCum = cum(budgetRevMonth.slice(0, monthsCount));
      series.push({ name: 'Budget cumulative', type: 'line', data: budgetCum, smooth: true, symbol: 'none', lineStyle: { width: 2, color: GRAY, type: 'dashed' }, itemStyle: { color: GRAY } });
    }
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtInt(v) },
      legend: { bottom: 0, textStyle: { color: INK }, icon: 'roundRect' },
      grid: baseGrid({ bottom: 56 }),
      xAxis: { type: 'category', data: MONTHS.slice(0, monthsCount), boundaryGap: false, ...AXIS },
      yAxis: { type: 'value', ...AXIS, axisLine: { show: false }, ...SPLIT, axisLabel: { color: MUTED, formatter: (v: number) => fmtCompact(v) } },
      series,
    };
  }, [revByMonth, budgetRevMonth, hasBudget, monthsCount]);

  // account managers
  const pickMetric = (metric: Metric) => (d: Deal) => (metric === 'margin' ? d.margin : d.deal_amount);
  const amRows = useMemo(() => {
    const rev = groupSum(fThis, ownerName, (d) => d.deal_amount);
    const mar = groupSum(fThis, ownerName, (d) => d.margin);
    return [...rev.keys()]
      .map((name) => {
        const r = rev.get(name) || 0;
        const mg = mar.get(name) || 0;
        const value = amMetric === 'revenue' ? r : amMetric === 'margin' ? mg : r ? (mg / r) * 100 : 0;
        return { name, value };
      })
      .filter((x) => x.name !== '—' || x.value !== 0)
      .sort((a, b) => a.value - b.value);
  }, [fThis, amMetric]);
  const amOption = useMemo(() => {
    const isPct = amMetric === 'marginpct';
    const color = amMetric === 'margin' ? AQUA : amMetric === 'marginpct' ? '#4a3aa7' : BLUE;
    return horizontalBars({
      rows: amRows,
      color,
      valueFmt: (v) => (isPct ? fmtPct(v) : fmtInt(v)),
      axisFmt: (v) => (isPct ? v + '%' : fmtCompact(v)),
      labelWidth: 150,
    });
  }, [amRows, amMetric]);

  // customers (revenue + margin), top/bottom N (N = user-chosen count).
  // Customers with zero revenue are irrelevant here and are left out of both charts.
  const customerRows = (metric: 'revenue' | 'margin') => {
    const revMap = groupSum(fThis, custName, (d) => d.deal_amount);
    const valMap = groupSum(fThis, custName, pickMetric(metric));
    const rows = [...revMap.keys()]
      .filter((name) => (revMap.get(name) || 0) !== 0)
      .map((name) => ({ name, value: valMap.get(name) || 0 }))
      .sort((a, b) => b.value - a.value);
    const picked = custDir === 'top' ? rows.slice(0, custCount) : rows.slice(-custCount);
    picked.sort((a, b) => a.value - b.value); // smallest at bottom for horizontal bars
    return picked;
  };
  const totalCustomers = useMemo(() => {
    const revMap = groupSum(fThis, custName, (d) => d.deal_amount);
    return [...revMap.values()].filter((v) => v !== 0).length;
  }, [fThis]);
  const countOptions = (() => {
    const opts: number[] = [];
    for (let n = 10; n <= 100; n += 10) opts.push(n);
    if (!opts.includes(custCount)) opts.push(custCount);
    return opts.sort((a, b) => a - b);
  })();
  const CountSelect = (
    <select className="count-select" value={custCount} onChange={(e) => setCustCount(Number(e.target.value))} title="Number of customers">
      {countOptions.map((n) => (
        <option key={n} value={n}>
          Top {n}
        </option>
      ))}
    </select>
  );
  const customerOption = (metric: 'revenue' | 'margin') => {
    const base = metric === 'margin' ? AQUA : BLUE;
    return horizontalBars({
      rows: customerRows(metric),
      color: (_name, v) => (v < 0 ? RED : base),
      valueFmt: (v) => fmtInt(v),
      axisFmt: (v) => fmtCompact(v),
      labelWidth: 140,
    });
  };

  // margin % per pipeline
  const marginPctRows = useMemo(() => {
    const rev = groupSum(fThis, (d) => d.sales_pipeline || 'Unknown', (d) => d.deal_amount);
    const mar = groupSum(fThis, (d) => d.sales_pipeline || 'Unknown', (d) => d.margin);
    return [...rev.keys()]
      .map((name) => ({ name, value: rev.get(name) ? ((mar.get(name) || 0) / (rev.get(name) || 1)) * 100 : 0 }))
      .sort((a, b) => a.value - b.value);
  }, [fThis]);
  const marginPctOption = useMemo(
    () =>
      horizontalBars({
        rows: marginPctRows,
        color: (name) => pipeColor(name),
        valueFmt: (v) => fmtPct(v),
        axisFmt: (v) => v + '%',
        labelWidth: 130,
      }),
    [marginPctRows, pipeColor]
  );

  // year over year
  const yoyOption = useMemo(() => {
    const pick = pickMetric(yoyMetric === 'margin' ? 'margin' : 'revenue');
    const series = years.map((y, i) => {
      const ds = applyFilters(byYear[y] || [], filt).filter(passExec);
      const arr = new Array(12).fill(0);
      for (const d of ds) {
        const mi = monthOfDeal(d);
        if (mi >= 0) arr[mi] += pick(d) || 0;
      }
      const sliced = arr.slice(0, monthsCount);
      const data = yoyMode === 'cumulative' ? sliced.reduce<number[]>((acc, v) => { acc.push((acc[acc.length - 1] || 0) + v); return acc; }, []) : sliced;
      return {
        name: String(y),
        type: 'line',
        data,
        smooth: true,
        symbol: 'circle',
        symbolSize: y === year ? 7 : 5,
        lineStyle: { width: y === year ? 3 : 1.8, color: CAT[i % CAT.length] },
        itemStyle: { color: CAT[i % CAT.length] },
        emphasis: { focus: 'series' },
      };
    });
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtInt(v) },
      legend: { bottom: 0, textStyle: { color: INK }, icon: 'roundRect' },
      grid: baseGrid({ bottom: 56 }),
      xAxis: { type: 'category', data: MONTHS.slice(0, monthsCount), boundaryGap: false, ...AXIS },
      yAxis: { type: 'value', ...AXIS, axisLine: { show: false }, ...SPLIT, axisLabel: { color: MUTED, formatter: (v: number) => fmtCompact(v) } },
      series,
    };
  }, [byYear, years.join(','), owners, pipelines, stages, search, yoyMetric, yoyMode, year, monthsCount, includeNoExec]);

  /* ---------- filters bar ---------- */

  function resetFilters() {
    const hidden = new Set((meta?.defaultHiddenStages || []).map((s) => s.trim().toLowerCase()));
    setOwners(ownerOptions);
    setPipelines(pipelineOptions);
    setStages(stageOptions.filter((s) => !hidden.has(s.toLowerCase())));
    setSearch('');
  }

  const filtersActive =
    owners.length !== ownerOptions.length ||
    pipelines.length !== pipelineOptions.length ||
    search.trim() !== '' ||
    stages.length !== stageOptions.filter((s) => !new Set((meta?.defaultHiddenStages || []).map((x) => x.trim().toLowerCase())).has(s.toLowerCase())).length;

  if (error) return <div className="empty">Could not load data: {error}</div>;
  if (loading && !allDeals.length) return <div className="empty">Loading charts…</div>;

  const metricOpts: { key: Metric; label: string }[] = [
    { key: 'revenue', label: 'Gross' },
    { key: 'margin', label: 'Nett' },
    { key: 'marginpct', label: 'Nett %' },
  ];

  // month-limited series for the sparklines (through the selected period)
  const revSpark = revByMonth.slice(0, monthsCount);
  const marSpark = marByMonth.slice(0, monthsCount);
  const budgetRevSpark = budgetRevMonth.slice(0, monthsCount);
  const budgetMarSpark = budgetMarMonth.slice(0, monthsCount);
  const marPctSpark = marPctByMonth.slice(0, monthsCount);
  const countSpark = countByMonth.slice(0, monthsCount);
  const avgSpark = avgByMonth.slice(0, monthsCount);
  const toMeetNote = (v: number) => (v > 0 ? `${fmtCompact(v)} to meet budget` : `${fmtCompact(-v)} above budget`);
  const AMBER = '#f0b429';

  return (
    <div className="graphs">
      {/* KPI ROW */}
      <div className="kpi-row">
        <Kpi
          label={`Gross sales forecast ${periodLabel}`}
          value={fmtInt(revThis)}
          delta={pctDelta(revThis, revPrev)}
          sub={`vs ${year - 1}`}
          spark={revSpark}
          spark2={hasBudget ? budgetRevSpark : undefined}
          sparkColor={BLUE}
          note={hasBudget ? toMeetNote(revToMeet) : undefined}
          noteColor={revToMeet > 0 ? AMBER : GREEN}
        />
        <Kpi
          label={`Nett sales forecast ${periodLabel}`}
          value={fmtInt(marThis)}
          delta={pctDelta(marThis, marPrev)}
          sub={`vs ${year - 1}`}
          spark={marSpark}
          spark2={hasBudget ? budgetMarSpark : undefined}
          sparkColor={AQUA}
          note={hasBudget ? toMeetNote(marToMeet) : undefined}
          noteColor={marToMeet > 0 ? AMBER : GREEN}
        />
        <Kpi label="Nett sales %" value={isFinite(marPctThis) ? fmtPct(marPctThis) : '–'} delta={isFinite(marPctThis) && isFinite(marPctPrev) ? marPctThis - marPctPrev : null} sub={`vs ${year - 1}`} spark={marPctSpark} sparkColor={CAT[6]} />
        <Kpi label="Deals" value={String(nThis)} delta={pctDelta(nThis, nPrev)} sub={`vs ${year - 1}`} spark={countSpark} sparkColor={CAT[2]} />
        <Kpi label="Avg. deal size" value={fmtInt(avgThis)} delta={pctDelta(avgThis, avgPrev)} sub={`vs ${year - 1}`} spark={avgSpark} sparkColor={CAT[3]} />
        <Kpi
          label="Gross sales vs budget"
          value={hasBudget ? fmtPct(revVsBudget) : '–'}
          sub={hasBudget ? `${fmtCompact(revThis)} / ${fmtCompact(budgetRevYear)}` : 'no budget'}
          delta={hasBudget ? revVsBudget - 100 : null}
          spark={hasBudget ? revSpark : undefined}
          spark2={hasBudget ? budgetRevSpark : undefined}
          sparkColor={GREEN}
        />
      </div>

      {/* FILTER BAR */}
      <div className="gfilters">
        <select className="period-select" value={String(periodMonth)} onChange={(e) => setPeriodMonth(e.target.value === 'full' ? 'full' : Number(e.target.value))} title="Period">
          <option value="full">Full year</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              Until {m}
            </option>
          ))}
        </select>
        <MultiSelect label="Pipeline" options={pipelineOptions} selected={pipelines} onChange={setPipelines} />
        <MultiSelect label="Account manager" options={ownerOptions} selected={owners} onChange={setOwners} />
        <MultiSelect label="Deal stage" options={stageOptions} selected={stages} onChange={setStages} />
        <input className="gsearch" placeholder="Search deal / customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="toggle-chip" title="Include deals without an execution date (bucketed by close date)">
          <input type="checkbox" checked={includeNoExec} onChange={(e) => setIncludeNoExec(e.target.checked)} />
          Include no exec date
        </label>
        {filtersActive && (
          <button className="btn-ghost" onClick={resetFilters}>
            Reset filters
          </button>
        )}
        <span className="spacer" />
      </div>

      {/* CHART GRID */}
      <div className="g3grid">
        {/* Most important: are we hitting budget? Shown first. */}
        <div className="gcard wide">
          <div className="gcard-head">
            <div>
              <h3>{budgetMetric === 'sales' ? 'Gross sales' : 'Nett sales'} vs budget per month</h3>
              <span className="gcard-hint">
                {filtersActive ? 'Note: filters active — budget is at company level' : 'Actual vs budget — are we hitting budget?'}
              </span>
            </div>
            <div className="gcard-controls">
              <Seg
                value={budgetMetric}
                options={[{ key: 'sales', label: 'Gross' }, { key: 'margin', label: 'Nett' }]}
                onChange={setBudgetMetric}
              />
              <Seg
                value={budgetMode}
                options={[{ key: 'month', label: 'Per month' }, { key: 'cumulative', label: 'Cumulative' }]}
                onChange={setBudgetMode}
              />
              <ChartTypeMenu value={budgetType} onChange={setBudgetType} />
              <button className="icon-btn" title="Download as image" aria-label="Download as image" onClick={() => budgetChartRef.current?.download('sales-margin-vs-budget')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12" />
                  <path d="M7 11l5 5 5-5" />
                  <path d="M4 21h16" />
                </svg>
              </button>
            </div>
          </div>
          <div className="budget-row">
            <div className="budget-chart">
              <EChart ref={budgetChartRef} option={budgetMonthOption} height={360} />
            </div>
            <div className="budget-tables">
              <BudgetVsActualTable
                title={`${budgetMetric === 'sales' ? 'Gross sales' : 'Nett sales'}${budgetMode === 'cumulative' ? ' — cumulative' : ' — per month'}`}
                actual={budgetMetric === 'sales' ? revByMonth : marByMonth}
                budget={budgetMetric === 'sales' ? budgetRevMonth : budgetMarMonth}
                n={monthsCount}
                cumulative={budgetMode === 'cumulative'}
                hasBudget={hasBudget}
              />
            </div>
          </div>
        </div>

        <ChartBlock
          title="Cumulative gross sales vs budget"
          hint="Pacing — are we ahead or behind"
          downloadName="pacing"
          height={320}
          option={pacingOption}
        />

        <ChartBlock
          title="Gross sales by category"
          hint="Gross sales distribution"
          downloadName="revenue-by-category"
          height={320}
          option={pipelineOption}
          empty={!pipeData.length}
          controls={<Seg value={pipeChart} options={[{ key: 'donut', label: 'Donut' }, { key: 'bar', label: 'Bar' }]} onChange={setPipeChart} />}
        />

        <ChartBlock
          title="Gross sales by deal stage"
          hint="Where the gross sales sit in the funnel"
          downloadName="revenue-by-deal-stage"
          height={barHeight(stageData.length)}
          option={stageOption}
          empty={!stageData.length}
        />

        <ChartBlock
          title="Nett sales % by pipeline"
          hint="Profitability by pipeline"
          downloadName="margin-pct-by-pipeline"
          height={barHeight(marginPctRows.length)}
          option={marginPctOption}
          empty={!marginPctRows.length}
        />

        <ChartBlock
          title="Gross sales per account manager"
          hint="Sorted by the chosen metric"
          wide
          downloadName="account-manager-performance"
          height={barHeight(amRows.length)}
          option={amOption}
          empty={!amRows.length}
          controls={<Seg value={amMetric} options={metricOpts} onChange={setAmMetric} />}
        />

        <ChartBlock
          title="Customers — gross sales"
          hint={`${custDir === 'top' ? 'Top' : 'Bottom'} ${Math.min(custCount, totalCustomers)} of ${totalCustomers} customers`}
          wide
          downloadName="customers-revenue"
          height={barHeight(customerRows('revenue').length)}
          option={customerOption('revenue')}
          empty={!fThis.length}
          controls={
            <>
              <Seg value={custDir} options={[{ key: 'top', label: 'Largest' }, { key: 'bottom', label: 'Smallest' }]} onChange={setCustDir} />
              {CountSelect}
            </>
          }
        />

        <ChartBlock
          title="Customers — nett sales"
          hint={`${custDir === 'top' ? 'Top' : 'Bottom'} ${Math.min(custCount, totalCustomers)} of ${totalCustomers} customers`}
          wide
          downloadName="customers-margin"
          height={barHeight(customerRows('margin').length)}
          option={customerOption('margin')}
          empty={!fThis.length}
          controls={
            <>
              <Seg value={custDir} options={[{ key: 'top', label: 'Largest' }, { key: 'bottom', label: 'Smallest' }]} onChange={setCustDir} />
              {CountSelect}
            </>
          }
        />

        <ChartBlock
          title="Year-over-year"
          hint="Compare years"
          wide
          downloadName="year-over-year"
          height={360}
          option={yoyOption}
          controls={
            <>
              <Seg value={yoyMetric} options={[{ key: 'revenue', label: 'Gross' }, { key: 'margin', label: 'Nett' }]} onChange={setYoyMetric} />
              <Seg value={yoyMode} options={[{ key: 'monthly', label: 'Monthly' }, { key: 'cumulative', label: 'Cumulative' }]} onChange={setYoyMode} />
            </>
          }
        />
      </div>
    </div>
  );
}
