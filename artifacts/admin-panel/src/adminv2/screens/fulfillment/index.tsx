/**
 * Fulfillment — everything sold that requires delivery, across every MSP and
 * customer (`fulfillment_queue`), plus the lifecycle-kind registry
 * (`fulfillment_types`) that decides what fires when. Rebuilds the old
 * `pages/FulfillmentQueue.tsx` / `pages/FulfillmentTypes.tsx` pair inside
 * `SHELL.md`'s `registerScreen` contract — no new backend, both routers
 * (`admin-fulfillment.ts`, `admin-fulfillment-types.ts`) already existed and
 * were already mounted.
 *
 * ## Intent audit (`SHELL.md` section 1)
 *
 * The Home tab only opens the queue/registry galleries, creates a type, or
 * syncs across every source (`global`). The Watch tab only opens the
 * overdue/blocked galleries. Everything that needs one specific delivery or
 * type open — advancing its status, activating/deactivating a type — is on
 * the contextual tab, split by `ctx.kind` the same way `screens/ad/` splits
 * MSP/tenant/user/group tools on one screen.
 *
 * ## What is deliberately not here
 *
 * - **Deleting a delivery.** `admin-fulfillment.ts` exposes no delete route
 *   — a delivery obligation is a record of a real sale, not a draft.
 * - **File-based import/export** for the type registry. See
 *   `FulfillmentTypesPanel.tsx`'s doc comment for why.
 * - **Deep links out to the delivery's source record** (project/presentation/
 *   invoice). Those record kinds don't exist in this shell yet — see
 *   `FulfillmentProperties.tsx`, which states the ids as plain facts instead
 *   of guessing at a route into the old admin panel.
 */

import { useEffect } from "react";
import { AlertTriangle, Plus, RefreshCw, Tags, Truck, XCircle, Zap } from "lucide-react";
import { ACCENT, ACCENT_TEXT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GallerySpec, PeekModel } from "../../registry/types";
import { FulfillmentBody } from "./FulfillmentBody";
import { FulfillmentExplorer } from "./FulfillmentExplorer";
import { FulfillmentProperties } from "./FulfillmentProperties";
import { FulfillmentTypesPanel } from "./FulfillmentTypesPanel";
import {
  createTypeInteractive,
  deliveryById,
  getSnapshot,
  patchType,
  RIBBON_KEYS,
  refreshAll,
  removeType,
  selectItem,
  selectType,
  setDeliveryStatus,
  setStatusNote,
  syncFromPurchases,
  typeByKey,
} from "./fulfillmentStore";
import {
  compactUsd,
  DELIVERY_STATUSES,
  firedWhenLabel,
  nextStatus,
  slaNote,
  SOURCE_LABEL,
  STATUS_LABEL,
  usd,
  type FiredWhen,
} from "./fulfillmentTypes";

const AREA = "fulfillment";
const ROUTE = "/fulfillment";

function go() {
  return () => getShellApi()?.navigate(ROUTE);
}

function openDeliveryPeek(id: number) {
  return () => getShellApi()?.openPeek("delivery", String(id));
}

function openTypePeek(key: string) {
  return () => getShellApi()?.openPeek("fulfillmentType", key);
}

function newType(): void {
  void createTypeInteractive().then((created) => {
    if (created) getShellApi()?.openPeek("fulfillmentType", created.key);
  });
}

// ── Galleries ────────────────────────────────────────────────────────────────
// `rows` is a getter — a screen's `ribbon` array is built once at module
// load, so a plain array would be frozen empty forever. Same shape
// `packages/index.tsx`'s galleries use.

const queueGallery: GallerySpec = {
  id: "fulfillment-queue",
  title: "Fulfillment queue",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    const state = getSnapshot();
    return state.items.map((item) => ({
      id: String(item.id),
      group: STATUS_LABEL[item.deliveryStatus],
      tile: compactUsd(item.purchaseAmountCents),
      name: item.itemTitle,
      head: item.deliveryStatus === "blocked" ? "blocked" : item.isOverdue ? "overdue" : SOURCE_LABEL[item.sourceType],
      sub: `${item.clientName ?? item.mspName ?? item.customerName ?? "Unassigned"} — ${slaNote(item)}`,
      on: state.openItemId === item.id,
      onSelect: openDeliveryPeek(item.id),
    }));
  },
  footer: { label: "Sync from purchases", onSelect: () => void syncFromPurchases() },
};

