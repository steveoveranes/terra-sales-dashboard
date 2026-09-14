import { useEffect, useState } from 'react';
import { BudgetMonth, fmtInt, getBudget, saveBudget } from '../api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

type Row = { amount: string; margin: string };

export default function BudgetModal({
  year,
  onClose,
  onSaved,
}: {
  year: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: 12 }, () => ({ amount: '', margin: '' }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getBudget(year)
      .then((b) => {
        if (!alive) return;
        const next: Row[] = Array.from({ length: 12 }, (_, i) => {
          const key = `${year}-${pad2(i + 1)}`;
          const m = b.months[key];
          return {
            amount: m && m.budget_amount ? String(m.budget_amount) : '',
            margin: m && m.budget_margin ? String(m.budget_margin) : '',
          };
        });
        setRows(next);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [year]);

  function set(i: number, field: keyof Row, value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value.replace(/[^\d.-]/g, '') } : r)));
  }

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalMargin = rows.reduce((s, r) => s + (Number(r.margin) || 0), 0);

  async function handleSave() {
    setSaving(true);
    try {
      const months: Record<string, BudgetMonth> = {};
      rows.forEach((r, i) => {
        months[`${year}-${pad2(i + 1)}`] = {
          budget_amount: Number(r.amount) || 0,
          budget_margin: Number(r.margin) || 0,
        };
      });
      await saveBudget(year, months);
      onSaved();
      onClose();
    } catch (e) {
      alert('Saving the budget failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Budget {year} — revenue &amp; margin per month</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="modal-sub">
          Enter the monthly budget at company level (in euros). These numbers feed the
          budget-vs-actual charts and the pacing.
        </p>
        {loading ? (
          <div className="modal-body">Loading…</div>
        ) : (
          <div className="modal-body">
            <table className="budget-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Revenue budget (€)</th>
                  <th className="num">Margin budget (€)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{MONTHS[i]}</td>
                    <td className="num">
                      <input
                        inputMode="numeric"
                        value={r.amount}
                        onChange={(e) => set(i, 'amount', e.target.value)}
                        placeholder="0"
                      />
                    </td>
                    <td className="num">
                      <input
                        inputMode="numeric"
                        value={r.margin}
                        onChange={(e) => set(i, 'margin', e.target.value)}
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{fmtInt(totalAmount)}</td>
                  <td className="num">{fmtInt(totalMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
