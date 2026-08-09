/**
 * Shared Links screen body — the centre content. Same split as
 * `ServicesBody.tsx`/`FulfillmentBody.tsx`: nothing open shows a dashboard
 * (the same four stat tiles `DiagnosticShares.tsx` validated — Total /
 * Active / Total views / High engagement — plus an "expiring soon" list, so
 * the Watch tab's count is never hidden behind a filter); a link open shows
 * a read-only summary card (scores or the shared document's title) with the
 * real actions: copy, open (when it resolves), extend, revoke.
 */

import { useSyncExternalStore } from "react";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { ACCENT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  copyShareLink,
  expiringSoon,
  extendShareAction,
  getSnapshot,
  highEngagementCount,
  refreshShares,
  revokeShareAction,
  shareById,
  subscribe,
  totalViews,
  type SharedLinksState,
} from "./sharedLinksStore";
import {
  categoryLabel,
  clientLabel,
  formatDate,
  isExpired,
  isOpenable,
  relativeExpiry,
  scoreEntries,
  shareUrl,
  whatIsShared,
  type Share,
} from "./sharedLinksTypes";

export function SharedLinksBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const open = shareById(state.openId, state);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px" }}>
        {open ? <RecordView share={open} saving={state.savingIds.has(open.id)} /> : <Overview state={state} />}
      </div>
      {state.message && <Toast message={state.message} />}
    </div>
  );
}