const overdueGallery: GallerySpec = {
  id: "fulfillment-overdue",
  title: "Overdue deliveries",
  get rows() {
    const state = getSnapshot();
    return state.overdueRows.map((item) => ({
      id: String(item.id),
      tile: compactUsd(item.purchaseAmountCents),
      name: item.itemTitle,
      head: slaNote(item),
      sub: `${item.clientName ?? item.mspName ?? "Unassigned"} — ${STATUS_LABEL[item.deliveryStatus]}`,
      onSelect: openDeliveryPeek(item.id),
    }));
  },
  footer: { label: "Open the queue", onSelect: go() },
};

const blockedGallery: GallerySpec = {
  id: "fulfillment-blocked",
  title: "Blocked deliveries",
  get rows() {
    const state = getSnapshot();
    return state.blockedRows.map((item) => ({
      id: String(item.id),
      tile: compactUsd(item.purchaseAmountCents),
      name: item.itemTitle,
      head: item.statusNote ? "has a note" : "no note",
      sub: `${item.clientName ?? item.mspName ?? "Unassigned"} — ${slaNote(item)}`,
      onSelect: openDeliveryPeek(item.id),
    }));
  },
  footer: { label: "Open the queue", onSelect: go() },
};

const typesGallery: GallerySpec = {
  id: "fulfillment-types",
  title: "Fulfillment types",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    const state = getSnapshot();
    return state.types.map((t) => ({
      id: t.key,
      group: t.isActive ? "Active" : "Inactive",
      tile: t.recurring ? "REC" : "1×",
      name: t.label,
      head: t.recurring ? "recurring" : "one-time",
      sub: `fulfillment.${t.key} — fires on ${firedWhenLabel(t.firedWhen)}`,
      on: state.openTypeKey === t.key,
      onSelect: openTypePeek(t.key),
    }));
  },
  footer: { label: "New fulfillment type", onSelect: newType },
};

// ── Peeks ────────────────────────────────────────────────────────────────────

function deliveryPeek(id: string): PeekModel | null {
  const item = deliveryById(id);
  if (!item) return null;

  const tone = item.deliveryStatus === "blocked" ? ACCENT.danger : item.isOverdue ? ACCENT.amber : ACCENT.info;

  return {
    kind: "delivery",
    eyebrow: "DELIVERY",
    title: item.itemTitle,
    sub: `${SOURCE_LABEL[item.sourceType]} · ${item.clientName ?? item.clientEmail ?? item.mspName ?? "unassigned"}`,
    icon: Truck,
    tone,
    tag: STATUS_LABEL[item.deliveryStatus],
    tagTone: tone,
    facts: [
      { label: "Amount", value: usd(item.purchaseAmountCents) },
      { label: "SLA", value: slaNote(item), color: item.isOverdue && item.deliveryStatus !== "delivered" ? ACCENT.amber : undefined },
    ],
    edits: [
      {
        key: "deliveryStatus",
        label: "Status",
        value: item.deliveryStatus,
        options: [...DELIVERY_STATUSES],
        onChange: (v) => void setDeliveryStatus(item.id, v as (typeof DELIVERY_STATUSES)[number]),
      },
      { key: "statusNote", label: "Note", value: item.statusNote ?? "", area: true, onChange: (v) => void setStatusNote(item.id, v) },
    ],
    body: item.itemDescription ? { title: "Description", content: item.itemDescription } : undefined,
    open: () => getShellApi()?.openDoc({ kind: "delivery", id, screenId: "fulfillment" }),
    openLabel: "Open it properly",
    actions: [
      {
        label: `Mark ${STATUS_LABEL[nextStatus(item.deliveryStatus)].toLowerCase()}`,
        tone: "primary",
        onSelect: () => void setDeliveryStatus(item.id, nextStatus(item.deliveryStatus)),
      },
    ],
  };
}

