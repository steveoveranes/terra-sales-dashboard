import fs from 'fs';
import path from 'path';
import { config } from './config';
import { getBackend, getPool } from './db';

// Feedback / ideas submissions from the 🐛 bubble.
//
// This is append-mostly data (it grows), so it is NOT kept in the main in-memory
// store. Instead:
//   - PostgreSQL  → its own `feedback` table, accessed directly via the pool.
//   - local JSON  → a `feedback.json` file in DATA_DIR.
// Recorded videos are written to DATA_DIR/uploads/feedback/<file>.webm in both modes.
//
// The row shape is already "follow-up ready" (status, status_changed_at, updates log,
// submitter fields, reminder timestamps) so phases 2 (owner triage) and 3 (e-mail
// follow-up loop) need no migration.

export interface FeedbackInput {
  url?: string;
  user_agent?: string;
  viewport?: string;
  user_text?: string;
  transcript?: string;
  video_duration_seconds?: number | null;
  submitter_name?: string;
  submitter_email?: string;
  submitter_user_id?: string;
}

export interface FeedbackUpdate {
  at: string; // ISO timestamp
  author: string; // who wrote it (e.g. "Steven")
  text: string; // the note
  visibility: 'public' | 'internal'; // public updates are shown/emailed to the submitter
  status?: string; // the status this update moved the item to, if any
}

export interface FeedbackRow extends FeedbackInput {
  id: number;
  created_at: string;
  video_filename: string | null;
  priority: string;
  status: string;
  status_changed_at: string | null;
  admin_notes: string;
  updates: FeedbackUpdate[];
  last_owner_reminded_at: string | null;
  last_user_notified_at: string | null;
}

// Allowed lifecycle states and priorities (kept in sync with the triage UI).
export const FEEDBACK_STATUSES = ['open', 'planned', 'in_progress', 'done', 'declined'] as const;
export const FEEDBACK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

const videoDir = path.join(config.dataDir, 'uploads', 'feedback');
const jsonFile = path.join(config.dataDir, 'feedback.json');
fs.mkdirSync(videoDir, { recursive: true });

let pgReady = false;
async function ensurePgSchema(): Promise<void> {
  if (pgReady) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      url text NOT NULL DEFAULT '',
      user_agent text NOT NULL DEFAULT '',
      viewport text NOT NULL DEFAULT '',
      user_text text NOT NULL DEFAULT '',
      transcript text NOT NULL DEFAULT '',
      video_filename text,
      video_duration_seconds int,
      submitter_name text NOT NULL DEFAULT '',
      submitter_email text NOT NULL DEFAULT '',
      submitter_user_id text NOT NULL DEFAULT '',
      priority text NOT NULL DEFAULT 'normal',
      status text NOT NULL DEFAULT 'open',
      status_changed_at timestamptz,
      admin_notes text NOT NULL DEFAULT '',
      updates jsonb NOT NULL DEFAULT '[]'::jsonb,
      last_owner_reminded_at timestamptz,
      last_user_notified_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);
  `);
  pgReady = true;
}

function loadJson(): FeedbackRow[] {
  try {
    return JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  } catch {
    return [];
  }
}
function saveJson(rows: FeedbackRow[]): void {
  const tmp = jsonFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows));
  fs.renameSync(tmp, jsonFile);
}

function safeVideoName(ext = 'webm'): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext.replace(/[^a-z0-9]/gi, '') || 'webm'}`;
}

