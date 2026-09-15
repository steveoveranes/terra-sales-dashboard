import { useEffect, useMemo, useState } from 'react';
import { AppSetting, MailStatus, announceVersion, getSettings, runFollowupSweep, saveSettings, sendTestEmail } from '../api';
import BudgetModal from '../components/BudgetModal';
import { BUILD_NUMBER } from '../buildInfo';
import { WHATS_NEW_DEFAULT } from '../whatsNew';

// Application settings screen. Edits operational/business settings that are safe to
// change at runtime (they persist in the settings store, layered over env defaults).
// Secrets (SMTP password, HubSpot token, DATABASE_URL) are intentionally NOT here —
// they stay in .env and are shown only as a read-only status.

export default function Settings({ refreshKey, year }: { refreshKey: number; year: number }) {
  const [defs, setDefs] = useState<AppSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [mail, setMail] = useState<MailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sweepMsg, setSweepMsg] = useState('');
  const [sweeping, setSweeping] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [whatsNew, setWhatsNew] = useState(WHATS_NEW_DEFAULT);
  const [announcing, setAnnouncing] = useState(false);
  const [announceMsg, setAnnounceMsg] = useState('');
  const [announceOk, setAnnounceOk] = useState<boolean | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await getSettings();
      setDefs(r.settings);
      setValues(Object.fromEntries(r.settings.map((s) => [s.key, s.value])));
      setMail(r.mail);
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

  const dirty = useMemo(
    () => defs.some((d) => (values[d.key] ?? '') !== d.value),
    [defs, values]
  );

  const groups = useMemo(() => {
    const g: Record<string, AppSetting[]> = {};
    for (const d of defs) (g[d.group] ||= []).push(d);
    return g;
  }, [defs]);

  function setVal(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setSavedMsg('');
  }

  async function save() {
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      // only send changed keys
      const patch: Record<string, string> = {};
      for (const d of defs) if ((values[d.key] ?? '') !== d.value) patch[d.key] = values[d.key] ?? '';
      const r = await saveSettings(patch);
      setDefs(r.settings);
      setValues(Object.fromEntries(r.settings.map((s) => [s.key, s.value])));
      setMail(r.mail);
      setSavedMsg(`Saved ${r.changed.length} setting${r.changed.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function testSweep() {
    setSweeping(true);
    setSweepMsg('');
    try {
      const r = await runFollowupSweep();
      setSweepMsg(
        `Sweep ran (${r.mailMode}): owner digest ${r.ownerDigestSent ? 'sent' : 'not needed'} ` +
          `(${r.ownerRemindedCount} item${r.ownerRemindedCount === 1 ? '' : 's'}), ` +
          `${r.submitterHeartbeats} submitter update${r.submitterHeartbeats === 1 ? '' : 's'}.` +
          (r.mailMode === 'console' ? ' No SMTP configured — nothing actually e-mailed.' : '')
      );
    } catch (e) {
      setSweepMsg('Sweep failed: ' + (e as Error).message);
    } finally {
      setSweeping(false);
    }
  }

  async function testEmail() {
    setTesting(true);
    setTestMsg('');
    setTestOk(null);
    try {
      const r = await sendTestEmail();
      setTestOk(r.success && r.mode === 'sent');
      if (r.mode === 'console') {
        setTestMsg(`No SMTP configured — nothing sent (would have gone to ${r.to}). Set SMTP_USER/SMTP_PASS in .env.`);
      } else if (r.success) {
        setTestMsg(`Test e-mail sent to ${r.to}. Check the inbox.`);
      } else {
        setTestMsg(`Sending failed: ${r.error || 'unknown error'}`);
      }
    } catch (e) {
      setTestOk(false);
      setTestMsg('Sending failed: ' + (e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  // currently SAVED recipients (server announces to the saved value, not the unsaved input)
  const savedRecipients = defs.find((d) => d.key === 'notify.new_version_recipients')?.value ?? '';
  const recipientsDirty =
    (values['notify.new_version_recipients'] ?? '') !== savedRecipients;
  const recipientCount = savedRecipients.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).length;

  async function announce() {
    setAnnouncing(true);
    setAnnounceMsg('');
    setAnnounceOk(null);
    try {
      const r = await announceVersion(BUILD_NUMBER, whatsNew);
      setAnnounceOk(r.success);
      if (r.mode === 'console') {
        setAnnounceMsg(
          `No SMTP configured — nothing actually sent (would have gone to ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}). Set SMTP_USER/SMTP_PASS in .env.`
        );
      } else if (r.success) {
        setAnnounceMsg(`Announcement sent to ${r.sent} of ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}.`);
      } else {
        setAnnounceMsg(`Sent to ${r.sent} of ${r.recipients}; some failed: ${r.errors.join('; ')}`);
      }
    } catch (e) {
      setAnnounceOk(false);
      setAnnounceMsg('Announcement failed: ' + (e as Error).message);
    } finally {
      setAnnouncing(false);
    }
  }

  function renderField(d: AppSetting) {
    const v = values[d.key] ?? '';
    if (d.type === 'bool') {
      const on = v === '1' || v.toLowerCase() === 'true';
      return (
        <label className="set-switch">
          <input type="checkbox" checked={on} onChange={(e) => setVal(d.key, e.target.checked ? '1' : '0')} />
          <span className="set-switch-track"><span className="set-switch-thumb" /></span>
          <span className="set-switch-txt">{on ? 'On' : 'Off'}</span>
        </label>
      );
    }
    if (d.type === 'int') {
      return (
        <input
          className="set-input set-input-num"
          type="number"
          value={v}
          onChange={(e) => setVal(d.key, e.target.value)}
        />
      );
    }
    if (d.type === 'enum') {
      return (
        <select className="select set-input" value={v} onChange={(e) => setVal(d.key, e.target.value)}>
          {(d.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="set-input"
        type="text"
        value={v}
        onChange={(e) => setVal(d.key, e.target.value)}
      />
    );
  }

  return (
    <div className="card set-card">
      <div className="set-scroll">
        <div className="set-inner">
          <h1 className="set-h1">Application settings</h1>

          {error && <div className="set-error">{error}</div>}
          {loading && <div className="idea-empty">Loading…</div>}

          {!loading && (
            <>

              {Object.entries(groups).map(([group, list]) => {
                const basic = list.filter((d) => !d.advanced);
                const advanced = list.filter((d) => d.advanced);
                return (
                  <div className="set-group" key={group}>
                    <h2 className="set-h2">{group}</h2>
                    {basic.map((d) => (
                      <div className="set-row" key={d.key}>
                        <div className="set-row-label">
                          <label>{d.label}</label>
                          {d.help && <div className="set-help">{d.help}</div>}
                        </div>
                        <div className="set-row-field">{renderField(d)}</div>
                      </div>
                    ))}
                    {advanced.length > 0 && showAdvanced &&
                      advanced.map((d) => (
                        <div className="set-row" key={d.key}>
                          <div className="set-row-label">
                            <label>{d.label} <span className="set-adv-tag">advanced</span></label>
                            {d.help && <div className="set-help">{d.help}</div>}
                          </div>
                          <div className="set-row-field">{renderField(d)}</div>
                        </div>
                      ))}
                  </div>
                );
              })}

              {defs.some((d) => d.advanced) && (
                <button className="set-adv-toggle" onClick={() => setShowAdvanced((s) => !s)}>
                  {showAdvanced ? '▾ Hide advanced settings' : '▸ Show advanced settings'}
                </button>
              )}

              {/* budget editor (moved here from the Graphs tab) */}
              <div className="set-group">
                <h2 className="set-h2">Budget</h2>
                <p className="set-help">
                  Set the monthly gross- and nett-sales budget for {year}. It's used on the Graphs tab
                  (actual vs. budget). Editing here keeps the Graphs view uncluttered.
                </p>
                <button className="btn" onClick={() => setBudgetOpen(true)}>
                  ✎ Edit budget for {year}
                </button>
              </div>

              {/* test the follow-up loop */}
              <div className="set-group">
                <h2 className="set-h2">Test the follow-up loop</h2>
                <p className="set-help">
                  Runs the reminder sweep right now (owner digest + submitter heartbeats) so you can
                  verify the e-mail flow. Safe to run anytime.
                </p>
                <div className="set-btn-row">
                  <button className="btn-ghost" onClick={testEmail} disabled={testing}>
                    {testing ? 'Sending…' : '✉ Send test e-mail'}
                  </button>
                  <button className="btn-ghost" onClick={testSweep} disabled={sweeping}>
                    {sweeping ? 'Running…' : '▶ Run follow-up sweep now'}
                  </button>
                </div>
                {testMsg && (
                  <div className={'set-sweep-msg' + (testOk === false ? ' err' : testOk ? ' ok' : '')}>{testMsg}</div>
                )}
                {sweepMsg && <div className="set-sweep-msg">{sweepMsg}</div>}
              </div>

              {/* announce a new version to the team by e-mail */}
              <div className="set-group">
                <h2 className="set-h2">Announce a new version</h2>
                <p className="set-help">
                  Sends a "new version available" e-mail to the recipients set above under{' '}
                  <b>Notifications → New-version recipients</b>. Currently{' '}
                  {recipientCount} recipient{recipientCount === 1 ? '' : 's'} saved. Type a short
                  what's-new note (one line per bullet), then press Announce. Current build:{' '}
                  <code>{BUILD_NUMBER}</code>.
                </p>
                {recipientsDirty && (
                  <div className="set-sweep-msg err">
                    You changed the recipient list but haven't saved yet — press “Save changes” first,
                    otherwise the announcement uses the previously saved recipients.
                  </div>
                )}
                <textarea
                  className="set-input"
                  style={{ width: '100%', minHeight: 96, resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder={"What's new in this version? One numbered line per point, e.g.\n1. Deals without owner or amount are now flagged red\n2. Raw HubSpot data links open in TerraFlow"}
                  value={whatsNew}
                  onChange={(e) => setWhatsNew(e.target.value)}
                />
                <div className="set-btn-row" style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={announce}
                    disabled={announcing || recipientCount === 0}
                    title={recipientCount === 0 ? 'Add and save at least one recipient first' : 'Send the announcement now'}
                  >
                    {announcing ? 'Sending…' : '🚀 Announce new version'}
                  </button>
                  {whatsNew !== WHATS_NEW_DEFAULT && (
                    <button
                      className="btn-ghost"
                      onClick={() => setWhatsNew(WHATS_NEW_DEFAULT)}
                      title="Restore the pre-filled list of changes"
                    >
                      ↺ Reset text
                    </button>
                  )}
                </div>
                {announceMsg && (
                  <div className={'set-sweep-msg' + (announceOk === false ? ' err' : announceOk ? ' ok' : '')}>
                    {announceMsg}
                  </div>
                )}
              </div>

              {/* mail transport status (kept at the bottom as a status banner) */}
              {mail && (
                <div className={'set-mail ' + (mail.configured ? 'ok' : 'warn')}>
                  <div className="set-mail-dot" />
                  <div>
                    <div className="set-mail-title">
                      E-mail transport: {mail.configured ? 'configured' : 'not configured'}
                    </div>
                    <div className="set-mail-sub">
                      SMTP host <code>{mail.host}</code> · account <code>{mail.user}</code>
                      {!mail.configured && (
                        <> — set <code>SMTP_USER</code> and <code>SMTP_PASS</code> (Gmail app-password) in <code>.env</code> to actually send mail. Until then the follow-up loop logs to the server console instead of sending.</>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* sticky save bar */}
      {!loading && (
        <div className="set-savebar">
          {savedMsg && <span className="set-saved">{savedMsg}</span>}
          {dirty && !savedMsg && <span className="set-dirty">Unsaved changes</span>}
          <span className="idea-spacer" />
          <button className="btn" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {budgetOpen && (
        <BudgetModal year={year} onClose={() => setBudgetOpen(false)} onSaved={() => setBudgetOpen(false)} />
      )}
    </div>
  );
}
