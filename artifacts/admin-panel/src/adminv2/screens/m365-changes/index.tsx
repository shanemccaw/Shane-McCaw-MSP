/**
 * Microsoft Changes — interpretation authoring screen (Git #1532, part of #1494).
 *
 * The AdminV2 authoring surface for the interpretation layer: Gallery (the live
 * library in the command palette, per the tenant-signals note that a ribbon
 * gallery freezes empty at module-load), Peek (one interpretation, edited and
 * confirmed in place), Ribbon (Home + Watch groups), and a Watch tab count of
 * readings awaiting confirmation. No sidebar — per #1532's "no sidebar" rule for
 * this surface, the screen contributes no `left` panel.
 *
 * The screen owns one record kind, `interpretation` — the universal reading of a
 * class of M365 change. Its peek carries the confirmation gate: a `proposed`
 * reading shows a "Confirm" action, and confirming is the only path to `confirmed`
 * (the state the resolution layer reads before anything reaches a tenant).
 */

import { CalendarClock, Sparkles, Plus } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT, ACCENT_TEXT } from "../../theme";
import type { CommandItem, PeekModel } from "../../registry/types";
import { M365ChangesBody } from "./M365ChangesBody";
import { CHANGE_CLASS_LABEL, STATUS_LABEL, statusTone } from "./M365ChangesBody";
import {
  getSnapshot,
  interpretationById,
  updateInterpretation,
  confirmInterpretation,
  rejectInterpretation,
  deleteInterpretation,
  routeInterpretation,
  loadRoutings,
  resolveInterpretation,
  loadResolutions,
  proposedCount,
  WATCH_PROPOSED_KEY,
  type M365ChangeClass,
  type M365Actor,
  type M365Controllability,
  type M365RoutingDecision,
  type M365ResolutionStatus,
} from "./m365ChangesStore";

export const ROUTE = "/m365-changes";
const SCREEN_ID = "m365-changes";
const AREA = "m365-changes";

const CHANGE_CLASSES = Object.keys(CHANGE_CLASS_LABEL) as M365ChangeClass[];
const ACTORS: M365Actor[] = ["microsoft", "admin"];
const CONTROLLABILITY: M365Controllability[] = ["yes", "no", "unknown"];

const WHO_LABEL: Record<M365Actor, string> = { microsoft: "Microsoft", admin: "Admin" };
const CONTROL_LABEL: Record<M365Controllability, string> = { yes: "Yes", no: "No", unknown: "Unknown" };

// ── Routing (#1701) ──────────────────────────────────────────────────────────
const ROUTING_DECISION_LABEL: Record<M365RoutingDecision, string> = {
  auto_created: "AUTO-CREATED",
  proposed: "PROPOSED",
  declined_risk: "DECLINED → RISK",
  none: "NOT ROUTED",
};
const ROUTING_DECISION_TONE: Record<M365RoutingDecision, string> = {
  auto_created: ACCENT.green,
  proposed: ACCENT.amber,
  declined_risk: ACCENT.danger,
  none: ACCENT_TEXT.neutral,
};

// ── Resolution (#1615) ───────────────────────────────────────────────────────
const RESOLUTION_STATUS_LABEL: Record<M365ResolutionStatus, string> = {
  measured: "MEASURED",
  not_measured: "NOT MEASURED",
  error: "ERROR",
};
const RESOLUTION_STATUS_TONE: Record<M365ResolutionStatus, string> = {
  measured: ACCENT.green,
  not_measured: ACCENT_TEXT.neutral,
  error: ACCENT.danger,
};

function openLibrary(): void {
  getShellApi()?.navigate(ROUTE);
}
function openAndFire(event: string): void {
  getShellApi()?.navigate(ROUTE);
  window.dispatchEvent(new CustomEvent(event));
}

