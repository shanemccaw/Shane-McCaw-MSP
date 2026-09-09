import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Loader2, AlertCircle, Info, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { roleLabel } from "@/components/shell/UserMenu";
import { useAccountSecurityLive } from "@/components/account-security/useAccountSecurityLive";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const AMB = "#c2a63d";
const RED = "#f87171";
const BLUE = "#60a5fa";

const REQUIRED_PHRASE = "DELETE MY ACCOUNT";

type PanelKey = "passkey" | "app" | "sms" | null;

function last4(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4);
}

/**
 * Account security (#2996 built the page + data rights; #2995, this pass,
 * adds the Multifactor methods section — real TOTP/SMS/passkey self-service
 * enrollment). Both are part of #1595. Adapted from
 * `Design/portal/design_handoff_full_site/screens/Account Security.dc.html`
 * per that package's README ("recreate these designs... using this
 * codebase's existing... patterns, not ship the HTML files as-is").
 *
 * Wired this pass (all real, per
 * `docs/portal/account-security-contract-pack.md` and the #2995 issue body's own
 * file:line citations into `artifacts/api-server/src/routes/mfa.ts`):
 * TOTP setup/verify-setup/DELETE, SMS setup/verify-setup/DELETE (admin
 * accounts rendered as unavailable, matching `mfa.ts`'s own `rejectIfAdmin`
 * 403), and passkey registration-options/verify-registration/DELETE via
 * `@simplewebauthn/browser`'s `startRegistration` — the same pattern already
 * shipped in `artifacts/admin-panel/src/pages/AdminSecurity.tsx`.
 *
 * Still deliberately NOT wired here, matching the design's own "Not wired
 * yet" copy where it still applies: change-password (#1675, its own open
 * sibling issue).
 */
