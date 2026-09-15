import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import {
  addFeedback,
  addFeedbackUpdate,
  getFeedback,
  listFeedback,
  patchFeedback,
  videoPath,
} from '../feedback';
import { notifySubmitterOfUpdate, runFollowupSweep } from '../followup';
import {
  applySettings,
  getSettingsForUi,
  mailStatus,
  owner as ownerCfg,
  sync as syncCfg,
  display as displayCfg,
} from '../appSettings';
import { sendMail } from '../mailer';
import {
  BudgetMonth,
  flushDb,
  getBudgetsForYear,
  getDealsByYear,
  getMeta,
  getSetting,
  getYearsWithData,
  setBudgetsForYear,
} from '../db';
import { isSyncing, runSync } from '../sync';
import { getTdjpUpside, saveTdjpUpside } from '../tdjpUpside';

export const api = Router();

api.get('/deals', (req, res) => {
  const fallback = new Date().getFullYear();
  const year = parseInt(String(req.query.year ?? fallback), 10) || fallback;
  res.json({ year, deals: getDealsByYear(year) });
});

api.get('/meta', (_req, res) => {
  const meta = getMeta();
  const dataYears = getYearsWithData();
  const current = new Date().getFullYear();
  const avail = new Set<number>();
  for (let y = syncCfg.startYear() || config.syncStartYear; y <= current + 1; y++) avail.add(y);
  dataYears.forEach((y) => avail.add(y));
  res.json({
    ...meta,
    years: Array.from(avail).sort((a, b) => a - b),
    dataYears,
    defaultHiddenStages: syncCfg.excludedStages(),
    defaultTab: displayCfg.defaultTab(),
    defaultCurrency: displayCfg.defaultCurrency(),
    useMock: config.useMock,
    portalId: config.hubspotPortalId,
  });
});

api.get('/sync-status', (_req, res) => {
  res.json({
    syncing: isSyncing(),
    lastSyncAt: getSetting('last_sync_at'),
    status: getSetting('last_sync_status'),
    source: getSetting('last_sync_source'),
    error: getSetting('last_sync_error'),
  });
});

api.post('/refresh', async (_req, res) => {
  const result = await runSync();
  res.json(result);
});

// TDJP block 3 (manual upside), stored per year in our own database.
api.get('/tdjp-upside', async (req, res) => {
  const year = parseInt(String(req.query.year ?? config.tdjpUpsideYear), 10) || config.tdjpUpsideYear;
  res.json(await getTdjpUpside(year));
});

// Save the manual upside for a year (edited from the TDJP tab). Whole k-EUR values.
api.post('/tdjp-upside', async (req, res) => {
  try {
    const body = req.body || {};
    const year = parseInt(String(body.year), 10);
    if (!year) {
      res.status(400).json({ success: false, error: 'year is required' });
      return;
    }
    const saved = await saveTdjpUpside(year, body.rows);
    res.json({ success: true, ...saved });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Budget (total per month: revenue + margin, in euros). Maintained by the user
// in the Graphs tab's budget editor.
api.get('/budget', (req, res) => {
  const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10) || new Date().getFullYear();
  res.json({ year, months: getBudgetsForYear(year) });
});

api.post('/budget', async (req, res) => {
  const body = req.body || {};
  const year = parseInt(String(body.year), 10);
  if (!year) {
    res.status(400).json({ error: 'year is required' });
    return;
  }
  const months = (body.months || {}) as Record<string, BudgetMonth>;
  setBudgetsForYear(year, months);
  await flushDb(); // make sure the budget is persisted before we confirm
  res.json({ status: 'ok', year, months: getBudgetsForYear(year) });
});

// ---------- feedback / ideas (the 🐛 bubble) ----------

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 }, // ~40MB; a 1:30 clip at 800kbps is ~9MB
});

