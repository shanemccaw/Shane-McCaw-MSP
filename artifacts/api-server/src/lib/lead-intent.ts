import { db, leadsTable, leadIntentEventsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";

export const INTENT_SCORE_MAP: Record<string, number> = {
  email_open: 1,
  link_click: 3,
  cta_click: 5,
  site_visit: 2,
  form_submit: 10,
  reply: 15,
};

export const HIGH_VALUE_PAGES = new Set([
  "/services",
  "/services/microsoft-365",
  "/services/copilot-ai",
  "/services/sharepoint",
  "/services/power-platform",
  "/services/governance",
  "/services/cloud-migration",
  "/pricing",
  "/quick-wins",
  "/book",
  "/contact",
]);

export async function recomputeAndPersistHotScore(leadId: number): Promise<number> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) return 0;

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const events = await db.select().from(leadIntentEventsTable)
    .where(and(eq(leadIntentEventsTable.leadId, leadId), gte(leadIntentEventsTable.occurredAt, cutoff)));

  const intentScore = events.reduce((sum, e) => sum + (INTENT_SCORE_MAP[e.eventType] ?? 1), 0);

  const icpBonus =
    (lead.painPoints?.length ?? 0) * 2 +
    (lead.stage === "Hot" ? 15 : lead.stage === "Warm" ? 8 : 0) +
    (lead.engagementSignals?.length ?? 0) * 3 +
    (lead.urgencySignals?.length ?? 0) * 4;

  const newScore = Math.min(100, intentScore + icpBonus);
  const prevScore = lead.score;

  await db.update(leadsTable)
    .set({ score: newScore, previousScore: prevScore, updatedAt: new Date() })
    .where(eq(leadsTable.id, leadId));

  return newScore;
}

export async function ingestIntentEvent(
  leadId: number,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<{ event: unknown; hotScore: number }> {
  const [ev] = await db.insert(leadIntentEventsTable).values({
    leadId,
    eventType: eventType as "email_open" | "link_click" | "cta_click" | "site_visit" | "form_submit" | "reply",
    metadata: metadata ?? {},
    occurredAt: new Date(),
  }).returning();
  const hotScore = await recomputeAndPersistHotScore(leadId);
  return { event: ev, hotScore };
}

export async function findLeadByEmail(email: string): Promise<{ id: number } | null> {
  const [lead] = await db.select({ id: leadsTable.id })
    .from(leadsTable)
    .where(eq(leadsTable.email, email.toLowerCase().trim()))
    .limit(1);
  return lead ?? null;
}
