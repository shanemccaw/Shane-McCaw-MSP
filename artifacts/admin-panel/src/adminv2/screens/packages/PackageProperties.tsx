/**
 * The Monitoring Packages screen's right (Properties) panel — the open
 * package's own fields.
 *
 * Split deliberately down what the API will accept:
 * `PATCH /api/admin/monitoring-packages/:key` copies exactly four fields
 * (`label`, `description`, `engines`, `status`) and ignores everything else, so
 * those four are editable here and the rest are stated as read-only rather than
 * rendered as inputs that would silently discard a keystroke.
 *
 * `key` is never editable at all: `monitoring_package_checks.package_key` is a
 * foreign key onto it and `msp_diagnostic_runs.package_key` records it as
 * history, so renaming one would orphan the junction and rewrite the past.
 */

import { useState, useSyncExternalStore } from "react";
import { ACCENT, ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../theme";
import { archivePackage, getSnapshot, patchPackage, subscribe } from "./packagesStore";

function FieldLabel({ children }: { children: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: TEXT.meta }}>
      {children}
    </span>
  );
}

const inputStyle = {
  width: "100%",
  padding: "6px 9px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.chrome,
  color: TEXT.strong,
  outline: "none",
  fontFamily: "inherit",
  fontSize: 12,
} as const;

function StaticField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
      <FieldLabel>{label}</FieldLabel>
      <span style={{ fontSize: 12, color: TEXT.soft, wordBreak: "break-word" }}>{value}</span>
      {note && <span style={{ fontSize: 10.5, lineHeight: 1.45, color: TEXT.faint, textWrap: "pretty" }}>{note}</span>}
    </div>
  );
}

export function PackageProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [armed, setArmed] = useState(false);

  const pkg = state.packages.find((p) => p.key === state.selected);
  if (!pkg) {
    return (
      <div style={{ padding: "14px 12px", fontSize: 11.5, lineHeight: 1.5, color: TEXT.faint, textWrap: "pretty" }}>
        Pick a package on the left and its own fields appear here.
      </div>
    );
  }

  const active = pkg.status === "active";

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <FieldLabel>Name</FieldLabel>
        <input value={pkg.label} onChange={(e) => void patchPackage(pkg.key, { label: e.target.value })} style={inputStyle} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <FieldLabel>Description</FieldLabel>
        <textarea
          value={pkg.description ?? ""}
          onChange={(e) => void patchPackage(pkg.key, { description: e.target.value })}
          spellCheck={false}
          style={{ ...inputStyle, height: 74, lineHeight: 1.5, resize: "vertical" }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <FieldLabel>Engines it feeds</FieldLabel>
        <input
          value={(pkg.engines ?? []).join(", ")}
          placeholder="security, drift"
          onChange={(e) =>
            void patchPackage(pkg.key, {
              engines: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          style={inputStyle}
        />
        <span style={{ fontSize: 10.5, lineHeight: 1.45, color: TEXT.faint, textWrap: "pretty" }}>
          Comma separated. This is a label on the package, not a wiring — an engine reads whatever the checks produce.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <FieldLabel>Status</FieldLabel>
        <button
          onClick={() => void patchPackage(pkg.key, { status: active ? "archived" : "active" })}
          style={{
            ...inputStyle,
            textAlign: "left",
            cursor: "pointer",
            color: active ? ACCENT_TEXT.green : ACCENT.amber,
            fontWeight: 600,
          }}
        >
          {pkg.status}
        </button>
        <span style={{ fontSize: 10.5, lineHeight: 1.45, color: TEXT.faint, textWrap: "pretty" }}>
          {active
            ? "A scan resolves this package. Archiving it stops that immediately — old runs stay readable."
            : "Nothing resolves this package. Setting it active makes every assigned check run again."}
        </span>
      </div>

      <StaticField label="Key" value={pkg.key} note="Fixed. The junction and every recorded run point at it." />
      <StaticField
        label="Platform cost"
        value={pkg.platformCostCents ? `${(pkg.platformCostCents / 100).toFixed(2)} per assigned tenant per month` : "no charge"}
        note="Set outside this screen — the packages API does not accept a change to it."
      />
      <StaticField
        label="Plan tier required"
        value={pkg.requiredPlanFeature ?? "any tier"}
        note="Gates whether a Sales Bundle may include this package. Also set outside this screen."
      />
      <StaticField label="Last changed" value={new Date(pkg.updatedAt).toLocaleString()} />

      <div style={{ padding: "12px 12px 0" }}>
        <button
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            void archivePackage(pkg.key);
          }}
          onBlur={() => setArmed(false)}
          disabled={!active}
          style={{
            width: "100%",
            padding: "7px 12px",
            borderRadius: 5,
            border: `1px solid ${active ? "rgba(229,122,122,.45)" : LINE.control}`,
            background: "transparent",
            color: active ? ACCENT_TEXT.danger : TEXT.faintest,
            fontFamily: "inherit",
            fontSize: 12,
            cursor: active ? "pointer" : "default",
          }}
        >
          {!active ? "Already archived" : armed ? "Archive it — press again" : "Archive this package"}
        </button>
        <span style={{ display: "block", marginTop: 6, fontSize: 10.5, lineHeight: 1.45, color: TEXT.faint, textWrap: "pretty" }}>
          Archiving is reversible and deletes nothing. Every tenant currently scanned on this package stops being scanned
          until another one is assigned.
        </span>
      </div>
    </div>
  );
}
