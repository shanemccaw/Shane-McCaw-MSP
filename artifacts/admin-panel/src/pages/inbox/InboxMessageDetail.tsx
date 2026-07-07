import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInbox } from "@/contexts/InboxContext";
import InboxAIPanel from "./InboxAIPanel";
import InboxComposeForm from "./InboxComposeForm";
import ConvertToTaskModal from "./ConvertToTaskModal";
import CreateOpportunityModal from "./CreateOpportunityModal";

interface EmailAddress { name: string; address: string; }
interface Recipient { emailAddress: EmailAddress; }
interface Attachment { id: string; name: string; contentType: string; size: number; isInline: boolean; }

interface MessageDetail {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  sentDateTime: string | null;
  isRead: boolean;
  isDraft: boolean;
  importance: "low" | "normal" | "high";
  flag: { flagStatus: "notFlagged" | "flagged" | "complete" };
  from: Recipient | null;
  toRecipients: Recipient[];
  ccRecipients: Recipient[];
  bccRecipients: Recipient[];
  replyTo: Recipient[];
  hasAttachments: boolean;
  conversationId: string | null;
  body: { contentType: "html" | "text"; content: string } | null;
  attachments?: Attachment[];
}

interface CRMData {
  link: { id: number; graphMessageId: string; leadId: number | null; opportunityId: number | null; customerId: number | null; taskId: number | null } | null;
  lead: { id: number; name: string; email: string; company: string | null; score: number; status: string; stage: string } | null;
  opportunity: { id: number; leadId: number; scoreSnapshot: number; evidence: string[] } | null;
  customer: { id: number; name: string | null; email: string; company: string | null } | null;
  task: { id: number; title: string; column: string; priority: string } | null;
}

interface OpportunitySignals {
  detected: boolean;
  confidence: string;
  signals: string[];
  opportunityName: string;
  recommendedNextStep: string;
}

