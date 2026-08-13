import { useEffect, useState, useCallback } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  type QuizResult,
  deriveM365FromQuizzes,
  mergeIntoProfile,
  QUIZ_TYPE_LABELS,
} from "@/lib/m365-quiz-mapping";

// ─── Profile shape ────────────────────────────────────────────────────────────
// Boolean fields that can be derived from quiz results use `boolean | undefined`.
// `undefined` = not yet answered (pre-fillable); `true`/`false` = explicitly set.
interface M365Profile {
  orgName: string;
  industry: string;
  employeeCount: string;
  licensedUserCount: string;
  itContactName: string;
  itContactEmail: string;
  tenantDomain: string;
  isMicrosoftPartner: boolean | undefined;
  licenseSKUs: string[];
  allUsersLicensed: boolean | undefined;
  activeUserPercent: string;
  usesExchange: boolean | undefined;
  usesTeams: boolean | undefined;
  usesSharePoint: boolean | undefined;
  usesOneDrive: boolean | undefined;
  usesYammer: boolean | undefined;
  sharepointSiteCount: string;
  teamCount: string;
  securityGroupCount: string;
  externalSharingEnabled: boolean | undefined;
  guestUsersPresent: boolean | undefined;
  authMethods: string[];
  isHybrid: boolean | undefined;
  hasOnPremExchange: boolean | undefined;
  usesAADConnect: boolean | undefined;
  mfaEnforced: boolean | undefined;
  conditionalAccessEnabled: boolean | undefined;
  intuneEnabled: boolean | undefined;
  hasAADP1orP2: boolean | undefined;
  hasDefender: boolean | undefined;
  hasDLP: boolean | undefined;
  usesComplianceCenter: boolean | undefined;
  sensitivityLabelsConfigured: boolean | undefined;
  hasRetentionPolicies: boolean | undefined;
  hasInsiderRisk: boolean | undefined;
  hasCopilotLicenses: boolean | undefined;
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
  itContactName: "", itContactEmail: "", tenantDomain: "", isMicrosoftPartner: undefined,
  licenseSKUs: [], allUsersLicensed: undefined, activeUserPercent: "",
  usesExchange: undefined, usesTeams: undefined, usesSharePoint: undefined,
  usesOneDrive: undefined, usesYammer: undefined,
  sharepointSiteCount: "", teamCount: "", securityGroupCount: "",
  externalSharingEnabled: undefined, guestUsersPresent: undefined, authMethods: [],
  isHybrid: undefined, hasOnPremExchange: undefined, usesAADConnect: undefined,
  mfaEnforced: undefined, conditionalAccessEnabled: undefined, intuneEnabled: undefined,
  hasAADP1orP2: undefined, hasDefender: undefined, hasDLP: undefined,
  usesComplianceCenter: undefined, sensitivityLabelsConfigured: undefined,
  hasRetentionPolicies: undefined, hasInsiderRisk: undefined,
  hasCopilotLicenses: undefined, copilotLicenseCount: "", copilotUseCase: "",
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
  z.object({ orgName: z.string().min(1, "Organization name is required"), itContactEmail: optionalEmail }),
  z.object({ activeUserPercent: z.string().refine(v => v === "" || (Number(v) >= 0 && Number(v) <= 100), "Must be between 0 and 100") }),
  z.object({ sharepointSiteCount: optionalPositiveInt, teamCount: optionalPositiveInt, securityGroupCount: optionalPositiveInt }),
  z.object({}),
  z.object({
    copilotLicenseCount: z.string().refine(() => true, ""),
    copilotReadinessScore: z.string().refine(v => v === "" || ["1", "2", "3", "4", "5"].includes(v), "Must be between 1 and 5"),
  }).superRefine((data, ctx) => {
    if ((data as { hasCopilotLicenses?: boolean } & typeof data).hasCopilotLicenses) {
      const n = Number(data.copilotLicenseCount);
      if (data.copilotLicenseCount === "" || isNaN(n) || n <= 0) {
        ctx.addIssue({ code: "custom", path: ["copilotLicenseCount"], message: "Enter the number of Copilot licenses" });
      }
    }
  }),
  z.object({ decisionMakerEmail: optionalEmail }),
  z.object({}),
];

