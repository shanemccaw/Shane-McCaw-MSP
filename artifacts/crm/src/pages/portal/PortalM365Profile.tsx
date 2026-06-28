import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

// ── Profile type ───────────────────────────────────────────────────────────────

interface M365Profile {
  orgName?: string;
  industry?: string;
  employeeCount?: string;
  licensedUserCount?: string;
  tenantDomain?: string;
  itContactName?: string;
  itContactEmail?: string;
  isMicrosoftPartner?: boolean;
  licenseSKUs?: string[];
  activeUserPercent?: string;
  allUsersLicensed?: boolean;
  usesExchange?: boolean;
  usesTeams?: boolean;
  usesSharePoint?: boolean;
  usesOneDrive?: boolean;
  usesYammer?: boolean;
  sharepointSiteCount?: string;
  teamCount?: string;
  securityGroupCount?: string;
  authMethod?: string;
  externalSharingEnabled?: boolean;
  guestUsersPresent?: boolean;
  isHybrid?: boolean;
  hasOnPremExchange?: boolean;
  usesAADConnect?: boolean;
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  hasAADP1orP2?: boolean;
  intuneEnabled?: boolean;
  hasDefender?: boolean;
  hasDLP?: boolean;
  usesComplianceCenter?: boolean;
  sensitivityLabelsConfigured?: boolean;
  hasRetentionPolicies?: boolean;
  hasInsiderRisk?: boolean;
  hasCopilotLicenses?: boolean;
  copilotLicenseCount?: string;
  copilotUseCase?: string;
  currentAITools?: string;
  dataGovernanceConcerns?: string;
  copilotReadinessScore?: string;
  copilotBlockedBy?: string;
}

// ── Score calculations (same logic as old Scorecards tab) ─────────────────────

function boolScore(fields: (boolean | undefined)[]): number {
  const answered = fields.filter(f => f !== undefined);
  if (answered.length === 0) return 0;
  return Math.round((fields.filter(f => f === true).length / fields.length) * 100);
}

function computeScores(v: M365Profile) {
  const secScore    = boolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]);
  const compScore   = boolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]);
  const copScore    = boolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]);
  const govScore    = boolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]);
  const pct         = parseInt(v.activeUserPercent ?? "0", 10);
  const adoptionScore = Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100);
  return { secScore, compScore, copScore, govScore, adoptionScore };
}

// ── Alerts & Kudos derivation ─────────────────────────────────────────────────

interface Alert { level: "critical" | "warning"; headline: string; why: string; }
interface Kudo  { headline: string; }

function deriveAlerts(v: M365Profile): Alert[] {
  const alerts: Alert[] = [];
  if (v.mfaEnforced === false)              alerts.push({ level: "critical", headline: "MFA is not enforced", why: "Without multi-factor authentication, a single stolen password gives attackers full tenant access." });
  if (v.conditionalAccessEnabled === false) alerts.push({ level: "critical", headline: "No Conditional Access policies", why: "Conditional Access is the primary control that limits where, how, and from which devices users can sign in." });
  if (v.hasDLP === false)                   alerts.push({ level: "critical", headline: "No Data Loss Prevention policies", why: "Sensitive data such as financials or PII can leave the organisation via email or Teams with no automated safeguards." });
  if (v.hasDefender === false)              alerts.push({ level: "warning",  headline: "Microsoft Defender not active", why: "Defender provides anti-phishing, malware, and Safe Links protection for email and collaboration." });
  if (v.sensitivityLabelsConfigured === false) alerts.push({ level: "warning", headline: "Sensitivity labels not configured", why: "Labelling is a prerequisite for Copilot data governance and regulatory compliance frameworks." });
  if (v.hasRetentionPolicies === false)     alerts.push({ level: "warning",  headline: "No retention policies in place", why: "Without retention policies, business-critical data may be permanently deleted or retained indefinitely, creating compliance risk." });
  return alerts;
}

