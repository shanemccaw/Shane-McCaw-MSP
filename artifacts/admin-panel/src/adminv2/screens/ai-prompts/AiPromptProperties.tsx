/**
 * The AI Prompts screen's Properties panel.
 *
 * Read-only, on purpose: the one thing that writes through — the body text —
 * has a deliberate draft/publish safety step in front of it (see
 * `aiPromptsStore.ts`'s doc comment), so it does not belong in a panel whose
 * whole contract elsewhere in this shell is "writes go straight through, no
 * save step" (SHELL.md section on peeks). Editing happens in the body.
 */

import { useSyncExternalStore } from "react";
import { FONT, LINE, TEXT } from "../../theme";
import { getSnapshot, selectedPrompt, subscribe } from "./aiPromptsStore";
import { isModifiedFromDefault, promptState, promptStateTone, relativeTime } from "./aiPromptTypes";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: `1px solid ${LINE.subtle}`, padding: "9px 0 11px" }}>
      <div style={{ padding: "0 12px 6px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono, tone, onSelect, title }: { label: string; value: string; mono?: boolean; tone?: string; onSelect?: () => void; title?: string }) {
  const body = (
    <>
      <span style={{ flex: "0 0 42%", minWidth: 0, fontSize: 11.5, color: TEXT.caption, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11.5,
          fontFamily: mono ? FONT.mono : "inherit",
          color: tone ?? TEXT.softer,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </>
  );

  if (!onSelect) {
    return (
      <div title={title ?? value} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 12px" }}>
        {body}
      </div>
    );
  }
  return (
    <button
      onClick={onSelect}
      title={title ?? value}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        width: "100%",
        padding: "4px 12px",
        border: 0,
        background: "transparent",
        fontFamily: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {body}
    </button>
  );
}

export function AiPromptProperties() {
  useSyncExternalStore(subscribe, getSnapshot);
  const prompt = selectedPrompt();

  if (!prompt) {
    return <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.faint }}>No prompt open.</div>;
  }

  const state = promptState(prompt);
  const versions = getSnapshot().versions[prompt.key] ?? [];

  return (
    <div style={{ paddingBottom: 12 }}>
      <Group title="Prompt">
        <Field label="Name" value={prompt.name} />
        <Field label="Key" value={prompt.key} mono />
        <Field label="Category" value={prompt.category} />
        <Field label="Model" value={prompt.model ?? "not pinned"} tone={prompt.model ? undefined : TEXT.faintest} mono={!!prompt.model} />
        <Field label="State" value={state} tone={promptStateTone(state)} />
        <Field label="Updated" value={relativeTime(prompt.updatedAt)} />
      </Group>

      <Group title="What runs now">
        <Field
          label="Live body"
          value={isModifiedFromDefault(prompt) ? "your published body" : "its default"}
          title="What getPrompt() reads for the next AI call — unaffected by any unpublished draft."
        />
        <Field label="Feature area" value={prompt.featureArea || "not set"} tone={prompt.featureArea ? undefined : TEXT.faintest} />
        {prompt.featureRoute && (
          <Field
            label="Where it runs"
            value={prompt.featureRoute}
            mono
            onSelect={() => window.open(`/admin-panel${prompt.featureRoute}`, "_blank", "noopener")}
            title="Opens the feature that calls this prompt, in the old admin panel"
          />
        )}
      </Group>

      {versions.length > 0 && (
        <Group title="Recent versions">
          {versions.slice(0, 6).map((v) => (
            <Field key={v.id} label={`v${v.versionNumber}`} value={`${v.action} · ${relativeTime(v.createdAt)}`} />
          ))}
        </Group>
      )}
    </div>
  );
}