interface ScoreStageSuggestion {
  suggestScoreChange: boolean;
  newScore: number | null;
  suggestStageChange: boolean;
  newStage: "Junk" | "Cold" | "Warm" | "Hot" | null;
  reasoning: string;
  urgency: "high" | "medium" | "low";
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── AI Suggestion Chips for linked lead score/stage ─────────────────────────

interface SuggestionChipsProps {
  messageId: string;
  bodyText: string;
  subject: string | null;
  lead: CRMData["lead"];
  onApplied: () => void;
}

function SuggestionChips({ messageId, bodyText, subject, lead, onApplied }: SuggestionChipsProps) {
  const { fetchWithAuth } = useAuth();
  const [suggestion, setSuggestion] = useState<ScoreStageSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setLoading(true);
    fetchWithAuth(`/api/inbox/messages/${messageId}/suggest-updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageBody: bodyText.slice(0, 1500),
        subject,
        currentScore: lead.score,
        currentStage: lead.stage,
        leadId: lead.id,
      }),
    })
      .then(r => r.ok ? r.json() as Promise<ScoreStageSuggestion> : null)
      .then(d => {
        if (d && (d.suggestScoreChange || d.suggestStageChange)) setSuggestion(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [messageId, bodyText, subject, lead, fetchWithAuth]);

  if (!lead || loading || !suggestion || dismissed || applied) return null;
  if (!suggestion.suggestScoreChange && !suggestion.suggestStageChange) return null;

  async function applyChanges() {
    if (!lead || !suggestion) return;
    setApplying(true);
    try {
      const patch: Record<string, unknown> = {};
      if (suggestion.suggestScoreChange && suggestion.newScore !== null) patch.score = suggestion.newScore;
      if (suggestion.suggestStageChange && suggestion.newStage) patch.stage = suggestion.newStage;
      const res = await fetchWithAuth(`/api/inbox/leads/${lead.id}/score-stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setApplied(true);
        onApplied();
      }
    } finally {
      setApplying(false);
    }
  }

  const urgencyColor = suggestion.urgency === "high"
    ? "bg-red-900/20 border-red-800/40 text-red-300"
    : suggestion.urgency === "medium"
      ? "bg-amber-900/20 border-amber-800/40 text-amber-300"
      : "bg-blue-900/20 border-blue-800/40 text-blue-300";

  return (
    <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl ${urgencyColor}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-0.5">AI suggests updating lead: {lead.name}</p>
        <p className="text-[11px] opacity-80 mb-2">{suggestion.reasoning}</p>
        <div className="flex flex-wrap gap-2">
          {suggestion.suggestScoreChange && suggestion.newScore !== null && (
            <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-medium">
              Score: {lead.score} → {suggestion.newScore}
            </span>
          )}
          {suggestion.suggestStageChange && suggestion.newStage && (
            <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-medium">
              Stage: {lead.stage} → {suggestion.newStage}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => void applyChanges()}
          disabled={applying}
          className="px-3 py-1 text-[11px] font-semibold bg-white/15 hover:bg-white/25 rounded-lg transition-colors disabled:opacity-50"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-[11px] opacity-60 hover:opacity-100 transition-opacity"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function InboxMessageDetail() {
  const { fetchWithAuth } = useAuth();
  const {
    selectedMessageId, aiPanelOpen, toggleAIPanel,
    openCompose, composeMode, refreshMessageList,
  } = useInbox();

  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crmData, setCrmData] = useState<CRMData | null>(null);
  const [thread, setThread] = useState<MessageDetail[]>([]);
  const [showThread, setShowThread] = useState(false);

  const [flagging, setFlagging] = useState(false);
  const [moving, setMoving] = useState(false);

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showOpportunityModal, setShowOpportunityModal] = useState(false);
  const [opportunitySignals, setOpportunitySignals] = useState<OpportunitySignals | null>(null);
  const [detectingOpp, setDetectingOpp] = useState(false);

  // Extracted tasks for batch conversion
  const [extractedTasks, setExtractedTasks] = useState<Array<{ title: string; description?: string; dueDate?: string | null; priority?: string }> | null>(null);

  const [taskCreated, setTaskCreated] = useState<Array<{ id: number; title: string }> | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadCrmData = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/inbox/messages/${id}/crm`);
    if (res.ok) {
      const d = await res.json() as CRMData;
      setCrmData(d);
    }
  }, [fetchWithAuth]);

  const loadMessage = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    setCrmData(null);
    setThread([]);
    setShowThread(false);
    setOpportunitySignals(null);
    setExtractedTasks(null);
    setTaskCreated(null);
    try {
      const mRes = await fetchWithAuth(`/api/inbox/messages/${id}`);
      if (!mRes.ok) throw new Error(`HTTP ${mRes.status}`);
      const mData = await mRes.json() as { message: MessageDetail };
      setMessage(mData.message);
      void loadCrmData(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load message");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, loadCrmData]);

  useEffect(() => {
    if (selectedMessageId) void loadMessage(selectedMessageId);
    else setMessage(null);
  }, [selectedMessageId, loadMessage]);

  async function loadThread() {
    if (!selectedMessageId || showThread) return;
    const res = await fetchWithAuth(`/api/inbox/messages/${selectedMessageId}/thread`);
    if (res.ok) {
      const data = await res.json() as { messages: MessageDetail[] };
      setThread(data.messages);
    }
    setShowThread(true);
  }

  async function toggleFlag() {
    if (!message) return;
    setFlagging(true);
    const newStatus = message.flag?.flagStatus === "flagged" ? "notFlagged" : "flagged";
    try {
      const res = await fetchWithAuth(`/api/inbox/messages/${message.id}/flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagStatus: newStatus }),
      });
      if (res.ok) {
        setMessage(prev => prev ? { ...prev, flag: { flagStatus: newStatus } } : null);
        refreshMessageList();
      }
    } finally {
      setFlagging(false);
    }
  }

  async function archiveMessage() {
    if (!message) return;
    setMoving(true);
    try {
      await fetchWithAuth(`/api/inbox/messages/${message.id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: "archive" }),
      });
      refreshMessageList();
    } finally {
      setMoving(false);
    }
  }

  async function deleteMessage() {
    if (!message) return;
    setMoving(true);
    try {
      await fetchWithAuth(`/api/inbox/messages/${message.id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: "deleted" }),
      });
      refreshMessageList();
    } finally {
      setMoving(false);
    }
  }

  async function detectOpportunity() {
    if (!message || detectingOpp) return;
    setDetectingOpp(true);
    try {
      const res = await fetchWithAuth("/api/inbox/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "detect_opportunity",
          messageBody: getBodyText(),
          subject: message.subject,
          senderName,
        }),
      });
      if (res.ok) {
        const d = await res.json() as { result: OpportunitySignals };
        setOpportunitySignals(d.result);
      }
    } finally {
      setDetectingOpp(false);
    }
  }

  function getBodyText(): string {
    if (!message?.body) return message?.bodyPreview ?? "";
    const div = document.createElement("div");
    div.innerHTML = message.body.content;
    return div.textContent ?? div.innerText ?? message.bodyPreview ?? "";
  }

  function handleExtractedTasks(tasks: Array<{ title: string; description?: string; dueDate?: string | null; priority?: string }>) {
    setExtractedTasks(tasks);
  }

  if (!selectedMessageId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6 bg-[#0D1117]">
        <div className="w-16 h-16 rounded-2xl bg-[#161B22] flex items-center justify-center">
          <svg className="w-8 h-8 text-[#7D8590]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-[#C9D1D9]">Select a message to read</p>
          <p className="text-xs text-[#7D8590] mt-1">Choose a message from the list on the left.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full bg-[#0D1117]">
        <div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0D1117]">
        <p className="text-sm text-red-400">{error ?? "Message not found"}</p>
      </div>
    );
  }

  const senderName = message.from?.emailAddress.name || message.from?.emailAddress.address || "Unknown";
  const senderEmail = message.from?.emailAddress.address ?? "";
  const isFlagged = message.flag?.flagStatus === "flagged";

  return (
    <div className="flex h-full overflow-hidden bg-[#0D1117]">
      {/* Main message area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363D] bg-[#0D1117] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-[#E6EDF3] leading-snug break-words">
                {message.subject ?? "(no subject)"}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                <span className="text-xs text-[#C9D1D9]">
                  <span className="text-[#7D8590]">From:</span> {senderName} {senderEmail ? `<${senderEmail}>` : ""}
                </span>
                <span className="text-xs text-[#7D8590]">{formatDate(message.receivedDateTime)}</span>
              </div>
              {message.toRecipients.length > 0 && (
                <p className="text-xs text-[#7D8590] mt-0.5">
                  <span>To:</span> {message.toRecipients.map(r => r.emailAddress.address).join(", ")}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={toggleFlag}
                disabled={flagging}
                title={isFlagged ? "Unflag" : "Flag"}
                className={`p-1.5 rounded-lg transition-colors ${isFlagged ? "text-amber-400 bg-amber-400/10" : "text-[#7D8590] hover:text-amber-400 hover:bg-amber-400/10"}`}
              >
                <svg className="w-4 h-4" fill={isFlagged ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21V3h12l-4 6 4 6H3" />
                </svg>
              </button>
              <button
                onClick={archiveMessage}
                disabled={moving}
                title="Archive"
                className="p-1.5 rounded-lg text-[#7D8590] hover:text-[#C9D1D9] hover:bg-[#1C2128] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </button>
              <button
                onClick={deleteMessage}
                disabled={moving}
                title="Delete"
                className="p-1.5 rounded-lg text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
              <button
                onClick={toggleAIPanel}
                title="AI Assistant"
                className={`p-1.5 rounded-lg text-xs font-bold transition-colors ${aiPanelOpen ? "bg-[#0078D4]/20 text-[#0078D4]" : "text-[#7D8590] hover:text-[#C9D1D9] hover:bg-[#1C2128]"}`}
              >
                AI
              </button>
            </div>
          </div>

          {/* Reply/Forward/Action toolbar */}
          <div className="flex items-center flex-wrap gap-2 mt-3">
            <button
              onClick={() => openCompose("reply", { replyToMessageId: message.id, subject: `Re: ${message.subject ?? ""}`, to: senderEmail })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-[#C9D1D9] bg-[#161B22] border border-[#30363D] hover:border-[#0078D4] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Reply
            </button>
            <button
              onClick={() => openCompose("replyAll", { replyToMessageId: message.id, subject: `Re: ${message.subject ?? ""}` })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-[#C9D1D9] bg-[#161B22] border border-[#30363D] hover:border-[#0078D4] transition-colors"
            >
              Reply All
            </button>
            <button
              onClick={() => openCompose("forward", { forwardMessageId: message.id, subject: `Fwd: ${message.subject ?? ""}` })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-[#C9D1D9] bg-[#161B22] border border-[#30363D] hover:border-[#0078D4] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11m10 0l-6-6m6 6l-6 6M3 4v16" />
              </svg>
              Forward
            </button>
            <button
              onClick={() => setShowConvertModal(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 hover:bg-emerald-900/30 transition-colors"
            >
              ✅ Convert to Task
            </button>
            {!opportunitySignals && (
              <button
                onClick={() => void detectOpportunity()}
                disabled={detectingOpp}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-amber-400 bg-amber-900/20 border border-amber-800/40 hover:bg-amber-900/30 transition-colors disabled:opacity-50"
              >
                {detectingOpp ? (
                  <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                ) : "🎯"}
                Detect Opportunity
              </button>
            )}
          </div>

          {/* Opportunity signal banner */}
          {opportunitySignals?.detected && (
            <div className="mt-3 flex items-center gap-3 p-2.5 bg-emerald-900/10 border border-emerald-800/30 rounded-xl">
              <span className="text-xs text-emerald-400 font-semibold">🎯 Buying signals detected ({opportunitySignals.confidence} confidence)</span>
              <button
                onClick={() => setShowOpportunityModal(true)}
                className="ml-auto px-3 py-1 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-600"
              >
                Create Opportunity
              </button>
            </div>
          )}
          {opportunitySignals && !opportunitySignals.detected && (
            <div className="mt-3 px-3 py-2 bg-[#161B22] border border-[#30363D] rounded-xl">
              <p className="text-xs text-[#7D8590]">🎯 No strong buying signals detected in this email.</p>
            </div>
          )}

          {/* CRM badge */}
          {crmData?.lead && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                Lead: {crmData.lead.name} — score {crmData.lead.score} / {crmData.lead.stage}
              </span>
              {crmData.opportunity && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                  Opportunity #{crmData.opportunity.id}
                </span>
              )}
              {crmData.task && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-medium">
                  Task: {crmData.task.title}
                </span>
              )}
            </div>
          )}

          {/* Task created success */}
          {taskCreated && taskCreated.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {taskCreated.length === 1
                ? `Task created: ${taskCreated[0]!.title}`
                : `${taskCreated.length} tasks created`}
            </div>
          )}
        </div>

        {/* Scrollable body area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* AI score/stage suggestion chips — only when linked to a lead */}
          {crmData?.lead && message && (
            <SuggestionChips
              messageId={message.id}
              bodyText={getBodyText()}
              subject={message.subject}
              lead={crmData.lead}
              onApplied={() => void loadCrmData(message.id)}
            />
          )}

          {/* Attachments */}
          {message.hasAttachments && message.attachments && message.attachments.filter(a => !a.isInline).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.attachments.filter(a => !a.isInline).map(att => (
                <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-xs text-[#C9D1D9]">
                  <svg className="w-3.5 h-3.5 text-[#7D8590]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <span>{att.name}</span>
                  <span className="text-[#7D8590]">{fileSize(att.size)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Body */}
          <div className="min-h-0">
            {message.body?.contentType === "html" ? (
              <iframe
                ref={iframeRef}
                sandbox="allow-same-origin"
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #C9D1D9; background: transparent; margin: 0; padding: 0; line-height: 1.6; }
                  a { color: #0078D4; }
                  img { max-width: 100%; height: auto; }
                  table { max-width: 100%; }
                </style></head><body>${message.body.content}</body></html>`}
                className="w-full border-0 bg-transparent"
                style={{ minHeight: "300px" }}
                onLoad={e => {
                  const iframe = e.currentTarget;
                  if (iframe.contentWindow) {
                    iframe.style.height = iframe.contentWindow.document.documentElement.scrollHeight + "px";
                  }
                }}
                title="Email body"
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-[#C9D1D9] font-sans leading-relaxed">
                {message.body?.content ?? message.bodyPreview ?? ""}
              </pre>
            )}
          </div>

          {/* Thread view */}
          {message.conversationId && (
            <div>
              {!showThread ? (
                <button
                  onClick={() => void loadThread()}
                  className="text-xs text-[#0078D4] hover:text-[#1A90E0] flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  View thread
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold text-[#7D8590] uppercase">Thread ({thread.length} messages)</p>
                  {thread.map(t => t.id !== message.id && (
                    <div key={t.id} className="border border-[#30363D] rounded-xl p-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#C9D1D9]">{t.from?.emailAddress.name || t.from?.emailAddress.address}</span>
                        <span className="text-[#7D8590]">{formatDate(t.receivedDateTime)}</span>
                      </div>
                      <p className="text-xs text-[#7D8590]">{t.bodyPreview}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Compose/Reply form */}
          {composeMode && <InboxComposeForm onSent={refreshMessageList} />}

          {/* Extracted tasks panel */}
          {extractedTasks && extractedTasks.length > 0 && (
            <div className="border border-[#30363D] rounded-xl p-4 space-y-3 bg-[#161B22]">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#E6EDF3]">AI Extracted Tasks ({extractedTasks.length})</p>
                <button
                  onClick={() => setShowConvertModal(true)}
                  className="px-3 py-1 text-xs font-medium bg-[#0078D4] text-white rounded-md hover:bg-[#1A90E0]"
                >
                  Create Tasks
                </button>
              </div>
              <div className="space-y-2">
                {extractedTasks.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs border border-[#30363D] rounded-lg p-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${t.priority === "high" ? "bg-red-400" : t.priority === "medium" ? "bg-amber-400" : "bg-blue-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[#C9D1D9] truncate">{t.title}</p>
                      {t.description && <p className="text-[#7D8590] text-[11px]">{t.description}</p>}
                      {t.dueDate && <p className="text-[10px] text-[#7D8590] mt-0.5">Due: {t.dueDate}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Panel */}
      {aiPanelOpen && (
        <div className="w-72 shrink-0 overflow-hidden">
          <InboxAIPanel
            messageId={message.id}
            subject={message.subject}
            bodyText={getBodyText()}
            senderName={senderName}
            crmContext={crmData?.lead ? {
              leadName: crmData.lead.name,
              leadCompany: crmData.lead.company ?? undefined,
              leadScore: crmData.lead.score,
              opportunityStage: crmData.opportunity ? "opportunity" : undefined,
            } : undefined}
            onInsertText={(text: string) => {
              if (composeMode) openCompose(composeMode, { body: text });
            }}
            onExtractedTasks={handleExtractedTasks}
          />
        </div>
      )}

      {/* Convert to Task Modal — supports both single and batch (from AI extract) */}
      {showConvertModal && (
        <ConvertToTaskModal
          graphMessageId={message.id}
          subject={message.subject}
          aiTasks={extractedTasks && extractedTasks.length > 0 ? extractedTasks : undefined}
          onClose={() => setShowConvertModal(false)}
          onCreated={tasks => {
            setTaskCreated(tasks);
            setShowConvertModal(false);
            void loadCrmData(message.id);
            refreshMessageList();
          }}
        />
      )}

      {/* Create Opportunity Modal */}
      {showOpportunityModal && opportunitySignals && (
        <CreateOpportunityModal
          graphMessageId={message.id}
          subject={message.subject}
          opportunitySignals={opportunitySignals}
          onClose={() => setShowOpportunityModal(false)}
          onCreated={() => {
            setShowOpportunityModal(false);
            void loadCrmData(message.id);
            refreshMessageList();
          }}
        />
      )}
    </div>
  );
}
