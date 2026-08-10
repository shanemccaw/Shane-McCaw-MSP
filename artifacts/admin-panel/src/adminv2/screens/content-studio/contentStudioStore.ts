/**
 * Content Studio's post store — plain external state, not React state, for
 * the same reason `marketingStore.ts` is one (see its doc comment): the
 * `content`/`home` ribbon groups (`screens/content-studio/index.tsx`) are
 * built once, at `registerScreen()` module-load time, outside any component.
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
 * mutual create↔delete pairing `createEpic`/`deleteEpic` use.
 *
 * Phase F (Git #686) swapped the in-memory array for a real
 * `content_posts` table (`lib/db/src/schema/index.ts`, migration written but
 * NOT run — see `lib/db/migrations/manual/2026-08-10-content-posts-table-686.sql`),
 * following `marketingStore.ts`'s exact fetch-backed shape:
 * `adminFetchRef`/`configureContentStudioFetch`/`warmContentStudio`, warmed
 * once by `ContentStudioFetchBridge.tsx` (always mounted, see `AdminV2.tsx`)
 * for the same reason `MarketingFetchBridge` is — the Queue gallery and the
 * Watch tab's "Failed posts" count are both built from this store at ribbon
 * render time, so they must be loaded whether or not `/content-studio` has
 * ever been the active screen. The five public functions this file has kept
 * stable since Phase B (`postById`, `createDraftPost`, `updatePostField`,
 * `schedulePost`, `deletePost`) now hit the real API instead of a local
 * array, but their names and call shapes are unchanged, so the `post` peek,
 * the Queue gallery, the palette `commands()`, and every Phase E undo entry
 * needed no changes beyond awaiting/void-ing what were previously
 * synchronous calls (`index.tsx`).
 *
 * The actual LinkedIn posting, retry/backoff and dead-letter escalation are
 * NOT in this file — they live in the seeded "__system__: Content Studio
 * LinkedIn Dispatcher" workflow (`seed-system-workflows.ts`), which reuses
 * the existing `post_linkedin` node (`workflow-executor.ts`,
 * LINKEDIN_ACCESS_TOKEN/LINKEDIN_ORG_ID, UGC Posts API) and the workflow
 * engine's own `retry` node, fired on a schedule trigger's per-record
 * fan-out over `content_posts` (`triggerScheduledWorkflows` in
 * `workflow-executor.ts`, already the platform's live cron mechanism — see
 * `artifacts/api-server/src/index.ts`). This store only owns the row
 * (create/edit/schedule/delete); it never talks to LinkedIn.
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

/** The server's `content_posts` row shape — `id` numeric, `scheduledFor`/timestamps ISO strings or null. */
interface ContentPostRow {
  id: number;
  body: string;
  status: PostStatus;
  scheduledFor: string | null;
}

function fromRow(row: ContentPostRow): Post {
  return { id: String(row.id), body: row.body, scheduledFor: row.scheduledFor ?? "", status: row.status };
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
  postsLoading: boolean;
  postsError: string | null;
}

let state: ContentStudioState = { posts: [], postsLoading: false, postsError: null };

type Listener = () => void;
const listeners = new Set<Listener>();

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
let adminFetchRef: AdminFetch | null = null;

/** Called by `ContentStudioFetchBridge` on every render — see file doc comment. */
export function configureContentStudioFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads `{error}` out of a failed response body, falling back to the status line. */
async function failureOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON — the status is all there is */
  }
  return `${res.status} ${res.statusText}`;
}

/** The Watch tab's "Failed posts" button's live key — see `liveRibbon.ts`'s doc comment for why this can't just be a static `live:` number. */
export const WATCH_FAILED_KEY = "content-studio:watch-failed";

/** Retries exhausted (the dispatcher workflow's exhausted-retry branch sets this — see the file doc comment). */
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

// ─── Warm load ────────────────────────────────────────────────────────────────

let warmed = false;

/** Warm load — see the file doc comment. Safe to call repeatedly. */
export function warmContentStudio(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadPosts();
}

export async function loadPosts(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.postsLoading || state.posts.length > 0)) return;
  setState({ postsLoading: true, postsError: null });
  try {
    const res = await adminFetchRef("/api/admin/content-studio/posts");
    if (!res.ok) {
      setState({ postsLoading: false, postsError: await failureOf(res) });
      return;
    }
    const rows = (await res.json()) as ContentPostRow[];
    setState({ postsLoading: false, posts: rows.map(fromRow) });
  } catch (err) {
    log.warn({ err }, "content_posts failed to load");
    setState({ postsLoading: false, postsError: errorText(err) });
  }
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** The Compose button — always starts a fresh draft, empty body, no schedule yet. Undo deletes the new record. */
export async function createDraftPost(): Promise<Post | null> {
  if (!adminFetchRef) return null;
  try {
    const res = await adminFetchRef("/api/admin/content-studio/posts", { method: "POST" });
    if (!res.ok) {
      log.warn({ status: res.status }, "createDraftPost failed");
      return null;
    }
    const post = fromRow((await res.json()) as ContentPostRow);
    setState({ posts: [post, ...state.posts] });
    pushUndo({ label: "Create draft", revert: async () => { await deletePost(post.id); } });
    return post;
  } catch (err) {
    log.warn({ err }, "createDraftPost failed");
    return null;
  }
}