export default function AccountSecurityPage() {
  const { user, fetchWithAuth } = useAuth();
  const live = useAccountSecurityLive();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deletionResult, setDeletionResult] = useState<string | null>(null);

  const showLoading = live.loading;
  const showError = live.readFailed && !live.loading;
  const isAdmin = user?.role === "admin";

  // ── MFA enrollment panel state (#2995) ────────────────────────────────────
  const [panel, setPanel] = useState<PanelKey>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const [totpSetup, setTotpSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const [smsPhoneInput, setSmsPhoneInput] = useState("");
  const [smsPendingPhone, setSmsPendingPhone] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [smsSentLast4, setSmsSentLast4] = useState<string | null>(null);

  function closePanel() {
    setPanel(null);
    setPanelBusy(false);
    setPanelError(null);
    setTotpSetup(null);
    setTotpCode("");
    setSmsPhoneInput("");
    setSmsPendingPhone(null);
    setSmsCode("");
    setSmsSentLast4(null);
  }

  function openPanel(key: PanelKey) {
    closePanel();
    setPanel(key);
  }

  async function totpStartSetup() {
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/setup", { method: "POST" });
      if (!res.ok) throw new Error("Could not start authenticator setup.");
      const data = (await res.json()) as { secret: string; qrDataUrl: string };
      setTotpSetup(data);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Could not start authenticator setup.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function totpConfirm() {
    if (!totpSetup || totpCode.trim().length < 6) return;
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: totpSetup.secret, code: totpCode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Verification failed.");
      live.refetch();
      closePanel();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function totpRemove() {
    if (!confirm("Remove your authenticator app enrollment?")) return;
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/totp", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove the authenticator app.");
      live.refetch();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Could not remove the authenticator app.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function smsSendCode() {
    if (!smsPhoneInput.trim()) return;
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: smsPhoneInput.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; phoneLast4?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not send a code to that number.");
      setSmsPendingPhone(smsPhoneInput.trim());
      setSmsSentLast4(data.phoneLast4 ?? last4(smsPhoneInput));
      setSmsCode("");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Could not send a code to that number.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function smsConfirmCode() {
    if (!smsPendingPhone || smsCode.trim().length < 4) return;
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: smsPendingPhone, code: smsCode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Invalid or expired code.");
      live.refetch();
      closePanel();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Invalid or expired code.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function smsRemove() {
    if (!confirm("Remove text message backup?")) return;
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/sms", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove the text message backup.");
      live.refetch();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Could not remove the text message backup.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function passkeyRegister() {
    setPanelBusy(true);
    setPanelError(null);
    try {
      const optRes = await fetchWithAuth("/api/auth/mfa/passkey/registration-options", { method: "POST" });
      if (!optRes.ok) throw new Error("Could not start passkey registration.");
      const options = await optRes.json();
      const attResp = await startRegistration({ optionsJSON: options });
      const verRes = await fetchWithAuth("/api/auth/mfa/passkey/verify-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      });
      const data = (await verRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!verRes.ok || !data.ok) throw new Error(data.error ?? "Passkey registration failed.");
      live.refetch();
      closePanel();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setPanelError("Passkey registration was cancelled.");
      } else {
        setPanelError(err instanceof Error ? err.message : "Passkey registration failed.");
      }
    } finally {
      setPanelBusy(false);
    }
  }

  async function passkeyRemoveAll() {
    const count = live.mfa?.passkeyCount ?? 0;
    if (!confirm(`Remove all ${count} passkey${count === 1 ? "" : "s"}? This removes every registered passkey at once, not one at a time.`)) return;
    setPanelBusy(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth("/api/auth/mfa/passkey", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove your passkeys.");
      live.refetch();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Could not remove your passkeys.");
    } finally {
      setPanelBusy(false);
    }
  }

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

  const methodCards = [
    {
      key: "passkey" as const,
      name: "Passkey",
      strengthLabel: "STRONGEST",
      state: live.mfa?.passkey ? `Active · ${live.mfa.passkeyCount} registered` : "Not set up",
      active: !!live.mfa?.passkey,
      cta: live.mfa?.passkey ? "Manage" : "Set up a passkey",
      recommended: !live.mfa?.passkey,
      disabled: false,
    },
    {
      key: "app" as const,
      name: "Authenticator app",
      strengthLabel: "STRONG",
      state: live.mfa?.totp ? "Active" : "Not set up",
      active: !!live.mfa?.totp,
      cta: live.mfa?.totp ? "Manage" : "Set up authenticator",
      recommended: false,
      disabled: false,
    },
    {
      key: "sms" as const,
      name: "Text message",
      strengthLabel: "WEAKEST",
      state: isAdmin ? "Unavailable for admins" : live.mfa?.sms ? "Active" : "Not set up",
      active: !!live.mfa?.sms,
      cta: isAdmin ? "Unavailable" : live.mfa?.sms ? "Manage" : "Add as backup",
      recommended: false,
      disabled: isAdmin,
    },
  ];

  return (
    <div className="flex min-w-0 flex-1 gap-6" style={{ color: "#cbd5e1" }}>
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5">
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

          {/* Multifactor methods (#2995) */}
          <div className="flex flex-col gap-[10px]">
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">Multifactor methods</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {methodCards.map((m) => (
                <div
                  key={m.key}
                  className="flex flex-col gap-[9px] rounded-[14px] px-4 py-[15px]"
                  style={{
                    border: `1px solid ${m.recommended ? "rgba(52,211,153,.28)" : HAIRLINE}`,
                    background: m.recommended ? "rgba(52,211,153,.04)" : CARD_BG,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[#f8fafc]">{m.name}</span>
                    <span
                      className="ml-auto rounded-full px-2 py-[2px] text-[9.5px] font-bold"
                      style={{ color: m.active ? GRN : m.key === "app" ? BLUE : AMB, border: `1px solid ${HAIRLINE}`, letterSpacing: ".1em" }}
                    >
                      {m.strengthLabel}
                    </span>
                  </div>
                  <span className="text-[11.5px] font-semibold" style={{ color: m.active ? GRN : AMB }}>{m.state}</span>
                  <button
                    type="button"
                    disabled={m.disabled}
                    onClick={() => openPanel(m.key)}
                    className="mt-1 rounded-md py-2 text-center text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      color: m.recommended ? "#fff" : "#cbd5e1",
                      background: m.recommended ? "#0078D4" : "transparent",
                      border: `1px solid ${m.recommended ? "#0078D4" : "rgba(255,255,255,.14)"}`,
                    }}
                    data-testid={`account-security-mfa-${m.key}`}
                  >
                    {m.cta}
                  </button>
                </div>
              ))}
            </div>
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

      {panel ? (
        <EnrollmentPanel
          panelKey={panel}
          mfa={live.mfa}
          busy={panelBusy}
          error={panelError}
          onClose={closePanel}
          totpSetup={totpSetup}
          totpCode={totpCode}
          onTotpCodeChange={setTotpCode}
          onTotpStart={() => void totpStartSetup()}
          onTotpConfirm={() => void totpConfirm()}
          onTotpRemove={() => void totpRemove()}
          smsPhoneInput={smsPhoneInput}
          onSmsPhoneChange={setSmsPhoneInput}
          smsPendingPhone={smsPendingPhone}
          smsSentLast4={smsSentLast4}
          smsCode={smsCode}
          onSmsCodeChange={setSmsCode}
          onSmsSend={() => void smsSendCode()}
          onSmsConfirm={() => void smsConfirmCode()}
          onSmsRemove={() => void smsRemove()}
          isAdmin={isAdmin}
          onPasskeyRegister={() => void passkeyRegister()}
          onPasskeyRemoveAll={() => void passkeyRemoveAll()}
        />
      ) : null}
    </div>
  );
}

interface LiveMfaEnrollmentsShape {
  readonly totp: boolean;
  readonly sms: boolean;
  readonly smsPhone: string | null;
  readonly passkey: boolean;
  readonly passkeyCount: number;
}

interface EnrollmentPanelProps {
  panelKey: Exclude<PanelKey, null>;
  mfa: LiveMfaEnrollmentsShape | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  totpSetup: { secret: string; qrDataUrl: string } | null;
  totpCode: string;
  onTotpCodeChange: (v: string) => void;
  onTotpStart: () => void;
  onTotpConfirm: () => void;
  onTotpRemove: () => void;
  smsPhoneInput: string;
  onSmsPhoneChange: (v: string) => void;
  smsPendingPhone: string | null;
  smsSentLast4: string | null;
  smsCode: string;
  onSmsCodeChange: (v: string) => void;
  onSmsSend: () => void;
  onSmsConfirm: () => void;
  onSmsRemove: () => void;
  isAdmin: boolean;
  onPasskeyRegister: () => void;
  onPasskeyRemoveAll: () => void;
}

function EnrollmentPanel(props: EnrollmentPanelProps) {
  const { panelKey, mfa, busy, error, onClose } = props;
  const title =
    panelKey === "passkey"
      ? mfa?.passkey
        ? "Manage passkeys"
        : "Set up a passkey"
      : panelKey === "app"
        ? mfa?.totp
          ? "Authenticator app"
          : "Set up authenticator app"
        : mfa?.sms
          ? "Text message backup"
          : "Add text message backup";

  return (
    <div
      className="flex w-[320px] shrink-0 flex-col self-start rounded-[14px]"
      style={{ border: `1px solid ${HAIRLINE}`, background: "#0b1220" }}
      data-testid="account-security-mfa-panel"
    >
      <div className="flex items-center gap-2 border-b p-4" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <span className="text-[13.5px] font-semibold text-[#f8fafc]">{title}</span>
        <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 hover:bg-white/[.06]">
          <X className="size-[14px]" color="#64748b" />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {error ? (
          <p
            className="rounded-md p-2 text-[11.5px]"
            style={{ border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.08)", color: RED }}
          >
            {error}
          </p>
        ) : null}

        {panelKey === "passkey" && <PasskeyPanelBody {...props} />}
        {panelKey === "app" && <TotpPanelBody {...props} />}
        {panelKey === "sms" && <SmsPanelBody {...props} />}
      </div>
    </div>
  );
}

const PANEL_INPUT_STYLE: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.03)",
  color: "#f8fafc",
};

function PanelButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-md py-2 text-center text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={
        variant === "destructive"
          ? { color: RED, background: "transparent", border: "1px solid rgba(248,113,113,.35)" }
          : { color: "#fff", background: "#0078D4", border: "1px solid #0078D4" }
      }
    >
      {children}
    </button>
  );
}

