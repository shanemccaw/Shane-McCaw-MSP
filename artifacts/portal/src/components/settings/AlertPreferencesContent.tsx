import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, CreditCard, GitBranch, Headset, Plus, Search, ShieldAlert, TrendingUp, Wrench, X } from "lucide-react";

import {
  useAlertPreferencesLive,
} from "@/components/settingsAlertsLive";
import {
  ALERT_CATEGORIES,
  type AlertCategory,
  type AlertCategoryPref,
  type AlertDigestMode,
  type AlertRecipient,
  type AlertRule,
  type AlertSettings,
} from "@/components/settingsAlertsWire";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const ACCENT = "#0078D4";
const CAUTION = "#c2a63d";
const RED = "#f87171";

/**
 * Real, hand-written product copy per category — carried verbatim from
 * `Design/portal/design_handoff_full_site/screens/Portal Alerts.dc.html`'s
 * own `thrDesc` field (docs/portal/alert_preferences.md's own "Requested"
 * note: the full per-category threshold option list isn't backed by any real
 * route, so the stored `threshold` string is shown as a read-only chip with
 * this static description rather than an invented dropdown of options).
 */
const CATEGORY_META: Record<AlertCategory, { label: string; icon: typeof Search; thresholdDesc: string }> = {
  findings: { label: "Findings", icon: Search, thresholdDesc: "high-severity findings and above" },
  drift: { label: "Drift", icon: GitBranch, thresholdDesc: "only changes for the worse" },
  progress: { label: "Progress", icon: TrendingUp, thresholdDesc: "per-category batch value" },
  reviews: { label: "Reviews", icon: Clock, thresholdDesc: "days before a review is due" },
  remediation: { label: "Remediation", icon: Wrench, thresholdDesc: "only tasks waiting on you" },
  billing: { label: "Billing", icon: CreditCard, thresholdDesc: "every billing event" },
  support: { label: "Support", icon: Headset, thresholdDesc: "only your own tickets" },
};

const MODE_LABEL: Record<AlertDigestMode, string> = { immediate: "Immediate", daily: "Daily", weekly: "Weekly" };

const SEVERITY_STYLE: Record<string, { ink: string; dotBg: string; dotBorder: string }> = {
  critical: { ink: "#f87171", dotBg: "#f87171", dotBorder: "rgba(248,113,113,.6)" },
  warning: { ink: "#fbbf24", dotBg: "#fbbf24", dotBorder: "rgba(251,191,36,.6)" },
  info: { ink: "#94a3b8", dotBg: "#94a3b8", dotBorder: "rgba(148,163,184,.6)" },
};

function emptyRecipient(): { email: string; role: string } {
  return { email: "", role: "" };
}

