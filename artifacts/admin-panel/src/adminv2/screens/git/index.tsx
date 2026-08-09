/**
 * Deploy Console — the Git tab's screen.
 *
 * Registers against the fixed "git" tab (handoff.md: Git and Run are the
 * amber developer capsule). Every ribbon button here is `intent: "open"` —
 * it only reveals the console, it never fires an operation itself. That is
 * not a design shortcut: a screen's `ribbon` array is built once, at
 * module-load time, outside any component, so its `onSelect` closures have
 * no React state to run an operation against or show a result in. The
 * actual "global" act — running git/pnpm against the live deployment — only
 * ever happens from a Run button inside the mounted screen body, where
 * `useDeployOperations` has real state to hold the result. See
 * `GitConsoleBody.tsx` for the arm-then-confirm on write/heavy operations.
 */

import { Download, Eye, GitBranch, Layers, Package, Zap } from "lucide-react";
// Leaf imports, not the `@/adminv2` barrel: `AdminV2.tsx` imports this module
// for its registration side effect, and the barrel re-exports `AdminV2.tsx`
// itself — going through it here would be circular.
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { GitConsoleBody } from "./GitConsoleBody";

function openConsole() {
  getShellApi()?.navigate("/git");
}

registerScreen({
  id: "git",
  title: "Deploy Console",
  area: "git",
  icon: GitBranch,
  route: "/git",
  render: () => <GitConsoleBody />,
  ribbon: [
    {
      tab: "git",
      order: 10,
      group: {
        label: "Sync",
        large: [
          {
            label: "Git pull",
            icon: Download,
            intent: "open",
            onSelect: openConsole,
            color: ACCENT.info,
            title: "Open the Deploy Console to pull, install or build",
          },
        ],
        small: [
          { label: "Git status", icon: Eye, intent: "open", onSelect: openConsole },
        ],
      },
    },
    {
      tab: "git",
      order: 20,
      group: {
        label: "Build",
        large: [
          {
            label: "Full rebuild",
            icon: Zap,
            intent: "open",
            onSelect: openConsole,
            color: ACCENT.amber,
            title: "Open the Deploy Console to run pull, install and build",
          },
        ],
        small: [
          { label: "pnpm install", icon: Package, intent: "open", onSelect: openConsole },
          { label: "pnpm build", icon: Layers, intent: "open", onSelect: openConsole },
        ],
      },
    },
  ],
  commands: () => [
    {
      id: "act:deploy-console",
      type: "action",
      kind: "run",
      name: "Open the Deploy Console",
      sub: "Git pull, install, build — the real whitelisted operations",
      area: "git",
      run: openConsole,
    },
  ],
});
