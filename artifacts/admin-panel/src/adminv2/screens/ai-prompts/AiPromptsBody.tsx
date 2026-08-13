/**
 * AI Prompts screen body — the editor.
 *
 * One prompt, one view: a header, the body textarea, the draft/publish/reset
 * actions, an optional Test Draft panel, and a history rail. No tab strip —
 * unlike Engines this screen has exactly one thing to look at per prompt, so
 * `Admin Shell.dc.html`'s own layout (editor left, 232px history rail right)
 * is reproduced directly rather than split into tabs.
 *
 * Draft vs publish is real safety, not a UI nicety: `promptBody` is what
 * `getPrompt()` reads for the next live AI call, and `PUT .../:id` can only
 * ever stage `draftBody` — see `aiPromptsStore.ts`. This body never lets a
 * keystroke reach the live body without an explicit Publish.
 */

import { useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  armReset,
  cancelReset,
  copyPromptKey,
  discardChanges,
  editorTextFor,
  getSnapshot,
  isDirty,
  publish,
  resetToDefault,
  runTestDraft,
  saveDraft,
  selectedPrompt,
  setEditorText,
  setTestClientUserId,
  setTestProjectId,
  subscribe,
  toggleTestPanel,
  type AiPromptsStoreState,
} from "./aiPromptsStore";
import { actionLabel, actionTone, hasDraft, isModifiedFromDefault, relativeTime, type AiPrompt, type AiPromptVersion } from "./aiPromptTypes";

// ─── Shared bits ──────────────────────────────────────────────────────────────

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        background: `${tone}22`,
        border: `1px solid ${tone}55`,
        color: tone,
      }}
    >
      {text}
    </span>
  );
}

function PrimaryButton({ label, onSelect, busy, disabled }: { label: string; onSelect: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onSelect}
      disabled={busy || disabled}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "5px 14px",
        borderRadius: 5,
        border: 0,
        background: busy || disabled ? LINE.control : PRIMARY,
        color: "#fff",
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: busy || disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function QuietButton({ label, onSelect, title, tone, disabled }: { label: string; onSelect: () => void; title?: string; tone?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      title={title}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "5px 12px",
        borderRadius: 5,
        border: `1px solid ${LINE.strong}`,
        background: "transparent",
        color: disabled ? TEXT.faintest : (tone ?? TEXT.soft),
        fontFamily: "inherit",
        fontSize: 11.5,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>{children}</span>
  );
}

function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ prompt, message }: { prompt: AiPrompt; message: string | null }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{prompt.name}</span>
      {isModifiedFromDefault(prompt) && <Badge text="customised" tone={ACCENT.greenSoft} />}
      {hasDraft(prompt) && <Badge text="draft pending" tone={ACCENT.amber} />}
      <div style={{ flex: 1, minWidth: 4 }} />
      {message && (
        <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: ACCENT_TEXT.green }}>
          {message}
        </span>
      )}
      {prompt.featureArea && (
        <button
          onClick={() => prompt.featureRoute && window.open(`/admin-panel${prompt.featureRoute}`, "_blank", "noopener")}
          title={prompt.featureRoute ? "Open the screen this prompt runs on, in the old admin panel" : undefined}
          disabled={!prompt.featureRoute}
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            fontSize: 11.5,
            padding: 0,
            border: 0,
            background: "transparent",
            color: prompt.featureRoute ? ACCENT.info : TEXT.faintest,
            cursor: prompt.featureRoute ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          {prompt.featureArea}
        </button>
      )}
    </div>
  );
}

// ─── Reset confirm banner ───────────────────────────────────────────────────

function ResetConfirmBanner({ prompt, busy }: { prompt: AiPrompt; busy: boolean }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        flexWrap: "wrap",
        padding: "11px 16px",
        borderBottom: "1px solid rgba(242,202,99,.3)",
        background: "rgba(242,202,99,.08)",
      }}
    >
      <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12, lineHeight: 1.5, color: ACCENT.amber, textWrap: "pretty" }}>
        This overwrites the published body and any draft of "{prompt.name}" with its original default. That takes effect on the next AI call.
      </span>
      <PrimaryButton label={busy ? "Resetting…" : "Yes, reset it"} onSelect={() => void resetToDefault(prompt.key)} busy={busy} />
      <QuietButton label="Not now" onSelect={cancelReset} />
    </div>
  );
}

