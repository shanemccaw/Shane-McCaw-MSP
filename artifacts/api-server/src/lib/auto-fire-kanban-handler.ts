/**
 * auto-fire-kanban-handler.ts
 *
 * Standalone handler for the `kanban_auto_fire` workflow node type.
 * Extracted so it can be imported and unit-tested independently of
 * the full executor and the retired system-action dispatcher.
 */

import { autoFireFirstBacklogScript, autoFireDocumentCard, autoFireRunWorkflowCards } from "./kanban-auto-fire.ts";
import { logger } from "./logger.ts";

export async function handleAutoFireKanban(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientUserId = payload.clientUserId as number | undefined;
  const action = (payload.action as string | undefined) ?? "both";

  if (!clientUserId) {
    return { skipped: true, reason: "no clientUserId in payload" };
  }

  if (action === "script" || action === "both") {
    void autoFireFirstBacklogScript(clientUserId).catch((err: unknown) => {
      logger.warn({ err, clientUserId }, "auto_fire_kanban: script error (non-fatal)");
    });
  }
  if (action === "document" || action === "both") {
    void autoFireDocumentCard(clientUserId).catch((err: unknown) => {
      logger.warn({ err, clientUserId }, "auto_fire_kanban: document error (non-fatal)");
    });
  }
  if (action === "workflow" || action === "both") {
    void autoFireRunWorkflowCards(clientUserId).catch((err: unknown) => {
      logger.warn({ err, clientUserId }, "auto_fire_kanban: run_workflow error (non-fatal)");
    });
  }

  return { fired: true, clientUserId, action };
}
