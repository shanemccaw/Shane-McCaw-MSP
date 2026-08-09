/**
 * The fulfillment-type registry — this screen's bottom panel, the same
 * peripheral-but-important placement `EnginesBody.tsx`'s "Raw output" tab
 * uses. A table (key/label, fired-when, billing, status), click opens the
 * `fulfillmentType` peek where the fields actually get edited — this panel
 * is a browse surface, not a form.
 *
 * Deliberately not ported from the old `pages/FulfillmentTypes.tsx`: file
 * download/upload (Download Template, Import JSON) — there is no established
 * file-picker convention in this shell, and "Seed standard types" covers the
 * same real need (bootstrapping an empty registry) without one. "Copy as
 * JSON" (the export half) is kept, same convention as `packagesStore.ts`'s
 * "Copy the catalog".
 */

import { useSyncExternalStore } from "react";
import { CheckCircle2, Plus, XCircle, Zap } from "lucide-react";
import { ACCENT, LINE, PRIMARY, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { copyTypesAsJson, createTypeInteractive, getSnapshot, seedPresetTypes, subscribe } from "./fulfillmentStore";
import { firedWhenLabel, type FulfillmentTypeRow } from "./fulfillmentTypes";

function newType(): void {
  void createTypeInteractive().then((created) => {
    if (created) getShellApi()?.openPeek("fulfillmentType", created.key);
  });
}

export function FulfillmentTypesPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <span style={{ fontSize: 11, color: TEXT.faint }}>{state.types.length} registered</span>
        <div style={{ flex: 1 }} />
        {state.types.length === 0 && (
          <button onClick={() => void seedPresetTypes()} style={ghostButton}>
            Seed standard types
          </button>
        )}
        <button onClick={() => void copyTypesAsJson()} style={ghostButton}>
          Copy as JSON
        </button>
        <button onClick={newType} style={primaryButton}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
          New type
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {state.loadingTypes && state.types.length === 0 && <div style={{ padding: 14, fontSize: 12, color: TEXT.meta }}>Reading the registry…</div>}
        {!state.loadingTypes && state.types.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, lineHeight: 1.5, color: TEXT.faint }}>
            No fulfillment types yet. Each maps to a <code>fulfillment.&lt;key&gt;</code> workflow event trigger — seed the four
            standard types above, or create your own.
          </div>
        )}
        {state.types.map((t) => (
          <Row key={t.key} type={t} />
        ))}
      </div>
    </div>
  );
}

const ghostButton: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 4,
  border: `1px solid ${LINE.strong}`,
  background: "transparent",
  color: TEXT.quiet,
  fontFamily: "inherit",
  fontSize: 11,
  cursor: "pointer",
};

const primaryButton: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 4,
  border: 0,
  background: PRIMARY,
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

function Row({ type }: { type: FulfillmentTypeRow }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openPeek("fulfillmentType", type.key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          getShellApi()?.openPeek("fulfillmentType", type.key);
        }
      }}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 12px", borderBottom: `1px solid ${LINE.subtle}`, cursor: "pointer" }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT.strong }}>{type.label}</div>
        <div style={{ fontFamily: "Menlo, Consolas, monospace", fontSize: 10.5, color: ACCENT.info }}>{type.key}</div>
      </div>
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 11, color: TEXT.faint }}>{firedWhenLabel(type.firedWhen)}</span>
      <span style={{ flex: "none", fontSize: 11, color: type.recurring ? ACCENT.info : TEXT.dimmer }}>{type.recurring ? "Recurring" : "One-time"}</span>
      <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: type.isActive ? ACCENT.greenBright : TEXT.dimmer }}>
        {type.isActive ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
        {type.isActive ? "Active" : "Inactive"}
      </span>
      <Zap size={12} color={TEXT.faint} />
    </div>
  );
}
