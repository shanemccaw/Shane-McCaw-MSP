/**
 * AI Prompts — the DB-backed prompt centre, at /adminv2/ai-prompts.
 *
 * Registers against the fixed `home` tab, alongside Services/Fulfillment: the
 * design's own `Catalog` ribbon cluster groups "AI prompts" there
 * (`Admin Shell.dc.html`), and every command this screen puts on a fixed tab
 * is `open` — it opens the prompt centre or a filtered gallery, never a
 * specific prompt's draft/publish/reset/test actions, which is exactly what
 * the "Prompt Tools" contextual tab is for (SHELL.md's audited rule).
 *
 * Reuses the real, already-built `admin-ai-prompts.ts` backend end to end —
 * list, get, versions, save-draft, publish, reset, revert, test-draft. No new
 * routes. `prompt` was already a reserved `PeekKind`/`CommandKind` (see
 * `registry/types.ts`, `theme.ts`'s `KIND_BADGE`) — this is the first screen
 * to actually resolve it.
 */

import { Copy, ExternalLink, FileClock, FlaskConical, Layers, RotateCcw, Rocket, Save, ScrollText, Undo2, X } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { AiPromptsBody } from "./AiPromptsBody";
import { AiPromptsExplorer } from "./AiPromptsExplorer";
import { AiPromptProperties } from "./AiPromptProperties";
import {
  armReset,
  clearTestResult,
  copyPromptKey,
  copyTestOutput,
  discardChanges,
  getPrompt,
  getSnapshot,
  loadVersions,
  publish,
  saveDraft,
  select,
  selectedPrompt,
  toggleTestPanel,
} from "./aiPromptsStore";
import { hasDraft, isModifiedFromDefault, promptState, promptStateTone, relativeTime, actionTone } from "./aiPromptTypes";

const ROUTE = "/ai-prompts";

/** Opens the screen on one prompt, as a record doc so the contextual tab comes with it. */
function openPrompt(key: string) {
  select(key);
  getShellApi()?.openDoc({ kind: "prompt", id: key, screenId: "ai-prompts" });
}

function galleryRows(): GalleryRow[] {
  return getSnapshot().prompts.map((p) => {
    const state = promptState(p);
    return {
      id: p.key,
      group: p.category,
      tile: state === "draft pending" ? "DFT" : state === "customised" ? "CUS" : "DEF",
      name: p.name,
      head: state,
      sub: p.featureArea ? `${p.featureArea}${p.model ? ` · ${p.model}` : ""}` : (p.model ?? p.key),
      on: getSnapshot().selected === p.key,
      onSelect: () => getShellApi()?.openPeek("prompt", p.key),
    };
  });
}

function draftGalleryRows(): GalleryRow[] {
  return getSnapshot()
    .prompts.filter(hasDraft)
    .map((p) => ({
      id: p.key,
      group: p.category,
      tile: "DFT",
      name: p.name,
      head: p.category,
      sub: p.featureArea || p.key,
      on: getSnapshot().selected === p.key,
      onSelect: () => getShellApi()?.openPeek("prompt", p.key),
    }));
}

