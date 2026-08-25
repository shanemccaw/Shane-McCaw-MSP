/**
 * Retainer Hours screen (Git #1293).
 *
 * Where Shane logs consulting work against a customer's retainer — the real
 * source behind the customer-facing "My Architect" page (#1285). Two entry
 * paths feed one ledger: work logged automatically as a byproduct when a
 * tracked item is closed (change control / remediation tracker), and the
 * lightweight "log unscoped hours" action for ad-hoc work.
 *
 * Lives on the Money tab — retainer hours are billable delivery, i.e. money.
 */

import { Clock, Timer, Plus, Users } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem, GalleryRow, PeekModel } from "../../registry/types";
import { RetainerBody } from "./RetainerBody";
import {
  getSnapshot,
  selectCustomer,
  entryById,
  updateEntry,
  deleteEntry,
  totalUsedThisMonth,
  lowOnHoursCount,
} from "./retainerStore";

export const ROUTE = "/retainer";
const SCREEN_ID = "retainer";

// Display ⇄ stored vocabularies for the state cycle button.
const STATE_DISPLAY_ORDER = ["In progress", "Closed", "In review", "Scheduled"] as const;
const STATE_STORED: Record<string, string> = {
  "In progress": "in_progress",
  "Closed": "closed",
  "In review": "in_review",
  "Scheduled": "scheduled",
};
const PILLAR_ORDER = ["Health", "Compliance", "Governance", "Security", "Adoption"] as const;

function openScreenForCustomer(customerId: number): void {
  selectCustomer(customerId);
  getShellApi()?.navigate(ROUTE);
}

function customerGalleryRows(): GalleryRow[] {
  return getSnapshot().customers.map((c) => ({
    id: String(c.customerId),
    group: c.onRetainer ? "On retainer" : "Not on retainer",
    tile: c.onRetainer ? `${c.bucket.remainingHours}h` : "—",
    name: c.name,
    head: c.onRetainer ? `${c.bucket.usedHours} of ${c.bucket.retainedHours + c.bucket.rolledHours}h used` : "no retainer set",
    sub: c.architectName ?? (c.entryCount > 0 ? `${c.entryCount} logged` : "not configured"),
    onSelect: () => openScreenForCustomer(c.customerId),
  }));
}

