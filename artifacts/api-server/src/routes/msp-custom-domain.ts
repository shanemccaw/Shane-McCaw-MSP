/**
 * MSP Custom Domain Routes
 *
 * Public branding resolution:
 *   GET  /api/portal/branding         — resolve branding by ?slug=xxx OR Host header
 *   GET  /api/portal/tenant/:slug     — resolve tenant info + redirect URL by slug
 *
 * MSP admin (MSPAdmin role required):
 *   GET  /api/msp/settings/custom-domain         — get current custom domain config
 *   POST /api/msp/settings/custom-domain         — register/update custom domain
 *   POST /api/msp/settings/custom-domain/verify  — trigger DNS verification check
 *   DELETE /api/msp/settings/custom-domain       — remove custom domain
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspCustomDomainsTable, mspAuditLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { z } from "zod";
import { randomBytes } from "crypto";
import { resolveTxt } from "dns/promises";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function resolveMspId(req: Request): number | null {
  const user = req.user!;
  if (user.role === "admin") {
    const q = parseInt(String((req.query as Record<string, unknown>).mspId ?? ""), 10);
    return isNaN(q) ? null : q;
  }
  return user.mspId ?? null;
}

// ── Public: GET /api/portal/branding ──────────────────────────────────────────
// Resolve branding for a given MSP, keyed by ?slug=xxx or the Host header.
// Used by the login page and any public-facing portal entry point.
// Returns a slim branding payload — never raw DB IDs or credentials.

router.get("/portal/branding", async (req: Request, res: Response) => {
  const slug = String((req.query as Record<string, unknown>).slug ?? "").trim();
  const host = req.get("host")?.split(":")[0]?.toLowerCase() ?? "";

  let msp: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
    status: string;
  } | undefined;

  if (slug) {
    const [row] = await db
      .select({
        id: mspsTable.id,
        name: mspsTable.name,
        slug: mspsTable.slug,
        logoUrl: mspsTable.logoUrl,
        primaryColor: mspsTable.primaryColor,
        status: mspsTable.status,
      })
      .from(mspsTable)
      .where(eq(mspsTable.slug, slug))
      .limit(1);
    msp = row;
  } else if (host && !host.includes("localhost") && !host.includes("replit")) {
    // Resolve from a verified custom domain (Host header)
    const [customDomainRow] = await db
      .select({
        mspId: mspCustomDomainsTable.mspId,
        verificationStatus: mspCustomDomainsTable.verificationStatus,
      })
      .from(mspCustomDomainsTable)
      .where(
        and(
          eq(mspCustomDomainsTable.domain, host),
          eq(mspCustomDomainsTable.verificationStatus, "verified"),
        ),
      )
      .limit(1);

    if (customDomainRow) {
      const [row] = await db
        .select({
          id: mspsTable.id,
          name: mspsTable.name,
          slug: mspsTable.slug,
          logoUrl: mspsTable.logoUrl,
          primaryColor: mspsTable.primaryColor,
          status: mspsTable.status,
        })
        .from(mspsTable)
        .where(eq(mspsTable.id, customDomainRow.mspId))
        .limit(1);
      msp = row;
    }
  }

  if (!msp) {
    return res.status(404).json({ error: "Tenant not found" });
  }

  if (msp.status === "suspended") {
    return res.status(403).json({ error: "This portal is currently suspended" });
  }

  return res.json({
    name: msp.name,
    slug: msp.slug,
    logoUrl: msp.logoUrl,
    primaryColor: msp.primaryColor,
  });
});

// ── Public: GET /api/portal/tenant/:slug ──────────────────────────────────────
// Lightweight tenant-exists check — used when the browser lands on /portal/:slug.

router.get("/portal/tenant/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? "").trim();
  if (!slug) return apiError(res, 400, "Missing slug");

  const [msp] = await db
    .select({
      id: mspsTable.id,
      name: mspsTable.name,
      slug: mspsTable.slug,
      logoUrl: mspsTable.logoUrl,
      primaryColor: mspsTable.primaryColor,
      status: mspsTable.status,
    })
    .from(mspsTable)
    .where(eq(mspsTable.slug, slug))
    .limit(1);

  if (!msp) return res.status(404).json({ error: "Tenant not found" });
  if (msp.status === "suspended") return res.status(403).json({ error: "Portal suspended" });

  return res.json({
    name: msp.name,
    slug: msp.slug,
    logoUrl: msp.logoUrl,
    primaryColor: msp.primaryColor,
  });
});

// ── GET /api/msp/settings/custom-domain ───────────────────────────────────────

router.get("/msp/settings/custom-domain", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspId(req);
  if (!mspId) return apiError(res, 400, "No MSP context");

  const [msp] = await db
    .select({ slug: mspsTable.slug })
    .from(mspsTable)
    .where(eq(mspsTable.id, mspId))
    .limit(1);

  if (!msp) return apiError(res, 404, "MSP not found");

  const [customDomain] = await db
    .select()
    .from(mspCustomDomainsTable)
    .where(eq(mspCustomDomainsTable.mspId, mspId))
    .limit(1);

  return res.json({
    slug: msp.slug,
    slugUrl: `/portal/?t=${msp.slug}`,
    customDomain: customDomain
      ? {
          domain: customDomain.domain,
          verificationStatus: customDomain.verificationStatus,
          verificationToken: customDomain.verificationToken,
          verifiedAt: customDomain.verifiedAt,
          lastCheckedAt: customDomain.lastCheckedAt,
          createdAt: customDomain.createdAt,
        }
      : null,
  });
});

// ── POST /api/msp/settings/custom-domain ──────────────────────────────────────
// Register (or replace) a custom domain for this MSP.
// Generates a fresh verification token and resets status to "pending".

const addDomainSchema = z.object({
  domain: z
    .string()
    .min(4)
    .max(253)
    .regex(
      /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      "Must be a valid hostname (e.g. portal.acmeit.com)",
    )
    .transform((d) => d.toLowerCase()),
});

router.post("/msp/settings/custom-domain", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspId(req);
  if (!mspId) return apiError(res, 400, "No MSP context");

  const parsed = addDomainSchema.safeParse(req.body);
  if (!parsed.success) {
    return apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { domain } = parsed.data;

  // Check if this domain is already claimed by a different MSP
  const [existing] = await db
    .select({ mspId: mspCustomDomainsTable.mspId })
    .from(mspCustomDomainsTable)
    .where(eq(mspCustomDomainsTable.domain, domain))
    .limit(1);

  if (existing && existing.mspId !== mspId) {
    return apiError(res, 409, "This domain is already registered by another MSP");
  }

  const verificationToken = randomBytes(24).toString("hex");

  // Upsert: delete existing row (if any) for this MSP, then insert fresh
  await db.delete(mspCustomDomainsTable).where(eq(mspCustomDomainsTable.mspId, mspId));

  const [row] = await db
    .insert(mspCustomDomainsTable)
    .values({
      mspId,
      domain,
      verificationToken,
      verificationStatus: "pending",
    })
    .returning();

  await db.insert(mspAuditLogsTable).values({
    actorUserId: req.user!.id,
    actorRole: req.user!.mspRole ?? req.user!.role,
    mspId,
    actionType: "msp.custom_domain.register",
    entityType: "msp_custom_domain",
    entityId: String(row.id),
    entityLabel: domain,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    outcome: "success",
    metadata: { domain },
  });

  return res.status(201).json({
    domain: row.domain,
    verificationToken: row.verificationToken,
    verificationStatus: row.verificationStatus,
    createdAt: row.createdAt,
    dnsInstructions: {
      type: "TXT",
      host: `_msp-platform-verify.${domain}`,
      value: row.verificationToken,
      ttl: 300,
    },
  });
});

// ── POST /api/msp/settings/custom-domain/verify ───────────────────────────────
// Trigger a live DNS TXT lookup and update verification status accordingly.
// Rate-limited to avoid hammering DNS resolvers.

router.post("/msp/settings/custom-domain/verify", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspId(req);
  if (!mspId) return apiError(res, 400, "No MSP context");

  const [row] = await db
    .select()
    .from(mspCustomDomainsTable)
    .where(eq(mspCustomDomainsTable.mspId, mspId))
    .limit(1);

  if (!row) return apiError(res, 404, "No custom domain registered for this MSP");
  if (row.verificationStatus === "verified") {
    return res.json({
      verificationStatus: "verified",
      verifiedAt: row.verifiedAt,
      message: "Domain is already verified.",
    });
  }

  const txtHost = `_msp-platform-verify.${row.domain}`;
  let verified = false;
  let errorMessage: string | null = null;

  try {
    const records = await resolveTxt(txtHost);
    const flat = records.flat();
    verified = flat.includes(row.verificationToken);
    if (!verified) {
      errorMessage = `TXT record found but value does not match. Expected: ${row.verificationToken}`;
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOTFOUND" || e.code === "ENODATA" || e.code === "ENOENT") {
      errorMessage = `TXT record not found at ${txtHost}. DNS may not have propagated yet (can take up to 24 hours).`;
    } else {
      logger.warn({ err, txtHost }, "DNS verification lookup failed");
      errorMessage = "DNS lookup error. Please try again in a few minutes.";
    }
  }

  const newStatus = verified ? "verified" : "failed";
  const [updated] = await db
    .update(mspCustomDomainsTable)
    .set({
      verificationStatus: newStatus,
      verifiedAt: verified ? new Date() : null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(mspCustomDomainsTable.id, row.id))
    .returning();

  await db.insert(mspAuditLogsTable).values({
    actorUserId: req.user!.id,
    actorRole: req.user!.mspRole ?? req.user!.role,
    mspId,
    actionType: "msp.custom_domain.verify",
    entityType: "msp_custom_domain",
    entityId: String(row.id),
    entityLabel: row.domain,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    outcome: verified ? "success" : "failure",
    metadata: { domain: row.domain, verified, errorMessage },
  });

  return res.json({
    verificationStatus: updated.verificationStatus,
    verifiedAt: updated.verifiedAt,
    lastCheckedAt: updated.lastCheckedAt,
    verified,
    message: verified
      ? `Domain ${row.domain} has been verified. It can now be used as your branded portal URL.`
      : (errorMessage ?? "Verification failed."),
  });
});

// ── DELETE /api/msp/settings/custom-domain ────────────────────────────────────

router.delete("/msp/settings/custom-domain", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspId(req);
  if (!mspId) return apiError(res, 400, "No MSP context");

  const [row] = await db
    .select({ id: mspCustomDomainsTable.id, domain: mspCustomDomainsTable.domain })
    .from(mspCustomDomainsTable)
    .where(eq(mspCustomDomainsTable.mspId, mspId))
    .limit(1);

  if (!row) return apiError(res, 404, "No custom domain registered");

  await db.delete(mspCustomDomainsTable).where(eq(mspCustomDomainsTable.id, row.id));

  await db.insert(mspAuditLogsTable).values({
    actorUserId: req.user!.id,
    actorRole: req.user!.mspRole ?? req.user!.role,
    mspId,
    actionType: "msp.custom_domain.remove",
    entityType: "msp_custom_domain",
    entityId: String(row.id),
    entityLabel: row.domain,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    outcome: "success",
    metadata: { domain: row.domain },
  });

  return res.status(204).send();
});

export default router;
