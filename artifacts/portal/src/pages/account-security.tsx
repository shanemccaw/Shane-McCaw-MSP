import { useState } from "react";
import { Loader2, AlertCircle, Info } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { roleLabel } from "@/components/shell/UserMenu";
import { useAccountSecurityLive } from "@/components/account-security/useAccountSecurityLive";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const AMB = "#c2a63d";
const RED = "#f87171";

const REQUIRED_PHRASE = "DELETE MY ACCOUNT";

/**
 * Account security (#2996, part of #1595). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Account Security.dc.html`
 * per that package's README ("recreate these designs... using this
 * codebase's existing... patterns, not ship the HTML files as-is").
 *
 * Wired this pass (all real, per
 * `docs/account-security-contract-pack.md`): identity (JWT), MFA-state read,
 * active sessions read + revoke + "sign out everywhere else", last-sign-in,
 * and this issue's own scope — data export (`GET /api/portal/data-export`)
 * and the deletion request (`POST /api/portal/deletion-request`).
 *
 * Deliberately NOT wired here, matching the design's own "Not wired yet"
 * copy: change-password (#1675), passkey/authenticator/SMS self-service
 * enrollment (MFA-enrollment sibling issue), and "Export tenant evidence"
 * (no endpoint exists for this — not part of this issue's contract pack).
 */
