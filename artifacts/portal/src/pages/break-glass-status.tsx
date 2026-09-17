import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchBreakGlassHandoffs,
  fetchBreakGlassRunStatus,
  parseRecipients,
  runBreakGlassAdminOverride,
  sendBreakGlassInvites,
  type BreakGlassAttempt,
  type BreakGlassHandoff,
  type BreakGlassRun,
  type BreakGlassRunStatus,
  type LinkStatus,
  type ReadResult,
} from "@/lib/break-glass-api";

/**
 * Break-glass Access (#3994, Feature #1651) — real design at
 * Design/portal/design_handoff_full_site/screens/Break-glass Access.dc.html,
 * contract pack docs/break-glass-access-contract-pack.md (#2443, regenerated
 * under #2628). Routes: `/break-glass` (the user-menu entry — finds the runs
 * waiting on a handoff) and `/break-glass/:runId` (one run).
 *
 * The design's state switcher enumerates four real response states — pending,
 * dead-ended, write-back-blocked, not-pending — and every one is rendered from
 * the real by-run read below. On top of those, the states the design does not
 * draw but the wire really returns are kept distinct rather than folded into a
 * generic error: loading, 404 not found (same answer for "not yours"), read
 * failed, an invalid run reference, a handoff with no invites yet, a claimed
 * link awaiting acknowledgement, and each admin-override refusal (409 / 502 /
 * 503 / 400) with its own server message.
 *
 * Never shows the credential. The ACCOUNT cell shows the break-glass account
 * identity (#4139) — `breakGlassAccountId` on the by-run read (contract pack
 * §2.2), persisted since #4015 on `break_glass_pending_secrets.break_glass_account_id`
 * and served only once the caller passes that row's own customer check. Rows
 * predating #4015 carry no identity and render a dash.
 *
 * The admin-override control is gated client-side on `can("msp",
 * "ladder.msp-operator")` — the seeded "MSP operator or above" ladder row, the
 * same set the route's own role check admits. That is a presentation hint only;
 * the route is the gate and answers 404 to anyone else.
 */

const HAIRLINE = "rgba(255,255,255,.09)";
const ACCENT = "#0078D4";
const CAUTION = "#c2a63d";

