/**
 * CRM screen body — Pipeline (real Zoho Deals, grouped by their own live
 * Stage), Leads (real Zoho Leads), Connections (Zoho + EngageBay status,
 * this session's queued writes, EngageBay webhook activity).
 *
 * Everything here reads `crmStore`, a plain external store — see that file's
 * doc comment for why this can't just be `useState`. Deal detail lives in the
 * right (Properties) panel (`DealPropertiesPanel.tsx`); a lead is handled via
 * the shell peek (handoff.md section 5: click a row, deal with it, stay put).
 */

import { useState, useSyncExternalStore } from "react";
import { useShell } from "../../shell/ShellContext";
import { ACCENT, ACCENT_TEXT, LINE, PRIMARY, PRIMARY_OVERLAY, SURFACE, TEXT } from "../../theme";
import {
  closeNewLeadForm,
  createLead,
  getSnapshot,
  openNewLeadForm,
  selectDeal,
  setView,
  subscribe,
  type CrmStoreState,
  type CrmView,
} from "./crmStore";
import {
  dealName,
  formatShortDate,
  formatUsd,
  leadCompany,
  leadDisplayName,
  zohoOwnerName,
  type ZohoRecord,
} from "./zohoTypes";
import { LeadRecordBody } from "./LeadRecordBody";

export function CrmBody({ recordId }: { recordId?: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  if (recordId) {
    return <LeadRecordBody id={recordId} />;
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <ViewTabs state={state} />
      {state.lastMessage && (
        <div style={{ padding: "8px 20px", fontSize: 12, color: ACCENT_TEXT.green, borderBottom: `1px solid ${LINE.quiet}` }}>
          {state.lastMessage}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {state.view === "pipeline" && <PipelineView state={state} />}
        {state.view === "leads" && <LeadsView state={state} />}
        {state.view === "connections" && <ConnectionsView state={state} />}
      </div>
    </div>
  );
}

function ViewTabs({ state }: { state: CrmStoreState }) {
  const tabs: Array<{ id: CrmView; label: string }> = [
    { id: "pipeline", label: "Pipeline" },
    { id: "leads", label: "Leads" },
    { id: "connections", label: "Connections" },
  ];
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "10px 20px 0" }}>
      {tabs.map((tab) => {
        const on = state.view === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              padding: "7px 13px",
              borderRadius: "6px 6px 0 0",
              border: `1px solid ${on ? LINE.control : "transparent"}`,
              borderBottom: on ? `1px solid ${SURFACE.app}` : "1px solid transparent",
              background: on ? SURFACE.app : "transparent",
              color: on ? TEXT.bright : TEXT.meta,
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
              cursor: "pointer",
              position: "relative",
              top: 1,
            }}
          >
            {tab.label}
          </button>
        );
      })}
      <div style={{ flex: 1, borderBottom: `1px solid ${LINE.group}` }} />
    </div>
  );
}

// ── Pipeline ───────────────────────────────────────────────────────────────