// Submit a new feedback/idea (optionally with a screen recording).
api.post('/feedback', uploadVideo.single('video'), async (req, res) => {
  try {
    const b = req.body || {};
    const durationRaw = parseInt(String(b.video_duration_seconds ?? ''), 10);
    const { id } = await addFeedback(
      {
        url: b.url,
        user_agent: req.headers['user-agent'] || '',
        viewport: b.viewport,
        user_text: b.text,
        transcript: b.transcript,
        video_duration_seconds: Number.isFinite(durationRaw) ? durationRaw : null,
        submitter_name: b.submitter_name,
        submitter_email: b.submitter_email,
      },
      req.file ? { buffer: req.file.buffer, ext: 'webm' } : undefined
    );
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// List all submissions (owner triage view — phase 2).
api.get('/feedback', async (_req, res) => {
  try {
    res.json({ items: await listFeedback() });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Triage a submission: change status / priority / internal notes (owner only — phase 2).
api.post('/feedback/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const row = await patchFeedback(id, {
      status: b.status,
      priority: b.priority,
      admin_notes: b.admin_notes,
    });
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ success: true, item: row });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Add an update note to a submission's timeline, optionally moving its status.
// A public update is what the submitter sees / is e-mailed about (phase 3).
api.post('/feedback/:id/update', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    if (!b.text || !String(b.text).trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const row = await addFeedbackUpdate(id, {
      text: String(b.text),
      author: b.author,
      visibility: b.visibility === 'internal' ? 'internal' : 'public',
      newStatus: b.status,
    });
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // Fire off the immediate submitter e-mail for a public update (best-effort,
    // never blocks the response; no-op when we don't have their address yet).
    const last = Array.isArray(row.updates) && row.updates.length ? row.updates[row.updates.length - 1] : null;
    if (last && last.visibility === 'public') {
      notifySubmitterOfUpdate(row, last).catch((e) =>
        console.error('[feedback] submitter notify failed:', (e as Error).message)
      );
    }
    res.json({ success: true, item: row });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Run the follow-up sweep on demand (owner digest + submitter heartbeats). Handy for
// testing the e-mail loop without waiting for the schedule.
api.post('/feedback-sweep', async (_req, res) => {
  try {
    const result = await runFollowupSweep();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ---------- application settings ----------

api.get('/settings', (_req, res) => {
  res.json({ settings: getSettingsForUi(), mail: mailStatus() });
});

api.post('/settings', async (req, res) => {
  try {
    const changed = applySettings((req.body && req.body.settings) || req.body || {});
    await flushDb(); // persist before confirming
    res.json({ success: true, changed, settings: getSettingsForUi(), mail: mailStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Send a one-off test e-mail so the owner can confirm the SMTP setup actually works.
// Returns the transport result INCLUDING the error text, so problems are visible in
// the UI instead of buried in the server log.
api.post('/mail-test', async (req, res) => {
  try {
    const to = (req.body && String(req.body.to || '').trim()) || ownerCfg.email();
    if (!to) {
      res.status(400).json({ success: false, error: 'no recipient (set an owner e-mail first)' });
      return;
    }
    const r = await sendMail({
      to,
      subject: '✅ Testmail — Terra Sales Dashboard',
      text:
        'Dit is een testbericht van het Terra Sales Dashboard.\n\n' +
        'Als je dit ontvangt, werkt de e-mailconfiguratie (SMTP) correct en ' +
        'kan de opvolg-loop reminders en updates versturen.\n\n— Terra Sales Dashboard',
    });
    res.json({ success: r.ok, mode: r.mode, error: r.error || null, to });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Stream a submission's recorded video.
api.get('/feedback/:id/video', async (req, res) => {
  const row = await getFeedback(parseInt(req.params.id, 10));
  const p = row && row.video_filename ? videoPath(row.video_filename) : null;
  if (!p) {
    res.status(404).end();
    return;
  }
  res.type('video/webm');
  res.sendFile(p);
});
