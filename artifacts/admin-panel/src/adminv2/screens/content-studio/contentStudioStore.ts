/**
 * Content Studio's post store — plain external state, not React state, for
 * the same reason `marketingStore.ts` is one (see its doc comment): the
 * `content`/`home` ribbon groups (`screens/content-studio/index.tsx`) are
 * built once, at `registerScreen()` module-load time, outside any component.
 *
 * Posts live in memory here and are lost on reload — there is no
 * `content_posts` table yet. Phase F swaps this for a real backend-backed
 * store shaped like `marketingStore.ts`'s; this file's public functions
 * (`postById`, `createDraftPost`, `updatePostField`, `schedulePost`,
 * `deletePost`) are named to survive that swap without the `post` peek
 * needing to change.
 *
 * Phase D (Git #684) added `WATCH_FAILED_KEY`'s live-ribbon sync, following
 * `marketingStore.ts`'s own `WATCH_WAITING_KEY`/`syncLiveRibbon` pattern —
 * the Watch tab's "Failed posts" button in `index.tsx` reads this, not a
 * static count, since `ribbon` is built once at `registerScreen()`
 * module-load time.
 *
 * Phase E (Git #685) wrapped every mutation with `pushUndo`, following
 * `screens/build-tracker/buildTrackerStore.ts` — SHELL.md section 8's named
 * reference implementation — exactly: `updatePostField`/`setPostStatus`
 * capture only the changed field(s) and revert by calling themselves with
 * the prior values and `_skipUndo = true` (the generic-patch recipe);
 * `createDraftPost`/`deletePost` revert into each other unskipped, the same
 * mutual create↔delete pairing `createEpic`/`deleteEpic` use. No
 * `clearHistory(SCREEN_ID)` call exists yet — there is no full refresh/sync
 * in this phase (no backend until Phase F) for one to follow.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import { pushUndo as _pushUndo } from "../../shell/undoStore";

const log = logger.child({ channel: "admin.content-studio" });

/** Matches the `id` passed to `registerScreen()` in `index.tsx`. */
const SCREEN_ID = "content-studio";

function pushUndo(entry: Parameters<typeof _pushUndo>[1]): void {
  _pushUndo(SCREEN_ID, entry);
}

/** First line of a post's body, trimmed for an undo label — "untitled draft" for a still-blank one. Not exported; `index.tsx`'s `firstLine()` is the fuller row/palette version. */
function labelBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "untitled draft";
  return trimmed.split(/\r?\n/)[0].trim().slice(0, 40);
}

export type PostStatus = "draft" | "scheduled" | "posted" | "failed";

export interface Post {
  id: string;
  body: string;
  scheduledFor: string;
  status: PostStatus;
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  posted: "Posted",
  failed: "Failed",
};

export const STATUS_TONE: Record<PostStatus, string> = {
  draft: ACCENT.info,
  scheduled: ACCENT.amber,
  posted: ACCENT.green,
  failed: ACCENT.danger,
};

/** The Queue gallery's row tile for a status with no scheduled-time fragment to show instead — see `index.tsx`'s `tileFor`. */
export const STATUS_CODE: Record<PostStatus, string> = {
  draft: "DFT",
  scheduled: "SCH",
  posted: "PST",
  failed: "FLD",
};

/** Draft → Scheduled → Posted → Failed — the Queue gallery's fixed band order (`index.tsx`'s `contentQueueRows`). */
export const STATUS_ORDER: PostStatus[] = ["draft", "scheduled", "posted", "failed"];

interface ContentStudioState {
  posts: Post[];
}

let state: ContentStudioState = { posts: [] };

type Listener = () => void;
const listeners = new Set<Listener>();

/** The Watch tab's "Failed posts" button's live key — see `liveRibbon.ts`'s doc comment for why this can't just be a static `live:` number. */
export const WATCH_FAILED_KEY = "content-studio:watch-failed";

