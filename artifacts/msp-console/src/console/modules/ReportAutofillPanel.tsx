/**
 * ReportAutofillPanel — "Autofill from a delivery project" (Git #4248), a
 * sub-panel of the Status Reports module page (`StatusReports.tsx`). Wires
 * `GET /admin/projects/:id/report-autofill` (`admin-projects.ts:918`), a real,
 * previously-dead-code route (filed as the finding this issue builds against)
 * that summarizes one delivery project's completed/pending workflow steps and
 * completed Kanban tasks for status-report drafting.
 *
 * `#4246` (relocating the Delivery Projects Kanban UI itself into MSP Console)
 * has not landed as of this build, so there is no per-project detail screen in
 * MSP Console to hang this off of yet — this panel lives on the tenant's
 * Status Reports page instead and picks a project itself. When #4246 lands,
 * the natural move is a "Draft a status report" action on that project's own
 * detail screen that deep-links here with the project pre-selected; until
 * then this is the real, current MSP Console surface for it.
 *
 * `projectsTable.clientUserId` (the Delivery Projects axis) has no FK to
 * `tenantsTable` (the axis this page's `customerId` is scoped to) — see
 * `report-autofill-api.ts`'s own header, and `invoices-api.ts`'s identical,
 * earlier-documented gap. So this panel does not try to infer "this tenant's"
 * projects; it carries its own client picker (`useMspClients`, already scoped
 * to this MSP server-side) exactly like the Invoices tab does.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import { useMspClients } from "@/api/invoices-api";
import {
  ReportAutofillApiError,
  useDeliveryProjectsForClient,
  useReportAutofill,
  type ReportAutofillResponse,
} from "@/api/report-autofill-api";

export interface DraftFromAutofill {
  periodLabel: string;
  asOfDate: string;
  content: string;
}

function composeDraftContent(data: ReportAutofillResponse): string {
  const lines: string[] = [];
  const clientLabel = data.client ? (data.client.company ?? data.client.name ?? data.client.email) : null;
  lines.push(`Status update — ${data.project.title}${clientLabel ? ` (${clientLabel})` : ""}`);
  lines.push(
    `Overall progress: ${data.project.progress}% (${data.completedStepsCount} of ${data.totalSteps} phase${data.totalSteps === 1 ? "" : "s"} complete).`,
  );
  if (data.blockedCount > 0) {
    lines.push(`${data.blockedCount} phase${data.blockedCount === 1 ? "" : "s"} currently blocked — needs attention before it can move.`);
  }

  if (data.completedSteps.length > 0) {
    lines.push("", "Completed since the last update:");
    for (const s of data.completedSteps) lines.push(`- ${s.title}${s.description ? `: ${s.description}` : ""}`);
  }

  if (data.completedTasks.length > 0) {
    lines.push("", "Tasks closed:");
    for (const t of data.completedTasks) {
      const suffix = t.completionNotes ? ` — ${t.completionNotes}` : t.completionStatus ? ` (${t.completionStatus})` : "";
      lines.push(`- ${t.title}${suffix}`);
    }
  }

  if (data.pendingSteps.length > 0) {
    lines.push("", "Upcoming:");
    for (const s of data.pendingSteps) lines.push(`- [${s.label}] ${s.title}${s.description ? `: ${s.description}` : ""}`);
  }

  return lines.join("\n").trim();
}

const inputStyle: React.CSSProperties = {
  height: 32, padding: "0 9px", borderRadius: 6, border: `1px solid ${border.soft}`,
  background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12, fontFamily: "inherit", outline: "none", minWidth: 0,
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

function primaryBtnDisabled(disabled: boolean): React.CSSProperties {
  return disabled
    ? { ...primaryBtn, border: `1px solid ${border.card}`, background: "transparent", color: text.faint, cursor: "not-allowed" }
    : primaryBtn;
}

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${border.card}`,
  background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

export function ReportAutofillPanel({
  mspId,
  onUseAsDraft,
}: {
  mspId: number;
  onUseAsDraft: (draft: DraftFromAutofill) => void;
}) {
  const [clientUserId, setClientUserId] = useState<number | "">("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [sinceDate, setSinceDate] = useState("");
  const [active, setActive] = useState<{ projectId: number; since: string | null } | null>(null);

  const clientsQuery = useMspClients(mspId);
  const projectsQuery = useDeliveryProjectsForClient(typeof clientUserId === "number" ? clientUserId : null);
  const autofillQuery = useReportAutofill(active?.projectId ?? null, active?.since ?? null);

  const projects = projectsQuery.data ?? [];
  const data = autofillQuery.data ?? null;

  const generate = () => {
    if (typeof projectId !== "number") return;
    setActive({ projectId, since: sinceDate.trim() ? new Date(sinceDate).toISOString() : null });
  };

  const useAsDraft = () => {
    if (!data) return;
    onUseAsDraft({
      periodLabel: data.lastReportPeriod ?? "",
      asOfDate: new Date().toISOString(),
      content: composeDraftContent(data),
    });
  };

  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="sparkles" size={14} color={signal.info.strong} />
          Autofill from a delivery project
        </span>
        <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
          Pulls a project's completed/pending phases and closed tasks into draft prose you can edit before saving. This
          reads the Delivery Projects pipeline (the fixed five-column board), a different system from this tenant's own
          record — pick the client and project explicitly below.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: text.muted }}>Client</span>
          <select
            value={clientUserId}
            onChange={(e) => {
              setClientUserId(e.target.value ? Number(e.target.value) : "");
              setProjectId("");
              setActive(null);
            }}
            style={selectStyle}
          >
            <option value="">Select a client…</option>
            {(clientsQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name ?? c.email}{c.company ? ` — ${c.company}` : ""}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: text.muted }}>Delivery project</span>
          <select
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value ? Number(e.target.value) : ""); setActive(null); }}
            disabled={clientUserId === "" || projectsQuery.isLoading}
            style={selectStyle}
          >
            <option value="">
              {clientUserId === "" ? "Pick a client first…" : projectsQuery.isLoading ? "Loading…" : projects.length === 0 ? "No delivery projects for this client" : "Select a project…"}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title} ({p.status})</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 150 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: text.muted }}>Since (optional)</span>
          <input type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)} style={inputStyle} />
        </label>

        <button onClick={generate} disabled={projectId === ""} style={primaryBtnDisabled(projectId === "")}>
          Generate draft
        </button>
      </div>

      {projectsQuery.isError && (
        <span style={{ fontSize: 11, color: signal.warning.strong }}>
          {projectsQuery.error instanceof ReportAutofillApiError ? projectsQuery.error.message : "Couldn't load this client's delivery projects."}
        </span>
      )}

      {active && autofillQuery.isLoading && (
        <span style={{ fontSize: 11.5, color: text.muted }}>Loading project summary…</span>
      )}

      {active && autofillQuery.isError && (
        <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 10, background: signal.critical.tint, padding: 12 }}>
          <span style={{ fontSize: 12, color: signal.critical.text }}>
            {autofillQuery.error instanceof ReportAutofillApiError ? autofillQuery.error.message : "The request failed."}
          </span>
        </div>
      )}

      {data && (
        <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 160 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.strong, textWrap: "pretty" }}>{data.project.title}</span>
              <span style={{ fontSize: 11, color: text.muted }}>
                {data.client ? (data.client.company ?? data.client.name ?? data.client.email) : "No client on record"} · {data.project.status}
              </span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: signal.info.tint, border: `1px solid ${signal.info.border}`, fontSize: 10.5, fontWeight: 600, color: signal.info.strong }}>
              {data.project.progress}% complete
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
            {[
              { label: "PHASES", value: `${data.completedStepsCount} / ${data.totalSteps}` },
              { label: "BLOCKED", value: String(data.blockedCount), warn: data.blockedCount > 0 },
              { label: "TASKS CLOSED", value: String(data.completedTasks.length) },
              { label: "LAST REPORT", value: data.lastReportDate ? data.lastReportDate.slice(0, 10) : "None on file" },
            ].map((f) => (
              <span key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>{f.label}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: f.warn ? signal.warning.strong : text.strong }}>{f.value}</span>
              </span>
            ))}
          </div>

          {data.completedSteps.length > 0 && (
            <SummarySection title="Completed steps" items={data.completedSteps.map((s) => `${s.title}${s.description ? ` — ${s.description}` : ""}`)} />
          )}
          {data.pendingSteps.length > 0 && (
            <SummarySection title="Pending steps" items={data.pendingSteps.map((s) => `[${s.label}] ${s.title}${s.description ? ` — ${s.description}` : ""}`)} />
          )}
          {data.completedTasks.length > 0 && (
            <SummarySection title="Tasks closed" items={data.completedTasks.map((t) => `${t.title}${t.completionNotes ? ` — ${t.completionNotes}` : ""}`)} />
          )}
          {data.completedSteps.length === 0 && data.pendingSteps.length === 0 && data.completedTasks.length === 0 && (
            <span style={{ fontSize: 11.5, color: text.faint, textWrap: "pretty" }}>
              Nothing recorded for this project{active?.since ? " in the selected window" : ""} — the honest current state, not an error.
            </span>
          )}

          <div>
            <button onClick={useAsDraft} style={secondaryBtn}>Use as a new draft</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummarySection({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", color: text.label }}>{title.toUpperCase()}</span>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it, i) => (
          <li key={i} style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty", paddingLeft: 12, position: "relative" }}>
            <span style={{ position: "absolute", left: 0, color: text.faint }}>–</span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
