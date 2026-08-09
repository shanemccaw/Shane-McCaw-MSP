/**
 * Tenant Signals — the signal catalog and the one rule editor behind it.
 *
 * The design (`Design/adminv2/Admin Shell.dc.html`, the `sg` section) calls
 * this out as the editor every other screen borrows: *"The engine pages and
 * the endpoint trace open this same editor, locked to their own signal. There
 * is no second copy to drift from."* This is that editor.
 *
 * No fixed tab of its own — the seven are closed (SHELL.md) — so it
 * contributes an open/create/global group to `home`, the same placement CRM
 * and Endpoints use. Anything that needs a specific signal open (add a rule,
 * disable it, run the set, save a point) lives on the "Signal Tools"
 * contextual tab, per the audited intent rule that `registerScreen` enforces.
 *
 * One departure from the design's own ribbon: it makes "Test the signal set"
 * the large button on the fixed tab. Here the large button is the screen
 * itself, matching every other screen in this shell (Money's "This month",
 * CRM's "Pipeline", Live Scan's "Live feed") — handoff.md's first principle is
 * that navigation should not require memory, and a destination that is
 * sometimes the large button and sometimes buried is exactly the instability
 * that costs. Running the set is one row down, and unchanged otherwise.
 *
 * There is no gallery on the ribbon button and that is deliberate: a screen's
 * `ribbon` array is built once at module-load time, so a gallery of signals
 * would freeze empty and stay empty. The live list lives in the command
 * palette instead, which SHELL.md rebuilds on every open.
 */

import {
  Activity,
  AlertTriangle,
  Copy,
  Download,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem } from "../../registry/types";
import { TenantSignalsBody } from "./TenantSignalsBody";
import { SignalsExplorerPanel } from "./SignalsExplorerPanel";
import {
  copySignalKey,
  deleteRule,
  exportBundle,
  getSnapshot,
  refreshAll,
  restoreVersion,
  ruleCount,
  rulesFor,
  runProfile,
  savePoint,
  selectedRule,
  setSignalEnabled,
  setView,
  signalFor,
  startDraft,
  type SignalsView,
} from "./signalsStore";
import { conditionText, ruleFaults, totalImpact } from "./signalsTypes";

function openSignals(view: SignalsView) {
  return () => {
    getShellApi()?.navigate("/tenant-signals");
    setView(view);
  };
}

