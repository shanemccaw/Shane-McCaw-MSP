/**
 * manual-script-escalation.ts
 *
 * Daily escalation alert: emails Shane when a manualScript kanban card has been
 * sitting in the "waiting_on_customer" column for more than 5 business days.
 *
 * Overdue threshold uses updatedAt — the timestamp of the last meaningful change
 * to the card. This correctly handles cards that were moved into waiting_on_customer
 * after initial creation (updatedAt reflects when the column was last set).
 *
 * Idempotent: each card will only generate one alert per 24-hour window.
 * The last alert timestamp is stored in taskMetadata.lastEscalationAlertSentAt.
 * Cards are only marked as alerted AFTER the email is confirmed sent (via
 * sendEmailOrThrow), so a transport failure will not suppress future retries.
 *
 * Called from:
 *   - POST /api/admin/kanban/check-escalations (manual trigger from admin panel)
 *   - A setInterval in src/index.ts (daily self-scheduled run)
 */

import { db, kanbanTasksTable, projectsTable, usersTable } from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";
import { logger } from "./logger";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "./mailer";

const log = logger.child({ channel: "workflow.script" });

const ESCALATION_THRESHOLD_BUSINESS_DAYS = 5;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns a Date that is `days` business days before `from` (skipping Sat/Sun).
 */
function subtractBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let subtracted = 0;
  while (subtracted < days) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) subtracted++;
  }
  return d;
}

/**
 * Counts business days elapsed between `from` and `to`.
 * Returns a non-negative integer.
 */
