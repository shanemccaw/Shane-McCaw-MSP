/**
 * Change Control — Change Advisory Board (screen 9). `GET .../cab/meetings`,
 * `.../cab/meetings/:id`, `.../cab/members`, `.../cab/agenda/:id/decision`,
 * `.../cab/agenda/:id/defer`, `.../cab/meetings/:id/close`
 * (`msp-change-control-cab.ts`). MSP-wide, not tenant-filtered — one board can
 * carry agenda items from several tenants in the same sitting.
 */
import { useMemo } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { Badge, Button, Card, DataState } from "./shared";
import type { Tone } from "./shared";
import {
  useCabDecision, useCabDefer, useCabMeetingDetails, useCabMeetings, useCabMembers,
  useCloseCabMeeting, useStartCabMeeting, type WireCabAgendaItem,
} from "./api";

const TYPE_TONE: Record<string, Tone> = { cab: "blue", ecab: "red" };
const STATUS_TONE: Record<string, Tone> = { completed: "green", in_progress: "violet", scheduled: "slate", cancelled: "slate" };
const ROLE_COLOR: Record<string, string> = { chair: "#93c5fd", secretary: "#c4b5fd", voting: "#94a3b8", advisory: "#94a3b8" };

export function Cab() {
  const meetingsQuery = useCabMeetings();
  const membersQuery = useCabMembers();
  const meetings = meetingsQuery.data?.meetings ?? [];
  const meetingIds = useMemo(() => meetings.map((m) => m.id), [meetings]);
  const details = useCabMeetingDetails(meetingIds);

  const decide = useCabDecision();
  const defer = useCabDefer();
  const close = useCloseCabMeeting();
  const start = useStartCabMeeting();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DataState
        isLoading={meetingsQuery.isLoading}
        error={meetingsQuery.error}
        isEmpty={!meetingsQuery.isLoading && !meetingsQuery.error && meetings.length === 0}
        route="GET /api/msp/change-control/cab/meetings"
        emptyTitle="No board meetings scheduled"
        emptyNote="Schedule a CAB or ECAB meeting to bring pending changes to the board."
      >
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(240px,.55fr)", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {meetings.map((m, i) => {
              const detail = details[i];
              const agenda: WireCabAgendaItem[] = detail?.data?.agenda ?? [];
              const closed = m.status === "completed";
              const cancelled = m.status === "cancelled";
              const undecided = agenda.filter((a) => a.recommendation === null).length;
              const canClose = !closed && !cancelled && agenda.length > 0 && undecided === 0;
              return (
                <Card key={m.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Badge label={m.meetingType === "ecab" ? "EMERGENCY BOARD" : "STANDING BOARD"} tone={TYPE_TONE[m.meetingType]} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>
                      {m.chairName ? `Chaired by ${m.chairName}` : (m.meetingType === "ecab" ? "Emergency board review" : "Change advisory board")}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: "#94a3b8", whiteSpace: "nowrap" }}>{new Date(m.scheduledFor).toLocaleString()}</span>
                    <Badge label={m.status.replace(/_/g, " ")} tone={STATUS_TONE[m.status]} />
                  </div>

                  {m.status === "scheduled" && (
                    <Button label="Start meeting" icon="play" tone="primary" onClick={() => start.mutate(m.id, { onError: (e) => toast.error(e.message) })} />
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail?.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>Loading agenda…</span>}
                    {agenda.length === 0 && !detail?.isLoading && (
                      <span style={{ fontSize: 12, color: "#64748b" }}>No agenda items on this meeting yet.</span>
                    )}
                    {agenda.map((a) => {
                      const decision = a.recommendation;
                      const dTone: Tone = decision === "approve" ? "green" : decision === "reject" ? "red" : "amber";
                      return (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(148,163,184,.14)", background: "rgba(2,6,23,.4)", flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: "#64748b", flex: "0 0 auto" }}>{a.ordinal}.</span>
                          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 150 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f1f5f9" }}>{a.changeCode} · {a.changeTitle}</span>
                            <span style={{ fontSize: 11, color: "#64748b" }}>{a.presenterName ? `Presented by ${a.presenterName}` : "No presenter recorded"}</span>
                          </span>
                          {a.isRetroactive && <Badge label="reviewed after the fact" tone="amber" />}
                          {decision === null ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <Button label="Approve" tone="ghost" title="Writes a real approval against the change" onClick={() => decide.mutate({ agendaItemId: a.id, decision: "approve" }, { onError: (e) => toast.error(e.message) })} />
                              <Button label="Reject" tone="danger" title="Writes a real rejection against the change" onClick={() => decide.mutate({ agendaItemId: a.id, decision: "reject" }, { onError: (e) => toast.error(e.message) })} />
                              <Button label="Defer" tone="ghost" title="Rolls the item to a later meeting and decides nothing" onClick={() => defer.mutate({ agendaItemId: a.id, deferredToMeetingId: null }, { onError: (e) => toast.error(e.message) })} />
                            </div>
                          ) : (
                            <Badge label={decision.toUpperCase()} tone={dTone} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid rgba(148,163,184,.12)" }}>
                    <Button
                      label={closed ? "Minutes compiled" : undecided > 0 ? `Close · ${undecided} undecided` : "Close and compile minutes"}
                      icon="gavel"
                      tone={canClose ? "primary" : "ghost"}
                      disabled={!canClose}
                      title={undecided > 0 ? "Every item needs a determination first" : undefined}
                      onClick={() => close.mutate(m.id, { onError: (e) => toast.error(e.message) })}
                    />
                    <span style={{ fontSize: 11.5, color: "#64748b", flex: 1, minWidth: 140 }}>
                      {closed ? "Minutes record each item, its presenter, the discussion and the determination." : "A board determination is recorded on the change itself, not held separately here."}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>

          <Card>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: "#475569" }}>THE BOARD</span>
            {membersQuery.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>Loading…</span>}
            {(membersQuery.data?.members ?? []).filter((m) => m.active).map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: "rgba(96,165,250,.14)", border: "1px solid rgba(96,165,250,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, color: "#93c5fd" }}>
                  {p.name.split(" ").map((x) => x.charAt(0)).join("").slice(0, 2)}
                </span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f1f5f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.side === "msp" ? "Shane McCaw MSP" : "Customer"}{p.tenantId ? "" : " · board-wide"}</span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: ROLE_COLOR[p.role] }}>{p.role.toUpperCase()}</span>
              </div>
            ))}
            <span style={{ fontSize: 11, color: "#475569", paddingTop: 8, borderTop: "1px solid rgba(148,163,184,.12)" }}>Removing someone keeps their past votes on the record — the seat is closed, not erased.</span>
          </Card>
        </div>
      </DataState>
    </div>
  );
}
