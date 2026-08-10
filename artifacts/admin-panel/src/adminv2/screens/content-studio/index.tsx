/**
 * Content Studio — LinkedIn post composition/scheduling, at `/adminv2/content-studio`.
 *
 * Phase A of Git #601's build plan (posted as a comment on #601; this screen
 * is Git #681). Scaffolding only: registration, ribbon, empty-state body.
 * Phase B adds a `post` peek, Phase C a real Queue gallery, Phase D palette +
 * Watch wiring, Phase E undo/redo, Phase F the scheduling backend, Phase G
 * optional in-peek AI Assist.
 *
 * Per SHELL.md's updated Home rule (section 1): `content` owns the actions,
 * `home` gets one mirrored primary command — Compose, here — not a second
 * copy of every group.
 */

import { PenSquare, ListChecks } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { ContentStudioBody } from "./ContentStudioBody";

const ROUTE = "/content-studio";

function compose(): void {
  // Phase B wires this to opening a fresh `post` peek in compose mode.
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
});
