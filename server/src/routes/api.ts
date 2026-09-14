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
import { getTdjpUpside } from '../tdjpUpside';

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
  for (let y = config.syncStartYear; y <= current + 1; y++) avail.add(y);
  dataYears.forEach((y) => avail.add(y));
  res.json({
    ...meta,
    years: Array.from(avail).sort((a, b) => a - b),
    dataYears,
    defaultHiddenStages: config.excludedStageLabels,
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

// TDJP block 3 (manual upside), read live from the published sheet CSV.
api.get('/tdjp-upside', async (req, res) => {
  const force = req.query.force === '1';
  res.json(await getTdjpUpside(force));
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
    res.json({ success: true, item: row });
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
