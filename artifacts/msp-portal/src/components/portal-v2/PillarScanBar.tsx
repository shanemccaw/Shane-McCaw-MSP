/**
 * PillarScanBar.tsx — the scan status footer that sits below every pillar card.
 *
 * ── Why this is shared rather than Governance-specific ──────────────────────
 * Checked against the prototype before building, rather than assumed. Governance
 * (lines 487-491) and Security (lines 623-627) carry byte-identical markup: the
 * same 12px/20px padding, the same `rgba(15,23,42,.4)` panel on a
 * `rgba(30,41,59,.9)` hairline, the same 6px pulsing dot with an 11px right
 * margin, the same sentence, the same `margin-left:auto` right meta.
 *
 * Exactly three things vary:
 *   • the dot colour — `#22C55E` on Governance, `#f87171` on Security,
 *   • the pillar name inside the sentence,
 *   • the four data values (scan number, fixed-since-scan-1, last, next).
 *
 * So it is one component with those as props, not six copies. Building a
 * Governance-only version would have guaranteed drift the moment the second
 * pillar was ported.
 *
 * The dot colour is a per-pillar STATUS signal, not the pillar's identity
 * colour: Governance is blue #3B82F6 but its dot is green, Security is violet
 * #8B5CF6 but its dot is red. It tracks how the pillar is doing, which is why it
 * is passed in rather than derived from the pillar key.
 */

const MONO = "'SF Mono',Menlo,Consolas,monospace";

export interface PillarScanBarProps {
  /** Status dot colour. Governance #22C55E, Security #f87171. */
  dotColor: string;
  /** The pillar name as it reads inside the sentence, e.g. "Governance". */
  pillarLabel: string;
  scanNumber: number | string;
  fixedSinceScan1: number | string;
  lastScan: string;
  nextScan: string;
}

export function PillarScanBar({
  dotColor,
  pillarLabel,
  scanNumber,
  fixedSinceScan1,
  lastScan,
  nextScan,
}: PillarScanBarProps) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 0,
        flexWrap: "wrap",
        padding: "12px 20px",
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 12,
        background: "rgba(15,23,42,.4)",
      }}
      data-testid="pv2-pillar-scan-bar"
    >
      <span
        className="pv2-slow-pulse"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          marginRight: 11,
          flex: "0 0 6px",
        }}
      />
      <span style={{ fontSize: "12px", color: "#94a3b8" }}>
        Scan{" "}
        <span style={{ color: "#e2e8f0", fontWeight: 700, fontFamily: MONO }}>{scanNumber}</span> ·{" "}
        <span style={{ color: "#34d399", fontWeight: 700, fontFamily: MONO }}>
          {fixedSinceScan1}
        </span>{" "}
        fixed in {pillarLabel} since scan 1
      </span>
      <span style={{ marginLeft: "auto", fontSize: "11.5px", color: "#475569" }}>
        Last scan {lastScan} · next scan in {nextScan}
      </span>
    </div>
  );
}
