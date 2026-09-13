import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Nav } from "../components/Nav";
import { FreeScanReturnLinkRequest } from "../components/FreeScanReturnLinkRequest";
import { Footer } from "../components/Footer";
import { useSignalCheckCount } from "../../hooks/useSignalCheckCount";
import { logger } from "../../lib/logger";
import { RevealNoScanGate } from "@workspace/copilot-scan-scene/RevealNoScanGate";

// Consent + lead capture are the server's `auth`/`growth` work (#1361); the client call sites are
// mirrored onto the same channel so the logs read together.
const authLog = logger.child({ channel: "auth" });

// Route /scan — recreated from Design/free-scan-consent-export/Marketing Free Scan.dc.html.
// The site's primary conversion path: a start form, a real read-only consent gate, a live-looking
// six-sector acquisition wheel, then results with findings by severity. Colours, spacing, motion
// and copy are the design's own — copy is final and reproduced verbatim.
//
// This page manages its own chrome rather than using MarketingLayout: the design shows the full
// Nav only on the start screen and swaps to a slim consent breadcrumb once the visitor moves past
// it, so the outer shell is rebuilt here around those states. The Footer is shared.
//
// REAL, per Git #1361 — the consent gate is not a mock:
//   - The start form captures a real lead (name/company/work email) via
//     POST /api/public/free-scan/start → ensureLeadForEmail, fired BEFORE consent so an
//     abandoned grant still keeps the lead.
//   - grantRead() opens Microsoft's own consent screen in a popup against the real read-only app
//     registration (the #1311 session-keyed read-consent mechanism: checkout-session →
//     read-consent-url → callback) and polls consent-status until the grant lands, then resumes at
//     scanning. Declining / closing the window returns to the start form with the form intact.
//   - The consent screen's scopes card and "not requested" list are generated from the read app's
//     real scope list (REQUIRED_MT_SCOPES, returned by the start endpoint) so they cannot drift
//     from what Microsoft actually asks for.
//
// REAL, per Git #1358 (Phase 6) — the results screen is not a mock either:
//   - Once the six-sector loading animation finishes, the page polls
//     GET /api/public/free-scan/results?sessionId=... (public-free-scan-results.ts), the SAME real
//     computation (buildPillarSummary) the entire authenticated portal's /api/portal/pillars reads.
//     Identity is resolved server-side from the free-scan sessionId already in the browser — this
//     Prospect never gets a JWT (#656's hasRealEntitlement gate) — never from anything this page
//     supplies as a customerId.
//   - The endpoint also calls the #3946 backstop, so a consent-time scan that failed to even start
//     gets kicked off here. Until the real run has settled, this page shows a genuine "scan in
//     progress" state (the shared Scene 0 `RevealNoScanGate`, #1357) and polls rather than showing
//     an empty/broken results view.
//   - Every real pillar score and every real finding (severity, title, the actual evidence items,
//     why it matters) is shown — that IS the free scan's promise. The one thing genuinely withheld
//     is the fix/action itself (`recommendation`), which the results endpoint never puts on the
//     wire at all — Monitoring is what pays for that, not a client-side hide of real data.
//
// STILL SIMULATED, per the handoff README's "Out of scope" list: the six-sector loading animation
// itself (the wedge fill / finding-cue flavor text in SECTORS below) still runs on a fixed client
// timer rather than live per-check progress — there is no public, session-scoped live-progress feed
// for an anonymous Prospect (that would be real streaming infrastructure, not this page). The
// animation is cosmetic scaffolding for the wait; the RESULTS it hands off to are real.

type Phase = "start" | "consent" | "granting" | "scanning" | "results";

interface WheelVals {
  sc: number;
  count: number;
  spin: boolean;
  w: number[]; // per-sector fill opacity
  d: string[]; // per-sector wedge path
  c: number[][]; // per-sector, per-cue reveal opacity
}