function fulfillmentTypePeek(key: string): PeekModel | null {
  const type = typeByKey(key);
  if (!type) return null;

  return {
    kind: "fulfillmentType",
    eyebrow: "FULFILLMENT TYPE",
    title: type.label,
    sub: `fulfillment.${type.key}`,
    icon: Tags,
    tone: type.isActive ? ACCENT.info : undefined,
    tag: type.recurring ? "recurring" : "one-time",
    tagTone: type.recurring ? ACCENT.info : undefined,
    facts: [
      { label: "Fires on", value: firedWhenLabel(type.firedWhen), prose: true },
      { label: "Status", value: type.isActive ? "active" : "inactive", color: type.isActive ? ACCENT_TEXT.green : ACCENT.amber },
    ],
    edits: [
      { key: "label", label: "Name", value: type.label, onChange: (v) => void patchType(type.key, { label: v }) },
      { key: "description", label: "Description", value: type.description ?? "", area: true, onChange: (v) => void patchType(type.key, { description: v }) },
      {
        key: "firedWhen",
        label: "Fires on",
        value: type.firedWhen.join(", "),
        mono: true,
        onChange: (v) =>
          void patchType(type.key, { firedWhen: v.split(",").map((s) => s.trim()).filter(Boolean) as FiredWhen[] }),
      },
      {
        key: "recurring",
        label: "Billing",
        value: type.recurring ? "recurring" : "one-time",
        options: ["one-time", "recurring"],
        onChange: (v) => void patchType(type.key, { recurring: v === "recurring" }),
      },
      {
        key: "isActive",
        label: "Status",
        value: type.isActive ? "active" : "inactive",
        options: ["active", "inactive"],
        onChange: (v) => void patchType(type.key, { isActive: v === "active" }),
      },
    ],
    open: () => getShellApi()?.openDoc({ kind: "fulfillmentType", id: key, screenId: "fulfillment" }),
    openLabel: "Open it properly — test resolve it here",
    actions: [{ label: "Delete", tone: "danger", confirm: true, onSelect: () => void removeType(type.key) }],
  };
}

// ── The screen ───────────────────────────────────────────────────────────────

/**
 * Keeps the open doc and the store's two independent selections in step —
 * same reasoning as `screens/ad/`'s multi-kind render: `ctx.kind`
 * disambiguates which of this screen's two record kinds (if either) is open.
 */
function FulfillmentScreen({ kind, recordId }: { kind?: string; recordId?: string }) {
  useEffect(() => {
    if (kind === "delivery" && recordId) {
      selectItem(Number(recordId));
      selectType(null);
    } else if (kind === "fulfillmentType" && recordId) {
      selectType(recordId);
      selectItem(null);
    } else {
      selectItem(null);
      selectType(null);
    }
  }, [kind, recordId]);
  return <FulfillmentBody />;
}

