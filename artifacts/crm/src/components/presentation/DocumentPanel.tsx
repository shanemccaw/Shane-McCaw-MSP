import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface DocumentPanelProps {
  doc: {
    id: number;
    title: string;
    category: "report" | "consulting";
    docType: string;
    htmlContent: string;
    createdAt: string | null;
  };
  onReady?: () => void;
}

// ─── per-docType static metadata ──────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  full_readiness_report: "Full Readiness Report",
  security_posture_report: "Security Posture Report",
  governance_maturity_report: "Governance Maturity Report",
  data_exposure_risk_report: "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  sow: "Statement of Work",
  consolidated_sow: "Consolidated SOW",
  remediation_plan: "Remediation Plan",
  deployment_plan: "Deployment Plan",
  governance_framework: "Governance Framework",
  security_hardening_plan: "Security Hardening Plan",
  copilot_enablement_plan: "Copilot Enablement Plan",
  identity_modernization_plan: "Identity Modernization Plan",
};

type RiskLevel = "critical" | "high" | "medium" | "low";

interface DocMeta {
  riskLevel: RiskLevel;
  covers: [string, string, string];
  headline: string;
}

const DOC_TYPE_META: Record<string, DocMeta> = {
  executive_summary: {
    riskLevel: "high",
    covers: ["Top-line tenant health at a glance", "Priority remediation highlights", "Recommended next steps"],
    headline: "Critical risks were identified that require immediate attention.",
  },
  full_readiness_report: {
    riskLevel: "critical",
    covers: ["End-to-end Microsoft 365 tenant assessment", "Security, compliance & licensing gaps", "Roadmap for Copilot readiness"],
    headline: "Your Microsoft 365 environment has critical gaps across multiple domains.",
  },
  security_posture_report: {
    riskLevel: "critical",
    covers: ["Identity & access control gaps", "Conditional Access and MFA coverage", "Immediate hardening priorities"],
    headline: "Significant identity and access vulnerabilities were found in your environment.",
  },
  governance_maturity_report: {
    riskLevel: "high",
    covers: ["Data governance maturity baseline", "SharePoint & Teams sprawl analysis", "Policy and retention gaps"],
    headline: "Governance gaps leave your data, teams, and compliance posture exposed.",
  },
  data_exposure_risk_report: {
    riskLevel: "critical",
    covers: ["External sharing and oversharing risks", "Sensitive data without protection labels", "DLP policy coverage gaps"],
    headline: "Sensitive data is being shared without controls — every file is at risk.",
  },
  license_optimization_report: {
    riskLevel: "medium",
    covers: ["License utilization and waste analysis", "Unlicensed or underused user accounts", "Cost reduction opportunities"],
    headline: "Significant licensing waste was found in your Microsoft 365 tenant.",
  },
  remediation_plan: {
    riskLevel: "high",
    covers: ["Immediate stabilization steps", "90-day hardening roadmap", "Required controls for Copilot readiness"],
    headline: "Immediate action is required to restore a baseline security posture.",
  },
  deployment_plan: {
    riskLevel: "medium",
    covers: ["Phased rollout schedule", "User adoption milestones", "Technical prerequisites and dependencies"],
    headline: "A structured deployment plan is needed to reduce disruption and ensure adoption.",
  },
  governance_framework: {
    riskLevel: "high",
    covers: ["Governance policies and standards", "Teams and SharePoint provisioning controls", "Lifecycle management procedures"],
    headline: "Without governance policies, your tenant is running entirely without guardrails.",
  },
  security_hardening_plan: {
    riskLevel: "critical",
    covers: ["Immediate stabilization steps", "90-day hardening roadmap", "Required controls for Copilot readiness"],
    headline: "Your tenant has critical security gaps that expose every user and every file.",
  },
  copilot_enablement_plan: {
    riskLevel: "critical",
    covers: ["Copilot prerequisite compliance", "User readiness and training plan", "Governance guardrails for AI usage"],
    headline: "Copilot cannot be safely deployed until these foundational gaps are closed.",
  },
  identity_modernization_plan: {
    riskLevel: "high",
    covers: ["Identity hygiene and stale account cleanup", "Conditional Access modernization", "MFA and passwordless adoption path"],
    headline: "Identity vulnerabilities are putting every user account at risk right now.",
  },
  consolidated_sow: {
    riskLevel: "medium",
    covers: ["Full scope of engagement and deliverables", "Timeline and phased pricing breakdown", "Acceptance criteria per phase"],
    headline: "Your engagement roadmap — scope, phases, and investment at a glance.",
  },
  sow: {
    riskLevel: "medium",
    covers: ["Scope of work and engagement terms", "Deliverables and timeline", "Investment and payment structure"],
    headline: "Scope, deliverables, and investment for your engagement.",
  },
};

