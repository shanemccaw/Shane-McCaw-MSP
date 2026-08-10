/**
 * Content Studio — LinkedIn post composition/scheduling, at `/adminv2/content-studio`.
 *
 * Phase A of Git #601's build plan (posted as a comment on #601) was
 * scaffolding only (Git #681): registration, ribbon, empty-state body.
 * Phase B (Git #682) landed the `post` peek Compose opens, with in-memory
 * state in `contentStudioStore.ts`. This file now also carries Phase C
 * (Git #683) — the real Queue gallery. Phase D adds palette + Watch wiring,
 * Phase E undo/redo, Phase F the scheduling backend (a real `content_posts`
 * table replacing the in-memory store), Phase G optional in-peek AI Assist.
 *
 * Per SHELL.md's updated Home rule (section 1): `content` owns the actions,
 * `home` gets one mirrored primary command — Compose, here — not a second
 * copy of every group.
 */

import { PenSquare, ListChecks } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { GalleryRow } from "../../registry/types";
import { ContentStudioBody } from "./ContentStudioBody";
import {
  createDraftPost,
  deletePost,
  getSnapshot,
  postById,
  schedulePost,
  STATUS_CODE,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_TONE,
  updatePostField,
  type Post,
} from "./contentStudioStore";

const ROUTE = "/content-studio";

/** Always starts a fresh draft — Queue rows reopen an existing one via `openPeek("post", id)` instead. */
function compose(): void {
  const post = createDraftPost();
  getShellApi()?.openPeek("post", post.id);
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
  ],

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
          { key: "body", label: "Body", value: post.body, area: true, mono: false, onChange: (next) => updatePostField(post.id, { body: next }) },
          { key: "scheduledFor", label: "Scheduled for", value: post.scheduledFor, onChange: (next) => updatePostField(post.id, { scheduledFor: next }) },
        ],
        actions: [
          { label: "Schedule", tone: "primary", onSelect: () => schedulePost(post.id) },
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => deletePost(post.id) },
        ],
      };
    },
  },
});
