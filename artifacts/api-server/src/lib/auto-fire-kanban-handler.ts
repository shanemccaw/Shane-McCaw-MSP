/**
 * auto-fire-kanban-handler.ts
 *
 * Standalone handler for the `kanban_auto_fire` workflow node type.
 * Extracted so it can be imported and unit-tested independently of
 * the full executor and the retired system-action dispatcher.
 *
 * Script and document auto-fire actions were removed — both are
 * superseded by the real, event-driven flow (consent -> event emitted
 * -> login -> workflow verifies telemetry -> generates documents).
 * Only "workflow" (launching a real child workflow) remains, since
 * that path was already compliant with "only workflows trigger things."
 */

import { autoFireRunWorkflowCards } from "./kanban-auto-fire.ts";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "engine.kanban" });

export async function handleAutoFireKanban(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientUserId = payload.clientUserId as number | undefined;
  const action = (payload.action as string | undefined) ?? "workflow";

  if (!clientUserId) {
    return { skipped: true, reason: "no clientUserId in payload" };
  }

  if (action === "workflow" || action === "both") {
    void autoFireRunWorkflowCards(clientUserId).catch((err: unknown) => {
      log.warn({ err, clientUserId }, "auto_fire_kanban: run_workflow error (non-fatal)");
    });
  }

  return { fired: true, clientUserId, action };
}
