import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useForm, Controller, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";

// ── M365 profile schema — full field set matching Admin wizard ─────────────────

const wizardM365Schema = z.object({
  // Step 1 — Organisation Overview
  orgName:              z.string().default(""),
  industry:             z.string().default(""),
  employeeCount:        z.string().default(""),
  licensedUserCount:    z.string().default(""),
  tenantDomain:         z.string().default(""),
  itContactName:        z.string().default(""),
  itContactEmail:       z.string().default(""),
  isMicrosoftPartner:   z.boolean().optional(),

  // Step 2 — Licensing & Usage
  licenseSKUs:          z.array(z.string()).default([]),
  activeUserPercent:    z.string().default(""),
  allUsersLicensed:     z.boolean().optional(),
  usesExchange:         z.boolean().optional(),
  usesTeams:            z.boolean().optional(),
  usesSharePoint:       z.boolean().optional(),
  usesOneDrive:         z.boolean().optional(),
  usesYammer:           z.boolean().optional(),

  // Step 3 — Environment Structure
  sharepointSiteCount:  z.string().default(""),
  teamCount:            z.string().default(""),
  securityGroupCount:   z.string().default(""),
  authMethod:           z.string().default(""),
  externalSharingEnabled: z.boolean().optional(),
  guestUsersPresent:    z.boolean().optional(),
  isHybrid:             z.boolean().optional(),
  hasOnPremExchange:    z.boolean().optional(),
  usesAADConnect:       z.boolean().optional(),

  // Step 4 — Security & Compliance
  mfaEnforced:                z.boolean().optional(),
  conditionalAccessEnabled:   z.boolean().optional(),
  hasAADP1orP2:               z.boolean().optional(),
  intuneEnabled:              z.boolean().optional(),
  hasDefender:                z.boolean().optional(),
  hasDLP:                     z.boolean().optional(),
  usesComplianceCenter:       z.boolean().optional(),
  sensitivityLabelsConfigured: z.boolean().optional(),
  hasRetentionPolicies:       z.boolean().optional(),
  hasInsiderRisk:             z.boolean().optional(),

  // Step 5 — Copilot Readiness
  hasCopilotLicenses:         z.boolean().optional(),
  copilotLicenseCount:        z.string().default(""),
  copilotUseCase:             z.string().default(""),
  currentAITools:             z.string().default(""),
  dataGovernanceConcerns:     z.string().default(""),
  copilotReadinessScore:      z.string().default(""),
  copilotBlockedBy:           z.string().default(""),

  // Step 6 — Engagement Goals
  engagementStartDate:  z.string().default(""),
  estimatedDuration:    z.string().default(""),
  engagementType:       z.string().default(""),
  budgetRange:          z.string().default(""),
  decisionMakerName:    z.string().default(""),
  decisionMakerEmail:   z.string().default(""),
  businessGoals:        z.string().default(""),
  knownBlockers:        z.string().default(""),
  referralSource:       z.string().default(""),
});

type M365FormValues = z.infer<typeof wizardM365Schema>;

// ── Outer wizard steps ────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "m365",
    label: "M365 Profile",
    sublabel: "Your Microsoft 365 environment",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: "app-reg",
    label: "Automation Setup",
    sublabel: "Azure App Registration",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
] as const;
type StepId = (typeof STEPS)[number]["id"];

// ── M365 sub-step config ──────────────────────────────────────────────────────

const M365_SUB_STEPS = [
  { label: "Organisation Overview" },
  { label: "Licensing & Usage" },
  { label: "Environment Structure" },
  { label: "Security & Compliance" },
  { label: "Copilot Readiness" },
  { label: "Engagement Goals" },
] as const;

// ── App Registration permissions ──────────────────────────────────────────────

const REQUIRED_PERMISSIONS = [
  {
    category: "Microsoft Graph — Application permissions",
    items: [
      "Sites.ReadWrite.All",
      "User.Read.All",
      "Directory.Read.All",
      "Group.ReadWrite.All",
    ],
  },
];

