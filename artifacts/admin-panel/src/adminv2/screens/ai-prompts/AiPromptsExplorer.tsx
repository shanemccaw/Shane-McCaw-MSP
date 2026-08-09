/**
 * The AI Prompts screen's Explorer panel.
 *
 * Per-screen contextual content, not a global tree — SHELL.md is explicit
 * that the left panel never becomes navigation. This only ever lists the
 * prompts the server actually has rows for, banded by category the same way
 * `Admin Shell.dc.html`'s own left tree groups them.
 */

import { useSyncExternalStore } from "react";
import { ScrollText } from "lucide-react";
import { LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import { copyPromptKey, getSnapshot, select, subscribe } from "./aiPromptsStore";
import { AI_PROMPT_CATEGORIES, hasDraft, type AiPrompt } from "./aiPromptTypes";

function Row({ prompt, on }: { prompt: AiPrompt; on: boolean }) {
  const { menu, open, close } = useContextMenu();

  const openInDoc = () => {
    select(prompt.key);
    getShellApi()?.openDoc({ kind: "prompt", id: prompt.key, screenId: "ai-prompts" });
  };

  return (
    <>
      <button
        onClick={openInDoc}
        onContextMenu={(event) =>
          open(
            event,
            [
              { label: "Open", onSelect: openInDoc },
              { label: "Copy prompt key", onSelect: () => copyPromptKey(prompt.key) },
              {
                label: "Where it runs",
                onSelect: () => window.open(`/admin-panel${prompt.featureRoute}`, "_blank", "noopener"),
                disabled: !prompt.featureRoute,
              },
            ],
            `Actions for ${prompt.name}`,
          )
        }
        title={prompt.description || prompt.name}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          height: 24,
          padding: "0 8px 0 20px",
          border: 0,
          borderLeft: `2px solid ${on ? TEXT.quiet : "transparent"}`,
          background: on ? WASH.hover : "transparent",
          color: on ? TEXT.bright : TEXT.softer,
          fontFamily: "inherit",
          fontSize: 12.5,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <ScrollText size={13} color={on ? TEXT.quiet : TEXT.label} style={{ flex: "none" }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prompt.name}</span>
        {hasDraft(prompt) && (
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 9, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: TEXT.dim }}>
            draft
          </span>
        )}
      </button>
      <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

export function AiPromptsExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  if (state.promptsLoading && state.prompts.length === 0) {
    return <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.faint }}>Reading the prompt list…</div>;
  }
  if (state.prompts.length === 0) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>
        {state.promptsError ?? "No prompts in the database yet — ai_prompts rows are admin-managed only, there is no code-level seed."}
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 0 12px" }}>
      {AI_PROMPT_CATEGORIES.map((cat) => {
        const rows = state.prompts.filter((p) => p.category === cat);
        if (rows.length === 0) return null;
        return (
          <div key={cat}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 24,
                padding: "0 8px 0 10px",
                fontSize: 12,
                fontWeight: 600,
                color: TEXT.quiet,
                textTransform: "capitalize",
              }}
            >
              <span>{cat}</span>
            </div>
            {rows.map((prompt) => (
              <Row key={prompt.key} prompt={prompt} on={state.selected === prompt.key} />
            ))}
          </div>
        );
      })}
      <div style={{ padding: "10px 12px 0", borderTop: `1px solid ${LINE.subtle}`, marginTop: 8 }}>
        <span style={{ fontSize: 11, lineHeight: 1.55, color: TEXT.faint, textWrap: "pretty" }}>
          {state.prompts.length} prompt{state.prompts.length === 1 ? "" : "s"}, {state.prompts.filter(hasDraft).length} with a pending draft.
        </span>
      </div>
    </div>
  );
}
