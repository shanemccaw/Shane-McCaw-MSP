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

import { useEffect } from "react";
import { useLocation } from "wouter";
import { Redo2, RefreshCw, Save, Undo2 } from "lucide-react";
import { ShellProvider, subRoute, useShell } from "./shell/ShellContext";
import { Shell, NoScreen } from "./shell/Shell";
import { logger } from "@/lib/logger";

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
import "./screens/sql";
import "./screens/packages";
import "./screens/engines";
import "./screens/run-history";
import "./screens/fulfillment";
import "./screens/marketing";
import "./screens/ai-prompts";
import "./screens/shared-links";
// The Git screen's floating console is meant to hover over whatever you are
// doing, not just show while `/git` itself is the active screen — so it is
// mounted here, unconditionally, rather than inside `GitConsoleBody`'s own
// render. `ScreenModule` has no contract yet for "also mount this regardless
// of route"; this is a direct, documented workaround, the same shape as
// `getShellApi()` in `ShellContext.tsx`.
import { FloatingDeployConsole } from "./screens/git/FloatingDeployConsole";
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

const log = logger.child({ channel: "admin.shell" });

function ActiveScreen() {
  const { activeScreen, state } = useShell();
  if (!activeScreen) return <NoScreen />;

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

function AdminV2Inner() {
  const [location] = useLocation();
  const { openPalette } = useShell();

  return (
    <Shell
      productName="Simulator Studio"
      mark="SM"
      quickActions={[
        { id: "save", label: "Save", icon: Save, onSelect: () => log.debug({ location }, "save") },
        { id: "undo", label: "Undo", icon: Undo2, onSelect: () => log.debug("undo") },
        { id: "redo", label: "Redo", icon: Redo2, onSelect: () => log.debug("redo") },
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
      <CrmFetchBridge />
      <AdAuthBridge />
      <MoneyFetchBridge />
      <ObservabilityFetchBridge />
      <EndpointsFetchBridge />
      <SqlFetchBridge />
      <PackagesFetchBridge />
      <EnginesFetchBridge />
      <RunHistoryFetchBridge />
      <FulfillmentFetchBridge />
      <MarketingFetchBridge />
      <AiPromptsFetchBridge />
      <SharedLinksFetchBridge />
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
      <AdminV2Inner />
    </ShellProvider>
  );
}

/** Re-exported so `openPalette` stays reachable from the entry module. */
export { useShell };
