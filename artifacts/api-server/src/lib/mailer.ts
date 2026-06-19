import nodemailer from "nodemailer";
import { Resend } from "resend";
import { logger } from "./logger";

// ─── Brand constants ──────────────────────────────────────────────────────────
const BRAND_FROM = "Shane McCaw Consulting <noreply@shanemccaw.consulting>";
const PORTAL_URL = "https://shanemccaw.consulting/crm/portal";
const NAVY = "#0A2540";
const BLUE = "#0078D4";

// ─── HTML email wrapper ───────────────────────────────────────────────────────
export function brandedEmail(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Shane McCaw Consulting</title>
</head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:${NAVY};padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Shane McCaw Consulting</p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Lead Microsoft 365 Architect</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;color:#1e293b;font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f1f5f9;padding:20px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
              Shane McCaw Consulting LLC &nbsp;|&nbsp; <a href="https://shanemccaw.consulting" style="color:${BLUE};text-decoration:none;">shanemccaw.consulting</a><br/>
              You're receiving this because you have an account or made a purchase with us.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Button helper ────────────────────────────────────────────────────────────
export function emailButton(label: string, url: string): string {
  return `<p style="margin:24px 0 0;">
    <a href="${url}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">${label} →</a>
  </p>`;
}

// ─── Transport selection ──────────────────────────────────────────────────────
type Sender = (to: string, subject: string, html: string) => Promise<void>;

function getResendSender(): Sender | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM ?? BRAND_FROM;
  return async (to, subject, html) => {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message);
  };
}

function getSmtpSender(): Sender | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  const from = process.env.SMTP_FROM ?? `Shane McCaw Consulting <${user}>`;
  return async (to, subject, html) => {
    await transporter.sendMail({ from, to, subject, html });
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send an email. Prefers Resend when RESEND_API_KEY is set; falls back to
 * SMTP (SMTP_HOST / SMTP_USER / SMTP_PASS). Logs a warning and no-ops when
 * neither is configured.
 *
 * Pass raw body HTML — it will be wrapped in the branded template automatically
 * unless you pass `{ skipWrapper: true }`.
 */
export async function sendEmail(
  to: string,
  subject: string,
  bodyHtml: string,
  opts?: { skipWrapper?: boolean },
): Promise<void> {
  const sender = getResendSender() ?? getSmtpSender();
  if (!sender) {
    logger.warn({ to, subject }, "Email not sent — set RESEND_API_KEY (or SMTP_HOST/SMTP_USER/SMTP_PASS) to enable email");
    return;
  }
  const html = opts?.skipWrapper ? bodyHtml : brandedEmail(bodyHtml);
  try {
    await sender(to, subject, html);
    logger.info({ to, subject }, "Email sent");
  } catch (err) {
    logger.warn({ err, to, subject }, "Failed to send email");
  }
}

// ─── Named template helpers ───────────────────────────────────────────────────

export function purchaseConfirmationEmail(opts: {
  clientName: string;
  serviceName: string;
  amountDollars: string;
  portalPath?: string;
}): string {
  const link = opts.portalPath ? `${PORTAL_URL}${opts.portalPath}` : PORTAL_URL;
  return `
    <p>Hi ${opts.clientName || "there"},</p>
    <p>Thank you for your purchase — payment has been confirmed. Here's a summary:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Service</td><td style="padding:4px 0;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Amount paid</td><td style="padding:4px 0;font-weight:600;">$${opts.amountDollars} USD</td></tr>
    </table>
    <p>Shane will be in touch within <strong>1–2 business days</strong> to kick things off. In the meantime, you can check your project status in your client portal.</p>
    ${emailButton("View your portal", link)}
    <p style="margin-top:24px;">Questions? Just reply to this email or message Shane directly in the portal.</p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
}

export function onboardingConfirmationEmail(opts: {
  clientName: string;
  serviceName: string;
  amountDollars: string;
  projectId: number;
}): string {
  return `
    <p>Hi ${opts.clientName || "there"},</p>
    <p>Your payment is confirmed and your <strong>${opts.serviceName}</strong> project workspace has been created. Here's what happens next:</p>
    <ol style="padding-left:20px;line-height:2;">
      <li>Shane will reach out within <strong>1 business day</strong> to schedule your kickoff call.</li>
      <li>You'll receive access details and any prep materials before the call.</li>
      <li>Track every step of your project in real time in your portal.</li>
    </ol>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Service</td><td style="padding:4px 0;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Amount paid</td><td style="padding:4px 0;font-weight:600;">$${opts.amountDollars} USD</td></tr>
    </table>
    ${emailButton("View your project workspace", `${PORTAL_URL}/projects/${opts.projectId}`)}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
}

export function adminPurchaseAlertEmail(opts: {
  clientName: string;
  clientEmail: string;
  serviceName: string;
  amountDollars: string;
  type: "service_purchase" | "onboarding_purchase";
  projectId?: number;
}): string {
  const label = opts.type === "onboarding_purchase" ? "Onboarding purchase" : "Service purchase";
  const link = opts.type === "onboarding_purchase" && opts.projectId
    ? `${PORTAL_URL}/projects/${opts.projectId}`
    : `${PORTAL_URL}/dashboard`;
  return `
    <p>Hi Shane,</p>
    <p>A new <strong>${label}</strong> just came in:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Client</td><td style="padding:4px 0;font-weight:600;">${opts.clientName || opts.clientEmail}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;">${opts.clientEmail}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Service</td><td style="padding:4px 0;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Amount</td><td style="padding:4px 0;font-weight:600;">$${opts.amountDollars} USD</td></tr>
    </table>
    ${opts.type === "onboarding_purchase"
      ? "<p>The project workspace and workflow steps have been automatically created. Schedule the kickoff call when ready.</p>"
      : "<p>Please activate the service in the client's portal when you're ready to begin.</p>"
    }
    ${emailButton("View in dashboard", link)}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `;
}
