import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import EChart, { EChartHandle } from './EChart';
import { Deal, fmtInt, fmtCompact } from '../api';
import { CountryRules, countryOf, provinceOf, stateOf, COUNTRY_META } from '../countryRules';

// Sales-by-country map with drill-down: World → Europe → a single country.
// Two countries drill one level deeper into their own subdivisions:
//   • Netherlands → provinces   • Germany → Bundesländer (states)
// Revenue is shown as a number for the current level, with a Gross/Nett toggle.
// Country / subdivision per deal is derived from the DB-stored rules (see countryRules.ts).

const INK = '#e8edf9';
const MUTED = '#93a1c4';

// green scale: dark→light as revenue grows; no-revenue areas keep the dark-blue base
const GREEN_SCALE = ['#1a7a44', '#2ea866', '#54cf88', '#9bf0be'];
const NO_DATA = '#141f42';

const EUROPE = new Set(['NL', 'DE', 'BE', 'FR', 'ES', 'GB', 'DK', 'NO', 'TR', 'SK', 'IT', 'PL', 'AT', 'CH', 'SE', 'GR', 'RO', 'PT']);
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_META).map(([code, m]) => [m.name, code])
);

// Subdivision maps: countries that drill one level deeper into their own regions.
const NL_GEOJSON = 'https://cartomap.github.io/nl/wgs84/provincie_2023.geojson';
const DE_GEOJSON = 'https://cdn.jsdelivr.net/gh/isellsoap/deutschlandGeoJSON@main/2_bundeslaender/4_niedrig.geo.json';

interface SubDiv {
  url: string;
  mapName: string;
  nameProp: string;
  fn: (d: Deal, r?: CountryRules | null) => string;
  unknownLabel: string;
  download: string;
}
const SUBDIV: Record<string, SubDiv> = {
  NL: { url: NL_GEOJSON, mapName: 'nl-provinces', nameProp: 'statnaam', fn: provinceOf, unknownLabel: 'a province', download: 'sales-by-province' },
  DE: { url: DE_GEOJSON, mapName: 'de-states', nameProp: 'name', fn: stateOf, unknownLabel: 'a state', download: 'sales-by-state' },
};

type Level = 'world' | 'europe' | 'country';

