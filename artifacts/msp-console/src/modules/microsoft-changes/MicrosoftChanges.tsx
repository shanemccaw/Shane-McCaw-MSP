/**
 * Microsoft Changes — MSP Console module page (Git #2600, Feature #1688, part
 * of #1494). Mounted by `ConsoleShell` at `/ops/m365changes`. MSP-wide
 * (Operations) rather than per-tenant, same "one page, internal tenant
 * review" shape Retainer Hours uses — an interpretation is authored ONCE per
 * announcement and applies to every tenant (#1532); the per-tenant half
 * (resolutions, routings) is reviewed inside the interpretation's own detail
 * drawer, not a separate tenant-tree node.
 *
 * No Claude Design export exists for this screen (#2599 never landed, per
 * #1688's own body) — built directly against this console's established
 * conventions on Shane's explicit 2026-09-15 authorization. See the banner
 * below.
 *
 * Real scope (#1688's 2026-09-12 decision — authoring lives here, not
 * AdminV2): author the interpretation once per announcement, review the
 * resolution's affected-object counts, review/override the routing decision,
 * handle the propose branch where the gate did not auto-create. All 12
 * routes this page calls already existed and were already gated to
 * `ladder.msp-operator` (#4086) before this build — no backend work was
 * needed, this is UI wiring only.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  useCandidates, useInterpretationsList, type CloudMode, type M365Interpretation, type M365InterpretationStatus,
} from "@/api/m365-changes-api";
import { AuthorInterpretationDrawer, type CandidateSource } from "./AuthorInterpretationDrawer";
import { InterpretationDetailDrawer } from "./InterpretationDetailDrawer";
import { actorLabel, changeClassLabel, formatDate, statusLabel, statusTone } from "./format";

type View = "library" | "candidates";
type CandidateTab = "roadmap" | "message_center";
type StatusFilter = "all" | M365InterpretationStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "proposed", label: "Awaiting confirmation" },
  { id: "confirmed", label: "Confirmed" },
  { id: "rejected", label: "Rejected" },
];

export function MicrosoftChanges({ onOpenTenantPage }: { onOpenTenantPage: (tenant: number, page: string) => void }) {
  const [view, setView] = useState<View>("library");
  const [candidateTab, setCandidateTab] = useState<CandidateTab>("roadmap");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [authorSource, setAuthorSource] = useState<CandidateSource | null>(null);

  const libraryQuery = useInterpretationsList();
  const candidatesQuery = useCandidates("worldwide" as CloudMode);

  const interpretations = libraryQuery.data?.interpretations ?? [];
  const counts = libraryQuery.data?.counts;

  const visible = useMemo(
    () => (statusFilter === "all" ? interpretations : interpretations.filter((r) => r.status === statusFilter)),
    [interpretations, statusFilter],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <AgentBuiltBanner />

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <TabButton active={view === "library"} label="Library" count={interpretations.length} onClick={() => setView("library")} />
        <TabButton active={view === "candidates"} label="Candidates" count={(candidatesQuery.data?.roadmap.length ?? 0) + (candidatesQuery.data?.messageCenter.length ?? 0)} onClick={() => setView("candidates")} />
        <div style={{ flex: 1 }} />
        <button onClick={() => setAuthorSource({ kind: "manual" })} style={primaryBtn}>
          <Icon name="plus" size={13} />
          Author by hand
        </button>
      </div>

      {view === "library" && (
        <LibraryView
          query={libraryQuery}
          counts={counts}
          filter={statusFilter}
          onFilter={setStatusFilter}
          rows={visible}
          onOpen={setSelectedId}
        />
      )}

      {view === "candidates" && (
        <CandidatesView
          tab={candidateTab}
          onTab={setCandidateTab}
          query={candidatesQuery}
          onAuthorRoadmap={(candidate) => setAuthorSource({ kind: "roadmap", candidate })}
          onAuthorMessageCenter={(candidate) => setAuthorSource({ kind: "message_center", candidate })}
        />
      )}

      {authorSource && (
        <AuthorInterpretationDrawer
          source={authorSource}
          onClose={() => setAuthorSource(null)}
          onCreated={(id) => { setAuthorSource(null); setView("library"); setSelectedId(id); }}
        />
      )}

      {selectedId !== null && (
        <InterpretationDetailDrawer id={selectedId} onClose={() => setSelectedId(null)} onOpenTenantPage={onOpenTenantPage} />
      )}
    </div>
  );
}

function AgentBuiltBanner() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "9px 13px",
        border: "1px dashed rgba(251,191,36,.45)", borderRadius: 10, background: "rgba(251,191,36,.06)",
      }}
    >
      <Icon name="triangle-alert" size={15} color={signal.warning.strong} />
      <span style={{ fontSize: 11.5, color: signal.warning.text, textWrap: "pretty" }}>
        Agent-built UI — pending design review. No Claude Design export exists for this screen yet;
        this was built directly against this console's conventions on Shane's explicit authorization.
      </span>
    </div>
  );
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
        border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
        background: active ? "rgba(37,99,235,.18)" : "transparent",
        color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
      <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{count}</span>
    </button>
  );
}

function LibraryView({
  query, counts, filter, onFilter, rows, onOpen,
}: {
  query: ReturnType<typeof useInterpretationsList>;
  counts: { proposed: number; confirmed: number; rejected: number; total: number } | undefined;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
  rows: M365Interpretation[];
  onOpen: (id: number) => void;
}) {
  if (query.isLoading) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ height: 44, borderRadius: 8, background: "rgba(148,163,184,.06)" }} />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 11, background: signal.critical.tint, padding: "16px 18px" }}>
        <span style={{ fontSize: 12, color: text.secondary }}>The interpretation library could not be loaded. Try again shortly.</span>
      </div>
    );
  }
  if ((counts?.total ?? 0) === 0) {
    return (
      <EmptyPanel
        icon="megaphone"
        title="Nothing interpreted yet"
        body="This is the real, current state — nobody has authored an interpretation. Pick a candidate under the Candidates tab, or author one by hand, to start the pipeline for the first time."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {STATUS_FILTERS.map((f) => {
          const active = filter === f.id;
          const n = f.id === "all" ? counts?.total ?? 0 : counts?.[f.id] ?? 0;
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
              {f.label} <span style={{ color: active ? "#60a5fa" : text.faint }}>{n}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{rows.length} of {counts?.total ?? 0}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyPanel icon="filter" title="Nothing matches this filter" body="Pick a different status above." />
      ) : (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr 1fr 1fr 1.1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>TITLE</span><span>CLASS</span><span>WHO ACTS</span><span>STATUS</span><span>UPDATED</span>
            </div>
            {rows.map((r) => {
              const t = statusTone(r.status);
              return (
                <div
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr 1fr 1fr 1.1fr", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{r.title}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{changeClassLabel(r.changeClass)}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{actorLabel(r.whoActs)}</span>
                  <span style={{ display: "inline-flex", justifySelf: "start", padding: "3px 9px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 11, fontWeight: 600, color: t[0], whiteSpace: "nowrap" }}>{statusLabel(r.status)}</span>
                  <span style={{ fontSize: 12, color: text.label, whiteSpace: "nowrap" }}>{formatDate(r.updatedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidatesView({
  tab, onTab, query, onAuthorRoadmap, onAuthorMessageCenter,
}: {
  tab: CandidateTab;
  onTab: (t: CandidateTab) => void;
  query: ReturnType<typeof useCandidates>;
  onAuthorRoadmap: (c: NonNullable<ReturnType<typeof useCandidates>["data"]>["roadmap"][number]) => void;
  onAuthorMessageCenter: (c: NonNullable<ReturnType<typeof useCandidates>["data"]>["messageCenter"][number]) => void;
}) {
  if (query.isLoading) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ height: 40, borderRadius: 8, background: "rgba(148,163,184,.06)" }} />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 11, background: signal.critical.tint, padding: "16px 18px" }}>
        <span style={{ fontSize: 12, color: text.secondary }}>Candidates could not be loaded. Try again shortly.</span>
      </div>
    );
  }

  const roadmap = query.data?.roadmap ?? [];
  const messageCenter = query.data?.messageCenter ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
        Sources with no interpretation authored yet — pick one to interpret next.
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <TabButton active={tab === "roadmap"} label="Microsoft 365 Roadmap" count={roadmap.length} onClick={() => onTab("roadmap")} />
        <TabButton active={tab === "message_center"} label="Message Center" count={messageCenter.length} onClick={() => onTab("message_center")} />
      </div>

      {tab === "roadmap" && (
        roadmap.length === 0 ? (
          <EmptyPanel icon="check" title="Every roadmap item has an interpretation" body="Nothing left to author from the roadmap right now." />
        ) : (
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
            <div style={{ minWidth: 760 }}>
              {roadmap.map((c) => (
                <div key={c.featureId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{c.title}</span>
                    <span style={{ fontSize: 11, color: text.label }}>
                      {c.featureId} · {c.status ?? "unknown status"}{c.crossedOver ? " · already in a tenant's Message Center feed" : ""}
                    </span>
                  </div>
                  <button onClick={() => onAuthorRoadmap(c)} style={ghostBtnSmall}>Interpret</button>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {tab === "message_center" && (
        messageCenter.length === 0 ? (
          <EmptyPanel icon="check" title="Every Message Center post has an interpretation" body="Nothing left to author from Message Center right now." />
        ) : (
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
            <div style={{ minWidth: 760 }}>
              {messageCenter.map((c) => (
                <div key={c.graphMessageId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{c.title}</span>
                    <span style={{ fontSize: 11, color: text.label }}>
                      {c.graphMessageId}{c.isMajorChange ? " · major change" : ""}{c.category ? ` · ${c.category}` : ""}
                    </span>
                  </div>
                  <button onClick={() => onAuthorMessageCenter(c)} style={ghostBtnSmall}>Interpret</button>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      border: `1px solid ${border.card}`, borderRadius: 11, background: surface.card, padding: "34px 20px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center",
    }}>
      <span style={{
        width: 44, height: 44, borderRadius: 13, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)",
        color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={icon} size={20} />
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
  border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600,
  cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
};

const ghostBtnSmall: React.CSSProperties = {
  height: 28, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent",
  color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
};
