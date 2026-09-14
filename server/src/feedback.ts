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

export interface FeedbackRow extends FeedbackInput {
  id: number;
  created_at: string;
  video_filename: string | null;
  priority: string;
  status: string;
  status_changed_at: string | null;
  admin_notes: string;
  updates: any[];
  last_owner_reminded_at: string | null;
  last_user_notified_at: string | null;
}

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

/** Absolute path to a stored video, validated to stay inside the video dir. */
export function videoPath(filename: string): string | null {
  if (!filename) return null;
  const p = path.join(videoDir, path.basename(filename));
  if (!p.startsWith(videoDir)) return null;
  return fs.existsSync(p) ? p : null;
}
