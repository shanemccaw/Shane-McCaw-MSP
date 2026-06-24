import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db, clientHealthHistoryTable, usersTable, clientM365ProfilesTable,
} from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

const HEALTH_CATEGORIES = [
  "governance",
  "security",
  "compliance",
  "copilot",
  "identity",
  "collaboration",
  "productivity",
  "data",
] as const;

type HealthCategory = typeof HEALTH_CATEGORIES[number];

// Map from M365 profile field names to canonical category names
const PROFILE_TO_CATEGORY: Record<string, HealthCategory> = {
  governanceScore: "governance",
  securityScore: "security",
  complianceScore: "compliance",
  copilotReadinessScore: "copilot",
  identityScore: "identity",
  identityProtectionScore: "identity",
  collaborationScore: "collaboration",
  teamsAdoptionScore: "collaboration",
  productivityScore: "productivity",
  adoptionScore: "productivity",
  dataScore: "data",
  dataGovernanceScore: "data",
  informationProtectionScore: "data",
};

// ── GET /api/clients/:id/health/trends ────────────────────────────────────────
// Returns last 90 days of health history for a client, grouped by category,
// plus a Claude-generated insight string.
router.get("/api/clients/:id/health/trends", requireAdmin, async (req: Request, res: Response) => {
  try {
    const clientId = parseInt(String(req.params.id));
    if (isNaN(clientId)) {
      res.status(400).json({ error: "Invalid client ID" });
      return;
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const rows = await db.select()
      .from(clientHealthHistoryTable)
      .where(and(
        eq(clientHealthHistoryTable.clientId, clientId),
        gte(clientHealthHistoryTable.recordedAt, ninetyDaysAgo),
      ))
      .orderBy(clientHealthHistoryTable.recordedAt);

    // Group by category
    const byCategory: Record<string, Array<{ date: string; score: number }>> = {};
    for (const r of rows) {
      if (!byCategory[r.category]) byCategory[r.category] = [];
      byCategory[r.category].push({
        date: r.recordedAt.toISOString().slice(0, 10),
        score: r.score,
      });
    }

    // Compute deltas for insight
    const deltas: Array<{ category: string; latestScore: number; delta: number }> = [];
    for (const [category, points] of Object.entries(byCategory)) {
      if (points.length < 2) continue;
      const latest = points[points.length - 1].score;
      const earliest = points[0].score;
      deltas.push({ category, latestScore: latest, delta: latest - earliest });
    }

    let insight: string | null = null;
    if (deltas.length >= 2) {
      const deltaText = deltas.map(d => `${d.category}: ${d.latestScore}/100 (${d.delta >= 0 ? "+" : ""}${d.delta} over 90d)`).join(", ");
      try {
        const msg = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: `You are a Microsoft 365 health analyst. Summarize this client's M365 health trend in 1-2 sentences. Focus on the most significant change and what action it suggests.

Health trends (last 90 days): ${deltaText}

Insight:`,
            },
          ],
        });
        const block = msg.content[0];
        if (block.type === "text") insight = block.text.trim();
      } catch {
        // non-fatal — insight stays null
      }
    }

    res.json({ byCategory, deltas, insight });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch health trends";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/clients/:id/health/record ───────────────────────────────────────
