import { useEffect, useState, useCallback } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ─── Profile shape ────────────────────────────────────────────────────────────
interface M365Profile {
  orgName: string;
  industry: string;
  employeeCount: string;
  licensedUserCount: string;
  itContactName: string;
  itContactEmail: string;
  tenantDomain: string;
  isMicrosoftPartner: boolean;
  licenseSKUs: string[];
  allUsersLicensed: boolean;
  activeUserPercent: string;
  usesExchange: boolean;
  usesTeams: boolean;
  usesSharePoint: boolean;
  usesOneDrive: boolean;
  usesYammer: boolean;
  sharepointSiteCount: string;
  teamCount: string;
  securityGroupCount: string;
  externalSharingEnabled: boolean;
  guestUsersPresent: boolean;
  authMethod: string;
  isHybrid: boolean;
  hasOnPremExchange: boolean;
  usesAADConnect: boolean;
  mfaEnforced: boolean;
  conditionalAccessEnabled: boolean;
  intuneEnabled: boolean;
  hasAADP1orP2: boolean;
  hasDefender: boolean;
  hasDLP: boolean;
  usesComplianceCenter: boolean;
  sensitivityLabelsConfigured: boolean;
  hasRetentionPolicies: boolean;
  hasInsiderRisk: boolean;
  hasCopilotLicenses: boolean;
  copilotLicenseCount: string;
  copilotUseCase: string;
  currentAITools: string;
  dataGovernanceConcerns: string;
  copilotReadinessScore: string;
  copilotBlockedBy: string;
  engagementStartDate: string;
  estimatedDuration: string;
  engagementType: string;
  budgetRange: string;
  decisionMakerName: string;
  decisionMakerEmail: string;
  businessGoals: string;
  knownBlockers: string;
  referralSource: string;
}

const EMPTY_PROFILE: M365Profile = {
  orgName: "", industry: "", employeeCount: "", licensedUserCount: "",
  itContactName: "", itContactEmail: "", tenantDomain: "", isMicrosoftPartner: false,
  licenseSKUs: [], allUsersLicensed: false, activeUserPercent: "",
  usesExchange: false, usesTeams: false, usesSharePoint: false, usesOneDrive: false, usesYammer: false,
  sharepointSiteCount: "", teamCount: "", securityGroupCount: "",
  externalSharingEnabled: false, guestUsersPresent: false, authMethod: "",
  isHybrid: false, hasOnPremExchange: false, usesAADConnect: false,
  mfaEnforced: false, conditionalAccessEnabled: false, intuneEnabled: false,
  hasAADP1orP2: false, hasDefender: false, hasDLP: false,
  usesComplianceCenter: false, sensitivityLabelsConfigured: false,
  hasRetentionPolicies: false, hasInsiderRisk: false,
  hasCopilotLicenses: false, copilotLicenseCount: "", copilotUseCase: "",
  currentAITools: "", dataGovernanceConcerns: "", copilotReadinessScore: "",
  copilotBlockedBy: "",
  engagementStartDate: "", estimatedDuration: "", engagementType: "",
  budgetRange: "", decisionMakerName: "", decisionMakerEmail: "",
  businessGoals: "", knownBlockers: "", referralSource: "",
};

// ─── Per-step Zod schemas ─────────────────────────────────────────────────────
const optionalEmail = z.string().refine(v => v === "" || z.string().email().safeParse(v).success, "Must be a valid email address");
const optionalPositiveInt = z.string().refine(v => v === "" || (!isNaN(Number(v)) && Number(v) >= 0), "Must be a non-negative number");

