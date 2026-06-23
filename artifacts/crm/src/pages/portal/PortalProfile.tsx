import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface Profile {
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}

type AlertState = { type: "success" | "error"; message: string } | null;

// ── M365 data shape (mirrors API response) ────────────────────────────────────

interface M365Data {
  orgName?: string;
  tenantDomain?: string;
  industry?: string;
  employeeCount?: string;
  licensedUserCount?: string;
  itContactName?: string;
  itContactEmail?: string;
  isMicrosoftPartner?: boolean;

  licenseSKUs?: string[];
  allUsersLicensed?: boolean;
  activeUserPercent?: string;
  usesExchange?: boolean;
  usesTeams?: boolean;
  usesSharePoint?: boolean;
  usesOneDrive?: boolean;
  usesYammer?: boolean;

  sharepointSiteCount?: string;
  teamCount?: string;
  securityGroupCount?: string;
  authMethod?: string;
  isHybrid?: boolean;
  hasOnPremExchange?: boolean;
  usesAADConnect?: boolean;
  externalSharingEnabled?: boolean;
  guestUsersPresent?: boolean;

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
  copilotLicenseCount?: string;
  copilotUseCase?: string;
  currentAITools?: string;
  dataGovernanceConcerns?: string;
  copilotReadinessScore?: string;
  copilotBlockedBy?: string;

  engagementType?: string;
  budgetRange?: string;
  engagementStartDate?: string;
  estimatedDuration?: string;
  decisionMakerName?: string;
  decisionMakerEmail?: string;
  businessGoals?: string;
  knownBlockers?: string;
  referralSource?: string;
}

function isM365Empty(d: M365Data): boolean {
  for (const v of Object.values(d)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return false;
  }
  return true;
}

// ── Small display helpers ─────────────────────────────────────────────────────

const NS = <span className="text-muted-foreground/50 text-xs italic">Not set</span>;

function Txt({ v }: { v: string | undefined }) {
  return v && v.trim() ? <span className="text-sm text-[#0A2540]">{v}</span> : NS;
}

function Bool({ v }: { v: boolean | undefined }) {
  if (v === undefined) return NS;
  return v ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Yes</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">No</span>
  );
}

function Pills({ v }: { v: string[] | undefined }) {
  if (!v || v.length === 0) return NS;
  return (
    <div className="flex flex-wrap gap-1.5">
      {v.map(s => (
        <span key={s} className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#0078D4]/8 text-[#0078D4] border border-[#0078D4]/20">{s}</span>
      ))}
    </div>
  );
}

const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5 block";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-[#F7F9FC]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">{title}</h3>
      </div>
      <div className="px-5 py-5 grid grid-cols-2 sm:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}

