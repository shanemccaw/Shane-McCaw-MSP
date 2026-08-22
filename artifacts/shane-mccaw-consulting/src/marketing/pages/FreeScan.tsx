import React, { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

// Route /scan — recreated from Design/design_handoff_marketing/Marketing Free Scan.dc.html.
// The site's primary conversion path: a consent screen, a live-looking six-sector acquisition
// wheel, then results with findings by severity. Colours, spacing, motion and copy are the
// design's own — copy is final and reproduced verbatim.
//
// This page manages its own chrome rather than using MarketingLayout: the design shows the full
// Nav only on the start screen and swaps to a slim consent breadcrumb once the scan begins, so the
// outer shell is rebuilt here around those two states. The Footer is shared.
//
// SIMULATED, per the handoff README's "Out of scope" list: the scan is driven entirely by the
// timers below — no Graph call is made. Every number on the results screen (findings, evidence,
// the licence-waste figures, the monitoring quote) is authored demo data, kept in the FIXTURE
// block below in one place so it can be swapped for a real read-only Graph app registration and
// the tenant's own seat-count pricing later. Do not treat any of it as live.

type Phase = "start" | "scanning" | "results";

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
const SIGNALS = 158;

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

// ── FIXTURE: the authored scan result (swap for a real Graph read + seat pricing) ──

type Finding = {
  severity: "Urgent" | "Needs attention" | "Worth knowing";
  area: string;
  title: string;
  meaning: string;
  why: string;
  evidenceNote: string;
  evidence: { item: string; meta: string }[];
  fix: string;
  fixEffort: string;
};

const FINDINGS: Finding[] = [
  {
    severity: "Urgent",
    area: "Sharing and access",
    title: "23 files are shared with a link that works for anyone on the internet",
    meaning:
      'Someone in your tenant created "anyone with the link" links. No sign-in, no expiry, no record of who opened them.',
    why: "These links keep working after people leave, get forwarded, and end up indexed. This is the single most common way company files leak without anything being hacked.",
    evidenceNote: "4 of 23 shown",
    evidence: [
      { item: "/sites/Finance/Shared Documents/FY26 Budget v4.xlsx", meta: "created 14 months ago" },
      { item: "/sites/HR/Shared Documents/Salary Bands 2026.xlsx", meta: "no expiry" },
      { item: "/personal/j.reyes/Documents/Client List.csv", meta: "owner left in March" },
      { item: "/sites/Legal/Shared Documents/Acquisition NDA.pdf", meta: "opened 41 times" },
    ],
    fix: "Expire the anonymous links, replace the 4 still needed with named access, and block new anonymous links tenant-wide",
    fixEffort: "One runbook, about 20 minutes, reversible",
  },
  {
    severity: "Urgent",
    area: "Administrator accounts",
    title: "3 admin accounts can sign in without multi-factor authentication",
    meaning:
      "Three accounts with full or near-full control of your tenant only need a password to sign in.",
    why: "An admin account without MFA is the account attackers look for first. One reused password and the whole tenant is theirs, including your backups and your mail flow.",
    evidenceNote: "all 3 shown",
    evidence: [
      { item: "admin@yourcompany.com — Global Administrator", meta: "no MFA method registered" },
      { item: "svc-backup@yourcompany.com — Exchange Administrator", meta: "password 3 years old" },
      { item: "it.contractor@yourcompany.com — Global Administrator", meta: "last sign-in 2 days ago" },
    ],
    fix: "Register MFA on all three, convert the service account to app-only auth, and remove the contractor from Global Administrator",
    fixEffort: "Guided change, needs one approval, no user disruption",
  },
  {
    severity: "Urgent",
    area: "Records and investigations",
    title: "Your audit log only keeps 90 days of activity",
    meaning:
      "Any record of who did what in your tenant older than 90 days is already gone and cannot be recovered.",
    why: "Investigations, insurance claims and legal holds routinely ask for six to twelve months. If something happened four months ago, there is currently no way to answer what happened.",
    evidenceNote: "configuration read from your tenant",
    evidence: [
      { item: "Unified audit log retention", meta: "90 days (default)" },
      { item: "Litigation hold coverage", meta: "0 of 1,240 mailboxes" },
      { item: "Mailbox audit for owner actions", meta: "not enabled" },
    ],
    fix: "Raise retention to one year, enable owner-action auditing, and put the 14 mailboxes named in your policy on hold",
    fixEffort: "Configuration change, immediate, no downtime",
  },
  {
    severity: "Needs attention",
    area: "Guests and former staff",
    title: "27 external guests still have access, including 6 whose companies you no longer work with",
    meaning:
      "Guest accounts from past projects were never removed. They can still open the Teams and files they were added to.",
    why: "Nobody notices a guest account. They keep their access through reorganisations and contract endings, and they are outside your control entirely — you cannot enforce MFA or device rules on them.",
    evidenceNote: "4 of 27 shown",
    evidence: [
      { item: "p.novak@former-vendor.co — 3 Teams, 2 sites", meta: "last activity 11 months ago" },
      { item: "contractor@agency-b.com — Finance Planning", meta: "contract ended Jan 2026" },
      { item: "a.mehta@partner-x.io — 6 Teams", meta: "never signed in" },
      { item: "temp.audit@ext-audit.com — Legal Archive", meta: "audit closed 2024" },
    ],
    fix: "Remove the 6 ended relationships, re-confirm the remaining 21 with their internal sponsor, and turn on quarterly guest reviews",
    fixEffort: "Runbook plus one review cycle",
  },
  {
    severity: "Needs attention",
    area: "Money",
    title: "You are paying for 46 licences nobody has used in 90 days",
    meaning:
      "Forty-six assigned seats show no sign-in or activity for the last quarter, including 12 duplicate assignments where one person holds two overlapping plans.",
    why: "This is a recurring bill for nothing, and it renews quietly. It is also the finding that usually pays for the work on everything else on this page.",
    evidenceNote: "4 of 9 SKUs shown",
    evidence: [
      { item: "Microsoft 365 E5 — 120 assigned, 68 active", meta: "$1,976/mo idle" },
      { item: "Microsoft 365 Copilot — 60 assigned, 22 active", meta: "$1,140/mo idle" },
      { item: "Power BI Pro — 85 assigned, 41 active", meta: "$440/mo idle" },
      { item: "Duplicate E3 + Business Premium", meta: "12 users" },
    ],
    fix: "Reclaim the 46 idle seats, resolve the 12 duplicates, and set a monthly reclaim review before your renewal date",
    fixEffort: "One review, then automatic",
  },
  {
    severity: "Worth knowing",
    area: "Teams and sites nobody owns",
    title: "14 Teams have no owner, and 41 meeting recordings are sitting in them",
    meaning:
      "Fourteen Teams have no active owner. Two of them still allow external sharing, and between them they hold 41 meeting recordings and 18 GB of files.",
    why: "An ownerless Team cannot be governed, archived or safely deleted — nobody can say what it contains or who should have it. Recordings are usually the most sensitive and least inventoried content in a tenant.",
    evidenceNote: "4 of 14 shown",
    evidence: [
      { item: "Project Atlas (Pilot)", meta: "11 recordings · external sharing on" },
      { item: "Marketing Campaign 2024", meta: "no activity in 11 months" },
      { item: "Vendor Selection — Confidential", meta: "9 recordings · 1 guest" },
      { item: "Q3 Reorg Planning", meta: "6 GB · 2 private channels" },
    ],
    fix: "Assign or archive each Team, move the recordings to a retained location, and close external sharing on the two exposed sites",
    fixEffort: "Runbook plus owner confirmation",
  },
];

const RESULT_DATE = "21 August 2026";
const TOTAL_FINDINGS = 14;
const URGENT_COUNT = 3;
const SEVERITY_COUNTS: { label: string; count: number; color: string }[] = [
  { label: "Urgent", count: 3, color: "#f87171" },
  { label: "Needs attention", count: 6, color: "#fbbf24" },
  { label: "Worth knowing", count: 5, color: "#60a5fa" },
];
const WASTE_HEADLINE = "you are paying about $3,556 a month for licences nobody uses.";
const WASTE_BODY =
  "46 assigned seats show no activity in 90 days and 12 people hold two overlapping plans. That is roughly $42,672 a year, and it renews on its own unless somebody acts on it.";
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

// ── Geometry ─────────────────────────────────────────────────────────────────
const CL = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)));