export async function addFeedback(
  input: FeedbackInput,
  video?: { buffer: Buffer; ext?: string }
): Promise<{ id: number }> {
  let video_filename: string | null = null;
  if (video && video.buffer && video.buffer.length) {
    video_filename = safeVideoName(video.ext);
    fs.writeFileSync(path.join(videoDir, video_filename), video.buffer);
  }
  const now = new Date().toISOString();
  const base = {
    url: (input.url || '').slice(0, 500),
    user_agent: (input.user_agent || '').slice(0, 500),
    viewport: (input.viewport || '').slice(0, 50),
    user_text: input.user_text || '',
    transcript: input.transcript || '',
    video_filename,
    video_duration_seconds: input.video_duration_seconds ?? null,
    submitter_name: input.submitter_name || '',
    submitter_email: input.submitter_email || '',
    submitter_user_id: input.submitter_user_id || '',
  };

  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    const r = await pool.query(
      `INSERT INTO feedback
        (url, user_agent, viewport, user_text, transcript, video_filename,
         video_duration_seconds, submitter_name, submitter_email, submitter_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        base.url, base.user_agent, base.viewport, base.user_text, base.transcript,
        base.video_filename, base.video_duration_seconds, base.submitter_name,
        base.submitter_email, base.submitter_user_id,
      ]
    );
    return { id: Number(r.rows[0].id) };
  }

  // JSON backend
  const rows = loadJson();
  const id = rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  const row: FeedbackRow = {
    id,
    created_at: now,
    priority: 'normal',
    status: 'open',
    status_changed_at: null,
    admin_notes: '',
    updates: [],
    last_owner_reminded_at: null,
    last_user_notified_at: null,
    ...base,
  };
  rows.push(row);
  saveJson(rows);
  return { id };
}

export async function listFeedback(): Promise<FeedbackRow[]> {
  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    const r = await pool.query('SELECT * FROM feedback ORDER BY created_at DESC');
    return r.rows as FeedbackRow[];
  }
  return loadJson().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function getFeedback(id: number): Promise<FeedbackRow | null> {
  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    const r = await pool.query('SELECT * FROM feedback WHERE id = $1', [id]);
    return (r.rows[0] as FeedbackRow) || null;
  }
  return loadJson().find((x) => Number(x.id) === Number(id)) || null;
}

// ---------- triage mutations (phase 2) ----------

export interface FeedbackPatch {
  status?: string;
  priority?: string;
  admin_notes?: string;
}

/** Update the triage fields of one item. Bumps status_changed_at when the status
 *  actually changes. Returns the updated row (or null if not found). */
export async function patchFeedback(id: number, patch: FeedbackPatch): Promise<FeedbackRow | null> {
  const current = await getFeedback(id);
  if (!current) return null;

  const nextStatus =
    patch.status && FEEDBACK_STATUSES.includes(patch.status as FeedbackStatus) ? patch.status : current.status;
  const nextPriority =
    patch.priority && FEEDBACK_PRIORITIES.includes(patch.priority as FeedbackPriority)
      ? patch.priority
      : current.priority;
  const nextNotes = patch.admin_notes !== undefined ? patch.admin_notes : current.admin_notes;
  const statusChanged = nextStatus !== current.status;
  const statusChangedAt = statusChanged ? new Date().toISOString() : current.status_changed_at;

  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    const r = await pool.query(
      `UPDATE feedback
         SET status = $2, priority = $3, admin_notes = $4, status_changed_at = $5
       WHERE id = $1
       RETURNING *`,
      [id, nextStatus, nextPriority, nextNotes, statusChangedAt]
    );
    return (r.rows[0] as FeedbackRow) || null;
  }

  const rows = loadJson();
  const row = rows.find((x) => Number(x.id) === Number(id));
  if (!row) return null;
  row.status = nextStatus;
  row.priority = nextPriority;
  row.admin_notes = nextNotes;
  row.status_changed_at = statusChangedAt;
  saveJson(rows);
  return row;
}

/** Append an update note to an item's timeline. If newStatus is given, also moves
 *  the item to that status. A public update is what the submitter sees / is e-mailed
 *  about (phase 3). Returns the updated row (or null if not found). */
export async function addFeedbackUpdate(
  id: number,
  input: { text: string; author?: string; visibility?: 'public' | 'internal'; newStatus?: string }
): Promise<FeedbackRow | null> {
  const current = await getFeedback(id);
  if (!current) return null;

  const now = new Date().toISOString();
  const nextStatus =
    input.newStatus && FEEDBACK_STATUSES.includes(input.newStatus as FeedbackStatus)
      ? input.newStatus
      : current.status;
  const statusChanged = nextStatus !== current.status;
  const entry: FeedbackUpdate = {
    at: now,
    author: (input.author || 'Steven').slice(0, 120),
    text: (input.text || '').slice(0, 4000),
    visibility: input.visibility === 'internal' ? 'internal' : 'public',
    ...(statusChanged ? { status: nextStatus } : {}),
  };

  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    const r = await pool.query(
      `UPDATE feedback
         SET updates = COALESCE(updates, '[]'::jsonb) || $2::jsonb,
             status = $3,
             status_changed_at = CASE WHEN $4 THEN $5 ELSE status_changed_at END
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify([entry]), nextStatus, statusChanged, now]
    );
    return (r.rows[0] as FeedbackRow) || null;
  }

  const rows = loadJson();
  const row = rows.find((x) => Number(x.id) === Number(id));
  if (!row) return null;
  row.updates = Array.isArray(row.updates) ? row.updates : [];
  row.updates.push(entry);
  row.status = nextStatus;
  if (statusChanged) row.status_changed_at = now;
  saveJson(rows);
  return row;
}

// ---------- follow-up bookkeeping (phase 3) ----------

/** Mark that the owner was reminded about these items just now. */
export async function markOwnerReminded(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    await pool.query(`UPDATE feedback SET last_owner_reminded_at = $2 WHERE id = ANY($1)`, [ids, now]);
    return;
  }
  const rows = loadJson();
  const set = new Set(ids.map(Number));
  for (const r of rows) if (set.has(Number(r.id))) r.last_owner_reminded_at = now;
  saveJson(rows);
}

/** Mark that the submitter of an item was notified just now. */
export async function markUserNotified(id: number): Promise<void> {
  const now = new Date().toISOString();
  if (getBackend() === 'pg') {
    await ensurePgSchema();
    const pool = getPool()!;
    await pool.query(`UPDATE feedback SET last_user_notified_at = $2 WHERE id = $1`, [id, now]);
    return;
  }
  const rows = loadJson();
  const r = rows.find((x) => Number(x.id) === Number(id));
  if (r) {
    r.last_user_notified_at = now;
    saveJson(rows);
  }
}

/** Absolute path to a stored video, validated to stay inside the video dir. */
export function videoPath(filename: string): string | null {
  if (!filename) return null;
  const p = path.join(videoDir, path.basename(filename));
  if (!p.startsWith(videoDir)) return null;
  return fs.existsSync(p) ? p : null;
}
