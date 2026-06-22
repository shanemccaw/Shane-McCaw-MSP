import nodemailer from "nodemailer";
import { Resend } from "resend";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

// ─── Brand constants ──────────────────────────────────────────────────────────
const BRAND_FROM = "Shane McCaw Consulting <noreply@shanemccaw.com>";
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

// ─── Attachment type ──────────────────────────────────────────────────────────
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
}

// ─── Transport selection ──────────────────────────────────────────────────────
type Sender = (to: string, subject: string, html: string, attachments?: EmailAttachment[]) => Promise<void>;

function getConnectorSender(): Sender | null {
  const hasConnectorEnv =
    process.env.REPLIT_CONNECTORS_HOSTNAME &&
    process.env.REPL_IDENTITY;
  if (!hasConnectorEnv) return null;
  const from = process.env.RESEND_FROM ?? BRAND_FROM;
  return async (to, subject, html, attachments) => {
    const connectors = new ReplitConnectors();
    const body: Record<string, unknown> = { from, to, subject, html };
    if (attachments && attachments.length > 0) {
      body.attachments = attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
      }));
    }
    const res = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend connector error ${res.status}: ${text}`);
    }
  };
}

function getResendSender(): Sender | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM ?? BRAND_FROM;
  return async (to, subject, html, attachments) => {
    const payload: Parameters<typeof resend.emails.send>[0] = { from, to, subject, html };
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
      }));
    }
    const { error } = await resend.emails.send(payload);
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
  return async (to, subject, html, attachments) => {
    await transporter.sendMail({
      from, to, subject, html,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send an email. Prefers Resend via Replit Connector (REPLIT_CONNECTORS_HOSTNAME),
 * then falls back to RESEND_API_KEY, then SMTP. Logs a warning and no-ops when
 * none are configured.
 *
 * Pass raw body HTML — it will be wrapped in the branded template automatically
 * unless you pass `{ skipWrapper: true }`.
 *
 * Errors are caught and logged — use sendEmailOrThrow when you need confirmed delivery.
 */
export async function sendEmail(
  to: string,
  subject: string,
  bodyHtml: string,
  opts?: { skipWrapper?: boolean },
): Promise<void> {
  try {
    await sendEmailOrThrow(to, subject, bodyHtml, opts);
  } catch (err) {
    logger.warn({ err, to, subject }, "Failed to send email");
  }
}

/**
 * Like sendEmail but throws on transport failure or missing configuration.
 * Use this when the caller needs confirmed delivery (e.g. a route that must
 * return an error to the client if the email could not be sent).
 */
export async function sendEmailOrThrow(
  to: string,
  subject: string,
  bodyHtml: string,
  opts?: { skipWrapper?: boolean },
): Promise<void> {
  const sender = getConnectorSender() ?? getResendSender() ?? getSmtpSender();
  if (!sender) {
    throw new Error("No email transport configured — set REPLIT_CONNECTORS_HOSTNAME, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS");
  }
  const html = opts?.skipWrapper ? bodyHtml : brandedEmail(bodyHtml);
  await sender(to, subject, html);
  logger.info({ to, subject }, "Email sent");
}

/**
 * Send an email with file attachments. Wraps the HTML in the branded template.
 * Errors are caught and logged (fire-and-forget friendly).
 */
export async function sendEmailWithAttachment(
  to: string,
  subject: string,
  html: string,
  attachments: EmailAttachment[],
): Promise<void> {
  const sender = getConnectorSender() ?? getResendSender() ?? getSmtpSender();
  if (!sender) {
    logger.warn({ to, subject }, "No email transport configured — attachment email skipped");
    return;
  }
  try {
    await sender(to, subject, html, attachments);
    logger.info({ to, subject, files: attachments.map((a) => a.filename) }, "Email with attachments sent");
  } catch (err) {
    logger.warn({ err, to, subject }, "Failed to send email with attachment");
  }
}

/**
 * Like sendEmailWithAttachment but throws on transport failure or missing configuration.
 * Use this when the caller needs confirmed delivery (e.g. a user-initiated resend route).
 */
export async function sendEmailWithAttachmentOrThrow(
  to: string,
  subject: string,
  html: string,
  attachments: EmailAttachment[],
): Promise<void> {
  const sender = getConnectorSender() ?? getResendSender() ?? getSmtpSender();
  if (!sender) {
    throw new Error("No email transport configured — set REPLIT_CONNECTORS_HOSTNAME, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS");
  }
  await sender(to, subject, html, attachments);
  logger.info({ to, subject, files: attachments.map((a) => a.filename) }, "Email with attachments sent");
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

export function passwordResetEmail(opts: { resetUrl: string }): string {
  return `
    <p>Hi there,</p>
    <p>We received a request to reset your password for your <strong>Shane McCaw Consulting</strong> portal account.</p>
    <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
    ${emailButton("Reset my password", opts.resetUrl)}
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function contactInquiryNotificationEmail(opts: {
  name: string;
  email: string;
  company: string;
  companySize?: string;
  serviceArea?: string;
  message: string;
  howFound?: string;
}): string {
  const serviceLabels: Record<string, string> = {
    m365: "M365 Setup/Optimization",
    copilot: "Copilot AI",
    sharepoint: "SharePoint",
    "power-platform": "Power Platform",
    governance: "Governance/Compliance",
    migration: "Cloud Migration",
    retainer: "Retainer/Ongoing Support",
    "not-sure": "Not Sure",
  };
  const name = escapeHtml(opts.name);
  const email = escapeHtml(opts.email);
  const company = escapeHtml(opts.company);
  const companySize = opts.companySize ? escapeHtml(opts.companySize) : undefined;
  const howFound = opts.howFound ? escapeHtml(opts.howFound) : undefined;
  const rawServiceArea = opts.serviceArea ?? "";
  const serviceLabel = escapeHtml((serviceLabels[rawServiceArea] ?? rawServiceArea) || "—");
  const message = escapeHtml(opts.message).replace(/\n/g, "<br/>");

  return `
    <p>Hi Shane,</p>
    <p>A new contact form inquiry just came in from <strong>${name}</strong>. Here are the details:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">${name}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:${email}" style="color:#0078D4;">${email}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">${company}</td></tr>
      ${companySize ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company size</td><td style="padding:4px 0;">${companySize}</td></tr>` : ""}
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Service needed</td><td style="padding:4px 0;font-weight:600;">${serviceLabel}</td></tr>
      ${howFound ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">How they found you</td><td style="padding:4px 0;">${howFound}</td></tr>` : ""}
    </table>
    <p style="font-weight:600;margin-bottom:4px;">Message:</p>
    <blockquote style="margin:0;padding:12px 16px;background:#f8fafc;border-left:4px solid #0078D4;border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">${message}</blockquote>
    ${emailButton("Reply to " + name, `mailto:${email}`)}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `;
}

export function closureRequestEmail(opts: {
  clientName: string;
  projectTitle: string;
  projectId: number;
  portalUrl?: string;
}): string {
  const url = `${opts.portalUrl ?? "https://shanemccaw.consulting/crm/portal"}/projects/${opts.projectId}`;
  return `
    <p>Hi ${opts.clientName || "there"},</p>
    <p>Congratulations — your project <strong>${opts.projectTitle}</strong> has reached completion!</p>
    <p>Shane would like to officially close out this engagement. As part of the closure process, we'd love to hear your feedback and, if you're willing, capture a brief testimonial to share with other clients.</p>
    <p>Please visit your portal to review the project, provide your feedback, and sign off on the closure. It only takes a moment.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Project</td><td style="padding:4px 0;font-weight:600;">${opts.projectTitle}</td></tr>
    </table>
    <p style="margin-top:8px;font-size:13px;color:#64748b;">Your feedback is entirely optional, but it's genuinely valued — it helps us serve the next client better.</p>
    <p style="margin-top:8px;font-size:13px;color:#64748b;">By signing off you confirm that the deliverables were received and you grant permission to publish your feedback as a testimonial (you can opt out at any time).</p>
    <a href="${url}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;margin-top:20px;">Review &amp; Sign Off →</a>
    <p style="margin-top:24px;">Thank you for working with Shane — it's been a pleasure.</p>
    <p>— Shane McCaw Consulting</p>
  `;
}

export function statusReportReplyEmail(opts: {
  clientName: string;
  reportTitle: string;
  adminReply: string;
  projectId?: number | null;
}): string {
  const projectUrl = opts.projectId
    ? `${PORTAL_URL}/projects/${opts.projectId}`
    : PORTAL_URL;
  const safeReply = escapeHtml(opts.adminReply).replace(/\n/g, "<br/>");
  return `
    <p>Hi ${escapeHtml(opts.clientName) || "there"},</p>
    <p>Shane has replied to your question on the status report: <strong>${escapeHtml(opts.reportTitle)}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid #0078D4;border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">${safeReply}</blockquote>
    <p>You can view the full report and mark the question as resolved in your client portal.</p>
    ${emailButton("View your project", projectUrl)}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
}