function Header({ state }: { state: SharedLinksState }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>Shared Links</span>
      <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${LINE.strong}`, fontSize: 10.5, color: TEXT.dimmer }}>
        {state.shares.length} total
      </span>
      <div style={{ flex: 1, minWidth: 4 }} />
      <button onClick={() => void refreshShares()} style={buttonStyle(false)}>
        Refresh
      </button>
    </div>
  );
}

function buttonStyle(primary: boolean, color?: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${color ?? LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : (color ?? TEXT.soft),
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

function Toast({ message }: { message: string }) {
  return (
    <div style={{ flex: "none", padding: "8px 16px", fontSize: 12, color: TEXT.strong, background: SURFACE.card, borderTop: `1px solid ${LINE.base}` }}>
      {message}
    </div>
  );
}

// ── Overview (nothing open) ──────────────────────────────────────────────────

function Overview({ state }: { state: SharedLinksState }) {
  if (state.loading && state.shares.length === 0) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading shared links…</div>;
  }
  if (state.error && state.shares.length === 0) {
    return <div style={{ padding: 20, fontSize: 12.5, color: ACCENT.danger }}>{state.error}</div>;
  }
  if (state.shares.length === 0) {
    return (
      <div style={{ padding: 20, fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint }}>
        No clients have shared a diagnostic result or document yet. Clients create these links themselves from the portal — a link getting passed around
        inside a company is the signal worth watching for.
      </div>
    );
  }

  const active = state.shares.filter((s) => !isExpired(s)).length;
  const soon = expiringSoon(state);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatTile label="Total shares" value={String(state.shares.length)} sub="all time" />
        <StatTile label="Active" value={String(active)} sub="not yet expired" color={ACCENT.greenBright} />
        <StatTile label="Total views" value={String(totalViews(state))} sub="across all links" color={ACCENT.info} />
        <StatTile label="High engagement" value={String(highEngagementCount(state))} sub="active, 3+ views" color={highEngagementCount(state) > 0 ? ACCENT.amber : undefined} />
      </div>

      {soon.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: ACCENT.amber }}>Expiring soon</span>
          {soon.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card, cursor: "pointer" }}
              onClick={() => void extendShareAction(s.id)}
              title="Extend 14 days"
            >
              <AlertTriangle size={13} color={ACCENT.amber} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {clientLabel(s.client)}
              </span>
              <span style={{ fontSize: 11, color: ACCENT.amber }}>{relativeExpiry(s.expiresAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 0, padding: "13px 15px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.caption }}>{label}</span>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: color ?? TEXT.primary }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, color: TEXT.faint }}>{sub}</div>
    </div>
  );
}

// ── One share, open ───────────────────────────────────────────────────────────

function RecordView({ share, saving }: { share: Share; saving: boolean }) {
  const expired = isExpired(share);
  const openable = isOpenable(share);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton icon={Copy} label="Copy link" onClick={() => copyShareLink(shareUrl(share))} disabled={!openable} />
        {openable && (
          <a href={shareUrl(share)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <ActionButton icon={ExternalLink} label="Open" onClick={() => {}} />
          </a>
        )}
        <ActionButton label="Extend 14 days" onClick={() => void extendShareAction(share.id)} busy={saving} />
        {!expired && <ActionButton label="Revoke now" onClick={() => void revokeShareAction(share.id)} busy={saving} danger />}
      </div>

      <div style={{ padding: "22px 24px", borderRadius: 12, border: `1px solid ${LINE.strong}`, background: SURFACE.card }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.dim }}>
          {share.shareKind === "document" ? "Shared document" : "Shared diagnostic"}
        </span>
        <div style={{ marginTop: 9, fontSize: 20, fontWeight: 700, letterSpacing: "-.015em", lineHeight: 1.2, color: TEXT.bright }}>{clientLabel(share.client)}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: TEXT.dim }}>{share.client.email}{share.client.company ? ` · ${share.client.company}` : ""}</div>

        <div style={{ marginTop: 17, fontSize: 13, color: TEXT.soft }}>{whatIsShared(share)}</div>

        {share.shareKind === "quick_win_scores" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
            {scoreEntries(share).length === 0 ? (
              <span style={{ fontSize: 11.5, color: TEXT.faint }}>No scores snapshot.</span>
            ) : (
              scoreEntries(share).map(([cat, score]) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 90, fontSize: 11.5, color: TEXT.quiet }}>{categoryLabel(cat)}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#333" }}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, score))}%`,
                        height: 6,
                        borderRadius: 3,
                        background: score >= 70 ? ACCENT.greenBright : score >= 40 ? ACCENT.amber : ACCENT.danger,
                      }}
                    />
                  </div>
                  <span style={{ width: 26, textAlign: "right", fontSize: 11, color: TEXT.faint }}>{score}</span>
                </div>
              ))
            )}
          </div>
        )}

        <div style={{ marginTop: 17, display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-.02em", color: share.viewCount >= 3 ? ACCENT.amber : TEXT.bright }}>{share.viewCount}</span>
          <span style={{ fontSize: 12, color: TEXT.caption }}>view{share.viewCount === 1 ? "" : "s"}</span>
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: expired ? ACCENT.danger : TEXT.faint }}>
          {expired ? `Expired ${formatDate(share.expiresAt)}` : `Expires ${formatDate(share.expiresAt)} (${relativeExpiry(share.expiresAt)})`}
        </div>
        {!openable && (
          <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: TEXT.faint }}>
            No public viewer exists for this link kind — nothing for "Open" to point at.
          </div>
        )}
      </div>

      <span style={{ fontSize: 11, lineHeight: 1.5, textAlign: "center", color: TEXT.faint }}>
        Clients create these from the portal. Extend and revoke edit straight through — from here, the peek, or the contextual tab.
      </span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  busy,
  danger,
  disabled,
}: {
  icon?: typeof Copy;
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 13px",
        borderRadius: 6,
        border: `1px solid ${danger ? ACCENT.danger : LINE.control}`,
        background: SURFACE.well,
        color: danger ? ACCENT.danger : TEXT.body,
        fontFamily: "inherit",
        fontSize: 12,
        cursor: busy || disabled ? "default" : "pointer",
        opacity: busy || disabled ? 0.6 : 1,
      }}
    >
      {Icon && <Icon size={13} />}
      {busy ? "Working…" : label}
    </button>
  );
}
