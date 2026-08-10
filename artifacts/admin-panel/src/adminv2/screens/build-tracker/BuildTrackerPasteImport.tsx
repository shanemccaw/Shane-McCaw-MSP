/**
 * Paste-from-Claude triage import.
 *
 * Shane routinely gets a status-summary reply back from a Claude chat (e.g.
 * "here's the real, complete remainder — 30 open items, grouped by X") and
 * wants to see it laid out the same way it was written, with every
 * referenced issue number resolved against what the tracker actually knows
 * about it (real title/status), rather than re-typing or re-reading each one
 * by hand. The server does the actual extraction with a real Anthropic call
 * (parse-paste, admin-build-tracker.ts) — this component is pure display +
 * client-side matching against the already-loaded store, no writes.
 */

import { useState, useSyncExternalStore } from "react";
import { X, Sparkles, ExternalLink, AlertCircle } from "lucide-react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  getSnapshot, subscribe, parsePasteText, issueByGithubNumber, epicByGithubNumber,
  selectIssue, selectEpic,
} from "./buildTrackerStore";
import { ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, EPIC_STATUS_COLOR, EPIC_STATUS_LABEL } from "./buildTrackerTypes";
import type { PasteImportGroup } from "./buildTrackerTypes";

function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function NumberChip({ number, onClose }: { number: number; onClose: () => void }) {
  useStore(); // re-render as sync/paste-driven store updates land

  const issue = issueByGithubNumber(number);
  const epic = epicByGithubNumber(number);
  const match = issue ?? epic;
  const isEpic = !issue && !!epic;

  if (!match) {
    return (
      <span
        title="No epic or issue in this tracker has this GitHub number"
        style={{
          display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
          borderRadius: 999, fontSize: 11, fontWeight: 600, fontFamily: FONT.mono,
          background: SURFACE.well, border: `1px dashed ${LINE.control}`, color: TEXT.faint,
        }}
      >
        #{number} not in tracker
      </span>
    );
  }

  const color = isEpic ? EPIC_STATUS_COLOR[epic!.status] : ISSUE_STATUS_COLOR[issue!.status];
  const label = isEpic ? EPIC_STATUS_LABEL[epic!.status] : ISSUE_STATUS_LABEL[issue!.status];

  function handleClick() {
    if (isEpic) selectEpic(epic!.id); else selectIssue(issue!.id);
    getShellApi()?.openDoc({ kind: isEpic ? "epic" : "issue", id: String(match!.id), screenId: "build-tracker" });
    onClose();
  }

  return (
    <button
      onClick={handleClick}
      title={`${label} — ${match.title}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px",
        borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: FONT.mono,
        background: `${color}18`, border: `1px solid ${color}55`, color,
        cursor: "pointer",
      }}
    >
      #{number}
      <span style={{ fontWeight: 500, fontFamily: FONT.sans, color: TEXT.body, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {match.title}
      </span>
      <ExternalLink size={10} style={{ opacity: 0.6, flex: "none" }} />
    </button>
  );
}

function ParsedGroups({ groups, onClose }: { groups: PasteImportGroup[]; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.map((group, gi) => (
        <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{
            margin: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.05em", color: ACCENT.info,
          }}>
            {group.label}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {group.items.map((item, ii) => (
              <div key={ii} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {item.numbers.map((n) => <NumberChip key={n} number={n} onClose={onClose} />)}
                <span style={{ fontSize: 12.5, color: TEXT.body }}>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PasteImportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<PasteImportGroup[] | null>(null);

  async function handleParse() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await parsePasteText(text);
      setGroups(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setGroups(null);
    setError(null);
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 9999, padding: 20,
    }}>
      <div style={{
        background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
        borderRadius: 8, padding: 24, width: "100%", maxWidth: 720,
        display: "flex", flexDirection: "column", gap: 16, maxHeight: "88vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: ACCENT.info }}>
              Build Tracker
            </span>
            <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: TEXT.primary, display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} color={ACCENT.info} /> Paste from Claude
            </h3>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, color: TEXT.dim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {groups === null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: TEXT.dim }}>
              Paste a status-summary reply from a Claude chat (a list of issues grouped under headers, e.g.
              "Currently building:", "#619 — consent-skip bug"). It'll be laid out the same way, with every
              referenced issue matched against what's actually in this tracker.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the chat reply here…"
              rows={12}
              style={{
                padding: "10px 12px", borderRadius: 6, background: SURFACE.well,
                border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5,
                fontFamily: FONT.mono, outline: "none", resize: "vertical",
              }}
            />
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: ACCENT.danger, fontSize: 12 }}>
                <AlertCircle size={13} /> {error}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => void handleParse()}
                disabled={loading || !text.trim()}
                style={{
                  padding: "8px 18px", borderRadius: 6, border: 0,
                  background: ACCENT.info, color: SURFACE.well, fontSize: 12.5, fontWeight: 700,
                  cursor: loading || !text.trim() ? "default" : "pointer",
                  opacity: loading || !text.trim() ? 0.6 : 1,
                  fontFamily: FONT.sans, display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <Sparkles size={13} /> {loading ? "Parsing…" : "Parse"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ParsedGroups groups={groups} onClose={onClose} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleReset}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: `1px solid ${LINE.control}`,
                  background: SURFACE.well, color: TEXT.primary, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: FONT.sans,
                }}
              >
                Paste Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
