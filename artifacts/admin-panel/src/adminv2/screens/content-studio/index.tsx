/**
 * Content Studio — LinkedIn post composition/scheduling, at `/adminv2/content-studio`.
 *
 * Phase A of Git #601's build plan (posted as a comment on #601) was
 * scaffolding only (Git #681): registration, ribbon, empty-state body. This
 * file now also carries Phase B (Git #682) — the `post` peek Compose opens,
 * with in-memory state in `contentStudioStore.ts`. Phase C adds a real Queue
 * gallery, Phase D palette + Watch wiring, Phase E undo/redo, Phase F the
 * scheduling backend (a real `content_posts` table replacing the in-memory
 * store), Phase G optional in-peek AI Assist.
 *
 * Per SHELL.md's updated Home rule (section 1): `content` owns the actions,
 * `home` gets one mirrored primary command — Compose, here — not a second
 * copy of every group.
 */

import { PenSquare, ListChecks } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ContentStudioBody } from "./ContentStudioBody";
import { createDraftPost, deletePost, postById, schedulePost, STATUS_LABEL, STATUS_TONE, updatePostField } from "./contentStudioStore";

const ROUTE = "/content-studio";

/** Always starts a fresh draft — Phase C's Queue rows reopen an existing one via `openPeek("post", id)` instead. */
function compose(): void {
  const post = createDraftPost();
  getShellApi()?.openPeek("post", post.id);
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
            // Phase C fills this in with real per-status rows (SHELL.md
            // section 5: "rows carry real data, not labels").
            gallery: {
              id: "content-queue",
              title: "Queue",
              searchable: true,
              rows: [],
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
