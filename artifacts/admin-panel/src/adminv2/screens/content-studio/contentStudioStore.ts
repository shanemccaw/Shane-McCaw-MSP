/**
 * Content Studio's post store — plain external state, not React state, for
 * the same reason `marketingStore.ts` is one (see its doc comment): the
 * `content`/`home` ribbon groups (`screens/content-studio/index.tsx`) are
 * built once, at `registerScreen()` module-load time, outside any component.
 *
 * Phase B only: posts live in memory here and are lost on reload — there is
 * no `content_posts` table yet. Phase F swaps this for a real
 * backend-backed store shaped like `marketingStore.ts`'s; this file's public
 * functions (`postById`, `createDraftPost`, `updatePostField`,
 * `schedulePost`, `deletePost`) are named to survive that swap without the
 * `post` peek needing to change.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";

const log = logger.child({ channel: "admin.content-studio" });

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

interface ContentStudioState {
  posts: Post[];
}

let state: ContentStudioState = { posts: [] };

type Listener = () => void;
const listeners = new Set<Listener>();

function setState(patch: Partial<ContentStudioState>): void {
  state = { ...state, ...patch };
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

/** The Compose button — always starts a fresh draft, empty body, no schedule yet. */
export function createDraftPost(): Post {
  const post: Post = { id: `local-${nextId++}`, body: "", scheduledFor: "", status: "draft" };
  setState({ posts: [post, ...state.posts] });
  return post;
}

/** Writes go straight through — SHELL.md section 3: no save step, no dirty state inside a peek. */
export function updatePostField(id: string, patch: Partial<Pick<Post, "body" | "scheduledFor">>): void {
  setState({ posts: state.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

/** Phase F wires this to the real cron dispatcher; here it just flips the status. */
export function schedulePost(id: string): void {
  if (!postById(id)) return;
  setState({ posts: state.posts.map((p) => (p.id === id ? { ...p, status: "scheduled" } : p)) });
  log.info({ postId: id }, "post scheduled");
}

export function deletePost(id: string): void {
  setState({ posts: state.posts.filter((p) => p.id !== id) });
  log.info({ postId: id }, "post deleted");
}

/** Test seam. Not used by the app. */
export function resetContentStudioStore(): void {
  listeners.clear();
  nextId = 1;
  state = { posts: [] };
}
