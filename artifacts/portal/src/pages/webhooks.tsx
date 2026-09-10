import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * Webhooks (#3523, real design landed at
 * Design/portal/design_handoff_full_site/screens/Webhooks.dc.html, contract
 * pack docs/webhooks-contract-pack.md, #1597).
 *
 * The design's own confirm-style secret modal and ledger settle the question
 * #3523's own body asked Shane to decide: **"Reveal" is dropped.** The full
 * plaintext secret is shown exactly twice — the moment a webhook is created,
 * and the moment its secret is rotated — and never again. Every other read
 * (list, single GET, post-PATCH) exposes only `secretPrefix`
 * (`webhooks.ts:160`). There is no reveal endpoint and this page does not
 * pretend one exists (`sync-record.md:64`: "one-time secret moment (create +
 * rotate) with no reveal afterwards").
 *
 * Wired to the real, already-built endpoints in
 * `artifacts/api-server/src/routes/webhooks.ts` — no fixture data:
 *   - GET    /api/portal/webhooks
 *   - GET    /api/portal/webhooks/event-types
 *   - POST   /api/portal/webhooks
 *   - PATCH  /api/portal/webhooks/:webhookId          (isActive toggle)
 *   - DELETE /api/portal/webhooks/:webhookId
 *   - POST   /api/portal/webhooks/:webhookId/rotate-secret
 *   - GET    /api/portal/webhooks/:webhookId/deliveries
 *
 * "Edit label, URL and events" intentionally renders an inert confirm dialog
 * ("Editing is wired, this prototype is not") rather than a pre-filled form —
 * that is the design's own explicit, final copy (CLAUDE.md "Copy is final"),
 * carried into this ledger's own ledger entry rather than authored here.
 * PATCH itself is real and used for the isActive (pause/resume) toggle,
 * which the design does wire.
 */

interface Webhook {
  webhookId: string;
  label: string;
  url: string;
  secretPrefix: string;
  eventTypes: string[];
  isActive: boolean;
  ownerType: "msp" | "customer" | "platform";
  mspId: number | null;
  customerId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryLogEntry {
  deliveryId: string;
  webhookId: string;
  eventId: string | null;
  eventType: string;
  attempt: number;
  status: "pending" | "success" | "failed" | "retrying";
  statusCode: number | null;
  responseSnippet: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

type DataState = "loading" | "live" | "failed";
type SecretMoment = { mode: "create" | "rotate"; label: string; value: string } | null;
type ConfirmSpec = { kind: "rotate" | "delete" | "edit"; webhookId: string; label: string } | null;

const MAX_ATTEMPTS = 3;

// Hardcoded alongside the real route (webhooks.ts:27-40) — not fetchable on
// their own; GET /api/portal/webhooks/event-types returns these 13 combined
// with the 28 platform-bus events below, not as two separate lists. Kept
// verbatim from the design's own DECLARED-BY-THE-ROUTE group.
const ROUTE_DECLARED_EVENTS = [
  "signal.fired",
  "fulfillment.item.created",
  "fulfillment.item.updated",
  "offer.accepted",
  "offer.rejected",
  "monitoring.run.completed",
  "service.activated",
  "service.deactivated",
  "project.created",
  "project.completed",
  "invoice.created",
  "invoice.paid",
  "contract.signed",
] as const;

// Never dispatched anywhere in the codebase (contract pack §4(A), verified by
// literal-string search) — subscribable but permanently dead.
const DEAD_EVENT = "signal.fired";

const LEDGER: { gap: string; where: string }[] = [
  { gap: "No reveal of a secret after the moment it is created or rotated — only the 14-character prefix is readable afterwards.", where: "§6" },
  { gap: "No replay of a failed delivery. Nothing in the platform can re-attempt one, so a delivery that exhausts its three attempts is lost.", where: "§7" },
  { gap: "No access to the payload that was sent. It is stored against every delivery but never served.", where: "§2" },
  { gap: "No paging past the most recent 200 deliveries per endpoint.", where: "§2" },
  { gap: "No stored health. The status on each row is computed in the browser from the deliveries fetched, and can change with the page size read.", where: "§3" },
  { gap: "No rotation history and no grace period — one secret at a time, replaced destructively.", where: "§2" },
  { gap: "No archive on delete. The endpoint and its whole delivery history are removed together.", where: "§2" },
  { gap: "No shared taxonomy with alert preferences. Category names line up; event names do not, and no alert condition is ever dispatched.", where: "§4" },
  { gap: "No distinction between an endpoint that does not exist and one that belongs to someone else — both answer identically.", where: "§2" },
  { gap: "No platform-owned endpoints, despite the owner type existing. Nothing can create one.", where: "§3" },
];

const HAIRLINE = "rgba(255,255,255,.09)";
const ACCENT = "#0078D4";
const CAUTION = "#c2a63d";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return fmtDate(iso);
}

function deriveState(active: boolean, deliveries: DeliveryLogEntry[]): { label: string; ink: string; bg: string; bd: string } {
  if (!active) return { label: "Paused", ink: "#94a3b8", bg: "rgba(148,163,184,.10)", bd: "rgba(148,163,184,.28)" };
  if (deliveries.length === 0) return { label: "Untested", ink: CAUTION, bg: "rgba(194,166,61,.10)", bd: "rgba(194,166,61,.30)" };
  const ok = deliveries.filter((d) => d.status === "success").length / deliveries.length;
  if (ok < 0.7) return { label: "Failing", ink: "#f87171", bg: "rgba(248,113,113,.10)", bd: "rgba(248,113,113,.30)" };
  if (ok < 0.98) return { label: "Degraded", ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.30)" };
  return { label: "Healthy", ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" };
}

const DELIVERY_STATUS_STYLE: Record<DeliveryLogEntry["status"], { ink: string; bg: string; bd: string }> = {
  success: { ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.25)" },
  failed: { ink: "#f87171", bg: "rgba(248,113,113,.10)", bd: "rgba(248,113,113,.28)" },
  retrying: { ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" },
  pending: { ink: "#94a3b8", bg: "rgba(148,163,184,.10)", bd: "rgba(148,163,184,.25)" },
};

export function WebhooksContent() {
  const { fetchWithAuth } = useAuth();
  const [dataState, setDataState] = useState<DataState>("loading");
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [eventCatalog, setEventCatalog] = useState<string[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deliveriesById, setDeliveriesById] = useState<Record<string, DeliveryLogEntry[]>>({});
  const [deliveriesLoading, setDeliveriesLoading] = useState<Record<string, boolean>>({});

  const [creating, setCreating] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [secret, setSecret] = useState<SecretMoment>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const load = useCallback(async () => {
    setDataState("loading");
    try {
      const res = await fetchWithAuth("/api/portal/webhooks");
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const data = (await res.json()) as { webhooks?: Webhook[] };
      setWebhooks(data.webhooks ?? []);
      setDataState("live");
    } catch {
      setDataState("failed");
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth("/api/portal/webhooks/event-types");
        if (!res.ok) return;
        const data = (await res.json()) as { eventTypes?: string[] };
        setEventCatalog(data.eventTypes ?? null);
      } catch {
        // The catalog is advisory display only — a failed fetch here doesn't
        // block the page, it just leaves the picker/catalog list empty.
      }
    })();
  }, [fetchWithAuth]);

  const loadDeliveries = useCallback(
    async (webhookId: string) => {
      setDeliveriesLoading((prev) => ({ ...prev, [webhookId]: true }));
      try {
        const res = await fetchWithAuth(`/api/portal/webhooks/${webhookId}/deliveries`);
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const data = (await res.json()) as { deliveries?: DeliveryLogEntry[] };
        setDeliveriesById((prev) => ({ ...prev, [webhookId]: data.deliveries ?? [] }));
      } catch {
        setDeliveriesById((prev) => ({ ...prev, [webhookId]: [] }));
      } finally {
        setDeliveriesLoading((prev) => ({ ...prev, [webhookId]: false }));
      }
    },
    [fetchWithAuth],
  );

  const toggleOpen = (webhookId: string) => {
    const next = openId === webhookId ? null : webhookId;
    setOpenId(next);
    if (next && !(next in deliveriesById)) void loadDeliveries(next);
  };

  const urlOk = /^https?:\/\/.+/.test(formUrl.trim());
  const canSubmit = formLabel.trim().length > 0 && formLabel.trim().length <= 120 && urlOk && !submitting;

  const startCreate = () => {
    setFormLabel("");
    setFormUrl("");
    setFormEvents([]);
    setCreateError(null);
    setCreating(true);
    setOpenId(null);
  };

  const submitCreate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetchWithAuth("/api/portal/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: formLabel.trim(), url: formUrl.trim(), eventTypes: formEvents }),
      });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      const data = (await res.json()) as { webhook: Webhook & { secret: string } };
      setWebhooks((prev) => [data.webhook, ...prev]);
      setCreating(false);
      setOpenId(data.webhook.webhookId);
      setCopied(false);
      setSecret({ mode: "create", label: data.webhook.label, value: data.webhook.secret });
    } catch {
      setCreateError("Could not create the endpoint. Nothing was saved — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (wh: Webhook) => {
    // Optimistic, same pattern as notification-preferences: the route
    // returns the updated row but re-selecting after every toggle isn't
    // necessary for a boolean flip the caller itself just set.
    const nextActive = !wh.isActive;
    setWebhooks((prev) => prev.map((w) => (w.webhookId === wh.webhookId ? { ...w, isActive: nextActive } : w)));
    try {
      const res = await fetchWithAuth(`/api/portal/webhooks/${wh.webhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) throw new Error(`toggle failed (${res.status})`);
    } catch {
      // Revert on failure — the server never got the change.
      setWebhooks((prev) => prev.map((w) => (w.webhookId === wh.webhookId ? { ...w, isActive: wh.isActive } : w)));
    }
  };

  const confirmSpec = (() => {
    if (!confirm) return null;
    if (confirm.kind === "rotate")
      return {
        title: `Rotate the secret for ${confirm.label}?`,
        body: "A new secret is generated and shown once. The current secret stops validating the moment you confirm.",
        note: "There is no overlap period and no rotation history — anything still signing with the old secret will start failing immediately.",
        cta: "Rotate now",
        bg: ACCENT,
      };
    if (confirm.kind === "delete")
      return {
        title: `Delete ${confirm.label}?`,
        body: "The endpoint is removed and its delivery history is removed with it. There is no archive and no undo.",
        note: "If you only want deliveries to stop, pause it instead — a paused endpoint keeps its history.",
        cta: "Delete endpoint",
        bg: "#b91c1c",
      };
    return {
      title: "Editing is wired, this prototype is not",
      body: "Label, URL, events and the paused state are all patchable against the real endpoint. The form is the same one used to create — this design has not built the pre-filled version yet.",
      note: "Owner, secret and delivery history are not editable by any code path.",
      cta: "Understood",
      bg: ACCENT,
    };
  })();

  const runConfirm = async () => {
    if (!confirm) return;
    if (confirm.kind === "edit") {
      setConfirm(null);
      return;
    }
    setConfirmBusy(true);
    try {
      if (confirm.kind === "delete") {
        const res = await fetchWithAuth(`/api/portal/webhooks/${confirm.webhookId}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) throw new Error(`delete failed (${res.status})`);
        setWebhooks((prev) => prev.filter((w) => w.webhookId !== confirm.webhookId));
        if (openId === confirm.webhookId) setOpenId(null);
      } else if (confirm.kind === "rotate") {
        const res = await fetchWithAuth(`/api/portal/webhooks/${confirm.webhookId}/rotate-secret`, { method: "POST" });
        if (!res.ok) throw new Error(`rotate failed (${res.status})`);
        const data = (await res.json()) as { secret: string; secretPrefix: string };
        setWebhooks((prev) =>
          prev.map((w) => (w.webhookId === confirm.webhookId ? { ...w, secretPrefix: data.secretPrefix } : w)),
        );
        setCopied(false);
        setSecret({ mode: "rotate", label: confirm.label, value: data.secret });
      }
      setConfirm(null);
    } catch {
      // Leave the confirm dialog open with no state changed on failure —
      // the caller can retry or cancel.
    } finally {
      setConfirmBusy(false);
    }
  };

  const catalogGroups = [
    {
      label: "DECLARED BY THE WEBHOOKS ROUTE — 13",
      note: "Product events hardcoded alongside the platform list. All but one are dispatched from real call sites today.",
      items: ROUTE_DECLARED_EVENTS as readonly string[],
    },
    {
      label: `FROM THE PLATFORM EVENT BUS — ${eventCatalog ? eventCatalog.length - ROUTE_DECLARED_EVENTS.length : 28}`,
      note: "Account, tenant and document lifecycle events, read live from GET /api/portal/webhooks/event-types rather than hardcoded — a hardcoded copy is how the older page drifted 20 events out of date.",
      items: (eventCatalog ?? []).filter((e) => !(ROUTE_DECLARED_EVENTS as readonly string[]).includes(e)),
    },
  ];

  const totalEventCount = eventCatalog?.length ?? ROUTE_DECLARED_EVENTS.length;

  return (
    <div className="flex flex-col gap-4" data-testid="webhooks-page">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xl font-bold tracking-tight text-foreground">Webhooks</span>
        <span
          title="Outbound HTTP callbacks. Every event the platform dispatches is offered to every endpoint subscribed to it. Nothing here reads or writes your tenant."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border text-[10px] font-bold"
          style={{ borderColor: "rgba(148,163,184,.35)", color: "#64748b" }}
        >
          i
        </span>
        <span
          className="flex items-center gap-1.5 text-[11px]"
          style={{ color: dataState === "failed" ? "#f87171" : "#64748b" }}
          data-testid="webhooks-status"
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: dataState === "failed" ? "#f87171" : dataState === "loading" ? "#475569" : "#34d399" }}
          />
          {dataState === "loading"
            ? "Reading your endpoints"
            : dataState === "failed"
              ? "Could not read your endpoints"
              : `Live — ${webhooks.length} ${webhooks.length === 1 ? "endpoint" : "endpoints"}`}
        </span>
        {dataState === "live" && !creating && (
          <button
            type="button"
            onClick={startCreate}
            className="ml-auto flex-none rounded-md px-3.5 py-2 text-xs font-semibold text-white"
            style={{ background: ACCENT }}
            data-testid="webhooks-new-endpoint"
          >
            New endpoint
          </button>
        )}
      </div>

      {dataState === "loading" && (
        <div className="flex flex-col gap-2.5">
          {[34, 28, 31].map((w, i) => (
            <div
              key={i}
              className="flex animate-pulse flex-col gap-2 rounded-2xl border p-4"
              style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)" }}
            >
              <div className="h-2.5 rounded-full" style={{ width: `${w}%`, background: "rgba(255,255,255,.07)" }} />
              <div className="h-2 rounded-full" style={{ width: `${w * 1.6}%`, background: "rgba(255,255,255,.05)" }} />
            </div>
          ))}
        </div>
      )}

      {dataState === "failed" && (
        <div
          className="flex gap-2.5 rounded-xl border border-dashed p-3.5"
          style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
          data-testid="webhooks-error"
        >
          <AlertTriangle className="mt-0.5 size-[15px] flex-none" color="#f87171" strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">Your endpoint list could not be loaded</span>
            <span className="max-w-[600px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an empty list. Nothing below would be your configuration, so nothing is
              shown — a webhook may well be live and delivering right now.
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="w-fit pt-0.5 text-[11.5px] font-semibold"
              style={{ color: "#60a5fa" }}
              data-testid="webhooks-retry"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {creating && (
        <div
          className="flex flex-col gap-3.5 rounded-2xl border p-5"
          style={{ borderColor: "rgba(0,120,212,.45)", background: "rgba(0,120,212,.05)" }}
          data-testid="webhooks-create-form"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold text-foreground">New endpoint</span>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="ml-auto text-[11.5px]"
              style={{ color: "#64748b" }}
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-wrap gap-3.5">
            <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Label</span>
              <input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Ops relay"
                className="rounded-md border bg-transparent px-2.5 py-2 text-[12.5px] text-foreground outline-none"
                style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)" }}
                data-testid="webhooks-form-label"
              />
              <span className="text-[10.5px]" style={{ color: "#475569" }}>Required, 1–120 characters.</span>
            </div>
            <div className="flex min-w-[260px] flex-[2] flex-col gap-1.5">
              <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Destination URL</span>
              <input
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://"
                className="rounded-md border bg-transparent px-2.5 py-2 font-mono text-[12.5px] text-foreground outline-none"
                style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)" }}
                data-testid="webhooks-form-url"
              />
              <span className="text-[10.5px]" style={{ color: formUrl.trim() === "" ? "#475569" : urlOk ? "#34d399" : "#f87171" }}>
                {formUrl.trim() === "" ? "Must start with http:// or https://." : urlOk ? "Accepted." : "Rejected — the URL must start with http:// or https://."}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>Events</span>
              <span className="text-[10.5px]" style={{ color: "#64748b" }}>
                {formEvents.length === 0 ? "None picked — an endpoint with no events never receives anything" : `${formEvents.length} picked`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(eventCatalog ?? []).map((t) => {
                const on = formEvents.includes(t);
                const dead = t === DEAD_EVENT;
                return (
                  <span
                    key={t}
                    onClick={() =>
                      setFormEvents((prev) => (on ? prev.filter((x) => x !== t) : prev.concat([t])))
                    }
                    className="cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[10.5px]"
                    style={{
                      color: on ? "#f8fafc" : dead ? CAUTION : "#94a3b8",
                      background: on ? "rgba(0,120,212,.22)" : "transparent",
                      borderColor: on ? "rgba(0,120,212,.55)" : dead ? "rgba(194,166,61,.35)" : "rgba(255,255,255,.10)",
                    }}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
            <span className="text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
              Only listed event types are accepted — subscribing to an unknown string is rejected up front (#1607).
            </span>
          </div>
          <div className="flex items-center gap-3" style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 13 }}>
            <span className="max-w-[520px] text-[11.5px] leading-relaxed" style={{ color: "#64748b" }}>
              A signing secret is generated when you save. It is shown once, on the next screen, and cannot be
              retrieved afterwards.
              {createError ? ` ${createError}` : ""}
            </span>
            <button
              type="button"
              onClick={() => void submitCreate()}
              disabled={!canSubmit}
              className="ml-auto flex-none rounded-md px-4 py-2.5 text-xs font-semibold"
              style={{
                color: canSubmit ? "#fff" : "#475569",
                background: canSubmit ? ACCENT : "rgba(255,255,255,.06)",
                cursor: canSubmit ? "pointer" : "default",
              }}
              data-testid="webhooks-form-submit"
            >
              {submitting ? "Creating…" : "Create endpoint"}
            </button>
          </div>
        </div>
      )}

      {dataState === "live" && webhooks.length === 0 && (
        <div
          className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-9 text-center"
          style={{ borderColor: "rgba(148,163,184,.25)" }}
          data-testid="webhooks-empty"
        >
          <span className="text-[13.5px] font-semibold text-foreground">No endpoints configured</span>
          <span className="max-w-[540px] text-xs leading-relaxed text-muted-foreground">
            This is a real, successful read of your configuration: you have no outbound webhooks, and none has ever
            been created. No events are being delivered anywhere.
          </span>
          <button
            type="button"
            onClick={startCreate}
            className="mt-1.5 rounded-md px-4 py-2 text-xs font-semibold text-white"
            style={{ background: ACCENT }}
          >
            Create your first endpoint
          </button>
        </div>
      )}

      {dataState === "live" && webhooks.length > 0 && (
        <div className="rounded-2xl border px-5 pb-3.5 pt-1.5" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)" }}>
          <div className="flex flex-wrap items-center gap-2.5 py-3">
            <span className="text-[13.5px] font-semibold text-foreground">Endpoints</span>
            <span className="text-[11px]" style={{ color: "#64748b" }}>
              {webhooks.length} configured · newest first · no paging, every endpoint you own is listed
            </span>
          </div>
          {webhooks.map((wh) => {
            const deliveries = deliveriesById[wh.webhookId] ?? [];
            const loadingDeliveries = deliveriesLoading[wh.webhookId];
            const isOpen = openId === wh.webhookId;
            const state = deriveState(wh.isActive, deliveries);
            const hasDead = wh.eventTypes.includes(DEAD_EVENT);
            const failCount = deliveries.filter((d) => d.status !== "success").length;
            return (
              <div key={wh.webhookId} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                <div
                  onClick={() => toggleOpen(wh.webhookId)}
                  className="flex cursor-pointer items-center gap-3 py-[11px]"
                  data-testid={`webhook-row-${wh.webhookId}`}
                >
                  <span
                    className="size-[7px] flex-none rounded-full border"
                    style={{ background: state.ink, borderColor: state.bd }}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-[12.5px] font-semibold" style={{ color: "#e2e8f0" }}>{wh.label}</span>
                    <span className="truncate font-mono text-[11px]" style={{ color: "#64748b" }}>{wh.url}</span>
                  </div>
                  <span
                    className="flex-none whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[10px] font-semibold"
                    style={{ color: state.ink, background: state.bg, borderColor: state.bd }}
                  >
                    {state.label}
                  </span>
                  <span className="w-[82px] flex-none text-right text-[11px]" style={{ color: "#64748b" }}>
                    {wh.eventTypes.length} {wh.eventTypes.length === 1 ? "event" : "events"}
                  </span>
                  <span className="w-24 flex-none truncate text-right text-[11px]" style={{ color: "#64748b" }}>
                    {deliveries.length ? `Last ${fmtWhen(deliveries[0]!.createdAt)}` : "Never delivered"}
                  </span>
                  <ChevronRight
                    className="size-[13px] flex-none transition-transform"
                    style={{ color: "#334155", transform: isOpen ? "rotate(90deg)" : "none" }}
                  />
                </div>

                {isOpen && (
                  <div className="flex flex-col gap-3.5 pb-[18px] pt-1">
                    <div className="flex flex-wrap gap-6">
                      <div className="flex min-w-[170px] flex-col gap-1">
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: "#475569" }}>SIGNING SECRET</span>
                        <span className="font-mono text-xs" style={{ color: "#cbd5e1" }}>
                          {wh.secretPrefix}
                          <span style={{ color: "#334155" }}>…</span>
                        </span>
                        <span className="max-w-[230px] text-[10.5px] leading-relaxed" style={{ color: "#64748b" }}>
                          Only this prefix is readable. The full secret existed once, at creation.
                        </span>
                      </div>
                      <div className="flex min-w-[150px] flex-col gap-1">
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: "#475569" }}>OWNER</span>
                        <span className="text-xs" style={{ color: "#cbd5e1" }}>
                          {wh.ownerType === "customer" ? "Your account" : wh.ownerType === "msp" ? "Your MSP" : "Platform"}
                        </span>
                        <span className="max-w-[210px] text-[10.5px] leading-relaxed" style={{ color: "#64748b" }}>
                          Ownership is fixed at creation and cannot be moved.
                        </span>
                      </div>
                      <div className="flex min-w-[140px] flex-col gap-1">
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: "#475569" }}>CREATED</span>
                        <span className="text-xs" style={{ color: "#cbd5e1" }}>{fmtDate(wh.createdAt)}</span>
                        <span className="text-[10.5px]" style={{ color: "#64748b" }}>Last change {fmtDate(wh.updatedAt)}</span>
                      </div>
                      <div className="flex min-w-[120px] flex-col gap-1.5">
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: "#475569" }}>DELIVERING</span>
                        <div
                          onClick={() => void toggleActive(wh)}
                          className="flex h-[21px] w-[38px] cursor-pointer items-center rounded-full border p-[2px]"
                          style={{
                            background: wh.isActive ? ACCENT : "rgba(255,255,255,.07)",
                            borderColor: wh.isActive ? ACCENT : "rgba(255,255,255,.14)",
                            justifyContent: wh.isActive ? "flex-end" : "flex-start",
                          }}
                          data-testid={`webhook-active-toggle-${wh.webhookId}`}
                        >
                          <span className="size-[15px] flex-none rounded-full" style={{ background: wh.isActive ? "#fff" : "#64748b" }} />
                        </div>
                        <span className="text-[10.5px]" style={{ color: "#64748b" }}>
                          {wh.isActive ? "Events are sent" : "Nothing is sent"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold tracking-wider" style={{ color: "#475569" }}>SUBSCRIBED EVENTS</span>
                      <div className="flex flex-wrap gap-1.5">
                        {wh.eventTypes.map((ev) => {
                          const dead = ev === DEAD_EVENT;
                          return (
                            <span
                              key={ev}
                              title={dead ? "Subscribable, but nothing in the platform dispatches this event — it has never fired and cannot." : ""}
                              className="rounded-full border px-2.5 py-1 font-mono text-[10.5px]"
                              style={{
                                color: dead ? CAUTION : "#94a3b8",
                                borderColor: dead ? "rgba(194,166,61,.35)" : "rgba(255,255,255,.10)",
                                background: dead ? "rgba(194,166,61,.07)" : "transparent",
                              }}
                            >
                              {ev}
                            </span>
                          );
                        })}
                      </div>
                      {hasDead && (
                        <span className="text-[10.5px] leading-relaxed" style={{ color: CAUTION }}>
                          One subscription is to an event the platform never dispatches — it will never deliver anything.
                        </span>
                      )}
                    </div>

                    <div className="rounded-xl border" style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
                      <div className="flex items-baseline gap-2.5 border-b px-3.5 py-[11px]" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                        <span className="text-xs font-semibold" style={{ color: "#e2e8f0" }}>Deliveries</span>
                        <span className="text-[10.5px]" style={{ color: "#64748b" }}>
                          {loadingDeliveries
                            ? "Reading…"
                            : deliveries.length
                              ? `${deliveries.length} logged · ${failCount} not delivered`
                              : "none logged"}
                        </span>
                      </div>
                      {!loadingDeliveries && deliveries.length === 0 && (
                        <div className="flex flex-col gap-1 px-3.5 py-[18px]">
                          <span className="text-xs font-semibold" style={{ color: "#e2e8f0" }}>No deliveries yet</span>
                          <span className="max-w-[560px] text-[11.5px] leading-relaxed" style={{ color: "#94a3b8" }}>
                            Nothing has been dispatched to this endpoint since it was created, so it has never been
                            proven to work. Untested is not the same as healthy.
                          </span>
                        </div>
                      )}
                      {deliveries.length > 0 && (
                        <div className="flex flex-col">
                          {deliveries.map((d) => {
                            const s = DELIVERY_STATUS_STYLE[d.status];
                            const terminal = d.status === "failed" && d.attempt >= MAX_ATTEMPTS;
                            return (
                              <div
                                key={d.deliveryId}
                                className="flex items-start gap-3 border-b px-3.5 py-2.5"
                                style={{ borderColor: "rgba(255,255,255,.04)" }}
                              >
                                <span
                                  className="w-[54px] flex-none rounded text-center text-[9px] font-bold tracking-wider"
                                  style={{ color: s.ink, background: s.bg, border: `1px solid ${s.bd}`, padding: "3px 6px" }}
                                >
                                  {d.status}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                  <span className="font-mono text-[11.5px]" style={{ color: "#cbd5e1" }}>{d.eventType}</span>
                                  {d.responseSnippet && (
                                    <span className="truncate font-mono text-[10.5px]" style={{ color: "#64748b" }}>
                                      {d.responseSnippet}
                                    </span>
                                  )}
                                  {terminal && (
                                    <span className="text-[10.5px]" style={{ color: CAUTION }}>
                                      Terminal after 3 attempts. There is no replay — this event is gone.
                                    </span>
                                  )}
                                  {d.nextRetryAt && (
                                    <span className="text-[10.5px]" style={{ color: "#94a3b8" }}>
                                      Next attempt {fmtWhen(d.nextRetryAt)}
                                    </span>
                                  )}
                                </div>
                                <span className="w-14 flex-none text-right text-[11px] tabular-nums" style={{ color: "#64748b" }}>
                                  {d.statusCode == null ? "no reply" : d.statusCode}
                                </span>
                                <span className="w-13 flex-none text-right text-[11px]" style={{ color: "#64748b" }}>
                                  try {d.attempt}/{MAX_ATTEMPTS}
                                </span>
                                <span className="w-[76px] flex-none truncate text-right text-[11px]" style={{ color: "#64748b" }}>
                                  {fmtWhen(d.createdAt)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex flex-col gap-1 px-3.5 py-2.5">
                        <span className="text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
                          The most recent 200 deliveries are readable and no further — there is no way to page past
                          them, so this log is a window, not a record.
                        </span>
                        <span className="text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
                          The payload sent for each delivery is stored but not served, so a failure cannot be
                          inspected from here.
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirm({ kind: "rotate", webhookId: wh.webhookId, label: wh.label })}
                        className="rounded-md border px-3 py-1.5 text-[11.5px] font-semibold"
                        style={{ borderColor: "rgba(255,255,255,.14)", color: "#cbd5e1" }}
                        data-testid={`webhook-rotate-${wh.webhookId}`}
                      >
                        Rotate secret
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm({ kind: "edit", webhookId: wh.webhookId, label: wh.label })}
                        className="rounded-md border px-3 py-1.5 text-[11.5px] font-semibold"
                        style={{ borderColor: "rgba(255,255,255,.14)", color: "#cbd5e1" }}
                        data-testid={`webhook-edit-${wh.webhookId}`}
                      >
                        Edit label, URL and events
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm({ kind: "delete", webhookId: wh.webhookId, label: wh.label })}
                        className="rounded-md border px-3 py-1.5 text-[11.5px] font-semibold"
                        style={{ borderColor: "rgba(248,113,113,.35)", color: "#f87171" }}
                        data-testid={`webhook-delete-${wh.webhookId}`}
                      >
                        Delete
                      </button>
                      <span className="max-w-[280px] text-[10.5px] leading-snug" style={{ color: "#475569" }}>
                        Rotation takes effect immediately, with no overlap period where the old secret still validates.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <span
            className="mt-0.5 block border-t pt-2.5 text-[10.5px] leading-relaxed"
            style={{ borderColor: "rgba(255,255,255,.06)", color: "#475569" }}
          >
            Health is worked out in your browser from the deliveries on this page, not stored anywhere. An endpoint
            with no deliveries reads as untested, because nothing has proven it works.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)" }}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">What you can subscribe to</span>
          <span className="text-[11px]" style={{ color: "#64748b" }}>{totalEventCount} event types</span>
          <button
            type="button"
            onClick={() => setCatalogOpen((o) => !o)}
            className="ml-auto text-[11.5px] font-semibold"
            style={{ color: "#60a5fa" }}
          >
            {catalogOpen ? "Hide the list" : "Show the list"}
          </button>
        </div>
        <span className="max-w-[640px] text-xs leading-relaxed text-muted-foreground">
          Webhooks ride the platform event bus. These are not the same thing as your alert preferences: alerts are
          built on their own condition catalogue, and none of those conditions is dispatched as an event. The two
          surfaces share category names, not wire names — a webhook cannot subscribe to an alert condition, and
          turning an alert on does not send anything here.
        </span>
        {catalogOpen && (
          <div className="flex flex-col gap-3.5 pt-0.5">
            {catalogGroups.map((g) => (
              <div key={g.label} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold tracking-wider" style={{ color: "#475569" }}>{g.label}</span>
                <span className="max-w-[620px] text-[11.5px] leading-relaxed" style={{ color: "#64748b" }}>{g.note}</span>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((t) => {
                    const dead = t === DEAD_EVENT;
                    return (
                      <span
                        key={t}
                        title={dead ? "Subscribable, but nothing in the platform dispatches this event — it has never fired and cannot." : ""}
                        className="rounded-full border px-2.5 py-1 font-mono text-[10.5px]"
                        style={{
                          color: dead ? CAUTION : "#94a3b8",
                          borderColor: dead ? "rgba(194,166,61,.35)" : "rgba(255,255,255,.10)",
                          background: dead ? "rgba(194,166,61,.07)" : "transparent",
                        }}
                      >
                        {t}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
            <span className="max-w-[640px] text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
              Every event dispatched by the platform is offered to every endpoint subscribed to it. There is no
              filtering step and no approval step between the two.
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
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
          <>
            <div className="flex flex-col">
              {LEDGER.map((l, i) => (
                <div key={i} className="flex items-start gap-3 py-2" style={{ borderTop: i === 0 ? undefined : "1px solid rgba(255,255,255,.05)" }}>
                  <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed" style={{ color: "#cbd5e1" }}>{l.gap}</span>
                  <span className="flex-none whitespace-nowrap font-mono text-[10.5px]" style={{ color: "#475569" }}>{l.where}</span>
                </div>
              ))}
            </div>
            <span className="pt-1 text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
              None of these has an issue filed against it yet, so none is a settled decision — they are open questions
              this design leaves visible rather than papers over.
            </span>
          </>
        )}
      </div>

      {secret && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: "rgba(2,6,23,.72)" }}
          data-testid="webhook-secret-modal"
        >
          <div
            className="flex w-[520px] max-w-full flex-col gap-3.5 rounded-2xl border p-6"
            style={{ background: "#0b1120", borderColor: "rgba(0,180,216,.35)", boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
          >
            <div className="flex items-center gap-2.5">
              <Info className="size-[17px]" color="#00B4D8" strokeWidth={1.75} />
              <span className="text-[15px] font-bold text-foreground">
                {secret.mode === "rotate" ? `New secret for ${secret.label}` : `Signing secret for ${secret.label}`}
              </span>
            </div>
            <span className="text-[12.5px] leading-relaxed" style={{ color: "#94a3b8" }}>
              Copy this now. It is shown here and nowhere else — after you close this box only the first 14
              characters are ever readable again, and there is no way to ask for it back.
            </span>
            <div
              className="flex items-center gap-2.5 rounded-lg border p-3"
              style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.12)" }}
            >
              <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground">{secret.value}</span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret.value);
                  } catch {
                    // Clipboard access can be denied by the browser; the value
                    // is still shown for a manual copy.
                  }
                  setCopied(true);
                }}
                className="flex-none rounded border px-2.5 py-1.5 text-[11px] font-semibold"
                style={{ borderColor: "rgba(255,255,255,.14)", color: copied ? "#34d399" : "#cbd5e1" }}
                data-testid="webhook-secret-copy"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <span className="text-[11.5px] leading-relaxed" style={{ color: "#64748b" }}>
              Sign every incoming request against this value. It is stored on our side in plaintext, so treat it as
              a shared credential rather than a one-way hash.
            </span>
            <div className="flex items-center gap-2.5 border-t pt-3.5" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <span className="text-[11px]" style={{ color: "#475569" }}>
                {secret.mode === "rotate" ? "The previous secret has already stopped working." : "The endpoint is live and will start receiving events."}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSecret(null);
                  setCopied(false);
                }}
                className="ml-auto flex-none rounded-md px-4 py-2 text-xs font-semibold text-white"
                style={{ background: ACCENT }}
                data-testid="webhook-secret-dismiss"
              >
                I have stored it
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && confirmSpec && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: "rgba(2,6,23,.72)" }}
          data-testid="webhook-confirm-modal"
        >
          <div
            className="flex w-[460px] max-w-full flex-col gap-2.5 rounded-2xl border p-5"
            style={{ background: "#0b1120", borderColor: "rgba(255,255,255,.12)", boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
          >
            <span className="text-[14.5px] font-bold text-foreground">{confirmSpec.title}</span>
            <span className="text-[12.5px] leading-relaxed" style={{ color: "#94a3b8" }}>{confirmSpec.body}</span>
            <span className="text-[11.5px] leading-relaxed" style={{ color: CAUTION }}>{confirmSpec.note}</span>
            <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={confirmBusy}
                className="ml-auto rounded-md border px-3.5 py-2 text-xs font-semibold"
                style={{ borderColor: "rgba(255,255,255,.12)", color: "#94a3b8" }}
              >
                Keep as is
              </button>
              <button
                type="button"
                onClick={() => void runConfirm()}
                disabled={confirmBusy}
                className="rounded-md px-3.5 py-2 text-xs font-semibold text-white"
                style={{ background: confirmSpec.bg }}
                data-testid="webhook-confirm-go"
              >
                {confirmBusy ? "Working…" : confirmSpec.cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WebhooksPage() {
  return (
    <div className="mx-auto max-w-[950px] py-2">
      <WebhooksContent />
    </div>
  );
}
