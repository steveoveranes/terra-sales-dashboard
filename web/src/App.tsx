import { useEffect, useRef, useState } from 'react';
import { getMeta, getSyncStatus, refresh, Meta, SyncStatus } from './api';
import { BUILD_NUMBER } from './buildInfo';
import RawData from './pages/RawData';
import Monthly from './pages/Monthly';
import Tdjp from './pages/Tdjp';
import Graphs from './pages/Graphs';
import Ideas from './pages/Ideas';
import Settings from './pages/Settings';
import FeedbackBubble from './components/FeedbackBubble';
import LocationReviewModal from './components/LocationReviewModal';

type Tab = 'monthly' | 'graphs' | 'tdjp' | 'raw' | 'ideas' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'graphs', label: 'Dashboard' },
  { key: 'monthly', label: 'Monthly overview' },
  { key: 'tdjp', label: 'TDJP Input Format' },
  { key: 'raw', label: 'Raw HubSpot data' },
  { key: 'ideas', label: 'Ideas & feedback' },
  { key: 'settings', label: '⚙ Settings' },
];

// Allow deep-linking straight to a tab, e.g. the "open triage view" link in the
// follow-up e-mails uses ?tab=ideas.
function urlTab(): Tab | null {
  try {
    const q = new URLSearchParams(window.location.search).get('tab');
    const keys = TABS.map((t) => t.key) as string[];
    if (q && keys.includes(q)) return q as Tab;
  } catch {
    /* ignore */
  }
  return null;
}
function initialTab(): Tab {
  return urlTab() ?? 'monthly';
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showLocReview, setShowLocReview] = useState(false);
  const defaultTabApplied = useRef(false);

  async function loadMeta() {
    const m = await getMeta();
    setMeta(m);
    // default to the most recent year that actually has data, else the latest available
    const preferred = m.dataYears.length ? m.dataYears[m.dataYears.length - 1] : m.years[m.years.length - 1];
    setYear((y) => (m.dataYears.includes(y) ? y : preferred));
    // apply the configured default tab once, unless the URL asked for a specific tab
    if (!defaultTabApplied.current && !urlTab() && m.defaultTab) {
      const keys = TABS.map((t) => t.key) as string[];
      if (keys.includes(m.defaultTab)) setTab(m.defaultTab as Tab);
    }
    defaultTabApplied.current = true;
  }

  async function loadSync() {
    try {
      setSync(await getSyncStatus());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadMeta().catch((e) => console.error(e));
    loadSync();
  }, []);

  async function doRefresh() {
    setRefreshing(true);
    try {
      await refresh();
      await loadMeta();
      await loadSync();
      setRefreshKey((k) => k + 1);
      setShowLocReview(true); // review any deals that couldn't be placed on the map

    } catch (e) {
      console.error(e);
      alert('Refresh failed: ' + (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const lastSync = sync?.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never';

  return (
    <div className="app">
      <div className="topbar">
        <img className="logo" src="/logo-white.png" alt="Terra Drone" />
        <span className="title">Sales Dashboard</span>
        {meta?.useMock && <span className="mock-badge">SAMPLE DATA</span>}
        <span className="spacer" />
        <label className="subtle" style={{ color: '#c7cbe8', fontSize: 13, marginRight: 4 }}>
          Year
        </label>
        <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {meta?.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button className="btn" onClick={doRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
        <div className="sync-info">
          <div>Last sync: {lastSync}</div>
          <div>
            {sync?.source ? `source: ${sync.source} - ` : ''}
            build: {BUILD_NUMBER}
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={'tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === 'raw' && <RawData year={year} refreshKey={refreshKey} />}
        {tab === 'monthly' && <Monthly year={year} refreshKey={refreshKey} meta={meta} />}
        {tab === 'graphs' && <Graphs year={year} refreshKey={refreshKey} meta={meta} />}
        {tab === 'tdjp' && <Tdjp year={year} refreshKey={refreshKey} defaultCurrency={meta?.defaultCurrency} />}
        {tab === 'ideas' && <Ideas refreshKey={refreshKey} />}
        {tab === 'settings' && <Settings refreshKey={refreshKey} year={year} />}
      </div>

      <FeedbackBubble />

      {showLocReview && meta && (
        <LocationReviewModal
          year={year}
          rules={meta.countryRules}
          onClose={() => setShowLocReview(false)}
          onSaved={() => {
            loadMeta().catch((e) => console.error(e));
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
