import { useEffect, useMemo, useState } from 'react';
import { Deal, getDeals, addUserCountryRules, fmtInt } from '../api';
import {
  CountryRules,
  countryOf,
  provinceOf,
  stateOf,
  COUNTRY_META,
  NL_PROVINCES,
  DE_STATES,
  guessKeyword,
} from '../countryRules';

// Shown right after a refresh when new deals could not be placed on the map
// (no country, or NL/DE without a province/state). The user assigns each one; every
// assignment is saved as a reusable keyword rule so similar future deals map automatically.

interface Row {
  id: string;
  name: string;
  amount: number;
  derivedCountry: string; // '' when even the country is unknown
  keyword: string;
  country: string;
  sub: string; // province (NL) or Bundesland (DE)
}

const COUNTRY_OPTIONS = Object.entries(COUNTRY_META)
  .map(([code, m]) => ({ code, name: m.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export default function LocationReviewModal({
  year,
  rules,
  onClose,
  onSaved,
}: {
  year: number;
  rules?: CountryRules | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getDeals(year)
      .then(({ deals }) => {
        if (!alive) return;
        const unmapped = (deals as Deal[]).filter((d) => {
          if (Math.round(d.deal_amount || 0) <= 0) return false;
          const c = countryOf(d, rules);
          if (!c) return true;
          if (c === 'NL' && !provinceOf(d, rules)) return true;
          if (c === 'DE' && !stateOf(d, rules)) return true;
          return false;
        });
        setRows(
          unmapped
            .sort((a, b) => (b.deal_amount || 0) - (a.deal_amount || 0))
            .map((d) => {
              const derived = countryOf(d, rules);
              return {
                id: d.id,
                name: d.deal_name,
                amount: Math.round(d.deal_amount || 0),
                derivedCountry: derived,
                keyword: guessKeyword(d.deal_name),
                country: derived || '',
                sub: '',
              };
            })
        );
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [year, rules]);

  const set = (id: string, patch: Partial<Row>) =>
    setRows((rs) => (rs ? rs.map((r) => (r.id === id ? { ...r, ...patch } : r)) : rs));

  const readyCount = useMemo(() => {
    if (!rows) return 0;
    return rows.filter((r) => {
      const kw = r.keyword.trim();
      if (!kw) return false;
      const eff = r.country || r.derivedCountry;
      if (!eff) return false;
      if (eff === 'NL' || eff === 'DE') return !!r.sub;
      return !r.derivedCountry; // a plain country assignment for an unknown-country deal
    }).length;
  }, [rows]);

  async function handleSave() {
    if (!rows) return;
    const payload = {
      nameRules: [] as { contains: string; country: string }[],
      provinceRules: [] as { contains: string; province: string }[],
      stateRules: [] as { contains: string; state: string }[],
    };
    for (const r of rows) {
      const kw = r.keyword.trim().toLowerCase();
      if (!kw) continue;
      if (!r.derivedCountry && r.country) payload.nameRules.push({ contains: kw, country: r.country });
      const eff = r.country || r.derivedCountry;
      if (eff === 'NL' && r.sub) payload.provinceRules.push({ contains: kw, province: r.sub });
      if (eff === 'DE' && r.sub) payload.stateRules.push({ contains: kw, state: r.sub });
    }
    if (!payload.nameRules.length && !payload.provinceRules.length && !payload.stateRules.length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await addUserCountryRules(payload);
      onSaved();
      onClose();
    } catch (e) {
      alert('Saving the rules failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Nothing to review → don't show the modal at all.
  if (rows && rows.length === 0) {
    onClose();
    return null;
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Assign a location to new deals</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="modal-sub">
          These deals from the last refresh could not be placed on the map. Pick a country
          (and province/state for NL &amp; DE). Each choice is saved as a rule on the
          keyword, so similar deals map automatically next time. Leave a row blank to skip it.
        </p>
        {!rows ? (
          <div className="modal-body">Loading…</div>
        ) : (
          <div className="modal-body">
            <table className="loc-table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th className="num">Amount</th>
                  <th>Keyword (rule)</th>
                  <th>Country</th>
                  <th>Province / State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const eff = r.country || r.derivedCountry;
                  const subList = eff === 'NL' ? NL_PROVINCES : eff === 'DE' ? DE_STATES : null;
                  const kwMissing = !!r.keyword && !r.name.toLowerCase().includes(r.keyword.trim().toLowerCase());
                  return (
                    <tr key={r.id}>
                      <td className="loc-name" title={r.name}>{r.name}</td>
                      <td className="num">{fmtInt(r.amount)}</td>
                      <td>
                        <input
                          className={'loc-input' + (kwMissing ? ' warn' : '')}
                          value={r.keyword}
                          onChange={(e) => set(r.id, { keyword: e.target.value })}
                          title={kwMissing ? 'This text is not in the deal name — the rule will not match.' : 'A substring of the deal name'}
                        />
                      </td>
                      <td>
                        {r.derivedCountry ? (
                          <span className="loc-fixed">{COUNTRY_META[r.derivedCountry]?.name || r.derivedCountry}</span>
                        ) : (
                          <select className="loc-input" value={r.country} onChange={(e) => set(r.id, { country: e.target.value, sub: '' })}>
                            <option value="">— choose —</option>
                            {COUNTRY_OPTIONS.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {subList ? (
                          <select className="loc-input" value={r.sub} onChange={(e) => set(r.id, { sub: e.target.value })}>
                            <option value="">— choose —</option>
                            {subList.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="loc-dim">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Skip for now
          </button>
          <button className="btn" onClick={handleSave} disabled={saving || !rows}>
            {saving ? 'Saving…' : `Save ${readyCount || ''} rule${readyCount === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