function deriveKudos(v: M365Profile): Kudo[] {
  const kudos: Kudo[] = [];
  if (v.mfaEnforced === true)                   kudos.push({ headline: "MFA enforced — accounts are protected" });
  if (v.hasDefender === true)                    kudos.push({ headline: "Microsoft Defender is active" });
  if (v.sensitivityLabelsConfigured === true)    kudos.push({ headline: "Sensitivity labels are configured" });
  if (v.conditionalAccessEnabled === true)       kudos.push({ headline: "Conditional Access policies in place" });
  if (v.hasDLP === true)                         kudos.push({ headline: "DLP policies protecting data" });
  if (v.usesComplianceCenter === true)           kudos.push({ headline: "Microsoft Purview in use" });
  if (v.hasCopilotLicenses === true)             kudos.push({ headline: "Copilot for M365 licensed and ready" });
  if (v.hasRetentionPolicies === true)           kudos.push({ headline: "Retention policies configured" });
  return kudos;
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-[#F7F9FC]">
        <div className="w-6 h-6 flex items-center justify-center text-[#0078D4] flex-shrink-0">{icon}</div>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{title}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 flex-shrink-0 w-36">{label}</span>
      <span className="text-xs font-semibold text-[#0A2540] text-right flex-1">{value ?? <span className="text-gray-300 font-normal">Not provided</span>}</span>
    </div>
  );
}

function BoolPill({ value, urgentWhenFalse = false, criticalWhenFalse = false }: { value: boolean | undefined; urgentWhenFalse?: boolean; criticalWhenFalse?: boolean }) {
  if (value === undefined) return <span className="inline-flex items-center text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">— Not set</span>;
  if (value) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      Yes
    </span>
  );
  const colorClass = criticalWhenFalse
    ? "text-red-700 bg-red-100"
    : urgentWhenFalse
      ? "text-amber-700 bg-amber-100"
      : "text-red-700 bg-red-100";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${colorClass} px-2 py-0.5 rounded-full`}>
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      No{criticalWhenFalse ? " — action needed" : urgentWhenFalse ? " — review" : ""}
    </span>
  );
}

function ScoreRing({ label, score, tagline, action }: { label: string; score: number; tagline: string; action?: string }) {
  const r    = 34;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color  = score >= 80 ? "#22c55e" : score >= 55 ? "#f59e0b" : "#ef4444";
  const textColor  = score >= 80 ? "text-green-600" : score >= 55 ? "text-amber-600" : "text-red-500";
  const bgClass    = score >= 80 ? "bg-green-50 border-green-100" : score >= 55 ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100";

  return (
    <div className={`flex flex-col items-center gap-3 rounded-2xl border p-4 ${bgClass}`}>
      <div className="relative w-20 h-20 flex items-center justify-center flex-shrink-0">
        <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
          <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-extrabold ${textColor}`}>{score}</span>
          <span className="text-[9px] text-gray-400 font-semibold">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-bold text-[#0A2540] mb-1">{label}</p>
        <p className="text-[11px] text-gray-500 leading-tight">{tagline}</p>
        {action && <p className="text-[11px] text-[#0078D4] mt-1.5 font-medium leading-tight">{action}</p>}
      </div>
    </div>
  );
}

// ── Auth method label ─────────────────────────────────────────────────────────

function authLabel(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const map: Record<string, string> = {
    password: "Password only",
    mfa: "MFA (per-user)",
    sso_saml: "SSO / SAML",
    entra_id: "Entra ID",
    conditional_access: "Conditional Access",
  };
  return map[v] ?? v;
}

// ── Workloads ─────────────────────────────────────────────────────────────────

const WORKLOADS: { key: keyof M365Profile; label: string }[] = [
  { key: "usesExchange",   label: "Exchange Online" },
  { key: "usesTeams",      label: "Microsoft Teams" },
  { key: "usesSharePoint", label: "SharePoint Online" },
  { key: "usesOneDrive",   label: "OneDrive for Business" },
  { key: "usesYammer",     label: "Viva Engage" },
];

// ── Page component ────────────────────────────────────────────────────────────

