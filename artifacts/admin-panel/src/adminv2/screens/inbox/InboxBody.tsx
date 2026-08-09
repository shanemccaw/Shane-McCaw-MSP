/**
 * Inbox's centre content — search + message list on the left, the reading
 * pane (or the compose panel) on the right. Registered as the "inbox"
 * screen's `render`; the shell supplies everything around it (ribbon,
 * folders in the left panel, CRM/thread facts in the right panel, the doc
 * tab strip).
 *
 * Selecting a message calls `shell.openDoc({kind:"mail", ...})` rather than
 * keeping "which message is open" as local state — that is what makes the
 * "Message Tools" contextual tab activate and the Back group work, and it is
 * why the fixed "inbox" ribbon tab and this component both read/write
 * `inboxStore` instead of React state: the ribbon is built once, at
 * module-load time, with no component of its own to hold state in.
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Archive, Flag, Forward, Paperclip, Reply, Search, Send, Sparkles, Trash2, X } from "lucide-react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { useShell } from "../../shell/ShellContext";
import { ACCENT, ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  getMessage,
  getStatus,
  listMessages,
  listCrmMessages,
  searchMessages,
  forward as apiForward,
  reply as apiReply,
  sendNew as apiSendNew,
  type InboxMessage,
  type InboxMessageDetail,
  type AiSummary,
  type AiOpportunitySignals,
} from "./inboxApi";
import {
  archiveMessageAction,
  cacheMailSummary,
  closeCompose,
  configureInboxFetch,
  deleteMessageAction,
  getSnapshot,
  markReadAction,
  openCompose,
  runAiAction,
  setGraphAvailable,
  setSearchQuery,
  subscribe,
  toggleFlagAction,
  type ComposeState,
  type MailSummary,
} from "./inboxStore";

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function summaryOf(m: InboxMessage): MailSummary {
  return {
    subject: m.subject ?? "(no subject)",
    fromName: m.from?.emailAddress.name || m.from?.emailAddress.address || "Unknown",
    fromAddress: m.from?.emailAddress.address ?? "",
    preview: m.bodyPreview ?? "",
    receivedDateTime: m.receivedDateTime,
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
    flagged: m.flag?.flagStatus === "flagged",
  };
}

// ─── Message list ───────────────────────────────────────────────────────────────

function MessageRow({
  msg,
  active,
  onSelect,
  onReply,
  onReplyAll,
  onForward,
}: {
  msg: InboxMessage;
  active: boolean;
  onSelect: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}) {
  const shell = useShell();
  const { menu, open, close } = useContextMenu();
  const senderName = msg.from?.emailAddress.name || msg.from?.emailAddress.address || "Unknown";
  const flagged = msg.flag?.flagStatus === "flagged";

  function closeIfOpen() {
    shell.dispatch({ type: "closeDoc", id: `mail:${msg.id}` });
  }

  return (
    <>
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={(event) =>
        open(
          event,
          [
            { label: "Open", onSelect },
            { label: "Reply", onSelect: onReply },
            { label: "Reply all", onSelect: onReplyAll },
            { label: "Forward", onSelect: onForward },
            { label: flagged ? "Unflag" : "Flag", onSelect: () => void toggleFlagAction(msg.id, flagged) },
            {
              label: msg.isRead ? "Mark as unread" : "Mark as read",
              onSelect: () => void markReadAction(msg.id, !msg.isRead),
            },
            {
              label: "Archive",
              onSelect: () => {
                void archiveMessageAction(msg.id);
                closeIfOpen();
              },
            },
            {
              label: "Delete",
              danger: true,
              onSelect: () => {
                void deleteMessageAction(msg.id);
                closeIfOpen();
              },
            },
          ],
          `Actions for ${msg.subject || "message"}`,
        )
      }
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 12px",
        border: "none",
        borderBottom: `1px solid ${LINE.subtle}`,
        background: active ? SURFACE.cardHover : "transparent",
        borderLeft: active ? `2px solid #0f6cbd` : "2px solid transparent",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            fontWeight: msg.isRead ? 500 : 700,
            color: msg.isRead ? TEXT.soft : TEXT.bright,
          }}
        >
          {senderName}
        </span>
        {flagged && <Flag size={11} color={ACCENT.amber} style={{ flexShrink: 0 }} />}
        {msg.hasAttachments && <Paperclip size={11} color={TEXT.meta} style={{ flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, fontSize: 11, color: TEXT.meta }}>{timeAgo(msg.receivedDateTime)}</span>
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: msg.isRead ? TEXT.dim : TEXT.quiet,
          fontWeight: msg.isRead ? 400 : 600,
        }}
      >
        {msg.subject || "(no subject)"}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 11.5,
          lineHeight: 1.4,
          color: TEXT.faint,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {msg.bodyPreview ?? ""}
      </div>
    </button>
    <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

// ─── Compose ──────────────────────────────────────────────────────────────────

function ComposeForm({ compose, sourceMessage }: { compose: ComposeState; sourceMessage: InboxMessageDetail | null }) {
  const { adminFetch } = useAdminFetch();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (compose.mode === "reply" || compose.mode === "replyAll") {
      setTo(sourceMessage?.from?.emailAddress.address ?? "");
      setSubject(sourceMessage ? `Re: ${sourceMessage.subject ?? ""}` : "");
    } else if (compose.mode === "forward") {
      setTo("");
      setSubject(sourceMessage ? `Fwd: ${sourceMessage.subject ?? ""}` : "");
    } else {
      setTo("");
      setSubject("");
    }
    setBody("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose.mode, compose.sourceMessageId]);

  useEffect(() => {
    if (!compose.aiDraft || !sourceMessage) return;
    setDrafting(true);
    const senderName = sourceMessage.from?.emailAddress.name || sourceMessage.from?.emailAddress.address || "";
    void runAiAction("draft_reply", {
      messageBody: sourceMessage.bodyPreview ?? "",
      subject: sourceMessage.subject ?? "",
      senderName,
    }).then((r) => {
      setDrafting(false);
      if (r && typeof r.result === "string") setBody(r.result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose.aiDraft, sourceMessage?.id]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      let result: { ok: boolean; error?: string };
      if (compose.mode === "new") {
        result = await apiSendNew(adminFetch, { to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, body });
      } else if (compose.mode === "forward") {
        if (!compose.sourceMessageId) throw new Error("nothing to forward");
        result = await apiForward(adminFetch, compose.sourceMessageId, to.split(",").map((s) => s.trim()).filter(Boolean), body);
      } else {
        if (!compose.sourceMessageId) throw new Error("nothing to reply to");
        result = await apiReply(adminFetch, compose.sourceMessageId, body, compose.mode === "replyAll");
      }
      if (!result.ok) {
        setError(result.error ?? "Send failed");
        return;
      }
      closeCompose();
    } finally {
      setSending(false);
    }
  }

  const title = compose.mode === "new" ? "New message" : compose.mode === "forward" ? "Forward" : compose.mode === "replyAll" ? "Reply all" : "Reply";
  const needsToField = compose.mode === "new" || compose.mode === "forward";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderTop: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
        {drafting && <span style={{ fontSize: 11, color: ACCENT.info }}>Drafting with AI…</span>}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={closeCompose} title="Discard" style={{ border: "none", background: "transparent", color: TEXT.meta, cursor: "pointer" }}>
          <X size={14} />
        </button>
      </div>

      {needsToField && (
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="To — comma-separated addresses"
          style={inputStyle}
        />
      )}
      {!needsToField && to && <div style={{ fontSize: 11.5, color: TEXT.meta }}>To: {to}</div>}
      {compose.mode !== "reply" && compose.mode !== "replyAll" && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" style={inputStyle} />
      )}
      {(compose.mode === "reply" || compose.mode === "replyAll") && subject && (
        <div style={{ fontSize: 11.5, color: TEXT.meta }}>{subject}</div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your message…"
        rows={7}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
      />
      {error && <div style={{ fontSize: 11.5, color: ACCENT_TEXT.danger }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || (needsToField && !to.trim()) || !body.trim()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            borderRadius: 5,
            padding: "6px 14px",
            background: "#0f6cbd",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: sending ? "default" : "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          <Send size={13} />
          {sending ? "Sending…" : "Send"}
        </button>
        <span style={{ fontSize: 11, color: TEXT.faint }}>Sends for real, through Exchange Online.</span>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.inset,
  color: TEXT.body,
  outline: "none",
  fontFamily: "inherit",
  fontSize: 12.5,
  boxSizing: "border-box",
};

// ─── Reading pane ─────────────────────────────────────────────────────────────

function ReadingPane({ id }: { id: string }) {
  const { adminFetch } = useAdminFetch();
  const shell = useShell();
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const [message, setMessage] = useState<InboxMessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [signals, setSignals] = useState<AiOpportunitySignals | null>(null);
  const [aiBusy, setAiBusy] = useState<"summarize" | "detect" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSummary(null);
    setSignals(null);
    getMessage(adminFetch, id).then((r) => {
      if (cancelled) return;
      setMessage(r?.message ?? null);
      setLoading(false);
      if (r?.message) cacheMailSummary(id, summaryOf(r.message));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, adminFetch, store.refreshKey]);

  if (loading) return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Loading message…</div>;
  if (!message) return <div style={{ padding: 20, fontSize: 12.5, color: ACCENT_TEXT.danger }}>Message not found.</div>;

  const from = message.from?.emailAddress;
  const flagged = message.flag?.flagStatus === "flagged";
  const bodyText = message.body?.contentType === "html" ? undefined : message.body?.content ?? message.bodyPreview ?? "";
  const showComposeHere =
    store.compose && store.compose.mode !== "new" && (store.compose.sourceMessageId === id || !store.compose.sourceMessageId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${LINE.base}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT.bright, lineHeight: 1.3 }}>{message.subject || "(no subject)"}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: TEXT.dim }}>
            <span style={{ color: TEXT.soft }}>{from?.name || from?.address || "Unknown"}</span>
            <span>{from?.address ? `<${from.address}>` : ""}</span>
            <div style={{ flex: 1 }} />
            <span>{new Date(message.receivedDateTime).toLocaleString()}</span>
          </div>
          {message.toRecipients.length > 0 && (
            <div style={{ marginTop: 3, fontSize: 11.5, color: TEXT.meta }}>
              To: {message.toRecipients.map((r) => r.emailAddress.address).join(", ")}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {message.hasAttachments && message.attachments && message.attachments.filter((a) => !a.isInline).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {message.attachments
                .filter((a) => !a.isInline)
                .map((a) => (
                  <div
                    key={a.id}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.card, fontSize: 11.5, color: TEXT.soft }}
                  >
                    <Paperclip size={12} color={TEXT.meta} />
                    {a.name}
                  </div>
                ))}
            </div>
          )}

          {message.body?.contentType === "html" ? (
            <iframe
              title="Message body"
              sandbox="allow-same-origin"
              srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Inter,'Segoe UI',sans-serif;font-size:13px;color:${TEXT.body};background:transparent;margin:0;padding:0;line-height:1.6}a{color:${ACCENT.info}}img{max-width:100%;height:auto}</style></head><body>${message.body.content}</body></html>`}
              style={{ width: "100%", minHeight: 220, border: "none", background: "transparent" }}
              onLoad={(e) => {
                try {
                  const win = e.currentTarget.contentWindow;
                  if (win) e.currentTarget.style.height = `${win.document.documentElement.scrollHeight}px`;
                } catch {
                  // Cross-origin content (a rare srcDoc edge case in some browsers) —
                  // the iframe just keeps its minHeight instead of auto-sizing.
                }
              }}
            />
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, color: TEXT.soft, margin: 0 }}>{bodyText}</pre>
          )}

          {signals && (
            <div style={{ padding: "10px 12px", borderRadius: 7, border: `1px solid ${LINE.control}`, background: SURFACE.card }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: signals.detected ? ACCENT_TEXT.green : TEXT.dim }}>
                {signals.detected ? `Buying signals detected (${signals.confidence} confidence)` : "No strong buying signals detected"}
              </div>
              {signals.detected && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11.5, color: TEXT.soft, lineHeight: 1.6 }}>
                  {signals.signals.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {summary && (
            <div style={{ padding: "10px 12px", borderRadius: 7, border: `1px solid ${LINE.control}`, background: SURFACE.card }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.soft }}>Summary</div>
              <div style={{ marginTop: 4, fontSize: 12, color: TEXT.dim, lineHeight: 1.5 }}>{summary.summary}</div>
              {summary.actionItems.length > 0 && (
                <>
                  <div style={{ marginTop: 8, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: TEXT.caption }}>Action items</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11.5, color: TEXT.soft, lineHeight: 1.6 }}>
                    {summary.actionItems.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showComposeHere && <ComposeForm compose={store.compose!} sourceMessage={message} />}

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "9px 14px", borderTop: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
        <ActionButton icon={Reply} label="Reply" onClick={() => openCompose({ mode: "reply", sourceMessageId: id })} />
        <ActionButton icon={Reply} label="Reply all" onClick={() => openCompose({ mode: "replyAll", sourceMessageId: id })} />
        <ActionButton icon={Forward} label="Forward" onClick={() => openCompose({ mode: "forward", sourceMessageId: id })} />
        <ActionButton
          icon={Sparkles}
          label="Draft with AI"
          color={ACCENT.info}
          onClick={() => openCompose({ mode: "reply", sourceMessageId: id, aiDraft: true })}
        />
        <ActionButton
          icon={Sparkles}
          label={aiBusy === "summarize" ? "Summarizing…" : "Summarize"}
          onClick={async () => {
            setAiBusy("summarize");
            const r = await runAiAction("summarize", { messageBody: message.bodyPreview ?? "", subject: message.subject ?? "" });
            setAiBusy(null);
            if (r && typeof r.result !== "string") setSummary(r.result as AiSummary);
          }}
        />
        <ActionButton
          icon={Sparkles}
          label={aiBusy === "detect" ? "Detecting…" : "Detect signals"}
          onClick={async () => {
            setAiBusy("detect");
            const senderName = from?.name || from?.address || "";
            const r = await runAiAction("detect_opportunity", { messageBody: message.bodyPreview ?? "", subject: message.subject ?? "", senderName });
            setAiBusy(null);
            if (r && typeof r.result !== "string") setSignals(r.result as AiOpportunitySignals);
          }}
        />
        <div style={{ flex: 1 }} />
        <ActionButton
          icon={Flag}
          label={flagged ? "Unflag" : "Flag"}
          color={flagged ? ACCENT.amber : undefined}
          onClick={() => toggleFlagAction(id, flagged).then(() => getMessage(adminFetch, id).then((r) => setMessage(r?.message ?? null)))}
        />
        <ActionButton icon={Archive} label="Archive" onClick={() => archiveMessageAction(id).then(() => shell.dispatch({ type: "closeDoc", id: `mail:${id}` }))} />
        <ActionButton
          icon={Trash2}
          label="Delete"
          color={ACCENT.danger}
          onClick={() => deleteMessageAction(id).then(() => shell.dispatch({ type: "closeDoc", id: `mail:${id}` }))}
        />
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  color,
  onClick,
}: {
  icon: typeof Reply;
  label: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 5,
        border: `1px solid ${LINE.control}`,
        background: "transparent",
        color: color ?? TEXT.soft,
        fontFamily: "inherit",
        fontSize: 11.5,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={12} color={color ?? TEXT.meta} />
      {label}
    </button>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

export function InboxBody({ recordId }: { recordId?: string }) {
  const { adminFetch } = useAdminFetch();
  const shell = useShell();
  const store = useSyncExternalStore(subscribe, getSnapshot);

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<InboxMessage[] | null>(null);
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    configureInboxFetch(adminFetch);
  }, [adminFetch]);

  useEffect(() => {
    let cancelled = false;
    getStatus(adminFetch).then((s) => {
      if (!cancelled) setGraphAvailable(s.graphAvailable);
    });
    return () => {
      cancelled = true;
    };
  }, [adminFetch]);

  const isCrmFolder = store.selectedFolder.startsWith("crm:");

  useEffect(() => {
    if (searchResults !== null) return;
    if (store.graphAvailable !== true) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    const load = isCrmFolder
      ? listCrmMessages(adminFetch, store.selectedFolder.replace("crm:", "") as "leads" | "prospects" | "customers").then((r) => r.messages)
      : listMessages(adminFetch, {
          folder: store.selectedFolder,
          onlyUnread: store.filters.has("unread"),
          onlyFlagged: store.filters.has("flagged"),
          onlyHasAttachments: store.filters.has("hasAttachments"),
        }).then((r) => r.messages);
    load.then((msgs) => {
      if (cancelled) return;
      setMessages(msgs);
      setListLoading(false);
      for (const m of msgs) cacheMailSummary(m.id, summaryOf(m));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.selectedFolder, store.filters, store.refreshKey, store.graphAvailable, searchResults, adminFetch, isCrmFolder]);

  async function runSearch(q: string) {
    const query = q.trim();
    if (!query) {
      setSearchResults(null);
      setSearchQuery("");
      return;
    }
    setSearchQuery(query);
    const { messages: found } = await searchMessages(adminFetch, query);
    setSearchResults(found);
  }

  function selectMessage(m: InboxMessage) {
    cacheMailSummary(m.id, summaryOf(m));
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isRead: true } : x)));
    shell.openDoc({ kind: "mail", id: m.id, screenId: "inbox", label: m.subject || "(no subject)" });
    if (!m.isRead) void markReadAction(m.id, true);
  }

  // Opens the message (so the reading pane is mounted to host the compose
  // panel) then starts the same compose flow the reading pane's own Reply/Reply
  // all/Forward buttons and the Message Tools contextual tab use.
  function replyToMessage(m: InboxMessage, mode: "reply" | "replyAll" | "forward") {
    selectMessage(m);
    openCompose({ mode, sourceMessageId: m.id });
  }

  const rows = searchResults ?? messages;
  const activeDoc = shell.state.docs.find((d) => d.id === shell.state.activeDocId);
  const openMessageId = activeDoc?.kind === "mail" ? activeDoc.recordId : undefined;

  if (store.graphAvailable === false) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.primary }}>Microsoft Graph is not configured</div>
          <div style={{ marginTop: 6, fontSize: 12.5, color: TEXT.meta, lineHeight: 1.6 }}>
            Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_MAIL_USER_ID to connect this mailbox.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${LINE.base}` }}>
        <div style={{ flexShrink: 0, padding: 8, borderBottom: `1px solid ${LINE.base}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: SURFACE.well }}>
            <Search size={13} color={TEXT.meta} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(searchInput);
              }}
              placeholder="Search all mail"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: TEXT.primary, fontFamily: "inherit", fontSize: 12 }}
            />
            {searchResults !== null && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearchResults(null);
                  setSearchQuery("");
                }}
                style={{ border: "none", background: "transparent", color: TEXT.meta, cursor: "pointer" }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {listLoading ? (
            <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: TEXT.meta }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: TEXT.meta }}>
              {searchResults !== null ? "No messages match your search." : "No messages in this view."}
            </div>
          ) : (
            rows.map((m) => (
              <MessageRow
                key={m.id}
                msg={m}
                active={m.id === openMessageId}
                onSelect={() => selectMessage(m)}
                onReply={() => replyToMessage(m, "reply")}
                onReplyAll={() => replyToMessage(m, "replyAll")}
                onForward={() => replyToMessage(m, "forward")}
              />
            ))
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {store.compose?.mode === "new" ? (
          <ComposeForm compose={store.compose} sourceMessage={null} />
        ) : recordId ? (
          <ReadingPane key={recordId} id={recordId} />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
            <div style={{ fontSize: 12.5, color: TEXT.meta }}>Select a message to read, or press New message to start one.</div>
          </div>
        )}
      </div>
    </div>
  );
}