function PipelineView({ state }: { state: CrmStoreState }) {
  if (state.dealsLoading && state.deals.length === 0) return <Placeholder text="Loading deals from Zoho…" />;
  if (state.dealsError) return <Placeholder text={state.dealsError} tone={ACCENT_TEXT.danger} />;
  if (state.deals.length === 0) return <Placeholder text="No deals in Zoho, or none matched. Try Refresh from Zoho." />;

  const columns = new Map<string, ZohoRecord[]>();
  for (const deal of state.deals) {
    const stage = typeof deal.Stage === "string" && deal.Stage ? deal.Stage : "No stage";
    const list = columns.get(stage) ?? [];
    list.push(deal);
    columns.set(stage, list);
  }

  return (
    <div style={{ display: "flex", gap: 14, padding: 18, alignItems: "flex-start", overflowX: "auto" }}>
      {[...columns.entries()].map(([stage, deals]) => (
        <div key={stage} style={{ flex: "0 0 250px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 2px" }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.caption }}>
              {stage}
            </span>
            <span style={{ fontSize: 11, color: TEXT.faint }}>{deals.length}</span>
          </div>
          {deals.map((deal) => (
            <DealCard key={String(deal.id)} deal={deal} selected={String(deal.id) === state.selectedDealId} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DealCard({ deal, selected }: { deal: ZohoRecord; selected: boolean }) {
  return (
    <button
      onClick={() => selectDeal(String(deal.id))}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 11,
        borderRadius: 7,
        border: `1px solid ${selected ? PRIMARY : LINE.base}`,
        background: selected ? "rgba(15,108,189,.1)" : SURFACE.card,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.primary }}>{dealName(deal)}</span>
      <span style={{ fontSize: 11.5, color: TEXT.meta }}>
        {typeof deal.Account_Name === "object" && deal.Account_Name
          ? String((deal.Account_Name as { name?: unknown }).name ?? "No account")
          : String(deal.Account_Name ?? "No account")}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: ACCENT_TEXT.green }}>{formatUsd(deal.Amount)}</span>
        <span style={{ fontSize: 10.5, color: TEXT.faint }}>{formatShortDate(deal.Closing_Date)}</span>
      </div>
    </button>
  );
}

// ── Leads ──────────────────────────────────────────────────────────────────

function LeadsView({ state }: { state: CrmStoreState }) {
  const shell = useShell();

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 20px 0" }}>
        {state.newLeadFormOpen ? (
          <NewLeadForm />
        ) : (
          <button
            onClick={openNewLeadForm}
            style={{
              padding: "7px 13px",
              borderRadius: 6,
              border: `1px solid ${LINE.control}`,
              background: "transparent",
              color: TEXT.strong,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            New lead
          </button>
        )}
      </div>

      {state.leadsLoading && state.leads.length === 0 && <Placeholder text="Loading leads from Zoho…" />}
      {state.leadsError && <Placeholder text={state.leadsError} tone={ACCENT_TEXT.danger} />}
      {!state.leadsLoading && !state.leadsError && state.leads.length === 0 && (
        <Placeholder text="No leads in Zoho, or none matched. Try Refresh from Zoho." />
      )}

      {state.leads.length > 0 && (
        <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 1 }}>
          {state.leads.map((lead) => (
            <LeadRow key={String(lead.id)} lead={lead} onOpen={() => shell.openPeek("lead", String(lead.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeadRow({ lead, onOpen }: { lead: ZohoRecord; onOpen: () => void }) {
  return (
    <button
      className="av2-row"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        padding: "10px 12px",
        border: 0,
        borderBottom: `1px solid ${LINE.subtle}`,
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {leadCompany(lead)}
        </span>
        <span style={{ fontSize: 11.5, color: TEXT.meta, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {leadDisplayName(lead)} · {String(lead.Email ?? "no email")}
        </span>
      </div>
      <span style={{ flex: "0 0 130px", fontSize: 11.5, color: TEXT.meta }}>{String(lead.Lead_Status ?? "—")}</span>
      <span style={{ flex: "0 0 150px", fontSize: 11.5, color: TEXT.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {String(lead.Lead_Source ?? "—")}
      </span>
      <span style={{ flex: "0 0 110px", fontSize: 11, color: TEXT.faint }}>{zohoOwnerName(lead)}</span>
    </button>
  );
}

function NewLeadForm() {
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = lastName.trim() && company.trim() && !submitting;
  const fieldStyle = {
    width: "100%",
    height: 30,
    marginTop: 4,
    padding: "0 9px",
    borderRadius: 5,
    border: `1px solid ${LINE.control}`,
    background: SURFACE.root,
    color: TEXT.strong,
    fontFamily: "inherit",
    fontSize: 12.5,
    outline: "none",
  } as const;

  async function submit() {
    setSubmitting(true);
    const ok = await createLead({
      Last_Name: lastName.trim(),
      Company: company.trim(),
      ...(email.trim() ? { Email: email.trim() } : {}),
      ...(phone.trim() ? { Phone: phone.trim() } : {}),
    });
    setSubmitting(false);
    if (ok) {
      setLastName("");
      setCompany("");
      setEmail("");
      setPhone("");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420, padding: 14, border: `1px solid ${LINE.base}`, borderRadius: 8, background: SURFACE.card }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.primary }}>New lead</div>
      <label>
        <span style={{ fontSize: 11, color: TEXT.groupLabel }}>Last name (required)</span>
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={fieldStyle} />
      </label>
      <label>
        <span style={{ fontSize: 11, color: TEXT.groupLabel }}>Company (required)</span>
        <input value={company} onChange={(e) => setCompany(e.target.value)} style={fieldStyle} />
      </label>
      <label>
        <span style={{ fontSize: 11, color: TEXT.groupLabel }}>Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} />
      </label>
      <label>
        <span style={{ fontSize: 11, color: TEXT.groupLabel }}>Phone</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} style={fieldStyle} />
      </label>
      <div style={{ fontSize: 10.5, color: TEXT.faint }}>Zoho requires Last name on every Lead.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!canSubmit}
          onClick={() => void submit()}
          style={{
            alignSelf: "flex-start",
            padding: "7px 14px",
            borderRadius: 6,
            border: 0,
            background: PRIMARY_OVERLAY,
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          Queue lead creation
        </button>
        <button
          onClick={closeNewLeadForm}
          style={{
            alignSelf: "flex-start",
            padding: "7px 14px",
            borderRadius: 6,
            border: `1px solid ${LINE.control}`,
            background: "transparent",
            color: TEXT.meta,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Connections ────────────────────────────────────────────────────────────

function ConnectionsView({ state }: { state: CrmStoreState }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 20, maxWidth: 760 }}>
      <ConnectionCard
        name="Zoho CRM"
        status={state.zohoStatus?.connection.status ?? (state.zohoStatusLoading ? "loading…" : "unknown")}
        detail={
          state.zohoStatus
            ? [
                state.zohoStatus.connection.zohoOrgId ? `Org ${state.zohoStatus.connection.zohoOrgId}` : null,
                state.zohoStatus.connection.lastRefreshedAt
                  ? `Token refreshed ${formatShortDate(state.zohoStatus.connection.lastRefreshedAt)}`
                  : null,
                state.zohoStatus.connection.lastErrorMessage,
                !state.zohoStatus.credentialsConfigured ? "No Zoho credentials configured on this server." : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : ""
        }
      />
      <ConnectionCard
        name="EngageBay"
        status={state.engagebayStatus?.connection.status ?? (state.engagebayStatusLoading ? "loading…" : "unknown")}
        detail={[state.engagebayStatus?.connection.lastErrorMessage].filter(Boolean).join(" · ")}
      />

      <div>
        <SectionHeading>Writes queued this session</SectionHeading>
        <div style={{ fontSize: 11, color: TEXT.faint, marginBottom: 8, lineHeight: 1.5 }}>
          These apply on the next automatic Zoho/EngageBay sync (~5 minutes). This is only what this browser
          tab itself queued — there is no server view of the full queue yet.
        </div>
        {state.recentWrites.length === 0 ? (
          <div style={{ fontSize: 11.5, color: TEXT.faint }}>Nothing queued this session.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.recentWrites.map((w) => (
              <div
                key={w.jobId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 11px",
                  borderRadius: 6,
                  border: `1px solid ${LINE.base}`,
                  background: SURFACE.card,
                  fontSize: 11.5,
                }}
              >
                <span
                  style={{
                    flex: "none",
                    minWidth: 60,
                    textAlign: "center",
                    padding: "2px 7px",
                    borderRadius: 4,
                    fontSize: 9.5,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    color:
                      w.state === "synced" ? ACCENT_TEXT.green : w.state === "failed" ? ACCENT_TEXT.danger : ACCENT.amber,
                    background:
                      w.state === "synced" ? "rgba(146,216,174,.14)" : w.state === "failed" ? "rgba(229,122,122,.14)" : "rgba(242,202,99,.14)",
                  }}
                >
                  {w.state}
                </span>
                <span style={{ flex: 1, color: TEXT.body }}>{w.action}</span>
                {w.detail && <span style={{ color: TEXT.meta }}>{w.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeading>EngageBay webhook activity</SectionHeading>
        {state.engagebayActivityLoading && state.engagebayActivity.length === 0 && (
          <div style={{ fontSize: 11.5, color: TEXT.faint }}>Loading…</div>
        )}
        {!state.engagebayActivityLoading && state.engagebayActivity.length === 0 && (
          <div style={{ fontSize: 11.5, color: TEXT.faint, lineHeight: 1.5 }}>
            No events. Realistic if no EngageBay webhook has fired against this platform yet.
          </div>
        )}
        {state.engagebayActivity.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.engagebayActivity.map((event) => (
              <div key={event.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 11px", borderRadius: 6, border: `1px solid ${LINE.base}`, fontSize: 11.5 }}>
                <span style={{ flex: 1, color: TEXT.body }}>{event.eventType ?? "event"}</span>
                <span style={{ color: TEXT.meta }}>{event.status}</span>
                <span style={{ color: TEXT.faint }}>{formatShortDate(event.firedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionCard({ name, status, detail }: { name: string; status: string; detail: string }) {
  const connected = status === "connected";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 8, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: connected ? ACCENT.greenBright : status === "loading…" ? TEXT.faint : ACCENT.danger,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.bright }}>{name}</span>
        <span style={{ fontSize: 11, color: connected ? ACCENT_TEXT.green : TEXT.meta }}>{status}</span>
      </div>
      {detail && <span style={{ fontSize: 11.5, color: TEXT.meta, lineHeight: 1.5 }}>{detail}</span>}
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.caption, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Placeholder({ text, tone }: { text: string; tone?: string }) {
  return (
    <div style={{ padding: 20, fontSize: 12.5, color: tone ?? TEXT.faint, lineHeight: 1.5 }}>{text}</div>
  );
}
