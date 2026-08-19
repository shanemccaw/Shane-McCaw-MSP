/**
 * RunbookSteps.tsx — the "Runbook · full transparency" checklist.
 *
 * Transcribed from the prototype's `buildStepRows(steps, checkedList, toggleFn)`
 * (`Customer Portal Shell.dc.html` lines 6820-6852) and the markup that consumes
 * it inside the Overshared SharePoint page's per-site actions (4815-4841).
 *
 * ── The verify step is synthesised, not authored ────────────────────────────
 * `buildStepRows` appends one extra row to whatever steps it is given:
 * "Verify — run a targeted scan to confirm this fix took". It is green rather
 * than teal, bold, and carries its own button ("Run verification scan" →
 * "Verified"). That is the design's claim that a runbook is not complete when
 * the work is done, only when the scan says the work took — so `total` is
 * `steps.length + 1` and `allChecked` is measured against that, never against
 * the authored steps alone.
 */

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function boxStyle(checked: boolean, accent: string): React.CSSProperties {
  return {
    flex: "0 0 18px",
    width: 18,
    height: 18,
    borderRadius: 4,
    border: `1px solid ${checked ? accent : "rgba(148,163,184,.35)"}`,
    background: checked ? (accent === "#22d3ee" ? "rgba(34,211,238,.15)" : "rgba(52,211,153,.15)") : "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function CheckSm({ color }: { color: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export const VERIFY_STEP_TEXT = "Verify — run a targeted scan to confirm this fix took";

/** `total` from `buildStepRows` — authored steps plus the synthesised verify. */
export function runbookStepCount(steps: readonly string[]) {
  return steps.length + 1;
}

export function RunbookSteps({
  steps,
  checked,
  onToggle,
  testIdPrefix,
}: {
  steps: readonly string[];
  checked: readonly number[];
  onToggle: (i: number) => void;
  testIdPrefix: string;
}) {
  const verifyIdx = steps.length;
  const verifyChecked = checked.includes(verifyIdx);
  const total = steps.length + 1;
  const allChecked = checked.length === total;

  return (
    <div
      style={{
        marginTop: 10,
        padding: "12px 14px",
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 8,
        background: "#0b1524",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
      data-testid={`${testIdPrefix}-runbook`}
    >
      <span
        style={{
          fontSize: "10.5px",
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "#64748b",
          marginBottom: 6,
        }}
      >
        Runbook · full transparency
      </span>

      {steps.map((text, i) => {
        const isChecked = checked.includes(i);
        return (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 4px", borderRadius: 6 }}
          >
            <div
              onClick={() => onToggle(i)}
              data-testid={`${testIdPrefix}-step-${i}`}
              style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
            >
              <span style={boxStyle(isChecked, "#22d3ee")}>
                {isChecked && <CheckSm color="#22d3ee" />}
              </span>
              <span style={{ flex: "0 0 auto", fontSize: "11px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>
                {i + 1}.
              </span>
              <span
                style={{
                  fontSize: "12.5px",
                  color: isChecked ? "#64748b" : "#cbd5e1",
                  lineHeight: 1.5,
                  textDecoration: isChecked ? "line-through" : "none",
                  textDecorationColor: "rgba(100,116,139,.5)",
                }}
              >
                {text}
              </span>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 4px", borderRadius: 6 }}>
        <div
          onClick={() => onToggle(verifyIdx)}
          style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
        >
          <span style={boxStyle(verifyChecked, "#34d399")}>
            {verifyChecked && <CheckSm color="#34d399" />}
          </span>
          <span style={{ flex: "0 0 auto", fontSize: "11px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>
            {total}.
          </span>
          <span
            style={{
              fontSize: "12.5px",
              fontWeight: 600,
              color: verifyChecked ? "#34d399" : "#cbd5e1",
              lineHeight: 1.5,
            }}
          >
            {VERIFY_STEP_TEXT}
          </span>
        </div>
        <button
          onClick={() => onToggle(verifyIdx)}
          data-testid={`${testIdPrefix}-verify`}
          style={{
            flex: "0 0 auto",
            padding: "5px 11px",
            borderRadius: 5,
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            border: `1px solid ${verifyChecked ? "rgba(52,211,153,.4)" : "rgba(30,41,59,.9)"}`,
            background: verifyChecked ? "rgba(52,211,153,.1)" : "transparent",
            color: verifyChecked ? "#34d399" : "#94a3b8",
          }}
        >
          {verifyChecked ? "Verified" : "Run verification scan"}
        </button>
      </div>

      {allChecked && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 10,
            borderTop: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "11.5px", color: "#34d399", fontWeight: 600 }}>
            All steps complete
          </span>
          <button
            style={{
              padding: "7px 13px",
              borderRadius: 6,
              fontSize: "11.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              border: "1px solid var(--brand-blue, #0078D4)",
              background: "var(--brand-blue, #0078D4)",
              color: "#fff",
            }}
          >
            Run full rescan &amp; rescore
          </button>
        </div>
      )}
    </div>
  );
}
