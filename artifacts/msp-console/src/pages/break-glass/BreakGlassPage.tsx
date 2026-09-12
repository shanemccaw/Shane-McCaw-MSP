/**
 * BreakGlassPage — the MSP Console's Break-glass module (#2630, wiring #2675's
 * real backend). Mounts into `ScreenSlot`'s `children` for `sel.page === "bg"`.
 *
 * Design: `Design/MSP_Console/design_handoff_msp_console/Break Glass.dc.html`
 * (README screen 18). Real data: `GET /api/msp/customers/:id/break-glass`
 * (history), `GET .../break-glass/:pendingSecretId` (detail + attempts),
 * `GET .../break-glass/audit` (forced-reset trail), and the one real write —
 * `POST .../break-glass/:pendingSecretId/admin-override` (force a reset +
 * reissue; the same `performBreakGlassAdminOverride` the customer portal calls).
 *
 * Three armed-destructive-action patterns from the README apply here:
 *   - The detail drawer only offers "Force a reset" once the secret is still
 *     `pending_delivery` (matches `selCanOverride` in the design's own logic).
 *   - The override drawer is a confirmation drawer: reason required, an
 *     explicit warning block, one CTA.
 *   - The result is **shown once**: the override response never carries the
 *     credential itself (the design's own honest note — "The credential itself
 *     never reaches this console" — is true of every route here), so what's
 *     shown once is the new pending-secret reference and the reissue counts.
 *     Once dismissed, that reference is gone from view; the row lives on in
 *     "Everything" and "Forced resets" going forward.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  useAdminOverride,
  useBreakGlassAudit,
  useBreakGlassDetail,
  useMspCustomerBreakGlass,
  BreakGlassApiError,
  type AdminOverrideResult,
  type BreakGlassAttempt,
  type BreakGlassSecretSummary,
  type BreakGlassStatus,
  type LinkStatus,
} from "@/api/break-glass-api";

const CARD_LINE = border.card;
const CARD_BG = "rgba(15,23,42,.6)";

const STATUS_TONE: Record<BreakGlassStatus, { color: string; tint: string; line: string; icon: IconName; label: string }> = {
  pending_delivery: { color: "#fbbf24", tint: "rgba(251,191,36,.1)", line: "rgba(251,191,36,.26)", icon: "hourglass", label: "waiting to be claimed" },
  delivered_purged: { color: "#34d399", tint: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.26)", icon: "circle-check-big", label: "claimed and wiped" },
  superseded_by_reset: { color: "#94a3b8", tint: "rgba(148,163,184,.08)", line: "rgba(148,163,184,.2)", icon: "circle-minus", label: "reset, never claimed" },
};

const LINK_TONE: Record<LinkStatus, { color: string; tint: string; line: string }> = {
  pending: { color: "#60a5fa", tint: "rgba(96,165,250,.1)", line: "rgba(96,165,250,.26)" },
  consumed: { color: "#94a3b8", tint: "rgba(148,163,184,.08)", line: "rgba(148,163,184,.2)" },
  expired: { color: "#fbbf24", tint: "rgba(251,191,36,.1)", line: "rgba(251,191,36,.26)" },
  superseded: { color: "#94a3b8", tint: "rgba(148,163,184,.08)", line: "rgba(148,163,184,.2)" },
};

const OUTCOME_COPY: Record<string, { color: string; icon: IconName; text: string }> = {
  success: { color: "#6ee7b7", icon: "circle-check-big", text: "Signed in and took the credential." },
  role_not_active_pim_eligible: { color: "#fcd34d", icon: "clock", text: "They hold the right role but it is not switched on. They can activate it and come back to the same link." },
  role_absent: { color: "#fca5a5", icon: "circle-x", text: "They do not hold the required role at all. The link burns after a few tries." },
  expired: { color: "#fbbf24", icon: "clock-alert", text: "The link ran out before they used it." },
  superseded: { color: "#94a3b8", icon: "circle-minus", text: "A reset replaced this credential, so the link no longer points at anything." },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ageLabel(createdAt: string): { text: string; stale: boolean } {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return { text: "", stale: false };
  const days = Math.floor((Date.now() - created) / 86_400_000);
  if (days <= 0) return { text: "today", stale: false };
  return { text: `${days} ${days === 1 ? "day" : "days"} waiting`, stale: days >= 7 };
}

export function BreakGlassPage({ customerId }: { customerId: number }) {
  const query = useMspCustomerBreakGlass(customerId);
  const auditQuery = useBreakGlassAudit(customerId);
  const override = useAdminOverride(customerId);

  const [tab, setTab] = useState<"waiting" | "history" | "audit">("waiting");
  const [selId, setSelId] = useState<number | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pickedEmails, setPickedEmails] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AdminOverrideResult | null>(null);

  const detailQuery = useBreakGlassDetail(customerId, selId);

  if (query.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {["60%", "42%"].map((w, i) => (
          <div key={i} style={{ height: 84, borderRadius: 12, border: `1px solid ${CARD_LINE}`, background: CARD_BG, padding: 15 }}>
            <div style={{ height: 12, width: w, borderRadius: 6, background: "rgba(148,163,184,.14)" }} />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    const status = query.error instanceof BreakGlassApiError ? query.error.status : null;
    if (status === 403) {
      return (
        <StatePanel
          icon="shield-alert"
          tone={signal.critical}
          title="Not in this MSP's book"
          body="This customer is not owned by your MSP, so its break-glass activity can't be shown here. That's the same ownership check every MSP-scoped route in this console runs."
          wire="assertCustomerAccess(user, customerId) · 404"
        />
      );
    }
    if (status === 404) {
      return (
        <StatePanel
          icon="triangle-alert"
          tone={signal.warning}
          title="Not found"
          body="This customer could not be located."
          wire="GET /api/msp/customers/:id/break-glass · 404"
        />
      );
    }
    return (
      <StatePanel
        icon="triangle-alert"
        tone={signal.warning}
        title="Break-glass activity could not be loaded"
        body="The request to load this customer's break-glass history failed. Try again shortly."
        wire={`GET /api/msp/customers/:id/break-glass · ${status ?? "error"}`}
      />
    );
  }

  const secrets = query.data?.secrets ?? [];
  const waiting = secrets.filter((s) => s.status === "pending_delivery");
  const audit = auditQuery.data?.audit ?? [];
  const sel = selId !== null ? (secrets.find((s) => s.pendingSecretId === selId) ?? null) : null;
  const detail = detailQuery.data ?? null;

  const openDetail = (pendingSecretId: number) => {
    setSelId(pendingSecretId);
    setReason("");
    setPickedEmails(new Set());
  };
  const closeDetail = () => {
    setSelId(null);
    setOverrideOpen(false);
  };

  const invitedEmails = useMemo(
    () => Array.from(new Set((detail?.attempts ?? []).map((a) => a.invitedEmail))),
    [detail],
  );

  const submitOverride = () => {
    if (!sel || !reason.trim()) return;
    override.mutate(
      { pendingSecretId: sel.pendingSecretId, reason: reason.trim(), emails: pickedEmails.size > 0 ? Array.from(pickedEmails) : undefined },
      {
        onSuccess: (res) => {
          setOverrideOpen(false);
          setSelId(null);
          setResult(res);
          setTab("audit");
        },
        onError: (err) => {
          const msg = err instanceof BreakGlassApiError ? err.message : "Could not reset that credential.";
          toast.error(msg);
        },
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* Tabs + honest disclaimer */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { id: "waiting" as const, label: "Waiting", count: waiting.length },
            { id: "history" as const, label: "Everything", count: secrets.length },
            { id: "audit" as const, label: "Forced resets", count: audit.length },
          ]
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.sidebar}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>
          <Icon name="eye-off" size={13} color={text.label} />The credential itself never reaches this console
        </span>
      </div>

      {/* Shown-once override result */}
      {result && (
        <div style={{ border: "1px solid rgba(52,211,153,.3)", borderRadius: 12, background: "rgba(52,211,153,.06)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, color: signal.ok.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="rotate-ccw" size={15} color={signal.ok.strong} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.ok.text }}>RESET COMPLETE</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>
                Replacement credential #{result.newPendingSecretId} issued, {result.sent} of {result.reissued} invite{result.reissued === 1 ? "" : "s"} sent
              </span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                This is shown once. The old credential was superseded and nothing was ever delivered from it — the new one now shows in Waiting.
              </span>
            </div>
            <button onClick={() => setResult(null)} style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="x" size={14} color={text.muted} />
            </button>
          </div>
        </div>
      )}

      {tab === "waiting" && (
        waiting.length === 0 ? (
          <EmptyPanel
            icon="key-round"
            title="Nothing waiting to be handed over"
            body="Break-glass credentials only appear here when a config pack creates one and pauses for the customer to claim it."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {waiting.map((s) => {
              const age = ageLabel(s.createdAt);
              return (
                <SecretRow key={s.pendingSecretId} secret={s} age={age} onOpen={() => openDetail(s.pendingSecretId)} />
              );
            })}
            <span style={{ fontSize: 11.5, color: text.faint, textWrap: "pretty" }}>
              A credential appears here when a config pack pauses to hand one over. The run stays paused until someone verifies.
            </span>
          </div>
        )
      )}

      {tab === "history" && (
        secrets.length === 0 ? (
          <EmptyPanel icon="history" title="No break-glass activity yet" body="This tenant has never had a break-glass credential issued." />
        ) : (
          <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 12, background: CARD_BG, overflowX: "auto" }}>
            <div style={{ minWidth: 780 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1.3fr 1.9fr 1.2fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.card}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
                <span>CREDENTIAL</span><span>STATE</span><span>CREATED</span><span>CLAIMED BY</span><span>CLAIMED</span>
              </div>
              {secrets.map((s) => {
                const st = STATUS_TONE[s.status];
                return (
                  <div
                    key={s.pendingSecretId}
                    onClick={() => openDetail(s.pendingSecretId)}
                    style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1.3fr 1.9fr 1.2fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
                  >
                    <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>#{s.pendingSecretId}</span>
                    <span style={{ display: "inline-flex", justifySelf: "start", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: st.tint, border: `1px solid ${st.line}`, fontSize: 11, fontWeight: 600, color: st.color, whiteSpace: "nowrap" }}>
                      <Icon name={st.icon} size={11} color={st.color} />{st.label}
                    </span>
                    <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{formatDateTime(s.createdAt)}</span>
                    <span style={{ fontSize: 12, color: s.deliveredToEmail ? text.secondary : text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.deliveredToEmail ?? "nobody yet"}</span>
                    <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{s.deliveredAt ? formatDateTime(s.deliveredAt) : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {tab === "audit" && (
        audit.length === 0 ? (
          <EmptyPanel icon="rotate-ccw" title="No forced resets" body="Nobody has had to reset a credential on this customer's behalf. Every handover so far went through the customer themselves." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {audit.map((a) => (
              <div key={a.id} style={{ border: "1px solid rgba(167,139,250,.2)", borderRadius: 12, background: CARD_BG, padding: 15, display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.26)", color: "#a78bfa", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="rotate-ccw" size={15} color="#a78bfa" />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{a.adminName} forced a reset</span>
                    <span style={{ fontSize: 11.5, color: text.label }}>{formatDateTime(a.createdAt)}</span>
                  </div>
                  <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{a.reason}</span>
                  <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                    {a.oldPendingSecretId !== null ? `#${a.oldPendingSecretId} was replaced by #${a.newPendingSecretId}` : `#${a.newPendingSecretId} issued`}
                  </span>
                </div>
              </div>
            ))}
            <span style={{ fontSize: 11.5, color: text.faint, textWrap: "pretty" }}>
              Append-only. Every forced reset stays on this list with the name of whoever did it and why.
            </span>
          </div>
        )
      )}

      {/* Detail drawer */}
      {sel && (
        <Drawer onClose={closeDetail}>
          <DrawerHeader
            eyebrow={`#${sel.pendingSecretId}${sel.runId ? ` · run ${sel.runId}` : ""}`}
            title={STATUS_TONE[sel.status].label}
            onClose={closeDetail}
          />
          {detailQuery.isLoading ? (
            <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
          ) : detailQuery.isError || !detail ? (
            <span style={{ fontSize: 12, color: text.label }}>Could not load this credential's detail.</span>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
                <Fact label="CREATED" value={formatDateTime(detail.createdAt)} color={text.muted} />
                <Fact label="CLAIMED" value={detail.deliveredAt ? formatDateTime(detail.deliveredAt) : "not claimed"} color={detail.deliveredAt ? "#6ee7b7" : "#fcd34d"} />
                <Fact label="CLAIMED BY" value={detail.deliveredToEmail ?? "nobody"} color={detail.deliveredToEmail ? text.secondary : text.label} />
                <Fact label="INVITES SENT" value={String(detail.attempts.length)} color={text.secondary} />
                <Fact label="STILL LIVE" value={String(detail.attempts.filter((a) => a.linkStatus === "pending").length)} color={text.secondary} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHO WAS INVITED, AND WHAT HAPPENED</span>
                {detail.attempts.length === 0 ? (
                  <span style={{ fontSize: 12, color: text.label }}>No invites have gone out for this credential yet.</span>
                ) : (
                  detail.attempts.map((a) => <AttemptRow key={a.id} attempt={a} />)
                )}
              </div>

              {detail.status === "pending_delivery" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 13, borderTop: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>FORCE A RESET</span>
                  {overridePreflight(detail.attempts).map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <Icon name={p.ok ? "circle-check-big" : "circle-alert"} size={14} color={p.ok ? "#34d399" : "#fbbf24"} style={{ marginTop: 2, flex: "0 0 14px" }} />
                      <span style={{ fontSize: 12, color: p.ok ? text.secondary : "#fcd34d", textWrap: "pretty" }}>{p.label}</span>
                    </div>
                  ))}
                  <button
                    onClick={() => setOverrideOpen(true)}
                    title="Replaces the credential outright — nothing is ever delivered from the old one"
                    style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8, border: "1px solid rgba(248,113,113,.32)", background: "rgba(248,113,113,.12)", color: "#fca5a5", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    <Icon name="rotate-ccw" size={13} color="#fca5a5" />Reset and re-issue
                  </button>
                  <span style={{ fontSize: 11.5, color: allTerminal(detail.attempts) ? "#fcd34d" : text.label, textWrap: "pretty" }}>
                    {allTerminal(detail.attempts)
                      ? "Every invite has burned out, so nobody can claim this without a reset."
                      : "There is still a live invite. Resetting cancels it, so give them a chance first if you can."}
                  </span>
                </div>
              )}

              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
                Sending a fresh invite to the same credential is done from the customer's own portal, not from here.
              </span>
            </>
          )}
        </Drawer>
      )}

      {/* Override (danger) drawer */}
      {overrideOpen && sel && detail && (
        <Drawer onClose={() => setOverrideOpen(false)} danger>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#fca5a5" }}>FORCE A RESET</span>
              <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>Reset and re-issue the credential</span>
              <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>The old credential is replaced and nothing is ever delivered from it. A fresh one is created and the invites go out again.</span>
            </div>
            <button onClick={() => setOverrideOpen(false)} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="x" size={14} color={text.muted} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Why it has to be reset</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Goes on the permanent record"
              style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
            />
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Required, and it cannot be edited afterwards.</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Who should get the new invite</span>
            {invitedEmails.map((email) => {
              const picked = pickedEmails.has(email);
              return (
                <button
                  key={email}
                  onClick={() => setPickedEmails((prev) => {
                    const next = new Set(prev);
                    if (next.has(email)) next.delete(email); else next.add(email);
                    return next;
                  })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", borderRadius: 9, border: `1px solid ${picked ? "rgba(96,165,250,.34)" : border.sidebar}`, background: picked ? "rgba(37,99,235,.16)" : "rgba(2,6,23,.4)", cursor: "pointer", textAlign: "left", minWidth: 0 }}
                >
                  <Icon name={picked ? "circle-check-big" : "circle-dashed"} size={14} color={picked ? "#60a5fa" : text.faint} />
                  <span style={{ fontSize: 12.5, color: text.body, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{email}</span>
                  {picked && <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap" }}>will be invited</span>}
                </button>
              );
            })}
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
              {pickedEmails.size === 0
                ? "Pick nobody and the same people get invited again. Up to five recipients."
                : `${pickedEmails.size} ${pickedEmails.size === 1 ? "recipient" : "recipients"} selected, replacing the original list.`}
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: "1px solid rgba(251,191,36,.24)", background: "rgba(251,191,36,.07)" }}>
            <Icon name="triangle-alert" size={15} color="#fbbf24" style={{ flex: "0 0 15px", marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>The config pack stays paused either way. If the tenant is not set up to accept writes, or consent has not been given, this is refused outright rather than half-done.</span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.faint}` }}>
            <button
              onClick={submitOverride}
              disabled={!reason.trim() || override.isPending}
              title={reason.trim() ? "" : "A reason is required"}
              style={{
                flex: 1, height: 38, borderRadius: 8,
                border: `1px solid ${reason.trim() ? "rgba(248,113,113,.4)" : border.sidebar}`,
                background: reason.trim() ? "rgba(248,113,113,.18)" : "transparent",
                color: reason.trim() ? "#fca5a5" : text.label, fontSize: 13, fontWeight: 600,
                cursor: reason.trim() ? "pointer" : "not-allowed", opacity: reason.trim() ? 1 : 0.6,
              }}
            >
              {override.isPending ? "Resetting…" : "Reset and re-issue"}
            </button>
            <button onClick={() => setOverrideOpen(false)} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.sidebar}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </Drawer>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Viewing a credential's history and forcing a reset are the two things this console can do here, and both run against the
          real MSP endpoints above. Sending a fresh invite to a still-live credential is the customer's own portal action, not this one.
        </span>
      </div>
    </div>
  );
}

function allTerminal(attempts: readonly BreakGlassAttempt[]): boolean {
  return attempts.length > 0 && attempts.every((a) => a.linkStatus !== "pending");
}

function overridePreflight(attempts: readonly BreakGlassAttempt[]): { label: string; ok: boolean }[] {
  return [
    { label: "Still waiting to be claimed", ok: true },
    { label: "Every invite has burned out", ok: allTerminal(attempts) },
    { label: "Only a Global Administrator can claim it", ok: true },
    { label: "The config pack run stays paused", ok: true },
  ];
}

function SecretRow({ secret, age, onOpen }: { secret: BreakGlassSecretSummary; age: { text: string; stale: boolean }; onOpen: () => void }) {
  const st = STATUS_TONE[secret.status];
  return (
    <div
      onClick={onOpen}
      style={{
        border: `1px solid ${age.stale ? "rgba(251,191,36,.24)" : CARD_LINE}`, borderRadius: 12, background: CARD_BG, padding: 15,
        display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0, cursor: "pointer",
      }}
    >
      <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: st.tint, border: `1px solid ${st.line}`, color: st.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="key-round" size={15} color={st.color} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: text.strong }}>Credential #{secret.pendingSecretId}</span>
          <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: st.tint, border: `1px solid ${st.line}`, fontSize: 10.5, fontWeight: 600, color: st.color, whiteSpace: "nowrap" }}>{st.label}</span>
        </div>
        <span style={{ fontSize: 11.5, color: text.muted }}>{secret.runId ? `config pack run ${secret.runId}` : "no run recorded"}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 auto", alignItems: "flex-end" }}>
        <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{formatDateTime(secret.createdAt)}</span>
        <span style={{ fontSize: 11, color: age.stale ? "#fcd34d" : text.label, whiteSpace: "nowrap" }}>{age.text}</span>
      </div>
    </div>
  );
}

function AttemptRow({ attempt }: { attempt: BreakGlassAttempt }) {
  const lt = LINK_TONE[attempt.linkStatus];
  const outcome = attempt.verificationOutcome
    ? OUTCOME_COPY[attempt.verificationOutcome]
    : { color: text.faint, icon: "circle-dashed" as IconName, text: "Invited, but they have not opened the link yet." };
  return (
    <div style={{ border: `1px solid ${lt.line}`, borderRadius: 10, background: lt.tint, padding: 12, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <Icon name={outcome.icon} size={15} color={outcome.color} style={{ flex: "0 0 15px" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>{attempt.invitedEmail}</span>
        <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: lt.tint, border: `1px solid ${lt.line}`, fontSize: 10.5, fontWeight: 600, color: lt.color, whiteSpace: "nowrap" }}>
          {attempt.linkStatus === "pending" ? "live" : attempt.linkStatus}
        </span>
      </div>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{outcome.text}</span>
      {attempt.entraUserPrincipalName && (
        <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: "#93c5fd", wordBreak: "break-all" }}>{attempt.entraUserPrincipalName}</span>
      )}
      <span style={{ fontSize: 11, color: text.faint }}>
        {attempt.attemptedAt ? `Tried ${formatDateTime(attempt.attemptedAt)}` : "Not tried yet"}
        {attempt.failedAttemptCount ? ` · ${attempt.failedAttemptCount} failed attempts` : ""}
      </span>
    </div>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{label}</span>
      <span style={{ fontSize: 12.5, color, textWrap: "pretty" }}>{value}</span>
    </div>
  );
}

function Drawer({ children, onClose, danger }: { children: React.ReactNode; onClose: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: danger ? "rgba(2,6,23,.7)" : "rgba(2,6,23,.65)", backdropFilter: danger ? "blur(3px)" : "blur(2px)", zIndex: danger ? 92 : 90, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${danger ? "rgba(248,113,113,.24)" : border.sidebar}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}
      >
        {children}
      </div>
    </div>
  );
}

function DrawerHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.label }}>{eyebrow}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty", textTransform: "capitalize" }}>{title}</span>
      </div>
      <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="x" size={14} color={text.muted} />
      </button>
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div style={{ border: `1px dashed ${border.hover}`, borderRadius: 12, background: CARD_BG, padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, color: signal.ok.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={signal.ok.strong} />
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

function StatePanel({
  icon, tone, title, body, wire,
}: {
  icon: IconName;
  tone: { strong: string; text: string; tint: string; border: string };
  title: string;
  body: string;
  wire: string;
}) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
    </div>
  );
}
