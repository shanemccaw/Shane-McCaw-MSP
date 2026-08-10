/**
 * adminv2 entry point.
 *
 * Mounted full-bleed at /adminv2 — it brings its own chrome and must not be
 * wrapped in the existing panel's `GlobalIDEShell`, which supplies a left tree
 * this design deliberately removed.
 *
 * Registering a screen is a single `registerScreen` call plus an import
 * here; see SHELL.md.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { House, Redo2, RefreshCw, Undo2 } from "lucide-react";
import { ShellProvider, subRoute, useShell } from "./shell/ShellContext";
import { Shell, NoScreen } from "./shell/Shell";
import { logger } from "@/lib/logger";
import {
  subscribe as undoSubscribe,
  getSnapshot as undoSnapshot,
  canUndo, canRedo, undoLabel, redoLabel,
  undo, redo,
} from "./shell/undoStore";
import { screenForRoute } from "./registry/registry";

// Screens register themselves at import time — see SHELL.md.
import "./screens/git";
import "./screens/live-scan";
import "./screens/ad";
import "./screens/crm";
import "./screens/inbox";
import "./screens/money";
import "./screens/tenant-signals";
import "./screens/observability";
import "./screens/endpoints";
import "./screens/services";
import "./screens/sql";
import "./screens/packages";
import "./screens/engines";
import "./screens/run-history";
import "./screens/fulfillment";
import "./screens/marketing";
import "./screens/ai-prompts";
import "./screens/shared-links";
import "./screens/documents";
import "./screens/workflows";
import "./screens/workflow-triggers";
import "./screens/build-tracker";
import "./screens/project-management";
// The Git screen's floating console is meant to hover over whatever you are
// doing, not just show while `/git` itself is the active screen — so it is
// mounted here, unconditionally, rather than inside `GitConsoleBody`'s own
// render. `ScreenModule` has no contract yet for "also mount this regardless
// of route"; this is a direct, documented workaround, the same shape as
// `getShellApi()` in `ShellContext.tsx`.
import { FloatingDeployConsole } from "./screens/git/FloatingDeployConsole";
import { FloatingSqlConsole } from "./screens/sql/FloatingSqlConsole";
// Same reasoning as FloatingDeployConsole, for the CRM screen's fetch bridge
// — see CrmFetchBridge.tsx's doc comment.
import { CrmFetchBridge } from "./screens/crm/CrmFetchBridge";
// Same reasoning again, for the AD screen's two Home-tab ribbon buttons
// ("New MSP", "New organizational unit") — see adAuthBridge.tsx's doc comment.
import { AdAuthBridge } from "./screens/ad/adAuthBridge";
// Same reasoning again, for the Money tab's own ribbon label (real profit,
// not the word "Money") — see MoneyFetchBridge.tsx's doc comment.
import { MoneyFetchBridge } from "./screens/money/MoneyFetchBridge";
// Same reasoning again, for the Watch tab's Observability groups and its `?`
// palette answers — see ObservabilityFetchBridge.tsx's doc comment.
import { ObservabilityFetchBridge } from "./screens/observability/ObservabilityFetchBridge";
// Same reasoning again, for the Endpoints screen's Home-tab gallery, its Watch
// -tab live count and its synchronous `endpoint` peek resolver — see
// EndpointsFetchBridge.tsx's doc comment.
import { EndpointsFetchBridge } from "./screens/endpoints/EndpointsFetchBridge";
// Same reasoning again, for the Services screen's Watch-tab live "no price
// set" label and its synchronous `service` peek resolver — see
// ServicesFetchBridge.tsx's doc comment.
import { ServicesFetchBridge } from "./screens/services/ServicesFetchBridge";
// Same reasoning again, for the "run" tab's "Saved scripts" gallery and the
// synchronous `script`/`migration` peek resolvers — see SqlFetchBridge.tsx's
// doc comment.
import { SqlFetchBridge } from "./screens/sql/SqlFetchBridge";
// Same reasoning again, for the Monitoring Packages screen's Home-tab package
// gallery, its Watch-tab "collects nothing" count and its synchronous
// `package` peek resolver — see PackagesFetchBridge.tsx's doc comment.
import { PackagesFetchBridge } from "./screens/packages/PackagesFetchBridge";
// Same reasoning again, for the Run tab's "One engine" gallery — it lists
// the real twelve engines with the score each last recorded — and for the
// synchronous engine peek resolver. See EnginesFetchBridge.tsx.
import { EnginesFetchBridge } from "./screens/engines/EnginesFetchBridge";
// Same reasoning again, for the Watch tab's "Runs that failed" count and the
// Run tab's "Recent runs" gallery — and because deployStore/sqlStore ping the
// run-history store the moment a run finishes, which needs a fetch already
// handed over. See RunHistoryFetchBridge.tsx.
import { RunHistoryFetchBridge } from "./screens/run-history/RunHistoryFetchBridge";
// Same reasoning again, for the Home tab's "Queue"/"Types" galleries and the
// Watch tab's live "overdue"/"blocked" counts — see
// FulfillmentFetchBridge.tsx's doc comment.
import { FulfillmentFetchBridge } from "./screens/fulfillment/FulfillmentFetchBridge";
// Same reasoning again, for the Home tab's "Browse campaigns" gallery and the
// Watch tab's live "waiting on you" count — see MarketingFetchBridge.tsx's
// doc comment.
import { MarketingFetchBridge } from "./screens/marketing/MarketingFetchBridge";
// Same reasoning again, for the Home tab's "Open a prompt"/"Drafts pending"
// galleries and the synchronous `prompt` peek resolver — see
// AiPromptsFetchBridge.tsx's doc comment.
import { AiPromptsFetchBridge } from "./screens/ai-prompts/AiPromptsFetchBridge";
// Same reasoning again, for the Home tab's "All shared links" gallery and
// the Watch tab's live "expiring soon" count — see
// SharedLinksFetchBridge.tsx's doc comment.
import { SharedLinksFetchBridge } from "./screens/shared-links/SharedLinksFetchBridge";
// Same reasoning again, for the Home tab's "Search documents" gallery, the
// Watch tab's live "generations that failed" count and the synchronous
// `document` peek resolver — see DocumentsFetchBridge.tsx's doc comment.
import { DocumentsFetchBridge } from "./screens/documents/DocumentsFetchBridge";
// Same reasoning again, for the Home tab's "Workflows"/"Recent runs"
// galleries, the Watch tab's live "pending approvals" count and the
// synchronous `workflow`/`workflowRun` peek resolvers — see
// WorkflowFetchBridge.tsx's doc comment.
import { WorkflowFetchBridge } from "./screens/workflows/WorkflowFetchBridge";
// Same reasoning again, for the Home tab's "All triggers" gallery and the
// Watch tab's live "trigger errors" count — see
// WorkflowTriggersFetchBridge.tsx's doc comment.
import { WorkflowTriggersFetchBridge } from "./screens/workflow-triggers/WorkflowTriggersFetchBridge";
import { BuildTrackerFetchBridge } from "./screens/build-tracker/BuildTrackerFetchBridge";

const log = logger.child({ channel: "admin.shell" });

function ActiveScreen() {
  const { activeScreen, state } = useShell();
  if (!activeScreen || state.docs.length === 0) return <NoScreen />;

  const activeDoc = state.docs.find((d) => d.id === state.activeDocId);
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {activeScreen.render({
        recordId: activeDoc?.recordId,
        kind: activeDoc && activeDoc.kind !== "screen" ? activeDoc.kind : undefined,
      })}
    </div>
  );
}

function AdminShell() {
  // Re-render whenever undo stacks change (any screen).
  useSyncExternalStore(undoSubscribe, undoSnapshot);
  const { state, navigate } = useShell();
  const [location] = useLocation();

  // Derive the active screen id: prefer the open doc's screenId,
  // fall back to the current URL segment so it works even when no doc is open.
  const activeDoc = state.docs.find((d) => d.id === state.activeDocId);
  const activeScreenId: string =
    activeDoc?.screenId ??
    screenForRoute(subRoute(location))?.id ??
    "";

  const hasUndo = canUndo(activeScreenId);
  const hasRedo = canRedo(activeScreenId);
  const undoHint = undoLabel(activeScreenId);
  const redoHint = redoLabel(activeScreenId);

  return (
    <Shell
      productName="Simulator Studio"
      mark="SM"
      quickActions={[
        { id: "home", label: "Pick up where you left off", icon: House, onSelect: () => navigate("/") },
        {
          id: "undo",
          label: hasUndo ? `Undo: ${undoHint}` : "Undo",
          icon: Undo2,
          disabled: !hasUndo,
          onSelect: () => void undo(activeScreenId),
        },
        {
          id: "redo",
          label: hasRedo ? `Redo: ${redoHint}` : "Redo",
          icon: Redo2,
          disabled: !hasRedo,
          onSelect: () => void redo(activeScreenId),
        },
        {
          id: "refresh",
          label: "Refresh",
          icon: RefreshCw,
          onSelect: () => log.debug("refresh"),
        },
      ]}
      userInitials="SM"
      onSelectTenant={(id) => log.info({ tenant: id }, "tenant scope changed")}
    >
      <ActiveScreen />
      <FloatingDeployConsole />
      <FloatingSqlConsole />
      <CrmFetchBridge />
      <AdAuthBridge />
      <MoneyFetchBridge />
      <ObservabilityFetchBridge />
      <EndpointsFetchBridge />
      <ServicesFetchBridge />
      <SqlFetchBridge />
      <PackagesFetchBridge />
      <EnginesFetchBridge />
      <RunHistoryFetchBridge />
      <FulfillmentFetchBridge />
      <MarketingFetchBridge />
      <AiPromptsFetchBridge />
      <SharedLinksFetchBridge />
      <DocumentsFetchBridge />
      <WorkflowFetchBridge />
      <WorkflowTriggersFetchBridge />
      <BuildTrackerFetchBridge />
    </Shell>
  );
}

export default function AdminV2() {
  // wouter's location already has the app's BASE_URL stripped; window.location
  // does not, and subRoute only knows how to remove the /adminv2 segment.
  const [location] = useLocation();

  // In an effect, not in render: a render-time log fires on every re-render
  // (twice per render under StrictMode) and would flood the console ring buffer
  // that the shell's own log panel reads from.
  useEffect(() => {
    log.debug({ route: subRoute(location) }, "adminv2 mounted");
    // Mount only — the route is captured for context, not watched.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ShellProvider>
      <AdminShell />
    </ShellProvider>
  );
}

/** Re-exported so `openPalette` stays reachable from the entry module. */
export { useShell };
