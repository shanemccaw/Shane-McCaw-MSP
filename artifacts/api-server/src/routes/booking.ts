import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { logger } from "../lib/logger";
import { graphCredentialsPresent, getCalendarView, createCalendarEvent } from "../lib/graph";
import { sendEmailFromTemplate } from "../lib/mailer";

const router: IRouter = Router();

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking requests — please try again in an hour." },
});

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Convert a local ET time (hour, minute) on a given date to a UTC Date.
 * Uses Intl to compute the real ET offset (handles EDT/EST automatically).
 */
function etToUtc(dateStr: string, hour: number, minute: number): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Probe: what ET hour corresponds to noon UTC on this date?
  const probe = new Date(Date.UTC(year!, month! - 1, day!, 12, 0, 0));
  const etHourAtNoon = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(probe),
    10,
  );
  const offsetHours = etHourAtNoon - 12; // -4 (EDT) or -5 (EST)
  return new Date(Date.UTC(year!, month! - 1, day!, hour - offsetHours, minute, 0));
}

function utcToEtLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

// ─── Slot generation ──────────────────────────────────────────────────────────

interface Slot {
  startIso: string;
  endIso: string;
  label: string;
}

/**
 * Generate all 30-minute slots between 11 am and 5 pm ET and filter out
 * any that overlap with existing calendar events.
 */
function getAvailableSlots(dateStr: string, existingEvents: { start: string; end: string }[]): Slot[] {
  const slots: Slot[] = [];

  // 11:00, 11:30, ..., 16:30 (last slot ends at 17:00)
  for (let hour = 11; hour <= 16; hour++) {
    for (const minute of [0, 30]) {
      if (hour === 16 && minute === 30) break; // stop at 16:30 (last slot 16:30–17:00)
      const slotStart = etToUtc(dateStr, hour, minute);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

      const blocked = existingEvents.some((ev) => {
        const evStart = new Date(ev.start).getTime();
        const evEnd = new Date(ev.end).getTime();
        return slotStart.getTime() < evEnd && slotEnd.getTime() > evStart;
      });

      if (!blocked) {
        slots.push({
          startIso: slotStart.toISOString(),
          endIso: slotEnd.toISOString(),
          label: utcToEtLabel(slotStart),
        });
      }
    }
  }

  return slots;
}

// ─── Date validation ──────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return day === 0 || day === 6;
}

function isInPast(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  return date < todayUtc;
}

function isTooFarAhead(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  // Count 14 business days ahead
  let count = 0;
  const cursor = new Date(todayUtc);
  while (count < 14) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return date > cursor;
}

// ─── GET /api/booking/slots ───────────────────────────────────────────────────

router.get("/booking/slots", async (req: Request, res: Response) => {
  const date = req.query.date as string | undefined;

  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    return;
  }
  if (isWeekend(date)) {
    res.status(400).json({ error: "Weekends are not available for booking." });
    return;
  }
  if (isInPast(date)) {
    res.status(400).json({ error: "Cannot book a date in the past." });
    return;
  }
  if (isTooFarAhead(date)) {
    res.status(400).json({ error: "Date is beyond the 14-business-day booking window." });
    return;
  }

  if (!graphCredentialsPresent()) {
    logger.warn("Graph credentials missing — returning empty slots for booking");
    res.json({ slots: [] });
    return;
  }

  const userId = process.env.GRAPH_MAIL_USER_ID;
  if (!userId) {
    logger.warn("GRAPH_MAIL_USER_ID not set — returning empty slots");
    res.json({ slots: [] });
    return;
  }

  // Window: midnight to midnight ET on the selected day
  const dayStart = etToUtc(date, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const events = await getCalendarView(userId, dayStart, dayEnd);
  const slots = getAvailableSlots(date, events);

  res.json({ slots });
});

// ─── POST /api/booking ────────────────────────────────────────────────────────

const bookingBodySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  company: z.string().max(120).optional(),
  topic: z.string().min(1).max(300),
  startIso: z.string().min(1),
  endIso: z.string().min(1),
});

