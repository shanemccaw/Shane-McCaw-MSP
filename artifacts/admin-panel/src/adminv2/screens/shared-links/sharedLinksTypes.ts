/**
 * Shared Links — real shapes off `quick_win_result_shares`
 * (`lib/db/src/schema/index.ts`), reached through `admin-quick-win.ts`. A
 * share is a client-facing, token-based link to either a diagnostic scores
 * snapshot or a generated document; the client (not the admin) is who
 * creates one, from the portal — this screen reads, extends and revokes,
 * it does not mint new ones.
 *
 * Rebuilds the existing (non-adminv2) `pages/crm/DiagnosticShares.tsx`
 * inside `SHELL.md`'s `registerScreen` contract, keeping its validated
 * filter/sort/status logic, and adds the two mutations that page never had
 * — extend and revoke — backed by two new routes on the same table
 * (`admin-quick-win.ts`), not a schema change.
 *
 * `shareKind: "quick_win_scores"` is real in the schema but dead in
 * practice — nothing in this codebase inserts it, and no public route
 * consumes it by `shareToken` (`document` shares alone resolve, at
 * `/portal/shared-documents/:shareToken`). `DiagnosticShares.tsx`'s own
 * "Open" link for a scores-kind share points at `/crm/shared-results/:token`,
 * which is not registered anywhere in `admin-panel`'s router — a
 * pre-existing dead link, not something this screen repeats. See
 * `shareUrl()`/`isOpenable()` below.
 */

export interface ShareClient {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

export type ShareKind = "quick_win_scores" | "document";

/** `GET /admin/quick-win/result-shares` row shape. */
export interface Share {
  id: number;
  shareToken: string;
  shareKind: ShareKind;
  scoresSnapshot: Partial<Record<string, number>> | null;
  documentId: number | null;
  documentTitle: string | null;
  latestDate: string | null;
  expiresAt: string;
  viewCount: number;
  createdAt: string;
  client: ShareClient;
}

export function parseShare(raw: Record<string, unknown>): Share {
  const client = (raw.client as Record<string, unknown>) ?? {};
  return {
    id: Number(raw.id),
    shareToken: String(raw.shareToken ?? ""),
    shareKind: raw.shareKind === "document" ? "document" : "quick_win_scores",
    scoresSnapshot: (raw.scoresSnapshot as Partial<Record<string, number>>) ?? null,
    documentId: raw.documentId != null ? Number(raw.documentId) : null,
    documentTitle: (raw.documentTitle as string) ?? null,
    latestDate: (raw.latestDate as string) ?? null,
    expiresAt: String(raw.expiresAt ?? ""),
    viewCount: Number(raw.viewCount ?? 0),
    createdAt: String(raw.createdAt ?? ""),
    client: {
      id: Number(client.id),
      name: (client.name as string) ?? null,
      email: String(client.email ?? ""),
      company: (client.company as string) ?? null,
    },
  };
}

export function clientLabel(c: ShareClient): string {
  return c.name?.trim() || c.email;
}

export function isExpired(s: Share): boolean {
  return new Date(s.expiresAt).getTime() < Date.now();
}

export function isNeverOpened(s: Share): boolean {
  return s.viewCount === 0;
}

/** Active and 3+ views — the "worth a follow-up" signal `DiagnosticShares.tsx` already flags. */
export function isHighEngagement(s: Share): boolean {
  return !isExpired(s) && s.viewCount >= 3;
}

/** Active and expiring within `days` — the Watch tab's live count. */
export function isExpiringSoon(s: Share, days = 3): boolean {
  if (isExpired(s)) return false;
  const remaining = new Date(s.expiresAt).getTime() - Date.now();
  return remaining <= days * 86_400_000;
}

/** Only `document` shares resolve publicly — see file doc comment. */
export function isOpenable(s: Share): boolean {
  return s.shareKind === "document";
}

/** `window.location.origin` matches `DiagnosticShares.tsx`'s own resolution — adminv2 lives in the same admin-panel app. */
export function shareUrl(s: Share): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/portal/shared-documents/${s.shareToken}`;
}

export function whatIsShared(s: Share): string {
  if (s.shareKind === "document") return s.documentTitle ?? "Document";
  return "Quick-win diagnostic scores";
}

const CATEGORY_LABEL: Record<string, string> = {
  security: "Security",
  compliance: "Compliance",
  copilot: "Copilot",
  governance: "Governance",
  productivity: "Productivity",
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABEL[key] ?? key;
}

export function scoreEntries(s: Share): Array<[string, number]> {
  return Object.entries(s.scoresSnapshot ?? {}).map(([k, v]) => [k, v ?? 0]);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "3 days" / "Today" / "Expired" — matches `DiagnosticShares.tsx`'s `fmtRelative`. */
export function relativeExpiry(iso: string): string {
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff < 0) return "Expired";
  const days = Math.floor(diff / 86400);
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
