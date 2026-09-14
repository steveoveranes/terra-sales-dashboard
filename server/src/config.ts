import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .env automatically (does not override variables already set, e.g. by Docker).
// Tries current working dir, the server folder, and the project root.
dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function list(v: string | undefined, fallback: string): string[] {
  return (v ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 8080),
  dataDir: DATA_DIR,
  dbPath: process.env.DATABASE_PATH || path.join(DATA_DIR, 'app.db'),

  // Persistence. When DATABASE_URL is set, the app stores its data in PostgreSQL
  // (production: a dedicated database on the shared Postgres server). When it is
  // empty, it falls back to a local JSON file in DATA_DIR (zero-config local dev).
  databaseUrl: process.env.DATABASE_URL || '',

  hubspotToken: process.env.HUBSPOT_TOKEN || '',
  hubspotPortalId: process.env.HUBSPOT_PORTAL_ID || '2372383',

  // First year the dashboard covers. Everything from here up to (current year + 1)
  // is synced, so a new year becomes available automatically on 1 January.
  syncStartYear: Number(process.env.SYNC_START_YEAR || 2024),

  // Optional explicit override (comma separated) via SYNC_YEARS_OVERRIDE. When
  // unset, the dynamic range syncStartYear .. (current year + 1) is used — see
  // yearsToSync(). (The legacy SYNC_YEARS variable is intentionally ignored so the
  // dynamic range always applies unless you explicitly opt out.)
  syncYearsOverride: process.env.SYNC_YEARS_OVERRIDE
    ? list(process.env.SYNC_YEARS_OVERRIDE, '')
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n))
    : null,

  pipelineIds: list(process.env.PIPELINE_IDS, 'default,11366959,148764192,691243093,2372383,4371268'),

  excludedStageLabels: list(process.env.EXCLUDED_STAGE_LABELS, 'suspect,closed lost').map((s) =>
    s.toLowerCase()
  ),

  syncCron: process.env.SYNC_CRON || '0 * * * *',

  // Business timezone. Year boundaries for the close-date fetch are taken at LOCAL
  // midnight in this zone (not UTC midnight), matching the old Google Sheet script,
  // so a deal closing on 1 Jan local time (stored by HubSpot as 31 Dec 23:00 UTC)
  // still counts in the new year.
  timezone: process.env.SYNC_TIMEZONE || 'Europe/Amsterdam',

  // TDJP block 3 (manual "upside") is maintained by hand in the Google Sheet's
  // "TDJP Input Format" tab, published to the web as CSV. The dashboard reads the
  // leaf-row upside from there live (on refresh) and computes the subtotals itself.
  // The upside applies to tdjpUpsideYear (the sheet is a single forecast year).
  tdjpUpsideCsvUrl:
    process.env.TDJP_UPSIDE_CSV_URL ||
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vSf2vYlszOIBn3K7zr8zEBo5kI9TZhv5bUnZ9WrwndqbKCe6ZEuSKbo7lRvnnMBztlrDQuEtWoJyQO6/pub?gid=680866131&single=true&output=csv',
  tdjpUpsideYear: Number(process.env.TDJP_UPSIDE_YEAR || 2026),

  // Use mock data when explicitly requested, or when there is no token to call HubSpot with.
  useMock: process.env.USE_MOCK === '1' || !process.env.HUBSPOT_TOKEN,

  webDist: process.env.WEB_DIST || path.join(__dirname, '..', 'web-dist'),

  // ---- Follow-up e-mail (the 🐛 idea/feedback loop, phase 3) ----
  // Reuses the same route TerraFlow uses: Gmail SMTP (smtp.gmail.com:587, STARTTLS)
  // with a Gmail app-password. Put the same credentials TerraFlow uses in .env.
  // When SMTP_USER/SMTP_PASS are empty the mailer runs in "console" mode: it logs
  // what it *would* send instead of sending (safe local dev, mirrors Django's
  // console EmailBackend default).
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === '1', // false → STARTTLS on 587
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  // Envelope From. Defaults to the SMTP user (Gmail requires From == authenticated user).
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  // Where owner reminders ("idea X of person Y has waited N days") are sent.
  ownerEmail: process.env.OWNER_EMAIL || 'sverver@terra-inspectioneering.com',
  ownerName: process.env.OWNER_NAME || 'Steven',
  // Public URL of the dashboard, used to deep-link into the triage view from e-mails.
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  // Follow-up scheduler cadence and thresholds.
  followupCron: process.env.FOLLOWUP_CRON || '0 8 * * 1-5', // weekdays 08:00 (business tz)
  followupEnabled: process.env.FOLLOWUP_ENABLED !== '0', // on by default
  ownerReminderWorkdays: Number(process.env.OWNER_REMINDER_WORKDAYS || 3), // nudge after > N workdays open
  ownerReminderRepeatDays: Number(process.env.OWNER_REMINDER_REPEAT_DAYS || 7), // then weekly
  ownerEscalateWorkdays: Number(process.env.OWNER_ESCALATE_WORKDAYS || 10), // flag as urgent beyond this
  userUpdateRepeatDays: Number(process.env.USER_UPDATE_REPEAT_DAYS || 7), // keep submitter posted ≥ weekly
};

export type Config = typeof config;

/**
 * Years to sync, recomputed on every call so the range grows automatically at the
 * start of a new year. Uses the explicit override when set, otherwise
 * syncStartYear .. (current year + 1).
 */
export function yearsToSync(): number[] {
  if (config.syncYearsOverride && config.syncYearsOverride.length) return config.syncYearsOverride;
  const end = new Date().getFullYear() + 1;
  const years: number[] = [];
  for (let y = config.syncStartYear; y <= end; y++) years.push(y);
  return years;
}