registerScreen({
  id: "fulfillment",
  title: "Fulfillment",
  area: AREA,
  icon: Truck,
  route: ROUTE,
  render: (ctx) => <FulfillmentScreen kind={ctx.kind} recordId={ctx.recordId} />,

  left: { title: "Queue", render: () => <FulfillmentExplorer /> },
  right: { title: "Fulfillment", render: () => <FulfillmentProperties /> },
  bottom: [{ id: "types", label: "Fulfillment Types", render: () => <FulfillmentTypesPanel /> }],

  ribbon: [
    {
      tab: "automation",
      order: 40,
      group: {
        label: "Fulfillment",
        large: [
          {
            label: "Queue",
            icon: Truck,
            intent: "open",
            title: "Everything sold that requires delivery, across every MSP and customer",
            liveKey: RIBBON_KEYS.queueTotal,
            onSelect: go(),
            gallery: queueGallery,
          },
        ],
        small: [
          { label: "Sync from purchases", icon: RefreshCw, intent: "global", onSelect: () => void syncFromPurchases() },
          { label: "New type", icon: Plus, intent: "create", onSelect: newType },
          {
            label: "Types",
            icon: Tags,
            intent: "open",
            liveKey: RIBBON_KEYS.typesCount,
            onSelect: go(),
            gallery: typesGallery,
          },
        ],
      },
    },
    {
      tab: "watch",
      order: 20,
      group: {
        label: "Needs a decision",
        small: [
          {
            label: "Overdue deliveries",
            icon: AlertTriangle,
            intent: "open",
            color: ACCENT.amber,
            title: "Past its SLA due date and not yet delivered",
            liveKey: RIBBON_KEYS.overdueWatch,
            onSelect: go(),
            gallery: overdueGallery,
          },
        ],
      },
    },
    {
      tab: "watch",
      order: 40,
      group: {
        label: "Broken",
        small: [
          {
            label: "Blocked deliveries",
            icon: XCircle,
            intent: "open",
            color: ACCENT.danger,
            liveKey: RIBBON_KEYS.blockedWatch,
            onSelect: go(),
            gallery: blockedGallery,
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    if (ctx.kind === "delivery" && ctx.recordId) {
      const id = Number(ctx.recordId);
      const item = deliveryById(id);
      if (!item) return null;
      return {
        id: "delivery-tools",
        label: "Delivery Tools",
        groups: [
          {
            label: "This delivery",
            large: [
              {
                label: `Mark ${STATUS_LABEL[nextStatus(item.deliveryStatus)].toLowerCase()}`,
                icon: Truck,
                intent: "record",
                color: ACCENT_TEXT.green,
                onSelect: () => void setDeliveryStatus(item.id, nextStatus(item.deliveryStatus)),
              },
            ],
            small: [
              { label: "Mark blocked", icon: XCircle, intent: "record", color: ACCENT.danger, onSelect: () => void setDeliveryStatus(item.id, "blocked") },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "fulfillmentType" && ctx.recordId) {
      const type = typeByKey(ctx.recordId);
      if (!type) return null;
      return {
        id: "fulfillment-type-tools",
        label: "Fulfillment Type Tools",
        groups: [
          {
            label: "This type",
            small: [
              {
                label: type.isActive ? "Deactivate" : "Activate",
                icon: Zap,
                intent: "record",
                color: type.isActive ? ACCENT.amber : ACCENT_TEXT.green,
                onSelect: () => void patchType(type.key, { isActive: !type.isActive }),
              },
            ],
          },
        ],
      };
    }

    return null;
  },

  peeks: {
    delivery: deliveryPeek,
    fulfillmentType: fulfillmentTypePeek,
  },

  commands: () => {
    const state = getSnapshot();
    const items: CommandItem[] = [
      { id: "act:fulfillment-sync", type: "action", kind: "run", name: "Sync from purchases", sub: "Pulls newly-sold offers, SOWs and bundles into the queue", area: AREA, run: () => void syncFromPurchases() },
      { id: "act:fulfillment-new-type", type: "action", kind: "run", name: "New fulfillment type", sub: "Registers a new fulfillment.<key> workflow trigger", area: AREA, run: newType },
      { id: "act:fulfillment-refresh", type: "action", kind: "run", name: "Refresh the fulfillment queue", sub: "Re-reads the queue, SLA thresholds and the type registry", area: AREA, run: () => void refreshAll() },
    ];

    for (const item of state.items) {
      items.push({
        id: `rec:delivery-${item.id}`,
        type: "record",
        kind: "delivery",
        name: item.itemTitle,
        sub: `${STATUS_LABEL[item.deliveryStatus]} · ${usd(item.purchaseAmountCents)}`,
        tag: item.isOverdue && item.deliveryStatus !== "delivered" ? "overdue" : undefined,
        area: AREA,
        run: openDeliveryPeek(item.id),
      });
    }

    for (const type of state.types) {
      items.push({
        id: `rec:fulfillment-type-${type.key}`,
        type: "record",
        kind: "fulfillmentType",
        name: type.label,
        sub: `fulfillment.${type.key} — fires on ${firedWhenLabel(type.firedWhen)}`,
        tag: type.isActive ? undefined : "inactive",
        area: AREA,
        run: openTypePeek(type.key),
      });
    }

    if (state.summary) {
      items.push({
        id: "ans:fulfillment-overdue",
        type: "answer",
        name: "Overdue deliveries",
        sub: "Past its SLA due date and not yet delivered",
        area: AREA,
        live: String(state.summary.overdue),
        run: go(),
      });
      items.push({
        id: "ans:fulfillment-total",
        type: "answer",
        name: "Fulfillment queue size",
        sub: "Everything sold that requires delivery",
        area: AREA,
        live: String(state.summary.total),
        run: go(),
      });
    }

    return items;
  },
});
