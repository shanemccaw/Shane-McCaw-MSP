/**
 * Bulk-assign a GitHub Projects v2 Iteration to every board item that
 * doesn't have one set yet. Purely a live GitHub operation — no local table
 * for "iteration" exists, nothing here reads or writes the store's state.
 *
 * Two-step flow (dry run -> confirm -> execute) because this is a real,
 * live, bulk write against Shane's actual board: showing "this will touch
 * 47 items" before doing it is the whole point, not decoration.
 */

import { useEffect, useState } from "react";
import { X, CalendarRange, AlertCircle } from "lucide-react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { fetchIterations, assignIteration, type AssignIterationResult } from "./buildTrackerStore";
import type { IterationOption } from "./buildTrackerTypes";

type Phase = "loading" | "pick" | "previewing" | "confirm" | "running" | "done" | "error";

export function IterationAssignModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [iterations, setIterations] = useState<IterationOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [preview, setPreview] = useState<AssignIterationResult | null>(null);
  const [result, setResult] = useState<AssignIterationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIterations()
      .then((list) => {
        setIterations(list);
        const firstOpen = list.find((i) => !i.completed);
        if (firstOpen) setSelectedId(firstOpen.id);
        setPhase("pick");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
  }, []);

  async function handlePreview() {
    if (!selectedId) return;
    setPhase("previewing");
    setError(null);
    try {
      const p = await assignIteration(selectedId, true);
      setPreview(p);
      setPhase("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function handleConfirm() {
    if (!selectedId) return;
    setPhase("running");
    setError(null);
    try {
      const r = await assignIteration(selectedId, false);
      setResult(r);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  const selected = iterations.find((i) => i.id === selectedId);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 9999, padding: 20,
    }}>
      <div style={{
        background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
        borderRadius: 8, padding: 24, width: "100%", maxWidth: 460,
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT.primary, display: "flex", alignItems: "center", gap: 8 }}>
            <CalendarRange size={16} color={ACCENT.info} /> Assign Iteration
          </h3>
          <button onClick={onClose} style={{ background: "transparent", border: 0, color: TEXT.dim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {phase === "loading" && <p style={{ margin: 0, fontSize: 12.5, color: TEXT.dim }}>Loading iterations…</p>}

        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: ACCENT.danger, fontSize: 12 }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {(phase === "pick" || phase === "previewing") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: TEXT.dim }}>
              Every board item with no Iteration set will be moved to the one you pick below.
            </p>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{
                padding: "8px 10px", borderRadius: 6, background: SURFACE.well,
                border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5,
                fontFamily: FONT.sans, outline: "none",
              }}
            >
              {iterations.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.title} — starts {it.startDate}{it.completed ? " (completed)" : ""}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => void handlePreview()}
                disabled={!selectedId || phase === "previewing"}
                style={{
                  padding: "8px 18px", borderRadius: 6, border: 0,
                  background: ACCENT.info, color: SURFACE.well, fontSize: 12.5, fontWeight: 700,
                  cursor: !selectedId ? "default" : "pointer", opacity: !selectedId ? 0.6 : 1,
                  fontFamily: FONT.sans,
                }}
              >
                {phase === "previewing" ? "Checking…" : "Preview"}
              </button>
            </div>
          </div>
        )}

        {phase === "confirm" && preview && selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}` }}>
              <p style={{ margin: 0, fontSize: 13, color: TEXT.primary, fontWeight: 600 }}>
                This will assign <span style={{ color: ACCENT.info }}>{selected.title}</span> to{" "}
                <span style={{ color: ACCENT.amber }}>{preview.candidateCount}</span> item{preview.candidateCount === 1 ? "" : "s"} with no iteration set.
              </p>
              {preview.sampleTitles && preview.sampleTitles.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11.5, color: TEXT.dim }}>
                  {preview.sampleTitles.map((t, i) => <li key={i}>{t}</li>)}
                  {preview.candidateCount > preview.sampleTitles.length && (
                    <li>…and {preview.candidateCount - preview.sampleTitles.length} more</li>
                  )}
                </ul>
              )}
            </div>
            {preview.candidateCount === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: TEXT.dim }}>Nothing to do — every item already has an iteration.</p>
            ) : (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setPhase("pick")}
                  style={{
                    padding: "8px 14px", borderRadius: 6, border: `1px solid ${LINE.control}`,
                    background: SURFACE.well, color: TEXT.primary, fontSize: 12.5, fontWeight: 600,
                    cursor: "pointer", fontFamily: FONT.sans,
                  }}
                >
                  Back
                </button>
                <button
                  onClick={() => void handleConfirm()}
                  style={{
                    padding: "8px 18px", borderRadius: 6, border: 0,
                    background: ACCENT.amber, color: SURFACE.well, fontSize: 12.5, fontWeight: 700,
                    cursor: "pointer", fontFamily: FONT.sans,
                  }}
                >
                  Assign to {preview.candidateCount} item{preview.candidateCount === 1 ? "" : "s"}
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "running" && <p style={{ margin: 0, fontSize: 12.5, color: TEXT.dim }}>Assigning…</p>}

        {phase === "done" && result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: ACCENT.green, fontWeight: 600 }}>
              Done — {result.updated} updated{result.failed ? `, ${result.failed} failed` : ""}.
            </p>
            {!!result.remaining && (
              <p style={{ margin: 0, fontSize: 11.5, color: TEXT.dim }}>
                {result.remaining} more were left over (per-call cap) — run this again to pick up the rest.
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 18px", borderRadius: 6, border: 0,
                  background: ACCENT.info, color: SURFACE.well, fontSize: 12.5, fontWeight: 700,
                  cursor: "pointer", fontFamily: FONT.sans,
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