function PasskeyPanelBody({ mfa, busy, onPasskeyRegister, onPasskeyRemoveAll }: EnrollmentPanelProps) {
  if (mfa?.passkey) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] text-[#94a3b8]">{mfa.passkeyCount} passkey{mfa.passkeyCount === 1 ? "" : "s"} registered.</p>
        <PanelButton onClick={onPasskeyRegister} disabled={busy}>{busy ? "Waiting on device…" : "Add another passkey"}</PanelButton>
        <PanelButton onClick={onPasskeyRemoveAll} disabled={busy} variant="destructive">Remove all</PanelButton>
        <p className="text-[11px] text-[#64748b]">Removing takes effect immediately for every registered passkey — there is no way to remove just one.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2 text-[11.5px] text-[#94a3b8]">
        <li>1. Approve on this device — Face ID, Windows Hello, or a hardware key.</li>
        <li>2. A backup credential means a lost phone isn't a lockout.</li>
      </ol>
      <PanelButton onClick={onPasskeyRegister} disabled={busy}>{busy ? "Waiting on device…" : "Create passkey"}</PanelButton>
      <p className="text-[11px] text-[#64748b]">Nothing is typed and nothing can be read out over the phone.</p>
    </div>
  );
}

function TotpPanelBody({ mfa, busy, totpSetup, totpCode, onTotpCodeChange, onTotpStart, onTotpConfirm, onTotpRemove }: EnrollmentPanelProps) {
  if (mfa?.totp) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] text-[#94a3b8]">An authenticator app is enrolled and active on this account.</p>
        <PanelButton onClick={onTotpRemove} disabled={busy} variant="destructive">{busy ? "Removing…" : "Remove"}</PanelButton>
        <p className="text-[11px]" style={{ color: AMB }}>If a prompt arrives that you didn't trigger, deny it and change your password.</p>
      </div>
    );
  }
  if (totpSetup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] text-[#94a3b8]">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
        <div className="flex justify-center">
          <img src={totpSetup.qrDataUrl} alt="Authenticator app QR code" className="size-[160px] rounded-md" style={{ border: `1px solid ${HAIRLINE}` }} />
        </div>
        <input
          inputMode="numeric"
          maxLength={6}
          value={totpCode}
          onChange={(e) => onTotpCodeChange(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          autoFocus
          className="rounded-md px-3 py-[9px] text-center text-[13px] tracking-[.3em] outline-none"
          style={{ ...PANEL_INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          data-testid="account-security-totp-code"
        />
        <PanelButton onClick={onTotpConfirm} disabled={busy || totpCode.length < 6}>{busy ? "Verifying…" : "Confirm enrollment"}</PanelButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] text-[#94a3b8]">Set up an authenticator app (Microsoft Authenticator, Google Authenticator, Authy, or any TOTP app) as a second factor.</p>
      <PanelButton onClick={onTotpStart} disabled={busy}>{busy ? "Starting…" : "Set up authenticator"}</PanelButton>
    </div>
  );
}

function SmsPanelBody({
  mfa,
  busy,
  isAdmin,
  smsPhoneInput,
  onSmsPhoneChange,
  smsPendingPhone,
  smsSentLast4,
  smsCode,
  onSmsCodeChange,
  onSmsSend,
  onSmsConfirm,
  onSmsRemove,
}: EnrollmentPanelProps) {
  if (isAdmin) {
    return (
      <p className="text-[11.5px] text-[#94a3b8]">
        Admin accounts must use a passkey or authenticator app — text message backup isn't available for this role.
      </p>
    );
  }
  if (mfa?.sms) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] text-[#94a3b8]">Backup number ending in {last4(mfa.smsPhone)} is active.</p>
        <PanelButton onClick={onSmsRemove} disabled={busy} variant="destructive">{busy ? "Removing…" : "Remove"}</PanelButton>
        <p className="text-[11px]" style={{ color: AMB }}>A SIM swap defeats SMS — keep it as a backup, not your only method.</p>
      </div>
    );
  }
  if (smsPendingPhone) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] text-[#94a3b8]">
          We sent a 6-digit code to a number ending in {smsSentLast4}. Enter it to confirm — the code expires in 10 minutes.
        </p>
        <input
          inputMode="numeric"
          maxLength={6}
          value={smsCode}
          onChange={(e) => onSmsCodeChange(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          autoFocus
          className="rounded-md px-3 py-[9px] text-center text-[13px] tracking-[.3em] outline-none"
          style={{ ...PANEL_INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          data-testid="account-security-sms-code"
        />
        <PanelButton onClick={onSmsConfirm} disabled={busy || smsCode.length < 4}>{busy ? "Confirming…" : "Confirm code"}</PanelButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] text-[#94a3b8]">We'll send a 6-digit code to confirm the number. This becomes a backup method only.</p>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold text-[#94a3b8]">Mobile number</label>
        <input
          value={smsPhoneInput}
          onChange={(e) => onSmsPhoneChange(e.target.value)}
          placeholder="+1 555 000 0000"
          className="rounded-md px-3 py-[9px] text-[13px] outline-none"
          style={PANEL_INPUT_STYLE}
          data-testid="account-security-sms-phone"
        />
      </div>
      <PanelButton onClick={onSmsSend} disabled={busy || !smsPhoneInput.trim()}>{busy ? "Sending…" : "Send code"}</PanelButton>
      <p className="text-[11px]" style={{ color: AMB }}>A SIM swap defeats SMS — keep it as a backup, not your only method.</p>
    </div>
  );
}
