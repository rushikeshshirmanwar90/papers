import nodemailer, { type Transporter } from "nodemailer";
import { HttpError } from "@/lib/http";

// Sends email through the SMTP server in the environment:
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" only for port 465),
//   SMTP_USER, SMTP_PASS (for Gmail, an app password), MAIL_FROM_NAME.
// Certificates are always checked: the login and codes travel over TLS.

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    console.error("[mail] SMTP_USER or SMTP_PASS is missing");
    throw new HttpError(503, "Email isn't set up on the server yet.");
  }
  const port = Number(SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port,
    // 465 is TLS from the start; 587 upgrades with STARTTLS, which is required.
    secure: SMTP_SECURE === "true" || port === 465,
    requireTLS: port !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one email; a failure becomes a 502 the app can show. */
export async function sendMail(mail: Mail) {
  const from = `"${process.env.MAIL_FROM_NAME || "PCMB Paper"}" <${process.env.SMTP_USER}>`;
  try {
    await getTransporter().sendMail({ from, ...mail });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("[mail] sending failed:", error);
    throw new HttpError(502, "We couldn't send the email just now. Try again in a minute.");
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An email carrying a one-time code, in plain text and simple HTML. */
export function codeEmail({ name, title, intro, code, minutes }: { name: string; title: string; intro: string; code: string; minutes: number }) {
  const app = process.env.MAIL_FROM_NAME || "PCMB Paper";
  const text = `Hi ${name},\n\n${intro}\n\n${code}\n\nThe code works for ${minutes} minutes. If you didn't ask for it, ignore this email; nothing changes.\n\n${app}`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#23262d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e3e6ec;border-radius:12px">
        <tr><td style="padding:28px 28px 8px">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7280">${escape(app)}</p>
          <h1 style="margin:0;font-size:22px;line-height:1.3">${escape(title)}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 4px;font-size:15px;line-height:1.55">
          <p style="margin:0 0 12px">Hi ${escape(name)},</p>
          <p style="margin:0">${escape(intro)}</p>
        </td></tr>
        <tr><td align="center" style="padding:20px 28px">
          <div style="display:inline-block;padding:14px 22px;border:2px dashed #c5603f;border-radius:10px;font-size:32px;font-weight:700;letter-spacing:8px;color:#23262d">${escape(code)}</div>
        </td></tr>
        <tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.5;color:#6b7280">
          The code works for ${minutes} minutes. If you didn't ask for it, ignore this email; nothing changes.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { html, text };
}
