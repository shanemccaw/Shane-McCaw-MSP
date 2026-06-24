import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useForm, Controller, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

// ── Zod schema ────────────────────────────────────────────────────────────────

const m365Schema = z.object({
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
  sharepointSiteCount:    z.string().default(""),
  teamCount:              z.string().default(""),
  securityGroupCount:     z.string().default(""),
  authMethod:             z.string().default(""),
  externalSharingEnabled: z.boolean().optional(),
  guestUsersPresent:      z.boolean().optional(),
  isHybrid:               z.boolean().optional(),
  hasOnPremExchange:      z.boolean().optional(),
  usesAADConnect:         z.boolean().optional(),

  // Step 4 — Security & Compliance
  mfaEnforced:                  z.boolean().optional(),
  conditionalAccessEnabled:     z.boolean().optional(),
  hasAADP1orP2:                 z.boolean().optional(),
  intuneEnabled:                z.boolean().optional(),
  hasDefender:                  z.boolean().optional(),
  hasDLP:                       z.boolean().optional(),
  usesComplianceCenter:         z.boolean().optional(),
  sensitivityLabelsConfigured:  z.boolean().optional(),
  hasRetentionPolicies:         z.boolean().optional(),
  hasInsiderRisk:               z.boolean().optional(),

  // Step 5 — Copilot Readiness
  hasCopilotLicenses:       z.boolean().optional(),
  copilotLicenseCount:      z.string().default(""),
  copilotUseCase:           z.string().default(""),
  currentAITools:           z.string().default(""),
  dataGovernanceConcerns:   z.string().default(""),
  copilotReadinessScore:    z.string().default(""),
  copilotBlockedBy:         z.string().default(""),

  // Engagement Goals
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

type FormValues = z.infer<typeof m365Schema>;

// ── Completion calculation ────────────────────────────────────────────────────

const STRING_FIELDS: (keyof FormValues)[] = [
  "orgName", "industry", "employeeCount", "licensedUserCount",
  "itContactName", "itContactEmail", "tenantDomain",
  "activeUserPercent", "sharepointSiteCount", "teamCount",
  "securityGroupCount", "authMethod",
  "copilotUseCase", "currentAITools", "dataGovernanceConcerns",
  "engagementType", "engagementStartDate", "estimatedDuration",
  "budgetRange", "decisionMakerName", "decisionMakerEmail",
  "businessGoals", "referralSource",
];

const BOOL_FIELDS: (keyof FormValues)[] = [
  "isMicrosoftPartner", "allUsersLicensed", "usesExchange", "usesTeams",
  "usesSharePoint", "usesOneDrive", "externalSharingEnabled",
  "guestUsersPresent", "isHybrid", "mfaEnforced", "conditionalAccessEnabled",
  "intuneEnabled", "hasCopilotLicenses",
];

const TOTAL_FIELDS = STRING_FIELDS.length + BOOL_FIELDS.length + 1;

function computeCompletion(values: FormValues): number {
  let filled = 0;
  for (const k of STRING_FIELDS) {
    const v = values[k];
    if (typeof v === "string" && v.trim() !== "") filled++;
  }
  for (const k of BOOL_FIELDS) {
    if (values[k] !== undefined) filled++;
  }
  if ((values.licenseSKUs ?? []).length > 0) filled++;
  return Math.round((filled / TOTAL_FIELDS) * 100);
}

// ── Tabs — each maps to a direct URL ?tab=<id> ────────────────────────────────

const TABS = [
  { id: "org",        label: "Organisation Overview" },
  { id: "licensing",  label: "Licensing & Usage" },
  { id: "structure",  label: "Environment Structure" },
  { id: "security",   label: "Security & Compliance" },
  { id: "copilot",    label: "Copilot Readiness" },
  { id: "scorecards", label: "Scorecards" },
] as const;
type TabId = typeof TABS[number]["id"];

const VALID_TABS: TabId[] = ["org", "licensing", "structure", "security", "copilot", "scorecards"];

// ── Small UI helpers ──────────────────────────────────────────────────────────

const inputClass =
  "w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-[#0A2540] text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
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

function Toggle({ value, onChange, label }: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  label: string;
}) {
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

function BoolController({ name, control, label }: {
  name: keyof FormValues;
  control: Control<FormValues>;
  label: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Toggle
          value={field.value as boolean | undefined}
          onChange={(v) => field.onChange(v)}
          label={label}
        />
      )}
    />
  );
}