const STEP_SCHEMAS: z.ZodTypeAny[] = [
  // Step 1 — Organization Overview
  z.object({
    orgName: z.string().min(1, "Organization name is required"),
    itContactEmail: optionalEmail,
  }),
  // Step 2 — M365 Licensing & Usage
  z.object({
    activeUserPercent: z.string().refine(v => v === "" || (Number(v) >= 0 && Number(v) <= 100), "Must be between 0 and 100"),
  }),
  // Step 3 — Environment Structure (all optional)
  z.object({
    sharepointSiteCount: optionalPositiveInt,
    teamCount: optionalPositiveInt,
    securityGroupCount: optionalPositiveInt,
  }),
  // Step 4 — Security & Compliance (boolean toggles — always valid)
  z.object({}),
  // Step 5 — Copilot Readiness
  z.object({
    copilotLicenseCount: z.string().refine((v) => true, ""),
    copilotReadinessScore: z.string().refine(
      v => v === "" || ["1", "2", "3", "4", "5"].includes(v),
      "Must be between 1 and 5"
    ),
  }).superRefine((data, ctx) => {
    if ((data as { hasCopilotLicenses?: boolean } & typeof data).hasCopilotLicenses) {
      const n = Number(data.copilotLicenseCount);
      if (data.copilotLicenseCount === "" || isNaN(n) || n <= 0) {
        ctx.addIssue({ code: "custom", path: ["copilotLicenseCount"], message: "Enter the number of Copilot licenses" });
      }
    }
  }),
  // Step 6 — Engagement Metadata
  z.object({
    decisionMakerEmail: optionalEmail,
  }),
  // Step 7 — Review & Save (no additional validation)
  z.object({}),
];

// ─── Wizard state hook ────────────────────────────────────────────────────────
function useM365ProfileWizard() {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<M365Profile>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = useCallback((k: keyof M365Profile, v: unknown) => {
    setProfile(prev => ({ ...prev, [k]: v }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }, []);

  const goNext = useCallback((): boolean => {
    const schema = STEP_SCHEMAS[step];
    const result = schema.safeParse(profile);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key && !fieldErrors[String(key)]) {
          fieldErrors[String(key)] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    setStep(s => s + 1);
    return true;
  }, [step, profile]);

  const goBack = useCallback(() => {
    setErrors({});
    setStep(s => s - 1);
  }, []);

  const jumpToStep = useCallback((target: number) => {
    setErrors({});
    setStep(target);
  }, []);

  return { step, profile, set, errors, goNext, goBack, jumpToStep };
}

// ─── Step config ──────────────────────────────────────────────────────────────
const STEPS = [
  { title: "Organization Overview", description: "Basic details about the client's organization and M365 footprint." },
  { title: "M365 Licensing & Usage", description: "What plans are in place and how actively the tenant is used." },
  { title: "Environment Structure", description: "Topology of the Microsoft 365 environment and authentication setup." },
  { title: "Security & Compliance", description: "Security controls and compliance posture across the tenant." },
  { title: "Copilot Readiness", description: "AI adoption status and readiness for Microsoft 365 Copilot." },
  { title: "Engagement Metadata", description: "Project scope, stakeholders, and business objectives." },
  { title: "Review & Save", description: "Confirm all answers and save the client's M365 profile." },
];

// ─── Reusable primitives ──────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:ring-offset-1 ${value ? "bg-[#0078D4]" : "bg-gray-300"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${value ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
    </button>
  );
}

function YesNoRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-[#0A2540] pr-4">{label}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-semibold w-6 text-right ${value ? "text-[#0078D4]" : "text-gray-400"}`}>{value ? "Yes" : "No"}</span>
        <Toggle value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function FieldRow({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1.5 items-start">
      <label className="text-xs font-semibold text-[#0A2540] pt-2.5 leading-tight">{label}</label>
      <div>
        {children}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white";
const inputErrCls = "w-full border border-red-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white";

function TextInput({ value, onChange, placeholder, error }: { value: string; onChange: (v: string) => void; placeholder?: string; error?: string }) {
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={error ? inputErrCls : inputCls} />;
}

function NumberInput({ value, onChange, placeholder, error }: { value: string; onChange: (v: string) => void; placeholder?: string; error?: string }) {
  return <input type="number" min="0" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={error ? inputErrCls : inputCls} />;
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
      <option value="">Select…</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={`${inputCls} resize-none leading-relaxed`} />;
}

function MultiSelect({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {options.map(opt => {
        const sel = value.includes(opt);
        return (
          <button key={opt} type="button"
            onClick={() => onChange(sel ? value.filter(v => v !== opt) : [...value, opt])}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${sel ? "bg-[#0078D4] text-white border-[#0078D4]" : "bg-white text-[#0A2540] border-border hover:border-[#0078D4]"}`}
          >{opt}</button>
        );
      })}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A2540]/50 mt-4 mb-1 first:mt-0">{children}</p>;
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 pt-1.5">
      <Toggle value={value} onChange={onChange} />
      <span className={`text-sm font-medium ${value ? "text-[#0078D4]" : "text-gray-500"}`}>{value ? "Yes" : "No"}</span>
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────
function Step1({ p, set, errors }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string> }) {
  const industries = ["Technology", "Healthcare", "Finance & Banking", "Legal", "Education", "Manufacturing", "Retail", "Government", "Nonprofit", "Real Estate", "Professional Services", "Other"];
  return (
    <div className="space-y-3">
      <FieldRow label="Organization Name" error={errors.orgName}>
        <TextInput value={p.orgName} onChange={v => set("orgName", v)} placeholder="Contoso Corporation" error={errors.orgName} />
      </FieldRow>
      <FieldRow label="Primary Industry">
        <SelectInput value={p.industry} onChange={v => set("industry", v)} options={industries.map(i => ({ value: i, label: i }))} />
      </FieldRow>
      <FieldRow label="Employee Count">
        <NumberInput value={p.employeeCount} onChange={v => set("employeeCount", v)} placeholder="250" />
      </FieldRow>
      <FieldRow label="M365 Licensed Users">
        <NumberInput value={p.licensedUserCount} onChange={v => set("licensedUserCount", v)} placeholder="200" />
      </FieldRow>
      <FieldRow label="IT Contact Name">
        <TextInput value={p.itContactName} onChange={v => set("itContactName", v)} placeholder="Jane Smith" />
      </FieldRow>
      <FieldRow label="IT Contact Email" error={errors.itContactEmail}>
        <input type="email" value={p.itContactEmail} onChange={e => set("itContactEmail", e.target.value)} placeholder="it@contoso.com" className={errors.itContactEmail ? inputErrCls : inputCls} />
      </FieldRow>
      <FieldRow label="Tenant Domain">
        <TextInput value={p.tenantDomain} onChange={v => set("tenantDomain", v)} placeholder="contoso.onmicrosoft.com" />
      </FieldRow>
      <FieldRow label="Microsoft Partner?">
        <ToggleRow label="Microsoft Partner" value={p.isMicrosoftPartner} onChange={v => set("isMicrosoftPartner", v)} />
      </FieldRow>
    </div>
  );
}

function Step2({ p, set, errors }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string> }) {
  const skus = ["M365 Business Basic", "M365 Business Standard", "M365 Business Premium", "Office 365 E1", "M365 E3", "M365 E5", "M365 F1", "M365 F3"];
  return (
    <div className="space-y-3">
      <FieldRow label="License SKU(s)">
        <MultiSelect value={p.licenseSKUs} onChange={v => set("licenseSKUs", v)} options={skus} />
      </FieldRow>
      <FieldRow label="Active User %" error={errors.activeUserPercent}>
        <NumberInput value={p.activeUserPercent} onChange={v => set("activeUserPercent", v)} placeholder="85" error={errors.activeUserPercent} />
      </FieldRow>
      <div className="bg-[#F7F9FC] border border-border rounded-xl px-4 pt-3 pb-1 mt-1">
        <SectionTitle>Workload Adoption</SectionTitle>
        <YesNoRow label="All users licensed?" value={p.allUsersLicensed} onChange={v => set("allUsersLicensed", v)} />
        <YesNoRow label="Exchange Online in use" value={p.usesExchange} onChange={v => set("usesExchange", v)} />
        <YesNoRow label="Microsoft Teams in use" value={p.usesTeams} onChange={v => set("usesTeams", v)} />
        <YesNoRow label="SharePoint Online in use" value={p.usesSharePoint} onChange={v => set("usesSharePoint", v)} />
        <YesNoRow label="OneDrive for Business in use" value={p.usesOneDrive} onChange={v => set("usesOneDrive", v)} />
        <YesNoRow label="Viva Engage / Yammer in use" value={p.usesYammer} onChange={v => set("usesYammer", v)} />
      </div>
    </div>
  );
}

function Step3({ p, set, errors }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string> }) {
  const authOptions = [
    { value: "password", label: "Password only" },
    { value: "mfa", label: "MFA (per-user)" },
    { value: "sso_saml", label: "SSO / SAML" },
    { value: "entra_id", label: "Entra ID (Azure AD)" },
    { value: "conditional_access", label: "Conditional Access policies" },
  ];
  return (
    <div className="space-y-3">
      <FieldRow label="SharePoint Sites" error={errors.sharepointSiteCount}>
        <NumberInput value={p.sharepointSiteCount} onChange={v => set("sharepointSiteCount", v)} placeholder="15" error={errors.sharepointSiteCount} />
      </FieldRow>
      <FieldRow label="Teams (count)" error={errors.teamCount}>
        <NumberInput value={p.teamCount} onChange={v => set("teamCount", v)} placeholder="40" error={errors.teamCount} />
      </FieldRow>
      <FieldRow label="Security Groups" error={errors.securityGroupCount}>
        <NumberInput value={p.securityGroupCount} onChange={v => set("securityGroupCount", v)} placeholder="25" error={errors.securityGroupCount} />
      </FieldRow>
      <FieldRow label="Primary Auth Method">
        <SelectInput value={p.authMethod} onChange={v => set("authMethod", v)} options={authOptions} />
      </FieldRow>
      <div className="bg-[#F7F9FC] border border-border rounded-xl px-4 pt-3 pb-1 mt-1">
        <SectionTitle>Configuration Flags</SectionTitle>
        <YesNoRow label="External sharing enabled" value={p.externalSharingEnabled} onChange={v => set("externalSharingEnabled", v)} />
        <YesNoRow label="Guest users present" value={p.guestUsersPresent} onChange={v => set("guestUsersPresent", v)} />
        <YesNoRow label="Hybrid (on-prem + cloud)" value={p.isHybrid} onChange={v => set("isHybrid", v)} />
        <YesNoRow label="On-premises Exchange present" value={p.hasOnPremExchange} onChange={v => set("hasOnPremExchange", v)} />
        <YesNoRow label="Entra Connect / AAD Connect" value={p.usesAADConnect} onChange={v => set("usesAADConnect", v)} />
      </div>
    </div>
  );
}

function Step4({ p, set }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void }) {
  return (
    <div className="bg-[#F7F9FC] border border-border rounded-xl px-4 pt-3 pb-1">
      <SectionTitle>Identity &amp; Access</SectionTitle>
      <YesNoRow label="MFA enforced for all users" value={p.mfaEnforced} onChange={v => set("mfaEnforced", v)} />
      <YesNoRow label="Conditional Access policies configured" value={p.conditionalAccessEnabled} onChange={v => set("conditionalAccessEnabled", v)} />
      <YesNoRow label="Entra ID P1 or P2 licensed" value={p.hasAADP1orP2} onChange={v => set("hasAADP1orP2", v)} />
      <YesNoRow label="Intune / MDM enrollment active" value={p.intuneEnabled} onChange={v => set("intuneEnabled", v)} />
      <SectionTitle>Data Protection</SectionTitle>
      <YesNoRow label="Microsoft Defender for M365" value={p.hasDefender} onChange={v => set("hasDefender", v)} />
      <YesNoRow label="Data Loss Prevention (DLP) policies" value={p.hasDLP} onChange={v => set("hasDLP", v)} />
      <YesNoRow label="Sensitivity labels configured" value={p.sensitivityLabelsConfigured} onChange={v => set("sensitivityLabelsConfigured", v)} />
      <YesNoRow label="Retention policies in place" value={p.hasRetentionPolicies} onChange={v => set("hasRetentionPolicies", v)} />
      <SectionTitle>Compliance</SectionTitle>
      <YesNoRow label="Microsoft Purview / Compliance Center used" value={p.usesComplianceCenter} onChange={v => set("usesComplianceCenter", v)} />
      <YesNoRow label="Insider Risk Management enabled" value={p.hasInsiderRisk} onChange={v => set("hasInsiderRisk", v)} />
    </div>
  );
}

function Step5({ p, set, errors }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string> }) {
  const blockerOpts = ["None", "Budget", "Licensing", "Security concerns", "Training gaps", "Governance / data readiness", "Leadership buy-in"].map(b => ({ value: b, label: b }));
  const scoreOpts = ["1 – Not ready", "2 – Early stages", "3 – Partially ready", "4 – Mostly ready", "5 – Fully ready"].map((s, i) => ({ value: String(i + 1), label: s }));
  return (
    <div className="space-y-3">
      <div className="bg-[#F7F9FC] border border-border rounded-xl px-4 pt-3 pb-1">
        <SectionTitle>License Status</SectionTitle>
        <YesNoRow label="Has M365 Copilot licenses" value={p.hasCopilotLicenses} onChange={v => set("hasCopilotLicenses", v)} />
      </div>
      {p.hasCopilotLicenses && (
        <FieldRow label="Copilot License Count" error={errors.copilotLicenseCount}>
          <NumberInput value={p.copilotLicenseCount} onChange={v => set("copilotLicenseCount", v)} placeholder="25" error={errors.copilotLicenseCount} />
        </FieldRow>
      )}
      <FieldRow label="Primary Copilot Use Case">
        <TextArea value={p.copilotUseCase} onChange={v => set("copilotUseCase", v)} placeholder="Meeting summaries, email drafting, document summarization…" />
      </FieldRow>
      <FieldRow label="Current AI Tools in Use">
        <TextArea value={p.currentAITools} onChange={v => set("currentAITools", v)} placeholder="ChatGPT, GitHub Copilot, etc." rows={2} />
      </FieldRow>
      <FieldRow label="Data Governance Concerns">
        <TextArea value={p.dataGovernanceConcerns} onChange={v => set("dataGovernanceConcerns", v)} placeholder="Data sensitivity, oversharing risks, classification gaps…" rows={2} />
      </FieldRow>
      <FieldRow label="Readiness Score (1–5)" error={errors.copilotReadinessScore}>
        <SelectInput value={p.copilotReadinessScore} onChange={v => set("copilotReadinessScore", v)} options={scoreOpts} />
      </FieldRow>
      <FieldRow label="Primary Blocker">
        <SelectInput value={p.copilotBlockedBy} onChange={v => set("copilotBlockedBy", v)} options={blockerOpts} />
      </FieldRow>
    </div>
  );
}

function Step6({ p, set, errors }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string> }) {
  const engagementTypes = ["Assessment", "Implementation", "Ongoing Support", "Training & Enablement", "Governance", "Advisory / Strategy"].map(t => ({ value: t, label: t }));
  const budgetRanges = ["< $5K", "$5K – $15K", "$15K – $30K", "$30K – $75K", "$75K – $150K", "> $150K"].map(b => ({ value: b, label: b }));
  return (
    <div className="space-y-3">
      <FieldRow label="Engagement Start Date">
        <input type="date" value={p.engagementStartDate} onChange={e => set("engagementStartDate", e.target.value)} className={inputCls} />
      </FieldRow>
      <FieldRow label="Estimated Duration">
        <TextInput value={p.estimatedDuration} onChange={v => set("estimatedDuration", v)} placeholder="3 months, 6 weeks…" />
      </FieldRow>
      <FieldRow label="Engagement Type">
        <SelectInput value={p.engagementType} onChange={v => set("engagementType", v)} options={engagementTypes} />
      </FieldRow>
      <FieldRow label="Budget Range">
        <SelectInput value={p.budgetRange} onChange={v => set("budgetRange", v)} options={budgetRanges} />
      </FieldRow>
      <FieldRow label="Decision Maker Name">
        <TextInput value={p.decisionMakerName} onChange={v => set("decisionMakerName", v)} placeholder="John CEO" />
      </FieldRow>
      <FieldRow label="Decision Maker Email" error={errors.decisionMakerEmail}>
        <input type="email" value={p.decisionMakerEmail} onChange={e => set("decisionMakerEmail", e.target.value)} placeholder="ceo@company.com" className={errors.decisionMakerEmail ? inputErrCls : inputCls} />
      </FieldRow>
      <FieldRow label="Key Business Goals">
        <TextArea value={p.businessGoals} onChange={v => set("businessGoals", v)} placeholder="Reduce IT overhead, improve collaboration, achieve compliance certification…" rows={3} />
      </FieldRow>
      <FieldRow label="Known Blockers / Risks">
        <TextArea value={p.knownBlockers} onChange={v => set("knownBlockers", v)} placeholder="Budget approval pending, legacy systems, change resistance…" rows={2} />
      </FieldRow>
      <FieldRow label="Referral Source">
        <TextInput value={p.referralSource} onChange={v => set("referralSource", v)} placeholder="LinkedIn, partner referral, cold outreach…" />
      </FieldRow>
    </div>
  );
}

function Step7({ p, onJump }: { p: M365Profile; onJump: (step: number) => void }) {
  const yn = (v: boolean) => v ? "Yes" : "No";
  const sections: Array<{ title: string; step: number; rows: [string, string][] }> = [
    {
      title: "Organization Overview", step: 0,
      rows: [
        ["Organization", p.orgName || "—"],
        ["Industry", p.industry || "—"],
        ["Employees", p.employeeCount || "—"],
        ["M365 Licensed Users", p.licensedUserCount || "—"],
        ["IT Contact", p.itContactName ? `${p.itContactName}${p.itContactEmail ? ` (${p.itContactEmail})` : ""}` : "—"],
        ["Tenant Domain", p.tenantDomain || "—"],
        ["Microsoft Partner", yn(p.isMicrosoftPartner)],
      ],
    },
    {
      title: "M365 Licensing & Usage", step: 1,
      rows: [
        ["License SKUs", p.licenseSKUs.length > 0 ? p.licenseSKUs.join(", ") : "—"],
        ["Active User %", p.activeUserPercent ? `${p.activeUserPercent}%` : "—"],
        ["All Users Licensed", yn(p.allUsersLicensed)],
        ["Active Workloads", [p.usesExchange && "Exchange", p.usesTeams && "Teams", p.usesSharePoint && "SharePoint", p.usesOneDrive && "OneDrive", p.usesYammer && "Yammer"].filter(Boolean).join(", ") || "None"],
      ],
    },
    {
      title: "Environment Structure", step: 2,
      rows: [
        ["SharePoint Sites", p.sharepointSiteCount || "—"],
        ["Teams", p.teamCount || "—"],
        ["Security Groups", p.securityGroupCount || "—"],
        ["Auth Method", p.authMethod || "—"],
        ["External Sharing", yn(p.externalSharingEnabled)],
        ["Guest Users", yn(p.guestUsersPresent)],
        ["Hybrid", yn(p.isHybrid)],
        ["On-Prem Exchange", yn(p.hasOnPremExchange)],
        ["Entra Connect", yn(p.usesAADConnect)],
      ],
    },
    {
      title: "Security & Compliance", step: 3,
      rows: [
        ["MFA Enforced", yn(p.mfaEnforced)],
        ["Conditional Access", yn(p.conditionalAccessEnabled)],
        ["Entra ID P1/P2", yn(p.hasAADP1orP2)],
        ["Intune", yn(p.intuneEnabled)],
        ["Defender for M365", yn(p.hasDefender)],
        ["DLP Policies", yn(p.hasDLP)],
        ["Sensitivity Labels", yn(p.sensitivityLabelsConfigured)],
        ["Retention Policies", yn(p.hasRetentionPolicies)],
        ["Compliance Center", yn(p.usesComplianceCenter)],
        ["Insider Risk Mgmt", yn(p.hasInsiderRisk)],
      ],
    },
    {
      title: "Copilot Readiness", step: 4,
      rows: [
        ["Has Copilot Licenses", yn(p.hasCopilotLicenses)],
        ...(p.hasCopilotLicenses ? [["License Count", p.copilotLicenseCount || "—"] as [string, string]] : []),
        ["Primary Use Case", p.copilotUseCase || "—"],
        ["Current AI Tools", p.currentAITools || "—"],
        ["Data Governance", p.dataGovernanceConcerns || "—"],
        ["Readiness Score", p.copilotReadinessScore ? `${p.copilotReadinessScore}/5` : "—"],
        ["Primary Blocker", p.copilotBlockedBy || "—"],
      ],
    },
    {
      title: "Engagement Metadata", step: 5,
      rows: [
        ["Start Date", p.engagementStartDate || "—"],
        ["Duration", p.estimatedDuration || "—"],
        ["Type", p.engagementType || "—"],
        ["Budget Range", p.budgetRange || "—"],
        ["Decision Maker", p.decisionMakerName ? `${p.decisionMakerName}${p.decisionMakerEmail ? ` (${p.decisionMakerEmail})` : ""}` : "—"],
        ["Business Goals", p.businessGoals || "—"],
        ["Known Blockers", p.knownBlockers || "—"],
        ["Referral Source", p.referralSource || "—"],
      ],
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Review the captured data before saving. Use "Edit" on any section to jump back and make changes.</p>
      {sections.map(section => (
        <div key={section.title} className="bg-[#F7F9FC] border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A2540]/60">{section.title}</p>
            <button onClick={() => onJump(section.step)} className="text-[11px] font-semibold text-[#0078D4] hover:underline">Edit</button>
          </div>
          <div className="space-y-1">
            {section.rows.map(([label, value]) => (
              <div key={label} className="flex gap-3 text-xs">
                <span className="text-gray-500 flex-shrink-0 w-32">{label}</span>
                <span className="text-[#0A2540] font-medium break-words flex-1">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main wizard component ────────────────────────────────────────────────────
export function M365ProfileWizard({
  clientId,
  clientName,
  onClose,
}: {
  clientId: number;
  clientName: string;
  onClose: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const { step, profile, set, errors, goNext, goBack, jumpToStep } = useM365ProfileWizard();
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`/api/admin/clients/${clientId}/m365-profile`)
      .then(async res => {
        if (res.ok) {
          const data = await res.json() as { profile: Partial<M365Profile> | null };
          if (data.profile) {
            const merged = { ...EMPTY_PROFILE, ...data.profile };
            setProfileLoaded(merged);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId, fetchWithAuth]);

  useEffect(() => {
    if (!loading) {
      Object.entries(profileLoaded).forEach(([k, v]) => {
        set(k as keyof M365Profile, v);
      });
    }
  }, [loading, profileLoaded, set]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/m365-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (res.ok) {
        toast({ title: "Profile saved", description: `M365 profile for ${clientName} has been saved.` });
        onClose();
      } else {
        toast({ title: "Save failed", description: "Could not save the profile. Please try again.", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const isLast = step === STEPS.length - 1;

  const renderStep = () => {
    switch (step) {
      case 0: return <Step1 p={profile} set={set} errors={errors} />;
      case 1: return <Step2 p={profile} set={set} errors={errors} />;
      case 2: return <Step3 p={profile} set={set} errors={errors} />;
      case 3: return <Step4 p={profile} set={set} />;
      case 4: return <Step5 p={profile} set={set} errors={errors} />;
      case 5: return <Step6 p={profile} set={set} errors={errors} />;
      case 6: return <Step7 p={profile} onJump={jumpToStep} />;
      default: return null;
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl flex flex-col p-0 gap-0 max-h-[88vh]">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-[#0A2540] text-sm font-bold">
            M365 Environment Profile — {clientName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{STEPS[step].description}</p>
          <div className="flex items-center gap-2.5 mt-3">
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-[#0078D4]" : i < step ? "w-3 bg-[#0078D4]/50" : "w-3 bg-gray-200"}`} />
              ))}
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground ml-auto">Step {step + 1} of {STEPS.length}</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">{STEPS[step].title}</h2>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : renderStep()}
        </div>

        <div className="px-6 py-4 border-t border-border flex-shrink-0 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={step === 0 || saving}
            className="text-sm font-medium text-[#0A2540] border border-border px-4 py-2 rounded-lg hover:bg-[#F7F9FC] disabled:opacity-30 transition-colors"
          >
            ← Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            {isLast ? (
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
              >
                {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {saving ? "Saving…" : "Save Customer Profile"}
              </button>
            ) : (
              <button
                onClick={goNext}
                className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#005fa3] transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
