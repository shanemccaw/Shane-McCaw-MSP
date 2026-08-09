/**
 * Deploy Console body — the Git screen's centre content.
 *
 * Six cards, one per whitelisted operation, each showing the real command
 * that runs and its real cost ("Up to 10 minutes") before you press
 * anything — handoff.md section 8: "Everything states its cost and
 * reversibility." Read operations (status/version) fire on one press.
 * Write/heavy operations (pull/install/build/rebuild) arm on the first press
 * and run on the second, the same in-place arm the peek's `confirm: true`
 * actions already use elsewhere in this shell — there is deliberately no
 * dialog behind it, matching that convention.
 */

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Clock, Download, Eye, Layers, Loader2, Package, Play, XCircle, Zap } from "lucide-react";
// Imports the leaf token module directly, not the adminv2 barrel: this
// screen is imported by `AdminV2.tsx` for registration, and the barrel
// (`@/adminv2`) re-exports `AdminV2.tsx` itself — going through it here would
// create a cycle where these tokens are still `undefined` at import time.
import { ACCENT, ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../theme";
import { DEPLOY_OPERATIONS, type DeployOperation } from "./deployOperations";
import { useDeployOperations, type DeployRunState } from "./useDeployOperations";

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
  const { run, stateFor } = useDeployOperations();
  const [armed, setArmed] = useState<Set<string>>(new Set());

  function handlePress(op: DeployOperation) {
    if (op.kind === "read") {
      run(op.key);
      return;
    }
    if (!armed.has(op.key)) {
      setArmed((prev) => new Set(prev).add(op.key));
      return;
    }
    setArmed((prev) => {
      const next = new Set(prev);
      next.delete(op.key);
      return next;
    });
    run(op.key);
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", background: SURFACE.app, padding: 20 }}>
      <div style={{ marginBottom: 18, maxWidth: 640 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT.bright }}>Deploy Console</div>
        <div style={{ fontSize: 12.5, color: TEXT.meta, marginTop: 4, lineHeight: 1.5 }}>
          A fixed whitelist of real git and pnpm operations against the server&rsquo;s own checkout —
          there is no free-text command input. Pull and build touch the live deployment; each of those
          arms on the first press and runs on the second.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {DEPLOY_OPERATIONS.map((op) => (
          <OperationCard
            key={op.key}
            op={op}
            state={stateFor(op.key)}
            armed={armed.has(op.key)}
            onPress={() => handlePress(op)}
          />
        ))}
      </div>
    </div>
  );
}

function OperationCard({
  op,
  state,
  armed,
  onPress,
}: {
  op: DeployOperation;
  state: DeployRunState;
  armed: boolean;
  onPress: () => void;
}) {
  const Icon = OP_ICON[op.key];
  const isRunning = state.status === "running";

  return (
    <div
      style={{
        background: SURFACE.card,
        border: `1px solid ${LINE.base}`,
        borderRadius: 8,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
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
          onClick={onPress}
          disabled={isRunning}
          aria-label={
            isRunning ? `Running ${op.label}` : armed ? `${op.label} — press again to run it` : `Run ${op.label}`
          }
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            borderRadius: 5,
            border: "none",
            cursor: isRunning ? "default" : "pointer",
            fontSize: 11.5,
            fontWeight: 600,
            fontFamily: "inherit",
            background: armed ? "rgba(229,122,122,.18)" : SURFACE.well,
            color: armed ? ACCENT_TEXT.danger : TEXT.primary,
          }}
        >
          {isRunning ? <Loader2 size={13} className="av2-spin" /> : <Play size={13} />}
          {isRunning ? "Running" : armed ? "Press again" : "Run"}
        </button>
      </div>

      {(state.status === "ok" || state.status === "failed") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: state.status === "ok" ? ACCENT_TEXT.green : ACCENT_TEXT.danger,
            }}
          >
            {state.status === "ok" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {state.status === "ok" ? "Succeeded" : state.error ?? "Failed"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflow: "auto" }}>
            {state.steps.map((step, i) => (
              <div key={i}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontFamily: "Menlo, Consolas, monospace",
                    color: TEXT.soft,
                  }}
                >
                  {step.ok ? (
                    <CheckCircle2 size={12} color={ACCENT_TEXT.green} />
                  ) : (
                    <XCircle size={12} color={ACCENT_TEXT.danger} />
                  )}
                  {step.label}
                </div>
                {step.output && (
                  <pre
                    style={{
                      fontSize: 10.5,
                      color: TEXT.meta,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      background: SURFACE.well,
                      border: `1px solid ${LINE.subtle}`,
                      borderRadius: 4,
                      padding: 8,
                      marginTop: 4,
                      marginBottom: 0,
                    }}
                  >
                    {step.output}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
