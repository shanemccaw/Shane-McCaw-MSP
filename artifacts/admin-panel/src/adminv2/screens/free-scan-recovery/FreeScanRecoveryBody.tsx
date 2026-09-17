/**
 * Free Scan account recovery body (Git #4483).
 *
 * Where Shane decides a paid Free Scan Prospect's request to replace a lost
 * second factor. The Prospect has already proven their mailbox and their
 * current password; neither is enough on its own, so the approval is the
 * out-of-band step — confirm the person through a channel that is not their
 * email before approving, and record how in the note.
 *
 * Every value shown is served by routes/admin-free-scan-account-recovery.ts.
 */

import { useState, useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { SURFACE, LINE, TEXT, ACCENT, ACCENT_TEXT, FONT } from "../../theme";
import { subscribe, getSnapshot, loadRequests, decide, type RecoveryRequest, type MfaResetState } from "./freeScanRecoveryStore";

const STATE_LABEL: Record<MfaResetState, string> = {
  none: "None",
  pending: "Waiting for a decision",
  approved: "Approved",
  approval_expired: "Approval expired unused",
  denied: "Denied",
};

function stateTone(s: MfaResetState): string {
  if (s === "pending") return ACCENT_TEXT.amber;
  if (s === "approved") return ACCENT_TEXT.green;
  if (s === "denied") return ACCENT_TEXT.danger;
  return ACCENT_TEXT.neutral;
}

const card: React.CSSProperties = { background: SURFACE.card, border: `1px solid ${LINE.base}`, borderRadius: 8, padding: 16 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: TEXT.caption };
const btn: React.CSSProperties = {
  border: `1px solid ${LINE.control}`,
  background: SURFACE.well,
  color: TEXT.primary,
  borderRadius: 6,
  padding: "7px 12px",
  fontSize: 12.5,
  cursor: "pointer",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint }}>{children}</div>;
}

function Fact({ name, value, tone }: { name: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={label}>{name}</span>
      <span style={{ fontSize: 13, color: tone ?? TEXT.body, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

function RequestCard({ r, deciding }: { r: RecoveryRequest; deciding: boolean }) {
  const [note, setNote] = useState("");
  const noteOk = note.trim().length >= 10;
  const passwordRecentlyReset =
    !!r.passwordSetAt && !!r.requestedAt && new Date(r.requestedAt).getTime() - new Date(r.passwordSetAt).getTime() < 24 * 60 * 60 * 1000;

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }} data-testid={`fsr-request-${r.accountId}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: TEXT.bright }}>{r.tenant.name ?? r.tenant.domain ?? r.email}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: stateTone(r.state) }}>{STATE_LABEL[r.state]}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        <Fact name="Account email" value={r.email} />
        <Fact name="Engagement" value={r.engagement.sowReference} />
        <Fact name="Signed by" value={r.engagement.signerName ? `${r.engagement.signerName}${r.engagement.signerRole ? `, ${r.engagement.signerRole}` : ""}` : "—"} />
        <Fact name="Tenant domain" value={r.tenant.domain ?? "—"} />
        <Fact name="Lost factor" value={r.mfaMethod === "sms" ? `Text message, number ending ${r.phoneLast4 ?? "—"}` : "Authenticator app"} />
        <Fact name="Requested" value={when(r.requestedAt)} />
        <Fact name="Password last set" value={when(r.passwordSetAt)} tone={passwordRecentlyReset ? ACCENT_TEXT.amber : undefined} />
        <Fact name="Last sign-in" value={when(r.lastLoginAt)} />
        {r.decidedAt ? <Fact name="Decided" value={when(r.decidedAt)} /> : null}
        {r.approvalExpiresAt ? <Fact name="Approval expires" value={when(r.approvalExpiresAt)} /> : null}
      </div>
      {passwordRecentlyReset ? (
        <span style={{ fontSize: 12.5, lineHeight: 1.55, color: ACCENT.amber }}>
          The password was reset within 24 hours of this request. Someone with only the mailbox could have done both.
        </span>
      ) : null}
      {r.decisionNote ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: TEXT.quiet }}>
          <span style={label}>Decision note</span>
          <div style={{ marginTop: 4 }}>{r.decisionNote}</div>
        </div>
      ) : null}

      {r.state === "pending" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: TEXT.dim }}>
            The mailbox and the password are already proven, and neither is enough on its own. Confirm this is the person through a channel that is not their email — a call to a number you already hold for them — before approving.
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How you confirmed their identity (required)"
            rows={3}
            data-testid={`fsr-note-${r.accountId}`}
            style={{
              background: SURFACE.well,
              border: `1px solid ${LINE.control}`,
              borderRadius: 6,
              padding: "7px 9px",
              color: TEXT.primary,
              fontSize: 13,
              fontFamily: FONT.sans,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={!noteOk || deciding}
              onClick={() => void decide(r.accountId, "approve", note.trim())}
              data-testid={`fsr-approve-${r.accountId}`}
              style={{ ...btn, color: noteOk ? ACCENT_TEXT.green : TEXT.faint, cursor: noteOk && !deciding ? "pointer" : "not-allowed" }}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={!noteOk || deciding}
              onClick={() => void decide(r.accountId, "deny", note.trim())}
              data-testid={`fsr-deny-${r.accountId}`}
              style={{ ...btn, color: noteOk ? ACCENT_TEXT.danger : TEXT.faint, cursor: noteOk && !deciding ? "pointer" : "not-allowed" }}
            >
              Deny
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FreeScanRecoveryBody() {
  const s = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000 }} data-testid="fsr-body">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: TEXT.bright }}>Free Scan account recovery</span>
          <span style={{ fontSize: 12.5, color: TEXT.dim }}>Requests to replace a lost second factor on a paid Free Scan engagement account.</span>
        </div>
        <button type="button" onClick={() => void loadRequests()} style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} disabled={s.loading}>
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {s.decisionError ? <div style={{ fontSize: 12.5, color: ACCENT_TEXT.danger }}>{s.decisionError}</div> : null}
      {s.decisionNotice ? <div style={{ fontSize: 12.5, color: ACCENT_TEXT.amber }}>{s.decisionNotice}</div> : null}

      {s.error ? <Stated>Couldn't load the queue: {s.error}</Stated> : null}
      {!s.loaded && s.loading ? <Stated>Loading…</Stated> : null}
      {s.loaded && s.requests.length === 0 ? <Stated>No second-factor reset has been requested.</Stated> : null}
      {s.requests.map((r) => (
        <RequestCard key={r.accountId} r={r} deciding={s.deciding === r.accountId} />
      ))}
    </div>
  );
}
