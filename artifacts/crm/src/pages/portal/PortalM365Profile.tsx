import { useState, useEffect, useCallback } from "react";
import { useForm, Controller, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

// ── Zod schema ────────────────────────────────────────────────────────────────
// Boolean fields use z.boolean().optional() so that undefined = "not yet answered"
// and false = "explicitly answered No". This lets the completion badge treat both
// true and false as filled, while truly unanswered fields remain incomplete.

const m365Schema = z.object({
  orgName:              z.string().default(""),
  industry:             z.string().default(""),
  employeeCount:        z.string().default(""),
  licensedUserCount:    z.string().default(""),
  itContactName:        z.string().default(""),
  itContactEmail:       z.string().default(""),
  tenantDomain:         z.string().default(""),
  isMicrosoftPartner:   z.boolean().optional(),

  licenseSKUs:          z.array(z.string()).default([]),
  allUsersLicensed:     z.boolean().optional(),
  activeUserPercent:    z.string().default(""),
  usesExchange:         z.boolean().optional(),
  usesTeams:            z.boolean().optional(),
  usesSharePoint:       z.boolean().optional(),
  usesOneDrive:         z.boolean().optional(),
  usesYammer:           z.boolean().optional(),

  sharepointSiteCount:  z.string().default(""),
  teamCount:            z.string().default(""),
  securityGroupCount:   z.string().default(""),
  externalSharingEnabled: z.boolean().optional(),
  guestUsersPresent:    z.boolean().optional(),
  authMethod:           z.string().default(""),
  isHybrid:             z.boolean().optional(),
  hasOnPremExchange:    z.boolean().optional(),
  usesAADConnect:       z.boolean().optional(),

  mfaEnforced:                z.boolean().optional(),
  conditionalAccessEnabled:   z.boolean().optional(),
  intuneEnabled:              z.boolean().optional(),
  hasAADP1orP2:               z.boolean().optional(),
  hasDefender:                z.boolean().optional(),
  hasDLP:                     z.boolean().optional(),
  usesComplianceCenter:       z.boolean().optional(),
  sensitivityLabelsConfigured: z.boolean().optional(),
  hasRetentionPolicies:       z.boolean().optional(),
  hasInsiderRisk:             z.boolean().optional(),

  hasCopilotLicenses:         z.boolean().optional(),
  copilotLicenseCount:        z.string().default(""),
  copilotUseCase:             z.string().default(""),
  currentAITools:             z.string().default(""),
  dataGovernanceConcerns:     z.string().default(""),
  copilotReadinessScore:      z.string().default(""),
  copilotBlockedBy:           z.string().default(""),

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
// Boolean: answered (true OR false) = 1 point; undefined = 0.
// String: non-empty = 1 point.
// Array: length > 0 = 1 point.

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

const TOTAL_FIELDS = STRING_FIELDS.length + BOOL_FIELDS.length + 1; // +1 for licenseSKUs

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

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "org",      label: "Organization" },
  { id: "licensing", label: "Licensing & Apps" },
  { id: "security", label: "Security & Compliance" },
  { id: "copilot",  label: "Copilot Readiness" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── Small UI helpers ──────────────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const inputClass =
  "w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors";

function Toggle({ value, onChange, label }: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const isAnswered = value !== undefined;
  const checked = value === true;

  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
          !isAnswered ? "bg-gray-200 border-2 border-dashed border-gray-300" :
          checked ? "bg-[#0078D4]" : "bg-gray-200"
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </div>
      <span className="text-sm text-[#0A2540] group-hover:text-[#0078D4] transition-colors flex-1">{label}</span>
      {!isAnswered && (
        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
          Not answered
        </span>
      )}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-[#0A2540]">{title}</h3>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
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

type AlertState = { type: "success" | "error"; message: string } | null;

// ── Page component ────────────────────────────────────────────────────────────

export default function PortalM365Profile() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);
  const [activeTab, setActiveTab] = useState<TabId>("org");

  const form = useForm<FormValues>({
    resolver: zodResolver(m365Schema),
    defaultValues: m365Schema.parse({}),
  });
  const { control, register, handleSubmit, watch, setValue, reset } = form;

  // Watch all values for live completion badge
  const values = watch();
  const completion = computeCompletion(values);

  // ── Load existing profile ────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/m365-profile").then(r => r.json() as Promise<Record<string, unknown>>),
      fetchWithAuth("/api/portal/profile").then(r => r.json() as Promise<{ company?: string | null }>),
    ])
      .then(([m365Data, profileData]) => {
        // Build defaults, only overriding keys that actually exist in the response
        // so boolean fields remain `undefined` if not yet answered
        const merged: Partial<FormValues> = { ...m365Schema.parse({}) };
        for (const key of Object.keys(m365Data)) {
          const k = key as keyof FormValues;
          const v = m365Data[key];
          if (v !== null && v !== undefined) {
            if (Array.isArray(v)) {
              (merged as Record<string, unknown>)[k] = v;
            } else {
              (merged as Record<string, unknown>)[k] = v;
            }
          }
          // Booleans explicitly set to false must still be preserved
          if (typeof v === "boolean") {
            (merged as Record<string, unknown>)[k] = v;
          }
        }
        // Pre-fill Organisation Name from checkout company if not already saved
        if (!merged.orgName && profileData.company) {
          merged.orgName = profileData.company;
        }
        reset(merged as FormValues);
      })
      .catch(() => setAlert({ type: "error", message: "Could not load your profile. Please refresh." }))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, reset]);

  // ── Save handler ─────────────────────────────────────────────────────────

  const onSubmit = useCallback(async (data: FormValues) => {
    setSaving(true);
    setAlert(null);
    // Strip undefined boolean values so the server stores only explicit answers
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

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#0A2540]">M365 Environment Profile</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Help Shane understand your Microsoft 365 environment so he can tailor your engagement.
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-xs font-semibold text-muted-foreground mb-1">Completion</div>
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

            {/* Tab strip */}
            <div className="flex gap-1 mb-6 bg-white border border-border rounded-2xl p-1.5 overflow-x-auto">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 text-xs font-semibold px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? "bg-[#0078D4] text-white shadow"
                      : "text-muted-foreground hover:text-[#0A2540]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Organization ────────────────────────────────────────────── */}
            {activeTab === "org" && (
              <div className="space-y-4">
                <Section title="Organization Overview">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Organization Name">
                      <input {...register("orgName")} placeholder="Acme Corp" className={inputClass} />
                    </Field>
                    <Field label="Industry">
                      <input {...register("industry")} placeholder="e.g. Healthcare, Finance" className={inputClass} />
                    </Field>
                    <Field label="Total Employees">
                      <input {...register("employeeCount")} placeholder="e.g. 250" className={inputClass} />
                    </Field>
                    <Field label="Licensed M365 Users">
                      <input {...register("licensedUserCount")} placeholder="e.g. 200" className={inputClass} />
                    </Field>
                    <Field label="Tenant Domain" hint="Your primary *.onmicrosoft.com or custom domain">
                      <input {...register("tenantDomain")} placeholder="contoso.onmicrosoft.com" className={inputClass} />
                    </Field>
                  </div>
                  <BoolController name="isMicrosoftPartner" control={control} label="We are a Microsoft partner" />
                </Section>

                <Section title="IT Contact">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="IT Contact Name">
                      <input {...register("itContactName")} placeholder="Jane Smith" className={inputClass} />
                    </Field>
                    <Field label="IT Contact Email">
                      <input {...register("itContactEmail")} type="email" placeholder="it@acme.com" className={inputClass} />
                    </Field>
                  </div>
                </Section>

                <Section title="Engagement Details">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Decision Maker Name">
                      <input {...register("decisionMakerName")} placeholder="John Doe" className={inputClass} />
                    </Field>
                    <Field label="Decision Maker Email">
                      <input {...register("decisionMakerEmail")} type="email" placeholder="cto@acme.com" className={inputClass} />
                    </Field>
                    <Field label="Engagement Type">
                      <input {...register("engagementType")} placeholder="e.g. Assessment, Deployment, Retainer" className={inputClass} />
                    </Field>
                    <Field label="Budget Range">
                      <input {...register("budgetRange")} placeholder="e.g. $10k–$25k" className={inputClass} />
                    </Field>
                    <Field label="Engagement Start Date">
                      <input {...register("engagementStartDate")} type="date" className={inputClass} />
                    </Field>
                    <Field label="Estimated Duration">
                      <input {...register("estimatedDuration")} placeholder="e.g. 3 months, 6 weeks" className={inputClass} />
                    </Field>
                    <Field label="How did you hear about us?">
                      <input {...register("referralSource")} placeholder="e.g. LinkedIn, Referral" className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Business Goals">
                    <textarea
                      {...register("businessGoals")}
                      placeholder="Describe what you'd like to achieve with this engagement…"
                      rows={3}
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                  <Field label="Known Blockers">
                    <textarea
                      {...register("knownBlockers")}
                      placeholder="Any known blockers, constraints, or concerns…"
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                </Section>

                {saveButton}
              </div>
            )}

            {/* ── Licensing & Apps ─────────────────────────────────────────── */}
            {activeTab === "licensing" && (
              <div className="space-y-4">
                <Section title="License SKUs">
                  <Field label="License SKUs (comma-separated)" hint="e.g. Microsoft 365 E3, Microsoft 365 E5, Teams Essentials">
                    <Controller
                      name="licenseSKUs"
                      control={control}
                      render={({ field }) => (
                        <input
                          type="text"
                          value={(field.value ?? []).join(", ")}
                          onChange={e => field.onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                          placeholder="Microsoft 365 E3, Copilot for M365"
                          className={inputClass}
                        />
                      )}
                    />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Active User Percentage">
                      <input {...register("activeUserPercent")} placeholder="e.g. 75%" className={inputClass} />
                    </Field>
                  </div>
                  <BoolController name="allUsersLicensed" control={control} label="All users are fully licensed" />
                </Section>

                <Section title="Apps in Use">
                  <div className="space-y-3">
                    <BoolController name="usesExchange"   control={control} label="Exchange Online / email" />
                    <BoolController name="usesTeams"      control={control} label="Microsoft Teams" />
                    <BoolController name="usesSharePoint" control={control} label="SharePoint Online" />
                    <BoolController name="usesOneDrive"   control={control} label="OneDrive for Business" />
                    <BoolController name="usesYammer"     control={control} label="Viva Engage / Yammer" />
                  </div>
                </Section>

                <Section title="Environment Structure">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label="SharePoint Sites">
                      <input {...register("sharepointSiteCount")} placeholder="e.g. 40" className={inputClass} />
                    </Field>
                    <Field label="Teams Count">
                      <input {...register("teamCount")} placeholder="e.g. 120" className={inputClass} />
                    </Field>
                    <Field label="Security Groups">
                      <input {...register("securityGroupCount")} placeholder="e.g. 30" className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Authentication Method" hint="e.g. Cloud-only, Hybrid AD, ADFS, PTA">
                    <input {...register("authMethod")} placeholder="Cloud-only" className={inputClass} />
                  </Field>
                  <div className="space-y-3">
                    <BoolController name="externalSharingEnabled" control={control} label="External sharing is enabled" />
                    <BoolController name="guestUsersPresent"      control={control} label="Guest / external users are present" />
                    <BoolController name="isHybrid"               control={control} label="Hybrid identity (on-prem AD)" />
                    <BoolController name="hasOnPremExchange"      control={control} label="On-premises Exchange server" />
                    <BoolController name="usesAADConnect"         control={control} label="Microsoft Entra Connect / AAD Connect in use" />
                  </div>
                </Section>

                {saveButton}
              </div>
            )}

            {/* ── Security & Compliance ────────────────────────────────────── */}
            {activeTab === "security" && (
              <div className="space-y-4">
                <Section title="Identity & Access">
                  <div className="space-y-3">
                    <BoolController name="mfaEnforced"              control={control} label="MFA is enforced for all users" />
                    <BoolController name="conditionalAccessEnabled"  control={control} label="Conditional Access policies are in place" />
                    <BoolController name="intuneEnabled"             control={control} label="Intune / device management enabled" />
                    <BoolController name="hasAADP1orP2"             control={control} label="Azure AD Premium P1 or P2 licensed" />
                  </div>
                </Section>

                <Section title="Threat Protection & Compliance">
                  <div className="space-y-3">
                    <BoolController name="hasDefender"                  control={control} label="Microsoft Defender for Office 365 enabled" />
                    <BoolController name="hasDLP"                       control={control} label="Data Loss Prevention (DLP) policies configured" />
                    <BoolController name="usesComplianceCenter"         control={control} label="Microsoft Purview / Compliance Center in use" />
                    <BoolController name="sensitivityLabelsConfigured"  control={control} label="Sensitivity labels configured" />
                    <BoolController name="hasRetentionPolicies"         control={control} label="Retention policies in place" />
                    <BoolController name="hasInsiderRisk"               control={control} label="Insider Risk Management enabled" />
                  </div>
                </Section>

                {saveButton}
              </div>
            )}

            {/* ── Copilot Readiness ────────────────────────────────────────── */}
            {activeTab === "copilot" && (
              <div className="space-y-4">
                <Section title="Copilot for Microsoft 365">
                  <BoolController name="hasCopilotLicenses" control={control} label="We have Copilot for M365 licenses" />
                  {values.hasCopilotLicenses === true && (
                    <Field label="Copilot License Count">
                      <input {...register("copilotLicenseCount")} placeholder="e.g. 50" className={inputClass} />
                    </Field>
                  )}
                  <Field label="Primary Copilot Use Cases" hint="Which scenarios are you targeting?">
                    <textarea
                      {...register("copilotUseCase")}
                      placeholder="e.g. Meeting summaries, document drafting, data analysis in Excel…"
                      rows={3}
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                </Section>

                <Section title="AI & Data Readiness">
                  <Field label="Current AI Tools in Use" hint="Any AI tools your org already uses">
                    <input {...register("currentAITools")} placeholder="e.g. ChatGPT, GitHub Copilot, custom AI tools" className={inputClass} />
                  </Field>
                  <Field label="Data Governance Concerns">
                    <textarea
                      {...register("dataGovernanceConcerns")}
                      placeholder="Oversharing risks, sensitive data exposure, regulatory requirements…"
                      rows={3}
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                  <Field label="Known Blockers to Copilot Adoption">
                    <textarea
                      {...register("copilotBlockedBy")}
                      placeholder="e.g. Overshared sites, missing labels, compliance gaps…"
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                  {values.copilotReadinessScore && (
                    <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-xl px-4 py-3">
                      <p className="text-xs text-muted-foreground mb-0.5">Copilot Readiness Score (set by Shane)</p>
                      <p className="text-sm font-bold text-[#0078D4]">{values.copilotReadinessScore}</p>
                    </div>
                  )}
                </Section>

                {saveButton}
              </div>
            )}
          </form>
        )}
      </div>
    </PortalLayout>
  );
}