router.post("/booking", bookingLimiter, async (req: Request, res: Response) => {
  const parsed = bookingBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { name, email, company, topic, startIso, endIso } = parsed.data;

  // Validate the slot dates are parseable and in the future
  const slotStart = new Date(startIso);
  const slotEnd = new Date(endIso);
  if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) {
    res.status(400).json({ error: "Invalid startIso or endIso" });
    return;
  }
  if (slotStart <= new Date()) {
    res.status(400).json({ error: "That time slot is in the past." });
    return;
  }

  // Format the date/time for emails and event subject
  const slotLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(slotStart) + " ET";

  const userId = process.env.GRAPH_MAIL_USER_ID;
  const hasGraph = graphCredentialsPresent() && !!userId;

  let joinUrl: string | null = null;
  if (hasGraph) {
    const eventResult = await createCalendarEvent(userId!, {
      subject: `Discovery Call — ${name}`,
      bodyHtml: `
        <p><strong>Topic / Agenda:</strong><br/>${topic.replace(/\n/g, "<br/>")}</p>
        ${company ? `<p><strong>Company:</strong> ${company}</p>` : ""}
        <p><strong>Contact email:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><em>Booked via shanemccaw.consulting</em></p>
      `,
      startIso,
      endIso,
      attendeeEmail: email,
      attendeeName: name,
      location: "Microsoft Teams",
    });
    if (!eventResult) {
      logger.warn({ name, email, startIso }, "createCalendarEvent returned null — slot may be unavailable");
      res.status(409).json({ error: "That time slot is no longer available. Please choose another." });
      return;
    }
    joinUrl = eventResult.joinUrl;
    logger.info({ name, email, slotLabel, eventId: eventResult.eventId, joinUrl }, "Booking created on calendar");
  } else {
    logger.warn({ name, email, slotLabel }, "Graph not configured — booking stored without calendar event");
  }

  // Confirmation email to the customer
  const joinButtonHtml = joinUrl
    ? `<p style="margin:20px 0;"><a href="${joinUrl}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:6px;">Join Microsoft Teams Meeting</a></p>`
    : "";
  const companyRowHtml = company
    ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">${company}</td></tr>`
    : "";
  const calendarNoticeHtml = hasGraph
    ? "<p>You should receive a calendar invite shortly. If you don't see it, check your spam folder.</p>"
    : "";
  const defaultCustomerHtml = `
    <p>Hi ${name.split(" ")[0]},</p>
    <p>Your discovery call with Shane McCaw is confirmed. Here are the details:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Date &amp; time</td><td style="padding:4px 0;font-weight:600;">${slotLabel}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Duration</td><td style="padding:4px 0;">30 minutes</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Format</td><td style="padding:4px 0;">Microsoft Teams</td></tr>
      ${companyRowHtml}
    </table>
    ${joinButtonHtml}
    ${calendarNoticeHtml}
    <p>Please come prepared with your most pressing Microsoft 365 questions. Shane will be ready to dig in.</p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `;
  await sendEmailFromTemplate(
    "discovery-call-confirmation",
    email,
    { name: name.split(" ")[0], slotLabel, companyRowHtml, joinButtonHtml, calendarNoticeHtml, tenantHealthBlockHtml: "" },
    `Discovery Call Confirmed — ${slotLabel}`,
    defaultCustomerHtml,
  );

  // Notification email to Shane
  const shaneEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "info@shanemccaw.com";
  const topicHtml = `<blockquote style="margin:0;padding:12px 16px;background:#f8fafc;border-left:4px solid #0078D4;border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">${topic.replace(/\n/g, "<br/>")}</blockquote>`;
  const defaultShaneHtml = `
    <p>Hi Shane,</p>
    <p>A new discovery call has been booked.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Name</td><td style="padding:4px 0;font-weight:600;">${name}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:${email}" style="color:#0078D4;">${email}</a></td></tr>
      ${companyRowHtml}
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Date &amp; time</td><td style="padding:4px 0;font-weight:600;">${slotLabel}</td></tr>
    </table>
    <p style="font-weight:600;margin-bottom:4px;">Topic / Agenda:</p>
    ${topicHtml}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `;
  await sendEmailFromTemplate(
    "admin-discovery-call-notification",
    shaneEmail,
    { name, email, slotLabel, companyRowHtml, topicHtml },
    `New Booking: ${name} — ${slotLabel}`,
    defaultShaneHtml,
  );

  res.json({ ok: true, slotLabel });
});

export default router;
