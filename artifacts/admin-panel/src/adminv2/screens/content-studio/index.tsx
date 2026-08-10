/**
 * Content Studio — LinkedIn post composition/scheduling, at `/adminv2/content-studio`.
 *
 * Phase A of Git #601's build plan (posted as a comment on #601) was
 * scaffolding only (Git #681): registration, ribbon, empty-state body.
 * Phase B (Git #682) landed the `post` peek Compose opens. Phase C (Git
 * #683) landed the real Queue gallery. Phase D (Git #684) added palette
 * commands and the Watch tab's "Failed posts" wiring. Phase E (Git #685)
 * wrapped every mutation with undo/redo. Phase F (Git #686) swapped
 * `contentStudioStore.ts`'s in-memory array for a real `content_posts`
 * table and the seeded LinkedIn dispatcher workflow — every call site below
 * that used to call the store synchronously now awaits/voids a promise, but
 * the peek/gallery/palette/undo *shapes* are unchanged. Phase G is optional
 * in-peek AI Assist.
 *
 * Per SHELL.md's updated Home rule (section 1): `content` owns the actions,
 * `home` gets one mirrored primary command — Compose, here — not a second
 * copy of every group.
 */

import { AlertTriangle, PenSquare, ListChecks } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { ContentStudioBody } from "./ContentStudioBody";
import {
  createDraftPost,
  deletePost,
  failedPostsCount,
  getSnapshot,
  postById,
  scheduledThisWeekCount,
  schedulePost,
  STATUS_CODE,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_TONE,
  updatePostField,
  WATCH_FAILED_KEY,
  type Post,
} from "./contentStudioStore";

const ROUTE = "/content-studio";

/** Always starts a fresh draft — Queue rows reopen an existing one via `openPeek("post", id)` instead. */
function compose(): void {
  void createDraftPost().then((post) => {
    if (post) getShellApi()?.openPeek("post", post.id);
  });
}

/** First line of the body, or a stated placeholder for a still-blank draft — never an empty row name. */
function firstLine(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "Untitled draft";
  const line = trimmed.split(/\r?\n/)[0].trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

const TIME_FRAGMENT = /(\d{1,2}):\d{2}/;

/** 2-3 mono chars: the scheduled hour when there is one to show, otherwise the status code (SHELL.md section 5 — a tile is a code, not an icon). */
function tileFor(post: Post): string {
  if (post.status === "scheduled") {
    const match = post.scheduledFor.match(TIME_FRAGMENT);
    if (match) return `${match[1].padStart(2, "0")}h`;
  }
  return STATUS_CODE[post.status];
}

/** Banded by status, in a fixed Draft → Scheduled → Posted → Failed order — the shell only starts a new band when a row's `group` differs from the row directly before it, so the source array has to already be in band order. */
function contentQueueRows(): GalleryRow[] {
  const posts = [...getSnapshot().posts].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return posts.map((post) => ({
    id: post.id,
    group: STATUS_LABEL[post.status],
    tile: tileFor(post),
    name: firstLine(post.body),
    sub: post.scheduledFor || "Not scheduled",
    on: false,
    onSelect: () => getShellApi()?.openPeek("post", post.id),
  }));
}

registerScreen({
  id: "content-studio",
  title: "Content Studio",
  area: "content",
  icon: PenSquare,
  route: ROUTE,

  render: () => <ContentStudioBody />,

  ribbon: [
    {
      tab: "content",
      order: 40,
      group: {
        label: "Content Studio",
        large: [{ label: "Compose", icon: PenSquare, intent: "create", onSelect: compose }],
        small: [
          {
            label: "Queue",
            icon: ListChecks,
            intent: "open",
            onSelect: () => {},
            gallery: {
              id: "content-queue",
              title: "Queue",
              searchable: true,
              // Getter, not a static array — `ribbon` is built once at
              // module-load time, so this has to re-read the store on every
              // open (SHELL.md section 5: "rows carry real data").
              get rows() {
                return contentQueueRows();
              },
              footer: { label: "New draft", onSelect: compose },
            },
          },
        ],
      },
    },
    {
      tab: "home",
      order: 40,
      group: {
        label: "Content Studio",
        large: [{ label: "Compose", icon: PenSquare, intent: "create", onSelect: compose }],
      },
    },
    {
      // Failed posts (retries exhausted) surface here, not in Content
      // Studio itself — the DLQ/exceptions pattern `observability/index.tsx`
      // already established, and the same `liveKey` overlay
      // `marketing/index.tsx`'s "Campaigns waiting on you" button uses,
      // since a static `color`/`label` would freeze at whatever it was when
      // this module first loaded (SHELL.md section 6: the only other place
      // besides a bottom-panel tab a live number belongs, because this one
      // is actionable).
      tab: "watch",
      order: 40,
      group: {
        label: "Content Studio",
        small: [
          {
            label: "Failed posts",
            icon: AlertTriangle,
            intent: "open",
            color: failedPostsCount() > 0 ? ACCENT.danger : undefined,
            liveKey: WATCH_FAILED_KEY,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            title: "Posts that failed to publish after retries were exhausted",
          },
        ],
      },
    },
  ],

  commands: (): CommandItem[] => {
    const { posts } = getSnapshot();

    const postRecords: CommandItem[] = posts.map((post) => ({
      id: `rec:post-${post.id}`,
      type: "record",
      kind: "post",
      name: firstLine(post.body),
      sub: post.scheduledFor || "Not scheduled",
      tag: STATUS_LABEL[post.status],
      area: "content",
      run: () => getShellApi()?.openPeek("post", post.id),
    }));

    const answers: CommandItem[] = [
      {
        id: "ans:content-studio-scheduled-week",
        type: "answer",
        name: "Posts scheduled this week",
        sub: "Scheduled, next 7 days",
        area: "content",
        live: String(scheduledThisWeekCount()),
        run: () => getShellApi()?.navigate(ROUTE),
      },
    ];

    return [...postRecords, ...answers];
  },

  peeks: {
    post: (id) => {
      const post = postById(id);
      if (!post) return null;

      return {
        kind: "post",
        eyebrow: "POST",
        title: post.body.trim() ? post.body.trim().slice(0, 60) : "New post",
        sub: post.scheduledFor || "Not scheduled",
        icon: PenSquare,
        tone: STATUS_TONE[post.status],
        tag: STATUS_LABEL[post.status],
        tagTone: STATUS_TONE[post.status],
        edits: [
          { key: "body", label: "Body", value: post.body, area: true, mono: false, onChange: (next) => void updatePostField(post.id, { body: next }) },
          { key: "scheduledFor", label: "Scheduled for", value: post.scheduledFor, onChange: (next) => void updatePostField(post.id, { scheduledFor: next }) },
        ],
        actions: [
          { label: "Schedule", tone: "primary", onSelect: () => void schedulePost(post.id) },
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void deletePost(post.id) },
        ],
      };
    },
  },
});