// ─── Stat card extraction ──────────────────────────────────────────────────────

type StatSeverity = "critical" | "warning" | "info";

interface StatCard {
  value: string;
  label: string;
  detail: string;
  severity: StatSeverity;
}

function extractStatCards(html: string): StatCard[] {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const cards: StatCard[] = [];
  const seen = new Set<string>();

  const add = (card: StatCard) => {
    const key = card.label.toLowerCase().slice(0, 40);
    if (!seen.has(key)) { seen.add(key); cards.push(card); }
  };

  // ── Health / composite scores: find all X/100 values, surface the lowest ──
  const rawScores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (rawScores.length > 0) {
    const worst = Math.min(...rawScores);
    if (worst <= 40) {
      add({
        value: `${worst}/100`,
        label: "Health Score",
        detail: worst === 0 ? "Across all security domains" : "Below minimum security threshold",
        severity: worst <= 10 ? "critical" : "warning",
      });
    }
  }

  // ── Conditional Access absent ──
  if (/no conditional access|zero conditional access|conditional access.*(?:disabled|not configured|is absent|completely absent|not.*deployed)/i.test(text)) {
    add({ value: "ZERO", label: "Conditional Access Policies", detail: "Identity protection completely absent", severity: "critical" });
  }

  // ── No MFA / multi-factor ──
  if (/no mfa\b|mfa.*(?:disabled|not enforced|not configured)|no multi.factor/i.test(text)) {
    add({ value: "NONE", label: "MFA Enforcement", detail: "All accounts accessible with just a password", severity: "critical" });
  }

  // ── Cluster: no advanced security controls (Intune / Defender / DLP / Labels) ──
  const secGaps: string[] = [];
  if (/no intune|intune.*(?:not deployed|disabled|not configured)/i.test(text)) secGaps.push("Intune");
  if (/no defender|defender.*(?:not deployed|disabled|not configured)/i.test(text)) secGaps.push("Defender");
  if (/no dlp|dlp.*(?:not configured|not deployed|zero dlp|disabled)/i.test(text)) secGaps.push("DLP");
  if (/no sensitivity labels?|sensitivity labels?.*(?:not deployed|not configured|zero)/i.test(text)) secGaps.push("Labels");
  if (secGaps.length >= 2) {
    add({ value: "ZERO", label: "Security Controls Deployed", detail: `No ${secGaps.join(" · ")} in place`, severity: "critical" });
  } else if (secGaps.length === 1) {
    add({ value: "NONE", label: `${secGaps[0]} Deployment`, detail: "Advanced security control not configured", severity: "warning" });
  }

  // ── Unlicensed user percentage ──
  // Pattern 1: "91% of users operating without M365 licensing"
  const pctExplicit = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+)?(?:users?\s+)?(?:unlicensed|without.*licens|operating without.*licens|not.*licens)/i)
    ?? text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+users?\s+(?:are\s+)?(?:unlicensed|without|inactive)/i);
  if (pctExplicit) {
    const pct = parseFloat(pctExplicit[1]);
    if (pct > 0) {
      add({ value: `${Math.round(pct)}%`, label: "Users Unlicensed", detail: "Operating without Microsoft 365 licenses", severity: pct >= 70 ? "critical" : "warning" });
    }
  }

  // Pattern 2: "only 2 of 22 users (9.09%) hold active M365 licenses"
  if (!seen.has("users unlicensed")) {
    const fracMatch = text.match(/only\s+(\d+)\s+of\s+(\d+)\s+users?.*?(?:hold|have|are|with)\s+(?:active\s+)?(?:M365|Microsoft 365)\s+licens/i);
    if (fracMatch) {
      const licensed = parseInt(fracMatch[1]);
      const total = parseInt(fracMatch[2]);
      if (total > 0) {
        const unlPct = Math.round(((total - licensed) / total) * 100);
        add({ value: `${unlPct}%`, label: "Users Unlicensed", detail: `${licensed} of ${total} users hold active M365 licenses`, severity: unlPct >= 70 ? "critical" : "warning" });
      }
    }
  }

  // ── Cmdlet / script failures ──
  if (/cmdlet.*(?:fail|error)|(?:fail|error).*cmdlet|cmdlet.*(?:non.functional|unavailable|blocked)/i.test(text)) {
    add({ value: "BLOCKED", label: "Audit Scripts", detail: "Cmdlet failures limit visibility — gaps may be larger", severity: "warning" });
  }

  // ── Zero data governance policies ──
  if (!seen.has("security controls deployed")) {
    if (/zero\s+(?:dlp|data loss|retention|governance|classification)\s+polic|no\s+(?:dlp|data\s+loss|retention)\s+polic/i.test(text)) {
      add({ value: "ZERO", label: "Data Governance Policies", detail: "No DLP, retention, or classification rules exist", severity: "critical" });
    }
  }

  // ── Count of critical / high-risk findings mentioned ──
  const criticalCount = [...text.matchAll(/\bCRITICAL\b/gi)].length;
  if (criticalCount >= 3 && cards.length === 0) {
    add({ value: `${criticalCount}`, label: "Critical Findings", detail: "Identified in this assessment", severity: "critical" });
  }

  return cards.slice(0, 4);
}