export default function SalesMap({ deals, rules }: { deals: Deal[]; rules?: CountryRules | null }) {
  const [metric, setMetric] = useState<'gross' | 'nett'>('gross');
  const [viewMode, setViewMode] = useState<'map' | 'graph'>('map');
  const [level, setLevel] = useState<Level>('world');
  const [selected, setSelected] = useState<string | null>(null); // ISO2
  const [ready, setReady] = useState<boolean>(!!(echarts as any).getMap?.('world'));
  const [err, setErr] = useState(false);
  const [subReady, setSubReady] = useState<Record<string, boolean>>({});
  const [subErr, setSubErr] = useState<Record<string, boolean>>({});
  const chartRef = useRef<EChartHandle>(null);

  const sub = level === 'country' && selected ? SUBDIV[selected] : null;
  const showSub = !!sub;

  // load + register the world map once
  useEffect(() => {
    let alive = true;
    if ((echarts as any).getMap?.('world')) {
      setReady(true);
      return;
    }
    fetch('https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        echarts.registerMap('world', j as any);
        setReady(true);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  // load + register the subdivision map (NL provinces / DE states) the first time we drill in
  useEffect(() => {
    if (!sub || !selected) return;
    if ((echarts as any).getMap?.(sub.mapName)) {
      setSubReady((m) => ({ ...m, [selected]: true }));
      return;
    }
    let alive = true;
    const code = selected;
    fetch(sub.url)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        echarts.registerMap(sub.mapName, j as any);
        setSubReady((m) => ({ ...m, [code]: true }));
      })
      .catch(() => alive && setSubErr((m) => ({ ...m, [code]: true })));
    return () => {
      alive = false;
    };
  }, [sub, selected]);

  // aggregate revenue per country (ISO2)
  const agg = useMemo(() => {
    const m = new Map<string, number>();
    let unknownVal = 0;
    let unknownCount = 0;
    for (const d of deals) {
      const code = countryOf(d, rules);
      const v = (metric === 'gross' ? d.deal_amount : d.margin) || 0;
      if (!code) {
        unknownVal += v;
        unknownCount++;
        continue;
      }
      m.set(code, (m.get(code) || 0) + v);
    }
    return { m, unknownVal, unknownCount };
  }, [deals, rules, metric]);

  // aggregate revenue per subdivision (only deals in the selected country)
  const subAgg = useMemo(() => {
    const m = new Map<string, number>();
    let unknownVal = 0;
    let unknownCount = 0;
    if (sub && selected) {
      for (const d of deals) {
        if (countryOf(d, rules) !== selected) continue;
        const v = (metric === 'gross' ? d.deal_amount : d.margin) || 0;
        const key = sub.fn(d, rules);
        if (!key) {
          unknownVal += v;
          unknownCount++;
          continue;
        }
        m.set(key, (m.get(key) || 0) + v);
      }
    }
    return { m, unknownVal, unknownCount };
  }, [deals, rules, metric, sub, selected]);

  const mapData = useMemo(
    () =>
      [...agg.m.entries()]
        .filter(([, val]) => Math.round(val) > 0)
        .map(([code, val]) => ({ name: COUNTRY_META[code]?.name || code, value: Math.round(val), code })),
    [agg]
  );
  const maxVal = useMemo(() => Math.max(1, ...mapData.map((d) => d.value)), [mapData]);

  const subMapData = useMemo(
    () =>
      [...subAgg.m.entries()]
        .filter(([, val]) => Math.round(val) > 0)
        .map(([name, val]) => ({ name, value: Math.round(val) })),
    [subAgg]
  );
  const subMax = useMemo(() => Math.max(1, ...subMapData.map((d) => d.value)), [subMapData]);

  const levelTotal = useMemo(() => {
    if (level === 'country' && selected) return agg.m.get(selected) || 0;
    if (level === 'europe') return [...agg.m].reduce((s, [c, v]) => s + (EUROPE.has(c) ? v : 0), 0);
    return [...agg.m.values()].reduce((s, v) => s + v, 0);
  }, [agg, level, selected]);

  const levelLabel =
    level === 'country' && selected ? COUNTRY_META[selected]?.name || selected : level === 'europe' ? 'Europe' : 'World';

  const view = useMemo(() => {
    if (level === 'country' && selected) {
      const c = COUNTRY_META[selected];
      const zoom = selected === 'DE' ? 11 : 6;
      return { center: [c?.lon ?? 10, c?.lat ?? 50], zoom };
    }
    if (level === 'europe') return { center: [12, 50], zoom: 4.5 };
    return { center: [10, 20], zoom: 1.15 };
  }, [level, selected]);

  // World / country (non-subdivided) option — the geo world map
  const worldOption = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => (p.value != null && !isNaN(p.value) ? `${p.name}: ${fmtInt(p.value)}` : `${p.name}: –`),
      },
      visualMap: {
        type: 'continuous',
        min: 0,
        max: maxVal,
        left: 12,
        bottom: 16,
        calculable: true,
        inRange: { color: GREEN_SCALE },
        textStyle: { color: MUTED, fontSize: 10 },
        formatter: (v: number) => fmtCompact(v),
      },
      series: [
        {
          type: 'map',
          map: 'world',
          roam: true,
          center: view.center,
          zoom: view.zoom,
          scaleLimit: { min: 0.8, max: 60 },
          nameProperty: 'name',
          itemStyle: { areaColor: NO_DATA, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 0.5 },
          emphasis: { label: { show: false }, itemStyle: { areaColor: '#f0b429' } },
          data: mapData,
        },
      ],
    }),
    [mapData, maxVal, view]
  );

  // Subdivision option — the NL provinces / DE states map
  const subOption = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => (p.value != null && !isNaN(p.value) ? `${p.name}: ${fmtInt(p.value)}` : `${p.name}: –`),
      },
      visualMap: {
        type: 'continuous',
        min: 0,
        max: subMax,
        left: 12,
        bottom: 16,
        calculable: true,
        inRange: { color: GREEN_SCALE },
        textStyle: { color: MUTED, fontSize: 10 },
        formatter: (v: number) => fmtCompact(v),
      },
      series: [
        {
          type: 'map',
          map: sub?.mapName || 'nl-provinces',
          roam: true,
          nameProperty: sub?.nameProp || 'name',
          scaleLimit: { min: 0.9, max: 12 },
          itemStyle: { areaColor: NO_DATA, borderColor: 'rgba(255,255,255,0.14)', borderWidth: 0.6 },
          emphasis: { label: { show: false }, itemStyle: { areaColor: '#f0b429' } },
          data: subMapData,
        },
      ],
    }),
    [subMapData, subMax, sub]
  );

  // rows for the bar-graph view (per country, or per subdivision when drilled into NL/DE)
  const barRows = useMemo<[string, number][]>(() => {
    let entries: [string, number][];
    if (showSub) {
      entries = [...subAgg.m.entries()];
    } else if (level === 'europe') {
      entries = [...agg.m].filter(([c]) => EUROPE.has(c)).map(([c, v]) => [COUNTRY_META[c]?.name || c, v]);
    } else if (level === 'country' && selected) {
      entries = [[COUNTRY_META[selected]?.name || selected, agg.m.get(selected) || 0]];
    } else {
      entries = [...agg.m].map(([c, v]) => [COUNTRY_META[c]?.name || c, v]);
    }
    return entries.filter(([, v]) => Math.round(v) > 0).sort((a, b) => b[1] - a[1]);
  }, [showSub, subAgg, agg, level, selected]);

  const barOption = useMemo(
    () => ({
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: any) => `${p[0].name}: ${fmtInt(p[0].value)}` },
      xAxis: {
        type: 'value',
        axisLabel: { color: MUTED, fontSize: 10, formatter: (v: number) => fmtCompact(v) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: barRows.map((r) => r[0]),
        axisLabel: { color: INK, fontSize: 11 },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: barRows.map((r) => Math.round(r[1])),
          itemStyle: { color: '#2ea866', borderRadius: [0, 3, 3, 0] },
          barMaxWidth: 22,
          label: { show: true, position: 'right', color: MUTED, fontSize: 10, formatter: (o: any) => fmtInt(o.value) },
        },
      ],
    }),
    [barRows]
  );

  const graphHeight = Math.max(300, barRows.length * 26 + 24);

  function onMapClick(p: any) {
    if (showSub) return; // subdivisions are the deepest level
    const code = NAME_TO_CODE[p?.name];
    if (level === 'world') {
      if (!code) return;
      if (EUROPE.has(code)) setLevel('europe');
      else if (agg.m.has(code)) {
        setSelected(code);
        setLevel('country');
      }
    } else if (level === 'europe') {
      if (code && agg.m.has(code)) {
        setSelected(code);
        setLevel('country');
      }
    }
  }

  const crumb = (lbl: string, active: boolean, onClick?: () => void) => (
    <button type="button" className={'map-crumb' + (active ? ' active' : '')} onClick={onClick} disabled={active && !onClick}>
      {lbl}
    </button>
  );

  const isGraph = viewMode === 'graph';
  const activeOption = isGraph ? barOption : showSub ? subOption : worldOption;
  const loadErr = isGraph ? false : showSub ? !!(selected && subErr[selected]) : err;
  const loaded = isGraph ? true : showSub ? !!(selected && subReady[selected]) : ready;
  const unknownVal = showSub ? subAgg.unknownVal : agg.unknownVal;
  const unknownCount = showSub ? subAgg.unknownCount : agg.unknownCount;
  const unknownLabel = showSub ? (sub as SubDiv).unknownLabel : 'a country';

  return (
    <div className="gcard wide">
      <div className="gcard-head">
        <div>
          <h3>Sales by country</h3>
          <span className="gcard-hint">Click to drill in: World → Europe → country → (NL) provinces / (DE) states</span>
        </div>
        <div className="gcard-controls">
          <div className="seg">
            <button className={'seg-btn' + (viewMode === 'map' ? ' active' : '')} onClick={() => setViewMode('map')}>
              Map
            </button>
            <button className={'seg-btn' + (viewMode === 'graph' ? ' active' : '')} onClick={() => setViewMode('graph')}>
              Graph
            </button>
          </div>
          <div className="seg">
            <button className={'seg-btn' + (metric === 'gross' ? ' active' : '')} onClick={() => setMetric('gross')}>
              Gross
            </button>
            <button className={'seg-btn' + (metric === 'nett' ? ' active' : '')} onClick={() => setMetric('nett')}>
              Nett
            </button>
          </div>
          <button
            className="icon-btn"
            title="Download as image"
            aria-label="Download as image"
            onClick={() => chartRef.current?.download(showSub ? (sub as SubDiv).download : 'sales-by-country')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="M7 11l5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* breadcrumb + big number */}
      <div className="map-bar">
        <div className="map-crumbs">
          {crumb('World', level === 'world', level !== 'world' ? () => { setLevel('world'); setSelected(null); } : undefined)}
          <span className="map-sep">›</span>
          {crumb('Europe', level === 'europe', level !== 'europe' ? () => { setLevel('europe'); setSelected(null); } : undefined)}
          {level === 'country' && selected && (
            <>
              <span className="map-sep">›</span>
              {crumb(levelLabel, true)}
            </>
          )}
        </div>
        <div className="map-total">
          <span className="map-total-lbl">{levelLabel} · {metric === 'gross' ? 'Gross' : 'Nett'}</span>
          <span className="map-total-val">{fmtInt(levelTotal)}</span>
        </div>
      </div>

      {loadErr && <div className="empty small">Could not load the map.</div>}
      {!loadErr && !loaded && <div className="empty small">Loading map…</div>}
      {!loadErr && loaded && <EChart ref={chartRef} option={activeOption} height={isGraph ? graphHeight : 'max(360px, calc(100vh - 300px))'} onEvents={{ click: onMapClick }} />}

      {unknownCount > 0 && (
        <div className="map-unknown">
          Not mapped to {unknownLabel}: {fmtInt(unknownVal)} ({unknownCount} deal{unknownCount === 1 ? '' : 's'})
        </div>
      )}
    </div>
  );
}
