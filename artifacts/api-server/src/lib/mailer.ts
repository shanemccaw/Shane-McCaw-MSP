import nodemailer from "nodemailer";
import { logger } from "./logger";

function getTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transporter = getTransport();
  if (!transporter) {
    logger.warn({ to, subject }, "Email not sent — configure SMTP_HOST, SMTP_USER, SMTP_PASS to enable email");
    return;
  }
  try {
    const from = process.env.SMTP_FROM ?? `Shane McCaw Consulting <${process.env.SMTP_USER}>`;
    await transporter.sendMail({ from, to, subject, html });
    logger.info({ to, subject }, "Email sent");
  } catch (err) {
    logger.warn({ err, to, subject }, "Failed to send email");
  }
}