// Records a manual health snapshot for a single client (reads from their M365 profile).
router.post("/api/clients/:id/health/record", requireAdmin, async (req: Request, res: Response) => {
  try {
    const clientId = parseInt(String(req.params.id));
    if (isNaN(clientId)) {
      res.status(400).json({ error: "Invalid client ID" });
      return;
    }

    const profileRow = await db.select({ profile: clientM365ProfilesTable.profile })
      .from(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, clientId))
      .limit(1);

    if (profileRow.length === 0 || !profileRow[0].profile) {
      res.status(404).json({ error: "No M365 profile found for this client" });
      return;
    }

    const profile = profileRow[0].profile as Record<string, unknown>;
    const now = new Date();

    // Aggregate to exactly one score per canonical category.
    // When multiple profile fields map to the same category, take the average.
    const categoryAccumulator: Record<string, { sum: number; count: number }> = {};
    for (const [field, cat] of Object.entries(PROFILE_TO_CATEGORY)) {
      const score = profile[field];
      if (typeof score === "number" && score >= 0 && score <= 100) {
        if (!categoryAccumulator[cat]) categoryAccumulator[cat] = { sum: 0, count: 0 };
        categoryAccumulator[cat].sum += score;
        categoryAccumulator[cat].count += 1;
      }
    }

    const inserts: Array<{ clientId: number; category: HealthCategory; score: number }> = Object.entries(categoryAccumulator).map(([cat, { sum, count }]) => ({
      clientId,
      category: cat as HealthCategory,
      score: Math.round(sum / count),
    }));

    if (inserts.length === 0) {
      res.status(422).json({ error: "M365 profile has no scorable fields" });
      return;
    }

    const inserted = await db.insert(clientHealthHistoryTable)
      .values(inserts.map(i => ({ ...i, recordedAt: now })))
      .returning();

    res.json({ recorded: inserted.length, clientId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to record health snapshot";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/admin/health/snapshot-all ──────────────────────────────────────
// Records current M365 health scores for ALL active clients that have an M365 profile.
// Designed to be called by a daily cron job or manually from the admin panel.
//
// HOW TO WIRE A DAILY CRON:
//   GitHub Actions (recommended for Replit-deployed apps):
//     - Create .github/workflows/health-snapshot.yml
//     - Schedule: cron: '0 6 * * *'  (06:00 UTC daily)
//     - Step: curl -X POST https://<your-domain>/api/admin/health/snapshot-all \
//         -H "Authorization: Bearer <ADMIN_PASSWORD>"
//
//   Azure Logic Apps:
//     - Add an HTTP action with POST to this endpoint and the Authorization header
//     - Set recurrence to daily at your preferred time
//
//   node-cron (add to artifacts/api-server/src/index.ts if self-scheduling is preferred):
//     import cron from 'node-cron';
//     cron.schedule('0 6 * * *', () => {
//       fetch('http://localhost:${PORT}/api/admin/health/snapshot-all', {
//         method: 'POST',
//         headers: { Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` }
//       });
//     });
router.post("/api/admin/health/snapshot-all", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [clients, profiles] = await Promise.all([
      db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.role, "client")),
      db.select({ clientId: clientM365ProfilesTable.clientId, profile: clientM365ProfilesTable.profile })
        .from(clientM365ProfilesTable),
    ]);

    const profileMap = new Map(profiles.map(p => [p.clientId, p.profile as Record<string, unknown>]));
    const now = new Date();
    const allInserts: Array<{ clientId: number; category: HealthCategory; score: number; recordedAt: Date }> = [];

    for (const client of clients) {
      const profile = profileMap.get(client.id);
      if (!profile) continue;

      // Aggregate to one score per canonical category (average when multiple fields map to same category)
      const acc: Record<string, { sum: number; count: number }> = {};
      for (const [field, cat] of Object.entries(PROFILE_TO_CATEGORY)) {
        const score = profile[field];
        if (typeof score === "number" && score >= 0 && score <= 100) {
          if (!acc[cat]) acc[cat] = { sum: 0, count: 0 };
          acc[cat].sum += score;
          acc[cat].count += 1;
        }
      }
      for (const [cat, { sum, count }] of Object.entries(acc)) {
        allInserts.push({ clientId: client.id, category: cat as HealthCategory, score: Math.round(sum / count), recordedAt: now });
      }
    }

    if (allInserts.length === 0) {
      res.json({ recorded: 0, clientsProcessed: clients.length, message: "No M365 profiles with health scores found." });
      return;
    }

    const inserted = await db.insert(clientHealthHistoryTable).values(allInserts).returning();

    res.json({
      recorded: inserted.length,
      clientsProcessed: clients.length,
      clientsWithProfiles: profiles.length,
      snapshotAt: now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Snapshot failed";
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/admin/health/alerts ──────────────────────────────────────────────
// Returns clients whose score dropped or improved by ≥10 points in the last 30 days.
router.get("/api/admin/health/alerts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [rows, clients] = await Promise.all([
      db.select()
        .from(clientHealthHistoryTable)
        .where(gte(clientHealthHistoryTable.recordedAt, thirtyDaysAgo))
        .orderBy(clientHealthHistoryTable.clientId, clientHealthHistoryTable.category, clientHealthHistoryTable.recordedAt),
      db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company })
        .from(usersTable).where(eq(usersTable.role, "client")),
    ]);

    const clientMap = new Map(clients.map(c => [c.id, c]));

    // For each client+category, find earliest and latest score in the window
    type AlertKey = `${number}:${string}`;
    const buckets: Record<AlertKey, { earliest: number; latest: number; clientId: number; category: string }> = {};

    for (const r of rows) {
      const key: AlertKey = `${r.clientId}:${r.category}`;
      if (!buckets[key]) {
        buckets[key] = { earliest: r.score, latest: r.score, clientId: r.clientId, category: r.category };
      } else {
        buckets[key].latest = r.score;
      }
    }

    const alerts = Object.values(buckets)
      .map(b => ({ ...b, delta: b.latest - b.earliest }))
      .filter(b => Math.abs(b.delta) >= 10)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .map(b => {
        const client = clientMap.get(b.clientId);
        return {
          clientId: b.clientId,
          clientName: client?.name ?? client?.email ?? `Client #${b.clientId}`,
          company: client?.company ?? null,
          category: b.category,
          latestScore: b.latest,
          earliestScore: b.earliest,
          delta: b.delta,
        };
      });

    res.json(alerts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch health alerts";
    res.status(500).json({ error: msg });
  }
});

export default router;
