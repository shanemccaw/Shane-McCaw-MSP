/**
 * CommandPalette — Cmd+K portal-wide search.
 *
 * Two distinct search targets share this one dialog shell (debounce, keyboard
 * nav, UI conventions), split by mspRole:
 *   - MSP staff (PlatformAdmin/MSPAdmin/MSPOperator): searches the MSP's own
 *     book of business via /api/msp/customers — UNCHANGED from before.
 *   - Customer-facing (CustomerUser/Assessment): searches the customer's own
 *     data (findings, documents, offers, marketplace) via the new
 *     /api/portal/customer/search endpoint, grouped by source.
 *
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
  AlertTriangle,
  Bell,
  Building2,
  CreditCard,
  FileText,
  Gift,
  History,
  LayoutDashboard,
  Loader2,
  Lock,
  Settings,
  Shield,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";

interface SearchCustomer {
  id: number;
  name: string;
  status: string;
  domain?: string;
}

type CustomerSearchResultType = "finding" | "document" | "offer" | "marketplace";

interface CustomerSearchResult {
  type: CustomerSearchResultType;
  id: string;
  title: string;
  description?: string;
  href: string;
  badge?: string;
}

const CUSTOMER_RESULT_ICON: Record<CustomerSearchResultType, React.ElementType> = {
  finding: AlertTriangle,
  document: FileText,
  offer: Gift,
  marketplace: Store,
};

const CUSTOMER_RESULT_HEADING: Record<CustomerSearchResultType, string> = {
  finding: "Findings",
  document: "Documents",
  offer: "Offers",
  marketplace: "Marketplace",
};

const CUSTOMER_NAV_ENTRIES: NavEntry[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/customer-dashboard", roles: ["CustomerUser"] },
  { icon: FileText, label: "Documents", href: "/customer-documents", roles: ["CustomerUser"] },
  { icon: AlertTriangle, label: "Diagnostics & Offers", href: "/customer-diagnostics", roles: ["CustomerUser"] },
  { icon: History, label: "Activity Timeline", href: "/customer-timeline", roles: ["CustomerUser"] },
  { icon: Gift, label: "My Offers", href: "/customer-offers", roles: ["CustomerUser"] },
  { icon: Store, label: "Marketplace", href: "/marketplace", roles: ["Assessment", "CustomerUser"] },
  { icon: ShieldCheck, label: "Service Levels", href: "/customer-sla", roles: ["CustomerUser"] },
  { icon: Users, label: "Team Members", href: "/customer-team", roles: ["CustomerUser"] },
  { icon: CreditCard, label: "Billing", href: "/customer-billing", roles: ["CustomerUser"] },
  { icon: Lock, label: "Privacy & Data", href: "/customer-privacy", roles: ["CustomerUser"] },
  { icon: Settings, label: "Settings", href: "/settings", roles: ["CustomerUser"] },
];

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
    roles: ["MSPAdmin", "CustomerUser"],
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
  const [staffResults, setStaffResults] = useState<SearchCustomer[]>([]);
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const mspRole = user?.mspRole;
  const isCustomerFacing = mspRole === "CustomerUser" || mspRole === "Assessment";
  const canSearchCustomers = ["PlatformAdmin", "MSPAdmin", "MSPOperator"].includes(
    mspRole ?? "",
  );

  function isNavVisible(entry: NavEntry) {
    if (!entry.roles || entry.roles.length === 0) return true;
    if (!mspRole) return false;
    return entry.roles.includes(mspRole);
  }

  const visibleNav = (isCustomerFacing ? CUSTOMER_NAV_ENTRIES : NAV_ENTRIES).filter(isNavVisible);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setStaffResults([]);
        setCustomerResults([]);
        return;
      }
      setLoading(true);
      try {
        if (isCustomerFacing) {
          const res = await fetchWithAuth(`/api/portal/customer/search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const data = (await res.json()) as { results: CustomerSearchResult[] };
            setCustomerResults(data.results ?? []);
          }
        } else {
          const res = await fetchWithAuth(
            `/api/msp/customers?search=${encodeURIComponent(q)}&limit=8`,
          );
          if (res.ok) {
            const data = (await res.json()) as { customers: SearchCustomer[] };
            setStaffResults(data.customers ?? []);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, isCustomerFacing],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setStaffResults([]);
      setCustomerResults([]);
      return;
    }
    const t = setTimeout(() => void search(query), 200);
    return () => clearTimeout(t);
  }, [open, query, search]);

  function go(href: string) {
    onOpenChange(false);
    navigate(href);
  }

  const resultsByType: Record<CustomerSearchResultType, CustomerSearchResult[]> = {
    finding: [],
    document: [],
    offer: [],
    marketplace: [],
  };
  for (const r of customerResults) resultsByType[r.type].push(r);

  const hasCustomerResults = customerResults.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={
          isCustomerFacing
            ? "Search findings, documents, offers…"
            : "Search customers, navigate pages…"
        }
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && query.trim() && staffResults.length === 0 && canSearchCustomers && (
          <CommandEmpty>No customers found.</CommandEmpty>
        )}

        {!loading && query.trim() && isCustomerFacing && !hasCustomerResults && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}

        {staffResults.length > 0 && canSearchCustomers && (
          <CommandGroup heading="Customers">
            {staffResults.map((c) => (
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

        {isCustomerFacing &&
          (Object.keys(resultsByType) as CustomerSearchResultType[]).map((type) => {
            const items = resultsByType[type];
            if (items.length === 0) return null;
            const Icon = CUSTOMER_RESULT_ICON[type];
            return (
              <CommandGroup key={type} heading={CUSTOMER_RESULT_HEADING[type]}>
                {items.map((r) => (
                  <CommandItem key={r.id} value={r.id} onSelect={() => go(r.href)}>
                    <Icon className="mr-2 size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{r.title}</span>
                    {r.badge && (
                      <Badge variant="outline" className="text-[10px] capitalize ml-2">
                        {r.badge}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}

        {(staffResults.length > 0 || hasCustomerResults) && <CommandSeparator />}

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