// ─── Visual theme per risk level ──────────────────────────────────────────────

const PANEL_THEME: Record<RiskLevel, {
  gradient: string;
  badgeBg: string; badgeText: string; dot: string; badgeLabel: string;
  cardBg: string; cardBorder: string; cardValueColor: string;
  tenantTextColor: string; headlineColor: string; coversColor: string;
}> = {
  critical: {
    gradient: "bg-gradient-to-br from-red-950 via-red-900 to-[#0A2540]",
    badgeBg: "bg-red-500/25", badgeText: "text-red-200", dot: "bg-red-400", badgeLabel: "Critical Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-red-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
  high: {
    gradient: "bg-gradient-to-br from-orange-950 via-orange-900 to-[#0A2540]",
    badgeBg: "bg-orange-500/25", badgeText: "text-orange-200", dot: "bg-orange-400", badgeLabel: "High Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-orange-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
  medium: {
    gradient: "bg-gradient-to-br from-amber-900 via-amber-800 to-[#0A2540]",
    badgeBg: "bg-amber-500/25", badgeText: "text-amber-200", dot: "bg-amber-400", badgeLabel: "Medium Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-amber-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
  low: {
    gradient: "bg-gradient-to-br from-green-950 via-green-900 to-[#0A2540]",
    badgeBg: "bg-green-500/25", badgeText: "text-green-200", dot: "bg-green-400", badgeLabel: "Low Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-green-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
};

const STAT_SEVERITY_ACCENT: Record<StatSeverity, string> = {
  critical: "border-t-red-400",
  warning:  "border-t-orange-400",
  info:     "border-t-blue-400",
};

// ─── Compact fallback bar (for SOW / deployment plan pages) ───────────────────

const COMPACT_THEME: Record<RiskLevel, { bg: string; border: string; text: string; dot: string; label: string }> = {
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500", label: "Critical" },
  high:     { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", dot: "bg-orange-500", label: "High" },
  medium:   { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700", dot: "bg-yellow-400", label: "Medium" },
  low:      { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", dot: "bg-green-500", label: "Low" },
};

// ─── Document iframe helpers ───────────────────────────────────────────────────

const DOC_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.8;
    color: #1e293b;
    background: #fff;
    padding: 2.5rem 3rem;
    max-width: 860px;
    margin: 0 auto;
  }
  h1 { font-size: 1.75rem; font-weight: 800; color: #0A2540; margin: 0 0 0.25rem; letter-spacing: -0.02em; line-height: 1.2; }
  h1 + p, h1 + div { margin-top: 0.75rem; }
  h2 { font-weight: 700; color: #0078D4; margin: 2.25rem 0 0.6rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em; padding-bottom: 0.35rem; border-bottom: 1px solid #e2e8f0; }
  h3 { font-size: 1rem; font-weight: 700; color: #0A2540; margin: 1.5rem 0 0.4rem; }
  h4 { font-size: 0.875rem; font-weight: 600; color: #334155; margin: 1.25rem 0 0.35rem; }
  p { margin: 0 0 0.875rem; color: #334155; line-height: 1.8; }
  ul, ol { margin: 0.25rem 0 1rem 1.5rem; padding: 0; color: #334155; }
  li { margin-bottom: 0.3rem; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0 1.5rem; font-size: 0.85rem; }
  thead tr { background: #f1f5f9; border-bottom: 2px solid #cbd5e1; }
  th { text-align: left; padding: 0.55rem 0.75rem; font-weight: 600; color: #475569; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 0.55rem 0.75rem; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  blockquote, div.callout, div.note, div.highlight, div.info { border-left: 3px solid #0078D4; background: #f8fafc; padding: 0.875rem 1.125rem; margin: 0.75rem 0 1.25rem; border-radius: 0 6px 6px 0; color: #475569; }
  blockquote p, div.callout p, div.note p, div.highlight p, div.info p { margin: 0; color: #475569; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.75rem 0; }
  strong, b { font-weight: 600; color: #0A2540; }
  code { font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 0.8em; background: #f1f5f9; color: #0078D4; padding: 0.15em 0.4em; border-radius: 4px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; font-size: 0.82rem; }
  pre code { background: transparent; color: inherit; padding: 0; }
  a { color: #0078D4; text-decoration: none; }
  a:hover { text-decoration: underline; }
  section { margin-bottom: 1.5rem; }
  div > strong:only-child { display: block; }
`;

function stripFence(html: string): string {
  return html.replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
}
function cleanInlineStyles(html: string): string {
  return html.replace(/\s+style="[^"]*"/gi, "").replace(/\s+style='[^']*'/gi, "");
}
function buildSrcdoc(rawHtml: string): string {
  const body = cleanInlineStyles(stripFence(rawHtml));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${DOC_CSS}</style></head><body>${body}</body></html>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DocumentPanel({ doc, onReady }: DocumentPanelProps) {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const handleIframeLoad = () => { setIframeLoaded(true); onReady?.(); };

  const srcdoc = useMemo(() => buildSrcdoc(doc.htmlContent), [doc.htmlContent]);
  const statCards = useMemo(() => extractStatCards(doc.htmlContent), [doc.htmlContent]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/insights-documents/${doc.id}/view`);
      const data = await res.json() as { htmlContent?: string };
      const html = data.htmlContent ?? "";
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/\s+/g, "-")}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  const typeLabel = DOC_TYPE_LABELS[doc.docType] ?? doc.docType;
  const categoryLabel = doc.category === "consulting" ? "Consulting Deliverable" : "Assessment Report";
  const meta = DOC_TYPE_META[doc.docType] ?? null;
  const riskLevel: RiskLevel = meta?.riskLevel ?? "medium";
  const theme = PANEL_THEME[riskLevel];
  const compactTheme = COMPACT_THEME[riskLevel];
  const formattedDate = formatDate(doc.createdAt);
  const hasOmgPanel = statCards.length > 0;

  return (
    <div className="flex flex-col h-full">

      {/* ── Document header bar ── */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[#0A2540] truncate">{doc.title}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${doc.category === "consulting" ? "bg-purple-100 text-purple-700" : "bg-[#0078D4]/10 text-[#0078D4]"}`}>
                {categoryLabel}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">{typeLabel}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5 flex-shrink-0 disabled:opacity-50"
        >
          {downloading
            ? <div className="w-4 h-4 border-2 border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          }
          Download
        </button>
      </div>

      {/* ── OMG PANEL (full-width gradient panel with large stat cards) ── */}
      {hasOmgPanel && meta ? (
        <div className={`flex-shrink-0 mb-3 rounded-xl overflow-hidden shadow-lg ${theme.gradient}`}>

          {/* Top strip: risk badge + tenant tag */}
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap gap-y-1.5">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-bold ${theme.badgeBg} ${theme.badgeText} border-white/20`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${theme.dot}`} />
              {theme.badgeLabel}
            </div>
            <div className={`flex items-center gap-1.5 text-xs ${theme.tenantTextColor}`}>
              <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="font-semibold text-white/90">Generated from your tenant</span>
              {formattedDate && <span>· {formattedDate}</span>}
            </div>
          </div>

          {/* Headline */}
          <div className="px-4 pb-3">
            <p className={`text-sm font-bold leading-snug ${theme.headlineColor}`}>{meta.headline}</p>
          </div>

          {/* Stat cards */}
          <div className="px-4 pb-3">
            <div className={`grid gap-3 ${statCards.length === 1 ? "grid-cols-1 max-w-[200px]" : statCards.length === 2 ? "grid-cols-2" : statCards.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
              {statCards.map((card, i) => (
                <div
                  key={i}
                  className={`${theme.cardBg} border-2 ${theme.cardBorder} border-t-4 ${STAT_SEVERITY_ACCENT[card.severity]} rounded-xl px-3 py-3 flex flex-col`}
                >
                  <span className={`text-3xl sm:text-4xl font-black tabular-nums leading-none ${theme.cardValueColor}`}>
                    {card.value}
                  </span>
                  <span className="text-[11px] font-bold text-white/90 mt-1.5 leading-tight">{card.label}</span>
                  <span className="text-[10px] text-white/55 mt-0.5 leading-tight">{card.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* What This Covers strip */}
          <div className="px-4 pb-3 border-t border-white/10 pt-2.5">
            <p className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5">What This Document Covers</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {meta.covers.map((c, i) => (
                <span key={i} className={`flex items-center gap-1.5 text-[11px] ${theme.coversColor}`}>
                  <span className="text-white/40">•</span>
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>

      ) : (
        /* ── Compact fallback bar (SOW / deployment plan / no stats found) ── */
        <div className="flex-shrink-0 mb-3 rounded-xl border border-border bg-slate-50 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border flex-wrap gap-y-1.5">
            {meta ? (
              <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-semibold ${compactTheme.bg} ${compactTheme.border} ${compactTheme.text}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${compactTheme.dot}`} />
                Risk Level: {compactTheme.label}
              </div>
            ) : <span />}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="font-medium text-[#0078D4]">Generated from your tenant</span>
              {formattedDate && <span className="text-muted-foreground">· {formattedDate}</span>}
            </div>
          </div>
          {meta && (
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">What This Covers</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {meta.covers.map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs text-slate-700">
                    <span className="text-[#0078D4] font-bold">•</span>{c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── "Supporting Evidence" divider ── */}
      <div className="flex-shrink-0 flex items-center gap-3 mb-2">
        <div className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/70 whitespace-nowrap">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Full Report
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* ── Document iframe ── */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border shadow-sm bg-white relative min-h-0">
        {!iframeLoaded && (
          <div className="absolute inset-0 bg-white rounded-xl p-6 flex flex-col gap-3 z-10">
            {[["w-1/2", "h-7"], ["w-full", "h-4"], ["w-11/12", "h-4"], ["w-4/5", "h-4"]].map(([w, h], i) => (
              <div key={i} className={`${h} bg-slate-100 rounded ${i === 0 ? "rounded-lg" : ""} ${w} overflow-hidden relative`}>
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
              </div>
            ))}
            <div className="mt-2 h-px bg-slate-100 w-full" />
            {[["w-full", "h-4"], ["w-10/12", "h-4"]].map(([w, h], i) => (
              <div key={i} className={`${h} bg-slate-100 rounded ${w} overflow-hidden relative`}>
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
              </div>
            ))}
          </div>
        )}
        <iframe
          srcDoc={srcdoc}
          title={doc.title}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
