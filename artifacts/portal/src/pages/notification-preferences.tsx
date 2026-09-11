import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { comingSoonHref } from "@/components/shell/moduleNav";

interface Preference {
  category: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

type PrefMap = Record<string, { inAppEnabled: boolean; emailEnabled: boolean }>;

function toMap(list: Preference[]): PrefMap {
  const map: PrefMap = {};
  for (const p of list) map[p.category] = { inAppEnabled: p.inAppEnabled, emailEnabled: p.emailEnabled };
  return map;
}

// Human-readable label/description per category — carried forward verbatim
// from the archived page's own CATEGORY_INFO (per CLAUDE.md "copy is final";
// contract pack §3 confirms this is real, hand-written product copy with no
// backend source, and matches the 15-key KNOWN_CATEGORIES vocabulary
// (notification-preferences.ts:26 / notifications.ts:12-28) key-for-key).
const CATEGORY_ORDER = [
  "fulfillment", "payment", "security", "ai", "sow", "signal", "message",
  "system", "lead", "dunning", "consent", "automation", "project", "onboarding", "offer",
] as const;

const CATEGORY_INFO: Record<string, { label: string; description: string }> = {
  fulfillment: { label: "Fulfillment", description: "Work items and deliverables completed for you" },
  payment: { label: "Payment", description: "Invoices, charges, and payment confirmations" },
  security: { label: "Security", description: "Security findings and alerts from your monitoring" },
  ai: { label: "AI Insights", description: "AI-generated analysis and recommendations" },
  sow: { label: "Statements of Work", description: "SOW updates, approvals, and signatures" },
  signal: { label: "Signals", description: "Monitoring signals detected on your environment" },
  message: { label: "Messages", description: "New messages from your account team" },
  system: { label: "System", description: "General platform and account notices" },
  lead: { label: "Leads", description: "New lead activity related to your account" },
  dunning: { label: "Billing Reminders", description: "Past-due or upcoming payment reminders" },
  consent: { label: "Consent", description: "Changes to Microsoft 365 tenant consent status" },
  automation: { label: "Automation", description: "Automated workflow runs on your behalf" },
  project: { label: "Projects", description: "Project status and milestone updates" },
  onboarding: { label: "Onboarding", description: "Setup and onboarding progress updates" },
  offer: { label: "Offers", description: "Remediation and service offers for you" },
};

// "What this page deliberately does not do" — real, contract-pack-derived
// facts about this surface (docs/portal/notification-preferences-contract-pack.md
// §2/§3/§5/§6/§8/§10), not fetched data. Copy is final per CLAUDE.md.
const LEDGER: { gap: string; where: string }[] = [
  { gap: "No record of what a muted category suppressed. A suppressed notification is never created, so there is nothing to look back at — only the absence of what would have appeared.", where: "§10" },
  { gap: "No digest or cadence. Every enabled category emails immediately; batching belongs to monitoring alerts, not here.", where: "§10" },
  { gap: "No confirmation of what was stored. Saving reports success without reading the values back, so the list you see is what you set rather than what the server returned.", where: "§2" },
  { gap: "No signal when an email fails. Delivery is attempted once and failures are logged on our side only.", where: "§6" },
  { gap: "No effect on what your MSP sees. Muting a category hides it from you, not from them.", where: "§5" },
  { gap: "No separate webhook switch. Webhook delivery for a category rides on its in-app setting and cannot be kept on independently.", where: "§5" },
  { gap: "No shared ground with monitoring alert preferences. Two deliberately separate lists; nothing here reads or writes anything there.", where: "§8" },
  { gap: "No per-severity control. A category is on or off as a whole — there is no way to keep only the urgent ones.", where: "§3" },
];

const HAIRLINE = "rgba(255,255,255,.09)";
const ACCENT = "#0078D4";
const CAUTION = "#c2a63d";

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * The reusable content of the Notification Preferences screen (#2992, real
 * design landed in Design/portal/design_handoff_full_site/screens/
 * Notification Preferences.dc.html) — split out from the page wrapper below
 * so a future Settings-container build (per UserMenu's still-`/coming-soon`
 * "Settings" row) can mount it as one panel without re-wiring the fetch
 * logic, the same way the archived customer-notifications.tsx separated
 * NotificationSettingsContent from CustomerNotificationsPage.
 *
 * Wired to the real, already-built `GET`/`PATCH /api/portal/notification-
 * preferences` (docs/portal/notification-preferences-contract-pack.md) — no
 * fixture data. Both endpoints are Customer-reachable with no other
 * role/tenant scoping (contract pack §7), matching the archived page's own
 * usage.
 */
export function NotificationPreferencesContent() {
  const { fetchWithAuth, user } = useAuth();
  const [dataState, setDataState] = useState<"loading" | "live" | "failed">("loading");
  const [order, setOrder] = useState<string[]>([]);
  const [saved, setSaved] = useState<PrefMap | null>(null);
  const [draft, setDraft] = useState<PrefMap | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setDataState("loading");
    try {
      const res = await fetchWithAuth("/api/portal/notification-preferences");
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const data = (await res.json()) as { preferences?: Preference[] };
      const list = data.preferences ?? [];
      setOrder(list.map((p) => p.category));
      setSaved(toMap(list));
      setDraft(null);
      setDataState("live");
    } catch {
      setDataState("failed");
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const cur = draft ?? saved ?? {};
  const changedCategories = saved
    ? order.filter(
        (cat) =>
          cur[cat].inAppEnabled !== saved[cat].inAppEnabled || cur[cat].emailEnabled !== saved[cat].emailEnabled,
      )
    : [];
  const allDefault =
    saved !== null &&
    changedCategories.length === 0 &&
    order.length > 0 &&
    order.every((cat) => cur[cat].inAppEnabled === true && cur[cat].emailEnabled === false);
  const mutedCount = order.filter((cat) => !cur[cat].inAppEnabled).length;
  const emailOnCount = order.filter((cat) => cur[cat].emailEnabled).length;

  const setPref = (category: string, patch: Partial<{ inAppEnabled: boolean; emailEnabled: boolean }>) => {
    setDraft((prevDraft) => {
      const base = prevDraft ?? saved ?? {};
      const next: PrefMap = {};
      for (const k of Object.keys(base)) next[k] = { ...base[k] };
      next[category] = { ...next[category], ...patch };
      if (patch.inAppEnabled === false) next[category].emailEnabled = false;
      return next;
    });
  };

  const discard = () => {
    setDraft(null);
    setSaveError(null);
  };

  const save = async () => {
    if (!draft || !saved || changedCategories.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetchWithAuth("/api/portal/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: changedCategories.map((category) => ({
            category,
            inAppEnabled: draft[category].inAppEnabled,
            emailEnabled: draft[category].emailEnabled,
          })),
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      // The route returns only { ok: true } — no re-select of persisted rows
      // (contract pack §2) — so the saved state is applied optimistically,
      // same as the archived page's own updateLocal.
      setSaved(draft);
      setDraft(null);
      setToast(true);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(false), 3200);
    } catch {
      setSaveError("Failed to save. Your changes are kept here — try again.");
    } finally {
      setSaving(false);
    }
  };

  const catMeta =
    mutedCount === 0
      ? `all reaching you · ${emailOnCount} also by email`
      : `${mutedCount} ${pluralize(mutedCount, "category", "categories")} muted · ${emailOnCount} by email`;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-4" data-testid="notification-preferences-page">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-foreground">Notification preferences</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex size-[17px] cursor-help items-center justify-center rounded-full border text-[10px] font-bold"
                style={{ borderColor: "rgba(148,163,184,.35)", color: "#64748b" }}
              >
                i
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Choose what reaches you, and whether it also goes to email. This is delivery, not detection.
            </TooltipContent>
          </Tooltip>
          <span
            className="flex items-center gap-1.5 text-[11px]"
            style={{ color: dataState === "failed" ? "#f87171" : "#64748b" }}
            data-testid="notification-preferences-status"
          >
            <span
              className="size-1.5 rounded-full"
              style={{
                background: dataState === "failed" ? "#f87171" : dataState === "loading" ? "#475569" : "#34d399",
              }}
            />
            {dataState === "loading"
              ? "Reading your preferences"
              : dataState === "failed"
                ? "Could not read your preferences"
                : `Live — ${order.length} categories`}
          </span>
        </div>

        {dataState === "loading" && (
          <div className="flex flex-col gap-[9px]">
            {[30, 24, 28, 22, 26, 31].map((w, i) => (
              <div
                key={i}
                className="flex animate-pulse flex-col gap-2 rounded-xl border p-3.5"
                style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)" }}
              >
                <div className="h-2.5 rounded-full" style={{ width: `${w}%`, background: "rgba(255,255,255,.07)" }} />
                <div className="h-2 rounded-full" style={{ width: `${w * 2}%`, background: "rgba(255,255,255,.05)" }} />
              </div>
            ))}
          </div>
        )}

        {dataState === "failed" && (
          <div
            className="flex gap-2.5 rounded-xl border border-dashed p-3.5"
            style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
            data-testid="notification-preferences-error"
          >
            <AlertTriangle className="mt-0.5 size-[15px] flex-none" color="#f87171" strokeWidth={1.75} />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">Your preferences could not be read</span>
              <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
                Nothing is listed because nothing could be fetched — not because everything is switched off. Your
                real settings are unchanged and still deciding what reaches you right now.
              </span>
              <button
                type="button"
                onClick={() => void load()}
                className="w-fit pt-0.5 text-[11.5px] font-semibold"
                style={{ color: "#60a5fa" }}
                data-testid="notification-preferences-retry"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {dataState === "live" && (
          <>
            <div className="flex flex-col gap-2 rounded-[14px] border p-4" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)" }}>
              <span className="text-[12.5px] font-semibold text-foreground">
                These settings control delivery, not detection
              </span>
              <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
                Turning a category off stops it from reaching you — it does not change the thresholds or escalation
                rules your provider has configured for your monitoring.
              </span>
              <span className="max-w-[660px] text-[11.5px] leading-relaxed" style={{ color: CAUTION }}>
                Turning a category off is total. No bell entry, no email, and no webhook delivery for it either — an
                endpoint of yours subscribed to that category simply stops receiving anything, silently.
              </span>
            </div>

            {allDefault && (
              <div className="flex flex-col gap-1 rounded-xl border border-dashed p-3.5" style={{ borderColor: "rgba(148,163,184,.25)" }}>
                <span className="text-[12.5px] font-semibold text-foreground">You have never changed any of these</span>
                <span className="max-w-[640px] text-xs leading-relaxed text-muted-foreground">
                  Every category below is at its default: in-app on, email off. That is a real answer rather than a
                  blank form — you are already receiving everything in the bell and nothing by email.
                </span>
              </div>
            )}

            <div className="rounded-[14px] border px-5 pb-3.5 pt-1.5" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)" }}>
              <div className="flex flex-wrap items-center gap-3 py-3">
                <span className="text-[13.5px] font-semibold text-foreground">Notification Categories</span>
                <span className="text-[11px]" style={{ color: "#64748b" }}>{catMeta}</span>
                <span className="ml-auto w-11 flex-none text-center text-[9px] font-bold tracking-wider" style={{ color: "#475569" }}>
                  NOTIFY
                </span>
                <span className="w-11 flex-none text-center text-[9px] font-bold tracking-wider" style={{ color: "#475569" }}>
                  EMAIL
                </span>
              </div>

              <div>
                {[...CATEGORY_ORDER.filter((c) => order.includes(c)), ...order.filter((c) => !CATEGORY_ORDER.includes(c as (typeof CATEGORY_ORDER)[number]))].map(
                  (category) => {
                    const v = cur[category];
                    const info = CATEGORY_INFO[category] ?? { label: category, description: "" };
                    const changed = changedCategories.includes(category);
                    return (
                      <div
                        key={category}
                        className="flex items-center gap-3 py-[11px]"
                        style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
                        data-testid={`notification-pref-row-${category}`}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="text-[12.5px] font-semibold"
                              style={{ color: v.inAppEnabled ? "#e2e8f0" : "#94a3b8" }}
                            >
                              {info.label}
                            </span>
                            {changed && (
                              <span
                                className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wider"
                                style={{ borderColor: "rgba(56,189,248,.3)", color: "#38bdf8" }}
                              >
                                CHANGED
                              </span>
                            )}
                          </div>
                          {info.description && (
                            <span className="max-w-[520px] text-[11.5px] leading-snug" style={{ color: "#64748b" }}>
                              {info.description}
                            </span>
                          )}
                          {!v.inAppEnabled && (
                            <span className="text-[11px] leading-snug" style={{ color: CAUTION }}>
                              Nothing in this category reaches you — bell, email or webhook.
                            </span>
                          )}
                        </div>
                        <Switch
                          checked={v.inAppEnabled}
                          onCheckedChange={(checked) => setPref(category, { inAppEnabled: checked })}
                          data-testid={`notification-pref-inapp-${category}`}
                          aria-label={`Toggle in-app notifications for ${info.label}`}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Switch
                                checked={v.emailEnabled}
                                disabled={!v.inAppEnabled}
                                onCheckedChange={(checked) => v.inAppEnabled && setPref(category, { emailEnabled: checked })}
                                data-testid={`notification-pref-email-${category}`}
                                aria-label={`Toggle email notifications for ${info.label}`}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {v.inAppEnabled
                              ? "Email a copy of this category"
                              : "In-app is off for this category, so there is nothing to email a copy of"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  },
                )}
              </div>
              <span
                className="mt-0.5 block pt-2.5 text-[10.5px] leading-relaxed"
                style={{ color: "#475569", borderTop: "1px solid rgba(255,255,255,.06)" }}
              >
                Email can only be on where in-app is on. Turning in-app off turns email off with it, because the
                email is sent as a copy of the bell entry rather than on its own.
              </span>
            </div>

            <div className="flex flex-col gap-2 rounded-[14px] border p-4" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)" }}>
              <span className="text-[12.5px] font-semibold text-foreground">Email goes to {user?.email ?? "you@contoso.com"}</span>
              <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
                Every enabled category emails as soon as it fires. There is no daily or weekly digest here and no way
                to batch them — the cadence controls you may have seen on monitoring alerts belong to a different
                set of settings entirely.
              </span>
              <span className="max-w-[660px] text-[11.5px] leading-relaxed" style={{ color: CAUTION }}>
                If an email fails to send, you will not be told. Delivery is attempted once and failures are logged
                on our side only, so a category showing email on is not proof that email is arriving.
              </span>
            </div>

            <div className="flex flex-col gap-2 rounded-[14px] border p-4" style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
              <span className="text-[12.5px] font-semibold text-foreground">Not the same as your monitoring alerts</span>
              <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
                This page covers the platform's own notifications — invoices, signed documents, security events,
                system messages. Monitoring alerts about your tenant have their own thresholds, severities and
                digest cadence, kept on a separate page. The two lists were built for different purposes and share
                nothing: no setting here changes one there.
              </span>
              <Link
                href={comingSoonHref("Portal Alerts", "module")}
                className="w-fit text-[11.5px] font-semibold"
                style={{ color: "#60a5fa" }}
                data-testid="notification-preferences-open-alerts"
              >
                Open monitoring alert preferences
              </Link>
            </div>

            <div className="flex flex-col gap-2 rounded-[14px] border p-4" style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
              <div className="flex items-baseline gap-2.5">
                <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
                <button
                  type="button"
                  onClick={() => setLedgerOpen((o) => !o)}
                  className="ml-auto text-[11.5px] font-semibold"
                  style={{ color: "#64748b" }}
                >
                  {ledgerOpen ? "Collapse" : "Expand"}
                </button>
              </div>
              {ledgerOpen && (
                <div className="flex flex-col">
                  {LEDGER.map((l, i) => (
                    <div key={i} className="flex items-start gap-3 py-2" style={{ borderTop: i === 0 ? undefined : "1px solid rgba(255,255,255,.05)" }}>
                      <span className="min-w-0 flex-1 text-[11.5px] leading-snug" style={{ color: "#cbd5e1" }}>
                        {l.gap}
                      </span>
                      <span className="flex-none whitespace-nowrap font-mono text-[10.5px]" style={{ color: "#475569" }}>
                        {l.where}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {changedCategories.length > 0 && (
          <div
            className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t px-1 py-3"
            style={{ background: "rgba(11,17,32,.97)", borderColor: "rgba(255,255,255,.10)" }}
            data-testid="notification-preferences-save-bar"
          >
            <span className="min-w-0 text-xs text-foreground">
              {changedCategories.length} {pluralize(changedCategories.length, "category", "categories")} changed and
              not saved yet
              {saveError ? ` — ${saveError}` : ""}
            </span>
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="ml-auto flex-none whitespace-nowrap rounded-md border px-3.5 py-2 text-xs font-semibold"
              style={{ borderColor: "rgba(255,255,255,.12)", color: "#94a3b8" }}
              data-testid="notification-preferences-discard"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex-none whitespace-nowrap rounded-md px-[15px] py-2 text-xs font-semibold text-white"
              style={{ background: ACCENT }}
              data-testid="notification-preferences-save"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}

        {toast && (
          <div
            className="fixed bottom-[22px] left-1/2 z-50 flex max-w-[520px] -translate-x-1/2 items-center gap-2.5 rounded-[10px] border px-4 py-[11px] shadow-lg"
            style={{ background: "rgba(11,17,32,.98)", borderColor: "rgba(52,211,153,.35)" }}
            data-testid="notification-preferences-toast"
          >
            <CheckCircle2 className="size-3.5 flex-none" color="#34d399" strokeWidth={2.2} />
            <span className="text-xs leading-snug" style={{ color: "#cbd5e1" }}>
              Saved. Each category was written on its own, so if one had failed the rest would still have gone
              through.
            </span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default function NotificationPreferencesPage() {
  return (
    <div className="mx-auto max-w-[900px] py-2">
      <NotificationPreferencesContent />
    </div>
  );
}