/** Writes go straight through — SHELL.md section 3: no save step, no dirty state inside a peek. */
export async function updatePostField(id: string, patch: Partial<Pick<Post, "body" | "scheduledFor">>, _skipUndo = false): Promise<void> {
  if (!adminFetchRef) return;
  const existing = postById(id);
  if (!_skipUndo && existing) {
    const prevFields = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (existing as any)[k]]),
    ) as Partial<Pick<Post, "body" | "scheduledFor">>;
    pushUndo({
      label: `Edit draft "${labelBody(existing.body)}"`,
      revert: async () => { await updatePostField(id, prevFields, true); },
    });
  }
  // Optimistic — the peek has no save step, so the field updates immediately;
  // a failed PATCH is logged but not rolled back (matches Phase B-E's own
  // no-dirty-state contract, which never modeled a failure path either).
  setState({ posts: state.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  try {
    const res = await adminFetchRef(`/api/admin/content-studio/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) log.warn({ id, status: res.status }, "updatePostField failed to persist");
  } catch (err) {
    log.warn({ err, id }, "updatePostField failed to persist");
  }
}

/** Generic status setter behind `schedulePost` — same capture-and-revert shape as `updatePostField`, kept private since nothing outside this file needs to set an arbitrary status yet. */
async function setPostStatus(id: string, status: PostStatus, _skipUndo = false): Promise<void> {
  if (!adminFetchRef) return;
  const existing = postById(id);
  if (!_skipUndo && existing && existing.status !== status) {
    const prevStatus = existing.status;
    pushUndo({
      label: `Schedule "${labelBody(existing.body)}"`,
      revert: async () => { await setPostStatus(id, prevStatus, true); },
    });
  }
  setState({ posts: state.posts.map((p) => (p.id === id ? { ...p, status } : p)) });
  try {
    // "scheduled" is the only status this store's own UI sets — the dispatcher
    // workflow owns the posted/failed transitions server-side. A future
    // status here would need its own endpoint; nothing calls one yet.
    const res = await adminFetchRef(`/api/admin/content-studio/posts/${id}/schedule`, { method: "POST" });
    if (!res.ok) log.warn({ id, status: res.status }, "setPostStatus failed to persist");
  } catch (err) {
    log.warn({ err, id }, "setPostStatus failed to persist");
  }
}

/** The dispatcher workflow (seed-system-workflows.ts) fires the real LinkedIn post and owns the posted/failed transitions; this just marks the row due. */
export async function schedulePost(id: string): Promise<void> {
  if (!postById(id)) return;
  await setPostStatus(id, "scheduled");
  log.info({ postId: id }, "post scheduled");
}

/** Undo recreates the row — best-effort: restores body/schedule, but a snapshot whose status was posted/failed (not draft/scheduled) comes back as a fresh draft, since there is no endpoint to force an arbitrary status on create. Rare in practice — deleting an already-posted post is not the normal flow. */
async function restorePost(snapshot: Post): Promise<void> {
  if (!adminFetchRef) return;
  const created = await createDraftPost();
  if (!created) return;
  await updatePostField(created.id, { body: snapshot.body, scheduledFor: snapshot.scheduledFor }, true);
  if (snapshot.status === "scheduled") await setPostStatus(created.id, "scheduled", true);
}

export async function deletePost(id: string): Promise<void> {
  if (!adminFetchRef) return;
  const existing = postById(id);
  if (existing) {
    pushUndo({
      label: `Delete "${labelBody(existing.body)}"`,
      revert: async () => { await restorePost(existing); },
    });
  }
  setState({ posts: state.posts.filter((p) => p.id !== id) });
  try {
    const res = await adminFetchRef(`/api/admin/content-studio/posts/${id}`, { method: "DELETE" });
    if (!res.ok) log.warn({ id, status: res.status }, "deletePost failed to persist");
  } catch (err) {
    log.warn({ err, id }, "deletePost failed to persist");
  }
  log.info({ postId: id }, "post deleted");
}

/** Test seam. Not used by the app. */
export function resetContentStudioStore(): void {
  listeners.clear();
  adminFetchRef = null;
  warmed = false;
  state = { posts: [], postsLoading: false, postsError: null };
}
