import { Router, type Request, type Response } from "express";
import { db, clientM365ProfilesTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { computeM365Scores } from "../lib/m365-scores";

// ── Quick Win catalog definition ──────────────────────────────────────────────
// The canonical list of Quick Win diagnostics served to clients.
// Centralizing here lets the server control what's available without a
// client-side deploy.
const QUICK_WIN_CATALOG = [
  {
    id: "qw-security",
    title: "Security Baseline Diagnostic",
    description: "Automated scan of your M365 security posture with actionable findings.",
    category: "Security",
    steps: [
      { id: "sec-1", title: "Identity & access scan", type: "auto" },
      { id: "sec-2", title: "Threat protection review", type: "auto" },
      { id: "sec-3", title: "Data protection check", type: "manual" },
    ],
  },
  {
    id: "qw-copilot",
    title: "Copilot Readiness Assessment",
    description: "Evaluate your environment's readiness for Microsoft 365 Copilot deployment.",
    category: "Copilot AI",
    steps: [
      { id: "cop-1", title: "License & seat check", type: "auto" },
      { id: "cop-2", title: "Security prerequisite scan", type: "auto" },
      { id: "cop-3", title: "Data sensitivity review", type: "manual" },
    ],
  },
  {
    id: "qw-governance",
    title: "Governance Health Check",
    description: "Rapid governance maturity scan across your Microsoft 365 tenant.",
    category: "Governance",
    steps: [
      { id: "gov-1", title: "Policy & retention scan", type: "auto" },
      { id: "gov-2", title: "Identity governance review", type: "auto" },
      { id: "gov-3", title: "Compliance report upload", type: "manual" },
    ],
  },
] as const;

const router = Router();

// ── GET /api/portal/quick-win/catalog ─────────────────────────────────────────
// Returns the canonical list of available Quick Win diagnostics.
// Clients fetch this so the list is server-controlled rather than bundled.
router.get("/portal/quick-win/catalog", requireAuth, (_req: Request, res: Response) => {
  res.json(QUICK_WIN_CATALOG);
});

// ── Telemetry builder ─────────────────────────────────────────────────────────
// Generates domain-specific telemetry lines based on the client's actual
// M365 profile flags.  Each line describes what was checked and its result.

type TelemetryMap = Record<string, string[]>;

function buildTelemetry(profile: Record<string, unknown>): TelemetryMap {
  const v = profile as {
    mfaEnforced?: boolean;
    conditionalAccessEnabled?: boolean;
    intuneEnabled?: boolean;
    hasAADP1orP2?: boolean;
    hasDefender?: boolean;
    hasDLP?: boolean;
    usesComplianceCenter?: boolean;
    sensitivityLabelsConfigured?: boolean;
    hasRetentionPolicies?: boolean;
    hasInsiderRisk?: boolean;
    hasCopilotLicenses?: boolean;
    allUsersLicensed?: boolean;
    activeUserPercent?: string;
  };

  const ok = (label: string) => `✓ ${label}`;
  const warn = (label: string) => `⚠ ${label}`;

  return {
    security: [
      "Scanning identity & access management configuration…",
      v.mfaEnforced
        ? ok("Multi-factor authentication: ENFORCED")
        : warn("Multi-factor authentication: NOT ENFORCED"),
      "Checking Conditional Access policies…",
      v.conditionalAccessEnabled
        ? ok("Conditional Access policies: ACTIVE")
        : warn("Conditional Access policies: NOT CONFIGURED"),
      "Verifying endpoint management status…",
      v.intuneEnabled
        ? ok("Microsoft Intune: ENROLLED")
        : warn("Microsoft Intune: NOT ENABLED"),
      "Checking identity protection tier…",
      v.hasAADP1orP2
        ? ok("Azure AD P1/P2: LICENSED")
        : warn("Azure AD P1/P2: NOT LICENSED"),
      "Scanning threat protection coverage…",
      v.hasDefender
        ? ok("Microsoft Defender: ACTIVE")
        : warn("Microsoft Defender: NOT CONFIGURED"),
      "Checking data loss prevention policies…",
      v.hasDLP
        ? ok("DLP policies: CONFIGURED")
        : warn("DLP policies: NOT CONFIGURED"),
      "Validating Compliance Center posture…",
      v.usesComplianceCenter
        ? ok("Compliance Center: IN USE")
        : warn("Compliance Center: NOT CONFIGURED"),
      "Checking sensitivity label deployment…",
      v.sensitivityLabelsConfigured
        ? ok("Sensitivity labels: DEPLOYED")
        : warn("Sensitivity labels: NOT CONFIGURED"),
      "Verifying data retention policies…",
      v.hasRetentionPolicies
        ? ok("Retention policies: ACTIVE")
        : warn("Retention policies: NOT CONFIGURED"),
      "Security baseline analysis complete.",
    ],
    copilot: [
      "Checking Microsoft 365 Copilot license assignments…",
      v.hasCopilotLicenses
        ? ok("Copilot licenses: ASSIGNED")
        : warn("Copilot licenses: NOT ASSIGNED"),
      "Verifying identity security prerequisites…",
      v.mfaEnforced
        ? ok("MFA prerequisite: SATISFIED")
        : warn("MFA prerequisite: NOT MET — required before Copilot deployment"),
      "Checking data governance prerequisites…",
      v.sensitivityLabelsConfigured
        ? ok("Sensitivity labels: DEPLOYED")
        : warn("Sensitivity labels: NOT CONFIGURED — required for Copilot data protection"),
      "Scanning data loss prevention posture…",
      v.hasDLP
        ? ok("DLP policies: CONFIGURED")
        : warn("DLP policies: MISSING — needed to prevent oversharing via Copilot"),
      "Checking retention and compliance settings…",
      v.hasRetentionPolicies
        ? ok("Retention policies: ACTIVE")
        : warn("Retention policies: NOT CONFIGURED"),
      "Copilot readiness assessment complete.",
    ],
    governance: [
      "Scanning data governance policy configuration…",
      v.hasRetentionPolicies
        ? ok("Retention policies: ACTIVE")
        : warn("Retention policies: NOT CONFIGURED"),
      "Checking information protection controls…",
      v.sensitivityLabelsConfigured
        ? ok("Sensitivity labels: DEPLOYED")
        : warn("Sensitivity labels: NOT DEPLOYED"),
      "Verifying insider risk management…",
      v.hasInsiderRisk
        ? ok("Insider Risk Management: ENABLED")
        : warn("Insider Risk Management: NOT CONFIGURED"),
      "Validating compliance management posture…",
      v.usesComplianceCenter
        ? ok("Compliance Center: ACTIVE")
        : warn("Compliance Center: NOT IN USE"),
      "Reviewing identity governance settings…",
      v.conditionalAccessEnabled
        ? ok("Conditional Access governance rules: ENFORCED")
        : warn("Conditional Access: NOT ENFORCED"),
      "Governance health analysis complete.",
    ],
    compliance: [
      "Scanning compliance framework configuration…",
      v.hasDLP
        ? ok("Data Loss Prevention: CONFIGURED")
        : warn("Data Loss Prevention: NOT CONFIGURED"),
      v.usesComplianceCenter
        ? ok("Compliance Center: ACTIVE")
        : warn("Compliance Center: NOT IN USE"),
      v.sensitivityLabelsConfigured
        ? ok("Sensitivity labels: DEPLOYED")
        : warn("Sensitivity labels: MISSING"),
      v.hasRetentionPolicies
        ? ok("Retention policies: ACTIVE")
        : warn("Retention policies: NOT SET"),
      v.hasInsiderRisk
        ? ok("Insider Risk Management: ENABLED")
        : warn("Insider Risk Management: NOT CONFIGURED"),
      "Compliance analysis complete.",
    ],
  };
}

// ── GET /api/portal/quick-win/scorecard ───────────────────────────────────────
// Returns the authenticated client's real M365 scores and domain-specific
// telemetry for each Quick Win category.
router.get("/portal/quick-win/scorecard", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = req.user!.id;

    const profileRow = await db
      .select({ profile: clientM365ProfilesTable.profile })
      .from(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, clientId))
      .limit(1);

    if (profileRow.length === 0 || !profileRow[0].profile) {
      res.json({
        hasProfile: false,
        scores: { security: 0, compliance: 0, copilot: 0, governance: 0, productivity: 0 },
        telemetry: {},
        subsystemsChecked: [],
      });
      return;
    }

    const profile = profileRow[0].profile as Record<string, unknown>;
    const scores = computeM365Scores(profile);
    const telemetry = buildTelemetry(profile);

    res.json({
      hasProfile: true,
      scores,
      telemetry,
      subsystemsChecked: Object.keys(scores),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch scorecard";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/portal/quick-win/escalate ──────────────────────────────────────
// Creates a new engagement project linked to a completed Quick Win diagnostic.
// Returns the new project ID so the client can navigate to it.
router.post("/portal/quick-win/escalate", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = req.user!.id;
    const { quickWinTitle, quickWinId, category } = req.body as {
      quickWinTitle?: string;
      quickWinId?: string;
      category?: string;
    };

    const title = quickWinTitle
      ? `Quick Win: ${quickWinTitle}`
      : "Quick Win Engagement";

    const categoryDescriptions: Record<string, string> = {
      Security: "A targeted engagement to remediate security gaps identified in your Quick Win diagnostic.",
      "Copilot AI": "A structured project to satisfy Copilot prerequisites and accelerate your Microsoft 365 Copilot deployment.",
      Governance: "A governance hardening engagement to address findings from your Quick Win diagnostic.",
    };

    const description =
      categoryDescriptions[category ?? ""] ??
      "An engagement project created from a Quick Win diagnostic.";

    const [project] = await db
      .insert(projectsTable)
      .values({
        title,
        description,
        status: "active",
        phase: "Quick Win Kickoff",
        progress: 0,
        clientUserId: clientId,
        startDate: new Date(),
      })
      .returning({ id: projectsTable.id, title: projectsTable.title });

    req.log.info(
      { clientId, projectId: project.id, quickWinId },
      "Quick Win escalated to project",
    );

    res.status(201).json({ projectId: project.id, title: project.title });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to escalate Quick Win";
    res.status(500).json({ error: msg });
  }
});

export default router;
