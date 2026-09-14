import { useEffect, useMemo, useState } from 'react';
import {
  Feedback,
  addFeedbackUpdate,
  feedbackVideoUrl,
  listFeedback,
  patchFeedback,
} from '../api';

// Owner triage view for the 🐛 feedback / idea submissions (phase 2).
// Lists every submission, lets the owner change status/priority, add a public
// update note (which the submitter will see / be e-mailed about in phase 3),
// keep internal notes, and watch the recorded clip.

const STATUSES: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'planned', label: 'Planned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
  { key: 'declined', label: 'Declined' },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

const PRIORITIES: { key: string; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'normal', label: 'Normal' },
  { key: 'high', label: 'High' },
  { key: 'urgent', label: 'Urgent' },
];

// whole calendar days elapsed since an ISO timestamp
function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return 0;
  return Math.floor((Date.now() - then) / 86_400_000);
}
// working days (Mon–Fri) elapsed since an ISO timestamp — matches the phase-3
// owner-reminder threshold (> 3 working days open).
function workdaysSince(iso: string): number {
  const start = new Date(iso);
  if (isNaN(start.getTime())) return 0;
  let n = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    const d = cur.getDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}
function ageLabel(iso: string): string {
  const d = daysSince(iso);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summaryOf(f: Feedback): string {
  const s = (f.user_text || f.transcript || '').trim();
  return s || (f.video_filename ? '(screen recording only)' : '(no description)');
}

// an item is "waiting on the owner" when it is not resolved and has been open a while
function isOpenState(status: string): boolean {
  return status !== 'done' && status !== 'declined';
}

export default function Ideas({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // detail-panel form state
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'internal'>('public');
  const [noteStatus, setNoteStatus] = useState<string>('');
  const [savingNote, setSavingNote] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await listFeedback();
      setItems(r.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const filtered = useMemo(() => {
    let list = items;
    if (statusFilter === 'active') list = items.filter((f) => isOpenState(f.status));
    else if (statusFilter !== 'all') list = items.filter((f) => f.status === statusFilter);
    return list;
  }, [items, statusFilter]);

  // keep a valid selection
  useEffect(() => {
    if (selectedId != null && filtered.some((f) => f.id === selectedId)) return;
    setSelectedId(filtered.length ? filtered[0].id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const selected = useMemo(() => items.find((f) => f.id === selectedId) || null, [items, selectedId]);

  // reset the note form when switching items
  useEffect(() => {
    setNoteText('');
    setNoteVisibility('public');
    setNoteStatus('');
  }, [selectedId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, active: 0 };
    for (const f of items) {
      if (isOpenState(f.status)) c.active++;
      c[f.status] = (c[f.status] || 0) + 1;
    }
    return c;
  }, [items]);

  async function changeStatus(f: Feedback, status: string) {
    setBusy(true);
    try {
      const r = await patchFeedback(f.id, { status });
      setItems((xs) => xs.map((x) => (x.id === f.id ? r.item : x)));
    } catch (e) {
      alert('Update failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePriority(f: Feedback, priority: string) {
    setBusy(true);
    try {
      const r = await patchFeedback(f.id, { priority });
      setItems((xs) => xs.map((x) => (x.id === f.id ? r.item : x)));
    } catch (e) {
      alert('Update failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitNote(f: Feedback) {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const r = await addFeedbackUpdate(f.id, {
        text: noteText.trim(),
        visibility: noteVisibility,
        status: noteStatus || undefined,
      });
      setItems((xs) => xs.map((x) => (x.id === f.id ? r.item : x)));
      setNoteText('');
      setNoteStatus('');
    } catch (e) {
      alert('Could not save update: ' + (e as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="card idea-card">
      <div className="idea-toolbar">
        <div className="idea-title">Ideas &amp; feedback</div>
        <div className="idea-filters">
          {[
            { key: 'all', label: `All (${counts.all})` },
            { key: 'active', label: `Active (${counts.active})` },
            ...STATUSES.map((s) => ({ key: s.key, label: `${s.label} (${counts[s.key] || 0})` })),
          ].map((t) => (
            <button
              key={t.key}
              className={'idea-chip' + (statusFilter === t.key ? ' on' : '')}
              onClick={() => setStatusFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↻ Reload'}
        </button>
      </div>

      {error && <div className="idea-error">Could not load submissions: {error}</div>}

      <div className="idea-split">
        {/* list */}
        <div className="idea-list">
          {filtered.length === 0 && !loading && (
            <div className="idea-empty">No submissions in this view yet.</div>
          )}
          {filtered.map((f) => {
            const overdue = isOpenState(f.status) && workdaysSince(f.created_at) > 3;
            return (
              <button
                key={f.id}
                className={'idea-item' + (f.id === selectedId ? ' sel' : '')}
                onClick={() => setSelectedId(f.id)}
              >
                <div className="idea-item-top">
                  <span className={'idea-badge st-' + f.status}>{STATUS_LABEL[f.status] || f.status}</span>
                  {f.priority !== 'normal' && (
                    <span className={'idea-prio pr-' + f.priority}>{f.priority}</span>
                  )}
                  {f.video_filename && <span className="idea-vid" title="Has screen recording">🎬</span>}
                  <span className="idea-spacer" />
                  <span className={'idea-age' + (overdue ? ' warn' : '')}>{ageLabel(f.created_at)}</span>
                </div>
                <div className="idea-item-sum">{summaryOf(f)}</div>
                <div className="idea-item-meta">
                  #{f.id} · {f.submitter_name || 'anonymous'}
                  {overdue && <span className="idea-flag"> · needs follow-up</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="idea-detail">
          {!selected ? (
            <div className="idea-empty">Select a submission to triage it.</div>
          ) : (
            <div className="idea-detail-inner">
              <div className="idea-detail-head">
                <div>
                  <div className="idea-detail-title">
                    #{selected.id} · {selected.submitter_name || 'anonymous submitter'}
                  </div>
                  <div className="idea-detail-sub">
                    Submitted {fmtDate(selected.created_at)} · {ageLabel(selected.created_at)} ago
                    {selected.submitter_email ? ` · ${selected.submitter_email}` : ''}
                  </div>
                </div>
              </div>

              {/* status + priority controls */}
              <div className="idea-controls">
                <label className="idea-ctl">
                  <span>Status</span>
                  <select
                    className="select"
                    value={selected.status}
                    disabled={busy}
                    onChange={(e) => changeStatus(selected, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="idea-ctl">
                  <span>Priority</span>
                  <select
                    className="select"
                    value={selected.priority}
                    disabled={busy}
                    onChange={(e) => changePriority(selected, e.target.value)}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* the submission itself */}
              {selected.user_text && (
                <div className="idea-block">
                  <div className="idea-block-label">Description</div>
                  <div className="idea-block-body">{selected.user_text}</div>
                </div>
              )}
              {selected.transcript && (
                <div className="idea-block">
                  <div className="idea-block-label">🎤 Spoken transcript</div>
                  <div className="idea-block-body idea-transcript">{selected.transcript}</div>
                </div>
              )}
              {selected.video_filename && (
                <div className="idea-block">
                  <div className="idea-block-label">🎬 Screen recording</div>
                  <video className="idea-video" src={feedbackVideoUrl(selected.id)} controls />
                </div>
              )}
              <div className="idea-context">
                Page: <code>{selected.url || '–'}</code>
                {selected.viewport ? ` · ${selected.viewport}` : ''}
              </div>

              {/* timeline */}
              <div className="idea-block">
                <div className="idea-block-label">Timeline</div>
                {(!selected.updates || selected.updates.length === 0) && (
                  <div className="idea-muted">No updates yet.</div>
                )}
                {selected.updates && selected.updates.length > 0 && (
                  <ul className="idea-timeline">
                    {selected.updates
                      .slice()
                      .reverse()
                      .map((u, i) => (
                        <li key={i} className={'idea-tl ' + u.visibility}>
                          <div className="idea-tl-head">
                            <span className="idea-tl-vis">
                              {u.visibility === 'public' ? '👁 Shared with submitter' : '🔒 Internal'}
                            </span>
                            {u.status && (
                              <span className={'idea-badge st-' + u.status}>
                                → {STATUS_LABEL[u.status] || u.status}
                              </span>
                            )}
                            <span className="idea-spacer" />
                            <span className="idea-tl-when">{fmtDate(u.at)}</span>
                          </div>
                          <div className="idea-tl-body">{u.text}</div>
                          <div className="idea-tl-by">— {u.author}</div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {/* add update */}
              <div className="idea-addnote">
                <div className="idea-block-label">Add update</div>
                <textarea
                  className="idea-textarea"
                  rows={3}
                  value={noteText}
                  placeholder={
                    noteVisibility === 'public'
                      ? 'Progress note the submitter will see (and be e-mailed about)…'
                      : 'Internal note — only visible to you…'
                  }
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div className="idea-addnote-row">
                  <div className="idea-vis-toggle">
                    <button
                      className={'idea-seg' + (noteVisibility === 'public' ? ' on' : '')}
                      onClick={() => setNoteVisibility('public')}
                      type="button"
                    >
                      👁 Public
                    </button>
                    <button
                      className={'idea-seg' + (noteVisibility === 'internal' ? ' on' : '')}
                      onClick={() => setNoteVisibility('internal')}
                      type="button"
                    >
                      🔒 Internal
                    </button>
                  </div>
                  <label className="idea-ctl-inline">
                    <span>Set status</span>
                    <select
                      className="select"
                      value={noteStatus}
                      onChange={(e) => setNoteStatus(e.target.value)}
                    >
                      <option value="">— keep ({STATUS_LABEL[selected.status]}) —</option>
                      {STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="idea-spacer" />
                  <button
                    className="btn"
                    disabled={savingNote || !noteText.trim()}
                    onClick={() => submitNote(selected)}
                  >
                    {savingNote ? 'Saving…' : 'Post update'}
                  </button>
                </div>
                {noteVisibility === 'public' && (
                  <div className="idea-hint">
                    Public updates are shown to the submitter and (once e-mail is set up) sent to them.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
