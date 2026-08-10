/**
 * Monitoring Packages — the package catalog and its check assignment.
 *
 * A monitoring package is the unit the scan engine executes, so this screen is
 * where "what does a scan actually collect" is decided. It edits
 * `monitoring_packages` and the `monitoring_package_checks` junction through
 * the CRUD that already exists in `admin-monitor-checks.ts`; nothing here is
 * invented and nothing is client-computed except formatting.
 *
 * ## Intent audit (`SHELL.md` section 1)
 *
 * Everything contributed to the fixed Home and Watch tabs is `open`, `create`
 * or `global`. The commands that need a package open — save the check list,
 * revert it, remove everything, archive it — are on the **Package Tools**
 * contextual tab, which is exactly the split the audit that produced that rule
 * was enforcing.
 *
 * ## What is deliberately not here
 *
 * - **Running a package.** `executeMonitoringPackage` exists, but no admin
 *   route exposes it and nothing in `SHELL.md`'s Write Actions safety pattern
 *   (its stated known gap: what will change, on which tenant, dry-run first)
 *   is built. A "Run it" button would be the first tenant-mutating action in
 *   the shell with no confirmation flow behind it. The peek states what the
 *   package *would* run instead.
 * - **The design's Checks and Pillar matrix sub-views.** See `PackagesBody.tsx`.
 */

import { useEffect } from "react";
import { Boxes, Copy, Layers, PackageX, Plus, RefreshCw } from "lucide-react";
import { ACCENT, ACCENT_TEXT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GallerySpec, PeekModel } from "../../registry/types";
import { PackagesBody } from "./PackagesBody";
import { PackagesExplorerPanel } from "./PackagesExplorerPanel";
import { PackageProperties } from "./PackageProperties";
import {
  RIBBON_KEYS,
  copyCatalog,
  currentChecks,
  dirtyPackageKeys,
  getSnapshot,
  isDirty,
  reload,
  removeAllChecks,
  revert,
  saveChecks,
  selectPackage,
  silentPackages,
  toggleFacet,
  createPackage,
  archivePackage,
  patchPackage,
} from "./packagesStore";
import {
  keyFromLabel,
  lastRunNote,
  tallyChecks,
  unpackagedChecks,
  whenShort,
} from "./packagesTypes";

const AREA = "packages";
const ROUTE = "/packages";

function go(packageKey?: string) {
  return () => {
    getShellApi()?.navigate(ROUTE);
    if (packageKey) selectPackage(packageKey);
  };
}

function openPackagePeek(key: string) {
  return () => getShellApi()?.openPeek("package", key);
}

/** Catalog map, rebuilt per read — the snapshot changes under every caller here. */
function catalogMap() {
  return new Map(getSnapshot().checks.map((c) => [c.key, c]));
}

function tallyFor(key: string) {
  return tallyChecks(currentChecks(key), catalogMap());
}

/**
 * Creating a package needs a name, and the shell has no prompt of its own.
 * `window.prompt` is used rather than a bespoke modal for the same reason the
 * design's "New monitoring package" is a one-field dialog: it asks for the one
 * thing that cannot be defaulted, and the package is then editable in the
 * Properties panel like any other.
 */
function newPackage(): void {
  const label = typeof window === "undefined" ? null : window.prompt("Name the package. It runs nothing until you add checks.");
  if (!label || !label.trim()) return;
  const key = keyFromLabel(label);
  if (!key) return;
  getShellApi()?.navigate(ROUTE);
  void createPackage({ key, label: label.trim() });
}

// ── Galleries ────────────────────────────────────────────────────────────────
//
// `rows` is a getter, not an array: a screen's `ribbon` array is built once at
// module load, so a plain array would be frozen empty forever. Same shape the
// Observability screen's `attentionGallery` uses.

const allPackagesGallery: GallerySpec = {
  id: "packages-all",
  title: "Monitoring packages",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    const state = getSnapshot();
    return state.packages.map((pkg) => {
      const tally = tallyFor(pkg.key);
      const usage = state.usage[pkg.key];
      return {
        id: pkg.key,
        group: pkg.status === "active" ? "Live" : "Archived",
        tile: String(tally.willRun),
        name: pkg.label,
        head: tally.willRun === 0 ? "runs nothing" : `${tally.willRun} run`,
        sub:
          tally.willRun === 0
            ? "a scan on it collects nothing"
            : `${usage ? `${usage.tenants} tenant${usage.tenants === 1 ? "" : "s"} · ` : "never run · "}${lastRunNote(usage)}`,
        on: state.selected === pkg.key,
        onSelect: openPackagePeek(pkg.key),
      };
    });
  },
  footer: { label: "New package", onSelect: newPackage },
};

const silentGallery: GallerySpec = {
  id: "packages-silent",
  title: "Packages that collect nothing",
  get rows() {
    const state = getSnapshot();
    return silentPackages(state).map((pkg) => {
      const tally = tallyFor(pkg.key);
      return {
        id: pkg.key,
        tile: String(tally.linked),
        name: pkg.label,
        head: tally.linked === 0 ? "nothing linked" : "all archived",
        sub:
          tally.linked === 0
            ? "no check is assigned to it, so every scan finishes with nothing"
            : `${tally.linked} linked, all archived or missing — the scan skips every one`,
        onSelect: openPackagePeek(pkg.key),
      };
    });
  },
  footer: { label: "Open Monitoring Packages", onSelect: go() },
};

