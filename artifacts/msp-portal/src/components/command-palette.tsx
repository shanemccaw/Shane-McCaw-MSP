/**
 * CommandPalette — Cmd+K portal-wide search.
 * Scoped to the MSP's own book of business (tenant-scoped server query).
 * Navigation items are role-gated to match sidebar visibility.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth, type MspRole } from "@/lib/auth-context";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Building2,
  LayoutDashboard,
  Loader2,
  FileText,
  Settings,
  Shield,
  Users,
} from "lucide-react";

interface SearchCustomer {
  id: number;
  name: string;
  status: string;
  domain?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface NavEntry {
  icon: React.ElementType;
  label: string;
  href: string;
  roles?: MspRole[];
}

const NAV_ENTRIES: NavEntry[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  {
    icon: Building2,
    label: "MSPs",
    href: "/msps",
    roles: ["PlatformAdmin"],
  },
  {
    icon: Users,
    label: "Customers",
    href: "/customers",
    roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
  },
  {
    icon: Bell,
    label: "Events",
    href: "/events",
    roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
  },
  {
    icon: Shield,
    label: "Audit Logs",
    href: "/audit",
    roles: ["PlatformAdmin", "MSPAdmin"],
  },
  {
    icon: FileText,
    label: "Offboarding",
    href: "/offboarding",
    roles: ["PlatformAdmin", "MSPAdmin"],
  },
  {
    icon: Settings,
    label: "Settings",
    href: "/settings",
    roles: ["PlatformAdmin", "MSPAdmin"],
  },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();
  const { fetchWithAuth, user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCustomer[]>([]);
  const [loading, setLoading] = useState(false);

  const mspRole = user?.mspRole;

  function isNavVisible(entry: NavEntry) {
    if (!entry.roles || entry.roles.length === 0) return true;
    if (!mspRole) return false;
    return entry.roles.includes(mspRole);
  }

  const visibleNav = NAV_ENTRIES.filter(isNavVisible);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetchWithAuth(
          `/api/msp/customers?search=${encodeURIComponent(q)}&limit=8`,
        );
        if (res.ok) {
          const data = (await res.json()) as { customers: SearchCustomer[] };
          setResults(data.customers ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    const t = setTimeout(() => void search(query), 200);
    return () => clearTimeout(t);
  }, [open, query, search]);

  function go(href: string) {
    onOpenChange(false);
    navigate(href);
  }

  const canSearchCustomers = ["PlatformAdmin", "MSPAdmin", "MSPOperator"].includes(
    mspRole ?? "",
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search customers, navigate pages…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && query.trim() && results.length === 0 && canSearchCustomers && (
          <CommandEmpty>No customers found.</CommandEmpty>
        )}

        {results.length > 0 && canSearchCustomers && (
          <CommandGroup heading="Customers">
            {results.map((c) => (
              <CommandItem
                key={c.id}
                value={`customer-${c.id}-${c.name}`}
                onSelect={() => go(`/customers/${c.id}`)}
              >
                <Users className="mr-2 size-4 text-muted-foreground" />
                <span className="flex-1">{c.name}</span>
                {c.domain && (
                  <span className="text-xs text-muted-foreground mr-2">{c.domain}</span>
                )}
                <Badge variant="outline" className="text-[10px] capitalize">
                  {c.status}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.length > 0 && <CommandSeparator />}

        {visibleNav.length > 0 && (
          <CommandGroup heading="Navigation">
            {visibleNav.map((entry) => (
              <CommandItem
                key={entry.href}
                value={`nav-${entry.label.toLowerCase()}`}
                onSelect={() => go(entry.href)}
              >
                <entry.icon className="mr-2 size-4 text-muted-foreground" />
                {entry.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