// ── Icons ────────────────────────────────────────────────────────────────────
// The design's ICONS set (minimal stroke glyphs). Kept as inline SVG — verbatim paths — to match
// the design exactly, the same choice the sibling Nav/Footer made for their glyphs.
function Icon({
  size = 16,
  strokeWidth = 1.8,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const iconEye = (s: number) => (
  <Icon size={s}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const iconShield = (s: number) => (
  <Icon size={s}>
    <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
    <polyline points="9 12 11 14 15 10" />
  </Icon>
);
const iconFile = (s: number) => (
  <Icon size={s}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <polyline points="14 3 14 8 19 8" />
  </Icon>
);
const iconClock = (s: number) => (
  <Icon size={s}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </Icon>
);
const iconLock = (s: number) => (
  <Icon size={s}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </Icon>
);
const iconCheck = (s: number) => (
  <Icon size={s}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);
const iconArrow = (s: number) => (
  <Icon size={s}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="14 6 20 12 14 18" />
  </Icon>
);

// ── Static copy / fixture data (lifted verbatim from the design) ──────────────

const PLAIN_PILLARS: { name: string; plain: string }[] = [
  {
    name: "Security",
    plain:
      "Who can get in, and what they can reach once they are in — sign-in protection, admin accounts, risky app permissions.",
  },
  {
    name: "Sharing and exposure",
    plain:
      "What is shared outside the company, on purpose or by accident — links, guests, external members.",
  },
  {
    name: "Governance",
    plain:
      "Whether someone owns each Team, site and group, and whether anything is cleaned up when a project ends.",
  },
  {
    name: "Compliance and records",
    plain:
      'Whether you could actually answer "who did what, when" later — audit history, retention, legal holds.',
  },
  {
    name: "Licensing",
    plain: "What you are paying Microsoft for compared with what people actually use.",
  },
  {
    name: "Health and drift",
    plain:
      '"Drift" means settings quietly changing over time. This is whether your tenant still matches how it was set up.',
  },
];

const PROMISES: {
  title: string;
  body: string;
  icon: React.ReactNode;
  wrap: { bg: string; border: string; color: string };
}[] = [
  {
    title: "Read-only, always",
    body: "We read your configuration through Microsoft Graph. Nothing is written, changed, deleted or emailed to your users.",
    icon: iconEye(17),
    wrap: { bg: "rgba(59,130,246,.1)", border: "rgba(59,130,246,.22)", color: "#60a5fa" },
  },
  {
    title: "No agents, no passwords",
    body: "You approve a scoped connection in Microsoft’s own consent screen, and you can revoke it from your tenant whenever you like.",
    icon: iconShield(17),
    wrap: { bg: "rgba(52,211,153,.1)", border: "rgba(52,211,153,.22)", color: "#34d399" },
  },
  {
    title: "Real findings, in plain English",
    body: "Every problem comes with the actual files, accounts and settings behind it — so you can check any of it yourself.",
    icon: iconFile(17),
    wrap: { bg: "rgba(167,139,250,.1)", border: "rgba(167,139,250,.22)", color: "#a78bfa" },
  },
  {
    title: "Yours to keep",
    body: "The results are yours whether you buy anything or not. No sales call is scheduled by running this.",
    icon: iconClock(17),
    wrap: { bg: "rgba(148,163,184,.1)", border: "rgba(148,163,184,.22)", color: "#94a3b8" },
  },
];

// Six scan steps drive the timer; the wheel and labels read off `step`. Only `label` is rendered
// (via CHECKS below); the other fields mirror the design's data shape.
const SCAN_STEPS = [
  { label: "Connecting to your tenant" },
  { label: "Reading identities and admin roles" },
  { label: "Checking sharing links across SharePoint and OneDrive" },
  { label: "Reading guest access and external members" },
  { label: "Reading licences against actual usage" },
  { label: "Reading retention, DLP and audit configuration" },
];

const CHECKS = [
  "Reading tenant organisation profile",
  "Enumerating Entra ID directory roles",
  "Reading Conditional Access policies",
  "Evaluating legacy authentication protocols",
  "Reading MFA registration state",
  "Checking privileged role assignments",
  "Reading SharePoint sharing exposure",
  "Enumerating site collections",
  "Checking org-wide sharing links",
  "Reading anonymous link expiry",
  "Evaluating external sharing domains",
  "Reading OneDrive activation state",
  "Enumerating Microsoft 365 Groups",
  "Checking group ownership",
  "Reading Teams lifecycle policy",
  "Evaluating guest access configuration",
  "Reading sensitivity label coverage",
  "Checking DLP policy scope",
  "Reading retention policy assignment",
  "Evaluating audit log retention",
  "Reading licence assignment by SKU",
  "Checking unassigned licences",
  "Evaluating duplicate service plans",
  "Reading Copilot seat activity",
  "Checking configuration baseline drift",
  "Reading admin change history",
  "Evaluating service health signals",
  "Compiling readiness signal",
];

// The six wheel sectors, index-ordered from the top and clockwise, matching the wheel geometry
// (k=0 top). Each carries its pillar colour, its screen position within the 1000×700 stage, its
// stroke glyph (verbatim from the design's scanning markup), and its three finding cues.
const SECTORS: {
  key: string;
  color: string;
  pos: { left: number; top: number };
  icon: React.ReactNode;
  cues: string[];
}[] = [
  {
    key: "Governance",
    color: "#3B82F6",
    pos: { left: 500, top: 92 },
    icon: (
      <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.3 0C14.3 3.8 16.8 5 18.8 5a1 1 0 0 1 1 1zM9 12l2 2 4-4" />
    ),
    cues: ["212 sites shared org-wide", "1,847 sites in scope", "No lifecycle policy"],
  },
  {
    key: "Security",
    color: "#8B5CF6",
    pos: { left: 723, top: 221 },
    icon: (
      <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.3 0C14.3 3.8 16.8 5 18.8 5a1 1 0 0 1 1 1z" />
    ),
    cues: ["14 accounts without MFA", "4 Global Admins exposed", "Legacy auth still enabled"],
  },
  {
    key: "Compliance",
    color: "#F3F4F6",
    pos: { left: 723, top: 479 },
    icon: (
      <>
        <path d="M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
        <path d="M9 15l2 2 3.5-4" />
      </>
    ),
    cues: ["0 DLP policies on Teams", "61% of files unlabelled", "No retention on chat"],
  },
  {
    key: "Licensing",
    color: "#14B8A6",
    pos: { left: 500, top: 608 },
    icon: (
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6" />
    ),
    cues: ["$18,400 unassigned", "96 seats need E5", "31 duplicate service plans"],
  },
  {
    key: "Adoption",
    color: "#F97316",
    pos: { left: 277, top: 479 },
    icon: (
      <path d="M18 21a8 8 0 0 0-16 0M10 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    ),
    cues: ["412 users dormant", "OneDrive at 31%", "2 departments inactive"],
  },
  {
    key: "Health",
    color: "#22C55E",
    pos: { left: 277, top: 221 },
    icon: (
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    ),
    cues: ["37 unreviewed changes", "No drift baseline", "Audit log at 90 days"],
  },
];

// Static background wedges (opacity .05), index-ordered with SECTORS.
const SECTOR_BG = [
  "M -107.0 -185.3 A 214 214 0 0 1 107.0 -185.3 L 52.0 -90.1 A 104 104 0 0 0 -52.0 -90.1 Z",
  "M 107.0 -185.3 A 214 214 0 0 1 214.0 -0.0 L 104.0 -0.0 A 104 104 0 0 0 52.0 -90.1 Z",
  "M 214.0 -0.0 A 214 214 0 0 1 107.0 185.3 L 52.0 90.1 A 104 104 0 0 0 104.0 -0.0 Z",
  "M 107.0 185.3 A 214 214 0 0 1 -107.0 185.3 L -52.0 90.1 A 104 104 0 0 0 52.0 90.1 Z",
  "M -107.0 185.3 A 214 214 0 0 1 -214.0 0.0 L -104.0 0.0 A 104 104 0 0 0 -52.0 90.1 Z",
  "M -214.0 0.0 A 214 214 0 0 1 -107.0 -185.3 L -52.0 -90.1 A 104 104 0 0 0 -104.0 0.0 Z",
];

// Hub→rim divider lines between the six sectors.
const DIVIDERS: [number, number, number, number][] = [
  [-52.0, -90.1, -107.0, -185.3],
  [52.0, -90.1, 107.0, -185.3],
  [104.0, -0.0, 214.0, -0.0],
  [52.0, 90.1, 107.0, 185.3],
  [-52.0, 90.1, -107.0, 185.3],
  [-104.0, 0.0, -214.0, 0.0],
];

// ── REAL RESULTS — the wire shape GET /api/public/free-scan/results returns ──
// (public-free-scan-results.ts). Mirrors that route's response, not the fixture
// this replaced (Git #1358) — see that file's own header for what is and is not
// on this wire (notably: never `recommendation`, the fix itself).

/** The six War Room pillar keys this page ever displays — `copilot` is the
 *  authenticated portal's roll-up card and is never part of the Free Scan. */
const DISPLAY_PILLAR_KEYS = ["governance", "security", "compliance", "licensing", "adoption", "health"] as const;
type DisplayPillarKey = (typeof DISPLAY_PILLAR_KEYS)[number];

const PILLAR_LABELS: Record<DisplayPillarKey, string> = {
  governance: "Governance",
  security: "Security",
  compliance: "Compliance",
  licensing: "Licensing",
  adoption: "Adoption",
  health: "Health",
};

type RealFindingSeverity = "critical" | "warning";
type DisplaySeverity = "Urgent" | "Needs attention";
const SEVERITY_LABEL: Record<RealFindingSeverity, DisplaySeverity> = {
  critical: "Urgent",
  warning: "Needs attention",
};

interface RealFinding {
  severity: RealFindingSeverity;
  checkKey: string;
  title: string;
  description: string | null;
  whyItMatters: string | null;
  evidence: Record<string, unknown> | null;
}

interface RealPillarCard {
  pillar: string;
  score: number | null;
  evaluation: { status: "scored" | "insufficient_data" | "not_evaluated" };
  findingCounts: { critical: number; warning: number };
  findings: RealFinding[];
}

interface FreeScanResultsReady {
  status: "ready";
  generatedAt: string;
  totalFindings: number;
  criticalFindings: number;
  annualWasteDollars: number | null;
  pillars: RealPillarCard[];
}

interface FreeScanResultsScanning {
  status: "scanning";
  activeRunId: string | null;
  findingsRunId: string | null;
}

type FreeScanResultsResponse = FreeScanResultsReady | FreeScanResultsScanning;

/** A finding flattened for display, with its pillar's label attached and its
 *  real evidence reduced to a plain string list (evidence is a curated
 *  name-list subset, `{ [field]: string[] }`, or null). */
interface DisplayFinding {
  severity: DisplaySeverity;
  area: string;
  title: string;
  meaning: string | null;
  why: string | null;
  evidenceItems: string[];
}

function evidenceItems(evidence: Record<string, unknown> | null): string[] {
  if (!evidence) return [];
  const [, values] = Object.entries(evidence)[0] ?? [];
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [];
}

function flattenFindings(pillars: RealPillarCard[]): DisplayFinding[] {
  const flattened: DisplayFinding[] = [];
  for (const pillar of pillars) {
    const label = PILLAR_LABELS[pillar.pillar as DisplayPillarKey] ?? pillar.pillar;
    for (const f of pillar.findings) {
      flattened.push({
        severity: SEVERITY_LABEL[f.severity],
        area: label,
        title: f.title,
        meaning: f.description,
        why: f.whyItMatters,
        evidenceItems: evidenceItems(f.evidence),
      });
    }
  }
  // Worst first — critical before warning; stable within each tier (server
  // already ranks each pillar's own list by real signal weight).
  return flattened.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "Urgent" ? -1 : 1));
}

// ── Git #1359: return visits via the emailed results link ────────────────────
// /scan/results renders this same page straight into its results phase. Identity comes from the
// narrowly-scoped return-link token in the URL FRAGMENT (#t=fsr_…) — fragments never reach a server
// or a Referer — exchanged only for POST /api/public/free-scan/return-link/results, which serves the
// SAME locked payload as the live flow's GET /api/public/free-scan/results. It is not a login.
const RETURN_TOKEN_STORAGE_KEY = "freeScanReturnToken";
type ReturnLinkProblem = "no_token" | "link_invalid" | "link_expired" | "link_not_applicable";
const RETURN_LINK_PROBLEM_MESSAGE: Record<ReturnLinkProblem, string> = {
  no_token: "Open the link from the email we sent when you ran your free scan, or we can send you a new one.",
  link_invalid: "We couldn't open that link — it may have been copied incompletely. We can send you a new one.",
  link_expired: "That results link has expired. Links last 14 days, and a newer link replaces an older one.",
  link_not_applicable: "This link only works for free scan results, and your account has moved on from the free scan. Sign in to see your tenant.",
};

function readReturnToken(): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const fromHash = new URLSearchParams(hash).get("t");
  if (fromHash) {
    // Kept for this tab only, and taken out of the address bar so it is not bookmarked or shared
    // along with the page.
    sessionStorage.setItem(RETURN_TOKEN_STORAGE_KEY, fromHash);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromHash;
  }
  return sessionStorage.getItem(RETURN_TOKEN_STORAGE_KEY);
}

function formatResultDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

const LOCKED_CAPABILITIES = [
  "Running any of the fixes above against your tenant",
  "Tracking a finding from raised to closed, with a record of who closed it",
  "Being told the day one of these comes back, instead of finding out next year",
  "The written procedure and evidence behind each fix, for your auditor",
];
const QUOTE_PRICE = "$1,240";
const QUOTE_BASIS =
  "Growth tier, 1,240 seats, Enterprise bracket — less than the licence waste this scan just found.";

// The scan already granted read-only consent, so the monitoring checkout can skip re-connecting:
// ?product=monitoring&scanned=1 is the flow the handoff README documents for exactly this case.
const CHECKOUT_HREF = "/buy?product=monitoring&scanned=1";

// ── Read-consent screen data (Git #1361) ─────────────────────────────────────
// The real catalog slug the consent-bearing checkout session is created against — a FREE
// assessment, so there is no payment gate; the session only carries the OAuth `state` that binds
// the tenant's grant to this scan. Read consent for an assessment product is REQUIRED
// (lib/read-consent-flow.ts), which is exactly what the scan needs.
const FREE_SCAN_PRODUCT_SLUG = "license-waste-audit-free";

// Plain-English reason per read scope (design copy, final). These are DISPLAY reasons only — the
// list actually shown is intersected with the read app's real REQUIRED_MT_SCOPES (fetched from
// /api/public/free-scan/start), so the card can never advertise a scope the registration does not
// request. If a curated scope leaves the manifest, it drops from the card — the code wins, per the
// README ("If it drifts, the whole screen becomes a liability").
const READ_SCOPE_REASONS: { scope: string; why: string }[] = [
  { scope: "Organization.Read.All", why: "Tenant profile, verified domains and the licence counts your seat numbers come from." },
  { scope: "Directory.Read.All", why: "Users, groups, directory roles and guests — who exists and what they hold." },
  { scope: "Policy.Read.All", why: "Conditional Access, authentication methods and whether legacy auth is still open." },
  { scope: "Sites.Read.All", why: "Site collections and sharing settings, to find anonymous links and external exposure. Site metadata only." },
  { scope: "Reports.Read.All", why: "Usage and activity aggregates behind adoption findings. Counts, not content." },
  { scope: "AuditLog.Read.All", why: "Recent configuration changes, so drift and unreviewed changes can be identified." },
];

// The counter-list — each entry names a sensitive scope this registration does NOT hold. Shown
// only while the real scope list genuinely lacks it (asserted against the fetched array), so the
// "we can't do this" promise can never outlive the manifest that made it true. The write check is
// on ".ReadWrite" only: read scopes carry ".All" (Directory.Read.All …), so ".All" is not a
// write signal.
const NOT_REQUESTED: { label: string; absentToken: string }[] = [
  { label: "Mail.Read — no mailbox, message or attachment is ever read", absentToken: "Mail.Read" },
  { label: "Files.Read — file names and sharing state only, never file contents", absentToken: "Files.Read" },
  { label: "Chat.Read — no Teams message or meeting recording is opened", absentToken: "Chat.Read" },
  { label: "Any .ReadWrite or .All write scope — this registration cannot change a single setting", absentToken: ".ReadWrite" },
];

// Given the read app's real scopes, the (curated ∩ real) list the consent card renders. Falls back
// to the full curated set if the fetch has not landed yet — that set was verified against the
// manifest in code, so it is a safe default, not a drift.
function scopesToShow(realScopes: string[]): { scope: string; why: string }[] {
  if (!realScopes.length) return READ_SCOPE_REASONS;
  return READ_SCOPE_REASONS.filter((r) => realScopes.includes(r.scope));
}

// A not-requested item is shown only if the real scope list truly lacks its token.
function notRequestedToShow(realScopes: string[]): string[] {
  return NOT_REQUESTED.filter(
    (nr) => !realScopes.some((s) => (nr.absentToken === ".ReadWrite" ? s.includes(".ReadWrite") : s === nr.absentToken)),
  ).map((nr) => nr.label);
}

// ── Geometry ─────────────────────────────────────────────────────────────────
const CL = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)));

