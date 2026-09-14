import { useEffect, useState } from 'react';
import { Deal, fmtInt, getDeals } from '../api';

function fmtDate(s: string | null): string {
  if (!s) return '';
  // handle both "2026-09-15" and full ISO timestamps
  return s.length >= 10 ? s.slice(0, 10) : s;
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
                <th className="num">Deal amount</th>
                <th className="num">Cost of sales</th>
                <th className="num">Margin</th>
                <th>Month</th>
                <th>Deal ID</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td>{fmtDate(d.execution_date)}</td>
                  <td>
                    <a className="deal-link" href={d.deal_link} target="_blank" rel="noreferrer">
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