function MultiSelect({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
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

type AlertState = { type: "success" | "error"; message: string } | null;

// ── Page component ────────────────────────────────────────────────────────────

export default function PortalM365Profile() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    return (VALID_TABS.includes(param as TabId) ? param : "org") as TabId;
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(m365Schema),
    defaultValues: m365Schema.parse({}),
  });
  const { control, register, handleSubmit, watch, reset } = form;

  const values = watch();
  const completion = computeCompletion(values);

  function switchTab(id: TabId) {
    setActiveTab(id);
    navigate(`/portal/m365-profile?tab=${id}`);
  }

  // ── Load existing profile ────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/m365-profile").then(r => r.json() as Promise<Record<string, unknown>>),
      fetchWithAuth("/api/portal/profile").then(r => r.json() as Promise<{ company?: string | null }>),
    ])
      .then(([m365Data, profileData]) => {
        const merged: Partial<FormValues> = { ...m365Schema.parse({}) };
        for (const key of Object.keys(m365Data)) {
          const k = key as keyof FormValues;
          const v = m365Data[key];
          if (v !== null && v !== undefined) (merged as Record<string, unknown>)[k] = v;
          if (typeof v === "boolean") (merged as Record<string, unknown>)[k] = v;
        }
        if (!merged.orgName && profileData.company) merged.orgName = profileData.company;
        reset(merged as FormValues);
      })
      .catch(() => setAlert({ type: "error", message: "Could not load your profile. Please refresh." }))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, reset]);

  // ── Save handler ─────────────────────────────────────────────────────────

  const onSubmit = useCallback(async (data: FormValues) => {
    setSaving(true);
    setAlert(null);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payload[k] = v;
    }
    try {
      const res = await fetchWithAuth("/api/portal/m365-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setAlert({ type: "success", message: "Profile saved successfully." });
      } else {
        const err = await res.json() as { error?: string };
        setAlert({ type: "error", message: err.error ?? "Could not save. Please try again." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  }, [fetchWithAuth]);

  const saveButton = (
    <div className="flex justify-end pt-2">
      <button
        type="submit"
        disabled={saving}
        className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
      >
        {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
        Save progress
      </button>
    </div>
  );

  // ── Dropdown options ──────────────────────────────────────────────────────

  const industries = ["Technology", "Healthcare", "Finance & Banking", "Legal", "Education", "Manufacturing", "Retail", "Government", "Nonprofit", "Real Estate", "Professional Services", "Other"];
  const skus = ["M365 Business Basic", "M365 Business Standard", "M365 Business Premium", "Office 365 E1", "M365 E3", "M365 E5", "M365 F1", "M365 F3", "Copilot for M365"];
  const authOptions = [
    { value: "password",           label: "Password only" },
    { value: "mfa",                label: "MFA (per-user)" },
    { value: "sso_saml",           label: "SSO / SAML" },
    { value: "entra_id",           label: "Entra ID (Azure AD)" },
    { value: "conditional_access", label: "Conditional Access policies" },
  ];
  const blockerOpts = ["None", "Budget", "Licensing", "Security concerns", "Training gaps", "Governance / data readiness", "Leadership buy-in"];
  const scoreOpts = [
    { value: "1", label: "1 – Not ready" },
    { value: "2", label: "2 – Early stages" },
    { value: "3", label: "3 – Partially ready" },
    { value: "4", label: "4 – Mostly ready" },
    { value: "5", label: "5 – Fully ready" },
  ];

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#0A2540]">M365 Environment Profile</h1>
              <p className="text-sm text-gray-500 mt-1">
                Help Shane understand your Microsoft 365 environment so he can tailor your engagement.
              </p>
            </div>
            <div className="flex-shrink-0 flex flex-col items-end gap-2">
              <div className="text-right">
                <div className="text-xs font-semibold text-gray-400 mb-1">Completion</div>
                <div className="flex items-center gap-2">
                  <div className="w-28 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${completion}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
                    />
                  </div>
                  <span className={`text-sm font-bold ${completion === 100 ? "text-green-600" : "text-[#0078D4]"}`}>
                    {completion}%
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/portal/m365-wizard")}
                className="flex items-center gap-2 text-sm font-semibold text-[#0078D4] border border-[#0078D4]/30 bg-[#0078D4]/5 hover:bg-[#0078D4]/10 px-3.5 py-2 rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-run setup wizard
              </button>
            </div>
          </div>
        </div>

        {/* Alert */}
        {alert && (
          <div className={`mb-5 flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
            alert.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}>
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {alert.type === "success"
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />}
            </svg>
            <span>{alert.message}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={(e) => { void handleSubmit(onSubmit)(e); }}>

            {/* Tab strip — each tab updates the URL for direct linking */}
            <div className="flex gap-1 mb-6 bg-white border border-gray-200 rounded-2xl p-1.5 overflow-x-auto">
              {TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchTab(tab.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? "bg-[#0078D4] text-white shadow"
                      : "text-gray-400 hover:text-[#0A2540]"
                  }`}
                >
                  {tab.id !== "scorecards" && (
                    <span className={`w-4 h-4 rounded-full text-[9px] font-black flex items-center justify-center flex-shrink-0 ${
                      activeTab === tab.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-400"
                    }`}>{i + 1}</span>
                  )}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Step 1: Organisation Overview ─────────────────────────── */}
            {activeTab === "org" && (
              <div className="space-y-4">
                <CardSection title="Organisation">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Organisation Name">
                      <input {...register("orgName")} placeholder="Acme Corp" className={inputClass} />
                    </Field>
                    <Field label="Industry">
                      <select {...register("industry")} className={inputClass}>
                        <option value="">Select…</option>
                        {industries.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </Field>
                    <Field label="Total Employees">
                      <input {...register("employeeCount")} type="number" min="0" placeholder="e.g. 250" className={inputClass} />
                    </Field>
                    <Field label="Licensed M365 Users">
                      <input {...register("licensedUserCount")} type="number" min="0" placeholder="e.g. 200" className={inputClass} />
                    </Field>
                    <Field label="Tenant Domain" hint="Primary *.onmicrosoft.com or custom domain">
                      <input {...register("tenantDomain")} placeholder="contoso.onmicrosoft.com" className={inputClass} />
                    </Field>
                  </div>
                  <BoolController name="isMicrosoftPartner" control={control} label="We are a Microsoft partner" />
                </CardSection>

                <CardSection title="IT Contact">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="IT Contact Name">
                      <input {...register("itContactName")} placeholder="Jane Smith" className={inputClass} />
                    </Field>
                    <Field label="IT Contact Email">
                      <input {...register("itContactEmail")} type="email" placeholder="it@acme.com" className={inputClass} />
                    </Field>
                  </div>
                </CardSection>

                {saveButton}
              </div>
            )}

            {/* ── Step 2: Licensing & Usage ──────────────────────────────── */}
            {activeTab === "licensing" && (
              <div className="space-y-4">
                <CardSection title="License SKUs">
                  <Field label="Select all that apply">
                    <Controller
                      name="licenseSKUs"
                      control={control}
                      render={({ field }) => (
                        <MultiSelect value={field.value ?? []} onChange={field.onChange} options={skus} />
                      )}
                    />
                  </Field>
                  <Field label="Active User Percentage" hint="What percentage of licensed users are active month-to-month?">
                    <input {...register("activeUserPercent")} type="number" min="0" max="100" placeholder="e.g. 85" className={inputClass} />
                  </Field>
                  <BoolController name="allUsersLicensed" control={control} label="All users are fully licensed" />
                </CardSection>

                <CardSection title="Workloads in Use">
                  <div className="space-y-3">
                    <BoolController name="usesExchange"   control={control} label="Exchange Online / Email" />
                    <BoolController name="usesTeams"      control={control} label="Microsoft Teams" />
                    <BoolController name="usesSharePoint" control={control} label="SharePoint Online" />
                    <BoolController name="usesOneDrive"   control={control} label="OneDrive for Business" />
                    <BoolController name="usesYammer"     control={control} label="Viva Engage / Yammer" />
                  </div>
                </CardSection>

                {saveButton}
              </div>
            )}

            {/* ── Step 3: Environment Structure ─────────────────────────── */}
            {activeTab === "structure" && (
              <div className="space-y-4">
                <CardSection title="Scale">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label="SharePoint Sites">
                      <input {...register("sharepointSiteCount")} type="number" min="0" placeholder="e.g. 15" className={inputClass} />
                    </Field>
                    <Field label="Teams Count">
                      <input {...register("teamCount")} type="number" min="0" placeholder="e.g. 40" className={inputClass} />
                    </Field>
                    <Field label="Security Groups">
                      <input {...register("securityGroupCount")} type="number" min="0" placeholder="e.g. 25" className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Primary Authentication Method">
                    <select {...register("authMethod")} className={inputClass}>
                      <option value="">Select…</option>
                      {authOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                </CardSection>

                <CardSection title="Configuration Flags">
                  <div className="space-y-3">
                    <BoolController name="externalSharingEnabled" control={control} label="External sharing enabled" />
                    <BoolController name="guestUsersPresent"      control={control} label="Guest users present in tenant" />
                    <BoolController name="isHybrid"               control={control} label="Hybrid environment (on-prem + cloud)" />
                    <BoolController name="hasOnPremExchange"      control={control} label="On-premises Exchange server present" />
                    <BoolController name="usesAADConnect"         control={control} label="Entra Connect / AAD Connect in use" />
                  </div>
                </CardSection>

                {saveButton}
              </div>
            )}

            {/* ── Step 4: Security & Compliance ─────────────────────────── */}
            {activeTab === "security" && (
              <div className="space-y-4">
                <CardSection title="Identity & Access">
                  <div className="space-y-3">
                    <BoolController name="mfaEnforced"              control={control} label="MFA enforced for all users" />
                    <BoolController name="conditionalAccessEnabled" control={control} label="Conditional Access policies configured" />
                    <BoolController name="hasAADP1orP2"             control={control} label="Entra ID P1 or P2 licensed" />
                    <BoolController name="intuneEnabled"            control={control} label="Intune / MDM device management active" />
                  </div>
                </CardSection>

                <CardSection title="Data Protection">
                  <div className="space-y-3">
                    <BoolController name="hasDefender"                 control={control} label="Microsoft Defender for M365 active" />
                    <BoolController name="hasDLP"                      control={control} label="Data Loss Prevention (DLP) policies in place" />
                    <BoolController name="sensitivityLabelsConfigured" control={control} label="Sensitivity labels configured" />
                    <BoolController name="hasRetentionPolicies"        control={control} label="Retention policies in place" />
                  </div>
                </CardSection>

                <CardSection title="Compliance">
                  <div className="space-y-3">
                    <BoolController name="usesComplianceCenter" control={control} label="Microsoft Purview / Compliance Center in use" />
                    <BoolController name="hasInsiderRisk"       control={control} label="Insider Risk Management enabled" />
                  </div>
                </CardSection>

                {saveButton}
              </div>
            )}

            {/* ── Step 5: Copilot Readiness ──────────────────────────────── */}
            {activeTab === "copilot" && (
              <div className="space-y-4">
                <CardSection title="License Status">
                  <BoolController name="hasCopilotLicenses" control={control} label="We have Copilot for Microsoft 365 licenses" />
                  {values.hasCopilotLicenses === true && (
                    <Field label="Copilot License Count">
                      <input {...register("copilotLicenseCount")} type="number" min="0" placeholder="e.g. 50" className={inputClass} />
                    </Field>
                  )}
                </CardSection>

                <CardSection title="AI Readiness">
                  <Field label="Primary Copilot Use Cases">
                    <textarea {...register("copilotUseCase")} placeholder="Meeting summaries, document drafting, email triage…" rows={2} className={`${inputClass} resize-none`} />
                  </Field>
                  <Field label="Current AI Tools in Use">
                    <textarea {...register("currentAITools")} placeholder="ChatGPT, GitHub Copilot, custom solutions…" rows={2} className={`${inputClass} resize-none`} />
                  </Field>
                  <Field label="Data Governance Concerns">
                    <textarea {...register("dataGovernanceConcerns")} placeholder="Data sensitivity, oversharing risks, classification gaps…" rows={2} className={`${inputClass} resize-none`} />
                  </Field>
                </CardSection>

                <CardSection title="Readiness Assessment">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Copilot Readiness Score">
                      <select {...register("copilotReadinessScore")} className={inputClass}>
                        <option value="">Select…</option>
                        {scoreOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Primary Blocker">
                      <select {...register("copilotBlockedBy")} className={inputClass}>
                        <option value="">Select…</option>
                        {blockerOpts.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </Field>
                  </div>
                </CardSection>

                {saveButton}
              </div>
            )}

            {/* ── Scorecards (derived) ───────────────────────────────────── */}
            {activeTab === "scorecards" && (
              <div className="space-y-4">
                {(() => {
                  const v = values;
                  function boolScore(fields: (boolean | undefined)[]): number {
                    const answered = fields.filter(f => f !== undefined);
                    if (answered.length === 0) return 0;
                    return Math.round((fields.filter(f => f === true).length / fields.length) * 100);
                  }

                  const secScore  = boolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]);
                  const compScore = boolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]);
                  const copScore  = boolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]);
                  const govScore  = boolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]);
                  const pct = parseInt(v.activeUserPercent ?? "0", 10);
                  const adoptionScore = Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100);

                  const cards = [
                    {
                      label: "Security Posture",
                      score: secScore,
                      tab: "security" as TabId,
                      trend: secScore >= 70 ? "↑" : secScore >= 40 ? "→" : "↓",
                      trendColor: secScore >= 70 ? "text-green-600" : secScore >= 40 ? "text-amber-600" : "text-red-600",
                      risks: [
                        !v.mfaEnforced ? "MFA not enforced" : null,
                        !v.conditionalAccessEnabled ? "No Conditional Access policies" : null,
                        !v.hasDefender ? "Defender for Office 365 not enabled" : null,
                      ].filter(Boolean) as string[],
                      opportunities: [
                        !v.intuneEnabled ? "Enable Intune for device management" : null,
                        !v.hasAADP1orP2 ? "Upgrade to Azure AD Premium P1/P2" : null,
                        !v.hasDLP ? "Implement DLP policies" : null,
                      ].filter(Boolean) as string[],
                      recommendation: secScore < 50 ? "Critical security gaps detected. Prioritise MFA enforcement and Conditional Access before Copilot rollout." : secScore < 80 ? "Good foundation — focus on Defender, DLP, and sensitivity labels to reach best practice." : "Security posture is strong. Review quarterly and monitor for configuration drift.",
                    },
                    {
                      label: "Compliance Coverage",
                      score: compScore,
                      tab: "security" as TabId,
                      trend: compScore >= 70 ? "↑" : compScore >= 40 ? "→" : "↓",
                      trendColor: compScore >= 70 ? "text-green-600" : compScore >= 40 ? "text-amber-600" : "text-red-600",
                      risks: [
                        !v.hasDLP ? "No Data Loss Prevention policies" : null,
                        !v.hasRetentionPolicies ? "No retention policies configured" : null,
                        !v.sensitivityLabelsConfigured ? "Sensitivity labels not configured" : null,
                      ].filter(Boolean) as string[],
                      opportunities: [
                        !v.hasInsiderRisk ? "Enable Insider Risk Management" : null,
                        !v.usesComplianceCenter ? "Leverage Microsoft Purview" : null,
                      ].filter(Boolean) as string[],
                      recommendation: compScore < 50 ? "Significant compliance gaps. Implement DLP policies and sensitivity labels as a priority." : "Good compliance baseline — expand to retention policies and insider risk management.",
                    },
                    {
                      label: "Copilot Readiness",
                      score: copScore,
                      tab: "copilot" as TabId,
                      trend: copScore >= 70 ? "↑" : copScore >= 40 ? "→" : "↓",
                      trendColor: copScore >= 70 ? "text-green-600" : copScore >= 40 ? "text-amber-600" : "text-red-600",
                      risks: [
                        !v.hasCopilotLicenses ? "No Copilot M365 licenses" : null,
                        !v.sensitivityLabelsConfigured ? "Sensitivity labels required before Copilot" : null,
                        !v.hasDLP ? "DLP policies needed for data protection" : null,
                      ].filter(Boolean) as string[],
                      opportunities: [
                        "Define Copilot use cases for your organisation",
                        !v.hasCopilotLicenses ? "Evaluate Copilot for M365 licensing" : null,
                      ].filter(Boolean) as string[],
                      recommendation: copScore < 40 ? "Your environment needs security and compliance prerequisites before Copilot deployment. Work with Shane on a readiness plan." : "You're partway to Copilot readiness. Address labelling and DLP gaps to accelerate rollout.",
                    },
                    {
                      label: "Governance Maturity",
                      score: govScore,
                      tab: "security" as TabId,
                      trend: govScore >= 70 ? "↑" : govScore >= 40 ? "→" : "↓",
                      trendColor: govScore >= 70 ? "text-green-600" : govScore >= 40 ? "text-amber-600" : "text-red-600",
                      risks: [
                        !v.hasRetentionPolicies ? "No data retention framework" : null,
                        !v.conditionalAccessEnabled ? "Identity governance gaps" : null,
                      ].filter(Boolean) as string[],
                      opportunities: [
                        "Implement lifecycle management for Teams and Groups",
                        "Establish guest access governance policies",
                      ],
                      recommendation: govScore < 50 ? "Governance maturity is low. Prioritise retention policies and Conditional Access to reduce organisational risk." : "Governance foundations are in place. Build on these with automated lifecycle policies.",
                    },
                    {
                      label: "Adoption Score",
                      score: adoptionScore,
                      tab: "licensing" as TabId,
                      trend: adoptionScore >= 80 ? "↑" : adoptionScore >= 60 ? "→" : "↓",
                      trendColor: adoptionScore >= 80 ? "text-green-600" : adoptionScore >= 60 ? "text-amber-600" : "text-red-600",
                      risks: [
                        adoptionScore < 70 ? "Below-average active user rate" : null,
                        !v.allUsersLicensed ? "Not all users are licensed" : null,
                      ].filter(Boolean) as string[],
                      opportunities: [
                        "Run adoption workshops for Teams and SharePoint",
                        "Identify power users as internal champions",
                      ],
                      recommendation: adoptionScore < 60 ? "Low adoption indicates unused licences and missed value. An adoption programme with Shane can accelerate uptake." : "Adoption is reasonable. Focus on driving advanced feature use — Teams Channels, SharePoint sites, and OneDrive.",
                    },
                  ];

                  function ringColor(s: number) { return s >= 80 ? "#22c55e" : s >= 55 ? "#f59e0b" : "#ef4444"; }
                  function ringBg(s: number)    { return s >= 80 ? "bg-green-50 border-green-200" : s >= 55 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"; }

                  return cards.map(card => {
                    const r = 32;
                    const circ = 2 * Math.PI * r;
                    const dash = (card.score / 100) * circ;
                    return (
                      <div key={card.label} className={`border rounded-2xl p-5 ${ringBg(card.score)}`}>
                        <div className="flex items-start gap-4">
                          <div className="flex-shrink-0 w-20 h-20 relative flex items-center justify-center">
                            <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
                              <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
                              <circle cx="40" cy="40" r={r} fill="none" stroke={ringColor(card.score)} strokeWidth="8"
                                strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-lg font-extrabold text-[#0A2540]">{card.score}</span>
                              <span className="text-[9px] text-gray-400 font-semibold">/ 100</span>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <h3 className="text-sm font-bold text-[#0A2540]">{card.label}</h3>
                              <span className={`text-base font-bold ${card.trendColor}`}>{card.trend}</span>
                              <button
                                type="button"
                                onClick={() => switchTab(card.tab)}
                                className="ml-auto text-[10px] font-semibold text-[#0078D4] hover:text-[#005fa3] transition-colors flex items-center gap-0.5"
                              >
                                Update data →
                              </button>
                            </div>
                            {card.risks.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-1">Top Risks</p>
                                <ul className="space-y-0.5">
                                  {card.risks.slice(0, 3).map(r => (
                                    <li key={r} className="text-xs text-red-700 flex items-start gap-1">
                                      <span className="mt-0.5 flex-shrink-0">•</span>{r}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {card.opportunities.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] font-bold text-[#0078D4] uppercase tracking-wide mb-1">Opportunities</p>
                                <ul className="space-y-0.5">
                                  {card.opportunities.slice(0, 2).map(o => (
                                    <li key={o} className="text-xs text-[#0078D4] flex items-start gap-1">
                                      <span className="mt-0.5 flex-shrink-0">→</span>{o}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <p className="text-xs text-gray-500 italic leading-relaxed">{card.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
                <p className="text-xs text-gray-400 text-center pt-2">Scores are derived from your M365 Profile responses. Complete more sections for accurate scoring.</p>
              </div>
            )}

          </form>
        )}
      </div>
    </PortalLayout>
  );
}
