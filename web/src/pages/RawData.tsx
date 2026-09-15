import { useEffect, useState } from 'react';
import { Deal, fmtInt, getDeals } from '../api';

function fmtDate(s: string | null): string {
  if (!s) return '';
  // handle both "2026-09-15" and full ISO timestamps
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// TerraFlow deep link for a deal (same rule as the Monthly overview): highlight the
// kanban card by its NN-NNNN(.N…) project code, else link to the kanban board.
const TERRAFLOW_KANBAN = 'https://terra-flow.ai/kanban/';
function terraflowUrl(dealName: string): string {
  const m = (dealName || '').match(/\b\d{2}-\d{4}(?:\.\d+)*\b/);
  return m ? `${TERRAFLOW_KANBAN}?highlight=${encodeURIComponent(m[0])}` : TERRAFLOW_KANBAN;
}

export default function RawData({ year, refreshKey }: { year: number; refreshKey: number }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const totals = deals.reduce(
    (a, d) => {
      a.amount += d.deal_amount;
      a.cost += d.cost_of_sales;
      a.margin += d.margin;
      return a;
    },
    { amount: 0, cost: 0, margin: 0 }
  );

  return (
    <div className="card">
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center' }}>
        <span className="section-title" style={{ margin: 0 }}>
          Raw HubSpot data — {year}
        </span>
        <span className="count-pill">{deals.length} deals</span>
      </div>

      {loading && <div className="placeholder">Loading…</div>}
      {error && <div className="placeholder" style={{ color: 'var(--status-red)' }}>Error: {error}</div>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="grid">
            <colgroup>
              <col style={{ width: '8%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '6.5%' }} />
              <col style={{ width: '6.5%' }} />
              <col style={{ width: '6.5%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8.5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Execution date</th>
                <th>Deal name</th>
                <th>Close date</th>
                <th>Sales pipeline</th>
                <th>Deal stage</th>
                <th>Owner</th>
                <th className="num">Gross sales</th>
                <th className="num">Cost of sales</th>
                <th className="num">Nett sales</th>
                <th>Month</th>
                <th>Deal ID</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td>{fmtDate(d.execution_date)}</td>
                  <td>
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
                    <a className="deal-link" href={terraflowUrl(d.deal_name)} target="_blank" rel="noreferrer" title="Open in TerraFlow">
                      {d.deal_name}
                    </a>
                  </td>
                  <td>{fmtDate(d.close_date)}</td>
                  <td>{d.sales_pipeline}</td>
                  <td>{d.deal_stage}</td>
                  <td>{d.owner}</td>
                  <td className="num">{fmtInt(d.deal_amount)}</td>
                  <td className="num">{fmtInt(d.cost_of_sales)}</td>
                  <td className="num">{fmtInt(d.margin)}</td>
                  <td>{d.execution_month || <span className="subtle">No execution date</span>}</td>
                  <td className="subtle">{d.id}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800 }}>
                <td colSpan={6} style={{ textAlign: 'right', padding: '9px 10px' }}>
                  Total
                </td>
                <td className="num">{fmtInt(totals.amount)}</td>
                <td className="num">{fmtInt(totals.cost)}</td>
                <td className="num">{fmtInt(totals.margin)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