const LINK_STYLE: Record<LinkStatus, { ink: string; bg: string; bd: string }> = {
  pending: { ink: "#60a5fa", bg: "rgba(96,165,250,.10)", bd: "rgba(96,165,250,.30)" },
  consumed: { ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" },
  expired: { ink: "#94a3b8", bg: "rgba(148,163,184,.08)", bd: "rgba(148,163,184,.22)" },
  superseded: { ink: "#94a3b8", bg: "rgba(148,163,184,.08)", bd: "rgba(148,163,184,.22)" },
};

function hhmm(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Today 11:52", "Yesterday 16:40", "Fri 14:02", "Wed 3 Sep, 09:14" — the design's own date shapes. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Today ${hhmm(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${hhmm(d)}`;
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  if (Math.abs(now.getTime() - d.getTime()) < 6 * 24 * 3_600_000) return `${weekday} ${hhmm(d)}`;
  const dayMonth = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${weekday} ${dayMonth}, ${hhmm(d)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function runMeta(run: BreakGlassRun): string {
  if (run.packLabel) return `run #${run.id} · Config Pack "${run.packLabel}"`;
  if (run.definitionName) return `run #${run.id} · ${run.definitionName}`;
  return `run #${run.id}`;
}

/** Outcome column copy — one row per real (linkStatus, verificationOutcome) combination. */
function describeAttempt(a: BreakGlassAttempt): { outcome: string; note: string; ink: string } {
  const windowHours = Math.round((new Date(a.expiresAt).getTime() - new Date(a.createdAt).getTime()) / 3_600_000);
  const open = a.linkStatus === "pending";

  if (a.linkStatus === "consumed" || a.verificationOutcome === "success") {
    return { outcome: "Verified — credential shown once", note: "waiting for them to confirm they have saved it", ink: "#34d399" };
  }
  if (a.verificationOutcome === "role_not_active_pim_eligible") {
    return open
      ? { outcome: "Global Administrator eligible, not active", note: "activate the role in PIM, then reopen the same link", ink: "#fbbf24" }
      : { outcome: "Global Administrator eligible, not active", note: "role was never activated before the link expired", ink: "#fbbf24" };
  }
  if (a.verificationOutcome === "role_absent") {
    return open
      ? { outcome: "No eligible role on this account", note: "signed in fine, but not a Global Administrator", ink: "#f87171" }
      : { outcome: "No eligible role on this account", note: "not a Global Administrator; link burned", ink: "#f87171" };
  }
  if (a.linkStatus === "superseded" || a.verificationOutcome === "superseded") {
    return { outcome: "Superseded", note: "someone else completed the handoff first", ink: "#94a3b8" };
  }
  if (a.linkStatus === "expired" || a.verificationOutcome === "expired") {
    return { outcome: "Not attempted before the link expired", note: `${windowHours}-hour window passed`, ink: "#94a3b8" };
  }
  return { outcome: "Not yet attempted", note: `link is live; expires ${fmtWhen(a.expiresAt)}`, ink: "#94a3b8" };
}

function Panel({ children, testId, dim = false }: { children: React.ReactNode; testId?: string; dim?: boolean }) {
  return (
    <div
      className="flex flex-col rounded-[14px] border"
      style={{ borderColor: dim ? "rgba(255,255,255,.07)" : HAIRLINE, background: dim ? "rgba(255,255,255,.015)" : "rgba(255,255,255,.02)" }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] font-bold tracking-[.09em]" style={{ color: "#475569" }}>{children}</span>;
}

function MessagePanel({ title, body, testId, action }: { title: string; body: string; testId: string; action?: React.ReactNode }) {
  return (
    <Panel testId={testId}>
      <div className="flex flex-col gap-2" style={{ padding: "20px 22px" }}>
        <span className="text-[13.5px] font-semibold text-foreground">{title}</span>
        <span className="max-w-[660px] text-xs leading-relaxed" style={{ color: "#94a3b8" }}>{body}</span>
        {action}
      </div>
    </Panel>
  );
}

type Header = { line: string; dot: string; ink?: string; meta: string | null };

function PageHeader({ header }: { header: Header }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xl font-bold tracking-tight text-foreground">Break-glass access</span>
      <span
        title="A one-time credential handoff. When a Config Pack run needs to set a break-glass admin password, it pauses here until a Global Administrator on your own Microsoft 365 tenant proves who they are by signing in with Microsoft. This page shows the status of that handoff — never the credential."
        className="flex size-[17px] cursor-help items-center justify-center rounded-full border text-[10px] font-bold"
        style={{ borderColor: "rgba(148,163,184,.35)", color: "#64748b" }}
      >
        i
      </span>
      <span className="flex items-center gap-1.5 text-[11px]" style={{ color: header.ink ?? "#64748b" }} data-testid="break-glass-state-line">
        <span className="size-1.5 rounded-full" style={{ background: header.dot }} />
        {header.line}
      </span>
      {header.meta && (
        <span className="ml-auto font-mono text-[11px]" style={{ color: "#64748b" }} data-testid="break-glass-run-meta">
          {header.meta}
        </span>
      )}
    </div>
  );
}

type Modal =
  | { kind: "invite" }
  | { kind: "invited"; invited: number; sent: number }
  | { kind: "override-ok"; reissued: number; sent: number }
  | null;

type Refusal = { status: number | null; error: string; detail?: string };

function RefusalLine({ refusal, testId }: { refusal: Refusal; testId: string }) {
  return (
    <div className="flex items-start gap-2" data-testid={testId}>
      <AlertCircle className="mt-0.5 size-3.5 flex-none" color="#f87171" strokeWidth={1.75} />
      <div className="flex flex-col gap-0.5">
        <span className="text-[11.5px] leading-normal" style={{ color: "#fca5a5" }}>{refusal.error}</span>
        <span className="font-mono text-[10.5px]" style={{ color: "#64748b" }}>
          {refusal.status ?? "no response"}
          {refusal.detail ? ` · ${refusal.detail}` : ""}
        </span>
      </div>
    </div>
  );
}

/** Second sentence of the write-back banner, per real gate reason (graph.ts WriteBack*Error.reason). */
function blockedGuidance(blockedBy: string): string {
  if (blockedBy === "write_consent_not_granted") {
    return "Grant write consent on the Microsoft 365 connection first, then run the reset again. The pending handoff below is unchanged and its links are still dead-ended.";
  }
  if (blockedBy === "write_back_not_enabled") {
    return "Write-back is not switched on for your organisation. Ask your provider to enable it, then run the reset again. The pending handoff below is unchanged and its links are still dead-ended.";
  }
  return "Your organisation could not be resolved for the write-back check. Contact your provider before running the reset again. The pending handoff below is unchanged and its links are still dead-ended.";
}

function RunView({
  runId,
  switcher,
}: {
  runId: number;
  switcher: { handoffs: readonly BreakGlassHandoff[]; onSelect: (runId: number) => void } | null;
}) {
  const { fetchWithAuth, can } = useAuth();
  const [read, setRead] = useState<ReadResult<BreakGlassRunStatus> | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [inviteText, setInviteText] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteRefusal, setInviteRefusal] = useState<Refusal | null>(null);
  const [reason, setReason] = useState("");
  const [overrideText, setOverrideText] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideRefusal, setOverrideRefusal] = useState<Refusal | null>(null);
  const [blockedBy, setBlockedBy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRead(await fetchBreakGlassRunStatus(fetchWithAuth, runId));
  }, [fetchWithAuth, runId]);

  useEffect(() => {
    setRead(null);
    setBlockedBy(null);
    setOverrideRefusal(null);
    void load();
    // fetchWithAuth is re-created per access-token refresh; keying on runId alone
    // matches every other portal page's load effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const status = read?.kind === "live" ? read.data : null;
  const pending = status?.pending ? status : null;
  const attempts = pending?.attempts ?? [];
  const liveCount = attempts.filter((a) => a.linkStatus === "pending").length;
  const claimed = attempts.some((a) => a.linkStatus === "consumed");
  // Mirrors performBreakGlassAdminOverride's own precondition exactly: any
  // attempt that is neither expired nor superseded keeps the reset refused.
  const anyLive = attempts.some((a) => a.linkStatus !== "expired" && a.linkStatus !== "superseded");
  const deadEnded = attempts.length > 0 && !anyLive;
  const canOverride = can("msp", "ladder.msp-operator");

  const header: Header = !read
    ? { line: "Reading this run", dot: "#475569", meta: `run #${runId}` }
    : read.kind === "failed"
      ? { line: "Could not read this run", dot: "#f87171", ink: "#f87171", meta: `run #${runId}` }
      : read.kind !== "live"
        ? { line: "Not found", dot: "#475569", meta: `run #${runId}` }
        : !pending
          ? { line: "Live — no break-glass pause on this run", dot: "#475569", meta: runMeta(read.data.run) }
          : attempts.length === 0
            ? { line: "Live — handoff waiting, no invites sent yet", dot: "#34d399", meta: runMeta(pending.run) }
            : deadEnded
              ? { line: "Live — handoff waiting, every link dead-ended", dot: "#fbbf24", meta: runMeta(pending.run) }
              : { line: `Live — handoff waiting, ${plural(liveCount, "link", "links")} live`, dot: "#34d399", meta: runMeta(pending.run) };

  const lockReason = !canOverride
    ? "A reset needs an MSP operator or above. If every link has dead-ended, ask your provider to force one."
    : liveCount > 0
      ? `${liveCount} link${liveCount === 1 ? " is" : "s are"} still live. A reset is refused while any invited person could still complete the handoff — let the links expire, or wait for one to be claimed.`
      : claimed
        ? "A link has been claimed. A reset is refused while that credential is waiting to be acknowledged."
        : null;

  async function submitInvite() {
    if (!pending) return;
    const { emails, invalid } = parseRecipients(inviteText);
    if (invalid.length > 0) {
      setInviteRefusal({ status: 400, error: `Not an email address: ${invalid.join(", ")}` });
      return;
    }
    if (emails.length < 1 || emails.length > 5) {
      setInviteRefusal({ status: 400, error: "emails must be 1–5 valid addresses" });
      return;
    }
    setInviteBusy(true);
    setInviteRefusal(null);
    const result = await sendBreakGlassInvites(fetchWithAuth, pending.pendingSecretId, emails);
    setInviteBusy(false);
    if (result.kind === "ok") {
      setInviteText("");
      setModal({ kind: "invited", invited: result.invited, sent: result.sent });
      void load();
      return;
    }
    setInviteRefusal({ status: result.status, error: result.error });
    // 409 (no longer awaiting delivery) and 404 both mean this view is stale.
    if (result.status === 409 || result.status === 404) void load();
  }

  async function submitOverride() {
    if (!pending) return;
    const { emails, invalid } = parseRecipients(overrideText);
    if (!reason.trim()) {
      setOverrideRefusal({ status: 400, error: "A written reason is required." });
      return;
    }
    if (invalid.length > 0) {
      setOverrideRefusal({ status: 400, error: `Not an email address: ${invalid.join(", ")}` });
      return;
    }
    if (emails.length > 5) {
      setOverrideRefusal({ status: 400, error: "emails (if given) must be 1–5 valid addresses" });
      return;
    }
    setOverrideBusy(true);
    setOverrideRefusal(null);
    setBlockedBy(null);
    const result = await runBreakGlassAdminOverride(fetchWithAuth, pending.pendingSecretId, reason.trim(), emails);
    setOverrideBusy(false);
    if (result.kind === "ok") {
      setReason("");
      setOverrideText("");
      setModal({ kind: "override-ok", reissued: result.reissued, sent: result.sent });
      void load();
      return;
    }
    if (result.kind === "blocked") {
      setBlockedBy(result.blockedBy);
      return;
    }
    setOverrideRefusal({ status: result.status, error: result.error, ...(result.detail ? { detail: result.detail } : {}) });
    if (result.status === 409 || result.status === 404) void load();
  }

  const modalSpec =
    modal?.kind === "invite"
      ? {
          title: "Send verification invites",
          body: "Each person receives an email link. Opening it starts a Microsoft sign-in on your tenant; only an account holding Global Administrator, active at that moment, will be shown the credential. The invite itself carries nothing secret.",
          note: "Up to five addresses per send. Some emails can fail individually — you are told how many were requested and how many actually went out.",
        }
      : modal?.kind === "invited"
        ? {
            title: "Invites sent",
            body: `${modal.invited} requested · ${modal.sent} sent. The new links appear at the top of the list as "pending" until each person attempts them.`,
            note: "A request and a send can differ: a recipient whose mail bounced is skipped and logged, not treated as a failure of the whole request.",
          }
        : modal?.kind === "override-ok"
          ? {
              title: "Reset issued",
              body: `A new password was written to the break-glass account and stored. The previous handoff is marked superseded — nothing from it was ever delivered. ${plural(modal.reissued, "invite", "invites")} re-issued · ${modal.sent} sent. The run is still paused until the new credential is acknowledged.`,
              note: null,
            }
          : null;

  return (
    <>
      <PageHeader header={header} />

      {switcher && switcher.handoffs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="break-glass-run-switcher">
          <span className="text-[11px]" style={{ color: "#64748b" }}>
            {switcher.handoffs.length} handoffs waiting · most recent first
          </span>
          {switcher.handoffs.map((h) => {
            const active = h.run.id === runId;
            return (
              <button
                key={h.pendingSecretId}
                type="button"
                onClick={() => switcher.onSelect(h.run.id)}
                className="rounded-full border px-2.5 py-1 font-mono text-[10.5px]"
                style={{
                  borderColor: active ? "rgba(96,165,250,.45)" : "rgba(255,255,255,.10)",
                  background: active ? "rgba(96,165,250,.10)" : "transparent",
                  color: active ? "#93c5fd" : "#94a3b8",
                }}
              >
                run #{h.run.id} · {plural(h.liveInviteCount, "live link", "live links")}
              </button>
            );
          })}
        </div>
      )}

      {!read && (
        <MessagePanel testId="break-glass-loading" title="Reading this run" body="Checking whether this run is paused on a break-glass handoff." />
      )}

      {read?.kind === "failed" && (
        <MessagePanel
          testId="break-glass-read-failed"
          title="Could not read this run's break-glass status"
          body={`${read.error} (${read.status ?? "no response"}). Nothing on this page is shown from a stale copy.`}
          action={
            <button
              type="button"
              onClick={() => { setRead(null); void load(); }}
              className="w-fit rounded-md border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "rgba(255,255,255,.12)", color: "#cbd5e1" }}
            >
              Try again
            </button>
          }
        />
      )}

      {(read?.kind === "not-found" || read?.kind === "forbidden") && (
        <MessagePanel
          testId="break-glass-not-found"
          title="Run not found"
          body="There is no run with this reference that you can see. A run that belongs to another organisation answers exactly the same way, so this page cannot tell the two apart."
        />
      )}

      {status && !status.pending && (
        <Panel testId="break-glass-not-pending">
          <div className="flex flex-col gap-2" style={{ padding: "20px 22px" }}>
            <span className="text-[13.5px] font-semibold text-foreground">No break-glass handoff is waiting on this run</span>
            <span className="max-w-[660px] text-xs leading-relaxed" style={{ color: "#94a3b8" }}>
              This is the run's real answer, read successfully. It is also the only answer the read gives for three different situations: the run never reached the verification gate, the run is paused for a different reason, or the credential was already delivered (or replaced by a reset). This page cannot tell those apart, so it does not pretend to.
            </span>
            <span className="max-w-[660px] text-[11px] leading-normal" style={{ color: "#475569" }}>
              If you expected a handoff, the run's own timeline on the pack-execution page is where the gate step and its outcome are recorded.
            </span>
          </div>
        </Panel>
      )}

      {pending && (
        <>
          {blockedBy && (
            <div
              className="flex gap-2.5 rounded-xl border border-dashed"
              style={{ borderColor: "rgba(251,191,36,.5)", background: "rgba(251,191,36,.06)", padding: "14px 16px" }}
              data-testid="break-glass-write-back-blocked"
            >
              <AlertCircle className="mt-0.5 size-[15px] flex-none" color="#fbbf24" strokeWidth={1.75} />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-foreground">The reset was refused by the write-back gate</span>
                <span className="max-w-[640px] text-xs leading-normal" style={{ color: "#94a3b8" }}>
                  Nothing was changed on your tenant. Forcing a reset writes a new password to the break-glass account through Microsoft Graph, and that write is blocked for your organisation right now.
                </span>
                <span className="font-mono text-[11px]" style={{ color: "#fbbf24" }}>409 · blockedBy: {blockedBy}</span>
                <span className="max-w-[640px] text-[11.5px] leading-normal" style={{ color: "#94a3b8" }}>
                  {blockedGuidance(blockedBy)}
                </span>
              </div>
            </div>
          )}

          <Panel testId="break-glass-waiting">
            <div className="flex flex-col gap-3" style={{ padding: "15px 20px 16px" }}>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[13.5px] font-semibold text-foreground">What is waiting</span>
                <span
                  className="rounded-full border px-2 py-[3px] text-[10px] font-semibold"
                  style={{ color: "#fbbf24", background: "rgba(251,191,36,.10)", borderColor: "rgba(251,191,36,.28)" }}
                >
                  Awaiting tenant-admin verification
                </span>
                <span className="ml-auto font-mono text-[10.5px]" style={{ color: "#64748b" }}>
                  pendingSecret #{pending.pendingSecretId}
                </span>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <Eyebrow>ACCOUNT</Eyebrow>
                  <span className="break-all text-[12.5px]" style={{ color: "#e2e8f0" }} data-testid="break-glass-account">
                    {pending.breakGlassAccountId ?? "—"}
                  </span>
                  <span className="text-[10.5px]" style={{ color: "#64748b" }}>identity stamped on the run; the password is not on this page</span>
                </div>
                <div className="flex flex-col gap-[3px]">
                  <Eyebrow>CREATED</Eyebrow>
                  <span className="text-[12.5px]" style={{ color: "#e2e8f0" }} data-testid="break-glass-created">
                    {fmtWhen(pending.createdAt)}
                  </span>
                  <span className="text-[10.5px]" style={{ color: "#64748b" }}>when the run reached the gate and paused</span>
                </div>
                <div className="flex flex-col gap-[3px]">
                  <Eyebrow>WHO CAN CLAIM IT</Eyebrow>
                  <span className="text-[12.5px]" style={{ color: "#e2e8f0" }}>An active Global Administrator</span>
                  <span className="text-[10.5px]" style={{ color: "#64748b" }}>proven by a Microsoft sign-in on your tenant, not by this session</span>
                </div>
              </div>
              <span className="max-w-[680px] border-t pt-[11px] text-[11.5px] leading-relaxed" style={{ color: "#94a3b8", borderColor: "rgba(255,255,255,.06)" }}>
                The password is shown once, on a page the invited person reaches from their email after signing in with Microsoft. When they confirm they have saved it, the stored copy is purged and the paused run continues on its own. Nothing on this page can reveal it, to you or to anyone else.
              </span>
            </div>
          </Panel>

          <Panel testId="break-glass-invites">
            <div className="overflow-x-auto" style={{ padding: "6px 20px 14px" }}>
              <div className="flex flex-wrap items-center gap-3" style={{ padding: "13px 0 8px" }}>
                <span className="text-[13.5px] font-semibold text-foreground">Verification invites</span>
                <span className="text-[11px]" style={{ color: "#64748b" }}>
                  {attempts.length} issued · {liveCount} live · most recent first
                </span>
                <button
                  type="button"
                  onClick={() => { setInviteRefusal(null); setModal({ kind: "invite" }); }}
                  className="ml-auto flex-none whitespace-nowrap rounded-md px-3 py-[7px] text-xs font-semibold text-white hover:bg-[#005A9E]"
                  style={{ background: ACCENT }}
                  data-testid="break-glass-open-invite"
                >
                  Send invites
                </button>
              </div>
              <div className="flex min-w-[560px] items-center gap-3 pb-[5px]">
                <span className="min-w-0 flex-1"><Eyebrow>INVITED</Eyebrow></span>
                <span className="w-[86px] flex-none"><Eyebrow>LINK</Eyebrow></span>
                <span className="w-[210px] flex-none"><Eyebrow>LAST OUTCOME</Eyebrow></span>
                <span className="w-[92px] flex-none text-right"><Eyebrow>ATTEMPTED</Eyebrow></span>
              </div>
              {attempts.length === 0 && (
                <div className="min-w-[560px] border-t py-3 text-xs" style={{ borderColor: "rgba(255,255,255,.06)", color: "#94a3b8" }} data-testid="break-glass-no-invites">
                  No invites have been sent for this handoff yet.
                </div>
              )}
              {attempts.map((a) => {
                const d = describeAttempt(a);
                const s = LINK_STYLE[a.linkStatus];
                return (
                  <div
                    key={a.id}
                    className="flex min-w-[560px] items-center gap-3 border-t py-2.5"
                    style={{ borderColor: "rgba(255,255,255,.06)" }}
                    data-testid="break-glass-attempt-row"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "#e2e8f0" }}>{a.invitedEmail}</span>
                    <span className="w-[86px] flex-none">
                      <span
                        className="inline-block rounded-full border px-2 py-[3px] text-[10px] font-semibold"
                        style={{ color: s.ink, background: s.bg, borderColor: s.bd }}
                      >
                        {a.linkStatus}
                      </span>
                    </span>
                    <div className="flex w-[210px] flex-none flex-col gap-0.5">
                      <span className="text-[11.5px] leading-snug" style={{ color: d.ink }}>{d.outcome}</span>
                      <span className="text-[10.5px] leading-snug" style={{ color: "#64748b" }}>{d.note}</span>
                    </div>
                    <span className="w-[92px] flex-none whitespace-nowrap text-right text-[11.5px]" style={{ color: "#94a3b8" }}>
                      {a.attemptedAt ? fmtWhen(a.attemptedAt) : "—"}
                    </span>
                  </div>
                );
              })}
              <span className="mt-0.5 block border-t pt-2.5 text-[10.5px] leading-normal" style={{ color: "#475569", borderColor: "rgba(255,255,255,.06)" }}>
                Most recent invite first. A link that met an eligible-but-not-activated role stays open on purpose: the same person can activate their role in PIM and reopen the same email link. Two people finishing at the same moment cannot both win — the second is told someone else already has.
              </span>
            </div>
          </Panel>

          <Panel testId="break-glass-override">
            <div className="flex flex-col gap-[11px]" style={{ padding: "15px 20px" }}>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[13.5px] font-semibold text-foreground">Force a reset</span>
                <span
                  className="rounded-full border px-2 py-[3px] text-[10px] font-semibold"
                  style={{ color: "#94a3b8", background: "rgba(148,163,184,.08)", borderColor: "rgba(148,163,184,.22)" }}
                >
                  Admin override · MSP operator or above
                </span>
              </div>
              <span className="max-w-[680px] text-xs leading-relaxed" style={{ color: "#94a3b8" }}>
                When every link has expired or been superseded, an operator can generate a new password for the account, store it, and send fresh invites. It replaces the handoff above — nothing from the old one is ever delivered — and it needs a written reason that is kept on the audit trail. The run stays paused until someone acknowledges the new credential.
              </span>

              {lockReason ? (
                <div className="flex flex-wrap items-center gap-[11px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }} data-testid="break-glass-override-locked">
                  <span className="max-w-[520px] text-[11.5px] leading-normal" style={{ color: "#94a3b8" }}>{lockReason}</span>
                  <span
                    className="ml-auto flex-none cursor-not-allowed whitespace-nowrap rounded-md border px-3.5 py-2 text-xs font-semibold"
                    style={{ color: "#475569", borderColor: "rgba(255,255,255,.08)" }}
                    aria-disabled="true"
                  >
                    Reset and re-invite
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-[9px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }} data-testid="break-glass-override-open">
                  <label className="flex flex-col gap-[9px]">
                    <Eyebrow>REASON · REQUIRED, KEPT ON THE AUDIT TRAIL</Eyebrow>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={overrideBusy}
                      rows={2}
                      className="min-h-[38px] rounded-md border bg-white/[.02] px-[11px] py-[9px] text-xs leading-normal text-[#e2e8f0] outline-none placeholder:text-[#64748b] focus:border-[#0078D4]"
                      style={{ borderColor: "rgba(255,255,255,.12)" }}
                      data-testid="break-glass-override-reason"
                    />
                  </label>
                  <label className="flex flex-col gap-[9px] pt-0.5">
                    <Eyebrow>RE-INVITE · LEAVE EMPTY TO RE-USE THE PREVIOUS RECIPIENTS</Eyebrow>
                    <input
                      value={overrideText}
                      onChange={(e) => setOverrideText(e.target.value)}
                      disabled={overrideBusy}
                      className="rounded-md border bg-white/[.02] px-[11px] py-[9px] font-mono text-xs text-[#e2e8f0] outline-none focus:border-[#0078D4]"
                      style={{ borderColor: "rgba(255,255,255,.12)" }}
                      data-testid="break-glass-override-emails"
                    />
                  </label>
                  {overrideRefusal && <RefusalLine refusal={overrideRefusal} testId="break-glass-override-refused" />}
                  <div className="flex flex-wrap items-center gap-[11px] pt-0.5">
                    <span className="max-w-[520px] text-[11px] leading-normal" style={{ color: "#475569" }}>
                      Writes the new password to your tenant through Microsoft Graph. If that write is blocked for your organisation, nothing changes and you are told why.
                    </span>
                    <button
                      type="button"
                      onClick={() => void submitOverride()}
                      disabled={overrideBusy || !reason.trim()}
                      className="ml-auto flex-none whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#005A9E] disabled:opacity-50"
                      style={{ background: ACCENT }}
                      data-testid="break-glass-override-submit"
                    >
                      {overrideBusy ? "Resetting…" : "Reset and re-invite"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </>
      )}

      {modal && modalSpec && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: "rgba(2,6,23,.72)" }}
          data-testid="break-glass-modal"
        >
          <div
            className="flex w-[480px] max-w-full flex-col gap-[11px] rounded-2xl border"
            style={{ background: "#0b1120", borderColor: "rgba(255,255,255,.12)", boxShadow: "0 24px 64px rgba(0,0,0,.6)", padding: "20px 22px 18px" }}
          >
            <span className="text-[14.5px] font-bold text-foreground">{modalSpec.title}</span>
            <span className="text-[12.5px] leading-relaxed" style={{ color: "#94a3b8" }}>{modalSpec.body}</span>
            {modal.kind === "invite" && (
              <label className="flex flex-col gap-[9px]">
                <Eyebrow>RECIPIENTS · 1 TO 5</Eyebrow>
                <textarea
                  value={inviteText}
                  onChange={(e) => setInviteText(e.target.value)}
                  disabled={inviteBusy}
                  rows={3}
                  className="rounded-md border bg-white/[.02] px-[11px] py-[9px] font-mono text-xs leading-relaxed text-[#e2e8f0] outline-none focus:border-[#0078D4]"
                  style={{ borderColor: "rgba(255,255,255,.12)" }}
                  data-testid="break-glass-invite-recipients"
                />
              </label>
            )}
            {modalSpec.note && <span className="text-[11.5px] leading-normal" style={{ color: CAUTION }}>{modalSpec.note}</span>}
            {modal.kind === "invite" && inviteRefusal && <RefusalLine refusal={inviteRefusal} testId="break-glass-invite-refused" />}
            <div className="flex items-center gap-[9px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              {modal.kind === "invite" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    disabled={inviteBusy}
                    className="ml-auto rounded-md border px-3.5 py-2 text-xs font-semibold"
                    style={{ borderColor: "rgba(255,255,255,.12)", color: "#94a3b8" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitInvite()}
                    disabled={inviteBusy}
                    className="rounded-md px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: ACCENT }}
                    data-testid="break-glass-invite-send"
                  >
                    {inviteBusy ? "Sending…" : "Send"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="ml-auto rounded-md px-3.5 py-2 text-xs font-semibold text-white"
                  style={{ background: ACCENT }}
                  data-testid="break-glass-modal-close"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** `/break-glass` — no run in view: find the runs waiting on a handoff first. */
function HandoffList() {
  const { fetchWithAuth } = useAuth();
  const [read, setRead] = useState<ReadResult<readonly BreakGlassHandoff[]> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    setRead(await fetchBreakGlassHandoffs(fetchWithAuth));
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (read?.kind === "live" && read.data.length > 0) {
    const runId = selected ?? read.data[0].run.id;
    return <RunView runId={runId} switcher={{ handoffs: read.data, onSelect: setSelected }} />;
  }

  const header: Header = !read
    ? { line: "Reading your runs", dot: "#475569", meta: null }
    : read.kind === "live"
      ? { line: "Live — no handoff waiting on any run", dot: "#475569", meta: null }
      : { line: "Could not read your runs", dot: "#f87171", ink: "#f87171", meta: null };

  return (
    <>
      <PageHeader header={header} />
      {!read && (
        <MessagePanel testId="break-glass-loading" title="Reading your runs" body="Looking for runs paused on a break-glass handoff." />
      )}
      {read?.kind === "live" && (
        <MessagePanel
          testId="break-glass-no-handoffs"
          title="No break-glass handoff is waiting"
          body="None of your organisation's runs is paused on a break-glass handoff right now. A run that was never gated, is paused for another reason, or has already delivered its credential does not appear here."
        />
      )}
      {read?.kind === "forbidden" && (
        <MessagePanel
          testId="break-glass-no-customer"
          title="This session is not scoped to one organisation"
          body="Break-glass handoffs are read per organisation. Open the portal as the customer whose run you are looking for, or open the run directly by its reference."
        />
      )}
      {(read?.kind === "failed" || read?.kind === "not-found") && (
        <MessagePanel
          testId="break-glass-read-failed"
          title="Could not read your break-glass handoffs"
          body={read.kind === "failed" ? `${read.error} (${read.status ?? "no response"}).` : "Your organisation could not be resolved."}
          action={
            <button
              type="button"
              onClick={() => { setRead(null); void load(); }}
              className="w-fit rounded-md border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "rgba(255,255,255,.12)", color: "#cbd5e1" }}
            >
              Try again
            </button>
          }
        />
      )}
    </>
  );
}

function BreakGlassContent() {
  const { runId } = useParams<{ runId?: string }>();

  if (runId === undefined) return <HandoffList />;

  if (!/^\d+$/.test(runId)) {
    return (
      <>
        <PageHeader header={{ line: "Invalid run reference", dot: "#475569", meta: null }} />
        <MessagePanel
          testId="break-glass-invalid-run"
          title="Invalid run reference."
          body={`"${runId}" is not a run number.`}
          action={
            <Link href="/break-glass" className="w-fit text-xs font-semibold text-[#60a5fa] hover:text-[#93c5fd]">
              See every handoff waiting on a run
            </Link>
          }
        />
      </>
    );
  }

  return <RunView runId={Number(runId)} switcher={null} />;
}

export default function BreakGlassStatusPage() {
  return (
    <div className="mx-auto max-w-[950px] py-2">
      <div className="flex flex-col gap-4" data-testid="break-glass-page">
        <BreakGlassContent />
      </div>
    </div>
  );
}
