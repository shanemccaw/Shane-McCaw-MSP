/**
 * Engines — the twelve intelligence engines, at /adminv2/engines.
 *
 * Registers against the fixed `run` tab, beside Live Scan: Run pairs with Git
 * as the amber developer capsule (handoff.md section 3), and running the
 * platform's own scoring against a testbed tenant is exactly what that tab is
 * for. The design puts its "Engines" group there too.
 *
 * Everything on the fixed tab is `open`, `create` or `global` — the audit
 * SHELL.md describes. "Run every engine" is global (it acts across every
 * engine at once); anything that needs *this* engine open — its rules, its
 * trace, replaying it — is on the "Engine Tools" contextual tab, which is the
 * answer rather than a workaround.
 *
 * `engine` is a new peek kind. SHELL.md permits that for a genuinely new
 * record type, and an engine is one: it is openable, it has a stable id, it
 * has a name a tab strip needs to resolve, and no existing kind describes it.
 */

import { Activity, Bolt, Clock, Copy, Eye, Grid3x3, Layers, Link2, Play, RotateCcw, TrendingUp } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { EnginesBody } from "./EnginesBody";
import { EnginesExplorer } from "./EnginesExplorer";
import { EngineProperties } from "./EngineProperties";
import { EngineRawOutput } from "./EngineRawOutput";
import {
  armPipeline,
  clearResults,
  copyAllRuns,
  copyWorking,
  currentTestbed,
  getEngine,
  getSnapshot,
  loadHistory,
  previewEngine,
  runEngine,
  runReplay,
  say,
  select,
  selectedEngine,
  setTab,
} from "./enginesStore";
import { relativeTime, traceRowsOf, type EngineDefLite } from "./engineTypes";

const ROUTE = "/engines";

function goto(tab: Parameters<typeof setTab>[0]) {
  return () => {
    getShellApi()?.navigate(ROUTE);
    setTab(tab);
  };
}

/** Opens the screen on one engine, as a record doc so the contextual tab comes with it. */
function openEngine(key: string) {
  select(key);
  getShellApi()?.openDoc({ kind: "engine", id: key, screenId: "engines" });
}

function modeText(engine: EngineDefLite): string {
  switch (engine.configMode) {
    case "signal-rules":
      return "rules drive it";
    case "backing-table":
      return "configured elsewhere";
    default:
      return "aggregates the others";
  }
}

/**
 * The row's tile: what it last scored for the customer in scope, or a code for
 * how it is configured when it has never run there. Two or three characters,
 * and never a fabricated 0 — "never scored" and "scored zero" are different
 * statements.
 */
function tileFor(engine: EngineDefLite): string {
  const score = getSnapshot().history[engine.key]?.latest?.score;
  if (typeof score === "number") return String(score);
  return engine.configMode === "signal-rules" ? "RUL" : engine.configMode === "backing-table" ? "TBL" : "AGG";
}

function galleryRows(): GalleryRow[] {
  return getSnapshot().engines.map((engine) => ({
    id: engine.key,
    group: modeText(engine),
    tile: tileFor(engine),
    name: engine.label,
    head: engine.tenantScoped ? "per tenant" : "portfolio-wide",
    sub: engine.description,
    on: getSnapshot().selected === engine.key,
    onSelect: () => getShellApi()?.openPeek("engine", engine.key),
  }));
}