const unpackagedGallery: GallerySpec = {
  id: "packages-unpackaged-checks",
  title: "Checks no package runs",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    const state = getSnapshot();
    return unpackagedChecks(state.checks, state.checksByPackage).map((check) => ({
      id: check.key,
      tile: check.frequency.slice(0, 3),
      name: check.label,
      head: check.frequency,
      sub: `${check.key} — active, and no package collects it`,
      onSelect: () => {
        getShellApi()?.navigate(ROUTE);
        const s = getSnapshot();
        if (!s.onlyUnpackaged) toggleFacet("onlyUnpackaged");
      },
    }));
  },
  footer: {
    label: "Show them in the picker",
    onSelect: () => {
      getShellApi()?.navigate(ROUTE);
      if (!getSnapshot().onlyUnpackaged) toggleFacet("onlyUnpackaged");
    },
  },
};

// ── Peek ─────────────────────────────────────────────────────────────────────

function packagePeek(key: string): PeekModel | null {
  const state = getSnapshot();
  const pkg = state.packages.find((p) => p.key === key);
  if (!pkg) return null;

  const catalog = catalogMap();
  const assigned = currentChecks(key, state);
  const tally = tallyChecks(assigned, catalog);
  const usage = state.usage[key];
  const active = pkg.status === "active";
  const dirty = isDirty(key, state);

  return {
    kind: "package",
    eyebrow: "MONITORING PACKAGE",
    title: pkg.label,
    sub: pkg.description ?? pkg.key,
    icon: Boxes,
    tone: ACCENT.amber,
    tag: pkg.status,
    tagTone: active ? ACCENT.green : undefined,
    note: dirty ? "Unsaved check changes — they are staged, not live." : undefined,
    facts: [
      { label: "Will run", value: String(tally.willRun), color: tally.willRun === 0 ? ACCENT.amber : undefined },
      { label: "Linked", value: String(tally.linked) },
      { label: "Tenants", value: String(usage?.tenants ?? 0), color: usage?.tenants ? undefined : ACCENT.amber },
      { label: "Last run", value: whenShort(usage?.lastRunAt), prose: true },
    ],
    edits: [
      { key: "label", label: "Name", value: pkg.label, onChange: (v) => void patchPackage(key, { label: v }) },
      { key: "description", label: "Description", value: pkg.description ?? "", area: true, onChange: (v) => void patchPackage(key, { description: v }) },
      { key: "status", label: "Status", value: pkg.status, options: ["active", "archived"], onChange: (v) => void patchPackage(key, { status: v === "archived" ? "archived" : "active" }) },
    ],
    list: {
      title: tally.linked === 0 ? "It checks nothing" : "What it checks",
      rows: assigned.map((checkKey) => {
        const check = catalog.get(checkKey);
        if (!check) {
          return {
            id: checkKey,
            mark: "GONE",
            tone: ACCENT.danger,
            name: checkKey,
            sub: "no check in the catalog has this key",
          };
        }
        return {
          id: checkKey,
          mark: check.status === "active" ? check.frequency.slice(0, 4).toUpperCase() : "OFF",
          tone: check.status === "active" ? ACCENT.info : ACCENT.amber,
          name: check.label,
          sub: check.status === "active" ? check.key : `${check.key} — archived, so it never runs`,
          right: check.executorType === "graph" ? "" : check.executorType,
        };
      }),
    },
    open: () => getShellApi()?.openDoc({ kind: "package", id: key, screenId: "packages" }),
    openLabel: "Open it properly",
    actions: [
      { label: "Edit its checks", tone: "primary", onSelect: go(key) },
      ...(active
        ? [{ label: "Archive", tone: "danger" as const, confirm: true, onSelect: () => void archivePackage(key) }]
        : []),
    ],
  };
}

// ── The screen ───────────────────────────────────────────────────────────────

/**
 * Keeps the open record doc and the store's selection in step.
 *
 * `openDoc({ kind: "package", id })` hands the key back as `ctx.recordId`; the
 * body reads selection from the store, so opening a package tab has to write it
 * there rather than the body reading two sources that can disagree.
 */
function PackagesScreen({ recordId }: { recordId?: string }) {
  useEffect(() => {
    if (recordId) selectPackage(recordId);
  }, [recordId]);
  return <PackagesBody />;
}

