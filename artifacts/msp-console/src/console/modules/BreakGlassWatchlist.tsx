/**
 * BreakGlassWatchlist — the cross-tenant break-glass watchlist tile from
 * screen 1 (README "1. Managed Tenants": "A break-glass watchlist across the
 * whole book sits first"). Mounts at the directory root, above wherever the
 * rest of that screen's tenant table eventually lands (#2630 scopes only this
 * tile plus the tenant-scoped Break-glass module page, screen 18).
 *
 * Real data: `GET /api/msp/break-glass` — the same cross-tenant pending list
 * `console-api.ts`'s `useBreakGlass()` already feeds the header pill with, so
 * this tile and the pill can never disagree about what's pending.
 */
import { Icon } from "@/console/icons";
import { border, signal, text } from "@/console/tokens";
import { useBreakGlass, type BreakGlassPending } from "@/api/console-api";

function ageLabel(createdAt: string): { text: string; stale: boolean } {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return { text: "", stale: false };
  const days = Math.floor((Date.now() - created) / 86_400_000);
  if (days <= 0) return { text: "today", stale: false };
  return { text: `${days} ${days === 1 ? "day" : "days"} waiting`, stale: days >= 7 };
}

export function BreakGlassWatchlist({ onOpenTenant }: { onOpenTenant: (customerId: number) => void }) {
  const query = useBreakGlass();

  if (query.isLoading) {
    return (
      <div style={{ height: 84, borderRadius: 12, border: `1px solid ${border.card}`, background: "rgba(15,23,42,.6)", padding: 15 }}>
        <div style={{ height: 12, width: "40%", borderRadius: 6, background: "rgba(148,163,184,.14)" }} />
      </div>
    );
  }

  const pending = query.data?.pending ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>BREAK-GLASS WATCHLIST</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: pending.length > 0 ? signal.critical.text : text.faint }}>
          {pending.length} pending across the book
        </span>
      </div>

      {pending.length === 0 ? (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: "rgba(15,23,42,.6)", padding: "20px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: signal.ok.tint, border: `1px solid ${signal.ok.border}`, color: signal.ok.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="key-round" size={16} color={signal.ok.strong} />
          </span>
          <span style={{ fontSize: 12.5, color: text.muted, textWrap: "pretty" }}>
            No break-glass credentials pending delivery anywhere in your book right now.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {pending.map((p) => (
            <WatchlistRow key={p.pendingSecretId} pending={p} onOpen={() => onOpenTenant(p.customerId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistRow({ pending, onOpen }: { pending: BreakGlassPending; onOpen: () => void }) {
  const age = ageLabel(pending.createdAt);
  return (
    <div
      onClick={onOpen}
      style={{
        border: `1px solid ${age.stale ? "rgba(251,191,36,.24)" : border.card}`, borderRadius: 12, background: "rgba(15,23,42,.6)", padding: 14,
        display: "flex", alignItems: "center", gap: 12, minWidth: 0, cursor: "pointer",
      }}
    >
      <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: signal.warning.tint, border: `1px solid ${signal.warning.border}`, color: signal.warning.strong, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="key-round" size={14} color={signal.warning.strong} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pending.customerName ?? `Customer ${pending.customerId}`}
        </span>
        <span style={{ fontSize: 11, color: text.muted }}>
          {pending.liveInviteCount} of {pending.totalInviteCount} invite{pending.totalInviteCount === 1 ? "" : "s"} live · pending_delivery
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "0 0 auto", alignItems: "flex-end" }}>
        <span style={{ fontSize: 11, color: age.stale ? "#fcd34d" : text.label, whiteSpace: "nowrap" }}>{age.text}</span>
        <span style={{ fontSize: 10.5, color: text.faint, whiteSpace: "nowrap" }}>#{pending.pendingSecretId}</span>
      </div>
    </div>
  );
}
