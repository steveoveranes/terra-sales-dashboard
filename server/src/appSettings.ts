import { config } from './config';
import { getSetting, setSetting } from './db';

// Editable application settings, layered over the key/value settings store.
//
// These are OPERATIONAL / BUSINESS settings that it is safe to expose in a UI and
// change at runtime. Each has an env-based default (so nothing breaks if the store is
// empty); a stored value overrides the default. Consumers read them through the typed
// getters below, so a change takes effect on the next sweep/request without a restart.
//
// SECRETS ARE DELIBERATELY NOT HERE. SMTP password, HubSpot token and DATABASE_URL
// stay in .env only and are never returned to or writable from the browser.

export type SettingType = 'string' | 'int' | 'bool' | 'enum';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: SettingType;
  default: string;
  help?: string;
  advanced?: boolean;
  options?: SettingOption[]; // for type 'enum'
}

// Registry. `default` is always kept as a string; typed getters cast it.
export const SETTING_DEFS: SettingDef[] = [
  // --- Ideas & feedback follow-up ---
  {
    key: 'followup.owner_email',
    label: 'Owner e-mail',
    group: 'Ideas & feedback',
    type: 'string',
    default: config.ownerEmail,
    help: 'Where reminders about waiting ideas are sent.',
  },
  {
    key: 'followup.owner_name',
    label: 'Owner name',
    group: 'Ideas & feedback',
    type: 'string',
    default: config.ownerName,
    help: 'Used to address the reminder e-mails.',
  },
  {
    key: 'followup.enabled',
    label: 'Follow-up e-mails enabled',
    group: 'Ideas & feedback',
    type: 'bool',
    default: config.followupEnabled ? '1' : '0',
    help: 'Master switch for the whole reminder/notification loop.',
  },
  {
    key: 'followup.owner_reminder_workdays',
    label: 'Nudge after (working days)',
    group: 'Ideas & feedback',
    type: 'int',
    default: String(config.ownerReminderWorkdays),
    help: 'Remind the owner once an open idea has waited more than this many working days.',
  },
  {
    key: 'followup.owner_reminder_repeat_days',
    label: 'Repeat reminder every (days)',
    group: 'Ideas & feedback',
    type: 'int',
    default: String(config.ownerReminderRepeatDays),
    help: 'How often to nudge the owner again about the same still-open idea.',
  },
  {
    key: 'followup.owner_escalate_workdays',
    label: 'Escalate after (working days)',
    group: 'Ideas & feedback',
    type: 'int',
    default: String(config.ownerEscalateWorkdays),
    help: 'Ideas open longer than this are flagged URGENT in the digest.',
  },
  {
    key: 'followup.user_update_repeat_days',
    label: 'Keep submitter posted every (days)',
    group: 'Ideas & feedback',
    type: 'int',
    default: String(config.userUpdateRepeatDays),
    help: 'Send the submitter a progress heartbeat at least this often (once we have their address).',
  },
  {
    key: 'followup.app_base_url',
    label: 'Dashboard URL',
    group: 'Ideas & feedback',
    type: 'string',
    default: config.appBaseUrl,
    help: 'Public URL used for the "open triage view" links in e-mails.',
  },
  {
    key: 'followup.mail_from',
    label: 'Send-from address',
    group: 'Ideas & feedback',
    type: 'string',
    default: config.mailFrom,
    help: 'From-address on outgoing e-mails. With Gmail this must equal the SMTP user.',
    advanced: true,
  },
  {
    key: 'followup.cron',
    label: 'Follow-up schedule (cron)',
    group: 'Ideas & feedback',
    type: 'string',
    default: config.followupCron,
    help: 'When the follow-up sweep runs. Default: weekdays 08:00.',
    advanced: true,
  },

  // --- Sync / data ---
  {
    key: 'sync.start_year',
    label: 'First year to sync',
    group: 'Data & sync',
    type: 'int',
    default: String(config.syncStartYear),
    help: 'Earliest year pulled from HubSpot. Everything from here up to next year is synced. Applies on the next sync.',
  },
  {
    key: 'sync.excluded_stage_labels',
    label: 'Hidden deal stages',
    group: 'Data & sync',
    type: 'string',
    default: config.excludedStageLabels.join(', '),
    help: 'Comma-separated stage names hidden by default (e.g. suspect, closed lost). Applies on the next page load.',
  },
  {
    key: 'sync.cron',
    label: 'HubSpot sync schedule (cron)',
    group: 'Data & sync',
    type: 'string',
    default: config.syncCron,
    help: 'How often the dashboard pulls fresh deals from HubSpot. Default: hourly. Applies after the next restart.',
    advanced: true,
  },

  // --- Display ---
  {
    key: 'display.default_tab',
    label: 'Default tab on open',
    group: 'Display',
    type: 'enum',
    default: 'monthly',
    options: [
      { value: 'monthly', label: 'Monthly overview' },
      { value: 'graphs', label: 'Graphs' },
      { value: 'tdjp', label: 'TDJP Input Format' },
      { value: 'raw', label: 'Raw HubSpot data' },
      { value: 'ideas', label: 'Ideas & feedback' },
    ],
    help: 'Which tab opens first when someone loads the dashboard (a ?tab= link still wins).',
  },
  {
    key: 'display.default_currency',
    label: 'Default currency (TDJP)',
    group: 'Display',
    type: 'enum',
    default: 'eur',
    options: [
      { value: 'eur', label: 'EUR (€)' },
      { value: 'usd', label: 'USD ($)' },
      { value: 'jpy', label: 'JPY (¥)' },
    ],
    help: 'Currency the TDJP Input Format tab shows by default.',
  },
];

