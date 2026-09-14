import nodemailer, { Transporter } from 'nodemailer';
import { config } from './config';
import { followup as fs, owner as ownerCfg } from './appSettings';

// Thin e-mail helper for the follow-up loop (phase 3).
//
// Uses the same route TerraFlow uses: Gmail SMTP with an app-password (see config).
// When no SMTP credentials are configured it falls back to "console" mode — it logs
// the message it *would* send and reports success — so local dev and the JSON backend
// keep working without any mail setup. Nothing here ever throws into the request path.

let transporter: Transporter | null = null;
let triedInit = false;

export function mailConfigured(): boolean {
  return !!(config.smtpUser && config.smtpPass);
}

function getTransport(): Transporter | null {
  if (triedInit) return transporter;
  triedInit = true;
  if (!mailConfigured()) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure, // false for 587 (STARTTLS)
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface MailResult {
  ok: boolean;
  mode: 'sent' | 'console' | 'error';
  error?: string;
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const from = fs.mailFrom() || config.mailFrom || config.smtpUser;
  const t = getTransport();

  if (!t || !from) {
    // Console mode — safe no-op that shows what would have gone out.
    console.log(
      `[mailer:console] (no SMTP configured) → to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`
    );
    return { ok: true, mode: 'console' };
  }

  try {
    await t.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo: msg.replyTo || ownerCfg.email() || config.ownerEmail || undefined,
    });
    return { ok: true, mode: 'sent' };
  } catch (e) {
    console.error('[mailer] send failed:', (e as Error).message);
    return { ok: false, mode: 'error', error: (e as Error).message };
  }
}

// Minimal HTML escaping for values we drop into e-mail bodies.
export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
