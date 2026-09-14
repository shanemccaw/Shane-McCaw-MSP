/**
 * Audit Log — MSP Console module page (#4012, Feature #3752).
 * Mounted twice from this one component
 * (`Design/MSP_Console/design_handoff_msp_console/Audit Log.dc.html`,
 * README screen 63): the per-tenant leaf (`Client → Audit log`, passing
 * `customerId`/`customerName`) and the Operations node (`/ops/audit`,
 * passing neither). Same file, one prop — not two screens.
 *
 * Wired against `GET /api/msp/audit` (`artifacts/api-server/src/routes/msp-audit-log.ts`)
 * via `@/api/audit-log-api`. The `customerId` server-side filter (#3671) and
 * the regenerated contract pack (#3682) are both confirmed live on `main` as
 * of this build. Search matches action/entityType/entityLabel/actorRole only
 * — never names, addresses, ids or metadata, same as the route's own `search`
 * clause. An unreadable `from`/`to` date is dropped silently by the route; a
 * `to` date runs to the end of that day.
 *
 * The design's SEED mock carries fabricated aggregate counts ("94% are
 * sign-in…", "535 rows in the table…") that nothing on the wire returns —
 * those are the design tool's own commentary, not real data, and are
 * deliberately not reproduced here. Every number this page shows (the total,
 * the page count, the rows themselves) comes from the real response.
 *
 * No fixture module, no fabricated row.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  actionConvention, AuditLogApiError, HIDDEN_COLUMNS, isFallbackActor, useAuditLog,
  type AuditLogEntry, type AuditLogFilters,
} from "@/api/audit-log-api";

const LIMIT = 30;

type Tone = { strong: string; text?: string; tint: string; border: string };

const OUTCOME_TONE: Record<AuditLogEntry["outcome"], Tone> = {
  success: signal.ok,
  failure: signal.critical,
  partial: signal.warning,
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(11, 19) + " UTC";
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px",
    borderRadius: 999, border: `1px solid ${active ? border.hover : border.card}`,
    background: active ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)",
    fontSize: 11, fontWeight: 600, color: active ? text.strong : text.muted, cursor: "pointer", fontFamily: "inherit",
  };
}

function fieldStyle(): React.CSSProperties {
  return {
    height: 34, padding: "0 11px", borderRadius: 6, border: `1px solid ${border.card}`,
    background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, fontFamily: "inherit", outline: "none", minWidth: 0,
  };
}

export function AuditLog({
  customerId, customerName, embedded = true, forceEmpty = false, isPlatformAdmin = false, ownMspId = null, ownMspLabel = "your MSP",
}: {
  customerId?: number;
  customerName?: string;
  embedded?: boolean;
  forceEmpty?: boolean;
  isPlatformAdmin?: boolean;
  ownMspId?: number | null;
  ownMspLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [actionType, setActionType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [outcome, setOutcome] = useState<AuditLogFilters["outcome"]>("any");
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => { setPage(1); }, [q, actionType, from, to, outcome, scope, customerId]);

  const filters: AuditLogFilters = {
    page, limit: LIMIT, search: q, actionType, outcome, from, to,
    customerId,
    mspId: isPlatformAdmin && scope === "mine" && ownMspId != null ? ownMspId : undefined,
  };
  const query = useAuditLog(filters);
  const data = forceEmpty ? { entries: [], total: 0, page: 1, limit: LIMIT } : query.data;

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const open = openId != null ? entries.find((e) => e.id === openId) ?? null : null;

  const clearFilters = () => {
    setQ(""); setActionType(""); setFrom(""); setTo(""); setOutcome("any"); setPage(1);
  };

  if (query.isError) {
    const status = query.error instanceof AuditLogApiError ? query.error.status : null;
    return (
      <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 12, background: signal.critical.tint, padding: "36px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, background: signal.critical.tint, border: `1px solid ${signal.critical.border}`, color: signal.critical.strong, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={status === 403 ? "shield-alert" : "circle-x"} size={20} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: text.title }}>
          {status === 403 ? "MSPAdmin or above is required" : "The audit log did not load"}
        </span>
        <span style={{ fontSize: 12.5, color: text.secondary, maxWidth: 420, textWrap: "pretty" }}>{query.error.message}</span>
        <button onClick={() => query.refetch()} style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 13px", marginTop: 4, borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          <Icon name="rotate-ccw" size={13} />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {!embedded && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 999, background: signal.warning.tint, border: `1px solid ${signal.warning.border}`, fontSize: 11, fontWeight: 600, color: signal.warning.strong }}>
          MSPAdmin or above
        </span>
        {customerName && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 999, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, fontSize: 11, fontWeight: 600, color: signal.ok.text }}>
            <Icon name="building-2" size={11} />
            {customerName}
          </span>
        )}
      </div>

      {isPlatformAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: `1px solid ${signal.info.border}`, borderRadius: 10, background: signal.info.tint, padding: "10px 12px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: signal.info.text }}>MSP SCOPE</span>
          <button onClick={() => setScope("all")} style={chipStyle(scope === "all")}>Every MSP</button>
          <button onClick={() => setScope("mine")} style={chipStyle(scope === "mine")}>{ownMspLabel} only</button>
          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 200 }}>
            A platform administrator sees every MSP unless one is named. An MSP administrator never sees this row: their scope is fixed to their own MSP and the same parameter is silently ignored.
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, minWidth: 0 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, gridColumn: "span 2" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>SEARCH</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="action, entity, label or role" style={fieldStyle()} />
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>Matches the action, the entity type, its label and the actor's role. Not names, addresses, ids or metadata — a search for a person finds nothing.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ACTION TYPE</span>
            <input value={actionType} onChange={(e) => setActionType(e.target.value)} placeholder="substring, e.g. mcp.tool" style={{ ...fieldStyle(), fontFamily: "Menlo, monospace" }} />
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>Three spellings coexist: SCREAMING_SNAKE, dot.namespaced and bare words.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>FROM</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2026-09-01" style={fieldStyle()} />
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>An unreadable date is dropped silently.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>TO</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="2026-09-13" style={fieldStyle()} />
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>Runs to the end of that day, not midnight.</span>
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>OUTCOME</span>
          {(["any", "success", "failure", "partial"] as const).map((o) => (
            <button key={o} onClick={() => setOutcome(o)} style={chipStyle(outcome === o)}>{o[0].toUpperCase() + o.slice(1)}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={clearFilters} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 6, background: "transparent", border: `1px solid ${border.card}`, fontSize: 11, fontWeight: 600, color: text.muted, cursor: "pointer", fontFamily: "inherit" }}>
            Clear
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        {/* Entries */}
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: "span 2" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Entries</span>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
              {query.isLoading ? "Loading…" : `${total} matching · newest first · rows with the same instant have no fixed order`}
            </span>
          </div>

          {query.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading the audit log…</span>
          ) : entries.length > 0 ? (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 760 }}>
                <div style={{ display: "grid", gridTemplateColumns: "150px 1.4fr 1.5fr 1.2fr 120px", gap: 12, padding: "0 12px 6px", borderBottom: `1px solid ${border.soft}` }}>
                  {["WHEN", "ACTOR", "ACTION", "RESOURCE", "OUTCOME"].map((h) => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{h}</span>
                  ))}
                </div>
                {entries.map((e) => {
                  const t = OUTCOME_TONE[e.outcome];
                  const fallback = isFallbackActor(e);
                  const on = e.id === openId;
                  return (
                    <button
                      key={e.id}
                      onClick={() => setOpenId(e.id)}
                      style={{
                        display: "grid", gridTemplateColumns: "150px 1.4fr 1.5fr 1.2fr 120px", gap: 12, alignItems: "center",
                        textAlign: "left", border: `1px solid ${on ? border.hover : border.soft}`, borderRadius: 9,
                        background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: "10px 12px", cursor: "pointer",
                        fontFamily: "inherit", minWidth: 0,
                      }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 11.5, color: text.strong, whiteSpace: "nowrap" }}>{fmtWhen(e.createdAt)}</span>
                        <span style={{ fontSize: 10.5, color: text.label, whiteSpace: "nowrap" }}>{fmtClock(e.createdAt)}</span>
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: fallback ? signal.warning.strong : text.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fallback ? e.actorEmail : (e.actorName || e.actorEmail || "unknown")}
                        </span>
                        <span style={{ fontSize: 10.5, color: fallback ? signal.warning.strong : text.label, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fallback ? "role, not an address" : (e.actorName ? (e.actorEmail ?? "") : (e.actorRole ?? ""))}
                        </span>
                      </span>
                      <span style={{ fontSize: 11.5, fontFamily: "Menlo, monospace", color: signal.info.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.action}</span>
                      <span style={{ fontSize: 11.5, color: e.resource ? text.secondary : text.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.resource ?? "—"}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 20, padding: "0 8px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 10, fontWeight: 600, color: t.text ?? t.strong, justifySelf: "start" }}>{e.outcome}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "26px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>{total === 0 && q === "" && actionType === "" && outcome === "any" && from === "" && to === "" ? "No entries" : "Nothing matches these filters"}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 460 }}>
                A real 200 with an empty page. An MSP administrator whose own account carries no MSP id gets exactly this too — not an error, just nothing — so an empty log is not proof that nothing happened.
              </span>
              <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: text.faint }}>{"{ entries: [], total: 0, page: 1, limit: 30 }"}</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 200 }}>
              Page {page} of {pages} · {LIMIT} per page, 100 at most · the total is a real count from a second query, so it never disagrees with the rows
            </span>
            <button onClick={() => page > 1 && setPage(page - 1)} disabled={page <= 1} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 28, padding: "0 11px", borderRadius: 6, background: "transparent", border: `1px solid ${border.card}`, fontSize: 11.5, fontWeight: 600, color: page > 1 ? text.secondary : text.faint, cursor: page > 1 ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Newer</button>
            <button onClick={() => page < pages && setPage(page + 1)} disabled={page >= pages} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 28, padding: "0 11px", borderRadius: 6, background: "transparent", border: `1px solid ${border.card}`, fontSize: 11.5, fontWeight: 600, color: page < pages ? text.secondary : text.faint, cursor: page < pages ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Older</button>
          </div>
        </div>

        {/* Detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {open ? (
            <DetailPanel entry={open} />
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick an entry</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 320 }}>The row shows the aliased wire fields; the detail shows the raw metadata behind them and what never left the database.</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.strong }}>What this one route does and doesn't give this screen</span>
        {[
          { dot: signal.critical.strong, text: "The email slot can hold a role name. When no user row resolves for an actor, the route falls back to the stored role in the address field and nothing marks that it did — a screen that trusts the field renders “MSPAdmin” where an address should be. This one checks the shape first." },
          { dot: signal.warning.strong, text: "A row left at partial means a write tool recorded its attempt and the process died before finalising it. It is a real, load-bearing state the filter exposes and the route does not explain." },
          { dot: signal.warning.strong, text: `Six stored columns never reach the wire: ${HIDDEN_COLUMNS.join(", ")}. The customer can be filtered on — that landed in #3671 — but still cannot be shown on a row.` },
          { dot: signal.warning.strong, text: "Search covers the action, the entity type, its label and the actor's role. It does not search the actor's name or address, ids or metadata, so “who did things” is not a question the search box answers." },
          { dot: signal.warning.strong, text: "Action types have no shared vocabulary anywhere. Three spellings coexist and every value is a bare string chosen at its own call site." },
          { dot: signal.info.strong, text: "Who may read this log is enforced server-side by the ladder.msp-admin capability. An MSP administrator is pinned to their own MSP and the MSP parameter is ignored for them. A platform administrator sees every MSP unless one is named." },
          { dot: signal.info.strong, text: "The end date runs to the last millisecond of that day, so a range ending on the 13th includes the whole of the 13th. An unreadable date or an unknown outcome is dropped silently rather than refused." },
          { dot: signal.neutral.strong, text: "Newest first with no tiebreaker: two rows at the same instant have no fixed order between page loads. Timestamps mark when the event happened, not when the row was written." },
        ].map((n) => (
          <div key={n.text} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
            <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty", minWidth: 0 }}>{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({ entry: e }: { entry: AuditLogEntry }) {
  const t = OUTCOME_TONE[e.outcome];
  const fallback = isFallbackActor(e);
  const facts: { label: string; value: string; note: string; color: string; font?: string }[] = [
    { label: "WHEN IT HAPPENED", value: `${fmtWhen(e.createdAt)} · ${fmtClock(e.createdAt)}`, note: "Sent as createdAt, but it is the moment the event occurred — for a write tool, the attempt, not the finish.", color: text.strong },
    { label: "EVENT ID", value: e.eventId, note: "The key a write tool finalises its attempt row against.", color: text.secondary, font: "Menlo, monospace" },
    { label: "ACTOR", value: fallback ? (e.actorEmail ?? "") : (e.actorName || "no name on the user row"), note: fallback ? "Resolved from no user row — see the notes below." : (e.actorEmail ?? ""), color: fallback ? signal.warning.strong : text.strong },
    { label: "STORED ROLE", value: e.actorRole ?? "—", note: "Always the stored value, even when it is also standing in for the address.", color: text.secondary },
    { label: "RESOURCE", value: e.resource ?? "none", note: e.resource ? "The label wins when both a label and a type exist." : "Neither a type nor a label — the sign-in writers set none.", color: e.resource ? text.strong : text.muted },
    { label: "DETAIL", value: e.detail ?? "null", note: "The same metadata rendered as one string, sent alongside the raw object.", color: text.secondary, font: "Menlo, monospace" },
  ];
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", fontFamily: "Menlo, monospace", color: text.title, wordBreak: "break-all" }}>{e.action}</span>
          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{actionConvention(e.action)}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 22, padding: "0 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.text ?? t.strong }}>{e.outcome}</span>
      </div>

      {e.outcome === "partial" && (
        <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Attempted — completion unknown</span>
          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>Write tools record an attempt before they run and finalise it afterwards. A row still marked partial means the process died in between. It is not a failure and not a success, and the log cannot say which the action turned out to be.</span>
        </div>
      )}

      {fallback && (
        <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>The address slot holds a role name</span>
          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>No user row resolved for this actor — a service-driven event, or an account since removed — so the wire fell back to the stored role in the email field. Nothing on the wire marks that it did, which is why this screen checks for it.</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, minWidth: 0 }}>
        {facts.map((f) => (
          <span key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{f.label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: f.color, fontFamily: f.font ?? "inherit", textWrap: "pretty", wordBreak: "break-word" }}>{f.value}</span>
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>{f.note}</span>
          </span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${border.faint}`, paddingTop: 12, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>METADATA · RAW, AS STORED</span>
        {e.metadata ? (
          <pre style={{ margin: 0, padding: 11, borderRadius: 8, border: `1px solid ${border.faint}`, background: "rgba(2,6,23,.6)", fontSize: 11, lineHeight: 1.55, fontFamily: "Menlo, monospace", color: text.secondary, whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}>
            {JSON.stringify(e.metadata, null, 2)}
          </pre>
        ) : (
          <span style={{ fontSize: 11.5, color: text.label }}>None recorded — both the detail string and the raw object are null for this row.</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${border.faint}`, paddingTop: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>STORED BUT NEVER ON THE WIRE</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {HIDDEN_COLUMNS.map((h) => (
            <span key={h} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(148,163,184,.06)", border: "1px dashed rgba(148,163,184,.25)", fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.muted }}>{h}</span>
          ))}
        </div>
        <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>Which customer this touched, where it came from and what client sent it are all in the table and all unreadable from here. The customer can be filtered on but never shown.</span>
      </div>
    </div>
  );
}