// ─── Wizard state hook ────────────────────────────────────────────────────────
function useM365ProfileWizard() {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<M365Profile>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preFilled, setPreFilled] = useState<Set<string>>(new Set());

  const set = useCallback((k: keyof M365Profile, v: unknown) => {
    setProfile(prev => ({ ...prev, [k]: v }));
    setErrors(prev => { const next = { ...prev }; delete next[k]; return next; });
  }, []);

  const applyQuizPrefill = useCallback((quizzes: QuizResult[]) => {
    if (quizzes.length === 0) return;
    const derived = deriveM365FromQuizzes(quizzes);
    setProfile(prev => {
      const { updated, filledKeys } = mergeIntoProfile(prev as unknown as Record<string, unknown>, derived);
      setPreFilled(filledKeys);
      return updated as unknown as M365Profile;
    });
  }, []);

  const clearPreFilled = useCallback(() => setPreFilled(new Set()), []);

  const goNext = useCallback((): boolean => {
    const schema = STEP_SCHEMAS[step];
    const result = schema.safeParse(profile);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key && !fieldErrors[String(key)]) fieldErrors[String(key)] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    setStep(s => s + 1);
    return true;
  }, [step, profile]);

  const goBack = useCallback(() => { setErrors({}); setStep(s => s - 1); }, []);
  const jumpToStep = useCallback((target: number) => { setErrors({}); setStep(target); }, []);

  return { step, profile, set, errors, goNext, goBack, jumpToStep, preFilled, applyQuizPrefill, clearPreFilled };
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

// ─── Assessment badge ─────────────────────────────────────────────────────────
function AssessmentBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 ml-1.5 align-middle leading-none">
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      From assessment
    </span>
  );
}

// ─── Reusable primitives ──────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  const isOn = value === true;
  return (
    <button
      type="button"
      onClick={() => onChange(!isOn)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${isOn ? "bg-primary" : "bg-border"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-accent shadow-sm transition-transform ${isOn ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
    </button>
  );
}

function YesNoRow({ label, value, onChange, prefilled }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void; prefilled?: boolean }) {
  const isOn = value === true;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-foreground pr-4 flex items-center flex-wrap gap-x-1">
        {label}
        {prefilled && <AssessmentBadge />}
      </span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-semibold w-6 text-right ${isOn ? "text-primary" : "text-gray-400"}`}>{isOn ? "Yes" : "No"}</span>
        <Toggle value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function FieldRow({ label, children, error, prefilled }: { label: string; children: React.ReactNode; error?: string; prefilled?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1.5 items-start">
      <label className="text-xs font-semibold text-foreground pt-2.5 leading-tight flex items-center flex-wrap gap-x-1">
        {label}
        {prefilled && <AssessmentBadge />}
      </label>
      <div>
        {children}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-accent";
const inputErrCls = "w-full border border-red-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-accent";

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
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${sel ? "bg-primary text-white border-primary" : "bg-accent text-foreground border-border hover:border-primary"}`}
          >{opt}</button>
        );
      })}
    </div>
  );
}

// ── Auth method value → display label ─────────────────────────────────────────
const AUTH_LABELS: Record<string, string> = {
  password:           "Password only",
  mfa:                "MFA (per-user)",
  sso_saml:           "SSO / SAML",
  entra_id:           "Entra ID (Azure AD)",
  conditional_access: "Conditional Access policies",
};