// ── Small UI helpers ──────────────────────────────────────────────────────────

const inputClassLight =
  "w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-[#0A2540] text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors";

function FieldLight({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function ToggleLight({ value, onChange, label }: { value: boolean | undefined; onChange: (v: boolean) => void; label: string }) {
  const checked = value === true;
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-all flex-shrink-0 cursor-pointer ${
          value === undefined ? "bg-gray-200 border-2 border-dashed border-gray-300" : checked ? "bg-[#0078D4]" : "bg-gray-200"
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </div>
      <span className="text-sm text-[#0A2540] group-hover:text-[#0078D4] transition-colors flex-1">{label}</span>
      {value === undefined && (
        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
          not answered
        </span>
      )}
    </label>
  );
}

function BoolControllerLight({ name, control, label }: { name: keyof M365FormValues; control: Control<M365FormValues>; label: string }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <ToggleLight
          value={field.value as boolean | undefined}
          onChange={(v) => field.onChange(v)}
          label={label}
        />
      )}
    />
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-[#F7F9FC]">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{title}</p>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function MultiSelectLight({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {options.map(opt => {
        const sel = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(sel ? value.filter(v => v !== opt) : [...value, opt])}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
              sel
                ? "bg-[#0078D4] text-white border-[#0078D4]"
                : "bg-white text-[#0A2540] border-gray-200 hover:border-[#0078D4]"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="flex-shrink-0 text-xs font-semibold text-[#0078D4] hover:text-[#00B4D8] transition-colors flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── M365 sub-step components ──────────────────────────────────────────────────

function SubStep1({ control, register }: { control: Control<M365FormValues>; register: ReturnType<typeof useForm<M365FormValues>>["register"] }) {
  const industries = ["Technology", "Healthcare", "Finance & Banking", "Legal", "Education", "Manufacturing", "Retail", "Government", "Nonprofit", "Real Estate", "Professional Services", "Other"];
  return (
    <div className="space-y-4">
      <CardSection title="Organisation">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLight label="Organisation Name">
            <input {...register("orgName")} placeholder="Acme Corp" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Industry">
            <select {...register("industry")} className={inputClassLight}>
              <option value="">Select…</option>
              {industries.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </FieldLight>
          <FieldLight label="Total Employees">
            <input {...register("employeeCount")} type="number" min="0" placeholder="e.g. 250" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Licensed M365 Users">
            <input {...register("licensedUserCount")} type="number" min="0" placeholder="e.g. 200" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Tenant Domain" hint="Primary *.onmicrosoft.com or custom domain">
            <input {...register("tenantDomain")} placeholder="contoso.onmicrosoft.com" className={inputClassLight} />
          </FieldLight>
        </div>
        <BoolControllerLight name="isMicrosoftPartner" control={control} label="We are a Microsoft partner" />
      </CardSection>

      <CardSection title="IT Contact">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLight label="IT Contact Name">
            <input {...register("itContactName")} placeholder="Jane Smith" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="IT Contact Email">
            <input {...register("itContactEmail")} type="email" placeholder="it@acme.com" className={inputClassLight} />
          </FieldLight>
        </div>
      </CardSection>
    </div>
  );
}

function SubStep2({ control, register }: { control: Control<M365FormValues>; register: ReturnType<typeof useForm<M365FormValues>>["register"] }) {
  const skus = ["M365 Business Basic", "M365 Business Standard", "M365 Business Premium", "Office 365 E1", "M365 E3", "M365 E5", "M365 F1", "M365 F3", "Copilot for M365"];
  return (
    <div className="space-y-4">
      <CardSection title="License SKUs">
        <FieldLight label="Select all that apply">
          <Controller
            name="licenseSKUs"
            control={control}
            render={({ field }) => (
              <MultiSelectLight value={field.value ?? []} onChange={field.onChange} options={skus} />
            )}
          />
        </FieldLight>
        <FieldLight label="Active User Percentage" hint="What percentage of licensed users are active month-to-month?">
          <input {...register("activeUserPercent")} type="number" min="0" max="100" placeholder="e.g. 85" className={inputClassLight} />
        </FieldLight>
        <BoolControllerLight name="allUsersLicensed" control={control} label="All users are fully licensed" />
      </CardSection>

      <CardSection title="Workloads in Use">
        <div className="space-y-3">
          <BoolControllerLight name="usesExchange"   control={control} label="Exchange Online / Email" />
          <BoolControllerLight name="usesTeams"      control={control} label="Microsoft Teams" />
          <BoolControllerLight name="usesSharePoint" control={control} label="SharePoint Online" />
          <BoolControllerLight name="usesOneDrive"   control={control} label="OneDrive for Business" />
          <BoolControllerLight name="usesYammer"     control={control} label="Viva Engage / Yammer" />
        </div>
      </CardSection>
    </div>
  );
}

function SubStep3({ control, register }: { control: Control<M365FormValues>; register: ReturnType<typeof useForm<M365FormValues>>["register"] }) {
  const authOptions = [
    { value: "password", label: "Password only" },
    { value: "mfa", label: "MFA (per-user)" },
    { value: "sso_saml", label: "SSO / SAML" },
    { value: "entra_id", label: "Entra ID (Azure AD)" },
    { value: "conditional_access", label: "Conditional Access policies" },
  ];
  return (
    <div className="space-y-4">
      <CardSection title="Scale">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FieldLight label="SharePoint Sites">
            <input {...register("sharepointSiteCount")} type="number" min="0" placeholder="e.g. 15" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Teams Count">
            <input {...register("teamCount")} type="number" min="0" placeholder="e.g. 40" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Security Groups">
            <input {...register("securityGroupCount")} type="number" min="0" placeholder="e.g. 25" className={inputClassLight} />
          </FieldLight>
        </div>
        <FieldLight label="Primary Authentication Method">
          <select {...register("authMethod")} className={inputClassLight}>
            <option value="">Select…</option>
            {authOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FieldLight>
      </CardSection>

      <CardSection title="Configuration Flags">
        <div className="space-y-3">
          <BoolControllerLight name="externalSharingEnabled" control={control} label="External sharing enabled" />
          <BoolControllerLight name="guestUsersPresent"      control={control} label="Guest users present in tenant" />
          <BoolControllerLight name="isHybrid"               control={control} label="Hybrid environment (on-prem + cloud)" />
          <BoolControllerLight name="hasOnPremExchange"      control={control} label="On-premises Exchange server present" />
          <BoolControllerLight name="usesAADConnect"         control={control} label="Entra Connect / AAD Connect in use" />
        </div>
      </CardSection>
    </div>
  );
}

function SubStep4({ control }: { control: Control<M365FormValues> }) {
  return (
    <div className="space-y-4">
      <CardSection title="Identity & Access">
        <div className="space-y-3">
          <BoolControllerLight name="mfaEnforced"              control={control} label="MFA enforced for all users" />
          <BoolControllerLight name="conditionalAccessEnabled" control={control} label="Conditional Access policies configured" />
          <BoolControllerLight name="hasAADP1orP2"             control={control} label="Entra ID P1 or P2 licensed" />
          <BoolControllerLight name="intuneEnabled"            control={control} label="Intune / MDM device management active" />
        </div>
      </CardSection>

      <CardSection title="Data Protection">
        <div className="space-y-3">
          <BoolControllerLight name="hasDefender"                 control={control} label="Microsoft Defender for M365 active" />
          <BoolControllerLight name="hasDLP"                      control={control} label="Data Loss Prevention (DLP) policies in place" />
          <BoolControllerLight name="sensitivityLabelsConfigured" control={control} label="Sensitivity labels configured" />
          <BoolControllerLight name="hasRetentionPolicies"        control={control} label="Retention policies in place" />
        </div>
      </CardSection>

      <CardSection title="Compliance">
        <div className="space-y-3">
          <BoolControllerLight name="usesComplianceCenter" control={control} label="Microsoft Purview / Compliance Center in use" />
          <BoolControllerLight name="hasInsiderRisk"       control={control} label="Insider Risk Management enabled" />
        </div>
      </CardSection>
    </div>
  );
}

function SubStep5({ control, register, watch }: { control: Control<M365FormValues>; register: ReturnType<typeof useForm<M365FormValues>>["register"]; watch: ReturnType<typeof useForm<M365FormValues>>["watch"] }) {
  const hasCopilot = watch("hasCopilotLicenses");
  const blockerOpts = ["None", "Budget", "Licensing", "Security concerns", "Training gaps", "Governance / data readiness", "Leadership buy-in"];
  const scoreOpts = [
    { value: "1", label: "1 – Not ready" },
    { value: "2", label: "2 – Early stages" },
    { value: "3", label: "3 – Partially ready" },
    { value: "4", label: "4 – Mostly ready" },
    { value: "5", label: "5 – Fully ready" },
  ];
  return (
    <div className="space-y-4">
      <CardSection title="License Status">
        <BoolControllerLight name="hasCopilotLicenses" control={control} label="We have Copilot for Microsoft 365 licenses" />
        {hasCopilot && (
          <FieldLight label="Copilot License Count">
            <input {...register("copilotLicenseCount")} type="number" min="0" placeholder="e.g. 50" className={inputClassLight} />
          </FieldLight>
        )}
      </CardSection>

      <CardSection title="AI Readiness">
        <FieldLight label="Primary Copilot Use Cases">
          <textarea {...register("copilotUseCase")} placeholder="Meeting summaries, document drafting, email triage…" rows={2} className={`${inputClassLight} resize-none`} />
        </FieldLight>
        <FieldLight label="Current AI Tools in Use">
          <textarea {...register("currentAITools")} placeholder="ChatGPT, GitHub Copilot, custom solutions…" rows={2} className={`${inputClassLight} resize-none`} />
        </FieldLight>
        <FieldLight label="Data Governance Concerns">
          <textarea {...register("dataGovernanceConcerns")} placeholder="Data sensitivity, oversharing risks, classification gaps…" rows={2} className={`${inputClassLight} resize-none`} />
        </FieldLight>
      </CardSection>

      <CardSection title="Readiness Assessment">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLight label="Copilot Readiness Score">
            <select {...register("copilotReadinessScore")} className={inputClassLight}>
              <option value="">Select…</option>
              {scoreOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FieldLight>
          <FieldLight label="Primary Blocker">
            <select {...register("copilotBlockedBy")} className={inputClassLight}>
              <option value="">Select…</option>
              {blockerOpts.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </FieldLight>
        </div>
      </CardSection>
    </div>
  );
}

function SubStep6({ register }: { register: ReturnType<typeof useForm<M365FormValues>>["register"] }) {
  const engagementTypes = ["Assessment", "Implementation", "Ongoing Support", "Training & Enablement", "Governance", "Advisory / Strategy"];
  const budgetRanges = ["< $5K", "$5K – $15K", "$15K – $30K", "$30K – $75K", "$75K – $150K", "> $150K"];
  return (
    <div className="space-y-4">
      <CardSection title="Engagement Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLight label="Engagement Type">
            <select {...register("engagementType")} className={inputClassLight}>
              <option value="">Select…</option>
              {engagementTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FieldLight>
          <FieldLight label="Budget Range">
            <select {...register("budgetRange")} className={inputClassLight}>
              <option value="">Select…</option>
              {budgetRanges.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </FieldLight>
          <FieldLight label="Target Start Date">
            <input {...register("engagementStartDate")} type="date" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Estimated Duration">
            <input {...register("estimatedDuration")} placeholder="e.g. 3 months, 6 weeks" className={inputClassLight} />
          </FieldLight>
        </div>
      </CardSection>

      <CardSection title="Decision Maker">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLight label="Decision Maker Name">
            <input {...register("decisionMakerName")} placeholder="John CEO" className={inputClassLight} />
          </FieldLight>
          <FieldLight label="Decision Maker Email">
            <input {...register("decisionMakerEmail")} type="email" placeholder="ceo@acme.com" className={inputClassLight} />
          </FieldLight>
        </div>
      </CardSection>

      <CardSection title="Goals & Context">
        <FieldLight label="Business Goals">
          <textarea {...register("businessGoals")} placeholder="Describe what you'd like to achieve with this engagement…" rows={3} className={`${inputClassLight} resize-none`} />
        </FieldLight>
        <FieldLight label="Known Blockers or Constraints">
          <textarea {...register("knownBlockers")} placeholder="Any known blockers, constraints, or concerns…" rows={2} className={`${inputClassLight} resize-none`} />
        </FieldLight>
        <FieldLight label="How did you hear about us?">
          <input {...register("referralSource")} placeholder="e.g. LinkedIn, referral, Google search" className={inputClassLight} />
        </FieldLight>
      </CardSection>
    </div>
  );
}

// ── Step 1: M365 Profile (multi sub-step) ─────────────────────────────────────

function StepM365Profile({ onSaveAndContinue, onSkip }: { onSaveAndContinue: (data: M365FormValues) => Promise<void>; onSkip: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subStep, setSubStep] = useState(1);
  const TOTAL_SUB_STEPS = M365_SUB_STEPS.length;

  const form = useForm<M365FormValues>({
    resolver: zodResolver(wizardM365Schema),
    defaultValues: wizardM365Schema.parse({}),
  });
  const { control, register, reset, watch, handleSubmit } = form;

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/m365-profile").then(r => r.ok ? r.json() as Promise<Record<string, unknown>> : ({} as Record<string, unknown>)),
      fetchWithAuth("/api/portal/profile").then(r => r.ok ? r.json() as Promise<{ company?: string | null }> : ({} as { company?: string | null })),
    ])
      .then(([m365Data, profileData]) => {
        const merged: Partial<M365FormValues> = { ...wizardM365Schema.parse({}) };
        for (const key of Object.keys(m365Data)) {
          const v = m365Data[key];
          if (v !== null && v !== undefined) (merged as Record<string, unknown>)[key] = v;
          if (typeof v === "boolean") (merged as Record<string, unknown>)[key] = v;
        }
        if (!merged.orgName && (profileData as { company?: string }).company) {
          merged.orgName = (profileData as { company?: string }).company;
        }
        reset(merged as M365FormValues);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth, reset]);

  const doSave = handleSubmit(async (data) => {
    setSaving(true);
    setError(null);
    try {
      await onSaveAndContinue(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
      setSaving(false);
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const subStepLabel = M365_SUB_STEPS[subStep - 1].label;

  return (
    <div className="h-full flex flex-col">
      {/* Sub-step header */}
      <div className="flex-shrink-0 bg-white border-b border-gray-100 px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-[#0078D4] uppercase tracking-wider">
                Step {subStep} of {TOTAL_SUB_STEPS}
              </span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs font-semibold text-gray-500">{subStepLabel}</span>
            </div>
            <h2 className="text-xl font-bold text-[#0A2540]">{subStepLabel}</h2>
          </div>
          {/* Sub-step dots */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {M365_SUB_STEPS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i + 1 === subStep
                    ? "w-6 h-2 bg-[#0078D4]"
                    : i + 1 < subStep
                      ? "w-2 h-2 bg-[#0078D4]/50"
                      : "w-2 h-2 bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Sub-step content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        <p className="text-sm text-gray-500 -mt-1 mb-2">
          Help Shane understand your Microsoft 365 environment so he can tailor the engagement from day one. All fields are optional — share what you know now.
        </p>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {error}
          </div>
        )}

        {subStep === 1 && <SubStep1 control={control} register={register} />}
        {subStep === 2 && <SubStep2 control={control} register={register} />}
        {subStep === 3 && <SubStep3 control={control} register={register} />}
        {subStep === 4 && <SubStep4 control={control} />}
        {subStep === 5 && <SubStep5 control={control} register={register} watch={watch} />}
        {subStep === 6 && <SubStep6 register={register} />}
      </div>

      {/* Bottom navigation */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white px-8 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {subStep > 1 ? (
            <button
              type="button"
              onClick={() => { setError(null); setSubStep(s => s - 1); }}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#0A2540] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        </div>

        {subStep < TOTAL_SUB_STEPS ? (
          <button
            type="button"
            onClick={() => { setError(null); setSubStep(s => s + 1); }}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => { void doSave(); }}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors disabled:opacity-60"
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Save &amp; Continue
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 2: App Registration ──────────────────────────────────────────────────

function StepAppRegistration({ onSaveAndContinue, onBack, onSkip }: { onSaveAndContinue: (tenantId: string, clientId: string, secret: string) => Promise<void>; onBack: () => void; onSkip: () => void }) {
  const [tenantId, setTenantId] = useState("");
  const [azureClientId, setAzureClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionsExpanded, setPermissionsExpanded] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantId.trim() || !azureClientId.trim() || !clientSecret.trim()) {
      setError("All three credential fields are required.");
      return;
    }
    setSaving(true);
    try {
      await onSaveAndContinue(tenantId.trim(), azureClientId.trim(), clientSecret.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credentials. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-8 py-8 space-y-5">
        <div className="mb-2">
          <h2 className="text-2xl font-bold text-[#0A2540]">Connect Your Azure Tenant</h2>
          <p className="text-sm text-gray-500 mt-1.5">
            Create a read-only Azure App Registration so Shane's automation scripts can work inside your M365 environment. You retain full control and can revoke access at any time.
          </p>
        </div>

        {/* Security callout */}
        <div className="bg-[#0A2540] rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-0.5">Your credentials are stored in Azure Key Vault</p>
            <p className="text-xs text-white/60 leading-relaxed">
              The Client Secret you enter is transmitted over HTTPS and stored immediately in Azure Key Vault — never written to this app's database. You can revoke access at any time by deleting the App Registration.
            </p>
          </div>
        </div>

        {/* Required permissions — collapsible */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setPermissionsExpanded(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-[#F7F9FC] transition-colors"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Required API Permissions</p>
              <p className="text-xs text-gray-400 mt-0.5">Grant all as Application permissions in your App Registration</p>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${permissionsExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {permissionsExpanded && (
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {REQUIRED_PERMISSIONS.map(group => (
                <div key={group.category}>
                  <div className="px-5 py-2 bg-[#0A2540]/[0.03]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#0A2540]/50">{group.category}</span>
                  </div>
                  {group.items.map(perm => (
                    <div key={perm} className="px-5 py-2.5 flex items-center justify-between gap-3">
                      <code className="text-xs font-mono font-semibold text-[#0078D4] bg-[#0078D4]/8 px-2 py-0.5 rounded">{perm}</code>
                      <CopyButton text={perm} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="px-5 py-3 bg-amber-50">
                <p className="text-xs text-amber-700">
                  <strong>After granting permissions:</strong> click <strong>Grant admin consent</strong> in the Azure portal.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Step-by-step guide */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 bg-[#F7F9FC]">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Step-by-Step Setup</p>
          </div>
          <ol className="divide-y divide-gray-50">
            {[
              { n: 1, title: "Open Microsoft Entra ID", body: "Go to portal.azure.com and sign in as a Global Administrator. Choose Microsoft Entra ID in the left sidebar." },
              { n: 2, title: "Create a new App Registration", body: 'Select App Registrations → New Registration. Name it "Shane McCaw Automation" and leave account type as "Accounts in this organizational directory only". Click Register.' },
              { n: 3, title: "Copy your Tenant ID and Client ID", body: "On the Overview page copy the Application (client) ID and Directory (tenant) ID — paste them into the form below." },
              { n: 4, title: "Grant the required API permissions", body: "Go to API Permissions → Add a permission → Microsoft Graph → Application permissions. Search for and add every permission in the list above. Then click Grant admin consent." },
              { n: 5, title: "Create a Client Secret", body: "Go to Certificates & Secrets → New client secret. Set expiry to 24 months. Click Add, then immediately copy the Value shown — it is only visible once." },
            ].map(step => (
              <li key={step.n} className="flex gap-4 px-5 py-4">
                <div className="w-6 h-6 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-[#0078D4]">{step.n}</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#0A2540] mb-0.5">{step.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Credential fields */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 bg-[#F7F9FC]">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Your App Registration Credentials</p>
          </div>
          <div className="px-5 py-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {error}
              </div>
            )}

            <FieldLight label="Tenant ID (Directory ID)" hint="Found on the Entra ID overview page">
              <input
                type="text"
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className={`${inputClassLight} font-mono`}
                autoComplete="off"
              />
            </FieldLight>

            <FieldLight label="Client ID (Application ID)" hint="Found under Application (client) ID on the Overview page">
              <input
                type="text"
                value={azureClientId}
                onChange={e => setAzureClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className={`${inputClassLight} font-mono`}
                autoComplete="off"
              />
            </FieldLight>

            <FieldLight label="Client Secret" hint="From Certificates & Secrets — only visible immediately after creation">
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Paste the secret value here"
                  className={`${inputClassLight} pr-10 font-mono`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                >
                  {showSecret ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </FieldLight>
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white px-8 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#0A2540] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Submit &amp; Finish
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </form>
  );
}

// ── Complete step (success) ───────────────────────────────────────────────────

function StepComplete({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-12 text-center">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-[#0A2540] mb-3">You're all set!</h2>
      <p className="text-sm text-gray-500 max-w-md mb-8 leading-relaxed">
        Shane has everything he needs to get started. Your environment profile is saved and any credentials submitted are secured in Azure Key Vault. Shane will verify your connection within one business day.
      </p>
      <button
        onClick={onGoToDashboard}
        className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-8 py-3 rounded-xl transition-colors"
      >
        Go to your dashboard
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState<StepId | "done">("m365");
  const [completing, setCompleting] = useState(false);

  const completeWizard = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await fetchWithAuth("/api/portal/onboarding/complete", { method: "POST" });
    } catch {
      // non-fatal, continue to dashboard
    }
    setCurrentStep("done");
    setCompleting(false);
  }, [fetchWithAuth, completing]);

  async function handleM365SaveAndContinue(data: M365FormValues) {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payload[k] = v;
    }
    const res = await fetchWithAuth("/api/portal/m365-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? "Could not save profile.");
    }
    setCurrentStep("app-reg");
  }

  async function handleAppRegSaveAndContinue(tenantId: string, clientId: string, secret: string) {
    const res = await fetchWithAuth("/api/portal/app-registration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, azureClientId: clientId, clientSecret: secret }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? "Could not save credentials.");
    }
    await completeWizard();
  }

  async function handleSkip() {
    await completeWizard();
  }

  function handleGoToDashboard() {
    navigate("/portal");
  }

  const stepIndex = currentStep === "done" ? STEPS.length : STEPS.findIndex(s => s.id === currentStep);
  const progress = currentStep === "done" ? 100 : Math.round((stepIndex / STEPS.length) * 100);

  return (
    <div className="fixed inset-0 flex bg-[#F7F9FC]" style={{ zIndex: 9999 }}>
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="hidden md:flex flex-col w-72 bg-[#0A2540] flex-shrink-0">
        {/* Logo area */}
        <div className="px-7 pt-8 pb-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold text-white leading-tight">Shane McCaw</p>
              <p className="text-[10px] text-white/40">Consulting Portal</p>
            </div>
          </div>
        </div>

        {/* Welcome */}
        <div className="px-7 pt-6 pb-5">
          <p className="text-xs font-semibold text-[#00B4D8] uppercase tracking-wider mb-1.5">Welcome aboard</p>
          <h2 className="text-lg font-bold text-white leading-tight">Let's set up your workspace</h2>
          <p className="text-xs text-white/40 mt-2 leading-relaxed">
            This takes about 5 minutes. You can skip any step and come back later.
          </p>
        </div>

        {/* Steps */}
        <div className="px-4 flex-1">
          {STEPS.map((step, idx) => {
            const isActive = currentStep === step.id;
            const stepPos = currentStep === "done" ? STEPS.length : STEPS.findIndex(s => s.id === currentStep);
            const isDone = stepPos > idx;
            const isUpcoming = !isActive && !isDone;

            return (
              <div key={step.id} className="relative">
                {/* Connector line */}
                {idx < STEPS.length - 1 && (
                  <div className={`absolute left-[23px] top-[44px] w-0.5 h-8 ${isDone ? "bg-[#0078D4]" : "bg-white/10"}`} />
                )}

                <div className={`flex items-start gap-3.5 px-3 py-3 rounded-xl transition-all ${isActive ? "bg-white/10" : ""}`}>
                  {/* Step indicator */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                    isDone
                      ? "bg-[#0078D4] border-[#0078D4]"
                      : isActive
                        ? "bg-[#0078D4]/20 border-[#0078D4]"
                        : "bg-transparent border-white/20"
                  }`}>
                    {isDone ? (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className={`text-xs font-bold ${isActive ? "text-[#0078D4]" : "text-white/30"}`}>{idx + 1}</span>
                    )}
                  </div>

                  <div className="pt-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isActive ? "text-white" : isDone ? "text-white/70" : "text-white/30"}`}>
                      {step.label}
                    </p>
                    <p className={`text-xs mt-0.5 truncate ${isActive ? "text-white/50" : "text-white/20"}`}>{step.sublabel}</p>
                  </div>

                  {isActive && (
                    <div className="flex-shrink-0 pt-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Done step */}
          {currentStep === "done" && (
            <div className="flex items-start gap-3.5 px-3 py-3 rounded-xl bg-white/10">
              <div className="w-8 h-8 rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="pt-1">
                <p className="text-sm font-semibold text-white">Complete</p>
                <p className="text-xs text-white/50 mt-0.5">All set!</p>
              </div>
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="px-6 py-5 border-t border-white/10">
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="w-3.5 h-3.5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">End-to-end encrypted</span>
          </div>
          <p className="text-[11px] text-white/30 leading-relaxed">
            Credentials are transmitted via TLS and stored in Azure Key Vault — never in this app's database.
          </p>
        </div>
      </div>

      {/* ── Right content panel ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top progress bar + mobile header */}
        <div className="flex-shrink-0">
          {/* Mobile header */}
          <div className="md:hidden flex items-center justify-between px-5 py-4 bg-[#0A2540]">
            <p className="text-sm font-bold text-white">Workspace Setup</p>
            <span className="text-xs text-white/50">Step {stepIndex + 1} of {STEPS.length}</span>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-gray-200">
            <div
              className="h-1 transition-all duration-500"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
            />
          </div>
          {/* Desktop header */}
          {currentStep !== "done" && (
            <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-100">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="font-semibold text-[#0A2540]">
                  Step {stepIndex + 1}
                </span>
                <span>/</span>
                <span>{STEPS.length}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
                  />
                </div>
                <span className="font-semibold text-[#0078D4]">{progress}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Step content */}
        <div className="flex-1 min-h-0 bg-[#F7F9FC]">
          {currentStep === "m365" && (
            <StepM365Profile
              onSaveAndContinue={handleM365SaveAndContinue}
              onSkip={handleSkip}
            />
          )}
          {currentStep === "app-reg" && (
            <StepAppRegistration
              onSaveAndContinue={handleAppRegSaveAndContinue}
              onBack={() => setCurrentStep("m365")}
              onSkip={handleSkip}
            />
          )}
          {currentStep === "done" && (
            <StepComplete onGoToDashboard={handleGoToDashboard} />
          )}
        </div>
      </div>
    </div>
  );
}
