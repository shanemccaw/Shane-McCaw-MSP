/**
 * manual-script-kanban.ts
 *
 * Helper for creating and updating Kanban cards associated with manual script runs.
 * Called from the generate-package and upload endpoints.
 */

import { db, kanbanTasksTable, projectsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export interface ManualScriptKanbanInput {
  scriptId: number;
  scriptRunResultId: number;
  customerId: number;
  scriptName: string;
  manualRequirements: string[];
  description: string | null;
  downloadUrl: string;
  instructionsUrl: string;
  uploadUrl: string;
}

/**
 * Returns the next business day N days from now (skipping Saturday=6, Sunday=0).
 */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/**
 * Resolves the active project for a customer. Returns null if none found.
 */
async function resolveProjectForCustomer(customerId: number): Promise<number | null> {
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.clientUserId, customerId),
        eq(projectsTable.status, "active"),
      ),
    )
    .orderBy(desc(projectsTable.createdAt))
    .limit(1);
  return project?.id ?? null;
}

/**
 * Creates or updates a Kanban card for a manual script run.
 * Idempotent: if a card referencing this scriptRunResultId already exists
 * (via taskMetadata.scriptRunResultId), it is updated rather than duplicated.
 *
 * Returns the kanban task id, or null if no project was found for the customer.
 */
export async function createManualScriptKanbanCard(
  input: ManualScriptKanbanInput,
): Promise<number | null> {
  const {
    scriptId,
    scriptRunResultId,
    customerId,
    scriptName,
    manualRequirements,
    description,
    downloadUrl,
    instructionsUrl,
    uploadUrl,
  } = input;

  const projectId = await resolveProjectForCustomer(customerId);
  if (!projectId) {
    logger.warn(
      { customerId, scriptRunResultId },
      "manual-script-kanban: no active project found for customer — skipping card creation",
    );
    return null;
  }

  const title = `⚡ Action Required: ${scriptName} — Run & Upload Results`;

  const whyNotAutomated =
    manualRequirements.length > 0
      ? manualRequirements.join("; ")
      : "This script requires interactive (delegated) authentication that cannot run unattended.";

  const descriptionText = [
    description
      ? `This script collects data from your Microsoft 365 environment: ${description}`
      : "This script collects data from your Microsoft 365 environment.",
    "",
    "**Why can't this be automated?**",
    whyNotAutomated,
    "",
    "**What data does it collect?**",
    description ?? "See the script instructions for specifics.",
  ].join("\n");

  const waitingReason =
    "Waiting for you to run the PowerShell script and upload the JSON results.";

  const instructions = [
    "Click **Download Script** to save the .ps1 file.",
    "Open PowerShell as the user listed in the required roles.",
    "Run the script — it will save a .json file in the same folder.",
    "Return here and click **Upload Results** to send the JSON file back.",
    "Once uploaded, this card moves to Completed automatically.",
  ];

  const checklist = [
    { id: "downloaded", label: "Downloaded the script" },
    { id: "authenticated", label: "Authenticated with the required account" },
    { id: "ran", label: "Ran the script successfully" },
    { id: "saved", label: "Saved the JSON output file" },
    { id: "uploaded", label: "Uploaded the JSON results" },
  ];

  const clientDeliverables = [downloadUrl, instructionsUrl, uploadUrl];

  const taskMetadata = {
    scriptId,
    scriptRunResultId,
    projectId,
    instructions,
    checklist,
    clientDeliverables,
    checklistState: {} as Record<string, boolean>,
    uploadedArtifacts: [] as string[],
  };

  const dueDate = addBusinessDays(new Date(), 3);

  try {
    const allTasks = await db
      .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.projectId, projectId));

    const existingCard = allTasks.find(
      (t) =>
        t.taskMetadata &&
        typeof t.taskMetadata === "object" &&
        (t.taskMetadata as Record<string, unknown>).scriptRunResultId === scriptRunResultId,
    );

    if (existingCard) {
      await db
        .update(kanbanTasksTable)
        .set({
          title,
          description: descriptionText,
          column: "waiting_on_customer",
          waitingReason,
          priority: "high",
          dueDate,
          taskType: "manualScript",
          taskMetadata,
          updatedAt: new Date(),
        })
        .where(eq(kanbanTasksTable.id, existingCard.id));
      logger.info(
        { kanbanTaskId: existingCard.id, scriptRunResultId },
        "manual-script-kanban: updated existing card",
      );
      return existingCard.id;
    }

    const [newTask] = await db
      .insert(kanbanTasksTable)
      .values({
        projectId,
        title,
        description: descriptionText,
        column: "waiting_on_customer",
        order: 0,
        waitingReason,
        priority: "high",
        dueDate,
        taskType: "manualScript",
        taskMetadata,
      })
      .returning({ id: kanbanTasksTable.id });

    logger.info(
      { kanbanTaskId: newTask.id, projectId, scriptRunResultId },
      "manual-script-kanban: created card",
    );
    return newTask.id;
  } catch (err) {
    logger.error({ err, scriptRunResultId }, "manual-script-kanban: failed to create/update card");
    return null;
  }
}

/**
 * When a manual script upload completes, finds the associated Kanban card and:
 * - Ticks the "Uploaded the JSON results" checklist item
 * - Moves the card to the `completed` column
 */
export async function completeManualScriptKanbanCard(
  scriptRunResultId: number,
  projectId?: number | null,
): Promise<void> {
  try {
    const conditions = projectId
      ? [eq(kanbanTasksTable.projectId, projectId)]
      : [];

    const allTasks = await db
      .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
      .from(kanbanTasksTable)
      .where(conditions.length > 0 ? and(...conditions) : sql`true`);

    const card = allTasks.find(
      (t) =>
        t.taskMetadata &&
        typeof t.taskMetadata === "object" &&
        (t.taskMetadata as Record<string, unknown>).scriptRunResultId === scriptRunResultId,
    );

    if (!card) {
      logger.warn(
        { scriptRunResultId },
        "manual-script-kanban: no card found to complete",
      );
      return;
    }

    const meta = (card.taskMetadata ?? {}) as Record<string, unknown>;
    const checklistState = ((meta.checklistState ?? {}) as Record<string, boolean>);
    checklistState["uploaded"] = true;

    await db
      .update(kanbanTasksTable)
      .set({
        column: "completed",
        taskMetadata: { ...meta, checklistState },
        completionStatus: "Script results uploaded",
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));

    logger.info(
      { kanbanTaskId: card.id, scriptRunResultId },
      "manual-script-kanban: marked card completed",
    );
  } catch (err) {
    logger.warn({ err, scriptRunResultId }, "manual-script-kanban: could not complete card (non-fatal)");
  }
}