/** MultiSelect variant that stores value keys but renders labels. */
function MultiSelectWithLabels({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {options.map(opt => {
        const sel = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() =>
              onChange(sel ? value.filter(v => v !== opt.value) : [...value, opt.value])
            }
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              sel
                ? "bg-primary text-white border-primary"
                : "bg-accent text-foreground border-border hover:border-primary"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Free-form tag input for license SKUs — stores whatever strings come from the script. */
function SkuTagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState("");
  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput("");
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(sku => (
            <span
              key={sku}
              className="inline-flex items-center gap-1 text-xs font-medium bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 rounded-full"
            >
              {sku}
              <button
                type="button"
                onClick={() => onChange(value.filter(s => s !== sku))}
                className="ml-0.5 text-primary/70 hover:text-primary leading-none"
                aria-label={`Remove ${sku}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(input);
          } else if (e.key === "Backspace" && !input && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={value.length === 0 ? "Type a SKU or friendly name, press Enter…" : "Add another…"}
        className={inputCls}
      />
      <p className="text-[10px] text-muted-foreground">
        Populated automatically when a discovery script runs. You can also add/remove entries manually.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50 mt-4 mb-1 first:mt-0">{children}</p>;
}

function ToggleRow({ label: _label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  const isOn = value === true;
  return (
    <div className="flex items-center gap-3 pt-1.5">
      <Toggle value={value} onChange={onChange} />
      <span className={`text-sm font-medium ${isOn ? "text-primary" : "text-muted-foreground"}`}>{isOn ? "Yes" : "No"}</span>
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────
function Step1({ p, set, errors, pf }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string>; pf: Set<string> }) {
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

function Step2({ p, set, errors, pf }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string>; pf: Set<string> }) {
  return (
    <div className="space-y-3">
      <FieldRow label="License SKU(s)" prefilled={pf.has("licenseSKUs")}>
        <SkuTagInput value={p.licenseSKUs} onChange={v => set("licenseSKUs", v)} />
      </FieldRow>
      <FieldRow label="Active User %" error={errors.activeUserPercent}>
        <NumberInput value={p.activeUserPercent} onChange={v => set("activeUserPercent", v)} placeholder="85" error={errors.activeUserPercent} />
      </FieldRow>
      <div className="bg-accent border border-border rounded-xl px-4 pt-3 pb-1 mt-1">
        <SectionTitle>Workload Adoption</SectionTitle>
        <YesNoRow label="All users licensed?" value={p.allUsersLicensed} onChange={v => set("allUsersLicensed", v)} prefilled={pf.has("allUsersLicensed")} />
        <YesNoRow label="Exchange Online in use" value={p.usesExchange} onChange={v => set("usesExchange", v)} prefilled={pf.has("usesExchange")} />
        <YesNoRow label="Microsoft Teams in use" value={p.usesTeams} onChange={v => set("usesTeams", v)} prefilled={pf.has("usesTeams")} />
        <YesNoRow label="SharePoint Online in use" value={p.usesSharePoint} onChange={v => set("usesSharePoint", v)} prefilled={pf.has("usesSharePoint")} />
        <YesNoRow label="OneDrive for Business in use" value={p.usesOneDrive} onChange={v => set("usesOneDrive", v)} prefilled={pf.has("usesOneDrive")} />
        <YesNoRow label="Viva Engage / Yammer in use" value={p.usesYammer} onChange={v => set("usesYammer", v)} />
      </div>
    </div>
  );
}

function Step3({ p, set, errors, pf }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string>; pf: Set<string> }) {
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
      <FieldRow label="Auth Method(s)" prefilled={pf.has("authMethods")}>
        <MultiSelectWithLabels value={p.authMethods} onChange={v => set("authMethods", v)} options={authOptions} />
      </FieldRow>
      <div className="bg-accent border border-border rounded-xl px-4 pt-3 pb-1 mt-1">
        <SectionTitle>Configuration Flags</SectionTitle>
        <YesNoRow label="External sharing enabled" value={p.externalSharingEnabled} onChange={v => set("externalSharingEnabled", v)} prefilled={pf.has("externalSharingEnabled")} />
        <YesNoRow label="Guest users present" value={p.guestUsersPresent} onChange={v => set("guestUsersPresent", v)} prefilled={pf.has("guestUsersPresent")} />
        <YesNoRow label="Hybrid (on-prem + cloud)" value={p.isHybrid} onChange={v => set("isHybrid", v)} />
        <YesNoRow label="On-premises Exchange present" value={p.hasOnPremExchange} onChange={v => set("hasOnPremExchange", v)} />
        <YesNoRow label="Entra Connect / AAD Connect" value={p.usesAADConnect} onChange={v => set("usesAADConnect", v)} />
      </div>
    </div>
  );
}

function Step4({ p, set, pf }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; pf: Set<string> }) {
  return (
    <div className="bg-accent border border-border rounded-xl px-4 pt-3 pb-1">
      <SectionTitle>Identity &amp; Access</SectionTitle>
      <YesNoRow label="MFA enforced for all users" value={p.mfaEnforced} onChange={v => set("mfaEnforced", v)} prefilled={pf.has("mfaEnforced")} />
      <YesNoRow label="Conditional Access policies configured" value={p.conditionalAccessEnabled} onChange={v => set("conditionalAccessEnabled", v)} prefilled={pf.has("conditionalAccessEnabled")} />
      <YesNoRow label="Entra ID P1 or P2 licensed" value={p.hasAADP1orP2} onChange={v => set("hasAADP1orP2", v)} />
      <YesNoRow label="Intune / MDM enrollment active" value={p.intuneEnabled} onChange={v => set("intuneEnabled", v)} />
      <SectionTitle>Data Protection</SectionTitle>
      <YesNoRow label="Microsoft Defender for M365" value={p.hasDefender} onChange={v => set("hasDefender", v)} />
      <YesNoRow label="Data Loss Prevention (DLP) policies" value={p.hasDLP} onChange={v => set("hasDLP", v)} prefilled={pf.has("hasDLP")} />
      <YesNoRow label="Sensitivity labels configured" value={p.sensitivityLabelsConfigured} onChange={v => set("sensitivityLabelsConfigured", v)} prefilled={pf.has("sensitivityLabelsConfigured")} />
      <YesNoRow label="Retention policies in place" value={p.hasRetentionPolicies} onChange={v => set("hasRetentionPolicies", v)} prefilled={pf.has("hasRetentionPolicies")} />
      <SectionTitle>Compliance</SectionTitle>
      <YesNoRow label="Microsoft Purview / Compliance Center used" value={p.usesComplianceCenter} onChange={v => set("usesComplianceCenter", v)} prefilled={pf.has("usesComplianceCenter")} />
      <YesNoRow label="Insider Risk Management enabled" value={p.hasInsiderRisk} onChange={v => set("hasInsiderRisk", v)} prefilled={pf.has("hasInsiderRisk")} />
    </div>
  );
}

function Step5({ p, set, errors, pf }: { p: M365Profile; set: (k: keyof M365Profile, v: unknown) => void; errors: Record<string, string>; pf: Set<string> }) {
  const blockerOpts = ["None", "Budget", "Licensing", "Security concerns", "Training gaps", "Governance / data readiness", "Leadership buy-in"].map(b => ({ value: b, label: b }));
  const scoreOpts = ["1 – Not ready", "2 – Early stages", "3 – Partially ready", "4 – Mostly ready", "5 – Fully ready"].map((s, i) => ({ value: String(i + 1), label: s }));
  return (
    <div className="space-y-3">
      <div className="bg-accent border border-border rounded-xl px-4 pt-3 pb-1">
        <SectionTitle>License Status</SectionTitle>
        <YesNoRow label="Has M365 Copilot licenses" value={p.hasCopilotLicenses} onChange={v => set("hasCopilotLicenses", v)} prefilled={pf.has("hasCopilotLicenses")} />
      </div>
      {p.hasCopilotLicenses && (
        <FieldRow label="Copilot License Count" error={errors.copilotLicenseCount}>
          <NumberInput value={p.copilotLicenseCount} onChange={v => set("copilotLicenseCount", v)} placeholder="25" error={errors.copilotLicenseCount} />
        </FieldRow>
      )}
      <FieldRow label="Primary Copilot Use Case" prefilled={pf.has("copilotUseCase")}>
        <TextArea value={p.copilotUseCase} onChange={v => set("copilotUseCase", v)} placeholder="Meeting summaries, email drafting, document summarization…" />
      </FieldRow>
      <FieldRow label="Current AI Tools in Use">
        <TextArea value={p.currentAITools} onChange={v => set("currentAITools", v)} placeholder="ChatGPT, GitHub Copilot, etc." rows={2} />
      </FieldRow>
      <FieldRow label="Data Governance Concerns" prefilled={pf.has("dataGovernanceConcerns")}>
        <TextArea value={p.dataGovernanceConcerns} onChange={v => set("dataGovernanceConcerns", v)} placeholder="Data sensitivity, oversharing risks, classification gaps…" rows={2} />
      </FieldRow>
      <FieldRow label="Readiness Score (1–5)" error={errors.copilotReadinessScore} prefilled={pf.has("copilotReadinessScore")}>
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
        <TextInput value={p.referralSource} onChange={v => set("referralSource", v)} placeholder="LinkedIn, referral, Google search…" />
      </FieldRow>
    </div>
  );
}

// ─── Review step (Step 7) ─────────────────────────────────────────────────────
function Step7({ p, onJump, onDownloadPdf, downloading }: { p: M365Profile; onJump: (n: number) => void; onDownloadPdf: () => void; downloading: boolean }) {
  const yn = (v: boolean | undefined) => (v === true ? "Yes" : v === false ? "No" : "—");
  const sections: { title: string; step: number; rows: [string, string][] }[] = [
    {
      title: "Organization Overview", step: 0,
      rows: [
        ["Organization", p.orgName || "—"],
        ["Industry", p.industry || "—"],
        ["Employees", p.employeeCount || "—"],
        ["Licensed Users", p.licensedUserCount || "—"],
        ["IT Contact", p.itContactName ? `${p.itContactName}${p.itContactEmail ? ` (${p.itContactEmail})` : ""}` : "—"],
        ["Tenant Domain", p.tenantDomain || "—"],
        ["M365 Partner", yn(p.isMicrosoftPartner)],
      ],
    },
    {
      title: "M365 Licensing & Usage", step: 1,
      rows: [
        ["License SKUs", p.licenseSKUs.length ? p.licenseSKUs.join(", ") : "—"],
        ["Active User %", p.activeUserPercent ? `${p.activeUserPercent}%` : "—"],
        ["All Licensed", yn(p.allUsersLicensed)],
        ["Exchange", yn(p.usesExchange)],
        ["Teams", yn(p.usesTeams)],
        ["SharePoint", yn(p.usesSharePoint)],
        ["OneDrive", yn(p.usesOneDrive)],
        ["Viva Engage", yn(p.usesYammer)],
      ],
    },
    {
      title: "Environment Structure", step: 2,
      rows: [
        ["SharePoint Sites", p.sharepointSiteCount || "—"],
        ["Teams", p.teamCount || "—"],
        ["Security Groups", p.securityGroupCount || "—"],
        ["Auth Method", p.authMethods.length ? p.authMethods.map(m => AUTH_LABELS[m] ?? m).join(", ") : "—"],
        ["External Sharing", yn(p.externalSharingEnabled)],
        ["Guest Users", yn(p.guestUsersPresent)],
        ["Hybrid", yn(p.isHybrid)],
        ["On-Prem Exchange", yn(p.hasOnPremExchange)],
        ["AAD Connect", yn(p.usesAADConnect)],
      ],
    },
    {
      title: "Security & Compliance", step: 3,
      rows: [
        ["MFA Enforced", yn(p.mfaEnforced)],
        ["Conditional Access", yn(p.conditionalAccessEnabled)],
        ["Entra ID P1/P2", yn(p.hasAADP1orP2)],
        ["Intune Enrolled", yn(p.intuneEnabled)],
        ["Defender", yn(p.hasDefender)],
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
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Review the captured data before saving. Use "Edit" on any section to jump back and make changes.</p>
        <button
          onClick={onDownloadPdf}
          disabled={downloading}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary border border-primary px-3 py-1.5 rounded-lg hover:bg-primary/10 disabled:opacity-50 transition-colors flex-shrink-0 ml-3"
        >
          {downloading
            ? <span className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          }
          {downloading ? "Generating…" : "Download PDF"}
        </button>
      </div>
      {sections.map(section => (
        <div key={section.title} className="bg-accent border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">{section.title}</p>
            <button onClick={() => onJump(section.step)} className="text-[11px] font-semibold text-primary hover:underline">Edit</button>
          </div>
          <div className="space-y-1">
            {section.rows.map(([label, value]) => (
              <div key={label} className="flex gap-3 text-xs">
                <span className="text-muted-foreground flex-shrink-0 w-32">{label}</span>
                <span className="text-foreground font-medium break-words flex-1">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Assessment banner ────────────────────────────────────────────────────────
function AssessmentBanner({
  quizzes,
  prefillCount,
  onPrefill,
  prefilling,
}: {
  quizzes: QuizResult[];
  prefillCount: number;
  onPrefill: () => void;
  prefilling: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (quizzes.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <svg className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-primary mb-0.5">
              {quizzes.length} completed assessment{quizzes.length !== 1 ? "s" : ""} available
            </p>
            {!collapsed && (
              <ul className="space-y-0.5 mt-1">
                {quizzes.map(q => (
                  <li key={q.id} className="text-[11px] text-foreground/70 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                    <span className="font-semibold text-foreground/90">{QUIZ_TYPE_LABELS[q.quizType] ?? q.quizType}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{q.tier} tier · {new Date(q.createdAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
            {prefillCount > 0 && (
              <p className="text-[11px] text-primary/70 mt-1.5">
                <svg className="w-3 h-3 inline mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                {prefillCount} field{prefillCount !== 1 ? "s" : ""} pre-filled — look for the <span className="font-bold">From assessment</span> badge
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onPrefill}
            disabled={prefilling}
            className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {prefilling ? "Applying…" : prefillCount > 0 ? "Re-apply" : "Pre-fill from assessments"}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <svg className={`w-4 h-4 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
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
  const { step, profile, set, errors, goNext, goBack, jumpToStep, preFilled, applyQuizPrefill, clearPreFilled } = useM365ProfileWizard();
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [prefilling, setPrefilling] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchWithAuth(`/api/admin/clients/${clientId}/m365-profile`)
        .then(async res => {
          if (res.ok) {
            const data = await res.json() as { profile: (Partial<M365Profile> & { authMethod?: string }) | null };
            if (data.profile) {
              const raw = data.profile;
              const merged = { ...EMPTY_PROFILE, ...raw };
              // Backward compat: migrate legacy authMethod string → authMethods array
              if (typeof raw.authMethod === "string" && raw.authMethod.trim() && merged.authMethods.length === 0) {
                merged.authMethods = [raw.authMethod.trim()];
              }
              setProfileLoaded(merged);
            }
          }
        })
        .catch(() => {}),
      fetchWithAuth(`/api/admin/clients/${clientId}/quiz-results`)
        .then(async res => {
          if (res.ok) {
            const data = await res.json() as QuizResult[];
            setQuizResults(data);
          }
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [clientId, fetchWithAuth]);

  useEffect(() => {
    if (!loading) {
      Object.entries(profileLoaded).forEach(([k, v]) => {
        set(k as keyof M365Profile, v);
      });
    }
  }, [loading, profileLoaded, set]);

  const handlePrefill = useCallback(() => {
    setPrefilling(true);
    clearPreFilled();
    setTimeout(() => {
      applyQuizPrefill(quizResults);
      setPrefilling(false);
    }, 100);
  }, [applyQuizPrefill, clearPreFilled, quizResults]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/m365-profile/pdf`);
      if (!res.ok) {
        toast({ title: "Download failed", description: "Could not generate the PDF report.", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `m365-assessment-${clientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", description: "An error occurred while generating the PDF.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

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
      case 0: return <Step1 p={profile} set={set} errors={errors} pf={preFilled} />;
      case 1: return <Step2 p={profile} set={set} errors={errors} pf={preFilled} />;
      case 2: return <Step3 p={profile} set={set} errors={errors} pf={preFilled} />;
      case 3: return <Step4 p={profile} set={set} pf={preFilled} />;
      case 4: return <Step5 p={profile} set={set} errors={errors} pf={preFilled} />;
      case 5: return <Step6 p={profile} set={set} errors={errors} />;
      case 6: return <Step7 p={profile} onJump={jumpToStep} onDownloadPdf={() => void handleDownloadPdf()} downloading={downloading} />;
      default: return null;
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl flex flex-col p-0 gap-0 max-h-[88vh]">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-foreground text-sm font-bold">
            M365 Environment Profile — {clientName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{STEPS[step].description}</p>
          <div className="flex items-center gap-2.5 mt-3">
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/50" : "w-3 bg-border"}`} />
              ))}
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground ml-auto">Step {step + 1} of {STEPS.length}</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          <h2 className="text-sm font-bold text-foreground mb-4">{STEPS[step].title}</h2>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {step < STEPS.length - 1 && (
                <AssessmentBanner
                  quizzes={quizResults}
                  prefillCount={preFilled.size}
                  onPrefill={handlePrefill}
                  prefilling={prefilling}
                />
              )}
              {renderStep()}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex-shrink-0 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={step === 0 || saving}
            className="text-sm font-medium text-foreground border border-border px-4 py-2 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors"
          >
            ← Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            {isLast ? (
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
              >
                {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {saving ? "Saving…" : "Save Customer Profile"}
              </button>
            ) : (
              <button
                onClick={goNext}
                className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#005fa3] transition-colors"
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
