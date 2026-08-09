/**
 * The Properties panel — mirrors the design's right-panel anatomy for a
 * shared link almost exactly: a **Link** group (who it's with, what it is,
 * the URL), an **Engagement** group (views, when it was shared), an
 * **Administration** group (expiry, extend, revoke). Nothing open shows the
 * screen's own headline stats, the same split as `ServiceProperties.tsx`.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, PRIMARY, TEXT } from "../../theme";
import {
  expiringSoon,
  extendShareAction,
  getSnapshot,
  highEngagementCount,
  revokeShareAction,
  shareById,
  subscribe,
  totalViews,
  type SharedLinksState,
} from "./sharedLinksStore";
import {
  clientLabel,
  formatDate,
  isExpired,
  isOpenable,
  relativeExpiry,
  shareUrl,
  whatIsShared,
  type Share,
} from "./sharedLinksTypes";

export function SharedLinksProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const share = shareById(state.openId, state);

  if (!share) return <Overview state={state} />;
  return <PropertiesView share={share} saving={state.savingIds.has(share.id)} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>{title}</span>
      {children}
    </div>
  );
}

function Fact({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "none", minWidth: 76, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: mono ? FONT.mono : "inherit", fontSize: 11.5, color: color ?? TEXT.strong, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// ── Nothing open ─────────────────────────────────────────────────────────────

function Overview({ state }: { state: SharedLinksState }) {
  const soon = expiringSoon(state);
  return (
    <div style={{ padding: "12px 14px 20px", display: "flex", flexDirection: "column", gap: 14, overflow: "auto", height: "100%" }}>
      {state.shares.length === 0 ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
          Nothing is open. Pick a link on the left and this shows who it's with, how it's doing, and when it expires.
        </span>
      ) : (
        <>
          <Section title="Right now">
            <Fact label="Total" value={String(state.shares.length)} />
            <Fact label="Views" value={String(totalViews(state))} />
            <Fact label="Hot" value={String(highEngagementCount(state))} color={highEngagementCount(state) > 0 ? ACCENT.amber : undefined} />
          </Section>
          {soon.length > 0 && (
            <Section title="Expiring soon">
              {soon.slice(0, 6).map((s) => (
                <span key={s.id} style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.body }}>
                  {clientLabel(s.client)} — {relativeExpiry(s.expiresAt)}
                </span>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ── A share open ─────────────────────────────────────────────────────────────

function PropertiesView({ share, saving }: { share: Share; saving: boolean }) {
  const expired = isExpired(share);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="Link">
        <Fact label="Client" value={clientLabel(share.client)} />
        <Fact label="Shared with" value={share.client.email} mono />
        <Fact label="What" value={whatIsShared(share)} />
        {isOpenable(share) ? (
          <Fact label="URL" value={shareUrl(share)} mono color={ACCENT.info} />
        ) : (
          <span style={{ fontSize: 11, lineHeight: 1.5, color: TEXT.faint }}>
            No public viewer exists for a {share.shareKind === "quick_win_scores" ? "diagnostic-scores" : share.shareKind} link — nothing to open.
          </span>
        )}
      </Section>

      <Section title="Engagement">
        <Fact label="Views" value={String(share.viewCount)} color={share.viewCount >= 3 ? ACCENT.amber : undefined} />
        <Fact label="Shared" value={formatDate(share.createdAt)} />
      </Section>

      <Section title="Administration">
        <Fact
          label="Expires"
          value={expired ? `Expired ${formatDate(share.expiresAt)}` : `${formatDate(share.expiresAt)} (${relativeExpiry(share.expiresAt)})`}
          color={expired ? ACCENT.danger : undefined}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <button onClick={() => void extendShareAction(share.id)} disabled={saving} style={buttonStyle(true, saving)}>
            {saving ? "Working…" : "Extend 14 days"}
          </button>
          {!expired && (
            <button onClick={() => void revokeShareAction(share.id)} disabled={saving} style={buttonStyle(false, saving, ACCENT.danger)}>
              Revoke now
            </button>
          )}
        </div>
      </Section>
    </div>
  );
}

function buttonStyle(primary: boolean, disabled: boolean, color?: string): React.CSSProperties {
  return {
    padding: "5px 11px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${color ?? LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : (color ?? TEXT.soft),
    fontFamily: "inherit",
    fontSize: 11.5,
    fontWeight: primary ? 600 : 400,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
