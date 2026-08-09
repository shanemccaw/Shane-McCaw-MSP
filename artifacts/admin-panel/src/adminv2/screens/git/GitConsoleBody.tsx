/**
 * Deploy Console body — the Git screen's centre content.
 *
 * Six cards, one per whitelisted operation, each showing the real command
 * that runs and its real cost ("Up to 10 minutes") before you press
 * anything — handoff.md section 8: "Everything states its cost and
 * reversibility." Pressing Run opens the floating console
 * (`FloatingDeployConsole.tsx`) and runs it there — this body is a
 * documented, one-click launcher for the six named operations, not a
 * second, separate place results show up. Typing a command instead of
 * clicking a card runs the exact same way, through the same transcript.
 */

import type { LucideIcon } from "lucide-react";
import { Clock, Download, Eye, Layers, Package, Play, Zap } from "lucide-react";
import { ACCENT, LINE, SURFACE, TEXT } from "../../theme";
import { DEPLOY_OPERATIONS, type DeployOperation } from "./deployOperations";
import { runOperation } from "./deployStore";

const OP_ICON: Record<string, LucideIcon> = {
  "git-status": Eye,
  "version-info": Clock,
  "git-pull": Download,
  "pnpm-install": Package,
  "pnpm-build": Layers,
  "full-rebuild": Zap,
};

const KIND_TONE: Record<DeployOperation["kind"], string> = {
  read: ACCENT.info,
  write: ACCENT.amber,
  heavy: ACCENT.danger,
};

export function GitConsoleBody() {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", background: SURFACE.app, padding: 20 }}>
      <div style={{ marginBottom: 18, maxWidth: 640 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT.bright }}>Deploy Console</div>
        <div style={{ fontSize: 12.5, color: TEXT.meta, marginTop: 4, lineHeight: 1.5 }}>
          A real terminal into the server&rsquo;s own checkout — no simulation. The six operations below
          are shortcuts; pressing one opens the floating console and runs it there, the same place typing
          a command does. Everything is logged with your admin id.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {DEPLOY_OPERATIONS.map((op) => (
          <OperationCard key={op.key} op={op} />
        ))}
      </div>
    </div>
  );
}

function OperationCard({ op }: { op: DeployOperation }) {
  const Icon = OP_ICON[op.key];

  return (
    <div
      style={{
        background: SURFACE.card,
        border: `1px solid ${LINE.base}`,
        borderRadius: 8,
        padding: 14,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
        <Icon size={16} color={KIND_TONE[op.kind]} style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.primary }}>{op.label}</div>
          <div style={{ fontSize: 11.5, color: TEXT.meta, marginTop: 2 }}>{op.note}</div>
          <div
            style={{
              fontSize: 11,
              color: TEXT.dim,
              marginTop: 6,
              fontFamily: "Menlo, Consolas, monospace",
              wordBreak: "break-all",
            }}
          >
            {op.command}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => runOperation(op)}
        aria-label={`Run ${op.label}`}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 10px",
          borderRadius: 5,
          border: "none",
          cursor: "pointer",
          fontSize: 11.5,
          fontWeight: 600,
          fontFamily: "inherit",
          background: SURFACE.well,
          color: TEXT.primary,
        }}
      >
        <Play size={13} />
        Run
      </button>
    </div>
  );
}