// Six-sector wheel geometry: each sector grows from the hub to the rim on its own staggered slice
// of the scan (t = 0→1), and its three finding cues fade in as it fills.
function wheelVals(t: number, vw: number, vh: number, rm: boolean, paused: boolean, signals: number): WheelVals {
  // the scanner owns the viewport: fit it to whichever axis is tighter
  const sc = Math.min(1, (vw - 80) / 1060, (vh - 168) / 700);
  const PT = (rad: number, ang: number) => {
    const a = (ang * Math.PI) / 180;
    return `${(rad * Math.sin(a)).toFixed(1)} ${(-rad * Math.cos(a)).toFixed(1)}`;
  };
  const R1 = 104;
  const R2 = 214;
  const r: WheelVals = { sc, count: Math.round(signals * t), spin: !rm && !paused, w: [], d: [], c: [] };
  for (let k = 0; k < 6; k++) {
    const pp = CL(t, k * 0.05, k * 0.05 + 0.74);
    const a1 = k * 60 - 30;
    const a2 = k * 60 + 30;
    const rr = R1 + (R2 - R1) * pp;
    r.w[k] = pp > 0 ? 0.58 + 0.42 * pp : 0;
    r.d[k] =
      pp <= 0
        ? ""
        : `M ${PT(rr, a1)} A ${rr} ${rr} 0 0 1 ${PT(rr, a2)} L ${PT(R1, a2)} A ${R1} ${R1} 0 0 0 ${PT(R1, a1)} Z`;
    r.c[k] = [0.3, 0.56, 0.82].map((th) => CL(pp, th, th + 0.1));
  }
  return r;
}