registerScreen({
  id: SCREEN_ID,
  title: "Microsoft Changes",
  area: AREA,
  icon: CalendarClock,
  route: ROUTE,
  render: () => <M365ChangesBody />,

  ribbon: [
    // Home — the single most-reached entry, mirrored per SHELL.md.
    {
      tab: "home",
      order: 72,
      group: {
        label: "Microsoft Changes",
        large: [
          {
            label: "Interpretations",
            icon: CalendarClock,
            intent: "open",
            color: ACCENT.info,
            onSelect: openLibrary,
            title: "The universal readings of M365 changes — authored once, reused for every tenant",
          },
        ],
        small: [
          {
            label: "Interpret a change",
            icon: Sparkles,
            intent: "create",
            color: ACCENT.info,
            onSelect: () => openAndFire("m365:interpret"),
            title: "Pick a roadmap item or Message Center post and have the AI propose a structured reading",
          },
          {
            label: "New by hand",
            icon: Plus,
            intent: "create",
            onSelect: () => openAndFire("m365:new-blank"),
            title: "Author an interpretation directly, without an AI proposal",
          },
        ],
      },
    },
    // Watch — a proposed reading is exactly "what needs a decision": an AI reading
    // that cannot reach a tenant until a person confirms it.
    {
      tab: "watch",
      order: 45,
      group: {
        label: "Microsoft Changes",
        small: [
          {
            label: "Interpretations awaiting you",
            icon: Sparkles,
            intent: "open",
            color: proposedCount() > 0 ? ACCENT.amber : undefined,
            // Carried through liveKey, not live — a plain number here freezes at
            // module-load (0) forever. See m365ChangesStore's WATCH_PROPOSED_KEY.
            liveKey: WATCH_PROPOSED_KEY,
            onSelect: openLibrary,
            title: "AI-proposed readings not yet confirmed — none can reach a tenant until you confirm",
          },
        ],
      },
    },
  ],

  peeks: {
    interpretation: (id): PeekModel | null => {
      const it = interpretationById(Number(id));
      if (!it) return null;
      const t = it.touches;
      const touchesText = [
        t.services.length ? `Services: ${t.services.join(", ")}` : "",
        t.protocols.length ? `Protocols: ${t.protocols.join(", ")}` : "",
        t.skus.length ? `SKUs: ${t.skus.join(", ")}` : "",
        t.settings.length ? `Settings: ${t.settings.join(", ")}` : "",
      ].filter(Boolean).join(" · ") || "Nothing recorded";
      const isProposed = it.status === "proposed";
      const isConfirmed = it.status === "confirmed";

      const bodyParts: string[] = [];
      if (it.summary) bodyParts.push(it.summary);
      if (it.probe.description) bodyParts.push(`Probe — count in a tenant: ${it.probe.description}`);
      if (it.probe.graphEndpoint) bodyParts.push(`Graph: ${it.probe.graphEndpoint}`);
      if (it.aiRationale) bodyParts.push(`AI rationale (${it.aiModel ?? "model"}): ${it.aiRationale}`);

      // Routing (#1701) — a confirmed interpretation's real per-tenant routing
      // ledger, lazily loaded on first open of this peek (loadRoutings no-ops
      // once loaded/in-flight, so re-opening the same peek is cheap).
      const snap = getSnapshot();
      if (isConfirmed) {
        void loadRoutings(it.id);
        void loadResolutions(it.id);
      }
      const routingRun = snap.routingRuns[it.id];
      const routings = snap.routingsByInterpretation[it.id] ?? [];
      const routeLabel =
        routingRun?.status === "running" ? "Routing…" :
        routingRun?.status === "failed" ? "Route now (retry)" :
        "Route now";

      // Resolution (#1615) — the stored per-tenant numbers the #1533 resolution
      // layer produces (a live /resolve run, or the daily sweep), joined here
      // with the routing ledger into one per-tenant list so the interpretation's
      // own screen shows both "what did this measure" and "what it became."
      const resolveRun = snap.resolveRuns[it.id];
      const resolutions = snap.resolutionsByInterpretation[it.id] ?? [];
      const resolveLabel =
        resolveRun?.status === "running" ? "Resolving…" :
        resolveRun?.status === "failed" ? "Resolve now (retry)" :
        "Resolve now";
      const resolutionByCustomer = new Map(resolutions.map((r) => [r.customerId, r]));
      const routingByCustomer = new Map(routings.map((r) => [r.customerId, r]));
      const perTenantCustomerIds = Array.from(
        new Set([...resolutions.map((r) => r.customerId), ...routings.map((r) => r.customerId)]),
      );
      const perTenantRows = perTenantCustomerIds.map((customerId) => {
        const resolution = resolutionByCustomer.get(customerId);
        const routing = routingByCustomer.get(customerId);
        const tenantName = routing?.tenantName ?? resolution?.tenantName ?? `Customer ${customerId}`;
        const resolutionSub =
          resolution == null ? undefined :
          resolution.status === "measured" ? `${resolution.affectedCount ?? 0} affected${resolution.basis ? ` · ${resolution.basis.replace(/_/g, " ")}` : ""}` :
          resolution.status === "error" ? (resolution.errorMessage ?? "resolve error") :
          "Not yet measured";
        return {
          id: String(customerId),
          mark: routing ? ROUTING_DECISION_LABEL[routing.decision] : resolution ? RESOLUTION_STATUS_LABEL[resolution.status] : undefined,
          tone: routing ? ROUTING_DECISION_TONE[routing.decision] : resolution ? RESOLUTION_STATUS_TONE[resolution.status] : undefined,
          name: tenantName,
          sub: resolutionSub ?? routing?.reason.replace(/_/g, " "),
          right: routing?.changeRequestCode ?? (resolution?.affectedCount != null ? `${resolution.affectedCount} affected` : undefined),
        };
      });

      return {
        kind: "interpretation",
        eyebrow: "INTERPRETATION",
        title: it.title,
        sub: it.featureId ? `Roadmap ${it.featureId}` : it.graphMessageId ? `MC ${it.graphMessageId}` : "Hand-authored",
        icon: CalendarClock,
        tone: statusTone(it.status),
        tag: STATUS_LABEL[it.status] ?? it.status,
        tagTone: statusTone(it.status),
        note:
          isProposed ? "Unverified — confirm before this reaches any tenant" :
          resolveRun?.status === "failed" ? `Resolve run failed: ${resolveRun.error ?? "unknown error"}` :
          resolveRun?.status === "completed" ? "Resolve run complete — see the per-tenant list below" :
          routingRun?.status === "failed" ? `Routing run failed: ${routingRun.error ?? "unknown error"}` :
          routingRun?.status === "completed" ? "Routing run complete — see the per-tenant list below" :
          undefined,
        facts: [
          { label: "Change class", value: CHANGE_CLASS_LABEL[it.changeClass], prose: true },
          { label: "Who acts", value: WHO_LABEL[it.whoActs], prose: true },
          { label: "Controllable", value: CONTROL_LABEL[it.controllable], prose: true, color: it.controllable === "yes" ? ACCENT.green : undefined },
          { label: "Touches", value: touchesText, prose: true },
          { label: "Proposed by", value: it.proposedBy === "ai" ? (it.aiModel ?? "AI") : "Hand-authored", prose: true },
          { label: "Confirmed by", value: it.confirmedBy ?? "Not confirmed", prose: true, color: it.confirmedBy ? ACCENT.green : undefined },
        ],
        edits: [
          { key: "title", label: "Title", value: it.title, onChange: (v) => { if (v.trim()) void updateInterpretation(it.id, { title: v.trim() }); } },
          { key: "changeClass", label: "Change class", value: CHANGE_CLASS_LABEL[it.changeClass], options: CHANGE_CLASSES.map((c) => CHANGE_CLASS_LABEL[c]),
            onChange: (v) => { const next = CHANGE_CLASSES.find((c) => CHANGE_CLASS_LABEL[c] === v); if (next) void updateInterpretation(it.id, { changeClass: next }); } },
          { key: "whoActs", label: "Who acts", value: WHO_LABEL[it.whoActs], options: ACTORS.map((a) => WHO_LABEL[a]),
            onChange: (v) => { const next = ACTORS.find((a) => WHO_LABEL[a] === v); if (next) void updateInterpretation(it.id, { whoActs: next }); } },
          { key: "controllable", label: "Controllable", value: CONTROL_LABEL[it.controllable], options: CONTROLLABILITY.map((c) => CONTROL_LABEL[c]),
            onChange: (v) => { const next = CONTROLLABILITY.find((c) => CONTROL_LABEL[c] === v); if (next) void updateInterpretation(it.id, { controllable: next }); } },
          ...(it.controllable === "yes"
            ? [{ key: "controlMethod", label: "How to turn it off", value: it.controlMethod ?? "", area: true as const,
                onChange: (v: string) => void updateInterpretation(it.id, { controlMethod: v.trim() || null }) }]
            : []),
          { key: "summary", label: "Summary", value: it.summary ?? "", area: true, onChange: (v) => void updateInterpretation(it.id, { summary: v.trim() || null }) },
          { key: "probe", label: "Probe (what to count)", value: it.probe.description, area: true,
            onChange: (v) => void updateInterpretation(it.id, { probe: { ...it.probe, description: v.trim() } }) },
        ],
        body: bodyParts.length ? { title: "Reading", content: bodyParts.join("\n\n") } : undefined,
        // Resolution (#1615) + Routing (#1701) — the real per-tenant numbers the
        // #1533 resolution layer measured, joined with what each measurement
        // BECAME through routing (auto-created CR / proposed / declined / none).
        list: perTenantRows.length
          ? { title: "Per-tenant resolution & routing", rows: perTenantRows }
          : undefined,
        actions: [
          ...(isProposed
            ? [{ label: "Confirm", tone: "primary" as const, onSelect: () => void confirmInterpretation(it.id) }]
            : []),
          ...(isConfirmed
            ? [{ label: resolveLabel, tone: "primary" as const, onSelect: () => { if (resolveRun?.status !== "running") void resolveInterpretation(it.id); } }]
            : []),
          ...(isConfirmed
            ? [{ label: routeLabel, tone: "primary" as const, onSelect: () => { if (routingRun?.status !== "running") void routeInterpretation(it.id); } }]
            : []),
          ...(it.status !== "rejected"
            ? [{ label: "Reject", onSelect: () => void rejectInterpretation(it.id) }]
            : []),
          { label: "Delete", confirm: true, tone: "danger", onSelect: () => void deleteInterpretation(it.id) },
        ],
      };
    },
  },

  commands: () => {
    const snap = getSnapshot();
    const items: CommandItem[] = [];

    if (snap.loaded && !snap.noMsp) {
      items.push({
        id: "ans:m365-proposed",
        type: "answer",
        kind: "answer",
        name: "M365 interpretations awaiting confirmation",
        sub: "AI-proposed readings not yet confirmed — none can reach a tenant",
        area: AREA,
        live: String(proposedCount()),
        run: openLibrary,
      });
      items.push({
        id: "act:m365-interpret",
        type: "action",
        kind: "run",
        name: "Interpret a Microsoft change",
        sub: "Have the AI propose a structured reading of a roadmap item or Message Center post",
        area: AREA,
        run: () => openAndFire("m365:interpret"),
      });
    }

    for (const it of snap.interpretations) {
      items.push({
        id: `rec:m365-int-${it.id}`,
        type: "record",
        kind: "interpretation",
        name: it.title,
        sub: `${CHANGE_CLASS_LABEL[it.changeClass]} · ${STATUS_LABEL[it.status] ?? it.status}`,
        tag: it.status === "proposed" ? "proposed" : undefined,
        area: AREA,
        run: () => getShellApi()?.openPeek("interpretation", String(it.id)),
      });
    }

    return items;
  },
});
