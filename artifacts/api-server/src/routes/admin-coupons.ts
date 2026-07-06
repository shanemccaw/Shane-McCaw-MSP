import { Router, type IRouter, type Request, type Response } from "express";
import { db, couponsTable, couponRedemptionsTable, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/coupons", requireAdmin, async (_req: Request, res: Response) => {
  const coupons = await db.select().from(couponsTable).orderBy(desc(couponsTable.createdAt));
  res.json(coupons);
});

router.post("/admin/coupons", requireAdmin, async (req: Request, res: Response) => {
  const { code, discountType, discountValue, maxUses, active, expiresAt } = req.body as {
    code?: string;
    discountType?: string;
    discountValue?: number;
    maxUses?: number | null;
    active?: boolean;
    expiresAt?: string | null;
  };

  if (!code?.trim()) { res.status(400).json({ error: "code is required" }); return; }
  if (!discountType || !["fixed", "percentage"].includes(discountType)) {
    res.status(400).json({ error: "discountType must be 'fixed' or 'percentage'" });
    return;
  }
  if (discountValue == null || isNaN(Number(discountValue)) || Number(discountValue) <= 0) {
    res.status(400).json({ error: "discountValue must be a positive number" });
    return;
  }
  if (discountType === "percentage" && Number(discountValue) > 100) {
    res.status(400).json({ error: "percentage discountValue must be 0–100" });
    return;
  }
  if (maxUses !== undefined && maxUses !== null && (isNaN(Number(maxUses)) || Number(maxUses) < 1 || !Number.isInteger(Number(maxUses)))) {
    res.status(400).json({ error: "maxUses must be a positive integer or null (unlimited)" });
    return;
  }

  const [existing] = await db.select({ id: couponsTable.id }).from(couponsTable)
    .where(eq(couponsTable.code, code.trim().toUpperCase()));
  if (existing) {
    res.status(409).json({ error: "A coupon with that code already exists" });
    return;
  }

  const [coupon] = await db.insert(couponsTable).values({
    code: code.trim().toUpperCase(),
    discountType: discountType as "fixed" | "percentage",
    discountValue: String(discountValue),
    maxUses: maxUses ?? null,
    active: active ?? true,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).returning();

  res.status(201).json(coupon);
});

router.patch("/admin/coupons/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid coupon ID" }); return; }

  const { code, discountType, discountValue, maxUses, active, expiresAt } = req.body as {
    code?: string;
    discountType?: string;
    discountValue?: number;
    maxUses?: number | null;
    active?: boolean;
    expiresAt?: string | null;
  };

  const [existing] = await db.select().from(couponsTable).where(eq(couponsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Coupon not found" }); return; }

  const updates: Partial<typeof couponsTable.$inferInsert> = {};

  if (code !== undefined) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { res.status(400).json({ error: "code cannot be empty" }); return; }
    if (trimmed !== existing.code) {
      const [dup] = await db.select({ id: couponsTable.id }).from(couponsTable)
        .where(eq(couponsTable.code, trimmed));
      if (dup) { res.status(409).json({ error: "A coupon with that code already exists" }); return; }
    }
    updates.code = trimmed;
  }

  if (discountType !== undefined) {
    if (!["fixed", "percentage"].includes(discountType)) {
      res.status(400).json({ error: "discountType must be 'fixed' or 'percentage'" });
      return;
    }
    updates.discountType = discountType as "fixed" | "percentage";
  }

  if (discountValue !== undefined) {
    if (isNaN(Number(discountValue)) || Number(discountValue) <= 0) {
      res.status(400).json({ error: "discountValue must be a positive number" });
      return;
    }
    const effectiveType = discountType ?? existing.discountType;
    if (effectiveType === "percentage" && Number(discountValue) > 100) {
      res.status(400).json({ error: "percentage discountValue must be 0–100" });
      return;
    }
    updates.discountValue = String(discountValue);
  }

  if (maxUses !== undefined) {
    if (maxUses !== null && (isNaN(Number(maxUses)) || Number(maxUses) < 1 || !Number.isInteger(Number(maxUses)))) {
      res.status(400).json({ error: "maxUses must be a positive integer or null (unlimited)" });
      return;
    }
    updates.maxUses = maxUses ?? null;
  }
  if (active !== undefined) updates.active = active;
  if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;

  // Cross-field validation: ensure the effective (type, value) pair is valid even when
  // only discountType is being changed (e.g. fixed → percentage with an existing value >100).
  const effectiveFinalType = (updates.discountType ?? existing.discountType) as string;
  const effectiveFinalValue = updates.discountValue != null
    ? Number(updates.discountValue)
    : parseFloat(String(existing.discountValue));
  if (effectiveFinalType === "percentage" && effectiveFinalValue > 100) {
    res.status(400).json({ error: "percentage discountValue must be 0–100 — update the discount value before switching to percentage type" });
    return;
  }

  if (Object.keys(updates).length === 0) {
    res.json(existing);
    return;
  }

  const [updated] = await db.update(couponsTable).set(updates).where(eq(couponsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/admin/coupons/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid coupon ID" }); return; }

  const [existing] = await db.select({ id: couponsTable.id }).from(couponsTable).where(eq(couponsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Coupon not found" }); return; }

  await db.delete(couponsTable).where(eq(couponsTable.id, id));
  res.json({ deleted: id });
});

// ─── POST /api/admin/coupons/publish-to-prod ─────────────────────────────────
// Upserts all coupons (by code) from dev into production, then removes any prod
// rows whose codes are absent from dev. Does NOT overwrite uses_count so live
// redemption counters in production are preserved.

router.post("/admin/coupons/publish-to-prod", requireAdmin, async (_req: Request, res: Response) => {
  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    res.status(503).json({ error: "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets." });
    return;
  }

  try {
    const devCoupons = await db.select().from(couponsTable).orderBy(couponsTable.createdAt);

    const { pool: prodPool } = buildProdDb();
    const client = await prodPool.connect();
    let upserted = 0;
    let removed = 0;

    try {
      await client.query("BEGIN");

      for (const c of devCoupons) {
        await client.query(
          `INSERT INTO coupons (code, discount_type, discount_value, max_uses, active, expires_at, requires_testimonial)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (code) DO UPDATE SET
             discount_type       = EXCLUDED.discount_type,
             discount_value      = EXCLUDED.discount_value,
             max_uses            = EXCLUDED.max_uses,
             active              = EXCLUDED.active,
             expires_at          = EXCLUDED.expires_at,
             requires_testimonial = EXCLUDED.requires_testimonial`,
          [c.code, c.discountType, c.discountValue, c.maxUses, c.active, c.expiresAt, c.requiresTestimonial]
        );
        upserted++;
      }

      // Remove prod coupons not present in dev
      if (devCoupons.length > 0) {
        const codes = devCoupons.map(c => c.code);
        const placeholders = codes.map((_, i) => `$${i + 1}`).join(", ");
        const del = await client.query(
          `DELETE FROM coupons WHERE code NOT IN (${placeholders})`, codes
        );
        removed = del.rowCount ?? 0;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      await prodPool.end();
    }

    res.json({ ok: true, upserted, removed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to publish to production" });
  }
});

router.get("/admin/coupons/:id/redemptions", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid coupon ID" }); return; }

  const [coupon] = await db.select({ code: couponsTable.code }).from(couponsTable).where(eq(couponsTable.id, id));
  if (!coupon) { res.status(404).json({ error: "Coupon not found" }); return; }

  const rows = await db
    .select({
      id: couponRedemptionsTable.id,
      checkoutSessionId: couponRedemptionsTable.checkoutSessionId,
      purchaseAmount: couponRedemptionsTable.purchaseAmount,
      discountAmount: couponRedemptionsTable.discountAmount,
      redeemedAt: couponRedemptionsTable.redeemedAt,
      userId: couponRedemptionsTable.userId,
      userName: sql<string | null>`${usersTable.name}`,
      userEmail: sql<string | null>`${usersTable.email}`,
    })
    .from(couponRedemptionsTable)
    .leftJoin(usersTable, eq(couponRedemptionsTable.userId, usersTable.id))
    .where(
      sql`(${couponRedemptionsTable.couponId} = ${id})
          OR (${couponRedemptionsTable.couponId} IS NULL AND ${couponRedemptionsTable.couponCode} = ${coupon.code})`
    )
    .orderBy(desc(couponRedemptionsTable.redeemedAt));

  res.json(rows);
});

export default router;
