import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInbox } from "@/contexts/InboxContext";

interface Props {
  onSent?: () => void;
  onSaveDraft?: () => void;
}

export default function InboxComposeForm({ onSent, onSaveDraft }: Props) {
  const { fetchWithAuth } = useAuth();
  const { composeDraft, setComposeDraft, closeCompose, refreshMessageList } = useInbox();
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!composeDraft) return null;

  const mode = composeDraft.mode;
  const title = mode === "new" ? "New Message" : mode === "reply" ? "Reply" : mode === "replyAll" ? "Reply All" : "Forward";

  async function handleSend() {
    if (!composeDraft) return;
    setSending(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "reply" || mode === "replyAll") {
        res = await fetchWithAuth(`/api/inbox/messages/${composeDraft.replyToMessageId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: composeDraft.body, replyAll: mode === "replyAll" }),
        });
      } else if (mode === "forward") {
        res = await fetchWithAuth(`/api/inbox/messages/${composeDraft.forwardMessageId}/forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: composeDraft.to.split(",").map(s => s.trim()).filter(Boolean),
            comment: composeDraft.body,
          }),
        });
      } else {
        res = await fetchWithAuth("/api/inbox/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: composeDraft.to.split(",").map(s => s.trim()).filter(Boolean),
            cc: composeDraft.cc ? composeDraft.cc.split(",").map(s => s.trim()).filter(Boolean) : undefined,
            bcc: composeDraft.bcc ? composeDraft.bcc.split(",").map(s => s.trim()).filter(Boolean) : undefined,
            subject: composeDraft.subject,
            body: composeDraft.body,
            bodyType: "html",
          }),
        });
      }
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSent(true);
      refreshMessageList();
      onSent?.();
      setTimeout(() => closeCompose(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function handleSaveDraft() {
    if (!composeDraft) return;
    setSavingDraft(true);
    try {
      await fetchWithAuth("/api/inbox/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeDraft.to.split(",").map(s => s.trim()).filter(Boolean),
          cc: composeDraft.cc ? composeDraft.cc.split(",").map(s => s.trim()).filter(Boolean) : [],
          bcc: composeDraft.bcc ? composeDraft.bcc.split(",").map(s => s.trim()).filter(Boolean) : [],
          subject: composeDraft.subject,
          body: composeDraft.body,
          bodyType: "html",
        }),
      });
      onSaveDraft?.();
    } finally {
      setSavingDraft(false);
    }
  }

  if (sent) {
    return (
      <div className="flex items-center gap-2 p-4 bg-emerald-900/20 border border-emerald-800/40 rounded-lg text-sm text-emerald-400">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Message sent successfully.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border border-[#30363D] rounded-xl bg-[#161B22] p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#E6EDF3]">{title}</span>
        <button onClick={closeCompose} className="text-[#7D8590] hover:text-[#C9D1D9]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {(mode === "new" || mode === "forward") && (
        <div>
          <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">To</label>
          <input
            type="text"
            value={composeDraft.to}
            onChange={e => setComposeDraft({ to: e.target.value })}
            placeholder="email@example.com, ..."
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#7D8590] focus:outline-none focus:border-[#0078D4]"
          />
        </div>
      )}

      {mode === "new" && (
        <>
          <div>
            <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">CC</label>
            <input
              type="text"
              value={composeDraft.cc}
              onChange={e => setComposeDraft({ cc: e.target.value })}
              placeholder="Optional"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#7D8590] focus:outline-none focus:border-[#0078D4]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">BCC</label>
            <input
              type="text"
              value={composeDraft.bcc}
              onChange={e => setComposeDraft({ bcc: e.target.value })}
              placeholder="Optional"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#7D8590] focus:outline-none focus:border-[#0078D4]"
            />
          </div>
        </>
      )}

      {mode !== "reply" && mode !== "replyAll" && (
        <div>
          <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Subject</label>
          <input
            type="text"
            value={composeDraft.subject}
            onChange={e => setComposeDraft({ subject: e.target.value })}
            placeholder="Subject"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#7D8590] focus:outline-none focus:border-[#0078D4]"
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold text-[#7D8590] uppercase mb-1">Message</label>
        <textarea
          value={composeDraft.body}
          onChange={e => setComposeDraft({ body: e.target.value })}
          rows={8}
          placeholder="Write your message..."
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#7D8590] focus:outline-none focus:border-[#0078D4] resize-y font-sans"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={handleSaveDraft}
          disabled={savingDraft}
          className="px-3 py-1.5 text-xs text-[#7D8590] border border-[#30363D] rounded-md hover:bg-[#1C2128] transition-colors disabled:opacity-50"
        >
          {savingDraft ? "Saving…" : "Save Draft"}
        </button>
        <button
          onClick={handleSend}
          disabled={sending}
          className="px-4 py-1.5 text-xs font-medium bg-[#0078D4] text-white rounded-md hover:bg-[#1A90E0] transition-colors disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