// ─── Test Draft panel ─────────────────────────────────────────────────────────

function TestPanel({ state, prompt }: { state: AiPromptsStoreState; prompt: AiPrompt }) {
  const busy = state.testBusy === prompt.key;
  return (
    <div style={{ flex: "none", maxHeight: 320, display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE.base}` }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "9px 14px", borderBottom: `1px solid ${LINE.quiet}`, background: SURFACE.inset }}>
        <Eyebrow>Test draft</Eyebrow>
        <span style={{ flex: "0 1 auto", minWidth: 0, fontSize: 11.5, color: TEXT.faint, textWrap: "pretty" }}>
          Runs the real generation flow with the text in the editor above. Nothing is saved to the client's documents.
        </span>
        <div style={{ flex: 1, minWidth: 4 }} />
        <input
          type="number"
          value={state.testClientUserId}
          onChange={(e) => setTestClientUserId(e.target.value)}
          placeholder="Client user ID"
          style={{ flex: "none", width: 110, padding: "4px 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.softer, fontFamily: "inherit", fontSize: 11.5 }}
        />
        <input
          type="number"
          value={state.testProjectId}
          onChange={(e) => setTestProjectId(e.target.value)}
          placeholder="Project ID (optional)"
          style={{ flex: "none", width: 130, padding: "4px 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.softer, fontFamily: "inherit", fontSize: 11.5 }}
        />
        <PrimaryButton label={busy ? "Running…" : "Run test draft"} onSelect={() => void runTestDraft(prompt.key)} busy={busy} disabled={!state.testClientUserId.trim()} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 16px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
        {state.testError && <span style={{ fontSize: 12, lineHeight: 1.55, color: ACCENT_TEXT.danger, textWrap: "pretty" }}>{state.testError}</span>}
        {state.testResult && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <Eyebrow>Result</Eyebrow>
              {typeof state.testResult.costCents === "number" && (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT.amber }}>
                  real cost: ${(state.testResult.costCents / 100).toFixed(2)}
                  {state.testResult.costStatus && state.testResult.costStatus !== "ok" ? ` (${state.testResult.costStatus})` : ""}
                </span>
              )}
            </div>
            <div style={{ background: "#fff", borderRadius: 7, padding: 14, color: "#111", fontSize: 13 }}>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(state.testResult.htmlContent) }} />
            </div>
          </>
        )}
        {!state.testError && !state.testResult && !busy && (
          <span style={{ fontSize: 11.5, color: TEXT.faint }}>Enter a real client user ID and run it — this hits the same pipeline a live document generation would.</span>
        )}
      </div>
    </div>
  );
}

// ─── History rail ─────────────────────────────────────────────────────────────

function VersionRow({ promptKey, version: v }: { promptKey: string; version: AiPromptVersion }) {
  const { menu, open, close } = useContextMenu();
  const loadIntoEditor = () => setEditorText(promptKey, v.body);

  return (
    <>
      <div
        onContextMenu={(event) =>
          open(
            event,
            [
              { label: "Load into editor", onSelect: loadIntoEditor },
              { label: "Copy version body", onSelect: () => navigator.clipboard?.writeText(v.body) },
            ],
            `Actions for v${v.versionNumber} · ${actionLabel(v.action)}`,
          )
        }
        style={{ padding: "8px 13px", borderBottom: `1px solid ${LINE.subtle}` }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: actionTone(v.action) }}>
            v{v.versionNumber} · {actionLabel(v.action)}
          </span>
          <div style={{ flex: 1, minWidth: 4 }} />
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.faint }}>{relativeTime(v.createdAt)}</span>
        </div>
        <button
          onClick={loadIntoEditor}
          title="Loads this version into the editor above — publish it to make it live"
          style={{
            marginTop: 6,
            padding: "3px 9px",
            borderRadius: 5,
            border: `1px solid ${LINE.strong}`,
            background: "transparent",
            color: TEXT.dim,
            fontFamily: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Load into editor
        </button>
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

function HistoryRail({ state, prompt }: { state: AiPromptsStoreState; prompt: AiPrompt }) {
  const versions = state.versions[prompt.key];
  return (
    <div style={{ flex: "0 0 232px", minWidth: 0, display: "flex", flexDirection: "column", borderLeft: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
      <div style={{ flex: "none", padding: "9px 13px", borderBottom: `1px solid ${LINE.quiet}` }}>
        <Eyebrow>History</Eyebrow>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 0 12px" }}>
        {state.versionsBusy === prompt.key && !versions ? (
          <div style={{ padding: "10px 13px", fontSize: 11.5, color: TEXT.faint }}>Reading its history…</div>
        ) : !versions || versions.length === 0 ? (
          <div style={{ padding: "10px 13px", fontSize: 11.5, lineHeight: 1.55, color: TEXT.faint, textWrap: "pretty" }}>
            No saved versions yet — save a draft or publish to create the first one.
          </div>
        ) : (
          versions.slice(0, 20).map((v) => <VersionRow key={v.id} promptKey={prompt.key} version={v} />)
        )}
      </div>
    </div>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

export function AiPromptsBody({ recordId }: { recordId?: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  // A doc opened on a specific prompt wins over whatever the store had — the
  // tab strip and the screen must never disagree about which record is open.
  const prompt = (recordId ? state.prompts.find((p) => p.key === recordId) : undefined) ?? selectedPrompt();

  if (!prompt) {
    return (
      <div style={{ flex: 1, background: SURFACE.app }}>
        <Stated>
          {state.promptsLoading
            ? "Reading the prompt list…"
            : (state.promptsError ?? "No prompts in the database yet — ai_prompts rows are admin-managed only, there is no code-level seed.")}
        </Stated>
      </div>
    );
  }

  const key = prompt.key;
  const editorText = editorTextFor(key);
  const dirty = isDirty(key);
  const resetArmedHere = state.resetArmed === key;
  const testOpen = !!state.testPanelOpen[key];

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header prompt={prompt} message={state.message} />
      {resetArmedHere && <ResetConfirmBanner prompt={prompt} busy={state.resetBusy === key} />}

      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 14px", borderBottom: `1px solid ${LINE.quiet}` }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
              {hasDraft(prompt) || dirty ? "Draft body" : "Prompt body"}
            </span>
            <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.faint }}>
              {prompt.description}
            </span>
          </div>

          <textarea
            value={editorText}
            onChange={(e) => setEditorText(key, e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              minHeight: 120,
              width: "100%",
              padding: "14px 16px",
              border: 0,
              outline: "none",
              resize: "none",
              background: SURFACE.inset,
              color: TEXT.body,
              fontFamily: FONT.mono,
              fontSize: 12.5,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
            }}
          />

          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "9px 14px", borderTop: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
            <PrimaryButton label={state.saveBusy === key ? "Saving…" : "Save draft"} onSelect={() => void saveDraft(key)} busy={state.saveBusy === key} disabled={!dirty} />
            <QuietButton label="Discard changes" onSelect={() => discardChanges(key)} disabled={!dirty} />
            <QuietButton label="Reset to default" onSelect={() => armReset(key)} tone={ACCENT_TEXT.danger} />
            <QuietButton label="Copy prompt key" onSelect={() => copyPromptKey(key)} />
            <div style={{ flex: 1, minWidth: 4 }} />
            <QuietButton
              label={testOpen ? "Hide test draft" : "Test a draft"}
              onSelect={() => toggleTestPanel(key)}
              tone={testOpen ? ACCENT.amber : TEXT.soft}
            />
            <PrimaryButton
              label={state.publishBusy === key ? "Publishing…" : "Publish"}
              onSelect={() => void publish(key)}
              busy={state.publishBusy === key}
              disabled={!dirty && !hasDraft(prompt)}
            />
          </div>

          {editorText.includes("{{") && (
            <div style={{ flex: "none", padding: "7px 14px", borderTop: `1px solid ${LINE.quiet}`, fontSize: 11, lineHeight: 1.5, color: TEXT.faint }}>
              Uses <span style={{ fontFamily: FONT.mono, color: ACCENT.info }}>{"{{placeholders}}"}</span> — dynamic content is substituted in at call time. Keep the same ones in any edit.
            </div>
          )}

          {testOpen && <TestPanel state={state} prompt={prompt} />}
        </div>

        <HistoryRail state={state} prompt={prompt} />
      </div>
    </div>
  );
}
