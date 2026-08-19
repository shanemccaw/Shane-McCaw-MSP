/**
 * Pager.tsx — the portal's one pagination control.
 *
 * A transcription of the prototype's `buildPager(page, totalPages, pageKey,
 * jumpKey)` helper (`Customer Portal Shell.dc.html` lines 6783-6819) plus the
 * markup that consumes it (4911-4934). It is a shared method on the logic class
 * in the prototype, used by both evidence lists on the Overshared SharePoint
 * page and by every other long list in the portal — so it is a component here,
 * not a copy inside one page.
 *
 * Two details that are easy to lose and are the whole behaviour:
 *
 *  • The window rule. Up to 7 pages, every page number is shown. Past that it is
 *    first · … · page-1, page, page+1 · … · last, with the leading ellipsis only
 *    when `page > 3` and the trailing one only when `page < totalPages - 2`. A
 *    naive "always show ellipsis" renders `1 … 2 3 4 … 5`, which is worse than
 *    no pager.
 *  • `showPager` is false at a single page. The control disappears rather than
 *    rendering a dead "Page 1 of 1".
 *
 * The jump box takes digits only (`replace(/[^0-9]/g,'')`), commits on Enter or
 * on Go, and clears itself on every navigation — including the arrows.
 */

import { useState } from "react";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function pageBtnStyle(isActive: boolean): React.CSSProperties {
  return {
    minWidth: 26,
    height: 26,
    padding: "0 6px",
    borderRadius: 6,
    fontSize: "11.5px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: MONO,
    border: `1px solid ${isActive ? "rgba(59,130,246,.5)" : "rgba(30,41,59,.9)"}`,
    background: isActive ? "rgba(59,130,246,.15)" : "transparent",
    color: isActive ? "#60a5fa" : "#94a3b8",
  };
}

function navBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 6,
    fontSize: "11px",
    fontWeight: 700,
    cursor: enabled ? "pointer" : "default",
    fontFamily: "inherit",
    border: "1px solid rgba(30,41,59,.9)",
    background: "transparent",
    color: enabled ? "#94a3b8" : "#334155",
  };
}

/** The `raw` window from `buildPager` — numbers and '…' markers, in order. */
export function pagerWindow(page: number, totalPages: number): (number | "…")[] {
  const raw: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) raw.push(i);
    return raw;
  }
  raw.push(1);
  if (page > 3) raw.push("…");
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) raw.push(i);
  if (page < totalPages - 2) raw.push("…");
  raw.push(totalPages);
  return raw;
}

export function Pager({
  page,
  totalPages,
  onPage,
  testIdPrefix,
}: {
  page: number;
  totalPages: number;
  onPage: (n: number) => void;
  testIdPrefix: string;
}) {
  const [jump, setJump] = useState("");

  if (totalPages <= 1) return null;

  const clamp = (n: number) => Math.max(1, Math.min(totalPages, n));
  const goTo = (n: number) => {
    onPage(clamp(n));
    setJump("");
  };
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 2px",
        flexWrap: "wrap",
      }}
      data-testid={`${testIdPrefix}-pager`}
    >
      <span style={{ fontSize: "11px", color: "#64748b" }}>
        Page {page} of {totalPages}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <button onClick={() => goTo(1)} style={navBtnStyle(canPrev)} title="First">
          «
        </button>
        <button onClick={() => goTo(page - 1)} style={navBtnStyle(canPrev)} title="Previous">
          ‹
        </button>
        {pagerWindow(page, totalPages).map((n, idx) =>
          n === "…" ? (
            <span
              key={`e${idx}`}
              style={{ width: 20, textAlign: "center", color: "#475569", fontSize: "12px" }}
            >
              ···
            </span>
          ) : (
            <button
              key={`p${n}`}
              onClick={() => goTo(n)}
              style={pageBtnStyle(n === page)}
              data-testid={`${testIdPrefix}-page-${n}`}
            >
              {n}
            </button>
          ),
        )}
        <button onClick={() => goTo(page + 1)} style={navBtnStyle(canNext)} title="Next" data-testid={`${testIdPrefix}-next`}>
          ›
        </button>
        <button onClick={() => goTo(totalPages)} style={navBtnStyle(canNext)} title="Last">
          »
        </button>
        <input
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && jump) goTo(parseInt(jump, 10));
          }}
          placeholder="#"
          aria-label="Jump to page"
          style={{
            width: 36,
            height: 26,
            borderRadius: 6,
            border: "1px solid rgba(30,41,59,.9)",
            background: "#0b1524",
            color: "#e2e8f0",
            fontSize: "11px",
            textAlign: "center",
            fontFamily: MONO,
          }}
        />
        <button
          onClick={() => {
            if (jump) goTo(parseInt(jump, 10));
          }}
          style={{
            padding: "0 9px",
            height: 26,
            borderRadius: 6,
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            border: "1px solid rgba(59,130,246,.4)",
            background: "rgba(59,130,246,.1)",
            color: "#60a5fa",
          }}
        >
          Go
        </button>
      </div>
    </div>
  );
}
