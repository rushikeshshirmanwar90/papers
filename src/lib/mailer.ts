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

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Welcome email for an admin-created student account. */
export function studentWelcomeEmail(opts: {
  studentName: string;
  tuitionName: string;
  email: string;
  password: string;
  batchStatus: "enrolled" | "approval" | "pending";
  batchName?: string;
}): Mail {
  const { studentName, tuitionName, email: studentEmail, password, batchStatus, batchName } = opts;

  const batchLine =
    batchStatus === "enrolled"
      ? `You have been enrolled in ${escape(batchName ?? "")}.`
      : batchStatus === "approval"
        ? `Your enrollment in ${escape(batchName ?? "")} is awaiting approval from the administration.`
        : "Your account has been created successfully. Your batch will be assigned by the administration shortly.";

  const batchText =
    batchStatus === "enrolled"
      ? `You have been enrolled in ${batchName ?? ""}.`
      : batchStatus === "approval"
        ? `Your enrollment in ${batchName ?? ""} is awaiting approval from the administration.`
        : "Your account has been created successfully. Your batch will be assigned by the administration shortly.";

  const subject = `Welcome to ${tuitionName} — Your Student Account Is Ready`;

  const text = `Hello ${studentName},

Welcome to ${tuitionName}!

Your student account has been created successfully by the administration of ${tuitionName}.

You can now sign in to TuitionApp using the following details:

Login Email: ${studentEmail}
Initial Password: ${password}

For your security, you will be asked to create a new password when you sign in for the first time.

Getting Started:

1. Open the TuitionApp application.
2. Sign in using the email and initial password above.
3. Create your new password when prompted.
4. Continue to your student dashboard.

${batchText}

Please keep your login information confidential.

If you were not expecting this account, please contact the administration of ${tuitionName}.

We look forward to supporting your learning journey.

Best regards,
${tuitionName}
Administration Team`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#23262d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e6ec;border-radius:12px">
        <tr><td style="padding:28px 28px 8px">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7280">${escape(tuitionName)}</p>
          <h1 style="margin:0;font-size:22px;line-height:1.3">Welcome to ${escape(tuitionName)}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 4px;font-size:15px;line-height:1.55">
          <p style="margin:0 0 12px">Hello ${escape(studentName)},</p>
          <p style="margin:0 0 12px">Your student account has been created by the administration of ${escape(tuitionName)}. Sign in with the details below:</p>
        </td></tr>
        <tr><td style="padding:0 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f5;border:1px solid #e3e6ec;border-radius:8px">
            <tr><td style="padding:16px">
              <p style="margin:0 0 8px;font-size:13px;color:#6b7280">Login Email</p>
              <p style="margin:0 0 16px;font-size:15px;font-weight:700">${escape(studentEmail)}</p>
              <p style="margin:0 0 8px;font-size:13px;color:#6b7280">Initial Password</p>
              <p style="margin:0;font-size:15px;font-weight:700;letter-spacing:1px">${escape(password)}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 4px;font-size:14px;line-height:1.5;color:#c5603f;font-weight:600">
          You will be asked to create a new password when you sign in for the first time.
        </td></tr>
        <tr><td style="padding:12px 28px;font-size:14px;line-height:1.55">
          <p style="margin:0 0 8px;font-weight:600">Getting Started</p>
          <ol style="margin:0;padding-left:20px">
            <li>Open the TuitionApp application.</li>
            <li>Sign in using the email and initial password above.</li>
            <li>Create your new password when prompted.</li>
            <li>Continue to your student dashboard.</li>
          </ol>
        </td></tr>
        <tr><td style="padding:12px 28px;font-size:14px;line-height:1.55">
          <p style="margin:0;padding:12px;background:#f0fdf4;border-radius:8px;color:#166534">${batchLine}</p>
        </td></tr>
        <tr><td style="padding:12px 28px 28px;font-size:13px;line-height:1.5;color:#6b7280">
          <p style="margin:0 0 8px">Please keep your login information confidential.</p>
          <p style="margin:0 0 8px">If you were not expecting this account, please contact the administration of ${escape(tuitionName)}.</p>
          <p style="margin:0">Best regards,<br>${escape(tuitionName)} Administration Team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { to: studentEmail, subject, html, text };
}

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
