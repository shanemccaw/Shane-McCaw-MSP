// artifacts/admin-panel/src/components/ActiveDirectoryTree.tsx
//
// Phase 1 left tree for the Active Directory admin surface. Mirrors
// SimulatorLeftTree.tsx's conventions (Explorer header, search box, section
// expand/collapse persisted via a sibling *TreeState.ts helper, event-driven
// hand-off to the center canvas) rather than inventing a second IDE paradigm.
//
// OU=MSPs (every real MSP, expandable to its real nested customers — never a
// flat parallel Customers list) + Groups (one node per RBAC role). No
// top-level Users node — users are reached via the universal search box only,
// per the initiative's locked decision.

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Building2,
  Users,
  UserCircle,
  ShieldCheck,
  Search,
  X,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { readAdTreeState, writeAdTreeState } from "./activeDirectoryTreeState";

export interface AdCustomerSummary {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

export interface AdMspNode {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  customers: AdCustomerSummary[];
}

export interface AdGroupNode {
  role: string;
  count: number;
}

export interface AdSearchResults {
  msps: Array<{ id: number; name: string; slug: string }>;
  customers: Array<{ id: number; name: string; mspId: number; mspName: string | null }>;
  users: Array<{
    id: number;
    email: string;
    name: string | null;
    mspRole: string;
    mspName: string | null;
    customerName: string | null;
  }>;
  roles: string[];
}

export type AdSelectedType = "msp" | "customer" | "group" | "user";

export interface AdSelectedObject {
  type: AdSelectedType;
  id: number | string;
  label: string;
}

/** Custom event carrying the selected directory object to the center canvas. */
export const AD_SELECT_EVENT = "ad-select-object";

function dispatchSelect(detail: AdSelectedObject) {
  window.dispatchEvent(new CustomEvent<AdSelectedObject>(AD_SELECT_EVENT, { detail }));
}

const SEARCH_DEBOUNCE_MS = 300;

export function ActiveDirectoryTree() {
  const { fetchWithAuth } = useAuth();

  const [msps, setMsps] = useState<AdMspNode[]>([]);
  const [groups, setGroups] = useState<AdGroupNode[]>([]);
  const [loading, setLoading] = useState(false);

  const initialTreeState = useMemo(() => readAdTreeState(), []);
  const [mspsOpen, setMspsOpen] = useState(initialTreeState.mspsOpen);
  const [groupsOpen, setGroupsOpen] = useState(initialTreeState.groupsOpen);
  const [expandedMspIds, setExpandedMspIds] = useState<Set<number>>(
    () => new Set(initialTreeState.expandedMspIds),
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    writeAdTreeState({ mspsOpen, groupsOpen, expandedMspIds: [...expandedMspIds] });
  }, [mspsOpen, groupsOpen, expandedMspIds]);