export function clientThreadReplyEmail(opts: {
  clientName: string;
  reportTitle: string;
  replyContent: string;
  projectId?: number | null;
}): string {
  const adminUrl = opts.projectId
    ? `https://shanemccaw.consulting/admin-panel/crm/projects/${opts.projectId}`
    : `https://shanemccaw.consulting/admin-panel/crm/status-reports`;
  const safeContent = escapeHtml(opts.replyContent).replace(/\n/g, "<br/>");
  return `
    <p>Hi Shane,</p>
    <p><strong>${escapeHtml(opts.clientName) || "A client"}</strong> has sent a follow-up message on the status report: <strong>${escapeHtml(opts.reportTitle)}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid #0078D4;border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">${safeContent}</blockquote>
    <p>You can view the full conversation and reply in the admin panel.</p>
    ${emailButton("View in admin panel", adminUrl)}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `;
}

export function adminThreadReplyEmail(opts: {
  clientName: string;
  reportTitle: string;
  replyContent: string;
  projectId?: number | null;
}): string {
  const projectUrl = opts.projectId
    ? `${PORTAL_URL}/projects/${opts.projectId}`
    : PORTAL_URL;
  const safeContent = escapeHtml(opts.replyContent).replace(/\n/g, "<br/>");
  return `
    <p>Hi ${escapeHtml(opts.clientName) || "there"},</p>
    <p>Shane has replied to your follow-up on the status report: <strong>${escapeHtml(opts.reportTitle)}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid #0078D4;border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">${safeContent}</blockquote>
    <p>You can continue the conversation or mark it as resolved in your client portal.</p>
    ${emailButton("View your project", projectUrl)}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
}

export function retainerResumedEmail(opts: {
  clientName: string;
  serviceName: string;
  nextBillingDate: string;
}): string {
  return `
    <p>Hi ${escapeHtml(opts.clientName) || "there"},</p>
    <p>Great news — your <strong>${escapeHtml(opts.serviceName)}</strong> retainer has been successfully resumed. The scheduled cancellation has been reversed and your service will continue uninterrupted.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Service</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(opts.serviceName)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Next charge</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(opts.nextBillingDate)}</td></tr>
    </table>
    <p>If you didn't intend to resume this retainer, or if you have any questions, please reach out via your client portal.</p>
    ${emailButton("View your portal", PORTAL_URL)}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
}

