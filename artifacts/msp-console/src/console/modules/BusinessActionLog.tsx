/**
 * Business Action Log — the Audit Log module's second tab (Git #4061,
 * Feature #1946). Mounted from `AuditLog.tsx` alongside the original
 * Security & Session Events tab, same two places (the per-tenant `Client →
 * Audit log` leaf and the `/ops/audit` Operations node) — a second, wholly
 * independent view, not a merged feed and not a replacement (Shane's
 * decision on #4061).
 *
 * Wired against `GET /api/audit-logs` (`artifacts/api-server/src/routes/audit-logs.ts`,
 * #4044/#4047) via `@/api/business-audit-log-api`. Reads a genuinely
 * different table (`audit_logs`) than the first tab's `msp_audit_logs` — the
 * general, 179+-call-site trail of business actions (tasks, invoices,
 * contracts, projects, offers, status reports…), not security/session
 * events. On the per-tenant mount this is narrowed server-side by
 * `tenantId`; the Operations mount passes none, matching the first tab's
 * per-tenant-vs-MSP-wide precedent.
 *
 * No fixture module, no fabricated row — the coverage figure below is the
 * same honest, computed caveat #4047 built (categorized vs. uncategorized
 * rows), not a claim that every real action is audited.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  ACTION_CATEGORIES, ACTION_CATEGORY_LABELS, ACTOR_ROLES, ACTOR_ROLE_LABELS,
  BusinessAuditLogApiError, useBusinessAuditLog,
  type BusinessAuditLogEntry, type BusinessAuditLogFilters,
} from "@/api/business-audit-log-api";

const LIMIT = 30;

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

function selectStyle(): React.CSSProperties {
  return { ...fieldStyle(), appearance: "auto" as const };
}

export function BusinessActionLog({
  tenantId, customerName,
}: {
  tenantId?: number;
  customerName?: string;
}) {
  const [actionCategory, setActionCategory] = useState("all");
  const [actorRole, setActorRole] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => { setPage(1); }, [actionCategory, actorRole, entityType, from, to, tenantId]);

  const filters: BusinessAuditLogFilters = {
    page, limit: LIMIT, actionCategory, actorRole, entityType, from, to, tenantId,
  };
  const query = useBusinessAuditLog(filters);
  const data = query.data;

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? LIMIT;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const open = openId != null ? entries.find((e) => e.id === openId) ?? null : null;

  const entityTypes = Array.from(new Set(entries.map((e) => e.entityType))).sort();

  const clearFilters = () => {
    setActionCategory("all"); setActorRole("all"); setEntityType("all"); setFrom(""); setTo(""); setPage(1);
  };

  if (query.isError) {
    const status = query.error instanceof BusinessAuditLogApiError ? query.error.status : null;
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

      {/* Filters */}
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, minWidth: 0 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ACTION CATEGORY</span>
            <select value={actionCategory} onChange={(e) => setActionCategory(e.target.value)} style={selectStyle()}>
              <option value="all">All categories</option>
              <option value="uncategorized">Uncategorized (legacy)</option>
              {ACTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>{ACTION_CATEGORY_LABELS[c] ?? c}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ACTOR ROLE</span>
            <select value={actorRole} onChange={(e) => setActorRole(e.target.value)} style={selectStyle()}>
              <option value="all">All roles</option>
              {ACTOR_ROLES.map((r) => (
                <option key={r} value={r}>{ACTOR_ROLE_LABELS[r] ?? r}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ENTITY TYPE</span>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={selectStyle()}>
              <option value="all">All types</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>Options are drawn from the current page's rows, not a fixed catalogue.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>FROM</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2026-09-01" style={fieldStyle()} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>TO</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="2026-09-13" style={fieldStyle()} />
            <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>Runs to the end of that day, not midnight.</span>
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }} />
          <button onClick={clearFilters} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 6, background: "transparent", border: `1px solid ${border.card}`, fontSize: 11, fontWeight: 600, color: text.muted, cursor: "pointer", fontFamily: "inherit" }}>
            Clear
          </button>
        </div>
      </div>

      {/* Coverage caveat — real, computed, honest: not a claim every real action is audited. */}
      {data?.coverage && (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 10, background: "rgba(148,163,184,.06)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: text.strong }}>
            {data.coverage.categorizedPercent != null ? `${data.coverage.categorizedPercent}% categorized` : "No rows in this view"}
            {data.coverage.totalRows > 0 && ` — ${data.coverage.categorizedRows} categorized, ${data.coverage.uncategorizedRows} uncategorized (legacy, pre-2026-09-14)`}
          </span>
          <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" }}>{data.coverageNote}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        {/* Entries */}
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: "span 2" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Entries</span>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
              {query.isLoading ? "Loading…" : `${total} matching · newest first`}
            </span>
          </div>

          {query.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading the audit log…</span>
          ) : entries.length > 0 ? (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 760 }}>
                <div style={{ display: "grid", gridTemplateColumns: "150px 1.4fr 1fr 1.5fr 1.2fr", gap: 12, padding: "0 12px 6px", borderBottom: `1px solid ${border.soft}` }}>
                  {["WHEN", "ACTOR", "CATEGORY", "ACTION", "RESOURCE"].map((h) => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{h}</span>
                  ))}
                </div>
                {entries.map((e) => {
                  const on = e.id === openId;
                  return (
                    <button
                      key={e.id}
                      onClick={() => setOpenId(e.id)}
                      style={{
                        display: "grid", gridTemplateColumns: "150px 1.4fr 1fr 1.5fr 1.2fr", gap: 12, alignItems: "center",
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
                        <span style={{ fontSize: 12, fontWeight: 600, color: text.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.actorName}</span>
                        <span style={{ fontSize: 10.5, color: text.label, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ACTOR_ROLE_LABELS[e.actorRole] ?? e.actorRole}</span>
                      </span>
                      <span style={{ fontSize: 11, color: e.actionCategory ? text.secondary : text.faint }}>
                        {e.actionCategory ? (ACTION_CATEGORY_LABELS[e.actionCategory] ?? e.actionCategory) : "Uncategorized"}
                      </span>
                      <span style={{ fontSize: 11.5, fontFamily: "Menlo, monospace", color: signal.info.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.actionType}</span>
                      <span style={{ fontSize: 11.5, color: e.entityLabel || e.entityType ? text.secondary : text.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.entityLabel ?? e.entityType ?? "—"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "26px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>{total === 0 && actionCategory === "all" && actorRole === "all" && entityType === "all" && from === "" && to === "" ? "No entries" : "Nothing matches these filters"}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 460 }}>A real 200 with an empty page — not proof nothing happened.</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 200 }}>
              Page {page} of {pages} · {pageSize} per page, 100 at most
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
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 320 }}>The row shows the aliased summary; the detail shows the raw metadata behind it.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ entry: e }: { entry: BusinessAuditLogEntry }) {
  const facts: { label: string; value: string; note: string; color: string; font?: string }[] = [
    { label: "WHEN IT HAPPENED", value: `${fmtWhen(e.createdAt)} · ${fmtClock(e.createdAt)}`, note: "Sent as createdAt.", color: text.strong },
    { label: "ACTOR", value: e.actorName, note: e.actorRole ? (ACTOR_ROLE_LABELS[e.actorRole] ?? e.actorRole) : "—", color: text.strong },
    { label: "ACTION TYPE", value: e.actionType, note: "The open, per-call-site verb — not a closed vocabulary.", color: text.secondary, font: "Menlo, monospace" },
    { label: "CATEGORY", value: e.actionCategory ? (ACTION_CATEGORY_LABELS[e.actionCategory] ?? e.actionCategory) : "Uncategorized", note: e.actionCategory ? "The coarse, filterable operation class." : "Row predates the action-category system — not reinterpreted.", color: text.secondary },
    { label: "ENTITY", value: e.entityLabel ?? e.entityType, note: e.entityLabel ? `Type: ${e.entityType}` : "No label recorded — showing the entity type.", color: text.strong },
    { label: "TENANT", value: e.tenantId != null ? String(e.tenantId) : "none", note: "Not every audited action is tenant-scoped — platform-wide actions have none.", color: text.secondary },
  ];
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", fontFamily: "Menlo, monospace", color: text.title, wordBreak: "break-all" }}>{e.actionType}</span>
        </span>
      </div>

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
          <span style={{ fontSize: 11.5, color: text.label }}>None recorded for this row.</span>
        )}
      </div>
    </div>
  );
}