export function AlertPreferencesContent() {
  const { dataState, profile, rules, saving, error, save, reload } = useAlertPreferencesLive();

  const [categories, setCategories] = useState<Record<AlertCategory, AlertCategoryPref> | null>(null);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [recipients, setRecipients] = useState<readonly AlertRecipient[]>([]);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [newRecipient, setNewRecipient] = useState(emptyRecipient());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setCategories(profile.categories);
    setSettings(profile.settings);
    setRecipients(profile.recipients);
  }, [profile]);

  const dirty = useMemo(() => {
    if (!profile || !categories || !settings) return false;
    const catsChanged = ALERT_CATEGORIES.some((cat) => {
      const a = categories[cat];
      const b = profile.categories[cat];
      return a.enabled !== b.enabled || a.emailEnabled !== b.emailEnabled || a.mode !== b.mode;
    });
    const settingsChanged =
      settings.quietHoursEnabled !== profile.settings.quietHoursEnabled ||
      settings.quietHoursFrom !== profile.settings.quietHoursFrom ||
      settings.quietHoursTo !== profile.settings.quietHoursTo ||
      settings.quietBreakForCritical !== profile.settings.quietBreakForCritical;
    const recipientsChanged = JSON.stringify(recipients) !== JSON.stringify(profile.recipients);
    return catsChanged || settingsChanged || recipientsChanged;
  }, [profile, categories, settings, recipients]);

  const rulesByCategory = useMemo(() => {
    const map = new Map<string, AlertRule[]>();
    for (const rule of rules) {
      const list = map.get(rule.alertCategory) ?? [];
      list.push(rule);
      map.set(rule.alertCategory, list);
    }
    return map;
  }, [rules]);

  if (dataState === "loading") {
    return (
      <div className="flex flex-col gap-2.5 p-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[120px] animate-pulse rounded-2xl" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} />
        ))}
      </div>
    );
  }

  if (dataState === "failed" || !categories || !settings) {
    return (
      <div className="flex gap-2.5 rounded-xl border border-dashed p-3.5" style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="alert-preferences-error">
        <AlertTriangle className="mt-0.5 size-[15px] flex-none" color={RED} strokeWidth={1.75} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">Unable to load alert preferences right now. Please try again shortly.</span>
          <button type="button" onClick={() => void reload()} className="w-fit pt-0.5 text-[11.5px] font-semibold" style={{ color: "#60a5fa" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const patchCategory = (cat: AlertCategory, patch: Partial<AlertCategoryPref>) => {
    setCategories((prev) => (prev ? { ...prev, [cat]: { ...prev[cat], ...patch } } : prev));
  };

  const doSave = async () => {
    if (!categories || !settings) return;
    setSaveError(null);
    const ok = await save(categories, settings, recipients);
    if (ok) {
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 3200);
    } else {
      setSaveError(error ?? "Unable to save alert preferences right now. Please try again shortly.");
    }
  };

  const doReset = () => {
    if (!profile) return;
    setCategories(profile.categories);
    setSettings(profile.settings);
    setRecipients(profile.recipients);
    setSaveError(null);
  };

  const addRecipient = () => {
    const email = newRecipient.email.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setRecipients((prev) => [...prev, { email, role: newRecipient.role.trim() || null, scopeCategories: null }]);
    setNewRecipient(emptyRecipient());
    setAddingRecipient(false);
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r.email !== email));
  };

  return (
    <div className="flex flex-col gap-4" data-testid="alert-preferences-content">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xl font-bold tracking-tight text-foreground">Alert preferences</span>
          <span className="text-[12.5px]" style={{ color: dirty ? CAUTION : "#64748b" }}>
            {dirty
              ? "Unsaved changes"
              : profile?.settings.updatedAt
                ? `Saved${profile.settings.updatedByName ? ` by ${profile.settings.updatedByName}` : ""}`
                : "Running on the Balanced defaults — nothing saved yet"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={doReset}
            disabled={!dirty}
            className="rounded-md border px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40"
            style={{ borderColor: "rgba(255,255,255,.14)", color: "#94a3b8" }}
          >
            Reset to Balanced
          </button>
          <button
            type="button"
            onClick={() => void doSave()}
            disabled={!dirty || saving}
            className="rounded-md px-5 py-2 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: dirty ? ACCENT : "rgba(255,255,255,.06)" }}
            data-testid="alert-preferences-save"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {saveError ? (
        <div className="flex gap-2.5 rounded-xl border border-dashed p-3" style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}>
          <AlertTriangle className="mt-0.5 size-[14px] flex-none" color={RED} strokeWidth={1.75} />
          <span className="text-[12px] text-muted-foreground">{saveError}</span>
        </div>
      ) : null}

      {savedToast ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "rgba(0,180,216,.45)", background: "rgba(0,180,216,.06)", color: "#cbd5e1" }}>
          Preferences saved
        </div>
      ) : null}

      <div className="grid gap-[18px] items-start" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(260px,1fr)" }}>
        <div className="flex flex-col gap-3">
          {ALERT_CATEGORIES.map((cat) => {
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            const pref = categories[cat];
            const catRules = rulesByCategory.get(cat) ?? [];
            const liveCount = catRules.filter((r) => r.detectorStatus === "live").length;
            return (
              <div key={cat} className="flex flex-col rounded-[14px] px-[18px] pb-[14px] pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
                <div className="flex items-center gap-[11px]">
                  <div className="flex size-[30px] flex-none items-center justify-center rounded-[8px]" style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${HAIRLINE}` }}>
                    <Icon size={15} strokeWidth={1.75} color="#94a3b8" />
                  </div>
                  <div className="flex flex-col gap-[1px]">
                    <span className="text-[13.5px] font-semibold text-[#f8fafc]">{meta.label}</span>
                    <span className="text-[11px] text-[#64748b]">
                      {catRules.length > 0 ? `${catRules.length} ${catRules.length === 1 ? "rule" : "rules"} · ${liveCount} live` : "No rules published yet"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => patchCategory(cat, { enabled: !pref.enabled })}
                    className="ml-auto h-[17px] w-[30px] flex-none rounded-full transition-colors"
                    style={{ background: pref.enabled ? ACCENT : "rgba(255,255,255,.14)" }}
                    data-testid={`alert-pref-${cat}-toggle`}
                  >
                    <span className="block size-[13px] rounded-full bg-white transition-transform" style={{ transform: `translateX(${pref.enabled ? 15 : 2}px)` }} />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-[9px]" style={{ marginTop: 12, opacity: pref.enabled ? 1 : 0.4, pointerEvents: pref.enabled ? "auto" : "none" }}>
                  <button
                    type="button"
                    onClick={() => patchCategory(cat, { emailEnabled: !pref.emailEnabled })}
                    className="flex items-center gap-[6px] rounded-full px-3 py-[5px] text-[11.5px] font-semibold"
                    style={{
                      color: pref.emailEnabled ? "#00B4D8" : "#94a3b8",
                      border: `1px solid ${pref.emailEnabled ? "rgba(0,180,216,.35)" : "rgba(255,255,255,.10)"}`,
                      background: pref.emailEnabled ? "rgba(0,180,216,.07)" : "transparent",
                    }}
                  >
                    {pref.emailEnabled ? "Emailing" : "Email off"}
                  </button>
                  <div className="flex overflow-hidden rounded-[8px]" style={{ border: `1px solid ${HAIRLINE}` }}>
                    {(["immediate", "daily", "weekly"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => patchCategory(cat, { mode: m })}
                        className="px-[13px] py-[5px] text-[11.5px] font-semibold"
                        style={{ color: pref.mode === m ? "#f8fafc" : "#94a3b8", background: pref.mode === m ? "rgba(0,120,212,.28)" : "transparent" }}
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <span className="flex items-center gap-[7px] rounded-full py-[5px] pl-[10px] pr-3 text-[11.5px]" style={{ border: `1px solid ${HAIRLINE}`, color: "#94a3b8" }}>
                    <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".1em" }}>THRESHOLD</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: "#00B4D8" }}>{pref.threshold || "—"}</span>
                    <span style={{ color: "#64748b" }}>{meta.thresholdDesc}</span>
                  </span>
                </div>

                {catRules.length > 0 ? (
                  <div className="flex flex-wrap gap-[7px]" style={{ marginTop: 12, opacity: pref.enabled ? 1 : 0.4 }}>
                    {catRules.map((r) => {
                      const sev = SEVERITY_STYLE[r.severity] ?? SEVERITY_STYLE.info!;
                      const pending = r.detectorStatus !== "live";
                      return (
                        <span
                          key={r.ruleKey}
                          className="flex items-center gap-[7px] rounded-full px-[11px] py-1 text-[11.5px]"
                          style={{ color: sev.ink, border: `1px ${pending ? "dashed" : "solid"} ${pending ? "rgba(251,191,36,.4)" : "rgba(255,255,255,.08)"}` }}
                        >
                          <span className="size-[7px] rounded-full" style={{ background: sev.dotBg, border: `1.5px solid ${sev.dotBorder}` }} />
                          {r.label}
                          {pending ? (
                            <span className="rounded-full px-[7px] py-[2px] text-[8.5px] font-bold" style={{ color: "#fbbf24", border: "1px dashed rgba(251,191,36,.55)", letterSpacing: ".07em" }}>
                              NO DETECTOR YET — CAN'T FIRE
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {cat === "findings" ? (
                  <div className="flex items-start gap-2 pt-[11px]" style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,.06)" }}>
                    <ShieldAlert className="mt-[1px] size-[13px] flex-none" color="#64748b" strokeWidth={1.75} />
                    <span className="text-[11.5px] leading-[1.5] text-[#64748b]">
                      Findings you've accepted in the risk register don't alert while the risk decision is active — suppression happens at evaluation, so no count is shown here.
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col rounded-[14px] px-[18px] pb-4 pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex items-center gap-[10px]">
              <Clock size={15} strokeWidth={1.75} color="#94a3b8" />
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Quiet hours</span>
              <button
                type="button"
                onClick={() => setSettings((s) => (s ? { ...s, quietHoursEnabled: !s.quietHoursEnabled } : s))}
                className="ml-auto h-[17px] w-[30px] flex-none rounded-full transition-colors"
                style={{ background: settings.quietHoursEnabled ? ACCENT : "rgba(255,255,255,.14)" }}
              >
                <span className="block size-[13px] rounded-full bg-white transition-transform" style={{ transform: `translateX(${settings.quietHoursEnabled ? 15 : 2}px)` }} />
              </button>
            </div>
            <div style={{ opacity: settings.quietHoursEnabled ? 1 : 0.4 }}>
              <div className="flex items-center gap-2" style={{ marginTop: 13 }}>
                <input
                  type="time"
                  value={settings.quietHoursFrom}
                  onChange={(e) => setSettings((s) => (s ? { ...s, quietHoursFrom: e.target.value } : s))}
                  className="rounded-md bg-transparent px-[10px] py-1 text-[12px] font-bold tabular-nums"
                  style={{ border: `1px solid ${HAIRLINE}`, color: "#cbd5e1" }}
                />
                <span className="text-[#475569]">→</span>
                <input
                  type="time"
                  value={settings.quietHoursTo}
                  onChange={(e) => setSettings((s) => (s ? { ...s, quietHoursTo: e.target.value } : s))}
                  className="rounded-md bg-transparent px-[10px] py-1 text-[12px] font-bold tabular-nums"
                  style={{ border: `1px solid ${HAIRLINE}`, color: "#cbd5e1" }}
                />
                <span className="text-[11px] text-[#64748b]">overnight</span>
              </div>
              <label className="flex items-center gap-[8px] pt-[13px] text-[11.5px]" style={{ color: "#94a3b8" }}>
                <input
                  type="checkbox"
                  checked={settings.quietBreakForCritical}
                  onChange={(e) => setSettings((s) => (s ? { ...s, quietBreakForCritical: e.target.checked } : s))}
                />
                Critical alerts break through — deliver immediately even overnight
              </label>
            </div>
          </div>

          <div className="flex flex-col rounded-[14px] px-[18px] pb-4 pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">Additional recipients</span>
            <span className="text-[12px]" style={{ marginTop: 10, color: "#64748b" }}>
              {profile?.primaryRecipient.email ? `Always reaches you (${profile.primaryRecipient.email})` : "Always reaches you"}
            </span>
            {recipients.length > 0 ? (
              <div className="flex flex-col gap-[6px]" style={{ marginTop: 10 }}>
                {recipients.map((r) => (
                  <div key={r.email} className="flex items-center gap-2 rounded-md px-[10px] py-[7px]" style={{ border: `1px solid ${HAIRLINE}` }}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[11.5px] text-[#e2e8f0]">{r.email}</span>
                      <span className="text-[10.5px] text-[#64748b]">{r.role ?? "No role set"} · {r.scopeCategories ? `${r.scopeCategories.length} categories` : "all categories"}</span>
                    </div>
                    <button type="button" onClick={() => removeRecipient(r.email)} className="ml-auto flex-none" aria-label={`Remove ${r.email}`}>
                      <X size={13} color="#64748b" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {addingRecipient ? (
              <div className="flex flex-col gap-[8px]" style={{ marginTop: 11 }}>
                <input
                  value={newRecipient.email}
                  onChange={(e) => setNewRecipient((r) => ({ ...r, email: e.target.value }))}
                  placeholder="name@company.com"
                  className="rounded-md bg-transparent px-[10px] py-[7px] text-[12px] outline-none"
                  style={{ border: `1px solid ${HAIRLINE}`, color: "#e2e8f0" }}
                />
                <input
                  value={newRecipient.role}
                  onChange={(e) => setNewRecipient((r) => ({ ...r, role: e.target.value }))}
                  placeholder="Role (optional)"
                  className="rounded-md bg-transparent px-[10px] py-[7px] text-[12px] outline-none"
                  style={{ border: `1px solid ${HAIRLINE}`, color: "#e2e8f0" }}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setAddingRecipient(false); setNewRecipient(emptyRecipient()); }} className="rounded-md px-3 py-[6px] text-[11.5px]" style={{ border: `1px solid ${HAIRLINE}`, color: "#94a3b8" }}>
                    Cancel
                  </button>
                  <button type="button" onClick={addRecipient} className="ml-auto rounded-md px-3 py-[6px] text-[11.5px] font-semibold text-white" style={{ background: ACCENT }}>
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingRecipient(true)}
                className="flex items-center justify-center gap-[7px] rounded-lg border border-dashed py-[9px]"
                style={{ marginTop: 11, borderColor: "rgba(148,163,184,.3)", color: "#94a3b8" }}
              >
                <Plus size={13} strokeWidth={2} /> Add recipient
              </button>
            )}
            <span className="text-[11px] leading-[1.5]" style={{ marginTop: 10, color: "#475569" }}>
              Each recipient carries a role and can be scoped to specific categories — unscoped means all categories.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
