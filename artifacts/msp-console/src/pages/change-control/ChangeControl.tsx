/**
 * Change Control (#2579) — the module page mounted into the Console Shell's
 * screen slot for the seven `cc.*` tenant pages. One page id per tab, kept in
 * sync with the tree/breadcrumb navigation the shell already owns — clicking
 * a tab here calls back up to the shell's own `navigate`, the same as clicking
 * the sidebar; this component holds no navigation state of its own.
 */
import type { DirectoryCustomer } from "@/api/console-api";
import { TabBar } from "./shared";
import {
  useChangeCatalog, useChangeRequests, useDependencies, useExecutions, usePirs, useCabMeetings,
  useFreezeWindows, useMaintenanceWindows, windowAppliesToTenant, filterByTenant, tenantKeyOf,
} from "./api";
import { Register } from "./Register";
import { Catalog } from "./Catalog";
import { Cab } from "./Cab";
import { Windows } from "./Windows";
import { Dependencies } from "./Dependencies";
import { Executions } from "./Executions";
import { Pirs } from "./Pirs";

export type ChangeControlTab = "cc.register" | "cc.catalog" | "cc.cab" | "cc.calendars" | "cc.deps" | "cc.exec" | "cc.pir";

export const CHANGE_CONTROL_TABS: readonly ChangeControlTab[] = ["cc.register", "cc.catalog", "cc.cab", "cc.calendars", "cc.deps", "cc.exec", "cc.pir"];

export function ChangeControl({
  tab, customer, onNavigateTab,
}: {
  tab: ChangeControlTab;
  customer: DirectoryCustomer | undefined;
  onNavigateTab: (tab: ChangeControlTab) => void;
}) {
  const tenantKey = tenantKeyOf(customer);
  // Counts for the tab bar — cheap: these queries are already cached by
  // whichever tab last rendered them (React Query dedupes by key), so
  // switching tabs never re-fetches what's still fresh.
  const crs = useChangeRequests();
  const catalog = useChangeCatalog();
  const cab = useCabMeetings();
  const deps = useDependencies(tenantKey);
  const exec = useExecutions();
  const pirs = usePirs();
  const freeze = useFreezeWindows();
  const maintenance = useMaintenanceWindows();
  const windowsCount =
    (freeze.data?.windows ?? []).filter((w) => windowAppliesToTenant(w, tenantKey)).length +
    (maintenance.data?.windows ?? []).filter((w) => windowAppliesToTenant(w, tenantKey)).length;

  const displayTabs = [
    { id: "cc.register", label: "Register", count: filterByTenant(crs.data ?? [], tenantKey).length },
    { id: "cc.catalog", label: "Standard catalog", count: catalog.data?.items.length ?? 0 },
    { id: "cc.cab", label: "Advisory board", count: cab.data?.meetings.length ?? 0 },
    { id: "cc.calendars", label: "Windows", count: windowsCount },
    { id: "cc.deps", label: "Dependencies", count: deps.data?.dependencies.length ?? 0 },
    { id: "cc.exec", label: "Executions", count: filterByTenant(exec.data?.executions ?? [], tenantKey).length },
    { id: "cc.pir", label: "Reviews", count: filterByTenant(pirs.data?.pirs ?? [], tenantKey).length },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <TabBar tabs={displayTabs} active={tab} onSelect={(id) => onNavigateTab(id as ChangeControlTab)} />
      {tab === "cc.register" && <Register customer={customer} onNavigateTab={(t) => onNavigateTab(t as ChangeControlTab)} />}
      {tab === "cc.catalog" && <Catalog />}
      {tab === "cc.cab" && <Cab />}
      {tab === "cc.calendars" && <Windows customer={customer} />}
      {tab === "cc.deps" && <Dependencies customer={customer} />}
      {tab === "cc.exec" && <Executions customer={customer} />}
      {tab === "cc.pir" && <Pirs customer={customer} />}
    </div>
  );
}
