/**
 * Webhooks — MSP Console module page (Git #2612, Feature #1693). Mounts into
 * the shell's `ScreenSlot` at `/tenants/:id/wh`
 * (`Design/MSP_Console/design_handoff_msp_console/Webhooks.dc.html`, README
 * screen 20). Two tabs, faithful to the design's logic class where the real
 * backend covers it:
 *
 *   Customer endpoints — every endpoint this customer has registered, and its
 *                         current state. Reversibly disable/re-enable; never
 *                         create, edit, rotate or delete — that stays owner-only.
 *   Deliveries         — delivery log and failure history across every endpoint.
 *
 * The design's third tab ("What comes in to us" — inbound platform webhooks)
 * is intentionally not built here: it isn't within `msp-console-webhooks.ts`'s
 * real scope (that route is the operator half of *customer-configured outbound*
 * endpoints only), and the design's own copy for it doesn't hold up against the
 * real inbound Stripe handler's current behaviour — see the finding filed
 * alongside this build.
 *
 * Every row and badge comes from the live routes in `src/api/webhooks-api.ts`
 * — no fixture, no fabricated row.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { surface, text, signal, border } from "@/console/tokens";
import {
  useAllCustomerDeliveries,
  useCustomerWebhooks,
  useDisableWebhook,
  useEnableWebhook,
  useWebhookDeliveries,
  type ConsoleWebhook,
} from "@/api/webhooks-api";

type Tab = "outbound" | "deliveries";
type DeliveryFilter = "all" | "ok" | "failed";

const TONE: Record<string, { strong: string; text: string; tint: string; border: string }> = {
  green: signal.ok,
  amber: signal.warning,
  red: signal.critical,
  blue: signal.info,
  slate: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}

function pill(t: { strong: string; text: string; tint: string; border: string }, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}

function isDeliveryOk(status: string): boolean {
  return status === "success";
}

function deliveryResultLabel(d: { status: string; statusCode: number | null }): string {
  if (d.status === "success") return `accepted${d.statusCode != null ? " " + d.statusCode : ""}`;
  if (d.status === "pending") return "pending";
  if (d.status === "retrying") return "retrying";
  return `failed${d.statusCode != null ? " " + d.statusCode : ""}`;
}

function deliveryDetail(d: { status: string; statusCode: number | null; responseSnippet: string | null }): string {
  if (d.status === "success") return "The endpoint accepted it.";
  if (d.status === "pending") return "Waiting to be sent.";
  if (d.status === "retrying") return "The endpoint did not accept it. It is being retried on a backoff.";
  return d.responseSnippet
    ? `The endpoint did not accept it: ${d.responseSnippet}`
    : "The endpoint did not accept it. It was retried on a backoff and then given up on.";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Webhooks({ customerId }: { customerId: number }) {
  const [tab, setTab] = useState<Tab>("outbound");
  const [filter, setFilter] = useState<DeliveryFilter>("all");
  const [selId, setSelId] = useState<string | null>(null);

  const webhooksQuery = useCustomerWebhooks(customerId);
  const webhooks = webhooksQuery.data?.webhooks ?? [];
  const webhookIds = useMemo(() => webhooks.map((w) => w.webhookId), [webhooks]);

  const allDeliveries = useAllCustomerDeliveries(customerId, webhookIds);
  const failing = allDeliveries.deliveries.filter((d) => !isDeliveryOk(d.status) && d.status !== "pending").length;

  const sel = selId ? webhooks.find((w) => w.webhookId === selId) ?? null : null;

  const tabDefs: { id: Tab; label: string; count: string }[] = [
    { id: "outbound", label: "Customer endpoints", count: String(webhooks.length) },
    { id: "deliveries", label: "Deliveries", count: String(allDeliveries.deliveries.length) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabDefs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? signal.info.strong : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>
          {webhooksQuery.isLoading || allDeliveries.isLoading
            ? "Loading…"
            : failing > 0
              ? `${failing} ${failing === 1 ? "delivery failed" : "deliveries failed"} recently`
              : "Every recent delivery landed"}
        </span>
      </div>

      {tab === "outbound" && (
        <OutboundTab
          webhooks={webhooks}
          loading={webhooksQuery.isLoading}
          error={webhooksQuery.isError}
          onSelect={setSelId}
        />
      )}
      {tab === "outbound" && sel && (
        <DetailDrawer customerId={customerId} webhook={sel} onClose={() => setSelId(null)} />
      )}

      {tab === "deliveries" && (
        <DeliveriesTab
          rows={allDeliveries.deliveries}
          webhooks={webhooks}
          loading={allDeliveries.isLoading}
          error={allDeliveries.isError}
          filter={filter}
          onFilter={setFilter}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          The customer owns these endpoints. From here they can be read and switched off — creating, editing, rotating the
          secret and deleting stay with them.
        </span>
      </div>
    </div>
  );
}

// ── Customer endpoints tab ────────────────────────────────────────────────────

function OutboundTab({
  webhooks, loading, error, onSelect,
}: { webhooks: ConsoleWebhook[]; loading: boolean; error: boolean; onSelect: (id: string) => void }) {
  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading this customer's webhooks…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load this customer's webhooks.</div>;

  if (webhooks.length === 0) {
    return (
      <div style={cardStyle({ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="webhook" size={20} color={signal.info.strong} />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>No endpoints registered</span>
        <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 430, textWrap: "pretty" }}>
          This customer hasn't configured a webhook endpoint yet. They own creating one — nothing to manage here until they do.
        </span>
      </div>
    );
  }

  return (
    <div style={cardStyle({ overflowX: "auto" })}>
      <div style={{ minWidth: 900 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr 1.3fr 1.2fr 90px", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>ENDPOINT</span><span>STATE</span><span>SUBSCRIBED TO</span><span>LAST DELIVERY</span><span style={{ textAlign: "right" }}></span>
        </div>
        {webhooks.map((w) => {
          const t = TONE[w.isActive ? "green" : "slate"];
          return (
            <div
              key={w.webhookId}
              onClick={() => onSelect(w.webhookId)}
              style={{
                display: "grid", gridTemplateColumns: "2.4fr 1fr 1.3fr 1.2fr 90px", gap: 12, alignItems: "center",
                padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer", opacity: w.isActive ? 1 : 0.75,
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.label}</span>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.url}</span>
              </span>
              <span style={pill(t)}>
                <Icon name={w.isActive ? "radio" : "power-off"} size={11} />
                {w.isActive ? "on" : "switched off"}
              </span>
              <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap" }}>
                {w.eventTypes.length} {w.eventTypes.length === 1 ? "event" : "events"}
                {w.unrecognizedEventTypes.length > 0 && (
                  <span style={{ color: signal.warning.text }}> · {w.unrecognizedEventTypes.length} unrecognised</span>
                )}
              </span>
              <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{formatWhen(w.updatedAt)}</span>
              <span style={{ justifySelf: "end", fontSize: 12, color: text.label, whiteSpace: "nowrap" }}>Open</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({
  customerId, webhook, onClose,
}: { customerId: number; webhook: ConsoleWebhook; onClose: () => void }) {
  const deliveries = useWebhookDeliveries(customerId, webhook.webhookId, 10);
  const disable = useDisableWebhook(customerId);
  const enable = useEnableWebhook(customerId);

  const rows = deliveries.data?.deliveries ?? [];
  const recentFailures = rows.filter((d) => !isDeliveryOk(d.status)).length;
  const pending = disable.isPending || enable.isPending;

  const toggle = () => {
    if (webhook.isActive) {
      disable.mutate(
        { webhookId: webhook.webhookId },
        {
          onSuccess: () => { toast.success("Endpoint switched off"); onClose(); },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to disable this endpoint"),
        },
      );
    } else {
      enable.mutate(webhook.webhookId, {
        onSuccess: () => { toast.success("Endpoint switched back on"); onClose(); },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to re-enable this endpoint"),
      });
    }
  };

  const facts: { label: string; value: string; color: string }[] = [
    { label: "STATE", value: webhook.isActive ? "on" : "switched off", color: webhook.isActive ? signal.ok.text : text.muted },
    { label: "SECRET", value: `${webhook.secretPrefix}…`, color: text.secondary },
    { label: "SET UP", value: formatWhen(webhook.createdAt), color: text.muted },
    { label: "RECENT FAILURES", value: String(recentFailures), color: recentFailures > 0 ? signal.critical.text : text.muted },
  ];
  if (!webhook.isActive) {
    facts.push({ label: "DISABLED BY", value: webhook.disabledByName ?? "an MSP operator", color: text.secondary });
    if (webhook.disabledReason) facts.push({ label: "REASON", value: webhook.disabledReason, color: text.secondary });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{webhook.label}</span>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.muted, wordBreak: "break-all" }}>{webhook.url}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
              <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT THEY RECEIVE</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {webhook.eventTypes.map((name) => {
              const unrecognized = webhook.unrecognizedEventTypes.includes(name);
              return (
                <span
                  key={name}
                  title={unrecognized ? "Subscribed, but not in the currently dispatchable event catalog — this will never fire" : undefined}
                  style={{
                    display: "inline-flex", padding: "3px 9px", borderRadius: 7,
                    background: unrecognized ? signal.warning.tint : "rgba(2,6,23,.5)",
                    border: `1px solid ${unrecognized ? signal.warning.border : "rgba(148,163,184,.16)"}`,
                    fontFamily: "Menlo, monospace", fontSize: 10.5, color: unrecognized ? signal.warning.text : text.secondary, whiteSpace: "nowrap",
                  }}
                >
                  {name}
                </span>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>RECENT DELIVERIES</span>
          {deliveries.isLoading && <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>}
          {deliveries.isError && <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load deliveries.</span>}
          {!deliveries.isLoading && rows.length === 0 && <span style={{ fontSize: 11.5, color: text.muted }}>No deliveries yet.</span>}
          {rows.map((d) => {
            const ok = isDeliveryOk(d.status);
            return (
              <div key={d.deliveryId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", borderRadius: 9, border: "1px solid rgba(148,163,184,.14)", background: "rgba(2,6,23,.4)", minWidth: 0 }}>
                <Icon name={ok ? "circle-check-big" : "circle-x"} size={14} color={ok ? signal.ok.text : signal.critical.text} />
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.secondary, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.eventType}</span>
                <span style={{ fontSize: 11, color: ok ? signal.ok.text : signal.critical.text, whiteSpace: "nowrap" }}>{deliveryResultLabel(d)}</span>
                <span style={{ fontSize: 11, color: text.faint, whiteSpace: "nowrap" }}>{formatWhen(d.createdAt)}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={toggle}
            disabled={pending}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 38, borderRadius: 8,
              border: `1px solid ${webhook.isActive ? signal.critical.border : signal.ok.border}`,
              background: webhook.isActive ? signal.critical.tint : signal.ok.tint,
              color: webhook.isActive ? signal.critical.text : signal.ok.text,
              fontSize: 13, fontWeight: 600, cursor: pending ? "wait" : "pointer",
            }}
          >
            <Icon name={webhook.isActive ? "power-off" : "power"} size={14} />
            {pending ? "Working…" : webhook.isActive ? "Switch this endpoint off" : "Switch this endpoint back on"}
          </button>
          <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
            {webhook.isActive
              ? "Deliveries stop immediately. The endpoint and its settings stay exactly as they are, and the customer can see it was switched off here."
              : "Deliveries resume from the next event. Nothing that was missed while it was off gets sent."}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Edit", title: "The customer owns the endpoint's settings — editing stays with them" },
              { label: "Rotate the secret", title: "Rotating the signing secret stays with the customer" },
              { label: "Delete", title: "Only the customer can remove their own endpoint" },
            ].map((a) => (
              <button key={a.label} title={a.title} disabled style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", borderRadius: 7, border: "1px solid rgba(148,163,184,.18)", background: "transparent", color: text.label, fontSize: 11.5, fontWeight: 600, cursor: "not-allowed", opacity: 0.6, whiteSpace: "nowrap" }}>
                <Icon name="lock" size={12} />
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Deliveries tab ────────────────────────────────────────────────────────────

function DeliveriesTab({
  rows, webhooks, loading, error, filter, onFilter,
}: {
  rows: ReturnType<typeof useAllCustomerDeliveries>["deliveries"];
  webhooks: ConsoleWebhook[]; loading: boolean; error: boolean;
  filter: DeliveryFilter; onFilter: (f: DeliveryFilter) => void;
}) {
  const labelById = useMemo(() => new Map(webhooks.map((w) => [w.webhookId, w.label])), [webhooks]);

  if (loading) return <div style={{ fontSize: 11.5, color: text.muted }}>Loading deliveries…</div>;
  if (error) return <div style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the delivery log.</div>;

  const filterDefs: { id: DeliveryFilter; label: string; match: (ok: boolean) => boolean }[] = [
    { id: "all", label: "Everything", match: () => true },
    { id: "ok", label: "Delivered", match: (ok) => ok },
    { id: "failed", label: "Failed", match: (ok) => !ok },
  ];

  const filtered = rows.filter((d) => filterDefs.find((f) => f.id === filter)!.match(isDeliveryOk(d.status)));

  if (rows.length === 0) {
    return (
      <div style={cardStyle({ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="webhook" size={20} color={signal.info.strong} />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>No deliveries yet</span>
        <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 430, textWrap: "pretty" }}>
          Nothing has fired to this customer's endpoints yet, or they haven't registered one.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {filterDefs.map((f) => {
          const count = rows.filter((d) => f.match(isDeliveryOk(d.status))).length;
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              style={{
                height: 28, padding: "0 10px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f.label}
              <span style={{ fontSize: 10.5, color: active ? signal.info.strong : text.faint, marginLeft: 6 }}>{count}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {filtered.map((d) => {
          const ok = isDeliveryOk(d.status);
          const t = TONE[ok ? "green" : "red"];
          return (
            <div key={d.deliveryId} style={{ border: `1px solid ${ok ? border.card : signal.critical.border}`, borderRadius: 11, background: surface.card, padding: "13px 14px", display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
              <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 9, background: t.tint, border: `1px solid ${t.border}`, color: t.strong, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={ok ? "circle-check-big" : "circle-x"} size={14} />
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd", whiteSpace: "nowrap" }}>{d.eventType}</span>
                  <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                    {labelById.get(d.webhookId) ?? d.webhookId}
                  </span>
                </div>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{deliveryDetail(d)}</span>
                <span style={{ fontSize: 11, color: text.faint }}>{formatWhen(d.createdAt)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 auto", alignItems: "flex-end" }}>
                <span style={pill(t)}>{deliveryResultLabel(d)}</span>
                <button
                  disabled
                  title="Replaying a delivery is not built yet"
                  style={{ height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: text.label, fontSize: 11.5, fontWeight: 600, cursor: "not-allowed", opacity: 0.6, whiteSpace: "nowrap" }}
                >
                  Replay
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
        Replaying a delivery is not built yet. A failed delivery retries on its own schedule and then stops.
      </span>
    </div>
  );
}