// ── The animated wheel ───────────────────────────────────────────────────────
function ScannerWheel({ r }: { r: WheelVals }) {
  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "relative", width: 1000, height: 700, flex: "none", transform: `scale(${r.sc})` }}>
        <svg
          viewBox="-260 -260 520 520"
          width={520}
          height={520}
          style={{ position: "absolute", left: 500, top: 350, transform: "translate(-50%,-50%)", overflow: "visible" }}
        >
          <defs>
            {SECTORS.map((s, k) => (
              <radialGradient key={k} id={`wg${k}`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="214">
                <stop offset="0.47" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="0.56" stopColor={s.color} stopOpacity="1" />
                <stop offset="0.78" stopColor={s.color} stopOpacity="0.42" />
                <stop offset="1" stopColor={s.color} stopOpacity="0.06" />
              </radialGradient>
            ))}
            <radialGradient id="hubGlow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="122">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
              <stop offset="0.34" stopColor="#22D3EE" stopOpacity="0.26" />
              <stop offset="0.72" stopColor="#3B82F6" stopOpacity="0.16" />
              <stop offset="1" stopColor="#020617" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sheen" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="214">
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="0" cy="0" r="122" fill="url(#hubGlow)" />
          <circle cx="0" cy="0" r="214" fill="none" stroke="rgba(148,163,184,.16)" strokeWidth="1" />
          <circle cx="0" cy="0" r="104" fill="none" stroke="rgba(148,163,184,.14)" strokeWidth="1" />
          {SECTORS.map((s, k) => (
            <React.Fragment key={k}>
              <path d={SECTOR_BG[k]} style={{ fill: s.color, opacity: 0.05 }} />
              <path d={r.d[k]} fill={`url(#wg${k})`} style={{ opacity: r.w[k] }} />
            </React.Fragment>
          ))}
          {DIVIDERS.map((ln, i) => (
            <line key={i} x1={ln[0]} y1={ln[1]} x2={ln[2]} y2={ln[3]} stroke="rgba(2,6,23,.55)" strokeWidth="1.5" />
          ))}
          <g>
            <path
              d="M 0.0 -214.0 A 214 214 0 0 1 192.3 -93.8 L 93.5 -45.6 A 104 104 0 0 0 0.0 -104.0 Z"
              fill="url(#sheen)"
            />
            <line x1="0" y1="-104" x2="0" y2="-214" stroke="#e0f7ff" strokeWidth="1" strokeOpacity=".5" />
            {r.spin && (
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0 0 0"
                to="360 0 0"
                dur="9s"
                repeatCount="indefinite"
              />
            )}
          </g>
        </svg>

        {/* Centre readout */}
        <div
          style={{
            position: "absolute",
            left: 500,
            top: 350,
            transform: "translate(-50%,-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            textAlign: "center",
            width: 180,
          }}
        >
          <span
            style={{
              fontSize: 52,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: "#f1f5f9",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {r.count}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            of 150+ signals
          </span>
        </div>

        {/* The six sector labels + revealing finding cues */}
        {SECTORS.map((s, k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: s.pos.left,
              top: s.pos.top,
              transform: "translate(-50%,-50%)",
              width: 236,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: s.color, marginBottom: 2 }}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {s.icon}
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase" }}>
                {s.key}
              </span>
            </div>
            {s.cues.map((cue, j) => (
              <div
                key={j}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(15,23,42,.92)",
                  border: `1px solid ${s.color}59`,
                  borderRadius: 999,
                  padding: "4px 10px",
                  transition: "opacity 500ms",
                  opacity: r.c[k][j],
                }}
              >
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: s.color, flex: "none" }} />
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap" }}>{cue}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── The consent breadcrumb shown once the scan begins ────────────────────────
function ConsentBreadcrumb({ phase }: { phase: Phase }) {
  const labels = ["Consent", "Scan", "Results", "Review", "Remediate"];
  // Consent is the current step through both the disclosure screen and the granting interstitial;
  // Scan is current once the wheel is running; Results once findings are shown.
  const at = phase === "results" ? 2 : phase === "consent" || phase === "granting" ? 0 : 1;
  return (
    <div
      style={{
        borderBottom: "1px solid rgba(30,41,59,.9)",
        background: "rgba(2,6,23,.92)",
        padding: "12px 32px",
        display: "flex",
        alignItems: "center",
        gap: 26,
        flexWrap: "wrap",
      }}
    >
      <Link
        href="/"
        style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, color: "inherit", textDecoration: "none" }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12.5,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          SM
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap" }}>Shane McCaw</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
        {labels.map((label, i) => {
          const state = i < at ? "done" : i === at ? "now" : "next";
          return (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  flexShrink: 0,
                  ...(state === "done"
                    ? { color: "#34d399", background: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.3)" }
                    : state === "now"
                    ? { color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }
                    : { color: "#64748b", background: "rgba(255,255,255,.05)", border: "1px solid rgba(71,85,105,.35)" }),
                }}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  letterSpacing: ".02em",
                  color: state === "next" ? "#475569" : state === "now" ? "#f8fafc" : "#94a3b8",
                }}
              >
                {label}
              </span>
              <span style={{ fontSize: 11, color: "#334155", margin: "0 2px", display: i === 4 ? "none" : "inline" }}>
                →
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// A shared "what the six areas mean" strip, used on both the start and results screens.
function PlainPillars({ heading }: { heading: string }) {
  return (
    <section style={{ padding: "0 32px 40px" }}>
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          padding: 22,
          borderRadius: 16,
          border: "1px solid rgba(30,41,59,.9)",
          background: "rgba(255,255,255,.02)",
        }}
      >
        <h2 style={{ fontSize: 13.5, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px" }}>{heading}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
          {PLAIN_PILLARS.map((pp) => (
            <div key={pp.name}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 3 }}>{pp.name}</div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>{pp.plain}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const sevColor = (sev: DisplaySeverity) => (sev === "Urgent" ? "#f87171" : "#fbbf24");
const sevBg = (sev: DisplaySeverity) => (sev === "Urgent" ? "rgba(248,113,113,.12)" : "rgba(251,191,36,.12)");
const sevBorder = (sev: DisplaySeverity) => (sev === "Urgent" ? "rgba(248,113,113,.3)" : "rgba(251,191,36,.3)");

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FreeScan() {
  return <FreeScanPage returnMode={false} />;
}

/** Git #1359 — /scan/results: the same page, opened on its results phase from the emailed return link. */
export function FreeScanReturn() {
  return <FreeScanPage returnMode />;
}

function FreeScanPage({ returnMode }: { returnMode: boolean }) {
  const signals = useSignalCheckCount();
  // Git #1359: a return visit (/scan/results) has no form to fill and no consent to grant — it opens
  // on the results phase and reads through the emailed return-link token instead of a sessionId.
  const [returnToken] = useState<string | null>(() =>
    returnMode && typeof window !== "undefined" ? readReturnToken() : null,
  );
  const [returnDomain, setReturnDomain] = useState<string | null>(null);
  const [returnLinkProblem, setReturnLinkProblem] = useState<ReturnLinkProblem | null>(null);
  const [phase, setPhase] = useState<Phase>(returnMode ? "results" : "start");
  // Lead-capture fields. The tenant domain is derived from the work email (email.split('@')[1]),
  // never asked for separately — see the note under the email field.
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  // The read app's real scopes, fetched with the lead capture on the start form. Empty until it
  // lands; the consent card falls back to the curated (manifest-verified) set meanwhile.
  const [realScopes, setRealScopes] = useState<string[]>([]);
  // Surfaced on the start form if a connection attempt could not even start (e.g. pop-up blocked).
  // A plain decline just returns to the form silently — never an error page.
  const [connectError, setConnectError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [vw, setVw] = useState(1200);
  const [vh, setVh] = useState(900);
  const [rm, setRm] = useState(false);
  // Git #1358 — the real results read. "idle" before the loading animation hands off;
  // "scanning" once polled and the real backend run has not settled yet (RevealNoScanGate,
  // #1357); "ready" once GET /api/public/free-scan/results returns real pillar data; "error"
  // on a genuine fetch/session failure.
  const [resultsStatus, setResultsStatus] = useState<"idle" | "scanning" | "ready" | "error">("idle");
  const [realResults, setRealResults] = useState<FreeScanResultsReady | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const stepsRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The granting interstitial's own timer — the pending consent-status poll. Cleared on unmount
  // alongside the scan intervals so leaving mid-consent never fires a scan on an unmounted tree.
  const grantTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<Window | null>(null);
  const unmountedRef = useRef(false);
  // The interval closures need the live paused value; a ref keeps them in sync with the state.
  const pausedRef = useRef(false);
  // The free-scan checkout sessionId, minted once in grantRead(). The real results read
  // (Git #1358) resolves identity from THIS, server-side — never from a customerId this page
  // supplies — so it has to survive past the closure that minted it.
  const sessionIdRef = useRef<string | null>(null);
  // The real results poll's own timer + a bounded attempt counter (Git #2160's bounded-wait
  // discipline: a real scan can genuinely take a while, but this page must not poll forever).
  const resultsPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsPollAttemptsRef = useRef(0);

  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    onResize();
    setRm(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    window.addEventListener("resize", onResize);
    return () => {
      unmountedRef.current = true;
      window.removeEventListener("resize", onResize);
      if (stepsRef.current) clearInterval(stepsRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
      if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current);
      if (grantTimerRef.current) clearTimeout(grantTimerRef.current);
      if (resultsPollRef.current) clearTimeout(resultsPollRef.current);
      try {
        popupRef.current?.close();
      } catch {
        /* already closed */
      }
    };
  }, []);

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  };

  // Starts the (simulated) scan animation — called once the real read consent has landed.
  const runScan = () => {
    setPhase("scanning");
    setStep(0);
    setElapsed(0);
    stepsRef.current = setInterval(() => {
      setStep((prev) => {
        if (pausedRef.current) return prev;
        const next = prev + 1;
        if (next >= SCAN_STEPS.length) {
          if (stepsRef.current) clearInterval(stepsRef.current);
          if (clockRef.current) clearInterval(clockRef.current);
          resultsTimerRef.current = setTimeout(() => setPhase("results"), 900);
          return SCAN_STEPS.length;
        }
        return next;
      });
    }, 1600);
    clockRef.current = setInterval(() => {
      setElapsed((e) => (pausedRef.current ? e : e + 1));
    }, 1000);
  };

  // ── Git #1358: the real results read ────────────────────────────────────────
  // Bounded poll (Git #2160): a real scan can genuinely take a while, but this
  // page must never hold the visitor on an indefinite wait. ~4 minutes at 8s
  // apart, then RevealNoScanGate's own retry button takes over from the timer.
  const RESULTS_POLL_MS = 8000;
  const RESULTS_POLL_MAX_ATTEMPTS = 30;

  const fetchFreeScanResults = () => {
    if (returnMode) {
      fetchReturnLinkResults();
      return;
    }
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setResultsStatus("error");
      setResultsError("We lost track of your scan session. Please start a new scan.");
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/public/free-scan/results?sessionId=${encodeURIComponent(sessionId)}`);
        const data = (await res.json().catch(() => ({}))) as Partial<FreeScanResultsResponse> & { error?: string };
        if (unmountedRef.current) return;
        if (!res.ok) {
          setResultsStatus("error");
          setResultsError(
            data.error === "read_consent_required"
              ? "We don't have a completed read-only connection for this tenant yet."
              : "We couldn't load your results. Please try again in a moment.",
          );
          return;
        }
        if (data.status === "ready") {
          setRealResults(data as FreeScanResultsReady);
          setResultsStatus("ready");
          return;
        }
        // status === "scanning" — the real backend run has not settled yet.
        setResultsStatus("scanning");
        resultsPollAttemptsRef.current += 1;
        if (resultsPollAttemptsRef.current >= RESULTS_POLL_MAX_ATTEMPTS) return;
        resultsPollRef.current = setTimeout(fetchFreeScanResults, RESULTS_POLL_MS);
      } catch {
        if (unmountedRef.current) return;
        setResultsStatus("error");
        setResultsError("We couldn't reach the server to load your results. Please try again.");
      }
    })();
  };

  const fetchReturnLinkResults = () => {
    if (!returnToken) {
      setReturnLinkProblem("no_token");
      setResultsStatus("error");
      setResultsError(RETURN_LINK_PROBLEM_MESSAGE.no_token);
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/public/free-scan/return-link/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: returnToken }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<FreeScanResultsResponse> & {
          error?: string;
          domain?: string | null;
        };
        if (unmountedRef.current) return;
        if (!res.ok) {
          const problem =
            data.error === "link_invalid" || data.error === "link_expired" || data.error === "link_not_applicable"
              ? data.error
              : null;
          if (problem) sessionStorage.removeItem(RETURN_TOKEN_STORAGE_KEY);
          setReturnLinkProblem(problem);
          setResultsStatus("error");
          setResultsError(
            problem ? RETURN_LINK_PROBLEM_MESSAGE[problem] : "We couldn't load your results. Please try again in a moment.",
          );
          return;
        }
        setReturnDomain(data.domain ?? null);
        if (data.status === "ready") {
          setRealResults(data as FreeScanResultsReady);
          setResultsStatus("ready");
          return;
        }
        setResultsStatus("scanning");
        resultsPollAttemptsRef.current += 1;
        if (resultsPollAttemptsRef.current >= RESULTS_POLL_MAX_ATTEMPTS) return;
        resultsPollRef.current = setTimeout(fetchReturnLinkResults, RESULTS_POLL_MS);
      } catch {
        if (unmountedRef.current) return;
        setResultsStatus("error");
        setResultsError("We couldn't reach the server to load your results. Please try again.");
      }
    })();
  };

  // A return-link page must never be indexed.
  useEffect(() => {
    if (!returnMode) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [returnMode]);

  // Fires the first real read the moment the loading animation hands off to
  // the results phase, and re-fires if the visitor leaves and comes back
  // (re-entering "results" resets the poll budget).
  useEffect(() => {
    if (phase !== "results") return;
    resultsPollAttemptsRef.current = 0;
    setResultsStatus("idle");
    fetchFreeScanResults();
    return () => {
      if (resultsPollRef.current) clearTimeout(resultsPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const retryFreeScanResults = () => {
    resultsPollAttemptsRef.current = 0;
    setResultsError(null);
    fetchFreeScanResults();
  };

  const displayFindings = useMemo(
    () => (realResults ? flattenFindings(realResults.pillars) : []),
    [realResults],
  );

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  // ── Git #1380: localhost-only [DEBUG] autofill ──────────────────────────────
  // Hard-gated on the REAL runtime hostname (not a build-time env var), so this
  // control cannot exist on any deployed host — only a developer's own machine.
  // FreeScan has no verification-code / password step (only name/company/email +
  // the consent checkbox), so the fill is exactly those four page-level fields.
  const isLocalhost =
    typeof window !== "undefined" && window.location.hostname === "localhost";
  const debugFillStartForm = () => {
    setName("Dev Tester");
    setCompany("Dev Test Co");
    setEmail(`dev.${Date.now()}@example.com`);
    setConsent(true);
  };

  // Start form → consent screen. Captures the lead (name/company/work email) via the real Zoho
  // bridge BEFORE Microsoft consent, so an abandoned grant still keeps it, and fetches the read
  // app's real scopes to disclose on the next screen. Non-fatal if the capture request fails.
  const startFreeScan = () => {
    if (!consent || !emailValid) return;
    setConnectError(null);
    setPhase("consent");
    void (async () => {
      try {
        const res = await fetch("/api/public/free-scan/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            name: name.trim() || undefined,
            company: company.trim() || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { scopes?: string[] };
        if (res.ok && Array.isArray(data.scopes)) setRealScopes(data.scopes);
        authLog.info({}, "free-scan: start form submitted, lead captured");
      } catch (err) {
        // The consent screen simply falls back to the curated (manifest-verified) scope list.
        authLog.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "free-scan: lead capture request failed",
        );
      }
    })();
  };

  const backToStart = () => setPhase("start");

  // Polls consent-status until the read grant lands, resolving false once the popup has closed
  // without one (two grace polls, matching Buy.tsx — the self-closing success page races the
  // callback's DB write). The pending timer lives in grantTimerRef so unmount can cancel it.
  const waitForConsent = (sessionId: string, popup: Window | null): Promise<boolean> =>
    new Promise((resolve) => {
      let closedPolls = 0;
      const tick = async () => {
        if (unmountedRef.current) {
          resolve(false);
          return;
        }
        let landed = false;
        try {
          const res = await fetch(`/api/public/flow/consent-status?sessionId=${encodeURIComponent(sessionId)}`);
          if (res.ok) {
            const s = (await res.json()) as { tenantConnected?: boolean; sessionStatus?: string };
            landed = !!s.tenantConnected && (s.sessionStatus === "consented" || s.sessionStatus === "paid");
          }
        } catch {
          /* transient — keep polling */
        }
        if (landed) {
          resolve(true);
          return;
        }
        if (popup?.closed) {
          closedPolls += 1;
          if (closedPolls >= 2) {
            resolve(false);
            return;
          }
        }
        grantTimerRef.current = setTimeout(() => void tick(), 3000);
      };
      void tick();
    });

  // The one real integration point (#1361). Opens Microsoft's own consent screen in a popup
  // against the real read-only app registration (session-keyed read consent, #1311) and, once the
  // grant lands, resumes at scanning. A decline / closed window returns to the start form with the
  // form intact — never an error page.
  const grantRead = () => {
    if (!emailValid) {
      setPhase("start");
      setConnectError("Enter a valid work email to connect.");
      return;
    }
    // Open synchronously inside the click gesture so pop-up blockers allow it; the URL is set once
    // the session and consent-URL mint return.
    const popup = window.open("", "smc-consent", "width=620,height=760,menubar=no,toolbar=no");
    popupRef.current = popup;
    setConnectError(null);
    setPhase("granting");
    void (async () => {
      try {
        const derivedDomain = (email.split("@")[1] || "").trim() || "yourcompany.com";
        const sessionRes = await fetch("/api/public/checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productSlug: FREE_SCAN_PRODUCT_SLUG,
            fullName: name.trim() || email.split("@")[0] || "Free scan",
            email: email.trim(),
            company: company.trim() || derivedDomain,
            industry: "Unknown",
          }),
        });
        const sessionData = (await sessionRes.json().catch(() => ({}))) as { sessionId?: string; portalUrl?: string };
        if (sessionRes.status === 409 && sessionData.portalUrl) {
          // A returning customer with a real account already exists — send them to the portal.
          window.location.href = sessionData.portalUrl;
          return;
        }
        if (!sessionRes.ok || !sessionData.sessionId) {
          throw new Error("Could not start the Microsoft connection. Please try again.");
        }
        const sessionId = sessionData.sessionId;
        // Git #1358: the real results read resolves identity from this sessionId server-side —
        // stash it now so it survives past this closure into the results phase.
        sessionIdRef.current = sessionId;
        const urlRes = await fetch(`/api/public/flow/read-consent-url?sessionId=${encodeURIComponent(sessionId)}`);
        const urlData = (await urlRes.json().catch(() => ({}))) as { url?: string };
        if (!urlRes.ok || !urlData.url) {
          throw new Error("Could not start the Microsoft connection. Please try again.");
        }
        if (!popup || popup.closed) {
          throw new Error("Your browser blocked the Microsoft consent window — allow pop-ups for this site and try again.");
        }
        popup.location.href = urlData.url;
        authLog.info({}, "free-scan: read consent popup opened");
        const landed = await waitForConsent(sessionId, popup);
        try {
          popup.close();
        } catch {
          /* already closed itself */
        }
        if (unmountedRef.current) return;
        if (!landed) {
          // Declined / closed before approval — back to the form, no error page.
          setPhase("start");
          authLog.info({}, "free-scan: read consent not completed — returned to start");
          return;
        }
        authLog.info({}, "free-scan: read consent granted — starting scan");
        runScan();
      } catch (err) {
        try {
          popup?.close();
        } catch {
          /* ignore */
        }
        if (unmountedRef.current) return;
        const message = err instanceof Error ? err.message : "The Microsoft connection failed. Please try again.";
        setPhase("start");
        setConnectError(message);
        authLog.warn({ err: message }, "free-scan: read consent connect failed");
      }
    })();
  };

  const scanDomain = returnDomain || (email.split("@")[1] || "").trim() || "yourcompany.com";
  const scanEmail = email.trim() || "you@yourcompany.com";
  const done = Math.min(step, SCAN_STEPS.length);
  const r = wheelVals(done / SCAN_STEPS.length, vw, vh, rm, paused, signals);
  const pulseAnim = rm || paused ? "none" : "pulseDot 1100ms ease-in-out infinite";
  const scanLabel = paused
    ? "Scan paused — nothing is running against your tenant"
    : done >= SCAN_STEPS.length
    ? "Acquisition complete — compiling readiness signal"
    : CHECKS[Math.min(CHECKS.length - 1, Math.floor((done / SCAN_STEPS.length) * CHECKS.length))];
  const scanCount = Math.round(signals * (done / SCAN_STEPS.length)) + " of 150+ signals evaluated";

  return (
    <div
      data-testid="freescan-page"
      data-phase={phase}
      style={{
        background: "#020617",
        minHeight: "100vh",
        color: "#f8fafc",
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <style>{`
        @keyframes pulseDot{0%,100%{opacity:.35}50%{opacity:1}}
        @keyframes fsSpin{to{transform:rotate(360deg)}}
        .fs-glass{position:relative;overflow:hidden}
        .fs-glass:before{content:"";position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(148,163,184,.06) 0 6px,transparent 6px 12px);pointer-events:none}
      `}</style>

      {phase === "start" ? <Nav current="none" /> : <ConsentBreadcrumb phase={phase} />}

      <main>
        {/* ── START ─────────────────────────────────────────────────────── */}
        {phase === "start" && (
          <>
            <section style={{ padding: "56px 32px 40px" }}>
              <div
                style={{
                  maxWidth: 860,
                  margin: "0 auto",
                  display: "grid",
                  gridTemplateColumns: "1.15fr 1fr",
                  gap: 32,
                  alignItems: "start",
                }}
              >
                <div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "6px 12px",
                      borderRadius: 999,
                      background: "rgba(52,211,153,.1)",
                      border: "1px solid rgba(52,211,153,.28)",
                      color: "#34d399",
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".1em",
                      marginBottom: 16,
                    }}
                  >
                    Free · no card, no call
                  </span>
                  <h1
                    data-testid="freescan-start-heading"
                    style={{
                      fontSize: 34,
                      fontWeight: 800,
                      letterSpacing: "-.025em",
                      lineHeight: 1.14,
                      color: "#f8fafc",
                      margin: "0 0 14px",
                      textWrap: "pretty",
                    }}
                  >
                    Find out what’s actually wrong in your Microsoft 365 tenant.
                  </h1>
                  <p style={{ fontSize: 14.5, color: "#94a3b8", lineHeight: 1.7, margin: "0 0 22px" }}>
                    We connect to your tenant, read your real settings, and show you every problem we find — in
                    plain English, with the actual files, accounts and settings behind each one. Most tenants come
                    back with somewhere between eight and twenty findings. You keep the list either way.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 26 }}>
                    {PROMISES.map((p) => (
                      <div key={p.title} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                        <span
                          style={{
                            flexShrink: 0,
                            width: 32,
                            height: 32,
                            borderRadius: 9,
                            background: p.wrap.bg,
                            border: `1px solid ${p.wrap.border}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: p.wrap.color,
                          }}
                        >
                          {p.icon}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>
                            {p.title}
                          </span>
                          <span
                            style={{ display: "block", fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginTop: 2 }}
                          >
                            {p.body}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    padding: 22,
                    borderRadius: 16,
                    border: "1px solid rgba(30,41,59,.9)",
                    background: "#0b1524",
                  }}
                >
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px" }}>
                    Start your scan
                  </h2>
                  <p style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.6, margin: "0 0 16px" }}>
                    Takes about two minutes. You approve a read-only connection in Microsoft’s own consent screen —
                    we never ask for a password.
                  </p>
                  <label
                    style={{
                      display: "block",
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      color: "#64748b",
                      marginBottom: 6,
                    }}
                  >
                    Your name
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Whitfield"
                    data-testid="freescan-name"
                    style={{
                      width: "100%",
                      padding: "11px 13px",
                      borderRadius: 10,
                      border: "1px solid rgba(30,41,59,.9)",
                      background: "#020617",
                      color: "#e2e8f0",
                      fontSize: 13.5,
                      fontFamily: "inherit",
                      marginBottom: 12,
                    }}
                  />
                  <label
                    style={{
                      display: "block",
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      color: "#64748b",
                      marginBottom: 6,
                    }}
                  >
                    Company
                  </label>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Whitfield Manufacturing"
                    data-testid="freescan-company"
                    style={{
                      width: "100%",
                      padding: "11px 13px",
                      borderRadius: 10,
                      border: "1px solid rgba(30,41,59,.9)",
                      background: "#020617",
                      color: "#e2e8f0",
                      fontSize: 13.5,
                      fontFamily: "inherit",
                      marginBottom: 12,
                    }}
                  />
                  <label
                    style={{
                      display: "block",
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      color: "#64748b",
                      marginBottom: 6,
                    }}
                  >
                    Work email address
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourcompany.com"
                    data-testid="freescan-email"
                    style={{
                      width: "100%",
                      padding: "11px 13px",
                      borderRadius: 10,
                      border: "1px solid rgba(30,41,59,.9)",
                      background: "#020617",
                      color: "#e2e8f0",
                      fontSize: 13.5,
                      fontFamily: "inherit",
                      marginBottom: 8,
                    }}
                  />
                  <p style={{ fontSize: 10.5, color: "#475569", lineHeight: 1.55, margin: "0 0 16px" }}>
                    We read the tenant behind this address, so your results go to the domain we scan.
                  </p>
                  <label
                    onClick={() => setConsent((c) => !c)}
                    data-testid="freescan-consent"
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      cursor: "pointer",
                      marginBottom: 16,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 1,
                        border: `1px solid ${consent ? "#3b82f6" : "rgba(148,163,184,.35)"}`,
                        background: consent ? "#3b82f6" : "transparent",
                        color: "#fff",
                      }}
                    >
                      {consent ? iconCheck(12) : null}
                    </span>
                    <span style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>
                      I’m a Global Administrator (or can approve consent) and I agree to a read-only scan of this
                      tenant.
                    </span>
                  </label>
                  {connectError && (
                    <p
                      data-testid="freescan-connect-error"
                      style={{ fontSize: 11.5, color: "#f87171", lineHeight: 1.55, margin: "0 0 12px" }}
                    >
                      {connectError}
                    </p>
                  )}
                  <button
                    onClick={startFreeScan}
                    disabled={!(consent && emailValid)}
                    data-testid="freescan-start"
                    style={{
                      width: "100%",
                      padding: 13,
                      borderRadius: 11,
                      border: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      fontFamily: "inherit",
                      cursor: consent && emailValid ? "pointer" : "not-allowed",
                      color: consent && emailValid ? "#fff" : "#64748b",
                      background:
                        consent && emailValid ? "linear-gradient(90deg,#3b82f6,#8b5cf6)" : "rgba(255,255,255,.05)",
                    }}
                  >
                    Review access and continue
                  </button>
                  <p style={{ fontSize: 10.5, color: "#475569", lineHeight: 1.6, margin: "12px 0 0" }}>
                    Next you’ll see exactly which read permissions the scan asks for, before Microsoft’s consent
                    screen opens. Nothing is read until you approve it.
                  </p>
                </div>
              </div>
            </section>

            <section style={{ padding: "0 32px 60px" }}>
              <div
                style={{
                  maxWidth: 860,
                  margin: "0 auto",
                  padding: 22,
                  borderRadius: 16,
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "rgba(255,255,255,.02)",
                }}
              >
                <h2 style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", margin: "0 0 12px" }}>
                  What we look at, in plain words
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
                  {PLAIN_PILLARS.map((pp) => (
                    <div key={pp.name}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 3 }}>{pp.name}</div>
                      <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>{pp.plain}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {/* ── CONSENT ───────────────────────────────────────────────────── */}
        {phase === "consent" && (
          <div
            data-testid="freescan-consent-screen"
            style={{
              maxWidth: 720,
              margin: "0 auto",
              padding: "48px 32px 90px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(59,130,246,.12)",
                border: "1px solid rgba(59,130,246,.32)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#60a5fa",
              }}
            >
              {iconEye(21)}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: "#60a5fa",
                }}
              >
                Step 1 of 2 · before anything is read
              </span>
              <h1
                data-testid="freescan-consent-heading"
                style={{
                  margin: 0,
                  fontSize: "clamp(24px,3vw,32px)",
                  fontWeight: 800,
                  letterSpacing: "-.03em",
                  lineHeight: 1.16,
                  color: "#f8fafc",
                  textWrap: "pretty",
                }}
              >
                This scan needs read access. It never asks for more.
              </h1>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.68, color: "#94a3b8", maxWidth: "60ch" }}>
                Consent is granted in Microsoft’s own screen against a read-only app registration on {scanDomain}.
                There is no write scope in this registration to grant later — applying a fix is a second, separate
                consent you would approve on its own.
              </p>
            </div>

            <div
              style={{
                border: "1px solid rgba(30,41,59,.95)",
                borderRadius: 16,
                background: "#0b1524",
                padding: 20,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                The read app registration asks for
              </span>
              {scopesToShow(realScopes).map((rs) => (
                <span key={rs.scope} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "#60a5fa", flex: "none", display: "flex", marginTop: 2 }}>{iconEye(14)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "#f8fafc",
                        fontFamily: "Menlo,Consolas,monospace",
                      }}
                    >
                      {rs.scope}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#94a3b8", lineHeight: 1.55, marginTop: 3 }}>
                      {rs.why}
                    </span>
                  </span>
                </span>
              ))}
            </div>

            <div
              style={{
                border: "1px solid rgba(52,211,153,.24)",
                borderRadius: 16,
                background: "rgba(52,211,153,.05)",
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 11,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#34d399",
                }}
              >
                Not requested, and not grantable here
              </span>
              {notRequestedToShow(realScopes).map((nr) => (
                <span key={nr} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ flex: "none", color: "#34d399", fontSize: 12, fontWeight: 700 }}>×</span>
                  <span style={{ minWidth: 0, fontSize: 12, color: "#cbd5e1", lineHeight: 1.55 }}>{nr}</span>
                </span>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={grantRead}
                data-testid="freescan-grant"
                style={{
                  padding: "12px 24px",
                  border: 0,
                  borderRadius: 11,
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                  cursor: "pointer",
                }}
              >
                Grant read-only access
              </button>
              <button
                onClick={backToStart}
                data-testid="freescan-consent-back"
                style={{
                  padding: "12px 22px",
                  borderRadius: 11,
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,.25)",
                  cursor: "pointer",
                }}
              >
                Back
              </button>
              <span style={{ fontSize: 11.5, color: "#64748b", maxWidth: "38ch", lineHeight: 1.55 }}>
                Revocable from your tenant at any time, and revoking it stops the scan mid-run.
              </span>
            </div>
          </div>
        )}

        {/* ── GRANTING ──────────────────────────────────────────────────── */}
        {phase === "granting" && (
          <div
            data-testid="freescan-granting"
            style={{
              maxWidth: 560,
              margin: "0 auto",
              padding: "120px 32px 160px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: "2px solid rgba(96,165,250,.25)",
                borderTopColor: "#60a5fa",
                animation: rm ? "none" : "fsSpin 900ms linear infinite",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#cbd5e1" }}>Waiting for Microsoft consent</span>
            <span style={{ fontSize: 11.5, color: "#64748b", textAlign: "center", lineHeight: 1.6, maxWidth: "44ch" }}>
              Microsoft is confirming the read-only grant on {scanDomain}. The scan starts the moment it returns.
            </span>
          </div>
        )}

        {/* ── SCANNING ──────────────────────────────────────────────────── */}
        {phase === "scanning" && (
          <section
            data-testid="freescan-scanning"
            style={{
              height: "calc(100vh - 57px)",
              display: "flex",
              flexDirection: "column",
              padding: "14px 32px 18px",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                maxWidth: 1000,
                width: "100%",
                margin: "0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                flex: "none",
              }}
            >
              <span style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".2em",
                    textTransform: "uppercase",
                    color: "#60a5fa",
                    flex: "none",
                  }}
                >
                  Live
                </span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: "-.01em",
                    color: "#f1f5f9",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Scanning {scanDomain}
                </span>
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: ".05em",
                  color: "#64748b",
                  whiteSpace: "nowrap",
                }}
              >
                Microsoft Graph API · read-only
              </span>
            </div>

            <ScannerWheel r={r} />

            <div
              style={{
                maxWidth: 1000,
                width: "100%",
                margin: "0 auto",
                paddingRight: 64,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
                flex: "none",
                flexWrap: "wrap",
                rowGap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "#00B4D8", flex: "none", animation: pulseAnim }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#cbd5e1",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {scanLabel}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    color: "#64748b",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {scanCount}
                </span>
                <button
                  onClick={togglePause}
                  data-testid="freescan-pause"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 11px",
                    borderRadius: 999,
                    fontFamily: "inherit",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    transition: "background 180ms,border-color 180ms,color 180ms",
                    ...(paused
                      ? { color: "#fbbf24", background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.32)" }
                      : { color: "#94a3b8", background: "rgba(255,255,255,.05)", border: "1px solid rgba(71,85,105,.4)" }),
                  }}
                >
                  {paused ? (
                    <svg viewBox="0 0 24 24" width={10} height={10}>
                      <polygon points="7 4 20 12 7 20" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width={10} height={10}>
                      <rect x={6} y={4} width={4} height={16} fill="currentColor" />
                      <rect x={14} y={4} width={4} height={16} fill="currentColor" />
                    </svg>
                  )}
                  {paused ? "Resume scan" : "Pause scan"}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 10.5, color: "#475569", textAlign: "center", margin: "10px 0 0", lineHeight: 1.5, flex: "none" }}>
              We’ll email your results to {scanEmail} — you can close this tab.
            </p>
          </section>
        )}

        {/* ── RESULTS ───────────────────────────────────────────────────── */}
        {phase === "results" && (resultsStatus === "idle" || resultsStatus === "scanning") && (
          <RevealNoScanGate
            open
            message={
              "We're still reading your tenant's real configuration — this can take a little while on a " +
              "larger tenant. This page will move on the moment it's ready; you can also check by hand below."
            }
            onRetry={retryFreeScanResults}
            ctaLabel="Check now"
          />
        )}

        {phase === "results" && resultsStatus === "error" && (
          <section style={{ minHeight: "calc(100vh - 57px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "5vh 5vw" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, textAlign: "center", alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".22em", textTransform: "uppercase", color: "#f87171" }}>
                Couldn't load your results
              </span>
              <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, lineHeight: 1.6, color: "#cbd5e1" }} data-testid="freescan-results-error">
                {resultsError}
              </p>
              {returnLinkProblem === "link_not_applicable" ? (
                <Link href="/login" data-testid="freescan-return-signin" style={{ marginTop: 10, color: "#60a5fa", fontSize: 14, fontWeight: 600 }}>
                  Sign in
                </Link>
              ) : returnLinkProblem ? (
                <FreeScanReturnLinkRequest />
              ) : (
              <button
                type="button"
                onClick={retryFreeScanResults}
                data-testid="freescan-results-retry"
                style={{
                  marginTop: 10,
                  padding: "10px 22px",
                  borderRadius: 10,
                  border: "1px solid #3b82f6",
                  background: "#3b82f6",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
              )}
            </div>
          </section>
        )}

        {phase === "results" && resultsStatus === "ready" && realResults && (
          <>
            <section style={{ padding: "44px 32px 24px" }}>
              <div style={{ maxWidth: 1000, margin: "0 auto" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 20,
                    flexWrap: "wrap",
                    marginBottom: 26,
                  }}
                >
                  <div style={{ maxWidth: 620 }}>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: ".12em",
                        color: "#60a5fa",
                        marginBottom: 10,
                      }}
                    >
                      Scan complete · {scanDomain} · {formatResultDate(realResults.generatedAt)}
                    </div>
                    <h1
                      data-testid="freescan-results-heading"
                      style={{
                        fontSize: 32,
                        fontWeight: 800,
                        letterSpacing: "-.025em",
                        lineHeight: 1.14,
                        color: "#f8fafc",
                        margin: "0 0 12px",
                        textWrap: "pretty",
                      }}
                    >
                      {realResults.totalFindings === 0
                        ? "Good news — this scan didn't turn up anything that needs attention right now."
                        : `We found ${realResults.totalFindings} things wrong in your tenant. ${realResults.criticalFindings} of them are urgent.`}
                    </h1>
                    <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
                      Everything below is real, read from your own tenant a moment ago — not a sample and not a
                      maturity questionnaire. Each finding shows the actual files, accounts and settings involved, so
                      you can verify any of it yourself in the admin center.
                    </p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
                    {[
                      { label: "Urgent" as const, count: realResults.criticalFindings, color: "#f87171" },
                      {
                        label: "Needs attention" as const,
                        count: realResults.totalFindings - realResults.criticalFindings,
                        color: "#fbbf24",
                      },
                    ].map((sc) => (
                      <div
                        key={sc.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "11px 14px",
                          borderRadius: 11,
                          border: "1px solid rgba(30,41,59,.9)",
                          background: "#0b1524",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#cbd5e1" }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: sc.color }} />
                          {sc.label}
                        </span>
                        <b style={{ fontSize: 15, fontWeight: 800, color: sc.color }}>{sc.count}</b>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Real per-pillar scores — #1358's own directive: "real pillar scores ... visible". */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6,minmax(0,1fr))",
                    gap: 10,
                    marginBottom: 26,
                  }}
                >
                  {DISPLAY_PILLAR_KEYS.map((key) => {
                    const card = realResults.pillars.find((p) => p.pillar === key);
                    const sector = SECTORS.find((s) => s.key === PILLAR_LABELS[key]);
                    const scored = card?.evaluation.status === "scored" && card.score != null;
                    return (
                      <div
                        key={key}
                        data-testid={`freescan-pillar-score-${key}`}
                        style={{
                          padding: "12px 8px",
                          borderRadius: 12,
                          border: "1px solid rgba(30,41,59,.9)",
                          background: "#0b1524",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            letterSpacing: ".08em",
                            textTransform: "uppercase",
                            color: sector?.color ?? "#94a3b8",
                          }}
                        >
                          {PILLAR_LABELS[key]}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: scored ? "#f8fafc" : "#475569", marginTop: 4 }}>
                          {scored ? Math.round(card!.score as number) : "—"}
                        </div>
                        <div style={{ fontSize: 9.5, color: "#64748b" }}>
                          {scored
                            ? "/ 100"
                            : card?.evaluation.status === "insufficient_data"
                            ? "not enough data yet"
                            : "not scored yet"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {realResults.annualWasteDollars != null && (
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: 14,
                      border: "1px solid rgba(248,113,113,.25)",
                      background: "linear-gradient(100deg,rgba(248,113,113,.1),rgba(2,6,23,0) 70%)",
                      marginBottom: 30,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc", marginBottom: 5 }}>
                      The money one, first: you are paying about $
                      {Math.round(realResults.annualWasteDollars / 12).toLocaleString()} a month in Microsoft 365
                      licence costs that show no recent activity.
                    </div>
                    <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.65 }}>
                      That is roughly ${Math.round(realResults.annualWasteDollars).toLocaleString()} a year, and it
                      renews on its own unless somebody acts on it.
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section style={{ padding: "0 32px 30px" }}>
              <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
                {displayFindings.length === 0 && (
                  <div
                    style={{
                      padding: 20,
                      borderRadius: 16,
                      border: "1px solid rgba(30,41,59,.9)",
                      background: "#0b1524",
                      fontSize: 13.5,
                      color: "#94a3b8",
                      textAlign: "center",
                    }}
                  >
                    No critical or warning-level findings on this scan. Monitoring is what tells you the day that changes.
                  </div>
                )}
                {displayFindings.map((f, i) => (
                  <div
                    key={`${f.area}-${f.title}-${i}`}
                    style={{ borderRadius: 16, border: "1px solid rgba(30,41,59,.9)", background: "#0b1524", overflow: "hidden" }}
                  >
                    <div style={{ padding: "20px 20px 18px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 16,
                          marginBottom: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 9.5,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: ".08em",
                              padding: "4px 9px",
                              borderRadius: 999,
                              whiteSpace: "nowrap",
                              color: sevColor(f.severity),
                              background: sevBg(f.severity),
                              border: `1px solid ${sevBorder(f.severity)}`,
                            }}
                          >
                            {f.severity}
                          </span>
                          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#f8fafc", lineHeight: 1.35 }}>
                            {f.title}
                          </h3>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            whiteSpace: "nowrap",
                            marginLeft: "auto",
                            textAlign: "right",
                          }}
                        >
                          {f.area}
                        </span>
                      </div>

                      {f.meaning && (
                        <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.7, margin: "0 0 6px" }}>
                          <b style={{ color: "#f8fafc" }}>What this means:</b> {f.meaning}
                        </p>
                      )}
                      {f.why && (
                        <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.7, margin: "0 0 16px" }}>
                          <b style={{ color: "#cbd5e1" }}>Why it matters:</b> {f.why}
                        </p>
                      )}

                      {f.evidenceItems.length > 0 && (
                        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,.06)", background: "#020617", padding: 14 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              marginBottom: 11,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: ".1em",
                                color: "#64748b",
                              }}
                            >
                              The actual items we found
                            </span>
                            <span style={{ fontSize: 10.5, color: "#475569" }}>{f.evidenceItems.length} shown</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {f.evidenceItems.map((item, ei) => (
                              <div
                                key={ei}
                                style={{
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                  color: "#e2e8f0",
                                  fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
                                  wordBreak: "break-word",
                                }}
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      className="fs-glass"
                      style={{
                        borderTop: "1px solid rgba(255,255,255,.06)",
                        background: "rgba(2,6,23,.72)",
                        backdropFilter: "blur(6px)",
                        WebkitBackdropFilter: "blur(6px)",
                        padding: "16px 20px",
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 16,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 11, minWidth: 0 }}>
                          <span
                            style={{
                              flexShrink: 0,
                              width: 30,
                              height: 30,
                              borderRadius: 9,
                              background: "rgba(148,163,184,.1)",
                              border: "1px solid rgba(148,163,184,.2)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#94a3b8",
                            }}
                          >
                            {iconLock(15)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#cbd5e1" }}>
                              Fixing this is part of Monitoring
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55, marginTop: 2 }}>
                              The specific fix, its steps and its effort estimate unlock once this tenant is monitored
                            </div>
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: ".09em",
                            color: "#64748b",
                            border: "1px solid rgba(148,163,184,.22)",
                            borderRadius: 999,
                            padding: "5px 11px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Action layer locked
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ padding: "14px 32px 40px" }}>
              <div
                className="fs-glass"
                style={{
                  maxWidth: 1000,
                  margin: "0 auto",
                  borderRadius: 18,
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "rgba(11,21,36,.75)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  padding: 28,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ maxWidth: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          background: "rgba(148,163,184,.1)",
                          border: "1px solid rgba(148,163,184,.22)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#cbd5e1",
                        }}
                      >
                        {iconLock(15)}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".1em",
                          color: "#94a3b8",
                        }}
                      >
                        Everything you can do about this is behind one gate
                      </span>
                    </div>
                    <h2
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: "#f8fafc",
                        margin: "0 0 10px",
                        letterSpacing: "-.02em",
                        textWrap: "pretty",
                      }}
                    >
                      The findings are yours free. Fixing them, tracking them, and knowing when they come back is not.
                    </h2>
                    <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, margin: "0 0 16px" }}>
                      This scan is a photograph of one moment. Nothing above gets fixed by reading it, and every one
                      of these will drift again the week after you fix it by hand. Monitoring is what closes them,
                      keeps them closed, and tells you the day one comes back.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {LOCKED_CAPABILITIES.map((lc) => (
                        <div key={lc} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#94a3b8" }}>
                          <span style={{ color: "#64748b", display: "flex", flexShrink: 0 }}>{iconLock(13)}</span>
                          <span>{lc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ minWidth: 250, flex: "0 1 280px" }}>
                    <div
                      style={{
                        padding: 20,
                        borderRadius: 14,
                        border: "1px solid rgba(59,130,246,.3)",
                        background: "rgba(59,130,246,.07)",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                        To fix and keep watching {scanDomain}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                        <b style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>{QUOTE_PRICE}</b>
                        <span style={{ fontSize: 12.5, color: "#94a3b8" }}>/mo</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55, marginBottom: 16 }}>{QUOTE_BASIS}</div>
                      <Link
                        href={CHECKOUT_HREF}
                        style={{
                          display: "block",
                          textAlign: "center",
                          padding: 12,
                          borderRadius: 10,
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: "#fff",
                          background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                          textDecoration: "none",
                        }}
                      >
                        Cost to monitor &amp; resolve this
                      </Link>
                      <div style={{ fontSize: 10.5, color: "#475569", textAlign: "center", marginTop: 9 }}>
                        Cancel any month. Your findings stay yours either way.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <PlainPillars heading="New to this? Here’s what the six areas mean" />

            <div
              style={{
                position: "sticky",
                bottom: 0,
                zIndex: 40,
                padding: "12px 32px 16px",
                background: "linear-gradient(180deg,rgba(2,6,23,0),rgba(2,6,23,.92) 40%)",
              }}
            >
              <div
                style={{
                  maxWidth: 1000,
                  margin: "0 auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                  padding: "14px 18px",
                  borderRadius: 14,
                  border: "1px solid rgba(59,130,246,.35)",
                  background: "linear-gradient(100deg,rgba(59,130,246,.16),rgba(139,92,246,.1) 60%,rgba(11,21,36,.95))",
                  boxShadow: "0 12px 32px rgba(0,0,0,.45)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#f8fafc" }}>
                    {realResults.totalFindings} findings, {realResults.criticalFindings} urgent — none of them fix
                    themselves.
                  </div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1", marginTop: 2 }}>
                    {QUOTE_PRICE}/mo to close them and watch for the next one.
                  </div>
                </div>
                <Link
                  href={CHECKOUT_HREF}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 22px",
                    borderRadius: 11,
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "#fff",
                    background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                    textDecoration: "none",
                  }}
                >
                  Cost to monitor &amp; resolve this {iconArrow(15)}
                </Link>
              </div>
            </div>
          </>
        )}
      </main>

      <Footer />

      {/* Git #1380 — LOCALHOST-ONLY [DEBUG] autofill. Fills the start form's real
          page-level fields (name/company/work email) and ticks the consent box so
          a developer can reach the consent step in one click. Renders only when
          the real hostname is "localhost" — never on any deployed host. It only
          shows on the start screen, where those fields exist. */}
      {isLocalhost && phase === "start" && (
        <div
          data-testid="freescan-debug-autofill"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 60,
            width: 210,
            padding: "12px 12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(245,158,11,.5)",
            background: "rgba(20,14,2,.94)",
            boxShadow: "0 12px 30px -14px rgba(0,0,0,.8)",
            fontFamily: "inherit",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "#fbbf24",
              marginBottom: 8,
            }}
          >
            [DEBUG] localhost only
          </div>
          <button
            type="button"
            onClick={debugFillStartForm}
            data-testid="freescan-debug-fill"
            style={{
              width: "100%",
              padding: "7px 9px",
              borderRadius: 8,
              border: "1px solid rgba(245,158,11,.45)",
              background: "rgba(245,158,11,.12)",
              color: "#fde68a",
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            Fill name / company / email + consent
          </button>
        </div>
      )}
    </div>
  );
}
