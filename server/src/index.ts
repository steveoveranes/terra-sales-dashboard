import express from 'express';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { config } from './config';
import { initDb, flushDb, getYearsWithData } from './db';
import { api } from './routes/api';
import { runSync } from './sync';
import { startFollowupScheduler } from './followup';
import { sync as syncCfg, yearsToSyncEff } from './appSettings';

async function main() {
  await initDb(); // connect the store (JSON or Postgres) and load data into memory

  const app = express();
  app.use(express.json());
  app.use('/api', api);

  // Serve the built frontend (when present) with SPA fallback.
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  // First-run sync so there is always something to show.
  if (getYearsWithData().length === 0) {
    runSync()
      .then((r) => console.log('[startup sync]', r.status, '-', r.message))
      .catch((e) => console.error('[startup sync] failed', e));
  }

  // Scheduled sync. The cadence is read once at startup (the watcher restarts on
  // every rebuild, so a change from the Settings screen applies on the next build).
  const syncCron = syncCfg.cron() || config.syncCron;
  if (cron.validate(syncCron)) {
    cron.schedule(syncCron, () => {
      runSync()
        .then((r) => console.log('[scheduled sync]', r.status, '-', r.message))
        .catch((e) => console.error('[scheduled sync] failed', e));
    });
    console.log(`[scheduler] auto-sync scheduled: ${syncCron}`);
  } else {
    console.warn(`[scheduler] invalid sync cron "${syncCron}", auto-sync disabled`);
  }

  // Ideas & feedback follow-up loop (owner reminders + submitter updates).
  startFollowupScheduler();

  // Persist any pending writes on shutdown.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      flushDb()
        .catch((e) => console.error('[db] shutdown flush failed', e))
        .finally(() => process.exit(0));
    });
  }

  app.listen(config.port, () => {
    console.log(
      `Terra Sales Dashboard: http://localhost:${config.port}  (data source: ${
        config.useMock ? 'MOCK sample data' : 'HubSpot'
      }, years: ${yearsToSyncEff().join(', ')})`
    );
  });
}

main().catch((e) => {
  console.error('[startup] fatal', e);
  process.exit(1);
});
