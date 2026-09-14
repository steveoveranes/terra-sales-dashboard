import cron from 'node-cron';
import { config } from './config';
import { esc, mailConfigured, sendMail } from './mailer';
import { followup as fs, owner as ownerCfg } from './appSettings';
import {
  FeedbackRow,
  FeedbackUpdate,
  listFeedback,
  markOwnerReminded,
  markUserNotified,
} from './feedback';

// Follow-up loop (phase 3) — keeps both sides of an idea informed:
//
//  • PRODUCT OWNER (Steven): a weekday digest of ideas that have been open too long
//    ("idea X of person Y has waited N days"), nudging after > N working days, then
//    repeating weekly, with items past the escalation threshold flagged as urgent.
//
//  • SUBMITTER: an immediate e-mail when the owner posts a *public* update, plus a
//    weekly heartbeat so they hear about progress at least once a week.
//    (Submitter e-mails only actually go out once we have their address, which for
//    now arrives via the TerraFlow login — until then these are simply skipped.)
//
// The mailer degrades to console mode when no SMTP is configured, so this is safe to
// run everywhere.

const DAY_MS = 86_400_000;
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  planned: 'Ingepland',
  in_progress: 'In behandeling',
  done: 'Afgerond',
  declined: 'Afgewezen',
};

function isOpenState(status: string): boolean {
  return status !== 'done' && status !== 'declined';
}
function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / DAY_MS);
}
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
function who(f: FeedbackRow): string {
  return f.submitter_name || 'een anonieme indiener';
}
function summary(f: FeedbackRow): string {
  const s = (f.user_text || f.transcript || '').trim().replace(/\s+/g, ' ');
  if (s) return s.length > 140 ? s.slice(0, 137) + '…' : s;
  return f.video_filename ? '(alleen schermopname)' : '(geen omschrijving)';
}
function triageLink(): string {
  return `${fs.appBaseUrl()}/?tab=ideas`;
}
function lastPublicUpdate(f: FeedbackRow): FeedbackUpdate | null {
  const ups = Array.isArray(f.updates) ? f.updates : [];
  for (let i = ups.length - 1; i >= 0; i--) if (ups[i].visibility === 'public') return ups[i];
  return null;
}

// ---------------- owner digest ----------------

export async function sendOwnerDigest(items: FeedbackRow[]): Promise<boolean> {
  if (!items.length) return false;
  const sorted = items
    .map((f) => ({ f, wd: workdaysSince(f.created_at) }))
    .sort((a, b) => b.wd - a.wd);

  const escalate = fs.escalateWorkdays();
  const ownerEmail = ownerCfg.email();
  const ownerName = ownerCfg.name();
  const lines: string[] = [];
  const htmlRows: string[] = [];
  for (const { f, wd } of sorted) {
    const urgent = wd > escalate;
    const tag = urgent ? '⚠️ URGENT — ' : '';
    lines.push(
      `${tag}#${f.id} · ${who(f)} — ${wd} werkdagen open (status: ${STATUS_LABEL[f.status] || f.status})\n` +
        `    "${summary(f)}"`
    );
    htmlRows.push(
      `<tr${urgent ? ' style="background:#fdecec"' : ''}>` +
        `<td style="padding:6px 10px;white-space:nowrap">${urgent ? '⚠️ ' : ''}#${f.id}</td>` +
        `<td style="padding:6px 10px">${esc(who(f))}</td>` +
        `<td style="padding:6px 10px;white-space:nowrap">${wd} werkdagen</td>` +
        `<td style="padding:6px 10px">${esc(STATUS_LABEL[f.status] || f.status)}</td>` +
        `<td style="padding:6px 10px;color:#374151">${esc(summary(f))}</td>` +
        `</tr>`
    );
  }

  const n = sorted.length;
  const subject = `🐛 ${n} idee${n === 1 ? '' : 'ën'} wacht${n === 1 ? '' : 'en'} op je — Terra Sales Dashboard`;
  const text =
    `Hoi ${ownerName},\n\n` +
    `De volgende ${n} idee${n === 1 ? '' : 'ën'} staan al langer open en wachten op actie:\n\n` +
    lines.join('\n\n') +
    `\n\nPak ze op in de triage-view:\n${triageLink()}\n\n` +
    `— Terra Sales Dashboard`;
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1a1a2e">` +
    `<p>Hoi ${esc(ownerName)},</p>` +
    `<p>De volgende <b>${n}</b> idee${n === 1 ? '' : 'ën'} staan al langer open en wachten op actie:</p>` +
    `<table style="border-collapse:collapse;font-size:14px" cellspacing="0">` +
    `<thead><tr style="background:#0f0f56;color:#fff">` +
    `<th style="padding:6px 10px;text-align:left">#</th>` +
    `<th style="padding:6px 10px;text-align:left">Indiener</th>` +
    `<th style="padding:6px 10px;text-align:left">Open</th>` +
    `<th style="padding:6px 10px;text-align:left">Status</th>` +
    `<th style="padding:6px 10px;text-align:left">Omschrijving</th>` +
    `</tr></thead><tbody>${htmlRows.join('')}</tbody></table>` +
    `<p><a href="${triageLink()}" style="background:#143893;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">Open de triage-view →</a></p>` +
    `<p style="color:#6b7280;font-size:12px">— Terra Sales Dashboard</p></div>`;

  const r = await sendMail({ to: ownerEmail, subject, text, html });
  if (r.ok) await markOwnerReminded(sorted.map((s) => s.f.id));
  return r.ok;
}