export default function AccountSecurityPage() {
  const { user } = useAuth();
  const live = useAccountSecurityLive();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deletionResult, setDeletionResult] = useState<string | null>(null);

  const showLoading = live.loading;
  const showError = live.readFailed && !live.loading;

  const mfaMethodCount = live.mfa ? [live.mfa.totp, live.mfa.sms, live.mfa.passkey].filter(Boolean).length : 0;
  const posture: { k: string; v: string; tone: string }[] = live.mfa
    ? [
        {
          k: "Multifactor",
          v: mfaMethodCount === 0 ? "Not set up" : [
            live.mfa.passkey ? "Passkey" : null,
            live.mfa.totp ? "Authenticator app" : null,
            live.mfa.sms ? "Text message" : null,
          ].filter(Boolean).join(" · "),
          tone: mfaMethodCount === 0 ? "amber" : "green",
        },
        {
          k: "Passkey",
          v: live.mfa.passkey ? `Registered · ${live.mfa.passkeyCount} credential${live.mfa.passkeyCount === 1 ? "" : "s"}` : "Not set up",
          tone: live.mfa.passkey ? "green" : "amber",
        },
        {
          k: "Sessions",
          v: live.sessions === null ? "—" : live.sessions.length === 0 ? "None active" : `${live.sessions.length} active`,
          tone: "green",
        },
        {
          k: "Last sign-in",
          v: live.lastSignInAt ? new Date(live.lastSignInAt).toLocaleString() : "No record",
          tone: "green",
        },
      ]
    : [];
  const DOT: Record<string, string> = { green: GRN, amber: AMB, red: RED };

  const othersCount = live.sessions ? live.sessions.filter((s) => !s.current).length : 0;
  const ready = typed.trim().toUpperCase() === REQUIRED_PHRASE;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Account security
        </span>
        <span
          title="This is your login to this portal. Findings about your Microsoft 365 tenant live under the six pillars."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)" }}
        >
          i
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-[10px]">
          <span className="flex items-center gap-[6px] text-[11px]" style={{ color: showError ? AMB : "#64748b" }}>
            <span className="size-[6px] rounded-full" style={{ background: showError ? AMB : GRN }} />
            {showLoading ? "Loading" : showError ? "Couldn't load — showing what we have" : "Live"}
          </span>
          <div
            className="flex items-center gap-[9px] rounded-full py-[5px] pl-[13px] pr-[5px]"
            style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
          >
            <span className="text-[12.5px] text-[#cbd5e1]">{user?.email}</span>
            <span
              className="whitespace-nowrap rounded-full px-[10px] py-[3px] text-[10.5px] font-semibold text-[#94a3b8]"
              style={{ border: "1px solid rgba(255,255,255,.12)" }}
            >
              {user ? roleLabel(user) : ""}
            </span>
          </div>
        </div>
      </div>

      {showLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-[#94a3b8]">
          <Loader2 className="size-4 animate-spin" /> Loading your account security…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {showError ? (
            <div
              className="flex items-center gap-[9px] rounded-[10px] px-[14px] py-[10px]"
              style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
            >
              <AlertCircle className="size-[14px] shrink-0" color={RED} />
              <span className="text-[12px] text-[#e2e8f0]">
                Couldn't read your MFA/session state. Some actions below may not work until this loads.
              </span>
            </div>
          ) : null}

          {/* Posture summary */}
          <div className="flex flex-col rounded-[14px] px-5 pb-[14px] pt-[6px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            {posture.map((p) => (
              <div key={p.k} className="flex items-center gap-[11px] border-b py-[11px]" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                <span className="size-[7px] shrink-0 rounded-full" style={{ background: DOT[p.tone] }} />
                <span className="w-[150px] min-w-[112px] shrink-0 text-[12.5px] text-[#94a3b8]">{p.k}</span>
                <span className="text-[12.5px] text-[#e2e8f0]">{p.v}</span>
              </div>
            ))}
            {live.mfa && !live.mfa.passkey ? (
              <div className="flex items-center gap-[9px] pt-3">
                <Info className="size-[14px] shrink-0" color={AMB} />
                <span className="text-[12px]" style={{ color: AMB }}>
                  One gap: no passkey — the strongest method available to you.
                </span>
              </div>
            ) : null}
          </div>

          {/* Active sessions */}
          <div className="rounded-[14px] px-5 pb-4 pt-[15px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Signed in on</span>
              <span className="text-[11px] text-[#64748b]">
                {live.sessions === null ? "—" : `${live.sessions.length} active`}
              </span>
              <button
                type="button"
                disabled={othersCount === 0 || live.revokingOthers}
                onClick={() => void live.signOutOthers()}
                className="ml-auto rounded-md px-[14px] py-[7px] text-[12px] font-semibold transition-colors hover:bg-white/[.04]"
                style={{
                  color: othersCount > 0 ? "#cbd5e1" : "#475569",
                  border: `1px solid ${othersCount > 0 ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.07)"}`,
                  cursor: othersCount > 0 ? "pointer" : "default",
                }}
                data-testid="account-security-sign-out-others"
              >
                {live.revokingOthers ? "Signing out…" : "Sign out everywhere else"}
              </button>
            </div>
            {live.sessions?.length === 0 ? (
              <div
                className="mt-3 rounded-[10px] py-[18px] text-center text-[12px] text-[#64748b]"
                style={{ border: "1px dashed rgba(148,163,184,.25)" }}
              >
                No other active sessions.
              </div>
            ) : null}
            <div className="mt-1 flex flex-col">
              {(live.sessions ?? []).map((s) => (
                <div key={s.id} className="flex items-center gap-[11px] border-t py-[11px]" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                  <span className="size-[7px] shrink-0 rounded-full" style={{ background: s.current ? GRN : "#64748b" }} />
                  <span className="w-[180px] min-w-[130px] shrink-0 text-[12.5px] font-semibold text-[#e2e8f0]">{s.device}</span>
                  <span className="text-[12px] text-[#94a3b8]">
                    {s.where} · {s.current ? "active now" : s.when} · {s.since}
                  </span>
                  {s.current ? (
                    <span
                      className="ml-auto shrink-0 rounded-full px-[9px] py-[3px] text-[9.5px] font-bold"
                      style={{ color: GRN, border: "1px solid rgba(52,211,153,.35)", letterSpacing: ".1em" }}
                    >
                      THIS DEVICE
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!!live.revoking[s.id]}
                      onClick={() => void live.revokeSession(s.id)}
                      className="ml-auto shrink-0 rounded-md px-[13px] py-[6px] text-[11.5px] font-semibold transition-colors hover:bg-white/[.04]"
                      style={{ color: RED, border: "1px solid rgba(248,113,113,.35)" }}
                      data-testid={`account-security-revoke-session-${s.id}`}
                    >
                      {live.revoking[s.id] ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Your data — right to portability + erasure (#2996's own scope) */}
          <div className="rounded-[14px] px-5 pb-[14px] pt-[6px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-3 border-b py-[11px]" style={{ borderColor: "rgba(255,255,255,.06)" }}>
              <span className="w-[200px] min-w-[150px] shrink-0 text-[12.5px] font-semibold text-[#e2e8f0]">Export your data</span>
              <span className="text-[11.5px] text-[#64748b]">Everything Shane McCaw Consulting holds for your account</span>
              <button
                type="button"
                disabled={live.exporting}
                onClick={() => void live.requestExport()}
                className="ml-auto rounded-md px-[14px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "#0078D4", border: "1px solid #0078D4" }}
                data-testid="account-security-request-export"
              >
                {live.exporting ? "Preparing…" : "Download export"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 py-[11px]">
              <span className="w-[200px] min-w-[150px] shrink-0 text-[12.5px] font-semibold text-[#e2e8f0]">Delete your account</span>
              <span className="text-[11.5px] text-[#64748b]">Processed within 30 days</span>
              <button
                type="button"
                onClick={() => setDeleteOpen((v) => !v)}
                className="ml-auto rounded-md px-[14px] py-[7px] text-[12px] font-semibold text-[#cbd5e1] transition-colors hover:bg-white/[.04]"
                style={{ border: "1px solid rgba(255,255,255,.14)" }}
                data-testid="account-security-toggle-delete"
              >
                {deleteOpen ? "Close" : "Start a request"}
              </button>
            </div>

            {deleteOpen ? (
              <div
                className="mt-3 flex flex-col gap-[10px] rounded-xl px-4 py-[14px]"
                style={{ border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.05)" }}
              >
                <span className="text-[10px] font-bold text-[#f87171]" style={{ letterSpacing: ".13em" }}>
                  CONFIRM DELETION REQUEST
                </span>
                <div className="flex items-baseline gap-3">
                  <span className="w-[130px] min-w-[110px] shrink-0 text-[11.5px] text-[#64748b]">Retained</span>
                  <span className="text-[11.5px] text-[#cbd5e1]">
                    Signed contracts and invoices are retained for 7 years as required by law.
                  </span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="w-[130px] min-w-[110px] shrink-0 text-[11.5px] text-[#64748b]">Confirmation</span>
                  <span className="text-[11.5px] text-[#cbd5e1]">Sent to your account email once processed.</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="w-[130px] min-w-[110px] shrink-0 text-[11.5px] text-[#64748b]">Export first</span>
                  <span className="text-[11.5px] text-[#cbd5e1]">
                    This can't be undone — download your export above before confirming.
                  </span>
                </div>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={`Type ${REQUIRED_PHRASE}`}
                  className="max-w-[320px] rounded-md px-3 py-[9px] text-[12.5px] outline-none"
                  style={{ border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.03)", color: "#f8fafc", fontFamily: "ui-monospace, monospace" }}
                  data-testid="account-security-delete-confirm-input"
                />
                <div className="flex flex-wrap items-center gap-[10px]">
                  <button
                    type="button"
                    disabled={!ready || live.submittingDeletion}
                    onClick={() => {
                      void live.submitDeletionRequest().then((res) => {
                        if (res) {
                          setDeletionResult(res.message);
                          setDeleteOpen(false);
                          setTyped("");
                        }
                      });
                    }}
                    className="rounded-md px-4 py-[8px] text-[12px] font-semibold"
                    style={{
                      color: ready ? "#fff" : "#475569",
                      background: ready ? "#dc2626" : "transparent",
                      border: `1px solid ${ready ? "#dc2626" : "rgba(255,255,255,.10)"}`,
                      cursor: ready ? "pointer" : "default",
                    }}
                    data-testid="account-security-submit-deletion"
                  >
                    {live.submittingDeletion ? "Submitting…" : "Submit deletion request"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteOpen(false);
                      setTyped("");
                    }}
                    className="text-[12px] font-semibold text-[#94a3b8]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {deletionResult ? (
              <div className="mt-3 rounded-[10px] px-[14px] py-[10px] text-[12px] text-[#e2e8f0]" style={{ border: "1px solid rgba(52,211,153,.3)", background: "rgba(52,211,153,.06)" }} data-testid="account-security-deletion-result">
                {deletionResult}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
