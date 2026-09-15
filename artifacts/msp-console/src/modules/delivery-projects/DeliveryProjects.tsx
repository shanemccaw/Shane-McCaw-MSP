/**
 * Delivery Projects — the real, live typed-card Kanban board relocated from
 * admin-panel (Git #4246, part of #3433). `ProjectsList.tsx` and
 * `ProjectDetail.tsx` here are that same code (real drag-and-drop via
 * `@dnd-kit/core`, the live `kanban-events` SSE stream, the same typed-card
 * rendering) — moved, not rebuilt. This wrapper replaces the admin-panel
 * `wouter` routes (`/crm/projects`, `/crm/projects/:id`) those two files used
 * to own with local state, since this whole feature now mounts as a single
 * `/ops/delivery-projects` leaf (see `console/nav.ts`) rather than getting
 * its own nested routes in msp-console's router.
 *
 * This is a distinct system from the "Projects" Simple Kanban board
 * (`console/modules/Projects.tsx`, #3773, `/ops/projects`) — see that
 * module's own header and `nav.ts`'s comment on the `projects` page id for
 * why the two don't merge.
 */
import { useState } from "react";
import ProjectsList from "./ProjectsList";
import ProjectDetail from "./ProjectDetail";

export function DeliveryProjects() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  if (selectedProjectId != null) {
    return <ProjectDetail projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} />;
  }
  return <ProjectsList onOpenProject={setSelectedProjectId} />;
}