registerScreen({
  id: "packages",
  title: "Monitoring Packages",
  area: AREA,
  icon: Boxes,
  route: ROUTE,
  render: (ctx) => <PackagesScreen recordId={ctx.recordId} />,

  left: { title: "Packages", render: () => <PackagesExplorerPanel /> },
  right: { title: "Package", render: () => <PackageProperties /> },

  ribbon: [
    {
      tab: "catalog",
      order: 20,
      group: {
        label: "Monitoring packages",
        large: [
          {
            label: "All packages",
            icon: Boxes,
            intent: "open",
            title: "Every monitoring package, with what each one actually collects",
            // Overridden with the real package count as soon as the catalog
            // loads — see `packagesStore.ts`'s RIBBON_KEYS.
            liveKey: RIBBON_KEYS.allPackages,
            onSelect: go(),
            gallery: allPackagesGallery,
          },
        ],
        small: [
          { label: "New package", icon: Plus, intent: "create", onSelect: newPackage },
          { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: () => void reload() },
          {
            label: "Copy the catalog",
            icon: Copy,
            intent: "global",
            title: "Copies every package and its real saved check list, as JSON",
            onSelect: copyCatalog,
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
            label: "Packages that collect nothing",
            icon: PackageX,
            intent: "open",
            color: ACCENT.amber,
            title: "An active package that resolves no runnable check still scans, still completes, and returns nothing",
            liveKey: RIBBON_KEYS.runNothing,
            onSelect: go(),
            gallery: silentGallery,
          },
          {
            label: "Checks in no package",
            icon: Layers,
            intent: "open",
            title: "Active checks nothing collects — they cost nothing and score nothing",
            onSelect: () => {
              getShellApi()?.navigate(ROUTE);
              if (!getSnapshot().onlyUnpackaged) toggleFacet("onlyUnpackaged");
            },
            gallery: unpackagedGallery,
          },
        ],
      },
    },
  ],

  // A function rather than a static spec only so it can key off `recordId`
  // explicitly. The label is deliberately static: the contextual tab is
  // assembled in a memo keyed on navigation state, so a "Saved"/"unsaved"
  // label here would go stale the moment a check is toggled, and a ribbon
  // button that lies about dirtiness is worse than one that never claims.
  // The header in `PackagesBody` carries the live state.
  contextualTab: (ctx) => {
    const key = ctx.recordId;
    if (!key) return null;
    return {
      id: "package-tools",
      label: "Package Tools",
      groups: [
        {
          label: "This package",
          large: [
            {
              label: "Save the check list",
              icon: Layers,
              intent: "record",
              color: ACCENT_TEXT.green,
              title: "Replaces this package's whole check list in one write",
              onSelect: () => void saveChecks(),
            },
          ],
          small: [
            { label: "Revert", icon: RefreshCw, intent: "record", onSelect: revert },
            { label: "Remove every check", icon: PackageX, intent: "record", color: ACCENT.amber, onSelect: removeAllChecks },
          ],
        },
        {
          label: "Catalog",
          small: [
            { label: "New package", icon: Plus, intent: "create", onSelect: newPackage },
            { label: "Copy the catalog", icon: Copy, intent: "global", onSelect: copyCatalog },
            { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: () => void reload() },
          ],
        },
      ],
    };
  },

  peeks: { package: packagePeek },

  commands: () => {
    const state = getSnapshot();
    const items: CommandItem[] = [
      {
        id: "act:new-package",
        type: "action",
        kind: "run",
        name: "New monitoring package",
        sub: "It runs nothing until you add checks",
        area: AREA,
        run: newPackage,
      },
      {
        id: "act:refresh-packages",
        type: "action",
        kind: "run",
        name: "Refresh the package catalog",
        sub: "Repulls packages, checks and what each has actually run",
        area: AREA,
        run: () => void reload(),
      },
    ];

    for (const pkg of state.packages) {
      const tally = tallyFor(pkg.key);
      items.push({
        id: `rec:pkg-${pkg.key}`,
        type: "record",
        kind: "package",
        name: pkg.label,
        sub: `${tally.willRun} of ${tally.linked} checks will run · ${pkg.status}`,
        tag: tally.willRun === 0 ? "collects nothing" : undefined,
        area: AREA,
        run: openPackagePeek(pkg.key),
      });
    }

    const silent = silentPackages(state).length;
    if (state.packages.length > 0) {
      items.push({
        id: "ans:packages-run-nothing",
        type: "answer",
        kind: "answer",
        name: "Packages that collect nothing",
        sub: silent === 0 ? "every active package resolves at least one check" : "they scan, they complete, they return nothing",
        area: AREA,
        live: String(silent),
        run: go(),
      });
    }

    if (state.checks.length > 0) {
      const orphaned = unpackagedChecks(state.checks, state.checksByPackage).length;
      items.push({
        id: "ans:checks-in-no-package",
        type: "answer",
        kind: "answer",
        name: "Checks in no package",
        sub: orphaned === 0 ? "every active check is collected somewhere" : "active, and nothing collects them",
        area: AREA,
        live: String(orphaned),
        run: () => {
          getShellApi()?.navigate(ROUTE);
          if (!getSnapshot().onlyUnpackaged) toggleFacet("onlyUnpackaged");
        },
      });
    }

    const unsaved = dirtyPackageKeys(state).length;
    if (unsaved > 0) {
      items.push({
        id: "ans:packages-unsaved",
        type: "answer",
        kind: "answer",
        name: "Packages with unsaved check changes",
        sub: "staged here only — a scan still runs the saved list",
        area: AREA,
        live: String(unsaved),
        run: go(),
      });
    }

    return items;
  },
});
