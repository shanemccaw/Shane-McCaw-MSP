/**
 * M365 Endpoints — registration.
 *
 * `handoff.md` section 6 names this the single most important screen, and the
 * one whose failure is most specific: *"I can see the field but there's no path
 * from that to a rule, so I write SQL instead."* `EndpointsBody` is that path.
 * This file is only how the shell reaches it.
 *
 * Two contract decisions worth reading before changing anything here:
 *
 * • **Nothing record-scoped is on a fixed tab.** `SHELL.md` section 1 says the
 *   audit that produced that rule stripped Endpoints specifically — it was one
 *   of the six offenders. So "Run it", "Re-evaluate", "Reset the request" and
 *   "Save to the catalog" all live on the contextual tab, where they belong,
 *   and `registerScreen` would throw if they did not.
 * • **The endpoint list is the Explorer, not a column.** The design draws it
 *   inside the centre because the prototype's left panel is a generic tree;
 *   `SHELL.md` deleted that tree and made the panel per-screen contextual
 *   content, which is exactly what this list is.
 */

import { Boxes, ListChecks, Play, RefreshCw, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { EndpointsBody } from "./EndpointsBody";
import { EndpointExplorer } from "./EndpointExplorer";
import { EndpointProperties, GapsPanel, RunHistoryPanel } from "./EndpointProperties";
import {
  getSnapshot,
  packagesForCheck,
  reEvaluate,
  refreshCatalog,
  resetOverride,
  runCheck,
  saveOverrideToCatalog,
  selectCheck,
  setOverride,
  setPillar,
  setView,
  unpackagedChecks,
} from "./endpointsStore";
import {
  domainOf,
  hasOverride,
  pillarOf,
  requestUrlFor,
  resolveRuleVerdicts,
  ruleTypeLabel,
  ruleTypeNeedsValue,
  unpackagedLabel,
} from "./endpointsTypes";

/**
 * Everything a ribbon button says about live data is a GETTER, never a value.
 *
 * `registerScreen` is called at module-load time, outside any component, and
 * the object it is handed is stored by reference and read later. A plain
 * `rows: endpointRows()` or `live: unpackagedChecks().length` is therefore
 * evaluated exactly once — before `EndpointsFetchBridge` has fetched anything —
 * so the gallery would be permanently empty and the Watch count permanently
 * zero. Defining them as getters moves the evaluation to the read: `Gallery.tsx`
 * does `const rows = spec.rows` when the panel opens, `RibbonBody` reads
 * `command.live` as it renders, and `BottomPanel` reads `tab.count` as it
 * renders, so each one sees the catalog as it stands at that moment.
 *
 * This makes a stale number impossible but does not PUSH an update: a count
 * already on screen when the catalog lands refreshes on the ribbon's next
 * render rather than instantly. `shell/liveRibbon.ts` is the push mechanism for
 * exactly this, and this screen should adopt `RibbonCommand.liveKey` once that
 * lands on `main` — it is another session's uncommitted work today, and a
 * screen on `main` must not depend on a file that is not.
 */
function openEndpoint(key: string): void {
  selectCheck(key, pillarOf);
  getShellApi()?.openDoc({ kind: "endpoint", id: key, screenId: "endpoints" });
}

/**
 * One gallery row per endpoint.
 *
 * `SHELL.md` section 5: "Rows carry real data, not labels... A row whose `sub`
 * restates its `name` is a row that should not exist." So the tile is the
 * number of packages that run it, and the detail line is what it costs and what
 * reads it — the two facts that decide whether an endpoint is worth opening.
 */
function endpointRows(): GalleryRow[] {
  const state = getSnapshot();
  return state.checks.map((check) => {
    const packages = packagesForCheck(check.key, state);
    return {
      id: check.key,
      group: domainOf(check.key),
      tile: packages.length ? String(packages.length) : "—",
      name: check.label,
      head: check.frequency,
      sub: packages.length
        ? `in ${packages.map((p) => p.label).join(", ")}`
        : unpackagedLabel(),
      on: state.selectedKey === check.key,
      onSelect: () => getShellApi()?.openPeek("endpoint", check.key),
    };
  });
}

function gapRows(): GalleryRow[] {
  const state = getSnapshot();
  return unpackagedChecks(state).map((check) => ({
    id: check.key,
    group: domainOf(check.key),
    tile: "0",
    name: check.label,
    head: check.frequency,
    sub: `${check.method} ${check.endpoint.split("?")[0]}`,
    onSelect: () => getShellApi()?.openPeek("endpoint", check.key),
  }));
}

registerScreen({
  id: "endpoints",
  title: "M365 Endpoints",
  area: "endpoints",
  icon: Boxes,
  route: "/endpoints",

  // Opening an endpoint from anywhere — a peek, the palette, a gallery row —
  // routes here with the check key as `recordId`. `EndpointsBody` adopts it in
  // an effect rather than this function adopting it inline: `selectCheck`
  // writes the external store synchronously, and doing that while the shell is
  // rendering would update `EndpointExplorer`/`EndpointProperties` mid-render.
  render: (ctx) => <EndpointsBody recordId={ctx.recordId} />,

  ribbon: [
    {
      tab: "catalog",
      order: 10,
      group: {
        label: "Endpoints",
        large: [
          {
            label: "All endpoints",
            icon: Boxes,
            intent: "open",
            onSelect: () => getShellApi()?.navigate("/endpoints"),
            title: "Every M365 check the platform can run",
          },
        ],
        small: [
          {
            label: "Browse them",
            icon: ListChecks,
            intent: "open",
            onSelect: () => {},
            gallery: {
              id: "endpoints",
              title: "Endpoints",
              searchable: true,
              searchPlaceholder: "Type part of a name or a domain",
              get rows() {
                return endpointRows();
              },
            },
          },
          {
            label: "Reload the catalog",
            icon: RefreshCw,
            intent: "global",
            onSelect: () => void refreshCatalog(),
            title: "Re-read every check and package from the database",
          },
        ],
      },
    },
    {
      tab: "watch",
      order: 40,
      group: {
        label: "Endpoints",
        large: [
          {
            label: "In no package",
            icon: TriangleAlert,
            intent: "open",
            color: ACCENT.amber,
            // A live count, and one of the few places SHELL.md allows one: an
            // endpoint in no package is configured, costs nothing, and is run
            // against nobody. handoff.md section 3 lists it as a Watch item by
            // name. Zero renders as no badge rather than "0" — a count that
            // means "nothing needs you" is not a thing to notice.
            get live() {
              return unpackagedChecks().length || undefined;
            },
            onSelect: () => getShellApi()?.navigate("/endpoints"),
            gallery: {
              id: "endpoint-gaps",
              title: "In no package",
              searchable: true,
              searchPlaceholder: "Type part of a name",
              get rows() {
                return gapRows();
              },
            },
            title: "Endpoints no package runs — configured, and executed against nobody",
          },
        ],
      },
    },
  ],

  /**
   * Endpoint Tools.
   *
   * The Back group is spliced in at position 2 by the shell — do not add one
   * here (`SHELL.md` section 2; `handoff.md` calls it the single
   * highest-value consistency decision in the design).
   */
  contextualTab: (ctx) => {
    if (!ctx.recordId) return null;
    const key = ctx.recordId;
    const state = getSnapshot();
    const dirty = hasOverride(state.overrides[key]);
    const ran = state.run?.status === "completed";

    return {
      id: "endpoint-tools",
      label: "Endpoint Tools",
      groups: [
        {
          label: "Request",
          large: [
            {
              label: "Run it",
              icon: Play,
              intent: "record",
              color: ACCENT.green,
              onSelect: () => void runCheck(),
              title: "Issues a real Graph request against the tenant in scope",
            },
          ],
          small: [
            {
              label: "Reset the request",
              icon: RotateCcw,
              intent: "record",
              disabled: !dirty,
              onSelect: () => resetOverride(key),
              title: "Drop your overrides and go back to the saved request",
            },
            {
              label: "Save to the catalog",
              icon: Save,
              intent: "record",
              disabled: !dirty,
              onSelect: () => void saveOverrideToCatalog(key),
              title: "Make this request the one every package asks for",
            },
          ],
        },
        {
          label: "Result",
          small: [
            {
              label: "Re-evaluate",
              icon: RefreshCw,
              intent: "record",
              disabled: !ran,
              onSelect: () => void reEvaluate(),
              title: "Re-run the rules against the response already captured. No tenant is called.",
            },
            {
              label: "Rules on it",
              icon: ListChecks,
              intent: "record",
              onSelect: () => setView("rules"),
            },
          ],
        },
      ],
    };
  },

  /**
   * The endpoint peek.
   *
   * `edits` write to this screen's in-memory request override, not to the
   * catalog. That is deliberate and it is the honest reading of `SHELL.md`
   * section 3's "edits write straight through, there is no save step": the
   * override IS the live request, so typing into it changes what Run will
   * actually call, immediately. Writing to the catalog per keystroke instead
   * would append an audit-log row per character and bump the check's schema
   * version on the way past — `PATCH /monitor-checks/:key` increments it
   * whenever `endpoint` changes. The peek says which it is doing, and offers
   * the catalog write as an explicit action.
   */
  peeks: {
    endpoint: (id) => {
      const state = getSnapshot();
      const check = state.checks.find((c) => c.key === id);
      if (!check) return null;

      const packages = packagesForCheck(check.key, state);
      const isOpen = state.selectedKey === check.key;
      const rules = isOpen ? state.rules : [];
      const resolved = isOpen ? resolveRuleVerdicts(rules, state.trace) : [];
      const firing = resolved.filter((r) => r.verdict === "fires").length;
      const blind = resolved.filter((r) => r.verdict === "cannot-read").length;
      const override = state.overrides[check.key];
      const dirty = hasOverride(override);

      return {
        kind: "endpoint",
        eyebrow: "ENDPOINT",
        title: check.label,
        sub: check.key,
        icon: Boxes,
        tone: packages.length ? ACCENT.info : ACCENT.amber,
        tag: packages.length ? `in ${packages.length} package${packages.length === 1 ? "" : "s"}` : "in no package",
        tagTone: packages.length ? ACCENT.info : ACCENT.amber,
        note: dirty ? "Your changes apply to the next run here. Save them to the catalog to make them permanent." : undefined,
        facts: [
          { label: "Runs", value: check.frequency },
          { label: "Pillar", value: pillarOf(check.key) },
          {
            label: "Rules reading it",
            value: isOpen ? String(rules.length) : "open it",
            prose: !isOpen,
            color: isOpen && blind > 0 ? ACCENT.danger : undefined,
          },
          {
            label: "Last result",
            value: isOpen && state.run?.completedAt
              ? `${state.run.result?.itemCount ?? 0} items, ${firing} firing`
              : "not run here yet",
            prose: true,
          },
        ],
        edits:
          check.executorType === "graph"
            ? [
                {
                  key: "endpoint",
                  label: "Path",
                  value: override?.endpoint !== undefined ? override.endpoint : check.endpoint,
                  mono: true,
                  onChange: (next) => setOverride(check.key, { endpoint: next }),
                },
                {
                  key: "method",
                  label: "Method",
                  value: override?.method !== undefined ? override.method : check.method,
                  options: ["GET", "POST"],
                  onChange: (next) => setOverride(check.key, { method: next }),
                },
                {
                  key: "filter",
                  label: "$filter",
                  value: (override?.filterParams !== undefined ? override.filterParams : check.filterParams) ?? "",
                  mono: true,
                  onChange: (next) => setOverride(check.key, { filterParams: next === "" ? null : next }),
                },
              ]
            : undefined,
        body:
          check.executorType === "graph"
            ? { title: "What will be called", content: `${check.method} ${requestUrlFor(check, override)}` }
            : { title: "How it runs", content: `${check.executorType} — this check has no Graph URL.` },
        list: isOpen
          ? {
              title: "Rules against the last result",
              rows: resolved.map(({ rule, verdict, reason }) => ({
                id: String(rule.id),
                mark: verdict === "cannot-read" ? "NO READ" : verdict === "fires" ? "FIRES" : "QUIET",
                tone: verdict === "fires" ? ACCENT.amber : verdict === "cannot-read" ? ACCENT.danger : undefined,
                name: `${rule.sourceKey} ${ruleTypeLabel(rule.ruleType)}${
                  ruleTypeNeedsValue(rule.ruleType) ? ` ${rule.compareValue ?? ""}` : ""
                }`,
                sub: rule.description ?? reason ?? `writes to ${rule.signalKey}`,
              })),
            }
          : {
              title: "Rules against the last result",
              rows: [
                {
                  id: "not-open",
                  name: "Open it to see what reads this endpoint",
                  sub: "Rules are read per endpoint, and only for the one that is open.",
                  onSelect: () => openEndpoint(check.key),
                },
              ],
            },
        open: () => openEndpoint(check.key),
        openLabel: "Open it properly",
        actions: [
          { label: "Run it", tone: "primary", onSelect: () => {
            openEndpoint(check.key);
            void runCheck();
          } },
          ...(dirty
            ? [
                {
                  label: "Save to the catalog",
                  confirm: true,
                  onSelect: () => void saveOverrideToCatalog(check.key),
                },
              ]
            : []),
        ],
      };
    },
  },

  /**
   * Palette entries. Called on every open, so the `?` answers carry live
   * numbers — `SHELL.md` section 4: a cached figure is worse than none.
   */
  commands: (): CommandItem[] => {
    const state = getSnapshot();

    const records: CommandItem[] = state.checks.map((check) => ({
      id: `rec:endpoint-${check.key}`,
      type: "record",
      kind: "endpoint",
      name: check.label,
      sub: `${check.method} ${check.endpoint.split("?")[0]}`,
      tag: packagesForCheck(check.key, state).length ? undefined : "no package",
      area: "endpoints",
      run: () => getShellApi()?.openPeek("endpoint", check.key),
    }));

    const gaps = unpackagedChecks(state);

    const answers: CommandItem[] = [
      {
        id: "ans:unpackaged-endpoints",
        type: "answer",
        name: "Endpoints in no package",
        sub: "Configured, and run against nobody",
        area: "endpoints",
        live: String(gaps.length),
        run: () => {
          getShellApi()?.navigate("/endpoints");
          setPillar("all");
        },
      },
      {
        id: "ans:endpoint-count",
        type: "answer",
        name: "Endpoints defined",
        sub: "Across every domain",
        area: "endpoints",
        live: String(state.checks.length),
        run: () => getShellApi()?.navigate("/endpoints"),
      },
    ];

    const actions: CommandItem[] = [
      {
        id: "act:reload-endpoint-catalog",
        type: "action",
        kind: "run",
        name: "Reload the endpoint catalog",
        sub: "Re-read every check and package",
        area: "endpoints",
        run: () => void refreshCatalog(),
      },
    ];

    return [...records, ...answers, ...actions];
  },

  left: { title: "Endpoints", render: () => <EndpointExplorer /> },
  right: { title: "Properties", render: () => <EndpointProperties /> },
  bottom: [
    { id: "runs", label: "Run history", render: () => <RunHistoryPanel /> },
    {
      id: "gaps",
      label: "In no package",
      get count() {
        return unpackagedChecks().length || undefined;
      },
      render: () => <GapsPanel />,
    },
  ],
});