// Six-sector wheel geometry: each sector grows from the hub to the rim on its own staggered slice
// of the scan (t = 0→1), and its three finding cues fade in as it fills.
function wheelVals(t: number, vw: number, vh: number, rm: boolean, paused: boolean): WheelVals {
  // the scanner owns the viewport: fit it to whichever axis is tighter
  const sc = Math.min(1, (vw - 80) / 1060, (vh - 168) / 700);
  const PT = (rad: number, ang: number) => {
    const a = (ang * Math.PI) / 180;
    return `${(rad * Math.sin(a)).toFixed(1)} ${(-rad * Math.cos(a)).toFixed(1)}`;
  };
  const R1 = 104;
  const R2 = 214;
  const r: WheelVals = { sc, count: Math.round(SIGNALS * t), spin: !rm && !paused, w: [], d: [], c: [] };
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
  const at = phase === "results" ? 2 : 1;
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

const sevColor = (sev: Finding["severity"]) =>
  sev === "Urgent" ? "#f87171" : sev === "Needs attention" ? "#fbbf24" : "#60a5fa";
const sevBg = (sev: Finding["severity"]) =>
  sev === "Urgent" ? "rgba(248,113,113,.12)" : sev === "Needs attention" ? "rgba(251,191,36,.12)" : "rgba(96,165,250,.12)";
const sevBorder = (sev: Finding["severity"]) =>
  sev === "Urgent" ? "rgba(248,113,113,.3)" : sev === "Needs attention" ? "rgba(251,191,36,.3)" : "rgba(96,165,250,.3)";

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FreeScan() {
  const [phase, setPhase] = useState<Phase>("start");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState(0);
  const [, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [vw, setVw] = useState(1200);
  const [vh, setVh] = useState(900);
  const [rm, setRm] = useState(false);

  const stepsRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The interval closures need the live paused value; a ref keeps them in sync with the state.
  const pausedRef = useRef(false);

  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    onResize();
    setRm(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (stepsRef.current) clearInterval(stepsRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
      if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current);
    };
  }, []);

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  };

  const startScan = () => {
    if (!consent) return;
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

  const scanDomain = domain.trim() || "yourcompany.com";
  const scanEmail = email.trim() || "you@yourcompany.com";
  const done = Math.min(step, SCAN_STEPS.length);
  const r = wheelVals(done / SCAN_STEPS.length, vw, vh, rm, paused);
  const pulseAnim = rm || paused ? "none" : "pulseDot 1100ms ease-in-out infinite";
  const scanLabel = paused
    ? "Scan paused — nothing is running against your tenant"
    : done >= SCAN_STEPS.length
    ? "Acquisition complete — compiling readiness signal"
    : CHECKS[Math.min(CHECKS.length - 1, Math.floor((done / SCAN_STEPS.length) * CHECKS.length))];
  const scanCount = Math.round(SIGNALS * (done / SCAN_STEPS.length)) + " of 150+ signals evaluated";

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
                    Your Microsoft 365 domain
                  </label>
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="yourcompany.com"
                    data-testid="freescan-domain"
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
                    Work email for your results
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
                      marginBottom: 16,
                    }}
                  />
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
                  <button
                    onClick={startScan}
                    data-testid="freescan-start"
                    style={{
                      width: "100%",
                      padding: 13,
                      borderRadius: 11,
                      border: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      fontFamily: "inherit",
                      cursor: consent ? "pointer" : "not-allowed",
                      color: consent ? "#fff" : "#64748b",
                      background: consent ? "linear-gradient(90deg,#3b82f6,#8b5cf6)" : "rgba(255,255,255,.05)",
                    }}
                  >
                    Connect and start the scan
                  </button>
                  <p style={{ fontSize: 10.5, color: "#475569", lineHeight: 1.6, margin: "12px 0 0" }}>
                    Read-only means read-only: no setting is changed, no file is opened, no user is emailed. You can
                    revoke access from your tenant at any time.
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
        {phase === "results" && (
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
                      Scan complete · {scanDomain} · {RESULT_DATE}
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
                      We found {TOTAL_FINDINGS} things wrong in your tenant. {URGENT_COUNT} of them are urgent.
                    </h1>
                    <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
                      Everything below is real, read from your own tenant a moment ago — not a sample and not a
                      maturity questionnaire. Each finding shows the actual files, accounts and settings involved, so
                      you can verify any of it yourself in the admin center.
                    </p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
                    {SEVERITY_COUNTS.map((sc) => (
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
                    The money one, first: {WASTE_HEADLINE}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.65 }}>{WASTE_BODY}</div>
                </div>
              </div>
            </section>

            <section style={{ padding: "0 32px 30px" }}>
              <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
                {FINDINGS.map((f) => (
                  <div
                    key={f.title}
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

                      <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.7, margin: "0 0 6px" }}>
                        <b style={{ color: "#f8fafc" }}>What this means:</b> {f.meaning}
                      </p>
                      <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.7, margin: "0 0 16px" }}>
                        <b style={{ color: "#cbd5e1" }}>Why it matters:</b> {f.why}
                      </p>

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
                          <span style={{ fontSize: 10.5, color: "#475569" }}>{f.evidenceNote}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {f.evidence.map((ev, i) => (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                alignItems: "baseline",
                                justifyContent: "space-between",
                                gap: 14,
                                fontSize: 12,
                                lineHeight: 1.5,
                              }}
                            >
                              <span
                                style={{
                                  color: "#e2e8f0",
                                  fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
                                  minWidth: 0,
                                  wordBreak: "break-word",
                                }}
                              >
                                {ev.item}
                              </span>
                              <span style={{ color: "#64748b", flexShrink: 0, fontSize: 11 }}>{ev.meta}</span>
                            </div>
                          ))}
                        </div>
                      </div>
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
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#cbd5e1" }}>The fix: {f.fix}</div>
                            <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55, marginTop: 2 }}>
                              {f.fixEffort} · locked until this tenant is monitored
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
                    {TOTAL_FINDINGS} findings, {URGENT_COUNT} urgent — none of them fix themselves.
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
    </div>
  );
}