registerScreen({
  id: "tenant-signals",
  title: "Tenant Signals",
  area: "signals",
  icon: Activity,
  route: "/tenant-signals",
  render: (ctx) => <TenantSignalsBody recordId={ctx.recordId} />,

  left: { title: "Signals", render: () => <SignalsExplorerPanel /> },

  ribbon: [
    {
      tab: "home",
      order: 40,
      group: {
        label: "Signals",
        large: [
          {
            label: "Tenant signals",
            icon: Activity,
            intent: "open",
            onSelect: openSignals("rules"),
            title: "The signal catalog and the rules that derive it",
          },
        ],
        small: [
          {
            label: "Test the signal set",
            icon: Play,
            intent: "global",
            onSelect: openSignals("test"),
            title: "Run every rule against a saved profile. Nothing touches a live tenant.",
          },
          {
            label: "Conflicts and health",
            icon: AlertTriangle,
            intent: "open",
            onSelect: openSignals("health"),
            color: ACCENT.amber,
            title: "Rules that contradict each other, and rules that can never fire",
          },
          {
            label: "Refresh",
            icon: RefreshCw,
            intent: "global",
            onSelect: refreshAll,
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    if (!ctx.recordId) return null;
    const key = ctx.recordId;
    return {
      id: "signal-tools",
      label: "Signal Tools",
      groups: [
        {
          label: "This signal",
          large: [{ label: "Add a rule", icon: Plus, intent: "record", onSelect: startDraft }],
          small: [
            {
              label: signalFor(key)?.enabled === false ? "Enable it" : "Disable it",
              icon: AlertTriangle,
              intent: "record",
              onSelect: () => void setSignalEnabled(key, signalFor(key)?.enabled === false),
              title: "Disabling keeps the rules but stops anything they say from counting",
            },
            { label: "Copy signal key", icon: Copy, intent: "record", onSelect: copySignalKey },
            {
              label: "Delete this rule",
              icon: Trash2,
              intent: "record",
              onSelect: () => {
                const rule = selectedRule();
                if (rule) void deleteRule(rule.id);
              },
              color: ACCENT.danger,
            },
          ],
        },
        {
          label: "Try it",
          large: [
            {
              label: "Run the test",
              icon: Play,
              intent: "record",
              onSelect: () => {
                setView("test");
                void runProfile("test");
              },
              color: ACCENT.amber,
              title: "Fires every rule against the selected profile",
            },
          ],
          small: [
            {
              label: "Preview projects",
              icon: Play,
              intent: "record",
              onSelect: () => {
                setView("test");
                void runProfile("projects");
              },
            },
          ],
        },
        {
          label: "Save points",
          large: [
            {
              label: "Save a point",
              icon: Save,
              intent: "record",
              onSelect: () => void savePoint(`Save point — ${signalFor(key)?.label ?? key}`),
              title: "One history for the whole rule set, shared by every screen that edits rules",
            },
          ],
          small: [
            {
              label: "Restore one",
              icon: Undo2,
              intent: "record",
              onSelect: () => {
                const latest = getSnapshot().versions[0];
                if (latest) void restoreVersion(latest.id, latest.name);
                else setView("health");
              },
              title: "Puts the whole platform rule set back to the most recent save point",
            },
            {
              label: "Export the bundle",
              icon: Download,
              intent: "record",
              onSelect: () => void exportBundle(),
              title: "Copies the server's own export of every signal, rule and group",
            },
          ],
        },
      ],
    };
  },

  peeks: {
    /**
     * A signal, handled without leaving. The facts are the three things that
     * decide whether it can do anything at all: how many rules it has, how
     * many of those are broken, and whether the signal is switched on.
     */
    signal: (id) => {
      const signal = signalFor(id);
      if (!signal) return null;
      const rules = rulesFor(id);
      const broken = rules.filter((r) => ruleFaults(r).length > 0);
      const health = getSnapshot().health[id];
      const unlocks = signal.unlocksProjects ?? [];

      const tone = !signal.enabled ? ACCENT.danger : broken.length ? ACCENT.amber : ACCENT.green;

      return {
        kind: "signal" as const,
        eyebrow: signal.isAdjustment ? "ADJUSTMENT" : "PROJECT SIGNAL",
        title: signal.label,
        sub: id,
        icon: Activity,
        tone,
        tag: signal.enabled ? undefined : "disabled",
        tagTone: ACCENT.danger,
        facts: [
          { label: "Rules", value: String(rules.length) },
          {
            label: "Cannot fire",
            value: String(broken.length),
            color: broken.length ? ACCENT.amber : undefined,
          },
          {
            label: "Firing for",
            value: health ? `${health.clientCount} of ${health.totalClients} clients with a script run` : "not counted",
            prose: true,
          },
          {
            label: "Unlocks",
            value: unlocks.length ? unlocks.map((p) => p.title).join(", ") : "nothing — it scores only",
            prose: true,
          },
        ],
        body: signal.description
          ? { title: "What it means", content: `${signal.description}${signal.expectedImpact ? `\n\n${signal.expectedImpact}` : ""}` }
          : undefined,
        list: {
          title: "Rules",
          rows: rules.map((r) => {
            const faults = ruleFaults(r);
            return {
              id: String(r.id),
              mark: faults.length ? "CHECK" : r.severity.slice(0, 4).toUpperCase(),
              tone: faults.length ? ACCENT.amber : ACCENT.info,
              name: r.description || conditionText(r) || `Rule ${r.id}`,
              sub: faults.length ? faults.join(" · ") : conditionText(r),
              right: `${totalImpact(r)} impact`,
            };
          }),
        },
        open: () => getShellApi()?.openDoc({ kind: "signal", id, screenId: "tenant-signals" }),
        openLabel: "Open its rules",
        actions: [
          {
            label: signal.enabled ? "Disable it" : "Enable it",
            // Disabling silently stops a signal counting toward every tenant's
            // score, which is not something to do by mis-click.
            confirm: signal.enabled,
            onSelect: () => void setSignalEnabled(id, !signal.enabled),
          },
        ],
      };
    },
  },

  /**
   * Rebuilt on every palette open, so the counts are real rather than a
   * snapshot taken at registration time. Records are every signal in the
   * catalog — this is the list a gallery could not carry.
   */
  commands: () => {
    const state = getSnapshot();

    const items: CommandItem[] = [
      {
        id: "act:signals-test",
        type: "action",
        kind: "run",
        name: "Test the signal set",
        sub: "Runs every rule against a saved profile. Nothing touches a live tenant.",
        area: "signals",
        run: openSignals("test"),
      },
      {
        id: "act:signals-save-point",
        type: "action",
        kind: "run",
        name: "Save a point in the rule set",
        sub: "One history, shared by every screen that edits rules",
        area: "signals",
        run: () => void savePoint("Save point"),
      },
      {
        id: "act:signals-export",
        type: "action",
        kind: "run",
        name: "Export the signal bundle",
        sub: "Copies every signal, rule and group as JSON",
        area: "signals",
        run: () => void exportBundle(),
      },
    ];

    if (state.signals.length > 0) {
      const brokenCount = state.signals.reduce(
        (n, s) => n + (s.enabled ? (state.rulesBySignal[s.key]?.rules ?? []).filter((r) => ruleFaults(r).length > 0).length : 0),
        0,
      );

      items.push(
        {
          id: "ans:signals-rules",
          type: "answer",
          name: "Rules in the signal set",
          sub: `Across ${state.signals.length} signals`,
          area: "signals",
          live: String(ruleCount()),
          run: openSignals("rules"),
        },
        {
          id: "ans:signals-cannot-fire",
          type: "answer",
          name: "Rules that can never fire",
          sub: "No field to read, or no pillar to score",
          area: "signals",
          live: String(brokenCount),
          run: openSignals("health"),
        },
        {
          id: "ans:signals-conflicts",
          type: "answer",
          name: "Rules that contradict each other",
          sub: "Detected server-side across the whole set",
          area: "signals",
          live: String(state.conflicts.length),
          run: openSignals("health"),
        },
      );

      for (const signal of state.signals) {
        const rules = state.rulesBySignal[signal.key]?.rules ?? [];
        items.push({
          id: `rec:signal-${signal.key}`,
          type: "record",
          kind: "signal",
          name: signal.label,
          sub: `${signal.key} · ${rules.length} rule${rules.length === 1 ? "" : "s"}`,
          tag: signal.enabled ? undefined : "disabled",
          area: "signals",
          run: () => getShellApi()?.openPeek("signal", signal.key),
        });
      }
    }

    return items;
  },
});
