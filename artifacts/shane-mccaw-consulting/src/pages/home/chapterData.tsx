import type { ReactNode } from "react";

export interface ChapterBenchmark {
  metricLabel: string;
  orgPct: number;
  topPct: number;
  sparkline: string;
}

export interface ChapterCostBox {
  body: string;
  note: string;
}

export interface ChapterDatum {
  index: number;
  tag: string;
  color: string;
  glow: string;
  icon: ReactNode;
  /** Big stat rendered with a `data-countup`-equivalent animated number. */
  statValue: number | null;
  statPrefix?: string;
  statSuffix?: string;
  /** Used only when there's no numeric count-up (Health's "Hourly"). */
  statLiteral?: string;
  statCaption: string;
  bench: ChapterBenchmark;
  whatWeCheck: string[];
  quote: string;
  costBox?: ChapterCostBox;
}

const ICON_STROKE_PROPS = { fill: "none", strokeWidth: 0.45, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const CHAPTERS: ChapterDatum[] = [
  {
    index: 0,
    tag: "Pillar 01 — Governance",
    color: "#60a5fa",
    glow: "rgba(37,99,235,.14)",
    icon: (
      <svg viewBox="0 0 24 24" width="340" height="340" stroke="#60a5fa" {...ICON_STROKE_PROPS}>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
    statValue: 3,
    statPrefix: "1 in ",
    statCaption: "tenants have nobody named as the day-to-day owner of Microsoft 365 governance.",
    bench: {
      metricLabel: "Share of high-value sites with a verified owner",
      orgPct: 38,
      topPct: 89,
      sparkline: "0.0,23.5 16.0,22.5 32.0,23.0 48.0,20.5 64.0,19.5 80.0,17.5 96.0,16.5 112.0,14.3",
    },
    whatWeCheck: ["SharePoint sharing exposure", "Guest account activity", "Site lifecycle policy coverage"],
    quote: "“Governance is not a document. It is knowing, this afternoon, who owns the site that holds the salary review.”",
  },
  {
    index: 1,
    tag: "Pillar 02 — Security",
    color: "#a78bfa",
    glow: "rgba(139,92,246,.13)",
    icon: (
      <svg viewBox="0 0 24 24" width="340" height="340" stroke="#a78bfa" {...ICON_STROKE_PROPS}>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      </svg>
    ),
    statValue: 41,
    statSuffix: "%",
    statCaption: "of tenants still have a path that bypasses Conditional Access somewhere.",
    bench: {
      metricLabel: "Sign-ins fully covered by a Conditional Access policy",
      orgPct: 53,
      topPct: 94,
      sparkline: "0.0,21.8 16.0,20.5 32.0,21.0 48.0,18.5 64.0,17.0 80.0,15.5 96.0,14.5 112.0,12.5",
    },
    whatWeCheck: ["Secure Score history", "Conditional Access policy coverage", "MFA registration state", "Legacy authentication usage"],
    quote: "“Every tenant I have opened has an exclusion list. The question is only whether anyone still knows why.”",
  },
  {
    index: 2,
    tag: "Pillar 03 — Compliance",
    color: "#D1D5DB",
    glow: "rgba(148,163,184,.10)",
    icon: (
      <svg viewBox="0 0 24 24" width="340" height="340" stroke="#D1D5DB" {...ICON_STROKE_PROPS}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    ),
    statValue: 6,
    statSuffix: " mo",
    statCaption: "median time before an unlabelled, over-shared site is noticed at all.",
    bench: {
      metricLabel: "Sensitive sites carrying an applied sensitivity label",
      orgPct: 29,
      topPct: 86,
      sparkline: "0.0,23.0 16.0,23.3 32.0,21.5 48.0,20.5 64.0,20.8 80.0,18.5 96.0,17.0 112.0,15.5",
    },
    whatWeCheck: ["Sensitivity label coverage", "DLP policy configuration"],
    quote: "“A taxonomy nobody applies is a slide deck. Auto-labelling is the only version of this that holds.”",
  },
  {
    index: 3,
    tag: "Pillar 04 — Licensing",
    color: "#2dd4bf",
    glow: "rgba(20,184,166,.13)",
    icon: (
      <svg viewBox="0 0 24 24" width="340" height="340" stroke="#2dd4bf" {...ICON_STROKE_PROPS}>
        <circle cx="12" cy="12" r="10" />
        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
        <path d="M12 18V6" />
      </svg>
    ),
    statValue: 22,
    statSuffix: "%",
    statCaption: "of purchased Copilot seats show no meaningful use after ninety days.",
    bench: {
      metricLabel: "Assigned Copilot seats active in the last 30 days",
      orgPct: 78,
      topPct: 97,
      sparkline: "0.0,20.5 16.0,19.0 32.0,19.5 48.0,17.0 64.0,15.0 80.0,13.5 96.0,13.0 112.0,11.0",
    },
    whatWeCheck: ["License assignment and utilization (subscribedSkus)", "Duplicate and unused seat detection"],
    quote: "“Reclaiming dormant seats has paid for the whole engagement more than once. It is the least interesting finding and the fastest one.”",
    costBox: {
      body: "The dormant seats we typically find are worth more than the assessment costs. On a tenant this size, reclaiming them often covers the engagement outright — before a single finding is fixed.",
      note: "Illustrative, drawn from aggregate patterns. Your figure comes from your own tenant.",
    },
  },
  {
    index: 4,
    tag: "Pillar 05 — Adoption",
    color: "#fb923c",
    glow: "rgba(249,115,22,.12)",
    icon: (
      <svg viewBox="0 0 24 24" width="340" height="340" stroke="#fb923c" {...ICON_STROKE_PROPS}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    statValue: 3,
    statSuffix: " apps",
    statCaption: "carry nearly all Copilot usage. Everything else stays untouched.",
    bench: {
      metricLabel: "Licensed users who completed role-specific enablement",
      orgPct: 31,
      topPct: 82,
      sparkline: "0.0,24.3 16.0,23.0 32.0,22.0 48.0,22.5 64.0,20.0 80.0,18.0 96.0,17.0 112.0,15.0",
    },
    whatWeCheck: ["Microsoft 365 usage activity (Teams, OneDrive, email)", "Copilot app usage activity"],
    quote: "“Nobody fails to adopt Copilot because it is hard. They fail because the second prompt was never demonstrated.”",
  },
  {
    index: 5,
    tag: "Pillar 06 — Health",
    color: "#4ADE80",
    glow: "rgba(34,197,94,.12)",
    icon: (
      <svg viewBox="0 0 24 24" width="340" height="340" stroke="#4ADE80" {...ICON_STROKE_PROPS}>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    statValue: null,
    statLiteral: "Hourly",
    statCaption: "how often tenant configuration changes. Most reviews run quarterly.",
    bench: {
      metricLabel: "Configuration changes detected within 24 hours",
      orgPct: 17,
      topPct: 91,
      sparkline: "0.0,22.5 16.0,21.5 32.0,20.0 48.0,19.0 64.0,17.5 80.0,16.0 96.0,14.0 112.0,12.0",
    },
    whatWeCheck: ["Directory audit log review", "Configuration drift over time"],
    quote: "“Stop finding out about problems six months late. Nothing in this list is hard once you can see it happen.”",
  },
];
