import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// PlatformAdmin-only testing convenience: switch the active browser session
// to view the portal as a known real account in a given role tier, via the
// existing single-use impersonation-token mechanism (auth.ts /auth/impersonate-
// exchange). Issues no new session/auth infra — this only lists real accounts
// (GET /admin/view-as/accounts) and calls the pre-existing token-generation
// endpoints (/admin/impersonate/:userId, /admin/msps/:mspId/impersonate)
// unchanged. This whole app is already gated to role="admin" (App.tsx), so no
// separate role check is needed here.

interface ViewAsAccount {
  userId: number;
  email: string;
  name: string | null;
  tier: "Assessment" | "CustomerUser" | "MSPAdmin";
  mspId: number | null;
  mspName: string | null;
  mspSlug: string | null;
}

const TIER_LABELS: Record<ViewAsAccount["tier"], string> = {
  Assessment: "Assessment",
  CustomerUser: "Customer User",
  MSPAdmin: "MSP Admin",
};

export default function ViewAsSwitcher() {
  const { fetchWithAuth } = useAuth();
  const [accounts, setAccounts] = useState<ViewAsAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || accounts.length > 0) return;
    fetchWithAuth("/api/admin/view-as/accounts")
      .then(res => (res.ok ? res.json() : null))
      .then((data: { accounts: ViewAsAccount[] } | null) => {
        if (data) setAccounts(data.accounts);
      })
      .catch(() => {});
  }, [open, accounts.length, fetchWithAuth]);

  async function handleSelect(account: ViewAsAccount) {
    setLoading(true);
    try {
      const origin = window.location.origin;
      if (account.tier === "MSPAdmin") {
        const res = await fetchWithAuth(`/api/admin/msps/${account.mspId}/impersonate`, { method: "POST" });
        if (!res.ok) return;
        const data = (await res.json()) as { token: string; targetSlug: string };
        window.open(
          `${origin}/portal/?impersonation_token=${encodeURIComponent(data.token)}&target_slug=${encodeURIComponent(data.targetSlug)}`,
          "_blank",
          "noopener",
        );
      } else {
        const res = await fetchWithAuth(`/api/admin/impersonate/${account.userId}`, { method: "POST" });
        if (!res.ok) return;
        const data = (await res.json()) as { token: string };
        window.open(`${origin}/crm/portal?impersonation_token=${encodeURIComponent(data.token)}`, "_blank", "noopener");
      }
    } finally {
      setLoading(false);
    }
  }

  const grouped = (["Assessment", "CustomerUser", "MSPAdmin"] as const).map(tier => ({
    tier,
    items: accounts.filter(a => a.tier === tier),
  }));

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title="View as (testing)"
          disabled={loading}
          className="flex items-center gap-1 px-2 h-full shrink-0 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 text-[11px] font-mono text-muted-foreground uppercase tracking-wider"
        >
          <UserCog className="w-3.5 h-3.5" />
          View As
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
        {grouped.map(({ tier, items }) => (
          <div key={tier}>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {TIER_LABELS[tier]}
            </DropdownMenuLabel>
            {items.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No accounts</div>
            )}
            {items.map(a => (
              <DropdownMenuItem key={a.userId} onClick={() => handleSelect(a)}>
                <div className="flex flex-col">
                  <span className="text-xs">{a.name ?? a.email}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {a.email}{a.mspName ? ` · ${a.mspName}` : ""}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
