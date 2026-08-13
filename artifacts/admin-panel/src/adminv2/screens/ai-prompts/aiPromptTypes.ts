/**
 * Wire shapes and small normalisers for the AI Prompts screen.
 *
 * Everything here mirrors `routes/admin-ai-prompts.ts` exactly — the same
 * DB-backed prompt centre the old admin panel's `PromptCenter.tsx` /
 * `PromptCenterEdit.tsx` already read, just behind the shell contract instead
 * of a standalone page. Per #500, `ai_prompts` rows are admin-managed only —
 * there is no code-level seeding, so a fresh database can legitimately have
 * zero rows here. Nothing in this screen invents a row, a version, or a
 * "supports test draft" answer the server did not actually say.
 */

import { ACCENT, ACCENT_TEXT, TEXT } from "../../theme";

/** One `ai_prompts` row, as GET /admin/ai-prompts and its siblings return it. */
export interface AiPrompt {
  id: number;
  key: string;
  name: string;
  description: string;
  category: AiPromptCategory;
  featureArea: string;
  featureRoute: string;
  model: string | null;
  /** The live/published body — what `getPrompt()` reads at call time. */
  promptBody: string;
  defaultBody: string;
  /** Null when there is no pending draft. Never read by runtime generation. */
  draftBody: string | null;
  updatedAt: string;
}

/** One `ai_prompt_versions` row. */
export interface AiPromptVersion {
  id: number;
  promptId: number;
  versionNumber: number;
  body: string;
  action: "draft" | "publish" | "reset";
  createdAt: string;
}

/** The DB enum, in the order the list endpoint sorts by. */
export const AI_PROMPT_CATEGORIES = [
  "scripting",
  "marketing",
  "advisory",
  "inbox",
  "classification",
  "artifacts",
  "insights",
] as const;
export type AiPromptCategory = (typeof AI_PROMPT_CATEGORIES)[number];

export function hasDraft(prompt: AiPrompt): boolean {
  return prompt.draftBody !== null && prompt.draftBody !== undefined && prompt.draftBody !== "";
}

export function isModifiedFromDefault(prompt: AiPrompt): boolean {
  return prompt.promptBody !== prompt.defaultBody || hasDraft(prompt);
}

/** "draft pending" beats "customised" beats "default" — matches the old admin UI's own badge priority. */
export function promptState(prompt: AiPrompt): "draft pending" | "customised" | "default" {
  if (hasDraft(prompt)) return "draft pending";
  if (prompt.promptBody !== prompt.defaultBody) return "customised";
  return "default";
}

export function promptStateTone(state: ReturnType<typeof promptState>): string {
  switch (state) {
    case "draft pending":
      return ACCENT.amber;
    case "customised":
      return ACCENT.greenSoft;
    default:
      return TEXT.dim;
  }
}

export function actionTone(action: AiPromptVersion["action"]): string {
  switch (action) {
    case "draft":
      return ACCENT.info;
    case "publish":
      return ACCENT_TEXT.green;
    case "reset":
      return ACCENT.amber;
  }
}

export function actionLabel(action: AiPromptVersion["action"]): string {
  switch (action) {
    case "draft":
      return "draft saved";
    case "publish":
      return "published";
    case "reset":
      return "reset to default";
  }
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
