/**
 * PaletteOverlay.tsx — the ⌘K command palette, drawn to the prototype's own
 * markup (Customer Portal Shell.dc.html 6512-6555) and derivation (19144-19229).
 *
 * ── What this is, and what it is not ───────────────────────────────────────
 * This is the portal-v2 palette SURFACE: the centred overlay, the coloured type
 * labels, the 14-result cap, the always-last "Ask ShaneBot" row, the keyboard
 * model (↑↓ move · ↵ open · esc close · hover selects) and the indexed-count
 * footer. Its ranking and cap are `rankPalette` / `PALETTE_CAP` in
 * `paletteIndex.ts`, unit-tested against the prototype's algorithm.
 *
 * It is deliberately NOT the shared `src/components/command-palette.tsx`. That
 * component is the MSP-staff / customer shadcn dialog already wired to the real
 * `/api/portal/customer/search` endpoint — the "needs a real search endpoint"
 * item the handoff flags as out of scope. This phase is UI-only against the
 * fixture index; the later wiring pass connects that same endpoint behind this
 * surface (see the note added to command-palette.tsx).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import {
  PALETTE_INDEX,
  paletteAskLabel,
  paletteDefault,
  paletteHint,
  paletteScopeNote,
  rankPalette,
  type PaletteEntry,
} from "./paletteIndex";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

export function PaletteOverlay({
  open,
  onClose,
  onNavigate,
  onOpenKb,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onOpenKb: (articleId: string) => void;
  onAsk: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset to the no-query state each time the palette opens — prototype
  // `paletteOpenGo` sets `paletteQ:'' , paletteSel:0`.
  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setSel(0);
    // autoFocus on the input is unreliable across a conditional mount, so
    // focus explicitly once the node exists.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const q = query.trim();
  const rows = useMemo(
    () => (q ? rankPalette(PALETTE_INDEX, q) : paletteDefault(PALETTE_INDEX)),
    [q],
  );

  if (!open) return null;

  // The ask row sits at index `rows.length`; selection cycles across both.
  const n = rows.length + 1;
  const askOn = sel >= rows.length;

  const openEntry = (entry: PaletteEntry) => {
    onClose();
    if (entry.target.type === "kb") onOpenKb(entry.target.articleId);
    else onNavigate(entry.target.href);
  };

  const fireAsk = () => {
    onClose();
    // Prototype 19143: an empty query becomes a stated fallback question.
    onAsk(q || "I could not find what I was looking for in the portal — help me find it");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (s + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (s - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel < rows.length) openEntry(rows[sel]);
      else fireAsk();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      {/* Overlay — prototype 6513. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(2,6,23,.62)",
          backdropFilter: "blur(3px)",
        }}
      />
      {/* Panel — prototype 6516. */}
      <div
        data-testid="pv2-palette"
        style={{
          position: "fixed",
          top: "11vh",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 201,
          width: "min(680px,94vw)",
          maxHeight: "74vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid rgba(0,120,212,.35)",
          borderRadius: 14,
          background: "#0b1524",
          boxShadow: "0 30px 70px rgba(2,6,23,.7)",
          overflow: "hidden",
        }}
      >
        {/* Input row */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "15px 18px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
          }}
        >
          <span style={{ flex: "0 0 17px", display: "flex" }}>
            <Search size={17} color="#60a5fa" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            data-testid="pv2-palette-input"
            placeholder="Search documents, findings, fixes, change requests, pages…"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f1f5f9",
              fontSize: "14px",
              fontFamily: "inherit",
            }}
          />
          <span style={{ flex: "0 0 auto", fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>
            esc
          </span>
        </div>

        {/* Rows */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <span
            data-testid="pv2-palette-hint"
            style={{
              padding: "11px 18px 6px",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#475569",
            }}
          >
            {paletteHint(q, rows.length)}
          </span>

          {rows.map((r, i) => {
            const on = i === sel;
            return (
              <div
                key={`${r.kind}-${r.label}-${i}`}
                onClick={() => openEntry(r)}
                onMouseEnter={() => setSel(i)}
                data-testid="pv2-palette-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 18px",
                  cursor: "pointer",
                  background: on ? "rgba(96,165,250,.1)" : "transparent",
                  borderLeft: `2px solid ${on ? r.tone : "transparent"}`,
                }}
              >
                <span
                  style={{
                    flex: "0 0 118px",
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: r.tone,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.kind}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: on ? 700 : 600,
                      color: on ? "#f8fafc" : "#cbd5e1",
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.label}
                  </span>
                  <span
                    style={{
                      fontSize: "10.5px",
                      color: "#64748b",
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.sub}
                  </span>
                </span>
                <span style={{ flex: "0 0 auto", fontSize: "11px", color: on ? "#93c5fd" : "transparent", fontFamily: MONO }}>
                  ↵
                </span>
              </div>
            );
          })}

          {!!q && rows.length === 0 && (
            <div style={{ padding: "14px 18px 4px", display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
                Nothing in the portal matches that. ShaneBot can answer it from your tenant telemetry instead — including things that were never a page.
              </span>
            </div>
          )}

          {/* Always-last Ask ShaneBot row — prototype 6539. */}
          <div
            onClick={fireAsk}
            onMouseEnter={() => setSel(rows.length)}
            data-testid="pv2-palette-ask"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 18px",
              marginTop: 6,
              cursor: "pointer",
              borderTop: "1px solid rgba(30,41,59,.9)",
              background: askOn ? "rgba(34,211,238,.1)" : "rgba(34,211,238,.04)",
              borderLeft: `2px solid ${askOn ? "#22d3ee" : "transparent"}`,
            }}
          >
            <span
              style={{
                flex: "0 0 118px",
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#22d3ee",
              }}
            >
              Ask ShaneBot
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#e2e8f0",
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {paletteAskLabel(q)}
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.4 }}>
                Answers from your tenant, with the telemetry behind it
              </span>
            </span>
            <span style={{ flex: "0 0 auto", fontSize: "11px", color: askOn ? "#22d3ee" : "transparent", fontFamily: MONO }}>
              ↵
            </span>
          </div>
        </div>

        {/* Footer — keyboard legend + indexed count */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            padding: "10px 18px",
            borderTop: "1px solid rgba(30,41,59,.9)",
            background: "rgba(8,17,32,.6)",
          }}
        >
          <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>↑↓ move</span>
          <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>↵ open</span>
          <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>esc close</span>
          <span data-testid="pv2-palette-scope" style={{ marginLeft: "auto", fontSize: "10px", color: "#475569" }}>
            {paletteScopeNote(PALETTE_INDEX)}
          </span>
        </div>
      </div>
    </>
  );
}
