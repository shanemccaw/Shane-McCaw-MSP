/**
 * Services — the Products Catalog `CLAUDE.md`'s no-hardcoding rule points at
 * (`services`, reached through `admin-services.ts`; see `servicesTypes.ts`'s
 * doc comment for the full picture and what this screen deliberately does not
 * rebuild — the eight per-type field editors).
 *
 * `SHELL.md` section 1 names Services as one of the six screens the fixed-tab
 * audit stripped ("Endpoints, Money, SQL, Documents, Services and Marketing
 * all had per-record actions on their fixed tabs and were stripped"), so
 * every record-scoped action here — Edit fields, Duplicate, Generate PDF —
 * lives on the contextual tab, never on Home or Watch. `registerScreen` would
 * throw otherwise.
 */

import { FileText, Package, Pencil, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { ServicesBody } from "./ServicesBody";
import { ServiceExplorer } from "./ServiceExplorer";
import { ServiceProperties } from "./ServiceProperties";
import {
  createServiceInteractive,
  duplicateService,
  exportCatalogToClipboard,
  generatePdf,
  getSnapshot,
  openEditor,
  refreshCatalog,
  removeService,
  selectService,
  serviceById,
  unpricedServices,
  updateServiceField,
  WATCH_UNPRICED_KEY,
} from "./servicesStore";
import { BILLING_LABEL, effectivePriceCents, hasNoPrice, topCategory, usd, VISIBILITY_LABEL } from "./servicesTypes";

function openService(id: string): void {
  getShellApi()?.openDoc({ kind: "service", id, screenId: "services" });
}

/** `SHELL.md` section 5: "Rows carry real data, not labels" — tile is the price, detail is billing + visibility. */
function serviceRows(): GalleryRow[] {
  const state = getSnapshot();
  return state.services.map((s) => ({
    id: String(s.id),
    group: topCategory(s),
    tile: usd(effectivePriceCents(s)).replace("$", ""),
    name: s.name,
    head: BILLING_LABEL[s.billingType],
    sub: `${VISIBILITY_LABEL[s.visibility]}${hasNoPrice(s) ? " · no real price" : ""}`,
    on: state.openId === String(s.id),
    onSelect: () => getShellApi()?.openPeek("service", String(s.id)),
  }));
}

function unpricedRows(): GalleryRow[] {
  return unpricedServices().map((s) => ({
    id: String(s.id),
    group: topCategory(s),
    tile: "$0",
    name: s.name,
    sub: "Public, and nobody can check out with it.",
    onSelect: () => getShellApi()?.openPeek("service", String(s.id)),
  }));
}

registerScreen({
  id: "services",
  title: "Services",
  area: "services",
  icon: Package,
  route: "/services",

  render: (ctx) => {
    // Mirrors `screens/endpoints/index.tsx`'s adoption of `ctx.recordId` —
    // opening a service from a peek, the palette or a gallery row routes here
    // with the service id as `recordId`; adopting it into the store is what
    // lets `ServiceProperties`/`ServicesBody` (no ctx of their own — see
    // `openId`'s doc comment in `servicesStore.ts`) know which record is open.
    selectService(ctx.recordId ?? null);
    return <ServicesBody />;
  },

  ribbon: [
    {
      tab: "catalog",
      order: 30,
      group: {
        label: "Services",
        large: [
          {
            label: "All services",
            icon: Package,
            intent: "open",
            onSelect: () => getShellApi()?.navigate("/services"),
            title: "Everything Shane McCaw Consulting sells",
          },
        ],
        small: [
          {
            label: "Browse them",
            icon: Search,
            intent: "open",
            onSelect: () => {},
            gallery: {
              id: "services",
              title: "Services",
              searchable: true,
              searchPlaceholder: "Type part of a name",
              rows: serviceRows(),
            },
          },
          {
            label: "New service",
            icon: Plus,
            intent: "create",
            onSelect: () => {
              void createServiceInteractive().then((created) => {
                if (created) openService(String(created.id));
              });
            },
          },
          {
            label: "Reload the catalog",
            icon: RefreshCw,
            intent: "global",
            onSelect: () => void refreshCatalog(),
            title: "Re-read every product from the database",
          },
        ],
      },
    },
    {
      tab: "watch",
      order: 30,
      group: {
        label: "Gaps & cleanup",
        small: [
          {
            label: "Services with no price set",
            icon: TriangleAlert,
            intent: "open",
            color: ACCENT.amber,
            // SHELL.md's exception to "no badge counts": a public catalog
            // entry with no real price is configured, visible to a client,
            // and cannot be bought. Carried through `liveKey`, not `live` —
            // see `servicesStore.ts`'s `WATCH_UNPRICED_KEY` doc comment for
            // why a plain `live: unpricedServices().length` here would freeze
            // at 0 forever.
            liveKey: WATCH_UNPRICED_KEY,
            onSelect: () => getShellApi()?.navigate("/services"),
            gallery: {
              id: "services-unpriced",
              title: "No price set",
              searchable: true,
              searchPlaceholder: "Type part of a name",
              rows: unpricedRows(),
            },
            title: "Public services with no real price — visible, and unbuyable",
          },
        ],
      },
    },
  ],

  /**
   * Service Tools. The Back group is spliced in at position 2 by the shell —
   * do not add one here (`SHELL.md` section 2).
   */
  contextualTab: (ctx) => {
    if (!ctx.recordId) return null;
    const id = Number(ctx.recordId);

    return {
      id: "service-tools",
      label: "Service Tools",
      groups: [
        {
          label: "Edit",
          large: [
            {
              label: "Edit fields",
              icon: Pencil,
              intent: "record",
              color: ACCENT.info,
              onSelect: () => openEditor(id),
              title: "Description, category, deliverables, classification and per-type settings",
            },
          ],
          small: [
            { label: "Duplicate", icon: Package, intent: "record", onSelect: () => void duplicateService(id), title: "A private copy, ready to review before it goes public" },
          ],
        },
        {
          label: "Overview PDF",
          small: [
            { label: "Generate PDF", icon: FileText, intent: "record", onSelect: () => void generatePdf(id) },
          ],
        },
      ],
    };
  },

  peeks: {
    service: (id) => {
      const state = getSnapshot();
      const service = serviceById(id, state);
      if (!service) return null;

      const noPrice = hasNoPrice(service);
      const saving = state.savingIds.has(service.id);

      return {
        kind: "service",
        eyebrow: "SERVICE",
        title: service.name,
        sub: service.slug ?? undefined,
        icon: Package,
        tone: noPrice ? ACCENT.amber : ACCENT.info,
        tag: VISIBILITY_LABEL[service.visibility],
        tagTone: service.visibility === "public" ? ACCENT.info : undefined,
        note: saving ? "Saving…" : undefined,
        facts: [
          { label: "Price", value: usd(effectivePriceCents(service)), color: noPrice ? ACCENT.amber : undefined },
          { label: "Billing", value: BILLING_LABEL[service.billingType] },
          { label: "Category", value: topCategory(service), prose: true },
          { label: "Deliverables", value: service.deliverables?.length ? `${service.deliverables.length} listed` : "none listed", prose: true },
        ],
        edits: [
          { key: "name", label: "Name", value: service.name, onChange: (next) => void updateFromPeek(service.id, { name: next }) },
          {
            key: "priceCents",
            label: "Price",
            value: (effectivePriceCents(service) / 100).toFixed(0),
            onChange: (next) => void updateFromPeek(service.id, { priceCents: parseDollarsToCents(next) }),
          },
          {
            key: "billingType",
            label: "Billing",
            value: service.billingType === "recurring_monthly" ? "recurring_monthly" : "one_time",
            options: ["one_time", "recurring_monthly"],
            onChange: (next) => void updateFromPeek(service.id, { billingType: next as "one_time" | "recurring_monthly" }),
          },
          {
            key: "visibility",
            label: "Visibility",
            value: service.visibility,
            options: ["public", "private", "landing_page_only"],
            onChange: (next) => void updateFromPeek(service.id, { visibility: next as typeof service.visibility, isPublic: next === "public" }),
          },
        ],
        body: service.description ? { title: "Description", content: service.description } : undefined,
        list: {
          title: "Deliverables",
          rows: (service.deliverables ?? []).map((d, i) => ({ id: String(i), name: d })),
        },
        open: () => openService(String(service.id)),
        openLabel: "Open it properly",
        actions: [
          { label: "Edit fields", tone: "primary", onSelect: () => { openService(String(service.id)); openEditor(service.id); } },
          { label: "Duplicate", onSelect: () => void duplicateService(service.id) },
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void removeService(service.id) },
        ],
      };
    },
  },

  commands: (): CommandItem[] => {
    const state = getSnapshot();

    const records: CommandItem[] = state.services.map((s) => ({
      id: `rec:service-${s.id}`,
      type: "record",
      kind: "service",
      name: s.name,
      sub: `${usd(effectivePriceCents(s))} · ${BILLING_LABEL[s.billingType]}`,
      tag: hasNoPrice(s) ? "no price" : undefined,
      area: "services",
      run: () => getShellApi()?.openPeek("service", String(s.id)),
    }));

    const unpriced = unpricedServices(state);

    const answers: CommandItem[] = [
      {
        id: "ans:services-unpriced",
        type: "answer",
        name: "Services with no real price",
        sub: "Public, and nobody can check out with them",
        area: "services",
        live: String(unpriced.length),
        run: () => getShellApi()?.navigate("/services"),
      },
      {
        id: "ans:catalog-value",
        type: "answer",
        name: "Catalog value",
        sub: "Effective price summed across every product",
        area: "services",
        live: usd(state.services.reduce((sum, s) => sum + effectivePriceCents(s), 0)),
        run: () => getShellApi()?.navigate("/services"),
      },
    ];

    const actions: CommandItem[] = [
      { id: "act:services-new", type: "action", kind: "run", name: "New service", sub: "Name and slug — the rest is filled in after", area: "services", run: () => void createServiceInteractive().then((c) => { if (c) openService(String(c.id)); }) },
      { id: "act:services-reload", type: "action", kind: "run", name: "Reload the catalog", sub: "Re-read every product", area: "services", run: () => void refreshCatalog() },
      { id: "act:services-export", type: "action", kind: "run", name: "Export the catalog", sub: "Copies the full catalog as JSON", area: "services", run: () => void exportCatalogToClipboard() },
    ];

    return [...records, ...answers, ...actions];
  },

  left: { title: "Services", render: () => <ServiceExplorer /> },
  right: { title: "Properties", render: () => <ServiceProperties /> },
});

function parseDollarsToCents(input: string): number | null {
  const n = parseFloat(input.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n * 100);
}

/** The peek's `edits` write straight through — see `SHELL.md` section 3. */
function updateFromPeek(id: number, patch: Record<string, unknown>): void {
  void updateServiceField(id, patch as never);
}
