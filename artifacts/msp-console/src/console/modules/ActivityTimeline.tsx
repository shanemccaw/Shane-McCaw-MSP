/**
 * Activity Timeline — MSP-wide (Operations) module page (#4011, Feature #3750).
 * Mounts at ops/timeline (`Design/MSP_Console/design_handoff_msp_console/Activity Timeline.dc.html`,
 * README screen 27).
 *
 * Wired against `GET /api/msp/timeline` (artifacts/api-server/src/routes/msp-customer-timeline.ts)
 * via `src/api/timeline-api.ts` — a chronological cross-tenant feed of graded
 * partial/complete scans, warning+critical findings, engine score moves past
 * the significance floor of 5, delivered/approved documents, and sent/accepted/
 * rejected/expired sales offers. Staff scoping is resolved server-side; this
 * component renders exactly what the endpoint returns.
 *
 * The design's per-type customer chips assume a fixed mock roster; here the
 * "who" filter draws from the console's own live directory (`useDirectory`,
 * already scoped to the caller's book) and the customer filter re-queries the
 * server (`customerId=`) rather than filtering an already-fetched page, since
 * the real endpoint supports that natively. The type filter narrows the
 * currently loaded page(s) client-side, same as the design.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/console/icons";
import { surface, text, signal, border, action } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import { useTimeline, type TimelineEvent, type TimelineEventType, type TimelineStatus } from "@/api/timeline-api";

const TONE: Record<TimelineStatus, { strong: string; text: string; tint: string; border: string }> = {
  success: signal.ok,
  warning: signal.warning,
  error: signal.critical,
  info: signal.info,
  default: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};

const TYPE_META: Record<TimelineEventType, { icon: IconName; label: string }> = {
  finding: { icon: "triangle-alert", label: "FINDING" },
  scan_completed: { icon: "circle-check-big", label: "SCAN" },
  scan_failed: { icon: "circle-x", label: "SCAN FAILED" },
  score_change: { icon: "trending-up", label: "SCORE" },
  document: { icon: "file-text", label: "DOCUMENT" },
  offer: { icon: "handshake", label: "OFFER" },
};

const TYPE_ORDER: TimelineEventType[] = ["finding", "scan_completed", "scan_failed", "score_change", "document", "offer"];

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function chipStyle(active: boolean, pill = false): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 6, height: pill ? 27 : 29,
    padding: pill ? "0 10px" : "0 11px", borderRadius: pill ? 999 : 7,
    border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
    background: active ? "rgba(37,99,235,.18)" : "transparent",
    color: active ? "#bfdbfe" : text.muted, fontSize: pill ? 11.5 : 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  };
}

export function ActivityTimeline({
  customers, onOpenTenant,
}: { customers: DirectoryCustomer[]; onOpenTenant: (customerId: number) => void }) {
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [type, setType] = useState<TimelineEventType | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useTimeline(customerId);
  const allEvents = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.events),
    [query.data],
  );
  const byType = allEvents;
  const filtered = type === "all" ? allEvents : allEvents.filter((e) => e.type === type);
  const selected = selectedId ? allEvents.find((e) => e.id === selectedId) ?? null : null;

  const hasMore = !!query.hasNextPage;

  if (query.isError) {
    return (
      <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 12, background: signal.critical.tint, padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: signal.critical.tint, border: `1px solid ${signal.critical.border}`, color: signal.critical.strong, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="circle-x" size={20} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>The timeline did not load</span>
        <span style={{ fontSize: 12.5, color: text.secondary, maxWidth: 420, textWrap: "pretty" }}>
          {query.error instanceof Error ? query.error.message : "Unable to load the activity timeline right now. Please try again shortly."}
        </span>
        <button
          onClick={() => query.refetch()}
          style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 13px", marginTop: 4, borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="rotate-ccw" size={13} />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <button onClick={() => setCustomerId(null)} style={chipStyle(customerId === null)}>Whole book</button>
        {customers.map((c) => (
          <button key={c.id} onClick={() => setCustomerId(c.id)} style={chipStyle(customerId === c.id)}>{c.name}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>
          {query.isLoading ? "Loading…" : `${filtered.length} of ${byType.length} events loaded`}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <button onClick={() => setType("all")} style={chipStyle(type === "all", true)}>
          <Icon name="layers" size={11} />
          Everything
          <span style={{ fontSize: 10.5, color: type === "all" ? signal.info.strong : text.faint }}>{byType.length}</span>
        </button>
        {TYPE_ORDER.map((t) => {
          const meta = TYPE_META[t];
          const count = byType.filter((e) => e.type === t).length;
          return (
            <button key={t} onClick={() => setType(t)} style={chipStyle(type === t, true)}>
              <Icon name={meta.icon} size={11} />
              {meta.label.charAt(0) + meta.label.slice(1).toLowerCase()}
              <span style={{ fontSize: 10.5, color: type === t ? signal.info.strong : text.faint }}>{count}</span>
            </button>
          );
        })}
      </div>

      {query.isLoading ? (
        <span style={{ fontSize: 11.5, color: text.muted }}>Loading the activity timeline…</span>
      ) : filtered.length === 0 ? (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: "rgba(15,23,42,.6)", padding: "46px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, color: signal.info.strong, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="activity" size={20} />
          </span>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>
            {customerId != null ? `No activity for ${customers.find((c) => c.id === customerId)?.name ?? "this customer"}` : type !== "all" ? "No events of that kind" : "No activity yet"}
          </span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>
            Nothing has been scanned, found, scored, delivered or offered across what you can see. An empty feed here is a real answer, not a failed load.
          </span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
            {filtered.map((e, n) => {
              const t = TONE[e.status];
              const meta = TYPE_META[e.type];
              return (
                <div
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  style={{ display: "flex", gap: 13, minWidth: 0, cursor: "pointer", borderRadius: 11, padding: 2 }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto", paddingTop: 11 }}>
                    <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 9, background: t.tint, border: `1px solid ${t.border}`, color: t.strong, padding: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={meta.icon} size={14} />
                    </span>
                    {n < filtered.length - 1 && (
                      <div style={{ width: 1, flex: 1, minHeight: 14, background: "linear-gradient(rgba(148,163,184,.22),rgba(148,163,184,.05))" }} />
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1, padding: "11px 11px 17px 0" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{e.title}</span>
                      <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: t.strong, whiteSpace: "nowrap" }}>{meta.label}</span>
                    </div>
                    {e.description && <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{e.description}</span>}
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: e.customerName ? signal.info.text : text.label, whiteSpace: "nowrap" }}>
                        <Icon name={e.customerName ? "building-2" : "circle-help"} size={11} />
                        {e.customerName ?? "Customer not in your list"}
                      </span>
                      <span style={{ fontSize: 11, color: text.faint }}>{fmtWhen(e.timestamp)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
            <button
              onClick={() => hasMore && query.fetchNextPage()}
              disabled={!hasMore || query.isFetchingNextPage}
              title={hasMore ? "" : "Every source came back under its own cap, so this is genuinely the end"}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 33, padding: "0 13px", borderRadius: 8,
                border: `1px solid ${hasMore ? border.card : "rgba(148,163,184,.16)"}`, background: "transparent",
                color: hasMore ? text.secondary : text.label, fontSize: 12.5, fontWeight: 600,
                cursor: hasMore ? (query.isFetchingNextPage ? "wait" : "pointer") : "not-allowed", opacity: hasMore ? 1 : 0.6, whiteSpace: "nowrap",
              }}
            >
              <Icon name={hasMore ? "chevron-down" : "check"} size={13} />
              {query.isFetchingNextPage ? "Loading…" : hasMore ? "Load older events" : "Nothing older"}
            </button>
            <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", flex: 1, minWidth: 180 }}>
              {hasMore
                ? "Paging is by timestamp, not page number. If something new lands while you read, it will not appear until you reload."
                : "This is the whole feed. The end is real, not a page that stopped offering more."}
            </span>
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Scans still running are left out entirely, only warning and critical findings appear, score moves under 5 points are dropped, and draft offers are not events yet. Open policy incidents live on Alerts and never appear here.
        </span>
      </div>

      {selected && (
        <DetailDrawer event={selected} onClose={() => setSelectedId(null)} onOpenTenant={onOpenTenant} />
      )}
    </div>
  );
}

function DetailDrawer({
  event, onClose, onOpenTenant,
}: { event: TimelineEvent; onClose: () => void; onOpenTenant: (customerId: number) => void }) {
  const t = TONE[event.status];
  const meta = TYPE_META[event.type];
  const facts: { label: string; value: string; color: string; font?: string }[] = [
    { label: "WHEN", value: fmtWhen(event.timestamp), color: text.secondary },
    { label: "CUSTOMER", value: event.customerName ?? "not in your list", color: event.customerName ? signal.info.text : text.label },
    { label: "EVENT ID", value: event.id, color: text.muted, font: "Menlo, monospace" },
    { label: "SOURCE", value: event.id.split(":")[0], color: text.muted, font: "Menlo, monospace" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(450px,94%)", height: "100%", background: surface.popover, borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ width: 32, height: 32, flex: "0 0 32px", borderRadius: 10, background: t.tint, border: `1px solid ${t.border}`, color: t.strong, padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={meta.icon} size={16} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: t.strong }}>{meta.label}</span>
            <span style={{ fontSize: 16.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{event.title}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {event.description && <span style={{ fontSize: 12.5, color: text.secondary, textWrap: "pretty" }}>{event.description}</span>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
              <span style={{ fontSize: 12.5, color: f.color, fontFamily: f.font ?? "inherit", textWrap: "pretty" }}>{f.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}
        >
          <button
            onClick={event.customerId != null ? () => { onClose(); onOpenTenant(event.customerId!); } : undefined}
            disabled={event.customerId == null}
            title={event.customerId == null ? "This event has no customer attached, so there is nowhere to go" : ""}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 38, borderRadius: 8,
              border: `1px solid ${event.customerId != null ? action.base : border.card}`,
              background: event.customerId != null ? action.base : "transparent",
              color: event.customerId != null ? "#fff" : text.label,
              fontSize: 13, fontWeight: 600, cursor: event.customerId != null ? "pointer" : "not-allowed",
              opacity: event.customerId != null ? 1 : 0.6,
            }}
          >
            <Icon name={event.customerId != null ? "arrow-right" : "circle-slash"} size={14} />
            {event.customerName ? `Open ${event.customerName}` : event.customerId != null ? `Open customer ${event.customerId}` : "No customer to open"}
          </button>
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            {event.customerId != null
              ? "Takes you to the customer, not to the event — there is no per-event screen behind this."
              : "The event is real; the customer behind it sits outside what you can see, so it shows unattributed."}
          </span>
        </div>
      </div>
    </div>
  );
}