/** Retries exhausted (Phase F wires the real dispatcher that produces these — this only reads the status). */
export function failedPostsCount(s: ContentStudioState = state): number {
  return s.posts.filter((p) => p.status === "failed").length;
}

/** `scheduledFor` is freeform text (no date picker yet), so this only counts entries that parse as a real date within the next 7 days. */
export function scheduledThisWeekCount(s: ContentStudioState = state): number {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return s.posts.filter((p) => {
    if (p.status !== "scheduled") return false;
    const t = Date.parse(p.scheduledFor);
    return !Number.isNaN(t) && t >= now && t <= now + weekMs;
  }).length;
}

function syncLiveRibbon(): void {
  const count = failedPostsCount();
  setLiveRibbonValue(WATCH_FAILED_KEY, count > 0 ? { label: `${count} failed`, color: ACCENT.danger } : { label: "No failed posts" });
}

function setState(patch: Partial<ContentStudioState>): void {
  state = { ...state, ...patch };
  syncLiveRibbon();
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ContentStudioState {
  return state;
}

export function postById(id: string | null | undefined): Post | undefined {
  if (!id) return undefined;
  return state.posts.find((p) => p.id === id);
}

let nextId = 1;

/** The Compose button — always starts a fresh draft, empty body, no schedule yet. Undo deletes the new record. */
export function createDraftPost(): Post {
  const post: Post = { id: `local-${nextId++}`, body: "", scheduledFor: "", status: "draft" };
  setState({ posts: [post, ...state.posts] });
  pushUndo({ label: "Create draft", revert: async () => { deletePost(post.id); } });
  return post;
}

/** Writes go straight through — SHELL.md section 3: no save step, no dirty state inside a peek. */
export function updatePostField(id: string, patch: Partial<Pick<Post, "body" | "scheduledFor">>, _skipUndo = false): void {
  const existing = postById(id);
  if (!_skipUndo && existing) {
    const prevFields = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (existing as any)[k]]),
    ) as Partial<Pick<Post, "body" | "scheduledFor">>;
    pushUndo({
      label: `Edit draft "${labelBody(existing.body)}"`,
      revert: async () => { updatePostField(id, prevFields, true); },
    });
  }
  setState({ posts: state.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

/** Generic status setter behind `schedulePost` — same capture-and-revert shape as `updatePostField`, kept private since nothing outside this file needs to set an arbitrary status yet. */
function setPostStatus(id: string, status: PostStatus, _skipUndo = false): void {
  const existing = postById(id);
  if (!_skipUndo && existing && existing.status !== status) {
    const prevStatus = existing.status;
    pushUndo({
      label: `Schedule "${labelBody(existing.body)}"`,
      revert: async () => { setPostStatus(id, prevStatus, true); },
    });
  }
  setState({ posts: state.posts.map((p) => (p.id === id ? { ...p, status } : p)) });
}

/** Phase F wires this to the real cron dispatcher; here it just flips the status. */
export function schedulePost(id: string): void {
  if (!postById(id)) return;
  setPostStatus(id, "scheduled");
  log.info({ postId: id }, "post scheduled");
}

/** Undo recreates the exact snapshot — same identity (id), not a fresh draft. */
function restorePost(snapshot: Post): void {
  setState({ posts: [snapshot, ...state.posts] });
  pushUndo({ label: "Create draft", revert: async () => { deletePost(snapshot.id); } });
}

export function deletePost(id: string): void {
  const existing = postById(id);
  if (existing) {
    pushUndo({
      label: `Delete "${labelBody(existing.body)}"`,
      revert: async () => { restorePost(existing); },
    });
  }
  setState({ posts: state.posts.filter((p) => p.id !== id) });
  log.info({ postId: id }, "post deleted");
}

/** Test seam. Not used by the app. */
export function resetContentStudioStore(): void {
  listeners.clear();
  nextId = 1;
  state = { posts: [] };
}