export default function PortalM365Profile() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [profile, setProfile]   = useState<M365Profile | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/m365-profile").then(r => r.json() as Promise<M365Profile>),
      fetchWithAuth("/api/portal/profile").then(r => r.ok ? r.json() as Promise<{ company?: string | null }> : Promise.resolve({})),
    ])
      .then(([m365, base]) => {
        const merged = { ...m365 };
        if (!merged.orgName && base.company) merged.orgName = base.company;
        setProfile(merged);
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!profile || !profile.orgName) {
    return (
      <PortalLayout>
        <div className="max-w-lg mx-auto px-4 py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#0A2540] mb-3">Your M365 Tenant Command Center</h1>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            Complete your App Registration setup so Shane can connect to your Microsoft 365 environment and populate your Command Center with live tenant data.
          </p>
          <a
            href="/portal/m365-wizard"
            className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            Complete App Registration
          </a>
        </div>
      </PortalLayout>
    );
  }

  // ── Data derivations ───────────────────────────────────────────────────────

  const { secScore, compScore, copScore, govScore, adoptionScore } = computeScores(profile);
  const alerts = deriveAlerts(profile);
  const kudos  = deriveKudos(profile);

  const criticalAlerts = alerts.filter(a => a.level === "critical");
  const warningAlerts  = alerts.filter(a => a.level === "warning");

  const activeWorkloads = WORKLOADS.filter(w => profile[w.key] === true);

  const secTagline    = secScore >= 80 ? "Strong security posture" : secScore >= 55 ? "Good foundation, gaps remain" : "Critical gaps need attention";
  const compTagline   = compScore >= 80 ? "Compliance controls in place" : compScore >= 55 ? "Partially compliant" : "Significant compliance gaps";
  const copTagline    = copScore >= 80 ? "Ready to scale Copilot" : copScore >= 55 ? "Prerequisites mostly met" : "Copilot prerequisites missing";
  const govTagline    = govScore >= 80 ? "Mature governance posture" : govScore >= 55 ? "Governance foundations forming" : "Governance controls needed";
  const adoptTagline  = adoptionScore >= 80 ? "High user adoption" : adoptionScore >= 60 ? "Room to grow adoption" : "Low adoption — licences underused";

  const secAction     = secScore < 55 ? "Enforce MFA and Conditional Access first" : undefined;
  const copAction     = copScore < 55 ? "Security prerequisites needed before Copilot" : undefined;

  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-[#0A2540] to-[#0A2540]/90 rounded-2xl px-6 py-6 text-white shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-wider">M365 Tenant Command Center</span>
              </div>
              <h1 className="text-2xl font-extrabold leading-tight">{profile.orgName}</h1>
              {profile.tenantDomain && (
                <p className="text-sm text-white/60 mt-0.5">{profile.tenantDomain}</p>
              )}
              {profile.industry && (
                <span className="inline-block mt-2 text-[11px] font-semibold bg-white/10 px-2.5 py-1 rounded-full">{profile.industry}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 mt-1">
              {profile.employeeCount && (
                <div className="text-center">
                  <div className="text-2xl font-extrabold text-white">{parseInt(profile.employeeCount).toLocaleString()}</div>
                  <div className="text-[11px] text-white/50 uppercase tracking-wide">Employees</div>
                </div>
              )}
              {profile.licensedUserCount && (
                <div className="text-center">
                  <div className="text-2xl font-extrabold text-[#00B4D8]">{parseInt(profile.licensedUserCount).toLocaleString()}</div>
                  <div className="text-[11px] text-white/50 uppercase tracking-wide">Licensed Users</div>
                </div>
              )}
              {profile.isMicrosoftPartner === true && (
                <div className="text-center">
                  <div className="text-[11px] font-bold text-[#0078D4] bg-[#0078D4]/20 px-2.5 py-1 rounded-full">Microsoft Partner</div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-wrap gap-3 text-xs text-white/50">
              {profile.itContactName && <span>IT Contact: <span className="text-white/80 font-medium">{profile.itContactName}</span></span>}
              {profile.itContactEmail && <span>{profile.itContactEmail}</span>}
            </div>
            <a href="/portal/m365-wizard" className="text-[11px] font-semibold text-white/50 hover:text-white/80 transition-colors flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Update profile
            </a>
          </div>
        </div>

        {/* ── Critical Alerts ──────────────────────────────────────────────── */}
        {!dismissedAlerts && (criticalAlerts.length > 0 || warningAlerts.length > 0) && (
          <div className="rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-red-200 bg-red-100/60">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span className="text-sm font-bold text-red-800">
                  {criticalAlerts.length > 0 ? `${criticalAlerts.length} Critical Issue${criticalAlerts.length > 1 ? "s" : ""} Detected` : `${warningAlerts.length} Improvement${warningAlerts.length > 1 ? "s" : ""} Flagged`}
                </span>
              </div>
              <button onClick={() => setDismissedAlerts(true)} className="text-red-400 hover:text-red-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[...criticalAlerts, ...warningAlerts].map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${a.level === "critical" ? "bg-red-200 text-red-700" : "bg-amber-200 text-amber-700"}`}>
                    {a.level === "critical" ? "URGENT" : "REVIEW"}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#0A2540]">{a.headline}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{a.why}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Kudos strip ─────────────────────────────────────────────────── */}
        {kudos.length > 0 && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-3.5">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <span className="text-xs font-bold text-green-700 uppercase tracking-wider">Good news — things done well</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {kudos.map((k, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-100 border border-green-200 px-2.5 py-1 rounded-full">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  {k.headline}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Score rings ──────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Readiness Scores</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <ScoreRing label="Security Posture"     score={secScore}      tagline={secTagline}   action={secAction} />
            <ScoreRing label="Compliance Coverage"  score={compScore}     tagline={compTagline} />
            <ScoreRing label="Copilot Readiness"    score={copScore}      tagline={copTagline}   action={copAction} />
            <ScoreRing label="Governance Maturity"  score={govScore}      tagline={govTagline} />
            <ScoreRing label="Adoption"             score={adoptionScore} tagline={adoptTagline} />
          </div>
        </div>

        {/* ── Tenant data cards (2-column grid) ───────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Tenant Identity */}
          <SectionCard title="Tenant Identity" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          }>
            <DataRow label="Organisation" value={profile.orgName} />
            <DataRow label="Tenant Domain" value={profile.tenantDomain} />
            <DataRow label="Industry" value={profile.industry} />
            <DataRow label="IT Contact" value={profile.itContactName} />
            <DataRow label="IT Email" value={profile.itContactEmail} />
            <DataRow label="Microsoft Partner" value={profile.isMicrosoftPartner !== undefined ? <BoolPill value={profile.isMicrosoftPartner} /> : undefined} />
          </SectionCard>

          {/* Scale */}
          <SectionCard title="Scale" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          }>
            <DataRow label="Employees" value={profile.employeeCount} />
            <DataRow label="Licensed Users" value={profile.licensedUserCount} />
            <DataRow label="SharePoint Sites" value={profile.sharepointSiteCount} />
            <DataRow label="Teams Count" value={profile.teamCount} />
            <DataRow label="Security Groups" value={profile.securityGroupCount} />
            <DataRow label="Auth Method" value={authLabel(profile.authMethod)} />
          </SectionCard>

          {/* Active Workloads */}
          <SectionCard title="Active Workloads" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
          }>
            {activeWorkloads.length > 0 ? (
              <div className="flex flex-wrap gap-2 py-1">
                {activeWorkloads.map(w => (
                  <span key={w.key as string} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] bg-[#0078D4]/8 border border-[#0078D4]/20 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    {w.label}
                  </span>
                ))}
                {WORKLOADS.filter(w => profile[w.key] === false).map(w => (
                  <span key={w.key as string} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    {w.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 py-2">No workload data provided yet.</p>
            )}
          </SectionCard>

          {/* Licensing */}
          <SectionCard title="Licensing" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
          }>
            {(profile.licenseSKUs ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5 py-1">
                {(profile.licenseSKUs ?? []).map(sku => (
                  <span key={sku} className="text-[11px] font-semibold text-[#0A2540] bg-gray-100 px-2 py-0.5 rounded">{sku}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 py-1">No SKUs provided</p>
            )}
            <div className="mt-3 space-y-0">
              <DataRow label="Active User %" value={profile.activeUserPercent ? `${profile.activeUserPercent}%` : undefined} />
              <DataRow label="All Users Licensed" value={profile.allUsersLicensed !== undefined ? <BoolPill value={profile.allUsersLicensed} urgentWhenFalse /> : undefined} />
            </div>
          </SectionCard>

          {/* Identity & Access */}
          <SectionCard title="Identity & Access" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          }>
            <DataRow label="MFA Enforced"           value={<BoolPill value={profile.mfaEnforced} criticalWhenFalse />} />
            <DataRow label="Conditional Access"     value={<BoolPill value={profile.conditionalAccessEnabled} criticalWhenFalse />} />
            <DataRow label="Entra ID P1 / P2"       value={<BoolPill value={profile.hasAADP1orP2} urgentWhenFalse />} />
            <DataRow label="Intune / MDM"           value={<BoolPill value={profile.intuneEnabled} urgentWhenFalse />} />
          </SectionCard>

          {/* Data Protection */}
          <SectionCard title="Data Protection" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          }>
            <DataRow label="Defender for M365"      value={<BoolPill value={profile.hasDefender} urgentWhenFalse />} />
            <DataRow label="DLP Policies"           value={<BoolPill value={profile.hasDLP} criticalWhenFalse />} />
            <DataRow label="Sensitivity Labels"     value={<BoolPill value={profile.sensitivityLabelsConfigured} urgentWhenFalse />} />
            <DataRow label="Retention Policies"     value={<BoolPill value={profile.hasRetentionPolicies} urgentWhenFalse />} />
          </SectionCard>

          {/* Compliance */}
          <SectionCard title="Compliance" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          }>
            <DataRow label="Microsoft Purview"      value={<BoolPill value={profile.usesComplianceCenter} urgentWhenFalse />} />
            <DataRow label="Insider Risk Mgmt"      value={<BoolPill value={profile.hasInsiderRisk} />} />
          </SectionCard>

          {/* Environment Flags */}
          <SectionCard title="Environment Flags" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
          }>
            <DataRow label="Hybrid Environment"     value={<BoolPill value={profile.isHybrid} />} />
            <DataRow label="On-prem Exchange"       value={<BoolPill value={profile.hasOnPremExchange} />} />
            <DataRow label="Entra Connect"          value={<BoolPill value={profile.usesAADConnect} />} />
            <DataRow label="External Sharing"       value={<BoolPill value={profile.externalSharingEnabled} urgentWhenFalse={false} />} />
            <DataRow label="Guest Users"            value={<BoolPill value={profile.guestUsersPresent} />} />
          </SectionCard>

          {/* Copilot Readiness — full-width */}
          <div className="md:col-span-2">
            <SectionCard title="Copilot Readiness" icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            }>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <div>
                  <DataRow label="Copilot Licensed"     value={<BoolPill value={profile.hasCopilotLicenses} />} />
                  <DataRow label="License Count"        value={profile.copilotLicenseCount} />
                  <DataRow label="Readiness Score"      value={profile.copilotReadinessScore ? `${profile.copilotReadinessScore} / 5` : undefined} />
                  <DataRow label="Primary Blocker"      value={profile.copilotBlockedBy && profile.copilotBlockedBy !== "None" ? profile.copilotBlockedBy : (profile.copilotBlockedBy === "None" ? "None identified" : undefined)} />
                </div>
                <div>
                  {profile.copilotUseCase && (
                    <div className="py-2 border-b border-gray-50">
                      <p className="text-xs text-gray-500 mb-1">Use Cases</p>
                      <p className="text-xs font-semibold text-[#0A2540] leading-relaxed">{profile.copilotUseCase}</p>
                    </div>
                  )}
                  {profile.dataGovernanceConcerns && (
                    <div className="py-2 border-b border-gray-50">
                      <p className="text-xs text-gray-500 mb-1">Data Governance Concerns</p>
                      <p className="text-xs font-semibold text-amber-700 leading-relaxed">{profile.dataGovernanceConcerns}</p>
                    </div>
                  )}
                  {profile.currentAITools && (
                    <div className="py-2">
                      <p className="text-xs text-gray-500 mb-1">Current AI Tools</p>
                      <p className="text-xs font-semibold text-[#0A2540] leading-relaxed">{profile.currentAITools}</p>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>

        </div>

        {/* Update nudge */}
        <div className="text-center py-2">
          <a href="/portal/m365-wizard" className="text-xs text-gray-400 hover:text-[#0078D4] transition-colors flex items-center justify-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Update your tenant profile via the setup wizard
          </a>
        </div>

      </div>
    </PortalLayout>
  );
}