function countBusinessDaysElapsed(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor < end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

interface OverdueCard {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  clientName: string | null;
  clientEmail: string | null;
  updatedAt: Date;
  businessDaysWaiting: number;
  adminPanelUrl: string;
}

/**
 * Queries the DB for overdue manual script kanban cards and returns enriched rows.
 * A card qualifies when:
 *   - column = 'waiting_on_customer'
 *   - taskType = 'manualScript'
 *   - updatedAt < (now - 5 business days)  — i.e. no activity for >5 business days
 *   - lastEscalationAlertSentAt is absent or older than 24 h
 */
async function findOverdueCards(): Promise<OverdueCard[]> {
  const cutoff = subtractBusinessDays(new Date(), ESCALATION_THRESHOLD_BUSINESS_DAYS);

  const tasks = await db
    .select({
      id: kanbanTasksTable.id,
      title: kanbanTasksTable.title,
      projectId: kanbanTasksTable.projectId,
      updatedAt: kanbanTasksTable.updatedAt,
      taskMetadata: kanbanTasksTable.taskMetadata,
    })
    .from(kanbanTasksTable)
    .where(
      and(
        eq(kanbanTasksTable.column, "waiting_on_customer"),
        eq(kanbanTasksTable.taskType, "manualScript"),
        lt(kanbanTasksTable.updatedAt, cutoff),
      ),
    );

  if (tasks.length === 0) return [];

  const allProjects = await db
    .select({
      id: projectsTable.id,
      title: projectsTable.title,
      clientUserId: projectsTable.clientUserId,
    })
    .from(projectsTable);

  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const projectIds = new Set(tasks.map((t) => t.projectId));

  const relevantClientIds = [
    ...new Set(
      allProjects
        .filter((p) => projectIds.has(p.id))
        .map((p) => p.clientUserId)
        .filter((id): id is number => id !== null),
    ),
  ];

  const clients =
    relevantClientIds.length > 0
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
      : [];

  const clientMap = new Map(clients.map((c) => [c.id, c]));

  const now = new Date();

  const adminPanelBase =
    process.env.ADMIN_PANEL_URL ??
    (() => {
      const domains = (process.env.REPLIT_DOMAINS ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      const custom = domains.find((d) => !d.includes("replit."));
      if (custom) return `https://${custom}/admin-panel`;
      const app = domains.find((d) => d.endsWith(".replit.app"));
      if (app) return `https://${app}/admin-panel`;
      const dev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
      if (dev) return `https://${dev}/admin-panel`;
      return "https://shanemccaw.com/admin-panel";
    })();

  const overdueCards: OverdueCard[] = [];

  for (const task of tasks) {
    const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;

    // Skip cards alerted within the last 24 h (idempotency guard)
    if (typeof meta.lastEscalationAlertSentAt === "string") {
      const lastSent = new Date(meta.lastEscalationAlertSentAt).getTime();
      if (now.getTime() - lastSent < ALERT_COOLDOWN_MS) {
        continue;
      }
    }

    const project = projectMap.get(task.projectId);
    if (!project) continue;

    const client = project.clientUserId ? clientMap.get(project.clientUserId) : null;
    const businessDaysWaiting = countBusinessDaysElapsed(task.updatedAt, now);

    overdueCards.push({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      projectTitle: project.title,
      clientName: client?.name ?? null,
      clientEmail: client?.email ?? null,
      updatedAt: task.updatedAt,
      businessDaysWaiting,
      adminPanelUrl: `${adminPanelBase}/crm/projects/${task.projectId}`,
    });
  }

  return overdueCards;
}

/**
 * Marks each alerted card as notified by writing the current timestamp into
 * taskMetadata.lastEscalationAlertSentAt. Does NOT touch updatedAt, so the
 * 5-business-day overdue clock is not reset by the alert itself.
 *
 * Only called after confirmed email delivery.
 */
async function markCardsAlerted(cardIds: number[]): Promise<void> {
  const sentAt = new Date().toISOString();
  for (const id of cardIds) {
    try {
      const [row] = await db
        .select({ taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(eq(kanbanTasksTable.id, id));

      const meta = (row?.taskMetadata ?? {}) as Record<string, unknown>;
      meta.lastEscalationAlertSentAt = sentAt;

      await db
        .update(kanbanTasksTable)
        .set({ taskMetadata: meta })
        .where(eq(kanbanTasksTable.id, id));
    } catch (err) {
      log.warn({ err, kanbanTaskId: id }, "escalation: failed to mark card as alerted");
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEscalationRowsHtml(cards: OverdueCard[]): string {
  return cards
    .map(
      (c) => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:12px 8px;vertical-align:top;">
        <strong>${escapeHtml(c.clientName ?? "Unknown client")}</strong>
        ${c.clientEmail ? `<br/><span style="font-size:12px;color:#64748b;">${escapeHtml(c.clientEmail)}</span>` : ""}
      </td>
      <td style="padding:12px 8px;vertical-align:top;">${escapeHtml(c.title)}</td>
      <td style="padding:12px 8px;vertical-align:top;font-weight:700;color:#dc2626;">
        ${c.businessDaysWaiting} business day${c.businessDaysWaiting !== 1 ? "s" : ""}
      </td>
      <td style="padding:12px 8px;vertical-align:top;">
        <a href="${c.adminPanelUrl}" style="color:#0078D4;text-decoration:none;font-weight:600;">View project →</a>
      </td>
    </tr>`,
    )
    .join("\n");
}

function defaultEscalationEmailHtml(cards: OverdueCard[], rowsHtml: string): string {
  return `
    <p>Hi Shane,</p>
    <p>The following manual script card${cards.length !== 1 ? "s have" : " has"} been waiting on the client for more than ${ESCALATION_THRESHOLD_BUSINESS_DAYS} business days without action. You may want to follow up.</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:20px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Client</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Task</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Waiting</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Link</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <p style="font-size:13px;color:#64748b;margin-top:16px;">Each card will only appear in this alert once per 24 hours.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated alert)</p>
  `;
}

export interface EscalationResult {
  checked: number;
  alerted: number;
  cardIds: number[];
}

/**
 * Main entry point.
 *
 * Finds all overdue manual script kanban cards, sends Shane a summary email
 * via sendEmailOrThrow (confirmed delivery), then marks each card with the
 * alert timestamp so it won't re-alert for 24 hours.
 *
 * If email delivery fails, the error propagates — cards are NOT marked as
 * alerted, so the next run will retry.
 *
 * Returns a summary of what was done. Throws on transport failure so callers
 * (the admin route and the setInterval scheduler) can log or surface the error.
 */
export async function checkManualScriptEscalations(): Promise<EscalationResult> {
  const shaneEmail =
    process.env.ADMIN_EMAIL ??
    process.env.CRM_ADMIN_EMAIL ??
    "info@shanemccaw.com";

  let overdueCards: OverdueCard[] = [];
  try {
    overdueCards = await findOverdueCards();
  } catch (err) {
    log.error({ err }, "escalation: failed to query overdue cards");
    throw err;
  }

  const totalChecked = overdueCards.length;

  if (overdueCards.length === 0) {
    log.info("escalation: no overdue manual script cards found");
    return { checked: 0, alerted: 0, cardIds: [] };
  }

  log.info(
    { count: overdueCards.length, cardIds: overdueCards.map((c) => c.id) },
    "escalation: found overdue manual script cards — sending alert",
  );

  const defaultSubject =
    overdueCards.length === 1
      ? `⚠️ 1 manual script card has been waiting >5 business days`
      : `⚠️ ${overdueCards.length} manual script cards have been waiting >5 business days`;

  const rowsHtml = buildEscalationRowsHtml(overdueCards);
  const defaultBodyHtml = defaultEscalationEmailHtml(overdueCards, rowsHtml);

  // sendEmailOrThrow: throws on transport failure, so cards are only marked
  // as alerted after confirmed delivery — no silent suppression of retries.
  const { subject, bodyHtml } = await getEmailTemplateOrFallback(
    "manual-script-escalation",
    {
      cardCount: String(overdueCards.length),
      thresholdDays: String(ESCALATION_THRESHOLD_BUSINESS_DAYS),
      rowsHtml,
    },
    defaultSubject,
    defaultBodyHtml,
  );
  await sendEmailOrThrow(shaneEmail, subject, bodyHtml);

  log.info(
    { to: shaneEmail, count: overdueCards.length },
    "escalation: alert email confirmed sent",
  );

  const cardIds = overdueCards.map((c) => c.id);
  await markCardsAlerted(cardIds);

  return { checked: totalChecked, alerted: overdueCards.length, cardIds };
}
