import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface M365Profile {
  orgName?: string;
  industry?: string;
  employeeCount?: string;
  licensedUserCount?: string;
  itContactName?: string;
  itContactEmail?: string;
  tenantDomain?: string;
  isMicrosoftPartner?: boolean;
  licenseSKUs?: string[];
  allUsersLicensed?: boolean;
  activeUserPercent?: string;
  usesExchange?: boolean;
  usesTeams?: boolean;
  usesSharePoint?: boolean;
  usesOneDrive?: boolean;
  usesYammer?: boolean;
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  intuneEnabled?: boolean;
  hasCopilotLicenses?: boolean;
  copilotReadinessScore?: string;
  copilotUseCase?: string;
  currentAITools?: string;
  dataGovernanceConcerns?: string;
  businessGoals?: string;
  engagementType?: string;
  engagementStartDate?: string;
  estimatedDuration?: string;
  budgetRange?: string;
  decisionMakerName?: string;
  decisionMakerEmail?: string;
  sharepointSiteCount?: string;
  teamCount?: string;
  securityGroupCount?: string;
  authMethod?: string;
  isHybrid?: boolean;
  externalSharingEnabled?: boolean;
  guestUsersPresent?: boolean;
  referralSource?: string;
  copilotBlockedBy?: string;
  copilotLicenseCount?: string;
}

// ── Completion logic (mirrors PortalM365Profile.tsx) ─────────────────────────
const STRING_FIELDS: (keyof M365Profile)[] = [
  "orgName", "industry", "employeeCount", "licensedUserCount",
  "itContactName", "itContactEmail", "tenantDomain",
  "activeUserPercent", "sharepointSiteCount", "teamCount",
  "securityGroupCount", "authMethod",
  "copilotUseCase", "currentAITools", "dataGovernanceConcerns",
  "engagementType", "engagementStartDate", "estimatedDuration",
  "budgetRange", "decisionMakerName", "decisionMakerEmail",
  "businessGoals", "referralSource",
];

const BOOL_FIELDS: (keyof M365Profile)[] = [
  "isMicrosoftPartner", "allUsersLicensed", "usesExchange", "usesTeams",
  "usesSharePoint", "usesOneDrive", "externalSharingEnabled",
  "guestUsersPresent", "isHybrid", "mfaEnforced", "conditionalAccessEnabled",
  "intuneEnabled", "hasCopilotLicenses",
];

const TOTAL_FIELDS = STRING_FIELDS.length + BOOL_FIELDS.length + 1; // +1 for licenseSKUs

function computeCompletion(profile: M365Profile): number {
  let filled = 0;
  for (const k of STRING_FIELDS) {
    const v = profile[k];
    if (typeof v === "string" && v.trim() !== "") filled++;
  }
  for (const k of BOOL_FIELDS) {
    if (profile[k] !== undefined) filled++;
  }
  if ((profile.licenseSKUs ?? []).length > 0) filled++;
  return Math.round((filled / TOTAL_FIELDS) * 100);
}

// ── Workload helpers ──────────────────────────────────────────────────────────
const WORKLOAD_LABELS: { key: keyof M365Profile; label: string; icon: string }[] = [
  { key: "usesTeams",      label: "Teams",      icon: "💬" },
  { key: "usesExchange",   label: "Exchange",   icon: "📧" },
  { key: "usesSharePoint", label: "SharePoint", icon: "🗂️" },
  { key: "usesOneDrive",   label: "OneDrive",   icon: "☁️" },
  { key: "usesYammer",     label: "Viva Engage", icon: "👥" },
];

function activeWorkloads(profile: M365Profile) {
  return WORKLOAD_LABELS.filter(w => profile[w.key] === true).slice(0, 3);
}

// ── Copilot readiness colour ──────────────────────────────────────────────────
function copilotColor(score: string | undefined): string {
  const n = parseInt(score ?? "0", 10);
  if (n >= 4) return "text-green-600";
  if (n >= 3) return "text-yellow-600";
  return "text-red-500";
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Pill({ children, green }: { children: React.ReactNode; green: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
      green ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
    }`}>
      {children}
    </span>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
      <span className="text-sm font-bold text-[#0A2540]">{value || "—"}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function M365ProfileSummaryCard() {
  const { fetchWithAuth } = useAuth();
  const [profile, setProfile] = useState<M365Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/m365-profile")
      .then(r => (r.ok ? r.json() : null))
      .then((d: M365Profile | null) => setProfile(d))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) return null;
  if (!profile || !profile.orgName) return null;

  const completion = computeCompletion(profile);
  const workloads = activeWorkloads(profile);
  const isLow = completion < 60;
  const copilotScore = profile.copilotReadinessScore
    ? `${profile.copilotReadinessScore} / 5`
    : "Not set";

  return (
    <section>
      <div className="bg-white border border-border rounded-xl overflow-hidden shadow-sm">
        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-[#F7F9FC]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0A2540] leading-tight">Your M365 Profile at a Glance</h2>
              <p className="text-xs text-muted-foreground">{profile.orgName}</p>
            </div>
          </div>
          <Link href="/portal/m365-profile">
            <span className="text-xs font-semibold text-[#0078D4] hover:underline cursor-pointer whitespace-nowrap">
              Edit profile →
            </span>
          </Link>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Completion bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-[#0A2540]">Profile completion</span>
              <span className={`text-xs font-bold ${isLow ? "text-amber-600" : "text-green-600"}`}>
                {completion}%
              </span>
            </div>
            <div className="w-full bg-[#F7F9FC] rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${isLow ? "bg-amber-400" : "bg-[#0078D4]"}`}
                style={{ width: `${completion}%` }}
              />
            </div>
            {isLow && (
              <p className="text-xs text-amber-700 mt-1.5 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Fill in a few more details to help Shane tailor your engagement.
              </p>
            )}
          </div>

          {/* Key stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
            <StatBlock label="Employees" value={profile.employeeCount ?? ""} />
            <StatBlock label="Licensed Users" value={profile.licensedUserCount ?? ""} />
            <StatBlock label="Copilot Readiness" value={copilotScore} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">MFA</span>
              {profile.mfaEnforced === undefined ? (
                <span className="text-sm font-bold text-muted-foreground">—</span>
              ) : (
                <Pill green={profile.mfaEnforced === true}>
                  {profile.mfaEnforced ? "✓ Enforced" : "✗ Not enforced"}
                </Pill>
              )}
            </div>
          </div>

          {/* Active workloads */}
          {workloads.length > 0 && (
            <div className="pt-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-2">Active workloads</span>
              <div className="flex flex-wrap gap-2">
                {workloads.map(w => (
                  <span
                    key={w.key as string}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4]/8 text-[#0078D4] border border-[#0078D4]/20 px-2.5 py-1 rounded-full"
                  >
                    <span>{w.icon}</span>
                    {w.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer: copilot detail if score set */}
        {profile.copilotReadinessScore && parseInt(profile.copilotReadinessScore, 10) > 0 && (
          <div className={`px-5 py-2.5 border-t border-border flex items-center gap-2 text-xs ${copilotColor(profile.copilotReadinessScore)} bg-[#F7F9FC]`}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Copilot readiness score: <strong>{profile.copilotReadinessScore} / 5</strong>
            {parseInt(profile.copilotReadinessScore, 10) < 3 && " — some blockers remain. Edit your profile to update."}
          </div>
        )}
      </div>
    </section>
  );
}