registerScreen({
  id: "ai-prompts",
  title: "AI Prompts",
  area: "ai-prompts",
  icon: ScrollText,
  route: ROUTE,
  render: (ctx) => <AiPromptsBody recordId={ctx.recordId} />,

  left: { title: "AI Prompts", render: () => <AiPromptsExplorer /> },
  right: { title: "Prompt", render: () => <AiPromptProperties /> },

  ribbon: [
    {
      tab: "home",
      order: 60,
      group: {
        label: "AI Prompts",
        large: [
          {
            label: "Prompt centre",
            icon: ScrollText,
            intent: "open",
            onSelect: () => {
              const key = selectedPrompt()?.key;
              if (key) openPrompt(key);
              else getShellApi()?.navigate(ROUTE);
            },
          },
        ],
        small: [
          {
            label: "Open a prompt",
            icon: Layers,
            intent: "open",
            onSelect: () => getShellApi()?.navigate(ROUTE),
            gallery: {
              id: "ai-prompts",
              title: "Prompts",
              searchable: true,
              searchPlaceholder: "Search prompts",
              get rows() {
                return galleryRows();
              },
            },
          },
          {
            label: "Drafts pending",
            icon: FileClock,
            intent: "open",
            color: ACCENT.amber,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            gallery: {
              id: "ai-prompts-drafts",
              title: "Drafts pending",
              searchable: false,
              get rows() {
                return draftGalleryRows();
              },
              footer: { label: "Open every prompt…", onSelect: () => getShellApi()?.navigate(ROUTE) },
            },
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    const prompt = (ctx.recordId ? getPrompt(ctx.recordId) : undefined) ?? selectedPrompt();
    if (!prompt) return null;
    const key = prompt.key;

    return {
      id: "prompt-tools",
      label: "Prompt Tools",
      groups: [
        {
          label: "Stage",
          large: [
            {
              label: "Save draft",
              icon: Save,
              intent: "record",
              // Colour tracks dirty state live — see aiPromptsStore.ts's
              // `syncSaveRibbon`; this spec is only re-evaluated on
              // navigation, not on every keystroke.
              liveKey: "ai-prompts-save",
              onSelect: () => void saveDraft(key),
            },
          ],
          small: [
            { label: "Discard changes", icon: Undo2, intent: "record", onSelect: () => discardChanges(key) },
            { label: "Reset to default", icon: RotateCcw, intent: "record", color: ACCENT.danger, onSelect: () => armReset(key) },
            { label: "Copy prompt key", icon: Copy, intent: "record", onSelect: () => copyPromptKey(key) },
          ],
        },
        {
          label: "Go live",
          large: [{ label: "Publish", icon: Rocket, intent: "record", color: ACCENT.greenSoft, onSelect: () => void publish(key) }],
          small: prompt.featureRoute
            ? [
                {
                  label: "Where it runs",
                  icon: ExternalLink,
                  intent: "record",
                  onSelect: () => window.open(`/admin-panel${prompt.featureRoute}`, "_blank", "noopener"),
                },
              ]
            : undefined,
        },
        {
          label: "Try it",
          large: [{ label: "Test a draft", icon: FlaskConical, intent: "record", onSelect: () => toggleTestPanel(key) }],
          small: [
            { label: "Clear the result", icon: X, intent: "record", onSelect: () => clearTestResult() },
            { label: "Copy the output", icon: Copy, intent: "record", onSelect: () => copyTestOutput() },
          ],
        },
      ],
    };
  },

  peeks: {
    prompt: (id) => {
      const prompt = getPrompt(id);
      if (!prompt) return null;

      // First look at a prompt without visiting the editor first — warm its
      // history lazily so the list section fills in on the next render.
      const snap = getSnapshot();
      if (!snap.versions[id] && snap.versionsBusy !== id) void loadVersions(id);

      const state = promptState(prompt);
      const versions = snap.versions[id] ?? [];

      return {
        kind: "prompt",
        eyebrow: "AI PROMPT",
        title: prompt.name,
        sub: prompt.description || prompt.key,
        icon: ScrollText,
        tone: promptStateTone(state),
        tag: prompt.category,
        tagTone: ACCENT.info,
        facts: [
          { label: "State", value: state, prose: true },
          { label: "What runs now", value: isModifiedFromDefault(prompt) ? "your published body" : "its default", prose: true },
          { label: "Updated", value: relativeTime(prompt.updatedAt), prose: true },
          { label: "Model", value: prompt.model ?? "not pinned", prose: true },
        ],
        body: { title: "Published body", content: prompt.promptBody.slice(0, 600) },
        list:
          versions.length > 0
            ? {
                title: "Recent versions",
                rows: versions.slice(0, 5).map((v) => ({
                  id: String(v.id),
                  mark: v.action,
                  tone: actionTone(v.action),
                  name: `v${v.versionNumber}`,
                  sub: relativeTime(v.createdAt),
                })),
              }
            : undefined,
        open: () => openPrompt(prompt.key),
        openLabel: "Open the prompt",
        actions: hasDraft(prompt)
          ? [{ label: "Publish the draft", tone: "primary", confirm: true, onSelect: () => void publish(prompt.key) }]
          : undefined,
      };
    },
  },

  commands: () => {
    const state = getSnapshot();
    const items: CommandItem[] = [];

    for (const p of state.prompts) {
      const st = promptState(p);
      items.push({
        id: `rec:prompt-${p.key}`,
        type: "record",
        kind: "prompt",
        name: p.name,
        sub: `${p.category} · ${p.featureArea || p.key}`,
        tag: st !== "default" ? st : undefined,
        area: "ai-prompts",
        run: () => getShellApi()?.openPeek("prompt", p.key),
      });
    }

    // Only an answer once the list has genuinely loaded — a "0 pending" before
    // the real fetch resolved would be a reassurance nobody earned.
    if (state.promptsLoaded) {
      const draftCount = state.prompts.filter(hasDraft).length;
      items.push({
        id: "ans:ai-prompts-drafts-pending",
        type: "answer",
        kind: "answer",
        name: "Prompts with a pending draft",
        sub: draftCount === 0 ? "everything published matches its draft" : "waiting on Publish",
        area: "ai-prompts",
        live: String(draftCount),
        run: () => getShellApi()?.navigate(ROUTE),
      });
    }

    return items;
  },
});
