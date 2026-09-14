import { Router } from 'express';
import { config } from '../config';
import {
  BudgetMonth,
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

api.post('/budget', (req, res) => {
  const body = req.body || {};
  const year = parseInt(String(body.year), 10);
  if (!year) {
    res.status(400).json({ error: 'year is required' });
    return;
  }
  const months = (body.months || {}) as Record<string, BudgetMonth>;
  setBudgetsForYear(year, months);
  res.json({ status: 'ok', year, months: getBudgetsForYear(year) });
});