const BY_KEY: Record<string, SettingDef> = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d]));

function raw(key: string): string {
  const def = BY_KEY[key];
  const stored = getSetting(key);
  return stored !== null && stored !== undefined ? stored : def ? def.default : '';
}

export function settingStr(key: string): string {
  return raw(key);
}
export function settingInt(key: string): number {
  const n = parseInt(raw(key), 10);
  const def = BY_KEY[key];
  return Number.isFinite(n) ? n : def ? parseInt(def.default, 10) || 0 : 0;
}
export function settingBool(key: string): boolean {
  const v = raw(key).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Typed getters used by the follow-up loop.
export const owner = {
  email: () => settingStr('followup.owner_email'),
  name: () => settingStr('followup.owner_name'),
};
export const followup = {
  enabled: () => settingBool('followup.enabled'),
  reminderWorkdays: () => settingInt('followup.owner_reminder_workdays'),
  reminderRepeatDays: () => settingInt('followup.owner_reminder_repeat_days'),
  escalateWorkdays: () => settingInt('followup.owner_escalate_workdays'),
  userUpdateRepeatDays: () => settingInt('followup.user_update_repeat_days'),
  appBaseUrl: () => settingStr('followup.app_base_url').replace(/\/+$/, ''),
  mailFrom: () => settingStr('followup.mail_from'),
  cron: () => settingStr('followup.cron'),
};

export const sync = {
  startYear: () => settingInt('sync.start_year'),
  cron: () => settingStr('sync.cron'),
  excludedStages: () =>
    settingStr('sync.excluded_stage_labels')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
};

export const display = {
  defaultTab: () => settingStr('display.default_tab'),
  defaultCurrency: () => settingStr('display.default_currency'),
};

/** Years to sync, honouring the editable start-year setting (and any env override).
 *  Recomputed each call so the range grows automatically into the new year. */
export function yearsToSyncEff(): number[] {
  if (config.syncYearsOverride && config.syncYearsOverride.length) return config.syncYearsOverride;
  const start = sync.startYear() || config.syncStartYear;
  const end = new Date().getFullYear() + 1;
  const years: number[] = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

// ---- UI plumbing ----

export interface UiSetting extends SettingDef {
  value: string;
}

/** All editable settings with their current (stored-or-default) values, for the UI. */
export function getSettingsForUi(): UiSetting[] {
  return SETTING_DEFS.map((d) => ({ ...d, value: raw(d.key) }));
}

/** Apply a patch of {key: value} from the settings screen. Unknown keys are ignored;
 *  values are coerced/validated by declared type. Returns the keys actually changed. */
export function applySettings(patch: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const [key, val] of Object.entries(patch || {})) {
    const def = BY_KEY[key];
    if (!def) continue;
    let str: string;
    if (def.type === 'bool') {
      const b =
        val === true ||
        val === 1 ||
        ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase());
      str = b ? '1' : '0';
    } else if (def.type === 'int') {
      const n = parseInt(String(val), 10);
      if (!Number.isFinite(n)) continue;
      str = String(n);
    } else if (def.type === 'enum') {
      str = String(val ?? '').trim();
      if (def.options && !def.options.some((o) => o.value === str)) continue; // reject unknown option
    } else {
      str = String(val ?? '').trim();
    }
    setSetting(key, str);
    changed.push(key);
  }
  return changed;
}

/** Non-secret status of the mail transport, for display on the settings screen. */
export function mailStatus(): { configured: boolean; host: string; user: string } {
  return {
    configured: !!(config.smtpUser && config.smtpPass),
    host: config.smtpHost,
    // show only the account, never the password
    user: config.smtpUser ? config.smtpUser : '(not set)',
  };
}