registerScreen({
  id: "engines",
  title: "Engines",
  area: "engines",
  icon: Activity,
  route: ROUTE,
  render: (ctx) => <EnginesBody recordId={ctx.recordId} />,

  left: { title: "Engines", render: () => <EnginesExplorer /> },
  right: { title: "Engine", render: () => <EngineProperties /> },
  bottom: [{ id: "raw", label: "Raw output", render: () => <EngineRawOutput /> }],

  ribbon: [
    {
      tab: "run",
      order: 20,
      group: {
        label: "Engines",
        large: [
          {
            label: "Run every engine",
            icon: Bolt,
            intent: "global",
            color: ACCENT.amber,
            title: "Runs all twelve in dependency order against the testbed in scope. Writes a history row per engine.",
            onSelect: () => {
              getShellApi()?.navigate(ROUTE);
              setTab("all");
              armPipeline();
            },
          },
        ],
        small: [
          {
            label: "One engine",
            icon: Activity,
            intent: "open",
            onSelect: () => getShellApi()?.navigate(ROUTE),
            gallery: {
              id: "engines",
              title: "Engines",
              searchable: true,
              searchPlaceholder: "Type to narrow it down",
              // Built fresh each time the gallery opens, so a score recorded
              // since the last look is the score shown.
              get rows() {
                return galleryRows();
              },
              footer: { label: "Open the engine grid…", onSelect: goto("all") },
            },
          },
          { label: "How a score was reached", icon: TrendingUp, intent: "open", onSelect: goto("score") },
          { label: "Replay over time", icon: Clock, intent: "open", onSelect: goto("test") },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    const engine = (ctx.recordId ? getEngine(ctx.recordId) : undefined) ?? selectedEngine();
    if (!engine) return null;
    const editable = engine.configMode === "signal-rules";

    return {
      id: "engine-tools",
      label: "Engine Tools",
      groups: [
        {
          label: "Understand it",
          large: [{ label: "How the score was reached", icon: TrendingUp, intent: "record", onSelect: () => setTab("score") }],
          small: [
            { label: "Copy the working", icon: Copy, intent: "record", onSelect: () => copyWorking(engine.key) },
            { label: "Re-read what it recorded", icon: RotateCcw, intent: "record", onSelect: () => void loadHistory(engine.key, true) },
          ],
        },
        {
          label: "Change it",
          large: [
            {
              label: editable ? "Its rules" : "Where it is configured",
              icon: Layers,
              intent: "record",
              color: editable ? ACCENT.greenSoft : ACCENT.info,
              onSelect: () => setTab("config"),
            },
          ],
          small: [
            {
              label: "What feeds this engine",
              icon: Link2,
              intent: "record",
              onSelect: () =>
                say(
                  editable
                    ? `Only rules whose contribution fields ${engine.label} sums reach it — the category a rule carries is not what decides that.`
                    : `${engine.label} reads ${engine.backingTable ?? "no configuration of its own"}. Signal rules never reach it.`,
                ),
            },
          ],
        },
        {
          label: "Everything",
          large: [
            {
              label: "Run every engine",
              icon: Bolt,
              intent: "global",
              color: ACCENT.amber,
              onSelect: () => {
                setTab("all");
                armPipeline();
              },
            },
          ],
          small: [
            { label: "The engine grid", icon: Grid3x3, intent: "open", onSelect: () => setTab("all") },
            { label: "Copy every result", icon: Copy, intent: "global", onSelect: copyAllRuns },
            { label: "Clear what is on screen", icon: RotateCcw, intent: "global", onSelect: clearResults },
          ],
        },
        {
          label: "Try it",
          large: [
            {
              label: "Run it for real",
              icon: Play,
              intent: "record",
              title: "Runs against the testbed in scope and writes a history row",
              onSelect: () => {
                setTab("test");
                void runEngine(engine.key);
              },
            },
          ],
          small: [
            {
              label: "Run and show downstream",
              icon: Eye,
              intent: "record",
              title: "Same run, plus the workflow variables and pricing contributions it produces. Also writes a history row.",
              onSelect: () => {
                setTab("test");
                void previewEngine(engine.key);
              },
            },
            {
              label: "Replay it over time",
              icon: Clock,
              intent: "record",
              color: ACCENT.amber,
              title: "One real run per step, each writing its own history row",
              onSelect: () => {
                setTab("test");
                void runReplay();
              },
            },
          ],
        },
      ],
    };
  },

  peeks: {
    engine: (id) => {
      const engine = getEngine(id);
      if (!engine) return null;
      const state = getSnapshot();
      const latest = state.history[engine.key]?.latest ?? null;
      const run = state.runs[engine.key];
      const rows = traceRowsOf(run?.breakdown ?? latest?.breakdown);
      const editable = engine.configMode === "signal-rules";

      return {
        kind: "engine",
        eyebrow: "ENGINE",
        title: engine.label,
        sub: engine.description,
        icon: Activity,
        tone: editable ? ACCENT.greenSoft : ACCENT.info,
        tag: modeText(engine),
        tagTone: editable ? ACCENT.greenSoft : ACCENT.info,
        facts: [
          { label: "Score", value: latest ? String(latest.score) : "never here" },
          { label: "Recorded", value: latest ? relativeTime(latest.capturedAt) : "never", prose: true },
          { label: "Signals fired", value: latest ? String(latest.rawSignals.length) : "—" },
          {
            label: "Configured by",
            value: editable ? "signal rules" : (engine.backingTable ?? "nothing — it aggregates"),
            prose: true,
          },
        ],
        body: {
          title: "Runs after",
          content: engine.dependsOn.length
            ? engine.dependsOn.map((k) => getEngine(k)?.label ?? k).join("\n")
            : "nothing — it can run first",
        },
        list:
          rows.length > 0
            ? {
                title: "What moved the score",
                rows: rows.slice(0, 10).map((r) => ({
                  id: r.id,
                  mark: r.impact === null ? "—" : String(r.impact),
                  name: r.name,
                  sub: r.detail.length ? r.detail.map(([k, v]) => `${k} ${v}`).join(" · ") : undefined,
                })),
              }
            : undefined,
        open: () => openEngine(engine.key),
        openLabel: "Open the engine",
        actions: [
          {
            label: "Run it for real",
            tone: "primary",
            // Irreversible in the sense that matters here: it writes a history
            // row and tells anything listening. Arm-then-confirm rather than a
            // dialog, per SHELL.md.
            confirm: true,
            onSelect: () => void runEngine(engine.key),
          },
        ],
      };
    },
  },

  commands: () => {
    const state = getSnapshot();
    const tenant = currentTestbed();
    const items: CommandItem[] = [
      {
        id: "act:engines-run-all",
        type: "action",
        kind: "run",
        name: "Run every engine",
        sub: `Scores ${tenant?.name ?? "the testbed in scope"} end to end`,
        area: "engines",
        run: () => {
          getShellApi()?.navigate(ROUTE);
          setTab("all");
          armPipeline();
        },
      },
    ];

    for (const engine of state.engines) {
      const latest = state.history[engine.key]?.latest ?? null;
      items.push({
        id: `rec:engine-${engine.key}`,
        type: "record",
        kind: "engine",
        name: engine.label,
        sub: `${modeText(engine)} · ${engine.tenantScoped ? "per tenant" : "portfolio-wide"}`,
        tag: latest ? undefined : "never run here",
        area: "engines",
        live: latest ? String(latest.score) : undefined,
        run: () => getShellApi()?.openPeek("engine", engine.key),
      });
      items.push({
        id: `act:engine-run-${engine.key}`,
        type: "action",
        kind: "run",
        name: `Run ${engine.label}`,
        sub: `Against ${tenant?.name ?? "the testbed in scope"}, for real — writes a history row`,
        area: "engines",
        run: () => {
          openEngine(engine.key);
          setTab("test");
          void runEngine(engine.key);
        },
      });
    }

    // Only an answer once there is something to answer with: a "0 failed"
    // before anything has run would be a reassurance nobody earned.
    if (state.pipeline) {
      const failed = Object.values(state.pipeline.engines).filter((e) => !e.ok).length;
      items.push({
        id: "ans:engines-pipeline-failures",
        type: "answer",
        kind: "answer",
        name: "Engines that failed the last run",
        sub: failed === 0 ? "every engine finished" : "they scored nothing for this tenant",
        area: "engines",
        live: String(failed),
        run: goto("all"),
      });
    }

    return items;
  },
});