export function serviceOverviewConfirmationEmail(opts: {
  name: string;
  serviceName: string;
}): string {
  const name = escapeHtml(opts.name.split(" ")[0] ?? opts.name);
  const service = escapeHtml(opts.serviceName);
  return `
    <p>Hi ${name},</p>
    <p>Thanks for your interest in Shane's <strong>${service}</strong> services. Shane personally reviews every request and will send you the overview document and follow up within <strong>one business day</strong>.</p>
    <p>In the meantime, if you have any urgent questions you can reach Shane directly at <a href="mailto:info@shanemccaw.com" style="color:${BLUE};">info@shanemccaw.com</a> or book a free discovery call below.</p>
    ${emailButton("Book a Free Discovery Call", "https://shanemccaw.consulting/book")}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
}

export function serviceOverviewLeadNotificationEmail(opts: {
  name: string;
  email: string;
  company: string;
  serviceName: string;
}): string {
  const name = escapeHtml(opts.name);
  const email = escapeHtml(opts.email);
  const company = escapeHtml(opts.company);
  const service = escapeHtml(opts.serviceName);
  return `
    <p>Hi Shane,</p>
    <p>A new lead just requested the <strong>${service}</strong> service overview. Here are their details:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">${name}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:${email}" style="color:#0078D4;">${email}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">${company}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Requested Overview</td><td style="padding:4px 0;font-weight:600;">${service}</td></tr>
    </table>
    <p>They've been sent a confirmation email. Reply directly to follow up with the overview document.</p>
    ${emailButton("Reply to " + name, `mailto:${email}`)}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `;
}

export function quizLeadNotificationEmail(opts: {
  name: string;
  email: string;
  company?: string | null;
  totalScore: number;
  tier: string;
  recommendedService: string;
}): string {
  const name = escapeHtml(opts.name);
  const email = escapeHtml(opts.email);
  const company = opts.company ? escapeHtml(opts.company) : "—";
  const tier = escapeHtml(opts.tier);
  const service = escapeHtml(opts.recommendedService);
  return `
    <p>Hi Shane,</p>
    <p>A new quiz lead just came in — <strong>${name}</strong> completed the Microsoft Copilot Readiness Assessment. Their results are below.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">${name}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:${email}" style="color:#0078D4;">${email}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">${company}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${opts.totalScore} / 50</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${tier}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${service}</td></tr>
    </table>
    <p>The lead has been saved to the admin panel. Follow up while they're warm — their personalised report was emailed to them moments ago.</p>
    ${emailButton("Reply to " + name, `mailto:${email}`)}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
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
