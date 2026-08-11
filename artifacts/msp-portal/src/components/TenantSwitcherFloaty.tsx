/**
 * TenantSwitcherFloaty (Git #797, Phase 2 of epic #773)
 *
 * App-shell-mounted, PlatformAdmin-only floating widget that swaps the live
 * session in place to any real account (Assessment / CustomerUser / MSPAdmin
 * tier) via #796's switchToTenant()/returnToAdmin() — no new tab, current
 * route re-renders as the new tenant. "None" is pinned at the top and always
 * returns to Shane's own admin identity.
 *
 * Reuses the same GET /admin/view-as/accounts + impersonate endpoints the
 * existing new-tab ViewAsSwitcher.tsx (admin-panel) already calls, unchanged
 * — this is additive UI, not a replacement for that entry point.
 *
 * Chrome (drag/collapse/position-persistence) mirrors
 * copilot-assessment/debug/DebugPanel.tsx's own pattern (own storage key so
 * the two panels never collide).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { ChevronDown, ChevronUp, Loader2, UserCog, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

const STORAGE_KEY = "tenant-switcher.v1";
const PANEL_WIDTH = 300;
const HEADER_HEIGHT = 34;
const MAX_LIST_HEIGHT = 360;

type PanelLayout = { x: number; y: number; collapsed: boolean };

interface ViewAsAccount {
  userId: number;
  email: string;
  name: string | null;
  tier: "Assessment" | "CustomerUser" | "MSPAdmin";
  mspId: number | null;
  mspName: string | null;
  mspSlug: string | null;
}

const TIERS = ["Assessment", "CustomerUser", "MSPAdmin"] as const;
const TIER_LABELS: Record<ViewAsAccount["tier"], string> = {
  Assessment: "Assessment",
  CustomerUser: "Customer User",
  MSPAdmin: "MSP Admin",
};

export function TenantSwitcherFloaty() {
  const { user, accessToken, fetchWithAuth, isImpersonating, switchToTenant, returnToAdmin } = useAuth();

  // Gated PlatformAdmin-only, same as ViewAsSwitcher.tsx. Once a switch has
  // happened, `user.mspRole`/`user.role` reflect the IMPERSONATED tenant, not
  // PlatformAdmin — but isImpersonating only ever becomes true here via a
  // PlatformAdmin-initiated switch (this widget or the existing new-tab
  // ViewAsSwitcher), so keep the widget reachable for the whole viewing-as
  // session, not just before the first switch — lets Shane jump straight to
  // another tenant without going through None first.
  const isPlatformAdmin = user?.role === "admin" || user?.mspRole === "PlatformAdmin";
  const show = isPlatformAdmin || isImpersonating;

  const [layout, setLayout] = useState<PanelLayout>(() => loadLayout());
  const [accounts, setAccounts] = useState<ViewAsAccount[] | null>(null);
  const [switchingId, setSwitchingId] = useState<number | "none" | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // storage can be full or blocked — position just won't persist
    }
  }, [layout]);

  // A position saved on a bigger monitor must not strand the panel offscreen.
  useLayoutEffect(() => {
    setLayout((prev) => clampLayout(prev));
  }, []);
  useEffect(() => {
    const onResize = () => setLayout((prev) => clampLayout(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = useDragHandle(panelRef, setLayout);

  // Fetch lazily the first time the panel is expanded; cached for the rest
  // of the session, same as ViewAsSwitcher's on-open fetch.
  useEffect(() => {
    if (!show || layout.collapsed || accounts !== null) return;
    fetchWithAuth("/api/admin/view-as/accounts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { accounts: ViewAsAccount[] } | null) => {
        if (data) setAccounts(data.accounts);
      })
      .catch(() => {});
  }, [show, layout.collapsed, accounts, fetchWithAuth]);

  const toggleCollapsed = useCallback(() => {
    setLayout((prev) => {
      if (prev.collapsed) {
        reportClientEvent(
          accessToken,
          "TenantSwitcherOpened",
          "Tenant switcher floaty opened",
          "auth.impersonation",
        );
      }
      return { ...prev, collapsed: !prev.collapsed };
    });
  }, [accessToken]);

  const handleNone = useCallback(() => {
    if (switchingId !== null) return;
    setSwitchingId("none");
    reportClientEvent(
      accessToken,
      "TenantSwitcherSelectNone",
      "Selected None — returning to admin",
      "auth.impersonation",
    );
    void returnToAdmin().finally(() => setSwitchingId(null));
  }, [accessToken, returnToAdmin, switchingId]);

  const handleSelect = useCallback(
    async (account: ViewAsAccount) => {
      if (switchingId !== null) return;
      setSwitchingId(account.userId);
      reportClientEvent(
        accessToken,
        "TenantSwitcherSelectTenant",
        `Selected tenant tier=${account.tier}`,
        "auth.impersonation",
        { tier: account.tier, mspId: account.mspId },
      );
      try {
        const endpoint =
          account.tier === "MSPAdmin"
            ? `/api/admin/msps/${account.mspId}/impersonate`
            : `/api/admin/impersonate/${account.userId}`;
        const res = await fetchWithAuth(endpoint, { method: "POST" });
        if (!res.ok) return;
        const data = (await res.json()) as { token: string };
        // targetSlug deliberately omitted — the current route re-renders as
        // the new tenant instead of navigating away.
        await switchToTenant(data.token);
      } finally {
        setSwitchingId(null);
      }
    },
    [accessToken, fetchWithAuth, switchToTenant, switchingId],
  );

  const grouped = useMemo(
    () => TIERS.map((tier) => ({ tier, items: (accounts ?? []).filter((a) => a.tier === tier) })),
    [accounts],
  );

  if (!show) return null;

  return (
    <div
      ref={panelRef}
      data-testid="tenant-switcher-floaty"
      className="fixed z-[10000] flex flex-col overflow-hidden rounded-lg border border-primary/40 bg-card/95 shadow-2xl backdrop-blur select-none"
      style={{ left: layout.x, top: layout.y, width: PANEL_WIDTH }}
    >
      <div
        onPointerDown={startDrag}
        data-testid="tenant-switcher-floaty-header"
        className="flex h-[34px] shrink-0 cursor-move items-center gap-1.5 border-b border-primary/30 bg-primary/10 px-2"
      >
        <UserCog className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate text-[10px] font-semibold tracking-wider text-primary uppercase">
          Tenant Switcher
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {isImpersonating && (
            <span
              title={user?.email}
              className="max-w-[120px] truncate rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400"
            >
              {user?.email}
            </span>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={toggleCollapsed}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={layout.collapsed ? "Expand panel" : "Collapse panel"}
          >
            {layout.collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </span>
      </div>

      {!layout.collapsed && (
        <div className="flex flex-col overflow-y-auto p-1" style={{ maxHeight: MAX_LIST_HEIGHT }}>
          <button
            type="button"
            data-testid="tenant-switcher-none"
            onClick={handleNone}
            disabled={switchingId !== null}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold transition-colors disabled:opacity-50 ${
              !isImpersonating ? "bg-accent text-foreground" : "text-foreground hover:bg-accent"
            }`}
          >
            {switchingId === "none" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <UserCog className="h-3.5 w-3.5 shrink-0" />
            )}
            None (your admin account)
          </button>
          <div className="my-1 border-t border-border" />

          {accounts === null ? (
            <div className="flex items-center justify-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading accounts…
            </div>
          ) : (
            grouped.map(({ tier, items }) => (
              <div key={tier}>
                <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <Users className="h-3 w-3" />
                  {TIER_LABELS[tier]}
                </div>
                {items.length === 0 && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground/70 italic">No accounts</div>
                )}
                {items.map((a) => {
                  const isCurrent = isImpersonating && user?.email === a.email;
                  return (
                    <button
                      key={a.userId}
                      type="button"
                      data-testid="tenant-switcher-account"
                      onClick={() => void handleSelect(a)}
                      disabled={switchingId !== null}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
                        isCurrent ? "bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      {switchingId === a.userId ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-xs text-foreground">{a.name ?? a.email}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {a.email}
                          {a.mspName ? ` · ${a.mspName}` : ""}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Layout: drag + position persistence ─────────────────────────────────────

function useDragHandle(
  panelRef: RefObject<HTMLDivElement | null>,
  setLayout: Dispatch<SetStateAction<PanelLayout>>,
) {
  return useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: rect.left, y: rect.top };

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        setLayout((prev) => clampLayout({ ...prev, x: origin.x + dx, y: origin.y + dy }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelRef, setLayout],
  );
}

function clampLayout(layout: PanelLayout): PanelLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Keep at least the header reachable so the panel can always be dragged back.
  const x = Math.min(Math.max(layout.x, 8 - PANEL_WIDTH + 60), Math.max(8, vw - 60));
  const y = Math.min(Math.max(layout.y, 8), Math.max(8, vh - HEADER_HEIGHT - 8));
  return { ...layout, x, y };
}

function loadLayout(): PanelLayout {
  const fallback: PanelLayout = {
    x: Math.max(8, window.innerWidth - PANEL_WIDTH - 16),
    y: 60,
    collapsed: true,
  };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<PanelLayout>;
    return clampLayout({
      x: numberOr(parsed.x, fallback.x),
      y: numberOr(parsed.y, fallback.y),
      collapsed: parsed.collapsed !== false,
    });
  } catch {
    return fallback;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