  const loadTree = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/active-directory/tree");
      if (res.ok) {
        const data = (await res.json()) as { msps: AdMspNode[]; groups: AdGroupNode[] };
        setMsps(data.msps || []);
        setGroups(data.groups || []);
      }
    } catch {
      // Left tree stays empty on a transient failure — the explorer's own
      // refresh button lets the operator retry without reloading the page.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTree();
  }, [fetchWithAuth]);

  const toggleMspExpanded = (mspId: number) => {
    setExpandedMspIds((prev) => {
      const next = new Set(prev);
      if (next.has(mspId)) next.delete(mspId);
      else next.add(mspId);
      return next;
    });
  };

  const selectMsp = (msp: AdMspNode) => {
    setSelectedKey(`msp-${msp.id}`);
    dispatchSelect({ type: "msp", id: msp.id, label: msp.name });
  };
  const selectCustomer = (customer: AdCustomerSummary) => {
    setSelectedKey(`customer-${customer.id}`);
    dispatchSelect({ type: "customer", id: customer.id, label: customer.name });
  };
  const selectGroup = (group: AdGroupNode) => {
    setSelectedKey(`group-${group.role}`);
    dispatchSelect({ type: "group", id: group.role, label: group.role });
  };
  const selectUser = (user: AdSearchResults["users"][number]) => {
    setSelectedKey(`user-${user.id}`);
    dispatchSelect({ type: "user", id: user.id, label: user.name || user.email });
  };

  // ─── Universal search ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const isSearching = searchQuery.trim().length > 0;
  const [searchResults, setSearchResults] = useState<AdSearchResults | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!isSearching) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/active-directory/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          setSearchResults((await res.json()) as AdSearchResults);
        }
      } catch {
        // Leave the previous results visible on a transient search failure.
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchQuery, isSearching, fetchWithAuth]);

  const hasAnySearchMatch =
    !!searchResults &&
    (searchResults.msps.length > 0 ||
      searchResults.customers.length > 0 ||
      searchResults.users.length > 0 ||
      searchResults.roles.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs select-none">
      {/* Explorer header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Active Directory
        </span>
        <button
          onClick={() => void loadTree()}
          disabled={loading}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Refresh directory"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Universal search box — one query across MSP/customer/user/role */}
      <div className="shrink-0 border-b border-border bg-card/50 px-2 py-1.5">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search MSPs, customers, users, roles..."
            className="w-full rounded border border-border bg-background py-1 pl-7 pr-6 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto py-1">
        {isSearching ? (
          searching && !searchResults ? (
            <div className="px-4 py-3 text-[11px] italic text-muted-foreground/70">Searching…</div>
          ) : !hasAnySearchMatch ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
              <Search className="mb-2 h-6 w-6 opacity-40" />
              <p className="text-xs font-medium text-foreground/80">No results found</p>
              <p className="mt-0.5 text-[10px]">No MSPs, customers, users, or roles match "{searchQuery}"</p>
            </div>
          ) : (
            <div>
              {searchResults!.msps.length > 0 && (
                <SearchGroup label="MSPs">
                  {searchResults!.msps.map((m) => (
                    <SearchRow
                      key={`msp-${m.id}`}
                      icon={<Building2 className="h-3.5 w-3.5 text-primary" />}
                      label={m.name}
                      sublabel={m.slug}
                      selected={selectedKey === `msp-${m.id}`}
                      onClick={() => {
                        setSelectedKey(`msp-${m.id}`);
                        dispatchSelect({ type: "msp", id: m.id, label: m.name });
                      }}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults!.customers.length > 0 && (
                <SearchGroup label="Customers">
                  {searchResults!.customers.map((c) => (
                    <SearchRow
                      key={`customer-${c.id}`}
                      icon={<Users className="h-3.5 w-3.5 text-primary" />}
                      label={c.name}
                      sublabel={c.mspName ?? undefined}
                      selected={selectedKey === `customer-${c.id}`}
                      onClick={() => {
                        setSelectedKey(`customer-${c.id}`);
                        dispatchSelect({ type: "customer", id: c.id, label: c.name });
                      }}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults!.users.length > 0 && (
                <SearchGroup label="Users">
                  {searchResults!.users.map((u) => (
                    <SearchRow
                      key={`user-${u.id}`}
                      icon={<UserCircle className="h-3.5 w-3.5 text-primary" />}
                      label={u.name || u.email}
                      sublabel={`${u.mspRole}${u.mspName ? ` · ${u.mspName}` : ""}`}
                      selected={selectedKey === `user-${u.id}`}
                      onClick={() => selectUser(u)}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults!.roles.length > 0 && (
                <SearchGroup label="Roles">
                  {searchResults!.roles.map((role) => (
                    <SearchRow
                      key={`role-${role}`}
                      icon={<ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                      label={role}
                      selected={selectedKey === `group-${role}`}
                      onClick={() => {
                        setSelectedKey(`group-${role}`);
                        dispatchSelect({ type: "group", id: role, label: role });
                      }}
                    />
                  ))}
                </SearchGroup>
              )}
            </div>
          )
        ) : (
          <div>
            {/* OU=MSPs */}
            <div>
              <div
                onClick={() => setMspsOpen(!mspsOpen)}
                className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
              >
                {mspsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">OU=MSPs</span>
                <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">{msps.length}</span>
              </div>

              {mspsOpen && (
                <div className="ml-[22px] border-l border-accent">
                  {msps.length === 0 ? (
                    <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">
                      {loading ? "Loading…" : "No MSPs found"}
                    </div>
                  ) : (
                    msps.map((msp) => {
                      const expanded = expandedMspIds.has(msp.id);
                      return (
                        <div key={msp.id}>
                          <div className="group flex h-[22px] items-center gap-1 pl-2 pr-2 text-foreground/85 transition-colors hover:bg-accent hover:text-foreground">
                            <button
                              onClick={() => toggleMspExpanded(msp.id)}
                              className="flex h-full items-center"
                              title={expanded ? "Collapse" : "Expand"}
                            >
                              {expanded ? (
                                <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                              )}
                            </button>
                            <div
                              onClick={() => selectMsp(msp)}
                              className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 ${
                                selectedKey === `msp-${msp.id}` ? "text-primary font-semibold" : ""
                              }`}
                            >
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                              <span className="truncate" title={msp.name}>
                                {msp.name}
                              </span>
                            </div>
                            <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/60">
                              {msp.customers.length}
                            </span>
                          </div>

                          {expanded && (
                            <div className="ml-[18px] border-l border-accent/60">
                              {msp.customers.length === 0 ? (
                                <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">
                                  No customers
                                </div>
                              ) : (
                                msp.customers.map((customer) => (
                                  <div
                                    key={customer.id}
                                    onClick={() => selectCustomer(customer)}
                                    className={`flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                                      selectedKey === `customer-${customer.id}`
                                        ? "text-primary font-semibold"
                                        : "text-foreground/85"
                                    }`}
                                  >
                                    <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    <span className="truncate" title={customer.name}>
                                      {customer.name}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Groups (RBAC roles) */}
            <div>
              <div
                onClick={() => setGroupsOpen(!groupsOpen)}
                className="flex h-[22px] cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80 hover:bg-accent"
              >
                {groupsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">Groups</span>
                <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/60">{groups.length}</span>
              </div>

              {groupsOpen && (
                <div className="ml-[22px] border-l border-accent">
                  {groups.length === 0 ? (
                    <div className="px-4 py-1 text-[11px] italic text-muted-foreground/70">
                      {loading ? "Loading…" : "No groups found"}
                    </div>
                  ) : (
                    groups.map((group) => (
                      <div
                        key={group.role}
                        onClick={() => selectGroup(group)}
                        className={`flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
                          selectedKey === `group-${group.role}` ? "text-primary font-semibold" : "text-foreground/85"
                        }`}
                      >
                        <ShieldCheck className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{group.role}</span>
                        <span className="text-[9px] tabular-nums text-muted-foreground/60">{group.count}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex h-[20px] items-center px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SearchRow({
  icon,
  label,
  sublabel,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex h-[24px] cursor-pointer items-center gap-1.5 pl-4 pr-2 transition-colors hover:bg-accent hover:text-foreground ${
        selected ? "text-primary font-semibold" : "text-foreground/85"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {sublabel && <span className="ml-auto shrink-0 truncate text-[9px] text-muted-foreground/60">{sublabel}</span>}
    </div>
  );
}