function PanelWide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-[#F7F9FC]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">{title}</h3>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

// ── M365 summary display ──────────────────────────────────────────────────────

function M365ProfileSummary({ data }: { data: M365Data }) {
  return (
    <div className="space-y-4">
      {/* Organization */}
      <Panel title="Organization">
        <Row label="Org Name"><Txt v={data.orgName} /></Row>
        <Row label="Tenant Domain"><Txt v={data.tenantDomain} /></Row>
        <Row label="Industry"><Txt v={data.industry} /></Row>
        <Row label="Total Employees"><Txt v={data.employeeCount} /></Row>
        <Row label="Licensed M365 Users"><Txt v={data.licensedUserCount} /></Row>
        <Row label="IT Contact"><Txt v={data.itContactName} /></Row>
        <Row label="IT Contact Email"><Txt v={data.itContactEmail} /></Row>
        <Row label="Microsoft Partner"><Bool v={data.isMicrosoftPartner} /></Row>
      </Panel>

      {/* Licensing & Workloads */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-[#F7F9FC]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">Licensing &amp; Workloads</h3>
        </div>
        <div className="px-5 py-5 space-y-4">
          <Row label="License SKUs"><Pills v={data.licenseSKUs} /></Row>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Row label="Active User %"><Txt v={data.activeUserPercent} /></Row>
            <Row label="All Users Licensed"><Bool v={data.allUsersLicensed} /></Row>
            <Row label="Exchange Online"><Bool v={data.usesExchange} /></Row>
            <Row label="Microsoft Teams"><Bool v={data.usesTeams} /></Row>
            <Row label="SharePoint Online"><Bool v={data.usesSharePoint} /></Row>
            <Row label="OneDrive for Business"><Bool v={data.usesOneDrive} /></Row>
            <Row label="Viva Engage / Yammer"><Bool v={data.usesYammer} /></Row>
          </div>
        </div>
      </div>

      {/* Environment Structure */}
      <Panel title="Environment Structure">
        <Row label="SharePoint Sites"><Txt v={data.sharepointSiteCount} /></Row>
        <Row label="Teams Count"><Txt v={data.teamCount} /></Row>
        <Row label="Security Groups"><Txt v={data.securityGroupCount} /></Row>
        <Row label="Auth Method"><Txt v={data.authMethod} /></Row>
        <Row label="Hybrid Environment"><Bool v={data.isHybrid} /></Row>
        <Row label="On-Prem Exchange"><Bool v={data.hasOnPremExchange} /></Row>
        <Row label="AAD Connect"><Bool v={data.usesAADConnect} /></Row>
        <Row label="External Sharing"><Bool v={data.externalSharingEnabled} /></Row>
        <Row label="Guest Users Present"><Bool v={data.guestUsersPresent} /></Row>
      </Panel>

      {/* Security & Compliance */}
      <Panel title="Security &amp; Compliance">
        <Row label="MFA Enforced"><Bool v={data.mfaEnforced} /></Row>
        <Row label="Conditional Access"><Bool v={data.conditionalAccessEnabled} /></Row>
        <Row label="Intune (MDM)"><Bool v={data.intuneEnabled} /></Row>
        <Row label="AAD P1 / P2"><Bool v={data.hasAADP1orP2} /></Row>
        <Row label="Microsoft Defender"><Bool v={data.hasDefender} /></Row>
        <Row label="DLP Policies"><Bool v={data.hasDLP} /></Row>
        <Row label="Compliance Center"><Bool v={data.usesComplianceCenter} /></Row>
        <Row label="Sensitivity Labels"><Bool v={data.sensitivityLabelsConfigured} /></Row>
        <Row label="Retention Policies"><Bool v={data.hasRetentionPolicies} /></Row>
        <Row label="Insider Risk Mgmt"><Bool v={data.hasInsiderRisk} /></Row>
      </Panel>

      {/* Copilot Readiness */}
      <Panel title="Copilot Readiness">
        <Row label="Copilot Licenses"><Bool v={data.hasCopilotLicenses} /></Row>
        <Row label="License Count"><Txt v={data.copilotLicenseCount} /></Row>
        <Row label="Readiness Score"><Txt v={data.copilotReadinessScore} /></Row>
        <Row label="Use Case"><Txt v={data.copilotUseCase} /></Row>
        <Row label="Current AI Tools"><Txt v={data.currentAITools} /></Row>
        <Row label="Blocked By"><Txt v={data.copilotBlockedBy} /></Row>
        <Row label="Data Governance Concerns"><Txt v={data.dataGovernanceConcerns} /></Row>
      </Panel>

      {/* Engagement */}
      <PanelWide title="Engagement">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Row label="Engagement Type"><Txt v={data.engagementType} /></Row>
          <Row label="Budget Range"><Txt v={data.budgetRange} /></Row>
          <Row label="Start Date"><Txt v={data.engagementStartDate} /></Row>
          <Row label="Duration"><Txt v={data.estimatedDuration} /></Row>
          <Row label="Decision Maker"><Txt v={data.decisionMakerName} /></Row>
          <Row label="Decision Maker Email"><Txt v={data.decisionMakerEmail} /></Row>
          <Row label="Referral Source"><Txt v={data.referralSource} /></Row>
        </div>
        {(data.businessGoals?.trim() || data.knownBlockers?.trim()) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
            {data.businessGoals?.trim() && (
              <Row label="Business Goals">
                <p className="text-sm text-[#0A2540] whitespace-pre-line leading-relaxed">{data.businessGoals}</p>
              </Row>
            )}
            {data.knownBlockers?.trim() && (
              <Row label="Known Blockers">
                <p className="text-sm text-[#0A2540] whitespace-pre-line leading-relaxed">{data.knownBlockers}</p>
              </Row>
            )}
          </div>
        )}
      </PanelWide>
    </div>
  );
}

const editButton = (
  <Link
    href="/portal/m365-profile"
    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] border border-[#0078D4] px-4 py-2 rounded-xl hover:bg-[#0078D4]/5 transition-colors"
  >
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
    Edit M365 Profile
  </Link>
);

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PortalProfile() {
  const { fetchWithAuth } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [email, setEmail] = useState("");

  const [m365Data, setM365Data] = useState<M365Data | null>(null);
  const [m365Loading, setM365Loading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/profile")
      .then(r => r.json())
      .then((data: Profile) => {
        setName(data.name ?? "");
        setEmail(data.email ?? "");
        setCompany(data.company ?? "");
        setPhone(data.phone ?? "");
        setAddress(data.address ?? "");
        setAddressCity(data.addressCity ?? "");
        setAddressState(data.addressState ?? "");
        setAddressZip(data.addressZip ?? "");
      })
      .catch(() => setAlert({ type: "error", message: "Could not load your profile. Please refresh." }))
      .finally(() => setLoading(false));

    fetchWithAuth("/api/portal/m365-profile")
      .then(r => r.ok ? r.json() as Promise<M365Data> : null)
      .then(d => setM365Data(d))
      .catch(() => null)
      .finally(() => setM365Loading(false));
  }, [fetchWithAuth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, phone, address, addressCity, addressState, addressZip }),
      });
      if (res.ok) {
        setAlert({ type: "success", message: "Profile updated successfully." });
      } else {
        const err = await res.json() as { error?: string };
        setAlert({ type: "error", message: err.error ?? "Could not save your profile. Please try again." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-[#0A2540]">Profile Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Keep your contact details up to date — they are pre-filled on contracts and purchase forms.
          </p>
        </div>

        {alert && (
          <div className={`mb-6 flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
            alert.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}>
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {alert.type === "success" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
              )}
            </svg>
            <span>{alert.message}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-[#0A2540]">Account</h2>
              </div>
              <div className="px-5 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-gray-50 text-sm text-muted-foreground cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Email cannot be changed here. Contact support if needed.</p>
                </div>
                <div>
                  <label htmlFor="profile-name" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="profile-company" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Company / Organization
                  </label>
                  <input
                    id="profile-company"
                    type="text"
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-[#0A2540]">Contact Details</h2>
              </div>
              <div className="px-5 py-5 space-y-4">
                <div>
                  <label htmlFor="profile-phone" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="profile-address" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Street Address
                  </label>
                  <input
                    id="profile-address"
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Main St"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="profile-city" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                      City
                    </label>
                    <input
                      id="profile-city"
                      type="text"
                      value={addressCity}
                      onChange={e => setAddressCity(e.target.value)}
                      placeholder="Springfield"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-state" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                      State
                    </label>
                    <input
                      id="profile-state"
                      type="text"
                      value={addressState}
                      onChange={e => setAddressState(e.target.value)}
                      placeholder="IL"
                      maxLength={2}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors uppercase"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-zip" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                      ZIP Code
                    </label>
                    <input
                      id="profile-zip"
                      type="text"
                      value={addressZip}
                      onChange={e => setAddressZip(e.target.value)}
                      placeholder="62701"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
              >
                {saving && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Save changes
              </button>
            </div>
          </form>
        )}

        {/* ── M365 Environment section ──────────────────────────────────────── */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-[#0A2540]">M365 Environment</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Read-only snapshot — use the wizard to update any field.
              </p>
            </div>
            {editButton}
          </div>

          {m365Loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              Loading M365 profile…
            </div>
          ) : !m365Data || isM365Empty(m365Data) ? (
            <div className="bg-white rounded-2xl border border-border shadow-sm p-8 flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 bg-[#0078D4]/8 rounded-2xl flex items-center justify-center">
                <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0A2540]">Your M365 environment profile is empty</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Complete it so Shane can tailor your engagement — the more context he has, the faster he can get started.
                </p>
              </div>
              <Link
                href="/portal/m365-profile"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0078D4] px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors"
              >
                Complete M365 Profile →
              </Link>
            </div>
          ) : (
            <>
              <M365ProfileSummary data={m365Data} />
              <div className="mt-4 flex justify-end">
                {editButton}
              </div>
            </>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
