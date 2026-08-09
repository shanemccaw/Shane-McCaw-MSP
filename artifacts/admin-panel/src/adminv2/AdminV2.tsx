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
import "./screens/endpoints";
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
// Same reasoning again, for the Endpoints screen's Home-tab gallery, its Watch
// -tab live count and its synchronous `endpoint` peek resolver — see
// EndpointsFetchBridge.tsx's doc comment.
import { EndpointsFetchBridge } from "./screens/endpoints/EndpointsFetchBridge";

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
      <EndpointsFetchBridge />
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
