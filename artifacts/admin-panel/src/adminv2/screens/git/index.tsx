/**
 * Deploy Console — the Git tab's screen.
 *
 * Registers against the fixed "git" tab (handoff.md: Git and Run are the
 * amber developer capsule). Sync/Build/Console/Auto-copy mirror the
 * design's own four groups. Every button here calls straight into
 * `deployStore` (a plain module-level store, not React state) rather than
 * `useShell()`, because a screen's `ribbon` array is built once at
 * `registerScreen()` module-load time, outside any component — there is no
 * hook to call. `getShellApi()` is only reached for once case that
 * genuinely needs navigation: "Open as a tab".
 */

import { Copy, Download, Eye, FileJson, GitBranch, Layers, Package, Terminal, Type, Zap } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { GitConsoleBody } from "./GitConsoleBody";
import { DEPLOY_OPERATIONS, findDeployOperation } from "./deployOperations";
import {
  AUTO_COPY_JSON_KEY,
  AUTO_COPY_KEY,
  AUTO_COPY_TEXT_KEY,
  clearTranscript,
  closeConsole,
  copyLastOutput,
  getSnapshot,
  openConsole,
  runOperation,
  setAutoCopy,
  setAutoCopyFormat,
} from "./deployStore";

function run(key: string) {
  return () => {
    const op = findDeployOperation(key);
    if (op) runOperation(op);
  };
}

function openAsTab() {
  closeConsole();
  getShellApi()?.navigate("/git");
}

function toggleAutoCopy() {
  setAutoCopy(!getSnapshot().autoCopy);
}

registerScreen({
  id: "git",
  title: "Deploy Console",
  area: "git",
  icon: GitBranch,
  route: "/git",
  devOnly: true,
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
            intent: "global",
            onSelect: run("git-pull"),
            color: ACCENT.info,
            title: "git pull --ff-only",
          },
        ],
        small: [
          { label: "Git status", icon: Eye, intent: "global", onSelect: run("git-status") },
          { label: "Version info", icon: Copy, intent: "global", onSelect: run("version-info") },
          { label: "Branch", icon: GitBranch, intent: "open", onSelect: openConsole, title: "Shown in the console header" },
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
            intent: "global",
            onSelect: run("full-rebuild"),
            color: ACCENT.amber,
            title: DEPLOY_OPERATIONS.find((o) => o.key === "full-rebuild")?.command,
          },
        ],
        small: [
          { label: "pnpm install", icon: Package, intent: "global", onSelect: run("pnpm-install") },
          { label: "pnpm build", icon: Layers, intent: "global", onSelect: run("pnpm-build") },
          { label: "Clear console", icon: Terminal, intent: "global", onSelect: clearTranscript },
        ],
      },
    },
    {
      tab: "git",
      order: 30,
      group: {
        label: "Console",
        large: [
          {
            label: "Floating console",
            icon: Terminal,
            intent: "open",
            onSelect: openConsole,
            title: "Type any command — it runs for real, the same as the buttons here",
          },
        ],
        small: [
          { label: "Open as a tab", icon: GitBranch, intent: "open", onSelect: openAsTab },
          { label: "Copy last output", icon: Copy, intent: "global", onSelect: copyLastOutput },
        ],
      },
    },
    {
      tab: "git",
      order: 40,
      group: {
        label: "Auto copy",
        large: [
          {
            label: "Auto copy",
            icon: Copy,
            intent: "global",
            onSelect: toggleAutoCopy,
            title: "Copy every result to the clipboard as it finishes",
            liveKey: AUTO_COPY_KEY,
          },
        ],
        small: [
          {
            label: "As JSON",
            icon: FileJson,
            intent: "global",
            onSelect: () => setAutoCopyFormat("json"),
            liveKey: AUTO_COPY_JSON_KEY,
          },
          {
            label: "As plain text",
            icon: Type,
            intent: "global",
            onSelect: () => setAutoCopyFormat("text"),
            liveKey: AUTO_COPY_TEXT_KEY,
          },
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
      sub: "A real terminal into the server — git pull, install, build, or type anything",
      area: "git",
      run: openConsole,
    },
  ],
});
