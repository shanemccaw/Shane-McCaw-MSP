/**
 * Requests and Support Chat — MSP Console module page (#2650, Feature #2570).
 *
 * **Authorized by Shane, 2026-09-15: no Claude Design export exists for this
 * screen (blocked_by #2649 was lifted) — built directly against the real
 * backend contract instead of waiting on a design pass.** See the visible
 * banner below; this is deliberate, not an oversight.
 *
 * Wired against the real operator routes built under #2672
 * (`artifacts/api-server/src/routes/msp-support.ts`) via
 * `@/api/requests-support-api` — see
 * `docs/msp-console/requests-and-support-chat-msp-console-contract-pack.md`
 * for the full contract this follows. Visual conventions (tokens, card/list
 * layout, error/empty states) are reused from the landed `AuditLog.tsx`
 * module rather than inventing new ones.
 *
 * Both a customer-opened request and a ShaneBot chat escalation land in the
 * same org-scoped queue — the contract pack's own finding: there is no
 * structured field distinguishing them, only a `subject` text convention
 * (`isEscalation`). An operator reply can be public (visible to the
 * customer) or an internal-only note; the operator thread includes private
 * notes a customer's own Portal thread never receives.
 *
 * No fixture module — every row is a real server response.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  isEscalation, SupportApiError, useReplyToRequest, useSupportRequestDetail, useSupportRequests,
  type CustomerTicketSummary, type CustomerTicketThreadEntry,
} from "@/api/requests-support-api";

const LIMIT = 25;

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function statusTone(statusType: string | null): { strong: string; text?: string; tint: string; border: string } {
  const s = (statusType ?? "").toLowerCase();
  if (s === "closed") return signal.neutral;
  if (s === "escalated") return signal.critical;
  if (s === "on hold") return signal.warning;
  return signal.ok; // Open / unknown
}

function pillStyle(tone: { strong: string; text?: string; tint: string; border: string }): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
    height: 20, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`,
    fontSize: 10.5, fontWeight: 600, color: tone.text ?? tone.strong,
  };
}

export function RequestsAndSupportChat() {
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useSupportRequests({ limit: LIMIT, offset });

  useEffect(() => {
    // Land on the newest page's first item once it loads, mirroring the
    // audit log's own openId behavior — but only if nothing is already open.
  }, []);

  if (list.isError) {
    const message = list.error instanceof SupportApiError ? list.error.message : "The requests queue did not load.";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <AgentBuiltBanner />
        <ErrorCard message={message} onRetry={() => list.refetch()} />
      </div>
    );
  }

  const requests = list.data?.requests ?? [];
  const count = list.data?.count ?? 0;
  const configured = list.data?.configured ?? true;
  const open = openId != null ? requests.find((r) => r.id === openId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <AgentBuiltBanner />

      {!list.isLoading && !configured && (
        <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Ticketing isn't connected</span>
          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
            This MSP's Zoho Desk connection isn't configured, so there's nothing to show — not an error, an honest not-connected state.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        {/* List */}
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, gridColumn: "span 2" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Requests</span>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
              {list.isLoading ? "Loading…" : `${count} in your MSP's queue · customer requests and chat escalations together`}
            </span>
          </div>

          {list.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted }}>Loading the requests queue…</span>
          ) : requests.length > 0 ? (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 620 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 130px 150px", gap: 12, padding: "0 12px 6px", borderBottom: `1px solid ${border.soft}` }}>
                  {["SUBJECT", "STATUS", "TICKET #", "UPDATED"].map((h) => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{h}</span>
                  ))}
                </div>
                {requests.map((r) => {
                  const on = r.id === openId;
                  const escalation = isEscalation(r.subject);
                  const tone = statusTone(r.statusType);
                  return (
                    <button
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      style={{
                        display: "grid", gridTemplateColumns: "1fr 110px 130px 150px", gap: 12, alignItems: "center",
                        textAlign: "left", border: `1px solid ${on ? border.hover : border.soft}`, borderRadius: 9,
                        background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: "10px 12px", cursor: "pointer",
                        fontFamily: "inherit", minWidth: 0,
                      }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: text.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject}</span>
                        {escalation && (
                          <span style={pillStyle(signal.notice)}>
                            <Icon name="siren" size={10} />
                            <span style={{ marginLeft: 4 }}>Chat escalation</span>
                          </span>
                        )}
                      </span>
                      <span><span style={pillStyle(tone)}>{r.status ?? r.statusType ?? "—"}</span></span>
                      <span style={{ fontSize: 11.5, fontFamily: "Menlo, monospace", color: text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ticketNumber ?? "—"}</span>
                      <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{fmtWhen(r.modifiedTime)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "26px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>No requests</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 420 }}>
                Nothing in this MSP's queue right now — a real, empty result, not a loading state.
              </span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", flex: 1, minWidth: 200 }}>
              Showing {requests.length ? offset + 1 : 0}–{offset + requests.length} of {count} · newest-modified first
            </span>
            <button onClick={() => setOffset((o) => Math.max(0, o - LIMIT))} disabled={offset <= 0} style={navBtn(offset > 0)}>Newer</button>
            <button onClick={() => setOffset((o) => o + LIMIT)} disabled={offset + LIMIT >= count} style={navBtn(offset + LIMIT < count)}>Older</button>
          </div>
        </div>

        {/* Detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {open ? (
            <RequestDetail request={open} onClose={() => setOpenId(null)} />
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick a request</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 320 }}>The full conversation, including internal-only notes, and the reply form live here.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function navBtn(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 28, padding: "0 11px", borderRadius: 6,
    background: "transparent", border: `1px solid ${border.card}`, fontSize: 11.5, fontWeight: 600,
    color: enabled ? text.secondary : text.faint, cursor: enabled ? "pointer" : "not-allowed", fontFamily: "inherit",
  };
}

function AgentBuiltBanner() {
  return (
    <div style={{
      border: `1px dashed ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint,
      padding: "9px 13px", display: "flex", alignItems: "center", gap: 9,
    }}>
      <Icon name="triangle-alert" size={14} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: signal.warning.strong }}>
        Agent-built UI — pending design review
      </span>
      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
        No Claude Design export exists for this screen yet; built directly against the real backend contract with Shane's authorization (2026-09-15).
      </span>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 12, background: signal.critical.tint, padding: "36px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, background: signal.critical.tint, border: `1px solid ${signal.critical.border}`, color: signal.critical.strong, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="circle-x" size={20} />
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title }}>The requests queue did not load</span>
      <span style={{ fontSize: 12.5, color: text.secondary, maxWidth: 420, textWrap: "pretty" }}>{message}</span>
      <button onClick={onRetry} style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 13px", marginTop: 4, borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
        <Icon name="rotate-ccw" size={13} />
        Try again
      </button>
    </div>
  );
}

function RequestDetail({ request, onClose }: { request: CustomerTicketSummary; onClose: () => void }) {
  const detail = useSupportRequestDetail(request.id);
  const [message, setMessage] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const reply = useReplyToRequest(request.id);

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    reply.mutate(
      { message: trimmed, isPublic },
      {
        onSuccess: (res) => {
          toast.success(res.message);
          setMessage("");
        },
        onError: (err) => {
          toast.error(err instanceof SupportApiError ? err.message : "We couldn't add your reply right now.");
        },
      },
    );
  };

  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.01em", color: text.title, textWrap: "pretty" }}>{request.subject}</span>
          <span style={{ fontSize: 11, color: text.muted }}>
            {request.ticketNumber ? `Ticket #${request.ticketNumber} · ` : ""}Updated {fmtWhen(request.modifiedTime)}
          </span>
        </span>
        <button onClick={onClose} style={{ display: "inline-flex", alignItems: "center", height: 24, width: 24, justifyContent: "center", borderRadius: 6, background: "transparent", border: `1px solid ${border.card}`, color: text.muted, cursor: "pointer" }}>
          <Icon name="x" size={13} />
        </button>
      </div>

      {request.webUrl && (
        <a href={request.webUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: signal.info.text, textDecoration: "underline", textUnderlineOffset: 4 }}>
          Open in Zoho Desk
        </a>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${border.faint}`, paddingTop: 12, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>CONVERSATION</span>
        {detail.isLoading ? (
          <span style={{ fontSize: 11.5, color: text.muted }}>Loading the thread…</span>
        ) : detail.isError ? (
          <span style={{ fontSize: 11.5, color: signal.critical.text }}>
            {detail.error instanceof SupportApiError ? detail.error.message : "The thread did not load."}
          </span>
        ) : (
          <ThreadList entries={detail.data?.thread ?? []} />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${border.faint}`, paddingTop: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>REPLY</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a reply or an internal note…"
          rows={4}
          style={{
            resize: "vertical", padding: "9px 11px", borderRadius: 8, border: `1px solid ${border.card}`,
            background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, fontFamily: "inherit", outline: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setIsPublic(true)}
            style={toggleBtn(isPublic)}
          >
            <Icon name="message-square" size={12} />
            <span style={{ marginLeft: 6 }}>Public reply</span>
          </button>
          <button
            onClick={() => setIsPublic(false)}
            style={toggleBtn(!isPublic)}
          >
            <Icon name="eye-off" size={12} />
            <span style={{ marginLeft: 6 }}>Internal note</span>
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={submit}
            disabled={!message.trim() || reply.isPending}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 15px", borderRadius: 8,
              border: "none", background: message.trim() && !reply.isPending ? "#2563eb" : "rgba(37,99,235,.35)",
              color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: message.trim() && !reply.isPending ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            {reply.isPending ? "Sending…" : isPublic ? "Send reply" : "Add note"}
          </button>
        </div>
        <span style={{ fontSize: 10.5, color: text.label, textWrap: "pretty" }}>
          A public reply is visible to the customer in their own request thread. An internal note is visible only to your MSP's operators.
        </span>
      </div>
    </div>
  );
}

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", height: 28, padding: "0 11px",
    borderRadius: 999, border: `1px solid ${active ? border.hover : border.card}`,
    background: active ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)",
    fontSize: 11.5, fontWeight: 600, color: active ? text.strong : text.muted, cursor: "pointer", fontFamily: "inherit",
  };
}

function ThreadList({ entries }: { entries: CustomerTicketThreadEntry[] }) {
  if (entries.length === 0) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>No messages yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {entries.map((e) => {
        const fromCustomer = e.direction === "in";
        const privateNote = !e.isPublic;
        return (
          <div
            key={e.id}
            style={{
              border: `1px solid ${privateNote ? signal.warning.border : border.soft}`,
              borderRadius: 9,
              background: privateNote ? signal.warning.tint : "rgba(2,6,23,.4)",
              padding: "9px 11px", display: "flex", flexDirection: "column", gap: 5, minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: fromCustomer ? signal.info.text : text.strong }}>
                {e.author ?? (fromCustomer ? "Customer" : "Operator")}
              </span>
              {privateNote && <span style={pillStyle(signal.warning)}>Internal note</span>}
              {e.kind === "comment" && !privateNote && <span style={pillStyle(signal.neutral)}>Comment</span>}
              <span style={{ fontSize: 10.5, color: text.label }}>{fmtWhen(e.createdTime)}</span>
            </div>
            <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.content}</span>
          </div>
        );
      })}
    </div>
  );
}