registerScreen({
  id: SCREEN_ID,
  title: "Retainer Hours",
  area: "retainer",
  icon: Clock,
  route: ROUTE,
  render: () => <RetainerBody />,

  ribbon: [
    // Primary group on the Money tab.
    {
      tab: "money",
      order: 60,
      group: {
        label: "Retainer",
        large: [
          {
            label: "Retainer hours",
            icon: Clock,
            intent: "open",
            color: ACCENT.green,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            title: "Log and review consulting hours against each customer's retainer",
          },
        ],
        small: [
          {
            label: "Customers on retainer",
            icon: Users,
            intent: "open",
            onSelect: () => getShellApi()?.navigate(ROUTE),
            gallery: {
              id: "retainer-customers",
              title: "Customers on retainer",
              searchable: true,
              searchPlaceholder: "Search customers",
              get rows() { return customerGalleryRows(); },
              footer: { label: "Open the retainer screen", onSelect: () => getShellApi()?.navigate(ROUTE) },
            },
          },
          {
            label: "Log unscoped hours",
            icon: Plus,
            intent: "create",
            color: ACCENT.amber,
            onSelect: () => {
              getShellApi()?.navigate(ROUTE);
              window.dispatchEvent(new CustomEvent("retainer:new-unscoped"));
            },
            title: "Log ad-hoc hours not tied to a tracked item",
          },
        ],
      },
    },
    // Mirror the single most-reached action on Home, per SHELL.md.
    {
      tab: "home",
      order: 60,
      group: {
        label: "Retainer",
        large: [
          {
            label: "Retainer hours",
            icon: Clock,
            intent: "open",
            color: ACCENT.green,
            onSelect: () => getShellApi()?.navigate(ROUTE),
          },
        ],
      },
    },
  ],

  peeks: {
    // One line in the ledger. Editable straight through; delete arms in place.
    retainer: (id): PeekModel | null => {
      const entry = entryById(Number(id));
      if (!entry) return null;
      const detail = getSnapshot().detail;
      const customerId = detail?.customer.customerId;
      const sourceLabel =
        entry.source === "unscoped" ? "Ad-hoc (unscoped)"
        : entry.source === "change_control" ? "From change control"
        : "From remediation tracker";
      return {
        kind: "retainer",
        eyebrow: "RETAINER HOURS",
        title: entry.item,
        sub: `${detail?.customer.name ?? ""} · ${entry.week ?? entry.periodMonth}`,
        icon: Timer,
        tone: entry.pillarColor,
        tag: entry.state,
        tagTone: entry.stateStored === "closed" ? ACCENT.green : ACCENT.amber,
        facts: [
          { label: "Hours", value: String(entry.hours) },
          { label: "Pillar", value: entry.pillar ?? "—", prose: true },
          { label: "Finding", value: entry.finding ?? "—", prose: true },
          { label: "Source", value: sourceLabel, prose: true },
        ],
        edits: customerId
          ? [
              {
                key: "hours",
                label: "Hours",
                value: String(entry.hours),
                mono: true,
                onChange: (next) => {
                  const h = parseFloat(next);
                  if (Number.isFinite(h) && h >= 0) void updateEntry(customerId, entry.id, { hours: h });
                },
              },
              {
                key: "state",
                label: "Status",
                value: entry.state,
                options: [...STATE_DISPLAY_ORDER],
                onChange: (next) => void updateEntry(customerId, entry.id, { state: STATE_STORED[next] ?? "in_progress" }),
              },
              {
                key: "pillar",
                label: "Pillar",
                value: entry.pillar ?? "Health",
                options: [...PILLAR_ORDER],
                onChange: (next) => void updateEntry(customerId, entry.id, { pillar: next }),
              },
              {
                key: "finding",
                label: "Finding",
                value: entry.finding ?? "",
                mono: true,
                onChange: (next) => void updateEntry(customerId, entry.id, { finding: next.trim() || null }),
              },
              {
                key: "outcome",
                label: "Outcome",
                value: entry.outcome ?? "",
                area: true,
                onChange: (next) => void updateEntry(customerId, entry.id, { outcome: next }),
              },
            ]
          : undefined,
        actions: customerId
          ? [
              {
                label: "Delete",
                tone: "danger",
                confirm: true,
                onSelect: () => void deleteEntry(customerId, entry.id),
              },
            ]
          : undefined,
      };
    },
  },

  commands: () => {
    const snap = getSnapshot();
    const items: CommandItem[] = [];
    for (const c of snap.customers) {
      if (!c.onRetainer) continue;
      items.push({
        id: `rec:retainer-cust-${c.customerId}`,
        type: "record",
        kind: "customer",
        name: `${c.name} — retainer`,
        sub: `${c.bucket.usedHours} of ${c.bucket.retainedHours + c.bucket.rolledHours}h used · ${c.bucket.remainingHours}h left`,
        area: "retainer",
        run: () => openScreenForCustomer(c.customerId),
      });
    }
    if (snap.customersLoaded) {
      items.push({
        id: "ans:retainer-hours-this-month",
        type: "answer",
        kind: "answer",
        name: "Retainer hours logged this month",
        sub: "Across every customer on retainer",
        area: "retainer",
        live: String(totalUsedThisMonth()),
        run: () => getShellApi()?.navigate(ROUTE),
      });
      const low = lowOnHoursCount();
      if (low > 0) {
        items.push({
          id: "ans:retainer-low-on-hours",
          type: "answer",
          kind: "answer",
          name: "Customers out of retainer hours",
          sub: "Retained + rolled fully consumed this month",
          area: "retainer",
          live: String(low),
          run: () => getShellApi()?.navigate(ROUTE),
        });
      }
    }
    return items;
  },
});