// ---------------- submitter notifications ----------------

/** Immediate e-mail to the submitter when the owner posts a public update.
 *  No-op (but not an error) when we don't have the submitter's address yet. */
export async function notifySubmitterOfUpdate(f: FeedbackRow, update: FeedbackUpdate): Promise<void> {
  if (!fs.enabled() || !f.submitter_email || update.visibility !== 'public') return;
  const statusTxt = STATUS_LABEL[f.status] || f.status;
  const subject = `Update over je idee #${f.id} — ${statusTxt}`;
  const text =
    `Hoi ${f.submitter_name || ''},\n\n` +
    `Er is een update over het idee dat je hebt ingediend:\n\n` +
    `"${summary(f)}"\n\n` +
    `Status: ${statusTxt}\n` +
    `Update van ${update.author}:\n${update.text}\n\n` +
    `Bedankt voor het meedenken!\n— Terra Sales Dashboard`;
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1a1a2e">` +
    `<p>Hoi ${esc(f.submitter_name || '')},</p>` +
    `<p>Er is een update over het idee dat je hebt ingediend:</p>` +
    `<blockquote style="border-left:3px solid #143893;margin:0;padding:4px 12px;color:#374151">${esc(summary(f))}</blockquote>` +
    `<p><b>Status:</b> ${esc(statusTxt)}</p>` +
    `<p><b>Update van ${esc(update.author)}:</b><br>${esc(update.text).replace(/\n/g, '<br>')}</p>` +
    `<p>Bedankt voor het meedenken!<br><span style="color:#6b7280;font-size:12px">— Terra Sales Dashboard</span></p></div>`;
  const r = await sendMail({ to: f.submitter_email, subject, text, html });
  if (r.ok) await markUserNotified(f.id);
}

/** Weekly heartbeat so an open item's submitter hears from us at least once a week. */
async function sendSubmitterHeartbeat(f: FeedbackRow): Promise<boolean> {
  if (!f.submitter_email) return false;
  const statusTxt = STATUS_LABEL[f.status] || f.status;
  const pub = lastPublicUpdate(f);
  const subject = `Je idee #${f.id} — nog steeds in behandeling (${statusTxt})`;
  const text =
    `Hoi ${f.submitter_name || ''},\n\n` +
    `Een korte update: je idee staat nog op onze lijst.\n\n` +
    `"${summary(f)}"\n\n` +
    `Status: ${statusTxt}\n` +
    (pub ? `Laatste update: ${pub.text}\n` : '') +
    `\nWe houden je op de hoogte.\n— Terra Sales Dashboard`;
  const r = await sendMail({ to: f.submitter_email, subject, text });
  if (r.ok) await markUserNotified(f.id);
  return r.ok;
}

// ---------------- the sweep ----------------

export interface SweepResult {
  ownerRemindedCount: number;
  ownerDigestSent: boolean;
  submitterHeartbeats: number;
  mailMode: 'smtp' | 'console';
}

export async function runFollowupSweep(): Promise<SweepResult> {
  if (!fs.enabled()) {
    console.log('[followup] sweep skipped (disabled in settings)');
    return { ownerRemindedCount: 0, ownerDigestSent: false, submitterHeartbeats: 0, mailMode: mailConfigured() ? 'smtp' : 'console' };
  }
  const all = await listFeedback();
  const open = all.filter((f) => isOpenState(f.status));

  // owner digest: open long enough, and not reminded within the repeat window
  const reminderWorkdays = fs.reminderWorkdays();
  const reminderRepeatDays = fs.reminderRepeatDays();
  const dueForOwner = open.filter(
    (f) =>
      workdaysSince(f.created_at) > reminderWorkdays &&
      daysSince(f.last_owner_reminded_at) >= reminderRepeatDays
  );
  const ownerDigestSent = await sendOwnerDigest(dueForOwner);

  // submitter heartbeats: known address, not updated within the repeat window
  const userRepeatDays = fs.userUpdateRepeatDays();
  let heartbeats = 0;
  for (const f of open) {
    if (f.submitter_email && daysSince(f.last_user_notified_at) >= userRepeatDays) {
      if (await sendSubmitterHeartbeat(f)) heartbeats++;
    }
  }

  const result: SweepResult = {
    ownerRemindedCount: dueForOwner.length,
    ownerDigestSent,
    submitterHeartbeats: heartbeats,
    mailMode: mailConfigured() ? 'smtp' : 'console',
  };
  console.log(
    `[followup] sweep: owner=${result.ownerRemindedCount} (digest ${ownerDigestSent ? 'sent' : 'none'}), ` +
      `heartbeats=${heartbeats}, mail=${result.mailMode}`
  );
  return result;
}

let started = false;
export function startFollowupScheduler(): void {
  if (started) return;
  // The cron *cadence* is read once at startup (changing it needs a restart); the
  // enabled toggle and all thresholds are read live inside the sweep, so those take
  // effect immediately from the settings screen.
  const cronExpr = fs.cron() || config.followupCron;
  if (!cron.validate(cronExpr)) {
    console.warn(`[followup] invalid follow-up cron "${cronExpr}" — scheduler not started`);
    return;
  }
  cron.schedule(cronExpr, () => {
    runFollowupSweep().catch((e) => console.error('[followup] sweep failed:', e));
  }, { timezone: config.timezone });
  started = true;
  console.log(
    `[followup] scheduler on (${cronExpr} ${config.timezone}); ` +
      `mail=${mailConfigured() ? 'smtp' : 'console (no SMTP configured)'}`
  );
}
