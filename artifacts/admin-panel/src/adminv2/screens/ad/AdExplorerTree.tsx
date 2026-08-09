/**
 * Active Directory — Explorer tree (the screen's `left` panel).
 *
 * OU=MSPs (every real MSP, expandable to its real nested Tenants, each
 * expandable to its real nested Users) + Groups (one node per RBAC role) +
 * OU=Placeholders (Phase 5's creatable/browsable stub), plus a universal
 * search box across all four. Mirrors `ActiveDirectoryTree.tsx`'s data model
 * and endpoints exactly (same `/admin/active-directory/tree` /`/search`
 * calls) — only the chrome changes, from the old panel's own tree widget to
 * this shell's `openDoc`-driven tab/trail model.
 *
 * Every row opens the record as a full doc tab via `openDoc`, never a peek —
 * SHELL.md limits "rows should openPeek, not navigate" to ribbon galleries;
 * this is the Explorer, the same as `EndpointTree` in SHELL.md's own example.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderCog,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LINE, SURFACE, TEXT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import { createAdOu, deleteAdOu, fetchAdTree, renameAdOu, searchAdDirectory } from "./adApi";
import { primeAdNameCacheFromTree } from "./adNameCache";
import type { AdSearchResult, AdTree, AdTreeCustomer, AdTreeMsp, AdTreeOu, DirectoryGroupRole } from "./adTypes";
import { AD_TREE_REFRESH_EVENT } from "./adEvents";

const SEARCH_DEBOUNCE_MS = 300;

const rowBase = (depth: number, on: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 24,
  padding: `0 8px 0 ${depth * 12 + 8}px`,
  cursor: "pointer",
  fontSize: 12,
  color: on ? "#fff" : TEXT.quiet,
  background: on ? "rgba(255,255,255,.1)" : "transparent",
  borderLeft: `2px solid ${on ? "#c8c6c4" : "transparent"}`,
});

const sectionRowStyle = (): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 25,
  padding: "0 8px",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: TEXT.dimmer,
});

export function AdExplorerTree() {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const activeDoc = shell.state.docs.find((d) => d.id === shell.state.activeDocId);
  const activeKind = activeDoc && activeDoc.kind !== "screen" ? activeDoc.kind : null;
  const activeId = activeDoc?.recordId;

  const [tree, setTree] = useState<AdTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [mspsOpen, setMspsOpen] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [ousOpen, setOusOpen] = useState(false);
  const [expandedMsp, setExpandedMsp] = useState<Set<number>>(new Set());
  const [expandedCustomer, setExpandedCustomer] = useState<Set<number>>(new Set());

  const loadTree = async () => {
    setLoading(true);
    try {
      const data = await fetchAdTree(fetchWithAuth);
      setTree(data);
      primeAdNameCacheFromTree(data);
    } catch {
      // Tree stays as it was on a transient failure — Refresh lets the operator retry.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => void loadTree();
    window.addEventListener(AD_TREE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(AD_TREE_REFRESH_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Universal search ────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const isSearching = query.trim().length > 0;
  const [results, setResults] = useState<AdSearchResult | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isSearching) {
      setResults(null);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        setResults(await searchAdDirectory(fetchWithAuth, query));
      } catch {
        // Leave previous results visible on a transient failure.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isSearching]);

  function open(kind: "msp" | "customer" | "user" | "group" | "ou", id: string | number, label: string) {
    shell.openDoc({ kind, id: String(id), screenId: "ad", label });
  }

  async function onCreateOu() {
    const name = window.prompt("New organizational unit name:");
    if (!name?.trim()) return;
    try {
      await createAdOu(fetchWithAuth, name.trim());
      await loadTree();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to create the OU.");
    }
  }
  async function onRenameOu(ou: AdTreeOu) {
    const name = window.prompt("Rename organizational unit:", ou.name);
    if (!name?.trim() || name.trim() === ou.name) return;
    try {
      await renameAdOu(fetchWithAuth, ou.id, name.trim());
      await loadTree();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to rename the OU.");
    }
  }
  async function onDeleteOu(ou: AdTreeOu) {
    if (!window.confirm(`Delete organizational unit "${ou.name}"?`)) return;
    try {
      await deleteAdOu(fetchWithAuth, ou.id);
      await loadTree();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete the OU.");
    }
  }

  const hasAnyMatch = useMemo(
    () =>
      !!results &&
      (results.msps.length > 0 || results.customers.length > 0 || results.users.length > 0 || results.roles.length > 0),
    [results],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: 12 }}>
      <div style={{ flex: "none", padding: "7px 8px", borderBottom: `1px solid ${LINE.base}` }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 8px",
            background: SURFACE.well,
            border: `1px solid ${LINE.control}`,
            borderRadius: 4,
          }}
        >
          <Search size={13} color={TEXT.label} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search MSPs, tenants, users, roles"
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: "inherit",
              fontSize: 12,
              color: TEXT.primary,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              title="Clear search"
              style={{ border: 0, background: "transparent", color: TEXT.label, cursor: "pointer", display: "flex" }}
            >
              <X size={12} />
            </button>
          )}
          <button
            onClick={() => void loadTree()}
            disabled={loading}
            title="Refresh directory"
            style={{ border: 0, background: "transparent", color: TEXT.label, cursor: "pointer", display: "flex" }}
          >
            <RefreshCw size={12} className={loading ? "av2-spin" : undefined} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isSearching ? (
          !results ? (
            <div style={{ padding: 14, fontSize: 11.5, color: TEXT.faint, fontStyle: "italic" }}>Searching…</div>
          ) : !hasAnyMatch ? (
            <div style={{ padding: 14, fontSize: 11.5, color: TEXT.faint }}>No matches for &ldquo;{query}&rdquo;.</div>
          ) : (
            <div>
              {results.msps.length > 0 && (
                <SearchGroup label="MSPs">
                  {results.msps.map((m) => (
                    <SearchRow key={`msp-${m.id}`} icon={<Building2 size={13} />} label={m.name} sub={m.slug} on={activeKind === "msp" && activeId === String(m.id)} onClick={() => open("msp", m.id, m.name)} />
                  ))}
                </SearchGroup>
              )}
              {results.customers.length > 0 && (
                <SearchGroup label="Tenants">
                  {results.customers.map((c) => (
                    <SearchRow key={`customer-${c.id}`} icon={<Users size={13} />} label={c.name} sub={c.mspName ?? undefined} on={activeKind === "customer" && activeId === String(c.id)} onClick={() => open("customer", c.id, c.name)} />
                  ))}
                </SearchGroup>
              )}
              {results.users.length > 0 && (
                <SearchGroup label="Users">
                  {results.users.map((u) => (
                    <SearchRow
                      key={`user-${u.id}`}
                      icon={<UserCircle size={13} />}
                      label={u.name || u.email}
                      sub={`${u.mspRole}${u.mspName ? ` · ${u.mspName}` : ""}`}
                      on={activeKind === "user" && activeId === String(u.id)}
                      onClick={() => open("user", u.id, u.name || u.email)}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.roles.length > 0 && (
                <SearchGroup label="Roles">
                  {results.roles.map((role) => (
                    <SearchRow key={`role-${role}`} icon={<ShieldCheck size={13} />} label={role} on={activeKind === "group" && activeId === role} onClick={() => open("group", role, role)} />
                  ))}
                </SearchGroup>
              )}
            </div>
          )
        ) : (
          <div>
            {/* OU=MSPs */}
            <div onClick={() => setMspsOpen((v) => !v)} style={sectionRowStyle()}>
              {mspsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Building2 size={13} />
              <span style={{ flex: 1 }}>OU=MSPs</span>
              <span style={{ fontSize: 9.5, color: TEXT.meta }}>{tree?.msps.length ?? 0}</span>
            </div>
            {mspsOpen && (
              <div>
                {!tree ? (
                  <AdEmptyLeaf label={loading ? "Loading…" : "No MSPs"} depth={2} />
                ) : (
                  tree.msps.map((msp) => (
                    <MspBranch
                      key={msp.id}
                      msp={msp}
                      expanded={expandedMsp.has(msp.id)}
                      onToggle={() =>
                        setExpandedMsp((prev) => {
                          const next = new Set(prev);
                          next.has(msp.id) ? next.delete(msp.id) : next.add(msp.id);
                          return next;
                        })
                      }
                      expandedCustomer={expandedCustomer}
                      onToggleCustomer={(id) =>
                        setExpandedCustomer((prev) => {
                          const next = new Set(prev);
                          next.has(id) ? next.delete(id) : next.add(id);
                          return next;
                        })
                      }
                      activeKind={activeKind}
                      activeId={activeId}
                      onOpen={open}
                    />
                  ))
                )}
              </div>
            )}

            {/* Groups */}
            <div onClick={() => setGroupsOpen((v) => !v)} style={sectionRowStyle()}>
              {groupsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <ShieldCheck size={13} />
              <span style={{ flex: 1 }}>Groups</span>
              <span style={{ fontSize: 9.5, color: TEXT.meta }}>{tree?.groups.length ?? 0}</span>
            </div>
            {groupsOpen && (
              <div>
                {(tree?.groups ?? []).map((g) => (
                  <div
                    key={g.role}
                    onClick={() => open("group", g.role, g.role)}
                    style={rowBase(2, activeKind === "group" && activeId === g.role)}
                  >
                    <ShieldCheck size={12} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.role}</span>
                    <span style={{ fontSize: 9.5, color: TEXT.meta }}>{g.count}</span>
                  </div>
                ))}
              </div>
            )}

            {/* OU=Placeholders */}
            <div style={sectionRowStyle()}>
              <span onClick={() => setOusOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                {ousOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <FolderCog size={13} />
                <span style={{ flex: 1 }}>OU=Placeholders</span>
              </span>
              <span style={{ fontSize: 9.5, color: TEXT.meta }}>{tree?.ous.length ?? 0}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void onCreateOu();
                }}
                title="New organizational unit"
                style={{ border: 0, background: "transparent", color: TEXT.dimmer, cursor: "pointer", display: "flex", marginLeft: 4 }}
              >
                <Plus size={12} />
              </button>
            </div>
            {ousOpen && (
              <div>
                {(tree?.ous ?? []).length === 0 ? (
                  <AdEmptyLeaf label={loading ? "Loading…" : "No OUs — click + to create one"} depth={2} />
                ) : (
                  tree!.ous.map((ou) => (
                    <div
                      key={ou.id}
                      className="av2-row"
                      onClick={() => open("ou", ou.id, ou.name)}
                      style={{ ...rowBase(2, activeKind === "ou" && activeId === String(ou.id)), fontFamily: "monospace" }}
                    >
                      <FolderCog size={12} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>OU={ou.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRenameOu(ou);
                        }}
                        title="Rename"
                        style={{ border: 0, background: "transparent", color: TEXT.faint, cursor: "pointer", display: "flex" }}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteOu(ou);
                        }}
                        title="Delete"
                        style={{ border: 0, background: "transparent", color: TEXT.faint, cursor: "pointer", display: "flex" }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MspBranch({
  msp,
  expanded,
  onToggle,
  expandedCustomer,
  onToggleCustomer,
  activeKind,
  activeId,
  onOpen,
}: {
  msp: AdTreeMsp;
  expanded: boolean;
  onToggle: () => void;
  expandedCustomer: Set<number>;
  onToggleCustomer: (id: number) => void;
  activeKind: string | null;
  activeId: string | undefined;
  onOpen: (kind: "msp" | "customer" | "user" | "group" | "ou", id: string | number, label: string) => void;
}) {
  return (
    <div>
      <div style={rowBase(1, activeKind === "msp" && activeId === String(msp.id))}>
        <span onClick={onToggle} style={{ display: "flex" }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          onClick={() => onOpen("msp", msp.id, msp.name)}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}
        >
          <Building2 size={13} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={msp.name}>
            {msp.name}
          </span>
        </span>
        <span style={{ fontSize: 9.5, color: TEXT.meta }}>{msp.customers.length}</span>
      </div>
      {expanded &&
        (msp.customers.length === 0 ? (
          <AdEmptyLeaf label="No tenants" depth={3} />
        ) : (
          msp.customers.map((customer) => (
            <CustomerBranch
              key={customer.id}
              customer={customer}
              expanded={expandedCustomer.has(customer.id)}
              onToggle={() => onToggleCustomer(customer.id)}
              activeKind={activeKind}
              activeId={activeId}
              onOpen={onOpen}
            />
          ))
        ))}
    </div>
  );
}

function CustomerBranch({
  customer,
  expanded,
  onToggle,
  activeKind,
  activeId,
  onOpen,
}: {
  customer: AdTreeCustomer;
  expanded: boolean;
  onToggle: () => void;
  activeKind: string | null;
  activeId: string | undefined;
  onOpen: (kind: "msp" | "customer" | "user" | "group" | "ou", id: string | number, label: string) => void;
}) {
  return (
    <div>
      <div style={rowBase(2, activeKind === "customer" && activeId === String(customer.id))}>
        <span onClick={onToggle} style={{ display: "flex" }}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span
          onClick={() => onOpen("customer", customer.id, customer.name)}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}
        >
          <Users size={12} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={customer.name}>
            {customer.name}
          </span>
        </span>
        <span style={{ fontSize: 9.5, color: TEXT.meta }}>{customer.users.length}</span>
      </div>
      {expanded &&
        (customer.users.length === 0 ? (
          <AdEmptyLeaf label="No users" depth={4} />
        ) : (
          customer.users.map((user) => (
            <div
              key={user.id}
              onClick={() => onOpen("user", user.id, user.name || user.email)}
              style={{ ...rowBase(4, activeKind === "user" && activeId === String(user.id)), opacity: user.isActive ? 1 : 0.6 }}
            >
              <UserCircle size={12} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={user.email}>
                {user.name || user.email}
              </span>
              <span style={{ fontSize: 9.5, color: TEXT.meta }}>{user.mspRole}</span>
            </div>
          ))
        ))}
    </div>
  );
}

function AdEmptyLeaf({ label, depth }: { label: string; depth: number }) {
  return (
    <div style={{ padding: `4px 8px 4px ${depth * 12 + 8}px`, fontSize: 11, fontStyle: "italic", color: TEXT.faint }}>
      {label}
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ height: 20, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: TEXT.faint }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function SearchRow({
  icon,
  label,
  sub,
  on,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={rowBase(2, on)}>
      {icon}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {sub && <span style={{ fontSize: 9.5, color: TEXT.meta, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{sub}</span>}
    </div>
  );
}

export type { DirectoryGroupRole };
