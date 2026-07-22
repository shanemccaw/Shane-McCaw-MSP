import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { MessageSquare, Inbox, Flag, ShieldAlert } from "lucide-react";

/**
 * Public AI Chat — review queue.
 *
 * This is the ONLY way flagged public-chat conversations reach Shane: he checks this
 * page on his own schedule. Nothing pushes — no email, notification, or alert — by
 * deliberate personal-safety design. Conversations about Shane personally are
 * declined by the assistant and NEVER escalate here.
 */

type ReviewReason = "purchase_intent" | "needs_shane" | "explicit_request";
type ReviewStatus = "new" | "reviewed" | "resolved" | "archived";

interface ConversationRow {
  id: number;
  sessionId: string;
  messageCount: number;
  needsReview: boolean;
  reviewReason: ReviewReason | null;
  reviewStatus: ReviewStatus;
  declinedPersonalTopic: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactCompany: string | null;
  serviceInterest: string | null;
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

interface ConversationDetail extends ConversationRow {
  messages: StoredMessage[];
  requestSummary: string | null;
  userAgent: string | null;
}

interface Stats {
  total: number;
  needsReview: number;
  awaitingReview: number;
}

const REASON_LABELS: Record<ReviewReason, string> = {
  purchase_intent: "Purchase intent",
  needs_shane: "Needs Shane",
  explicit_request: "Asked for a human",
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
  archived: "Archived",
};

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div>
        <p className="text-2xl font-extrabold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ReasonBadge({ reason }: { reason: ReviewReason | null }) {
  if (!reason) return null;
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
      {REASON_LABELS[reason]}
    </span>
  );
}

function fmt(dt: string): string {
  const d = new Date(dt);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Transcript({ messages }: { messages: StoredMessage[] }) {
  if (!messages || messages.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {messages.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i} className="border-l-2 border-primary pl-3">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-0.5">Assistant</p>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{m.content}</p>
          </div>
        ) : (
          <div key={i} className="pl-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Visitor</p>
            <p className="text-sm text-foreground bg-accent rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap">{m.content}</p>
          </div>
        )
      )}
    </div>
  );
}

function SlideOver({ id, onClose, onRefresh }: { id: number; onClose: () => void; onRefresh: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchWithAuth(`/api/admin/public-chat/conversations/${id}`);
      if (res.ok && !cancelled) setDetail((await res.json()) as ConversationDetail);
    })();
    return () => { cancelled = true; };
  }, [id, fetchWithAuth]);

  const setStatus = async (reviewStatus: ReviewStatus) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/public-chat/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus }),
      });
      if (res.ok) {
        const updated = (await res.json()) as ConversationDetail;
        setDetail((prev) => (prev ? { ...prev, reviewStatus: updated.reviewStatus } : prev));
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full sm:max-w-lg bg-card shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-[#0A2540] flex-shrink-0">
          <h2 className="text-white font-bold">Conversation</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
          {!detail ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ReasonBadge reason={detail.reviewReason} />
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent text-foreground">
                  {STATUS_LABELS[detail.reviewStatus]}
                </span>
                {detail.declinedPersonalTopic && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 inline-flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> Personal topic declined
                  </span>
                )}
              </div>

              {(detail.contactName || detail.contactEmail || detail.serviceInterest || detail.requestSummary) && (
                <div className="space-y-2 border border-border rounded-lg p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Captured request</p>
                  {detail.contactName && <p className="text-sm text-foreground">{detail.contactName}</p>}
                  {detail.contactEmail && (
                    <a href={`mailto:${detail.contactEmail}`} className="text-primary hover:underline text-sm block">{detail.contactEmail}</a>
                  )}
                  {detail.contactCompany && <p className="text-sm text-foreground">{detail.contactCompany}</p>}
                  {detail.serviceInterest && <p className="text-sm text-muted-foreground">Interested in: {detail.serviceInterest}</p>}
                  {detail.requestSummary && <p className="text-sm text-muted-foreground">{detail.requestSummary}</p>}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Full transcript ({detail.messageCount} messages)
                </p>
                <Transcript messages={detail.messages} />
              </div>

              <p className="text-[11px] text-muted-foreground">
                Session {detail.sessionId} · started {fmt(detail.createdAt)} · last activity {fmt(detail.updatedAt)}
              </p>
            </>
          )}
        </div>

        {detail && (
          <div className="border-t border-border px-6 py-4 flex flex-wrap gap-2 flex-shrink-0">
            {(["reviewed", "resolved", "archived"] as ReviewStatus[]).map((s) => (
              <button
                key={s}
                disabled={saving || detail.reviewStatus === s}
                onClick={() => void setStatus(s)}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Mark {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatQueue() {
  const { fetchWithAuth } = useAuth();
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, needsReview: 0, awaitingReview: 0 });
  const [flagged, setFlagged] = useState<"yes" | "no" | "all">("yes");
  const [status, setStatus] = useState<ReviewStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ flagged });
      if (status !== "all") params.set("status", status);
      const [convRes, statsRes] = await Promise.all([
        fetchWithAuth(`/api/admin/public-chat/conversations?${params.toString()}`),
        fetchWithAuth(`/api/admin/public-chat/stats`),
      ]);
      if (convRes.ok) setRows(((await convRes.json()) as { conversations: ConversationRow[] }).conversations);
      if (statsRes.ok) setStats((await statsRes.json()) as Stats);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, flagged, status]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" /> Chat Review Queue
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Public-site AI chat conversations. This is a pull-based queue — nothing here notifies you;
          review it on your own schedule. Requests about Shane personally are declined by the assistant
          and never appear here as escalations.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total conversations" value={stats.total} icon={<Inbox className="w-5 h-5 text-primary" />} />
        <StatCard label="Flagged for review" value={stats.needsReview} icon={<Flag className="w-5 h-5 text-primary" />} />
        <StatCard label="Awaiting review" value={stats.awaitingReview} icon={<MessageSquare className="w-5 h-5 text-primary" />} />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={flagged}
          onChange={(e) => setFlagged(e.target.value as "yes" | "no" | "all")}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="yes">Flagged for review</option>
          <option value="no">Not flagged</option>
          <option value="all">All conversations</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ReviewStatus | "all")}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="all">Any status</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
          <option value="archived">Archived</option>
        </select>
        <button onClick={() => void load()} className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          Refresh
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-muted-foreground p-6">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6">No conversations match this filter.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelectedId(r.id)}
                  className="w-full text-left px-5 py-4 hover:bg-accent/50 transition-colors flex flex-col gap-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground text-sm">
                      {r.contactName || r.contactEmail || "Anonymous visitor"}
                    </span>
                    <ReasonBadge reason={r.reviewReason} />
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent text-muted-foreground">
                      {STATUS_LABELS[r.reviewStatus]}
                    </span>
                    {r.declinedPersonalTopic && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 inline-flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" /> Personal declined
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{fmt(r.updatedAt)}</span>
                  </div>
                  {r.lastMessage && <p className="text-sm text-muted-foreground line-clamp-2">{r.lastMessage}</p>}
                  <p className="text-xs text-muted-foreground">{r.messageCount} messages</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedId != null && (
        <SlideOver id={selectedId} onClose={() => setSelectedId(null)} onRefresh={() => void load()} />
      )}
    </div>
  );
}
