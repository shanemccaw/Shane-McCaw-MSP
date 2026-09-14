import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * Requests (#3998, Feature #1659, part of #1485). Real design landed at
 * `Design/portal/design_handoff_full_site/screens/Requests and Support Chat.dc.html`,
 * contract pack `docs/requests-and-support-chat-contract-pack.md` (#2450, §7-§10,
 * §12-§15). That design's own scope is the "Requests" list/detail/open-a-request
 * UI only — the chat itself already lives on the real ShaneBot page
 * (`pages/support.tsx`, route `/support`), which this page links out to instead of
 * drawing a second chat surface, exactly as the design's own "Quick questions go
 * to ShaneBot" panel does.
 *
 * Wired to the real, already-built endpoints in
 * `artifacts/api-server/src/routes/portal-customer-requests.ts` — no fixture data:
 *   - POST /api/portal/customer/requests               (open a request)
 *   - GET  /api/portal/customer/requests                (list)
 *   - GET  /api/portal/customer/requests/:ticketId      (detail + thread)
 *   - POST /api/portal/customer/requests/:ticketId/reply
 *
 * #2512 note: the design's own "ledger" copy still describes the list route
 * (200 configured:false) and the detail/reply routes (503) as reporting the same
 * Zoho-unavailable condition two different ways. That's no longer true — #2512
 * landed (commit ac7b38446) before this build and aligned all three routes on the
 * same 200 configured:false shape, verified directly against the current route
 * file. The ledger line below is corrected to match the real, current backend
 * rather than copied verbatim from a design drawn against the pre-fix contract.
 */

interface CustomerTicketSummary {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  statusType: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  webUrl: string | null;
}

interface CustomerTicketThreadEntry {
  id: string;
  kind: "thread" | "comment";
  direction: "in" | "out" | null;
  author: string | null;
  isPublic: boolean;
  content: string;
  createdTime: string;
}

type ListState = "loading" | "live" | "failed";
type DetailState = "idle" | "loading" | "live" | "failed";

const ALLOWED_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

const ACCENT = "#0078D4";
const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";

const STATUS_STYLE: Record<string, { ink: string; bg: string; bd: string }> = {
  Open: { ink: "#60a5fa", bg: "rgba(96,165,250,.10)", bd: "rgba(96,165,250,.3)" },
  "On Hold": { ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" },
  Escalated: { ink: "#f87171", bg: "rgba(248,113,113,.10)", bd: "rgba(248,113,113,.3)" },
  Closed: { ink: "#94a3b8", bg: "rgba(148,163,184,.08)", bd: "rgba(148,163,184,.22)" },
};

function statusStyle(statusType: string | null) {
  return (statusType && STATUS_STYLE[statusType]) || { ink: "#94a3b8", bg: "rgba(148,163,184,.08)", bd: "rgba(148,163,184,.22)" };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return fmtDate(iso);
}

const LEDGER: { gap: string; where: string }[] = [
  { gap: "\"Not set up\" is drawn as a real state, not an error — and, since #2512, the list, detail and reply routes all agree on the same 200 configured:false shape for the same condition, not just the list.", where: "§7-§10 · #2512" },
  { gap: "Submitting and replying are queued. The desk picks writes up on a sweep (~every 5 minutes), so nothing appears instantly, and this page says so rather than faking a row.", where: "§7 · §10" },
  { gap: "Private agent notes are never shown here — only public thread entries reach a customer.", where: "§9" },
  { gap: "Ticket statuses are the desk's own free-text words. This page does not invent a status vocabulary; the coloured pill keys off the desk's four coarse buckets only.", where: "§8 · §12" },
  { gap: "Priority and category ride inside the ticket text, not as structured Zoho fields — this page says so rather than implying fields the desk doesn't have.", where: "§7" },
  { gap: "A reply is prefixed with your name, because the desk would otherwise credit it to the connected agent, not you.", where: "§10" },
  { gap: "\"Not yours\" and \"doesn't exist\" are the same 404 by design — ownership can't be probed by id.", where: "§9" },
  { gap: "The chat itself lives on ShaneBot, not a second chat drawn on this page — this page only explains the propose-then-confirm handoff and links there.", where: "§1 · §11" },
];

export function CustomerRequestsContent() {
  const { fetchWithAuth } = useAuth();

  const [listState, setListState] = useState<ListState>("loading");
  const [configured, setConfigured] = useState(true);
  const [requests, setRequests] = useState<CustomerTicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailConfigured, setDetailConfigured] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<CustomerTicketSummary | null>(null);
  const [thread, setThread] = useState<CustomerTicketThreadEntry[]>([]);
  const [detailReloadKey, setDetailReloadKey] = useState(0);

  const [replyMessage, setReplyMessage] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState(false);

  const [ledgerOpen, setLedgerOpen] = useState(true);

  const loadList = useCallback(async () => {
    setListState("loading");
    try {
      const res = await fetchWithAuth("/api/portal/customer/requests");
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const data = (await res.json()) as { configured?: boolean; requests?: CustomerTicketSummary[] };
      setConfigured(data.configured !== false);
      setRequests(data.requests ?? []);
      setListState("live");
    } catch {
      setListState("failed");
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Mirrors the design's own default (state.sel = 0) — the first request is
  // opened automatically once the list is live, without overriding a
  // customer's own subsequent pick.
  useEffect(() => {
    if (listState === "live" && configured && requests.length > 0 && selectedId === null) {
      setSelectedId(requests[0]!.id);
    }
  }, [listState, configured, requests, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      setDetailState("loading");
      setDetailError(null);
      try {
        const res = await fetchWithAuth(`/api/portal/customer/requests/${encodeURIComponent(selectedId)}`);
        if (res.status === 404) {
          if (!cancelled) {
            setDetailState("failed");
            setDetailError("Request not found.");
          }
          return;
        }
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const data = (await res.json()) as {
          configured?: boolean;
          request?: CustomerTicketSummary | null;
          thread?: CustomerTicketThreadEntry[];
        };
        if (cancelled) return;
        setDetailConfigured(data.configured !== false);
        setDetailRequest(data.request ?? null);
        setThread(data.thread ?? []);
        setDetailState("live");
        setReplyMessage("");
        setReplySent(false);
        setReplyError(null);
      } catch {
        if (!cancelled) {
          setDetailState("failed");
          setDetailError("We couldn't load this request right now. Please try again shortly.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailReloadKey, fetchWithAuth]);

  const submitReply = async () => {
    if (!selectedId || !replyMessage.trim() || replySubmitting) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const res = await fetchWithAuth(`/api/portal/customer/requests/${encodeURIComponent(selectedId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyMessage.trim().slice(0, MAX_BODY) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        configured?: boolean;
        queued?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok && res.status !== 202) {
        setReplyError(data.error ?? "We couldn't add your reply right now. Please try again shortly.");
        return;
      }
      if (data.configured === false) {
        setReplyError(data.message ?? "Ticketing is not available right now.");
        return;
      }
      setReplySent(true);
      setReplyMessage("");
    } catch {
      setReplyError("We couldn't add your reply right now. Please try again shortly.");
    } finally {
      setReplySubmitting(false);
    }
  };

  const startForm = () => {
    setSubject("");
    setDescription("");
    setCategory("");
    setPriority("");
    setFormError(null);
    setQueuedNotice(false);
    setFormOpen(true);
  };

  const submitRequest = async () => {
    const subj = subject.trim();
    const desc = description.trim();
    if (!subj || !desc || formSubmitting) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await fetchWithAuth("/api/portal/customer/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subj.slice(0, MAX_SUBJECT),
          description: desc.slice(0, MAX_BODY),
          category: category.trim(),
          priority,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "We couldn't submit your request right now. Please try again shortly.");
        return;
      }
      setFormOpen(false);
      setQueuedNotice(true);
    } catch {
      setFormError("We couldn't submit your request right now. Please try again shortly.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const canSubmitForm = subject.trim().length > 0 && description.trim().length > 0 && !formSubmitting;
  const isClosed = detailRequest?.statusType === "Closed";

  return (
    <div className="flex flex-col gap-4" data-testid="requests-page">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xl font-bold tracking-tight text-foreground">Requests</span>
        <span
          title="Tickets with your provider's support desk: open one, read the thread, reply. ShaneBot handles quick questions; anything it hands to a human lands here as a ticket."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border text-[10px] font-bold"
          style={{ borderColor: "rgba(148,163,184,.35)", color: "#64748b" }}
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: listState === "failed" ? "#f87171" : "#64748b" }} data-testid="requests-status">
          <span
            className="size-1.5 rounded-full"
            style={{ background: listState === "failed" ? "#f87171" : listState === "loading" ? "#475569" : configured ? "#34d399" : "#475569" }}
          />
          {listState === "loading"
            ? "Reading your requests"
            : listState === "failed"
              ? "Could not read your requests"
              : !configured
                ? "Live — no support desk connected"
                : requests.length === 0
                  ? "Live — desk connected, no requests yet"
                  : `Live — ${requests.length} ${requests.length === 1 ? "request" : "requests"} · read from the desk each visit`}
        </span>
        {listState === "live" && configured && !formOpen && (
          <button
            type="button"
            onClick={startForm}
            className="ml-auto flex-none rounded-md px-3.5 py-2 text-xs font-semibold text-white"
            style={{ background: ACCENT }}
            data-testid="requests-open-form"
          >
            Open a request
          </button>
        )}
      </div>

      {listState === "failed" && (
        <div className="flex gap-2.5 rounded-xl border border-dashed p-3.5" style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="requests-error">
          <AlertTriangle className="mt-0.5 size-[15px] flex-none" color="#f87171" strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">Your requests could not be loaded</span>
            <span className="max-w-[600px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an empty list — a request may well be open right now.
            </span>
            <button type="button" onClick={() => void loadList()} className="w-fit pt-0.5 text-[11.5px] font-semibold" style={{ color: "#60a5fa" }} data-testid="requests-retry">
              Try again
            </button>
          </div>
        </div>
      )}

      {listState === "live" && !configured && (
        <div className="flex flex-col gap-2 rounded-2xl border p-5" style={{ borderColor: HAIRLINE, background: CARD_BG }} data-testid="requests-not-configured">
          <span className="text-[13.5px] font-semibold text-foreground">Ticketing is not set up for your provider yet</span>
          <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
            This is a real answer, not an outage: your provider has not connected a support desk to the platform, so
            there is no request list to show and nothing to open. ShaneBot still works, and "talk to a human" still
            reaches your provider by email.
          </span>
          <a href="/support" className="w-fit text-xs font-semibold" style={{ color: "#60a5fa" }}>
            Ask ShaneBot instead →
          </a>
        </div>
      )}

      {formOpen && (
        <div className="flex flex-col gap-3" style={{ border: "1px solid rgba(0,120,212,.35)", borderRadius: 14, background: "rgba(0,120,212,.04)", padding: "16px 20px" }} data-testid="requests-form">
          <div className="flex items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-foreground">Open a request</span>
            <button type="button" onClick={() => setFormOpen(false)} className="ml-auto text-[11.5px] font-semibold" style={{ color: "#64748b" }} data-testid="requests-form-cancel">
              Cancel
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-bold" style={{ letterSpacing: ".09em", color: "#475569" }}>SUBJECT · UP TO 200 CHARACTERS</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={MAX_SUBJECT}
              placeholder="A short summary of what's going on"
              className="rounded-md border bg-transparent px-2.5 py-2 text-[12.5px] text-foreground outline-none"
              style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.02)" }}
              data-testid="requests-form-subject"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-bold" style={{ letterSpacing: ".09em", color: "#475569" }}>DESCRIBE YOUR REQUEST · UP TO 5,000 CHARACTERS</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_BODY}
              rows={4}
              placeholder="What happened, and what you need from us"
              className="resize-none rounded-md border bg-transparent px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground outline-none"
              style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.02)" }}
              data-testid="requests-form-description"
            />
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%,200px), 1fr))" }}>
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-bold" style={{ letterSpacing: ".09em", color: "#475569" }}>CATEGORY · OPTIONAL, FREE TEXT</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Access"
                className="rounded-md border bg-transparent px-2.5 py-2 text-[12.5px] text-foreground outline-none"
                style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.02)" }}
                data-testid="requests-form-category"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-bold" style={{ letterSpacing: ".09em", color: "#475569" }}>PRIORITY · OPTIONAL</span>
              <div className="flex flex-wrap gap-1.5">
                {ALLOWED_PRIORITIES.map((p) => {
                  const on = priority === p;
                  return (
                    <span
                      key={p}
                      onClick={() => setPriority(on ? "" : p)}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        color: on ? "#f8fafc" : "#64748b",
                        background: on ? "rgba(255,255,255,.08)" : "transparent",
                        borderColor: on ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.1)",
                      }}
                      data-testid={`requests-form-priority-${p.toLowerCase()}`}
                    >
                      {p}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
            <span className="max-w-[460px] text-[11px] leading-relaxed" style={{ color: "#475569" }}>
              Category and priority travel inside the ticket text. Your provider's support desk receives the ticket
              on its next sweep, usually within a few minutes — it is queued, not instant.
              {formError ? ` ${formError}` : ""}
            </span>
            <button
              type="button"
              onClick={() => void submitRequest()}
              disabled={!canSubmitForm}
              className="ml-auto flex-none rounded-md px-3.5 py-2 text-xs font-semibold"
              style={{ color: canSubmitForm ? "#fff" : "#475569", background: canSubmitForm ? ACCENT : "rgba(255,255,255,.06)", cursor: canSubmitForm ? "pointer" : "default" }}
              data-testid="requests-form-submit"
            >
              {formSubmitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      )}

      {queuedNotice && (
        <div className="flex gap-2.5 rounded-xl border p-3" style={{ borderColor: "rgba(52,211,153,.25)", background: "rgba(52,211,153,.06)" }} data-testid="requests-queued-notice">
          <CheckCircle2 className="mt-0.5 size-[15px] flex-none" color="#34d399" strokeWidth={1.75} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[12.5px] font-semibold text-foreground">Your request has been submitted. Our team has been notified and will be in touch.</span>
            <span className="text-[11px] leading-relaxed" style={{ color: "#64748b" }}>
              It will appear in the list below once the support desk has created it — refresh in a few minutes if it is not there yet.
            </span>
          </div>
        </div>
      )}

      {listState === "live" && configured && requests.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-9 text-center" style={{ borderColor: "rgba(148,163,184,.25)" }} data-testid="requests-empty">
          <span className="text-[13.5px] font-semibold text-foreground">You have not opened a request yet</span>
          <span className="max-w-[540px] text-xs leading-relaxed text-muted-foreground">
            This is a real, successful read — the desk is connected and holds nothing for you.
          </span>
        </div>
      )}

      {listState === "live" && configured && requests.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%,320px), 1fr))" }} data-testid="requests-list">
          <div className="self-start rounded-2xl border px-4 pb-3 pt-1.5" style={{ borderColor: HAIRLINE, background: CARD_BG }}>
            <div className="flex items-center gap-2.5 py-2.5">
              <span className="text-[13px] font-semibold text-foreground">Your requests</span>
              <span className="text-[11px]" style={{ color: "#64748b" }}>newest activity first</span>
            </div>
            {requests.map((r) => {
              const s = statusStyle(r.statusType);
              const active = r.id === selectedId;
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className="-mx-2.5 flex cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2.5"
                  style={{ borderTop: "1px solid rgba(255,255,255,.06)", background: active ? "rgba(255,255,255,.04)" : "transparent" }}
                  data-testid={`request-row-${r.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-none font-mono text-[10.5px]" style={{ color: "#64748b" }}>#{r.ticketNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "#e2e8f0" }}>{r.subject}</span>
                    <span className="flex-none rounded-full border px-2 py-[2px] text-[10px] font-semibold" style={{ color: s.ink, background: s.bg, borderColor: s.bd }}>
                      {r.status ?? "—"}
                    </span>
                  </div>
                  <span className="text-[10.5px]" style={{ color: "#64748b" }}>
                    opened {fmtDate(r.createdTime)} · updated {fmtDate(r.modifiedTime)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-col gap-3 self-start rounded-2xl border px-5 py-4" style={{ borderColor: HAIRLINE, background: CARD_BG }} data-testid="request-detail">
            {detailState === "loading" && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin" style={{ color: "#64748b" }} />
              </div>
            )}

            {detailState === "failed" && (
              <div className="flex gap-2.5 rounded-xl border border-dashed p-3.5" style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="request-detail-error">
                <AlertTriangle className="mt-0.5 size-[15px] flex-none" color="#f87171" strokeWidth={1.75} />
                <div className="flex flex-col gap-1">
                  <span className="text-[12.5px] font-semibold text-foreground">{detailError}</span>
                  {selectedId && (
                    <button
                      type="button"
                      onClick={() => setDetailReloadKey((k) => k + 1)}
                      className="w-fit text-[11.5px] font-semibold"
                      style={{ color: "#60a5fa" }}
                      data-testid="request-detail-retry"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            )}

            {detailState === "live" && !detailConfigured && (
              <div className="flex gap-2.5 rounded-xl border p-3.5" style={{ borderColor: "rgba(148,163,184,.3)", background: "rgba(148,163,184,.05)" }}>
                <AlertTriangle className="mt-0.5 size-[15px] flex-none" color="#94a3b8" strokeWidth={1.75} />
                <span className="text-[12.5px] leading-relaxed" style={{ color: "#94a3b8" }}>
                  Ticketing is not available right now. Your requests still exist — try again shortly.
                </span>
              </div>
            )}

            {detailState === "live" && detailConfigured && detailRequest && (
              <>
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-bold tracking-tight text-foreground">{detailRequest.subject}</span>
                    {(() => {
                      const s = statusStyle(detailRequest.statusType);
                      return (
                        <span className="rounded-full border px-2 py-[2px] text-[10px] font-semibold" style={{ color: s.ink, background: s.bg, borderColor: s.bd }}>
                          {detailRequest.status ?? "—"}
                        </span>
                      );
                    })()}
                  </div>
                  <span className="text-[11px]" style={{ color: "#64748b" }}>
                    #{detailRequest.ticketNumber} · opened {fmtDate(detailRequest.createdTime)} · last activity {fmtDate(detailRequest.modifiedTime)}
                    {detailRequest.webUrl ? (
                      <>
                        {" · "}
                        <a href={detailRequest.webUrl} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: "#60a5fa" }}>
                          open in the support desk ↗
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>

                <div className="flex flex-col gap-2.5 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
                  {thread.length === 0 && (
                    <span className="text-[12px] leading-relaxed" style={{ color: "#94a3b8" }}>No messages yet.</span>
                  )}
                  {thread.map((t) => {
                    const isIn = t.direction === "in";
                    return (
                      <div key={t.id} className="flex flex-col gap-1" style={{ alignItems: isIn ? "flex-end" : "flex-start" }}>
                        <div
                          className="flex max-w-[88%] flex-col gap-1 rounded-xl border px-3 py-2.5"
                          style={{
                            borderColor: isIn ? "rgba(0,120,212,.35)" : "rgba(255,255,255,.1)",
                            background: isIn ? "rgba(0,120,212,.08)" : "rgba(255,255,255,.03)",
                          }}
                        >
                          <span className="whitespace-pre-line text-[12px] leading-relaxed" style={{ color: "#e2e8f0" }}>{t.content}</span>
                        </div>
                        <span className="text-[10.5px]" style={{ color: "#64748b" }}>{t.author ?? "—"} · {fmtWhen(t.createdTime)}</span>
                      </div>
                    );
                  })}
                  <span className="text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
                    Only messages marked public reach you. Notes your provider's agents keep between themselves are not in this thread.
                  </span>
                </div>

                {!isClosed ? (
                  <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
                    <textarea
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      maxLength={MAX_BODY}
                      rows={2}
                      placeholder="Write a reply…"
                      className="resize-none rounded-md border bg-transparent px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground outline-none"
                      style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.02)" }}
                      data-testid="request-reply-input"
                    />
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="max-w-[420px] text-[10.5px] leading-relaxed" style={{ color: "#475569" }}>
                        Your reply is queued to the desk and appears in the thread credited to you by name — the desk otherwise credits it to the agent account.
                      </span>
                      <button
                        type="button"
                        onClick={() => void submitReply()}
                        disabled={!replyMessage.trim() || replySubmitting}
                        className="ml-auto flex flex-none items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
                        style={{
                          color: replyMessage.trim() ? "#fff" : "#475569",
                          background: replyMessage.trim() ? ACCENT : "rgba(255,255,255,.06)",
                          cursor: replyMessage.trim() ? "pointer" : "default",
                        }}
                        data-testid="request-reply-submit"
                      >
                        {replySubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                        Send reply
                      </button>
                    </div>
                    {replySent && (
                      <span className="text-[11.5px]" style={{ color: "#34d399" }} data-testid="request-reply-success">
                        Your reply has been added to the request.
                      </span>
                    )}
                    {replyError && (
                      <span className="text-[11.5px]" style={{ color: "#f87171" }} data-testid="request-reply-error">
                        {replyError}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="border-t pt-3 text-[11.5px] leading-relaxed" style={{ borderColor: "rgba(255,255,255,.07)", color: "#94a3b8" }}>
                    This request is closed. Open a new one if the issue comes back — a closed ticket does not take replies from here.
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5 rounded-2xl border p-4" style={{ borderColor: HAIRLINE, background: CARD_BG }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">Quick questions go to ShaneBot</span>
          <a href="/support" className="ml-auto text-xs font-semibold" style={{ color: "#60a5fa" }}>
            Open ShaneBot →
          </a>
        </div>
        <span className="max-w-[720px] text-xs leading-relaxed text-muted-foreground">
          The assistant answers from your own tenant's data. When it cannot help, or when you ask for a person, it
          hands off to your provider — that handoff becomes a ticket in the list above. Nothing it proposes runs
          until you confirm it.
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
          <button type="button" onClick={() => setLedgerOpen((o) => !o)} className="ml-auto text-[11.5px] font-semibold" style={{ color: "#64748b" }}>
            {ledgerOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {ledgerOpen && (
          <div className="flex flex-col">
            {LEDGER.map((l, i) => (
              <div key={i} className="flex items-start gap-3 py-2" style={{ borderTop: i === 0 ? undefined : "1px solid rgba(255,255,255,.05)" }}>
                <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed" style={{ color: "#cbd5e1" }}>{l.gap}</span>
                <span className="flex-none whitespace-nowrap font-mono text-[10.5px]" style={{ color: "#475569" }}>{l.where}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CustomerRequestsPage() {
  return (
    <div className="mx-auto max-w-[950px] py-2">
      <CustomerRequestsContent />
    </div>
  );
}
